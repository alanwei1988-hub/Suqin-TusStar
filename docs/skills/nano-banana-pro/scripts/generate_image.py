#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "google-genai>=1.0.0",
#     "pillow>=10.0.0",
# ]
# ///
"""
Generate images using Google's Nano Banana Pro (Gemini 3 Pro Image) API.

Usage:
    uv run generate_image.py --prompt "your image description" --filename "output.png" [--resolution 1K|2K|4K] [--api-key KEY] [--base-url URL] [--no-save-config]
"""

import argparse
import json
import os
import sys
from pathlib import Path


PROFILES_DIR = "profiles"
CONFIG_FILENAME = "config.json"
DEFAULT_MODEL_ID = "gemini-3-pro-image-preview"


def get_profiles_dir() -> Path:
    return Path(__file__).resolve().parents[1] / PROFILES_DIR


def get_current_profile_path() -> Path:
    return get_profiles_dir() / "current.json"


def get_config_path() -> Path:
    return Path(__file__).resolve().parents[1] / CONFIG_FILENAME


def load_config(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            return data
        print(f"Warning: Config file is not a JSON object: {path}", file=sys.stderr)
        return {}
    except FileNotFoundError:
        return {}
    except Exception as exc:
        print(f"Warning: Failed to read config file {path}: {exc}", file=sys.stderr)
        return {}


def save_config(path: Path, config: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(config, handle, indent=2, sort_keys=True)
        handle.write("\n")
    tmp_path.replace(path)


def get_config_value(config: dict, key: str) -> str | None:
    value = config.get(key)
    if isinstance(value, str):
        value = value.strip()
        if value:
            return value
    return None


def load_current_profile() -> str | None:
    """Load the current profile name from current.json."""
    current_path = get_current_profile_path()
    config = load_config(current_path)
    return config.get("current")


def get_profile_config(profile_name: str) -> dict | None:
    """Get configuration for a specific profile from its JSON file."""
    profile_path = get_profiles_dir() / f"{profile_name}.json"
    config = load_config(profile_path)
    return config if config else None


def list_available_profiles() -> list[str]:
    """List all available profile names."""
    profiles_dir = get_profiles_dir()
    if not profiles_dir.exists():
        return []
    profiles = []
    for path in profiles_dir.glob("*.json"):
        if path.name == "current.json":
            continue
        profiles.append(path.stem)
    return sorted(profiles)


def prompt_for_value(prompt: str) -> str | None:
    try:
        value = input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        return None
    return value or None


def get_api_key(
    provided_key: str | None,
    config: dict,
    base_url: str | None,
) -> str | None:
    """Get API key from argument, then config file, then environment when allowed."""
    if provided_key:
        return provided_key
    if base_url:
        # When using a proxy base URL, do not auto-load GEMINI_API_KEY.
        return get_config_value(config, "api_key")
    env_key = os.environ.get("GEMINI_API_KEY")
    if env_key:
        return env_key
    return get_config_value(config, "api_key")


def get_base_url(provided_url: str | None, config: dict) -> str | None:
    """Get base URL from argument, then environment, then config file."""
    if provided_url:
        return provided_url
    env_url = os.environ.get("GEMINI_BASE_URL")
    if env_url:
        return env_url
    return get_config_value(config, "base_url")


def main():
    parser = argparse.ArgumentParser(
        description="Generate images using Nano Banana Pro (Gemini 3 Pro Image)"
    )
    parser.add_argument(
        "--prompt", "-p",
        required=True,
        help="Image description/prompt"
    )
    parser.add_argument(
        "--filename", "-f",
        required=True,
        help="Output filename (e.g., sunset-mountains.png)"
    )
    parser.add_argument(
        "--input-image", "-i",
        help="Optional input image path for editing/modification"
    )
    parser.add_argument(
        "--resolution", "-r",
        choices=["1K", "2K", "4K"],
        default="1K",
        help="Output resolution: 1K (default), 2K, or 4K"
    )
    parser.add_argument(
        "--profile",
        help="Use a specific profile from profiles.json (overrides config.json)"
    )
    parser.add_argument(
        "--api-key", "-k",
        help="Gemini API key (overrides GEMINI_API_KEY env var and profile)"
    )
    parser.add_argument(
        "--base-url",
        help="Override Gemini base URL (proxy supported, overrides profile)"
    )
    parser.add_argument(
        "--no-save-config",
        action="store_true",
        help="Do not persist API key/base URL to config file"
    )

    args = parser.parse_args()

    config_path = get_config_path()
    config = load_config(config_path)

    # Determine effective configuration (profile takes precedence over config.json)
    effective_config = {}
    profile_name = None

    if args.profile:
        # Use specific profile
        profile_name = args.profile
        profile_config = get_profile_config(profile_name)
        if profile_config:
            effective_config = profile_config.copy()
            print(f"Using profile: {profile_name}")
        else:
            available = list_available_profiles()
            print(f"Warning: Profile '{profile_name}' not found.", file=sys.stderr)
            if available:
                print(f"Available profiles: {', '.join(available)}", file=sys.stderr)
            print(f"Falling back to config.json", file=sys.stderr)
            effective_config = config.copy()
    else:
        # Use current profile from current.json, or fall back to config.json
        current = load_current_profile()
        if current:
            profile_config = get_profile_config(current)
            if profile_config:
                effective_config = profile_config.copy()
                profile_name = current
                print(f"Using current profile: {current}")
            else:
                print(f"Warning: Current profile '{current}' not found, falling back to config.json", file=sys.stderr)
                effective_config = config.copy()
        else:
            print(f"No current profile set, falling back to config.json", file=sys.stderr)
            effective_config = config.copy()

    # Resolve base URL early to decide API key sourcing.
    base_url = get_base_url(args.base_url, effective_config)

    # Get API key
    api_key = get_api_key(args.api_key, effective_config, base_url)
    if not api_key:
        api_key = prompt_for_value("Enter Gemini API key: ")
        if not api_key:
            print("Error: No API key provided.", file=sys.stderr)
            print("Please either:", file=sys.stderr)
            print("  1. Provide --api-key argument", file=sys.stderr)
            print("  2. Set GEMINI_API_KEY environment variable", file=sys.stderr)
            print(f"  3. Configure in profile or config file: {profiles_path}", file=sys.stderr)
            sys.exit(1)
        api_key_from_prompt = True
    else:
        api_key_from_prompt = False

    # Import here after checking API key to avoid slow import on error
    from google import genai
    from google.genai import types
    from PIL import Image as PILImage

    if not args.no_save_config:
        config_changed = False
        if (args.api_key or api_key_from_prompt) and api_key != config.get("api_key"):
            config["api_key"] = api_key
            config_changed = True
        if args.base_url and args.base_url != config.get("base_url"):
            config["base_url"] = args.base_url
            config_changed = True
        if config_changed:
            save_config(config_path, config)
            print(f"Saved config: {config_path}")

    client_kwargs = {"api_key": api_key}
    if base_url:
        try:
            http_options = types.HttpOptions(base_url=base_url)
        except Exception:
            http_options = {"base_url": base_url}
        client_kwargs["http_options"] = http_options
        print(f"Using base URL: {base_url}")
    client = genai.Client(**client_kwargs)

    # Set up output path
    output_path = Path(args.filename)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Load input image if provided
    input_image = None
    output_resolution = args.resolution
    if args.input_image:
        try:
            input_image = PILImage.open(args.input_image)
            print(f"Loaded input image: {args.input_image}")

            # Auto-detect resolution if not explicitly set by user
            if args.resolution == "1K":  # Default value
                # Map input image size to resolution
                width, height = input_image.size
                max_dim = max(width, height)
                if max_dim >= 3000:
                    output_resolution = "4K"
                elif max_dim >= 1500:
                    output_resolution = "2K"
                else:
                    output_resolution = "1K"
                print(f"Auto-detected resolution: {output_resolution} (from input {width}x{height})")
        except Exception as e:
            print(f"Error loading input image: {e}", file=sys.stderr)
            sys.exit(1)

    # Build contents (image first if editing, prompt only if generating)
    if input_image:
        contents = [input_image, args.prompt]
        print(f"Editing image with resolution {output_resolution}...")
    else:
        contents = args.prompt
        print(f"Generating image with resolution {output_resolution}...")

    # Get model_id from effective_config (which may come from profile or config.json)
    model_id = get_config_value(effective_config, "model_id") or get_config_value(effective_config, "model") or DEFAULT_MODEL_ID

    try:
        response = client.models.generate_content(
            model=model_id,
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
                image_config=types.ImageConfig(
                    image_size=output_resolution
                )
            )
        )

        # Process response and convert to PNG
        image_saved = False
        for part in response.parts:
            if part.text is not None:
                print(f"Model response: {part.text}")
            elif part.inline_data is not None:
                # Convert inline data to PIL Image and save as PNG
                from io import BytesIO

                # inline_data.data is already bytes, not base64
                image_data = part.inline_data.data
                if isinstance(image_data, str):
                    # If it's a string, it might be base64
                    import base64
                    image_data = base64.b64decode(image_data)

                image = PILImage.open(BytesIO(image_data))

                # Ensure RGB mode for PNG (convert RGBA to RGB with white background if needed)
                if image.mode == 'RGBA':
                    rgb_image = PILImage.new('RGB', image.size, (255, 255, 255))
                    rgb_image.paste(image, mask=image.split()[3])
                    rgb_image.save(str(output_path), 'PNG')
                elif image.mode == 'RGB':
                    image.save(str(output_path), 'PNG')
                else:
                    image.convert('RGB').save(str(output_path), 'PNG')
                image_saved = True

        if image_saved:
            full_path = output_path.resolve()
            print(f"\nImage saved: {full_path}")
        else:
            print("Error: No image was generated in the response.", file=sys.stderr)
            sys.exit(1)

    except Exception as e:
        print(f"Error generating image: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
