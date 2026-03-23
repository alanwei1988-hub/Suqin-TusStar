import argparse
import base64
import io
import os
import sys
import time
from pathlib import Path

_WALL_PROCESS_STARTED_AT = time.perf_counter()

from markitdown import MarkItDown
from openai import OpenAI


_PROCESS_STARTED_AT = time.perf_counter()
QWEN_OPENAI_COMPAT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
QWEN_DOCUMENT_MARKDOWN_PROMPT = "qwenvl markdown"
QWEN_PDF_RENDER_DPI = 150


class _ChatCompletionsProxy:
    def __init__(self, completions, default_extra_body: dict | None = None):
        self._completions = completions
        self._default_extra_body = default_extra_body or {}

    def create(self, *args, **kwargs):
        if self._default_extra_body:
            extra_body = kwargs.get("extra_body") or {}
            kwargs["extra_body"] = {**self._default_extra_body, **extra_body}
        return self._completions.create(*args, **kwargs)


class _ChatProxy:
    def __init__(self, chat, default_extra_body: dict | None = None):
        self.completions = _ChatCompletionsProxy(
            chat.completions, default_extra_body=default_extra_body
        )


class _OpenAIClientProxy:
    def __init__(self, client, default_extra_body: dict | None = None):
        self._client = client
        self.chat = _ChatProxy(client.chat, default_extra_body=default_extra_body)

    def __getattr__(self, name):
        return getattr(self._client, name)


def is_qwen_client(client_name: str) -> bool:
    return (client_name or "").strip().lower() in {"qwen", "dashscope"}


def is_timing_enabled() -> bool:
    return os.environ.get("MARKITDOWN_TIMING", "").strip() == "1"


def timing_log(message: str) -> None:
    if is_timing_enabled():
        sys.stderr.write(f"[runner-timing] {message}\n")
        sys.stderr.flush()


def build_llm_client(client_name: str, base_url: str | None):
    normalized = (client_name or "").strip().lower()
    if not normalized:
        return None

    if normalized not in {"openai", "openai-compatible", "qwen", "dashscope"}:
        raise ValueError(f"Unsupported llm client: {client_name}")

    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("OPENAI_API_KEY is required for MarkItDown OCR.")

    effective_base_url = base_url
    default_extra_body = None

    if is_qwen_client(normalized):
        effective_base_url = effective_base_url or QWEN_OPENAI_COMPAT_BASE_URL
        default_extra_body = {"enable_thinking": False}

    kwargs = {"api_key": api_key}
    if effective_base_url:
        kwargs["base_url"] = effective_base_url

    client = OpenAI(**kwargs)
    if default_extra_body:
        return _OpenAIClientProxy(client, default_extra_body=default_extra_body)

    return client


def build_qwen_document_prompt(prompt: str, page_count: int) -> str:
    base_prompt = (prompt or "").strip() or QWEN_DOCUMENT_MARKDOWN_PROMPT
    if base_prompt.lower() == QWEN_DOCUMENT_MARKDOWN_PROMPT:
        return (
            f"{QWEN_DOCUMENT_MARKDOWN_PROMPT}\n"
            f"以下输入按顺序对应同一个扫描版PDF的 {page_count} 页。\n"
            "请按页顺序输出整份文档的 Markdown。\n"
            "要求：\n"
            "1. 保留标题、段落、列表和表格结构。\n"
            "2. 每页开头使用 `## Page N` 作为页标题。\n"
            "3. 只输出文档 Markdown，不要补充解释。"
        )

    return base_prompt


def render_pdf_to_data_urls(input_path: str, dpi: int = QWEN_PDF_RENDER_DPI):
    import fitz  # PyMuPDF

    render_started_at = time.perf_counter()
    doc = fitz.open(input_path)
    image_urls: list[str] = []
    scale = dpi / 72
    matrix = fitz.Matrix(scale, scale)

    try:
        for page_index in range(doc.page_count):
            page = doc[page_index]
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            image_bytes = pix.tobytes("png")
            base64_image = base64.b64encode(image_bytes).decode("utf-8")
            image_urls.append(f"data:image/png;base64,{base64_image}")
    finally:
        doc.close()

    timing_log(
        f"qwen_pdf_render elapsed_ms={(time.perf_counter() - render_started_at) * 1000:.0f} "
        f"pages={len(image_urls)} dpi={dpi}"
    )
    return image_urls


