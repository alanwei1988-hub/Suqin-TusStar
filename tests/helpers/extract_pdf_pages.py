import sys
from pathlib import Path

from pypdf import PdfReader, PdfWriter


def main() -> int:
    if len(sys.argv) != 4:
        raise SystemExit("Usage: extract_pdf_pages.py <input_pdf> <output_dir> <page_count>")

    input_pdf = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    page_count = int(sys.argv[3])

    output_dir.mkdir(parents=True, exist_ok=True)

    reader = PdfReader(str(input_pdf))
    selected_count = min(page_count, len(reader.pages))

    for index in range(selected_count):
        writer = PdfWriter()
        writer.add_page(reader.pages[index])
        output_path = output_dir / f"page-{index + 1:02d}.pdf"
        with output_path.open("wb") as handle:
            writer.write(handle)
        print(output_path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
