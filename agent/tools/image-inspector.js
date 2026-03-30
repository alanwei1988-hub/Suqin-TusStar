const fs = require('fs/promises');
const path = require('path');
const { buildThinkingExtraBody } = require('../../llm-thinking');

const DEFAULT_IMAGE_INSPECTION_TIMEOUT_MS = 30000;
const DEFAULT_IMAGE_INSPECTION_PROMPT = [
  'Inspect this image attachment.',
  'Summarize the visible content, the main subject, the scene, and any clearly readable text.',
  'Keep the response concise and factual.',
].join(' ');

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : '';
}

function normalizeImageModelConfig(config = {}) {
  const normalizedConfig = config && typeof config === 'object' && !Array.isArray(config)
    ? config
    : {};

  return {
    enabled: normalizedConfig.enabled !== false,
    model: normalizeOptionalString(normalizedConfig.model),
    baseURL: normalizeOptionalString(normalizedConfig.baseURL || normalizedConfig.baseUrl),
    apiKeyEnv: normalizeOptionalString(normalizedConfig.apiKeyEnv),
    apiKey: normalizeOptionalString(normalizedConfig.apiKey),
    timeoutMs: Number.isFinite(normalizedConfig.timeoutMs)
      ? Math.max(1, Math.trunc(normalizedConfig.timeoutMs))
      : DEFAULT_IMAGE_INSPECTION_TIMEOUT_MS,
    prompt: normalizeOptionalString(normalizedConfig.prompt) || DEFAULT_IMAGE_INSPECTION_PROMPT,
    handlerModule: normalizeOptionalString(normalizedConfig.handlerModule),
    thinking: normalizedConfig.thinking && typeof normalizedConfig.thinking === 'object'
      ? normalizedConfig.thinking
      : null,
  };
}

function resolveApiKey(config = {}, fallbackConfig = {}) {
  const hasExplicitImageModelCredentials = Boolean(
    normalizeOptionalString(config.apiKey)
    || normalizeOptionalString(config.apiKeyEnv)
    || normalizeOptionalString(config.baseURL)
    || normalizeOptionalString(config.model),
  );

  if (normalizeOptionalString(config.apiKey)) {
    return config.apiKey;
  }

  if (normalizeOptionalString(config.apiKeyEnv) && normalizeOptionalString(process.env[config.apiKeyEnv])) {
    return process.env[config.apiKeyEnv].trim();
  }

  if (hasExplicitImageModelCredentials) {
    return '';
  }

  if (normalizeOptionalString(fallbackConfig.apiKey)) {
    return fallbackConfig.apiKey;
  }

  if (normalizeOptionalString(fallbackConfig.apiKeyEnv) && normalizeOptionalString(process.env[fallbackConfig.apiKeyEnv])) {
    return process.env[fallbackConfig.apiKeyEnv].trim();
  }

  return '';
}

function resolveEffectiveConfig(config = {}, fallbackConfig = {}) {
  const normalized = normalizeImageModelConfig(config);
  const fallback = normalizeImageModelConfig(fallbackConfig);

  return {
    enabled: normalized.enabled !== false,
    model: normalized.model || fallback.model,
    baseURL: normalized.baseURL || fallback.baseURL,
    apiKeyEnv: normalized.apiKeyEnv || fallback.apiKeyEnv,
    apiKey: resolveApiKey(normalized, fallback),
    timeoutMs: Number.isFinite(normalized.timeoutMs)
      ? normalized.timeoutMs
      : fallback.timeoutMs,
    prompt: normalized.prompt || fallback.prompt || DEFAULT_IMAGE_INSPECTION_PROMPT,
    handlerModule: normalized.handlerModule,
    thinking: normalized.thinking || fallback.thinking || null,
  };
}

function isInspectableImage(attachment) {
  return String(attachment?.mimeType || '').startsWith('image/');
}

function toChatMessageContentText(text) {
  if (typeof text === 'string') {
    return text.trim();
  }

  if (Array.isArray(text)) {
    return text
      .map(item => {
        if (typeof item === 'string') {
          return item;
        }

        if (item && typeof item === 'object' && typeof item.text === 'string') {
          return item.text;
        }

        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return '';
}

async function inspectImageViaHttp(attachment, effectiveConfig) {
  if (!effectiveConfig.model) {
    throw new Error('Image inspection model is not configured.');
  }

  if (!effectiveConfig.baseURL) {
    throw new Error('Image inspection baseURL is not configured.');
  }

  if (!effectiveConfig.apiKey) {
    throw new Error('Image inspection API key is not configured.');
  }

  const imageBuffer = await fs.readFile(attachment.resolvedPath);
  const mimeType = attachment.mimeType || 'image/png';
  const imageUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
  const body = {
    model: effectiveConfig.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: effectiveConfig.prompt || DEFAULT_IMAGE_INSPECTION_PROMPT },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    }],
  };
  const extraBody = buildThinkingExtraBody(effectiveConfig.thinking, {
    includeStandardized: true,
    includeImplicitExtraBody: false,
  });

  if (extraBody) {
    Object.assign(body, extraBody);
  }

  const baseURL = effectiveConfig.baseURL.replace(/\/+$/, '');
  const timeoutMs = Number.isFinite(effectiveConfig.timeoutMs)
    ? effectiveConfig.timeoutMs
    : DEFAULT_IMAGE_INSPECTION_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Image inspection timed out after ${timeoutMs}ms.`));
  }, timeoutMs);
  let response;

  try {
    response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${effectiveConfig.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Image inspection timed out after ${timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Image inspection request failed (${response.status}): ${errorText || response.statusText}`);
  }

  const payload = await response.json();
  const text = toChatMessageContentText(payload?.choices?.[0]?.message?.content);

  if (!text) {
    throw new Error('Image inspection returned no content.');
  }

  return {
    model: effectiveConfig.model,
    text,
  };
}

function createImageInspector(config = {}, fallbackConfig = {}) {
  const normalizedConfig = normalizeImageModelConfig(config);
  const handlerModule = normalizedConfig.handlerModule
    ? require(path.resolve(normalizedConfig.handlerModule))
    : null;

  async function inspect(attachment) {
    const effectiveConfig = resolveEffectiveConfig(normalizedConfig, fallbackConfig);

    if (!effectiveConfig.enabled) {
      throw new Error('Image inspection is disabled.');
    }

    if (!isInspectableImage(attachment)) {
      throw new Error('Attachment is not an image.');
    }

    if (handlerModule) {
      const result = await handlerModule({
        attachment,
        attachmentPath: attachment.resolvedPath,
        config: effectiveConfig,
      });
      const text = typeof result === 'string'
        ? result.trim()
        : normalizeOptionalString(result?.text || result?.content);

      if (!text) {
        throw new Error('Image inspection handler returned no content.');
      }

      return {
        model: normalizeOptionalString(result?.model) || effectiveConfig.model,
        text,
      };
    }

    return inspectImageViaHttp(attachment, effectiveConfig);
  }

  return {
    canInspect: attachment => normalizedConfig.enabled !== false && isInspectableImage(attachment),
    inspect,
  };
}

module.exports = {
  createImageInspector,
  DEFAULT_IMAGE_INSPECTION_TIMEOUT_MS,
  DEFAULT_IMAGE_INSPECTION_PROMPT,
  normalizeImageModelConfig,
};
