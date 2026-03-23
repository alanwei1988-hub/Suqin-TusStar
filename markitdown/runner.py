import argparse
import os
import sys
import time

_WALL_PROCESS_STARTED_AT = time.perf_counter()

from markitdown import MarkItDown
from openai import OpenAI


_PROCESS_STARTED_AT = time.perf_counter()


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

    if normalized not in {"openai", "openai-compatible"}:
        raise ValueError(f"Unsupported llm client: {client_name}")

    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("OPENAI_API_KEY is required for MarkItDown OCR.")

    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url

    return OpenAI(**kwargs)


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
    args = parser.parse_args()
    timing_log(f"args_parsed elapsed_ms={(time.perf_counter() - _PROCESS_STARTED_AT) * 1000:.0f}")

    kwargs = {}
    if args.llm_client and args.llm_model:
        llm_started_at = time.perf_counter()
        kwargs["llm_client"] = build_llm_client(
            args.llm_client, args.llm_base_url or None
        )
        kwargs["llm_model"] = args.llm_model
        timing_log(
            f"llm_client_built elapsed_ms={(time.perf_counter() - llm_started_at) * 1000:.0f}"
        )

    install_timing_hooks()
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