def render_pdf_page_range_to_data_urls(
    input_path: str,
    page_start: int,
    page_count: int,
    dpi: int = QWEN_PDF_RENDER_DPI,
):
    import fitz  # PyMuPDF

    render_started_at = time.perf_counter()
    doc = fitz.open(input_path)
    image_urls: list[str] = []
    total_pages = doc.page_count
    normalized_page_start = max(1, min(page_start, total_pages if total_pages > 0 else 1))
    normalized_page_count = page_count if page_count and page_count > 0 else max(0, total_pages - normalized_page_start + 1)
    end_page = min(total_pages, normalized_page_start + normalized_page_count - 1)
    scale = dpi / 72
    matrix = fitz.Matrix(scale, scale)

    try:
        if total_pages > 0:
            for page_number in range(normalized_page_start, end_page + 1):
                page = doc[page_number - 1]
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                image_bytes = pix.tobytes("png")
                base64_image = base64.b64encode(image_bytes).decode("utf-8")
                image_urls.append(f"data:image/png;base64,{base64_image}")
    finally:
        doc.close()

    timing_log(
        f"qwen_pdf_render elapsed_ms={(time.perf_counter() - render_started_at) * 1000:.0f} "
        f"pages={len(image_urls)} dpi={dpi} page_start={normalized_page_start} page_count={len(image_urls)}"
    )
    return {
        "image_urls": image_urls,
        "page_start": normalized_page_start,
        "page_count": len(image_urls),
        "total_pages": total_pages,
    }


def convert_pdf_with_qwen_document_parser(
    client: OpenAI,
    model: str,
    input_path: str,
    prompt: str,
    page_start: int,
    page_count: int,
    ocr_concurrency: int,
    ocr_page_group_size: int,
):
    render_result = render_pdf_page_range_to_data_urls(input_path, page_start, page_count)
    image_urls = render_result["image_urls"]
    if not image_urls:
        raise ValueError("No PDF pages were rendered for Qwen document parsing.")

    group_size = max(1, ocr_page_group_size)
    concurrency = max(1, ocr_concurrency)
    chunks: list[tuple[int, list[str]]] = []
    for chunk_index, start_index in enumerate(range(0, len(image_urls), group_size)):
        chunks.append((chunk_index, image_urls[start_index : start_index + group_size]))

    def parse_chunk(chunk_index: int, chunk_image_urls: list[str]) -> tuple[int, str]:
        chunk_page_start = render_result["page_start"] + (chunk_index * group_size)
        content = [{"type": "text", "text": build_qwen_document_prompt(prompt, len(chunk_image_urls))}]
        content.extend(
            {"type": "image_url", "image_url": {"url": image_url}}
            for image_url in chunk_image_urls
        )

        request_started_at = time.perf_counter()
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": content}],
        )
        elapsed_ms = (time.perf_counter() - request_started_at) * 1000
        message_content = response.choices[0].message.content
        if isinstance(message_content, str):
            markdown = message_content.strip()
        else:
            markdown = str(message_content or "").strip()

        timing_log(
            f"qwen_document_parse.chunk elapsed_ms={elapsed_ms:.0f} "
            f"chunk_index={chunk_index} page_start={chunk_page_start} "
            f"page_count={len(chunk_image_urls)} markdown_chars={len(markdown)}"
        )
        return chunk_index, markdown

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        results = list(executor.map(lambda item: parse_chunk(item[0], item[1]), chunks))

    ordered_markdown = [markdown for _, markdown in sorted(results, key=lambda item: item[0])]
    markdown = "\n\n".join(part for part in ordered_markdown if part.strip()).strip()
    timing_log(
        f"qwen_document_parse elapsed_ms=0 pages={render_result['page_count']} markdown_chars={len(markdown)} "
        f"chunks={len(chunks)} concurrency={concurrency} group_size={group_size}"
    )
    return {
        "markdown": markdown,
        "page_start": render_result["page_start"],
        "page_count": render_result["page_count"],
        "total_pages": render_result["total_pages"],
    }


