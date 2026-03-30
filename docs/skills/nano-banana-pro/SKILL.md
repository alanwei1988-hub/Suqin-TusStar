---
name: nano-banana-pro
description: Generate/edit images with Nano Banana Pro (Gemini 3 Pro Image). Use for image create/modify requests incl. edits. Supports text-to-image + image-to-image; 1K/2K/4K; use --input-image.
---

# Nano Banana Pro Image Generation & Editing

Generate new images or edit existing ones using Google's Nano Banana Pro API (Gemini 3 Pro Image).

## Usage

Run the script using absolute path (do NOT cd to skill directory first):

**Generate new image:**
```bash
uv run ~/.openclaw/skills/nano-banana-pro/scripts/generate_image.py --prompt "your image description" --filename "output-name.png" [--resolution 1K|2K|4K] [--api-key KEY] [--base-url URL] [--no-save-config]
```

**Edit existing image:**
```bash
uv run ~/.openclaw/skills/nano-banana-pro/scripts/generate_image.py --prompt "editing instructions" --filename "output-name.png" --input-image "path/to/input.png" [--resolution 1K|2K|4K] [--api-key KEY] [--base-url URL] [--no-save-config]
```

**Important:** Always run from the user's current working directory so images are saved where the user is working, not in the skill directory.

.

## Default Workflow (draft → iterate → final)

Goal: fast iteration without burning time on 4K until the prompt is correct.

- Draft (1K): quick feedback loop
  - `uv run ~/.openclaw/skills/nano-banana-pro/scripts/generate_image.py --prompt "<draft prompt>" --filename "yyyy-mm-dd-hh-mm-ss-draft.png" --resolution 1K`
- Iterate: adjust prompt in small diffs; keep filename new per run
  -.

If editing: keep the same `--input-image` for every iteration until you're happy.
- Final (4K): only when prompt is locked
  - `uv run ~/.openclaw/skills/nano-banana-pro/scripts/generate_image.py --prompt "<final prompt>" --filename "yyyy-mm-dd-hh-mm-ss-final.png" --resolution 4K`

## Resolution Options

The Gemini 3 Pro Image API supports three resolutions (uppercase K required):

- **1K** (default) - ~1024px resolution
- **2K** - ~2048px resolution
- **4K** - ~4096px resolution

Map user requests to API parameters:
- No mention of resolution → `1K`
- "low resolution", "1080", "1080p", "1K" → `1K`
- "2K", "2048", "normal", "medium resolution" → `2K`
- "high resolution", "high-res", "hi-res", "4K", "ultra" → `4K`

## API Key

The script checks for API key in this order:
1. `--api-key` argument (use if user provided key in chat)
2. `GEMINI_API_KEY` environment variable
3. Config file at `<skill_root>/config.json`

Save provided `--api-key` to `<skill_root>/config.json` by default. Use `--no-save-config` for one-off keys.

If no API key is found, the script prompts for it. Leaving it blank exits with an error message.

## Base URL (Proxy/Relay)

To use a relay or proxy, set the base URL in this order:
1. `--base-url` argument
2. `GEMINI_BASE_URL` environment variable
3. Config file at `<skill_root>/config.json`

Save provided `--base-url` to `<skill_root>/config.json` by default. Use `--no-save-config` to avoid persisting it.

If base URL is missing in config and not provided on the command line, the script uses the default Google base URL.

## Profiles (Multiple Endpoints)

The skill supports multiple endpoint profiles via a `profiles/` directory structure:

**Directory structure:**
```
profiles/
  ├── current.json        # Specifies which profile to use
  ├── zetatechs.json      # Zetatechs configuration
  └── apiyi.json          # APIYI configuration
```

**Using a specific profile (overrides current.json):**
```bash
uv run ~/.openclaw/skills/nano-banana-pro/scripts/generate_image.py --prompt "..." --filename "output.png" --profile zetatechs
```

