const fs = require('fs/promises');
const path = require('path');
const { tool } = require('ai');
const { z } = require('zod');

const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_MAX_TIMEOUT_MS = 900000;
const DEFAULT_OUTPUT_DIR = 'generated-images';
const DEFAULT_RESOLUTION = '1K';
const DEFAULT_MODEL = 'gemini-3-pro-image-preview';
const SUPPORTED_RESOLUTIONS = ['1K', '2K', '4K'];

function slugifyPrompt(prompt) {
  const slug = String(prompt || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return slug || 'image';
}

function buildDefaultFilename(prompt) {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  const timestamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('-');

  return `${timestamp}-${slugifyPrompt(prompt)}.png`;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : '';
}

function resolveProfile(imageGenerationConfig = {}, requestedProfile = '') {
  const profiles = imageGenerationConfig.profiles && typeof imageGenerationConfig.profiles === 'object'
    ? imageGenerationConfig.profiles
    : {};
  const defaultProfileName = normalizeOptionalString(imageGenerationConfig.currentProfile)
    || Object.keys(profiles)[0]
    || '';
  const profileName = normalizeOptionalString(requestedProfile) || defaultProfileName;

  if (!profileName) {
    throw new Error('Image generation profile is not configured.');
  }

  const profile = profiles[profileName];
  if (!profile || typeof profile !== 'object') {
    throw new Error(`Image generation profile not found: ${profileName}`);
  }

  return {
    name: profileName,
    apiKey: normalizeOptionalString(profile.apiKey),
    apiKeyEnv: normalizeOptionalString(profile.apiKeyEnv),
    baseUrl: normalizeOptionalString(profile.baseUrl || profile.baseURL),
    model: normalizeOptionalString(profile.model || profile.modelId) || DEFAULT_MODEL,
  };
}

function resolveApiKey(profile) {
  if (profile.apiKey) {
    return profile.apiKey;
  }

  if (profile.apiKeyEnv) {
    const value = process.env[profile.apiKeyEnv];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return '';
}

function buildWorkspaceOutputPath({
  resolveWorkspacePath,
  configuredOutputDir,
  outputPath,
  prompt,
}) {
  if (normalizeOptionalString(outputPath)) {
    return resolveWorkspacePath(outputPath);
  }

  const outputDir = normalizeOptionalString(configuredOutputDir) || DEFAULT_OUTPUT_DIR;
  const resolvedDir = resolveWorkspacePath(outputDir);
  return path.join(resolvedDir, buildDefaultFilename(prompt));
}

async function parseRunnerResult(stdout) {
  const text = String(stdout || '').trim();
  if (!text) {
    return {};
  }

  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      continue;
    }
  }

  return {};
}

