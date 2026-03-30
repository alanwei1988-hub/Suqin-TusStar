#!/usr/bin/env python3
import argparse
import base64
import json
import sys
from io import BytesIO
from pathlib import Path

from google import genai
from google.genai import types
from PIL import Image


def iter_response_parts(response):
    parts = getattr(response, "parts", None)
    if parts:
        return parts

    for candidate in getattr(response, "candidates", []) or []:
        content = getattr(candidate, "content", None)
        candidate_parts = getattr(content, "parts", None)
        if candidate_parts:
            return candidate_parts

    return []


def save_image_bytes(image_bytes, output_path):
    image = Image.open(BytesIO(image_bytes))
    if image.mode == "RGBA":
        rgb_image = Image.new("RGB", image.size, (255, 255, 255))
        rgb_image.paste(image, mask=image.split()[3])
        rgb_image.save(output_path, "PNG")
        return

    if image.mode == "RGB":
        image.save(output_path, "PNG")
        return

    image.convert("RGB").save(output_path, "PNG")


def main():
    parser = argparse.ArgumentParser(description="Generate or edit images with Gemini image models")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--resolution", choices=["1K", "2K", "4K"], default="1K")
    parser.add_argument("--model", required=True)
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--base-url")
    parser.add_argument("--input-image")
    args = parser.parse_args()

    client_kwargs = {"api_key": args.api_key}
    if args.base_url:
        try:
            client_kwargs["http_options"] = types.HttpOptions(base_url=args.base_url)
        except Exception:
            client_kwargs["http_options"] = {"base_url": args.base_url}

    client = genai.Client(**client_kwargs)
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    contents = args.prompt
    if args.input_image:
        with Image.open(args.input_image) as input_image:
            contents = [input_image.copy(), args.prompt]

    response = client.models.generate_content(
        model=args.model,
        contents=contents,
        config=types.GenerateContentConfig(
            response_modalities=["TEXT", "IMAGE"],
            image_config=types.ImageConfig(image_size=args.resolution),
        ),
    )

    image_saved = False
    for part in iter_response_parts(response):
        if getattr(part, "text", None):
            print(part.text, file=sys.stderr)
            continue

        inline_data = getattr(part, "inline_data", None)
        if inline_data is None or getattr(inline_data, "data", None) is None:
            continue

        image_data = inline_data.data
        if isinstance(image_data, str):
            image_data = base64.b64decode(image_data)
        save_image_bytes(image_data, output_path)
        image_saved = True
        break

    if not image_saved:
        raise RuntimeError("No image data was returned by the model.")

    print(json.dumps({
        "ok": True,
        "outputPath": str(output_path),
        "model": args.model,
        "resolution": args.resolution,
        "edited": bool(args.input_image),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