**Using the current profile (no --profile needed):**
```bash
uv run ~/.openclaw/skills/nano-banana-pro/scripts/generate_image.py --prompt "..." --filename "output.png"
```

**current.json structure:**
```json
{
  "current": "apiyi"
}
```

**Profile file structure (e.g., profiles/apiyi.json):**
```json
{
  "api_key": "your-key",
  "base_url": "https://api.apiyi.com",
  "model": "nano-banana-pro"
}
```

**Adding a new profile:**
1. Create a new JSON file in `profiles/` directory (e.g., `profiles/myprovider.json`)
2. Add your configuration to that file
3. Update `profiles/current.json` to set it as current (or use `--profile` to test it)

## Preflight + Common Failures (fast fixes)

- Preflight:
  - `command -v uv` (must exist)
  - `test -n \"$GEMINI_API_KEY\"` (or pass `--api-key`)
  - If editing: `test -f \"path/to/input.png\"`

- Common failures:
  - `Error: No API key provided.` → set `GEMINI_API_KEY` or pass `--api-key`
  - `Error loading input image:` → wrong path / unreadable file; verify `--input-image` points to a real image
  - "quota/permission/403" style API errors → wrong key, no access, or quota exceeded; try a different key/account

## Filename Generation

Generate filenames with the pattern: `yyyy-mm-dd-hh-mm-ss-name.png`

**Format:** `{timestamp}-{descriptive-name}.png`
- Timestamp: Current date/time in format `yyyy-mm-dd-hh-mm-ss` (24-hour format)
- Name: Descriptive lowercase text with hyphens
- Keep the descriptive part concise (1-5 words typically)
- Use context from user's prompt or conversation
- If unclear, use random identifier (e.g., `x9k2`, `a7b3`)

Examples:
- Prompt "A serene Japanese garden" → `2025-11-23-14-23-05-japanese-garden.png`
- Prompt "sunset over mountains" → `2025-11-23-15-30-12-sunset-mountains.png`
- Prompt "create an image of a robot" → `2025-11-23-16-45-33-robot.png`
- Unclear context → `2025-11-23-17-12-48-x9k2.png`

## Image Editing

When the user wants to modify an existing image:
1. Check if they provide an image path or reference an image in the current directory
2. Use `--input-image` parameter with the path to the image
3. The prompt should contain editing instructions (e.g., "make the sky more dramatic", "remove the person", "change to cartoon style")
4. Common editing tasks: add/remove elements, change style, adjust colors, blur background, etc.

## Prompt Handling

**For generation:** Pass user's image description as-is to `--prompt`. Only rework if clearly insufficient.

**For editing:** Pass editing instructions in `--prompt` (e.g., "add a rainbow in the sky", "make it look like a watercolor painting")

Preserve user's creative intent in both cases.

## Prompt Templates (high hit-rate)

Use templates when the user is vague or when edits must be precise.

- Generation template:
  - "Create an image of: <subject>. Style: <style>. Composition: <camera/shot>. Lighting: <lighting>. Background: <background>. Color palette: <palette>. Avoid: <list>."

- Editing template (preserve everything else):
  - "Change ONLY: <single change>. Keep identical: subject, composition/crop, pose, lighting, color palette, background, text, and overall style. Do not add new objects. If text exists, keep it unchanged."

## Output

- Saves PNG to current directory (or specified path if filename includes directory)
- Script outputs the full path to the generated image
- **Do not read the image back** - just inform the user of the saved path

## Examples

**Generate new image:**
```bash
uv run ~/.openclaw/skills/nano-banana-pro/scripts/generate_image.py --prompt "A serene Japanese garden with cherry blossoms" --filename "2025-11-23-14-23-05-japanese-garden.png" --resolution 4K
```

**Edit existing image:**
```bash
uv run ~/.openclaw/skills/nano-banana-pro/scripts/generate_image.py --prompt "make the sky more dramatic with storm clouds" --filename "2025-11-23-14-25-30-dramatic-sky.png" --input-image "original-photo.jpg" --resolution 2K
```