def extract_page_text_with_llm(client: OpenAI, model: str, image_url: str, prompt: str) -> str:
    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            }
        ],
    )
    message_content = response.choices[0].message.content
    if isinstance(message_content, str):
        return message_content.strip()
    return str(message_content or "").strip()


def convert_pdf_with_parallel_page_ocr(
    client: OpenAI,
    model: str,
    input_path: str,
    prompt: str,
    page_start: int,
    page_count: int,
    ocr_concurrency: int,
):
    render_result = render_pdf_page_range_to_data_urls(input_path, page_start, page_count)
    image_urls = render_result["image_urls"]
    if not image_urls:
        raise ValueError("No PDF pages were rendered for OCR.")

    concurrency = max(1, ocr_concurrency)

    def parse_page(page_offset_and_url: tuple[int, str]) -> tuple[int, str]:
        page_offset, image_url = page_offset_and_url
        absolute_page = render_result["page_start"] + page_offset
        request_started_at = time.perf_counter()
        text = extract_page_text_with_llm(client, model, image_url, prompt)
        elapsed_ms = (time.perf_counter() - request_started_at) * 1000
        timing_log(
            f"parallel_page_ocr elapsed_ms={elapsed_ms:.0f} page={absolute_page} text_chars={len(text)}"
        )
        return absolute_page, text

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        results = list(executor.map(parse_page, enumerate(image_urls)))

    markdown_parts = []
    for absolute_page, text in sorted(results, key=lambda item: item[0]):
        markdown_parts.append(f"## Page {absolute_page}\n\n{text}".strip())

    markdown = "\n\n".join(part for part in markdown_parts if part.strip()).strip()
    timing_log(
        f"parallel_page_ocr.total elapsed_ms=0 pages={render_result['page_count']} markdown_chars={len(markdown)} concurrency={concurrency}"
    )
    return {
        "markdown": markdown,
        "page_start": render_result["page_start"],
        "page_count": render_result["page_count"],
        "total_pages": render_result["total_pages"],
    }


def install_timing_hooks() -> None:
    if not is_timing_enabled():
        return

    try:
        from markitdown_ocr._ocr_service import LLMVisionOCRService
        from markitdown_ocr._pdf_converter_with_ocr import PdfConverterWithOCR
    except Exception as error:
        timing_log(f"failed to install OCR timing hooks: {error}")
        return

    original_extract_text = LLMVisionOCRService.extract_text
    original_ocr_full_pages = PdfConverterWithOCR._ocr_full_pages

    def timed_extract_text(self, image_stream, *args, **kwargs):
        started_at = time.perf_counter()
        result = original_extract_text(self, image_stream, *args, **kwargs)
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        text_length = len((result.text or "").strip())
        error = result.error or ""
        timing_log(
            f"ocr_service.extract_text elapsed_ms={elapsed_ms:.0f} text_chars={text_length} error={error}"
        )
        return result

    def timed_ocr_full_pages(self, pdf_bytes, ocr_service):
        started_at = time.perf_counter()
        result = original_ocr_full_pages(self, pdf_bytes, ocr_service)
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        timing_log(
            f"pdf_converter._ocr_full_pages elapsed_ms={elapsed_ms:.0f} markdown_chars={len(result or '')}"
        )
        return result

    LLMVisionOCRService.extract_text = timed_extract_text
    PdfConverterWithOCR._ocr_full_pages = timed_ocr_full_pages
    timing_log("installed OCR timing hooks")