function createImageGenerationTool({
  workspaceDir,
  workspacePythonConfig = {},
  imageGenerationConfig = {},
  ensureUserPythonEnvironment,
  runCommand,
  pathExists,
  resolveWorkspacePath,
  resolveReadablePath,
  buildWorkspacePathMetadata,
  registerOutboundAttachment,
}) {
  return tool({
    description: [
      'Generate or edit images with the configured Nano Banana Pro image backend.',
      'Use this for visual design tasks such as posters, concept images, promotional drafts, and image edits.',
      'Output files are saved inside the current user workspace.',
      'Set `sendToUser=true` when the user should directly receive the generated image file.',
    ].join(' '),
    inputSchema: z.object({
      prompt: z.string().min(1).describe('The image prompt or editing instruction.'),
      outputPath: z.string().optional().describe('Optional workspace path for the output PNG file.'),
      inputImagePath: z.string().optional().describe('Optional workspace, attachment, or shared image path for editing an existing image.'),
      resolution: z.enum(SUPPORTED_RESOLUTIONS).optional().describe('Target image resolution. Defaults to the configured default resolution.'),
      profile: z.string().optional().describe('Optional configured image backend profile name.'),
      sendToUser: z.boolean().optional().describe('Whether to queue the generated image for delivery to the user.'),
      timeoutMs: z.number().int().positive().optional().describe('Optional timeout in milliseconds for this generation task.'),
    }),
    execute: async ({
      prompt,
      outputPath,
      inputImagePath,
      resolution,
      profile,
      sendToUser,
      timeoutMs,
    }) => {
      if (imageGenerationConfig.enabled === false) {
        throw new Error('Image generation is disabled in the current agent configuration.');
      }

      const scriptPath = normalizeOptionalString(imageGenerationConfig.scriptPath);
      if (!scriptPath || !(await pathExists(scriptPath))) {
        throw new Error(`Image generation runner is missing: ${scriptPath || '(empty path)'}`);
      }

      const selectedProfile = resolveProfile(imageGenerationConfig, profile);
      const apiKey = resolveApiKey(selectedProfile);
      if (!apiKey) {
        const hint = selectedProfile.apiKeyEnv
          ? ` Set environment variable ${selectedProfile.apiKeyEnv}.`
          : '';
        throw new Error(`No API key configured for image profile "${selectedProfile.name}".${hint}`);
      }

      const effectiveTimeoutMs = Math.min(
        Number.isFinite(timeoutMs) ? timeoutMs : (imageGenerationConfig.timeoutMs || DEFAULT_TIMEOUT_MS),
        imageGenerationConfig.maxTimeoutMs || DEFAULT_MAX_TIMEOUT_MS,
      );
      const runtime = await ensureUserPythonEnvironment(workspacePythonConfig, effectiveTimeoutMs, {
        runCommandImpl: runCommand,
        pathExistsImpl: pathExists,
      });
      const resolvedOutputPath = buildWorkspaceOutputPath({
        resolveWorkspacePath,
        configuredOutputDir: imageGenerationConfig.outputDir,
        outputPath,
        prompt,
      });
      const resolvedInputImagePath = normalizeOptionalString(inputImagePath)
        ? resolveReadablePath(inputImagePath)
        : '';
      await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });

      const args = [
        scriptPath,
        '--prompt', prompt,
        '--output', resolvedOutputPath,
        '--resolution', resolution || imageGenerationConfig.defaultResolution || DEFAULT_RESOLUTION,
        '--model', selectedProfile.model || DEFAULT_MODEL,
        '--api-key', apiKey,
      ];

      if (selectedProfile.baseUrl) {
        args.push('--base-url', selectedProfile.baseUrl);
      }

      if (resolvedInputImagePath) {
        args.push('--input-image', resolvedInputImagePath);
      }

      const result = await runCommand(runtime.pythonCommand, args, {
        cwd: workspaceDir,
        timeoutMs: effectiveTimeoutMs,
      });

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || result.stdout || 'Image generation failed.');
      }

      const runnerResult = await parseRunnerResult(result.stdout);
      const attachment = sendToUser
        ? await registerOutboundAttachment(resolvedOutputPath, path.basename(resolvedOutputPath))
        : null;

      return {
        success: true,
        path: resolvedOutputPath,
        ...buildWorkspacePathMetadata(workspaceDir, resolvedOutputPath),
        profile: selectedProfile.name,
        model: runnerResult.model || selectedProfile.model,
        resolution: runnerResult.resolution || resolution || imageGenerationConfig.defaultResolution || DEFAULT_RESOLUTION,
        prompt,
        inputImagePath: resolvedInputImagePath || undefined,
        attachment,
      };
    },
  });
}

function buildImageGenerationPrompt(imageGenerationConfig = {}) {
  if (imageGenerationConfig.enabled === false) {
    return '';
  }

  const profileName = normalizeOptionalString(imageGenerationConfig.currentProfile);
  const outputDir = normalizeOptionalString(imageGenerationConfig.outputDir) || DEFAULT_OUTPUT_DIR;
  const defaultResolution = normalizeOptionalString(imageGenerationConfig.defaultResolution) || DEFAULT_RESOLUTION;

  return [
    'Image generation',
    `Use \`generateImage\` for visual design work such as posters, promotional drafts, and image edits. Default profile: \`${profileName || 'not-set'}\`; default resolution: \`${defaultResolution}\`; default output directory: \`${outputDir}\`.`,
    'If the user should receive the resulting image file in chat, set `sendToUser=true` or call `sendFile` with the generated path before the final reply.',
  ].join('\n');
}

module.exports = {
  buildImageGenerationPrompt,
  createImageGenerationTool,
};
