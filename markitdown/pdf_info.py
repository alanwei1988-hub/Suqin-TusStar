import json
import sys

from pypdf import PdfReader


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: pdf_info.py <input_pdf>")

    reader = PdfReader(sys.argv[1])
    print(json.dumps({
        "pageCount": len(reader.pages),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