def main() -> int:
    timing_log(
        f"python_imports_ready elapsed_ms={(_PROCESS_STARTED_AT - _WALL_PROCESS_STARTED_AT) * 1000:.0f}"
    )
    timing_log(f"process_started elapsed_ms={(time.perf_counter() - _PROCESS_STARTED_AT) * 1000:.0f}")
    parser = argparse.ArgumentParser(description="MarkItDown runner with OCR plugin support.")
    parser.add_argument("input", help="Input file path")
    parser.add_argument("--use-plugins", action="store_true", help="Enable MarkItDown plugins")
    parser.add_argument("--llm-client", default="", help="LLM client name")
    parser.add_argument("--llm-model", default="", help="LLM model name")
    parser.add_argument("--llm-base-url", default="", help="LLM base URL")
    parser.add_argument("--llm-prompt", default="", help="LLM OCR prompt")
    parser.add_argument("--page-start", default="1", help="1-based PDF page start")
    parser.add_argument("--page-count", default="0", help="PDF page count, 0 means all remaining pages")
    parser.add_argument("--ocr-concurrency", default="1", help="Max OCR concurrency for PDF OCR")
    parser.add_argument("--ocr-page-group-size", default="1", help="Pages per OCR request when supported")
    args = parser.parse_args()
    timing_log(f"args_parsed elapsed_ms={(time.perf_counter() - _PROCESS_STARTED_AT) * 1000:.0f}")

    kwargs = {}
    llm_client = None
    llm_prompt = ""
    if args.llm_client and args.llm_model:
        normalized_llm_client = args.llm_client.strip().lower()
        llm_prompt = args.llm_prompt.strip()
        if not llm_prompt and is_qwen_client(normalized_llm_client):
            llm_prompt = QWEN_DOCUMENT_MARKDOWN_PROMPT
        llm_started_at = time.perf_counter()
        llm_client = build_llm_client(
            args.llm_client, args.llm_base_url or None
        )
        kwargs["llm_client"] = llm_client
        kwargs["llm_model"] = args.llm_model
        if llm_prompt:
            kwargs["llm_prompt"] = llm_prompt
        timing_log(
            f"llm_client_built elapsed_ms={(time.perf_counter() - llm_started_at) * 1000:.0f}"
        )

    install_timing_hooks()
    input_suffix = Path(args.input).suffix.lower()
    if llm_client is not None and input_suffix == ".pdf":
        convert_started_at = time.perf_counter()
        page_start = max(1, int(args.page_start or "1"))
        page_count = max(0, int(args.page_count or "0"))
        ocr_concurrency = max(1, int(args.ocr_concurrency or "1"))
        if is_qwen_client(args.llm_client):
            converted = convert_pdf_with_qwen_document_parser(
                llm_client,
                args.llm_model,
                args.input,
                llm_prompt,
                page_start,
                page_count,
                ocr_concurrency,
                max(1, int(args.ocr_page_group_size or "1")),
            )
        else:
            converted = convert_pdf_with_parallel_page_ocr(
                llm_client,
                args.llm_model,
                args.input,
                llm_prompt or (
                    "Extract all text from this image. Return ONLY the extracted text, "
                    "maintaining the original layout and order. Do not add commentary."
                ),
                page_start,
                page_count,
                ocr_concurrency,
            )
        markdown = converted["markdown"]
        timing_log(
            f"markitdown_convert elapsed_ms={(time.perf_counter() - convert_started_at) * 1000:.0f} markdown_chars={len(markdown)}"
        )
        sys.stdout.write(markdown)
        timing_log(
            f"runner_total elapsed_ms={(time.perf_counter() - _PROCESS_STARTED_AT) * 1000:.0f}"
        )
        return 0

    markitdown_started_at = time.perf_counter()
    markitdown = MarkItDown(enable_plugins=args.use_plugins, **kwargs)
    timing_log(
        f"markitdown_initialized elapsed_ms={(time.perf_counter() - markitdown_started_at) * 1000:.0f}"
    )
    convert_started_at = time.perf_counter()
    result = markitdown.convert(args.input)
    timing_log(
        f"markitdown_convert elapsed_ms={(time.perf_counter() - convert_started_at) * 1000:.0f} markdown_chars={len(result.markdown)}"
    )
    sys.stdout.write(result.markdown)
    timing_log(
        f"runner_total elapsed_ms={(time.perf_counter() - _PROCESS_STARTED_AT) * 1000:.0f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
