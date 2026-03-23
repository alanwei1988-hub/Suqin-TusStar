const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { getDefaultBaseURLForLlmClient } = require('./llm');
const { AttachmentExtractionCache, hashString } = require('./cache');

function replaceArgPlaceholders(value, replacements) {
  let output = String(value);

  for (const [key, replacement] of Object.entries(replacements || {})) {
    output = output.replaceAll(`{${key}}`, replacement == null ? '' : String(replacement));
  }

  return output;
}

function createCommandEnv(config = {}) {
  const env = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  };
  const llmConfig = config && typeof config.llm === 'object' && !Array.isArray(config.llm)
    ? config.llm
    : {};
  const isolatedOpenAIEnv = Boolean(
    (typeof llmConfig.apiKeyEnv === 'string' && llmConfig.apiKeyEnv.trim().length > 0)
    || (typeof llmConfig.baseURL === 'string' && llmConfig.baseURL.trim().length > 0)
  );

  if (isolatedOpenAIEnv) {
    delete env.OPENAI_API_KEY;
    delete env.OPENAI_BASE_URL;
  }

  if (typeof llmConfig.apiKeyEnv === 'string' && llmConfig.apiKeyEnv.trim().length > 0) {
    const envName = llmConfig.apiKeyEnv.trim();
    const apiKey = process.env[envName];

    if (!apiKey) {
      throw new Error(`MarkItDown OCR API key env "${envName}" is not set.`);
    }

    env.OPENAI_API_KEY = apiKey;
  }

  if (typeof llmConfig.baseURL === 'string' && llmConfig.baseURL.trim().length > 0) {
    env.OPENAI_BASE_URL = llmConfig.baseURL.trim();
  } else {
    const defaultBaseURL = getDefaultBaseURLForLlmClient(llmConfig.client);
    if (defaultBaseURL) {
      env.OPENAI_BASE_URL = defaultBaseURL;
    }
  }

  return env;
}

function runCommand(command, args, timeoutMs, envOverrides) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8',
        env: envOverrides,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message || `Command failed: ${command}`));
          return;
        }

        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
        });
      },
    );
  });
}

function getHandlerModuleVersion(handlerModulePath) {
  if (!handlerModulePath) {
    return '';
  }

  try {
    const stat = fs.statSync(handlerModulePath);
    return `${path.resolve(handlerModulePath)}::${stat.size}::${stat.mtimeMs}`;
  } catch {
    return path.resolve(handlerModulePath);
  }
}

function buildExtractorKey(config = {}) {
  const llmConfig = config && typeof config.llm === 'object' && !Array.isArray(config.llm)
    ? config.llm
    : {};
  const fallbackLlmConfig = config && typeof config.fallbackLlm === 'object' && !Array.isArray(config.fallbackLlm)
    ? config.fallbackLlm
    : {};

  return hashString(JSON.stringify({
    handlerModule: getHandlerModuleVersion(config.handlerModule),
    command: config.command || 'python',
    args: Array.isArray(config.args) ? config.args : ['-m', 'markitdown', '{input}'],
    timeoutMs: config.timeoutMs || 30000,
    maxOutputChars: config.maxOutputChars || 24000,
    ocrConcurrency: config.ocrConcurrency || 1,
    ocrPageGroupSize: config.ocrPageGroupSize || 1,
    llmClient: llmConfig.client || '',
    llmModel: llmConfig.model || '',
    llmBaseURL: llmConfig.baseURL || '',
    llmPrompt: llmConfig.prompt || '',
    fallbackLlmClient: fallbackLlmConfig.client || '',
    fallbackLlmModel: fallbackLlmConfig.model || '',
    fallbackLlmBaseURL: fallbackLlmConfig.baseURL || '',
    fallbackLlmPrompt: fallbackLlmConfig.prompt || '',
  }));
}

function createExtractionError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function classifyExtractionFailure(error, attempt = {}) {
  if (typeof error?.code === 'string' && error.code.trim().length > 0) {
    return {
      code: error.code.trim(),
      userMessage: typeof error?.userMessage === 'string' && error.userMessage.trim().length > 0
        ? error.userMessage.trim()
        : 'OCR 模型调用失败，未能提取附件文本。',
      rawMessage: typeof error?.rawMessage === 'string' && error.rawMessage.trim().length > 0
        ? error.rawMessage.trim()
        : String(error?.message || 'Unknown MarkItDown extraction error.'),
      canRetryWithFallback: error?.canRetryWithFallback !== false,
      profileName: error?.primaryProfile || attempt.profileName || '',
      fallbackProfileName: error?.fallbackProfile || attempt.fallbackProfileName || '',
    };
  }

  const rawMessage = String(error?.message || error || 'Unknown MarkItDown extraction error.');
  const normalized = rawMessage.toLowerCase();

  let code = 'ocr_request_failed';
  let userMessage = 'OCR 模型调用失败，未能提取附件文本。';
  let canRetryWithFallback = true;

  if (
    normalized.includes('data_inspection_failed')
    || normalized.includes('datainspectionfailed')
    || normalized.includes('inappropriate content')
  ) {
    code = 'ocr_safety_review_blocked';
    userMessage = 'OCR 模型触发了安全审查，当前模型无法继续提取该附件内容。';
  } else if (normalized.includes('api key env') || normalized.includes('is not set')) {
    code = 'ocr_configuration_error';
    userMessage = 'OCR 提取配置不完整，当前 OCR 模型不可用。';
    canRetryWithFallback = false;
  } else if (normalized.includes('timed out') || normalized.includes('timeout')) {
    code = 'ocr_timeout';
    userMessage = 'OCR 模型调用超时，当前未能完成文本提取。';
  } else if (normalized.includes('returned no content')) {
    code = 'ocr_empty_result';
    userMessage = 'OCR 模型没有返回可用文本。';
  } else if (
    normalized.includes('badrequesterror')
    || normalized.includes('/chat/completions')
    || normalized.includes('internalerror')
    || normalized.includes('openai.')
    || normalized.includes('http')
  ) {
    code = 'ocr_request_failed';
    userMessage = 'OCR 模型请求失败，当前未能提取附件文本。';
  } else if (
    normalized.includes('bundled markitdown runtime is missing')
    || normalized.includes('markitdown is not configured')
  ) {
    code = 'ocr_runtime_unavailable';
    userMessage = 'OCR 提取运行环境不可用，当前无法处理该附件。';
    canRetryWithFallback = false;
  }

  return {
    code,
    userMessage,
    rawMessage,
    canRetryWithFallback,
    profileName: attempt.profileName || '',
    fallbackProfileName: attempt.fallbackProfileName || '',
  };
}

function createMarkItDownExtractor(config = {}) {
  const enabled = config?.enabled === true;
  const supportedExtensions = new Set((config?.supportedExtensions || []).map(value => String(value).toLowerCase()));
  const cache = new Map();
  const handlerModule = typeof config.handlerModule === 'string' && config.handlerModule.trim().length > 0
    ? require(config.handlerModule)
    : null;
  const persistentCache = new AttachmentExtractionCache({
    enabled,
    ...(config.cache || {}),
    extractorKey: buildExtractorKey(config),
  });

  function canExtract(attachment) {
    return enabled && supportedExtensions.has(String(attachment?.extension || '').toLowerCase());
  }

  async function extract(attachment, options = {}) {
    const pageStart = Number.isFinite(options?.pageStart) ? Math.max(1, Math.trunc(options.pageStart)) : 1;
    const pageCount = Number.isFinite(options?.pageCount) ? Math.max(1, Math.trunc(options.pageCount)) : 0;
    const cacheKey = `${path.normalize(attachment.resolvedPath)}::${pageStart}::${pageCount || 'all'}`;

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const promise = (async () => {
      if (!canExtract(attachment)) {
        throw new Error(`MarkItDown is not configured for ${attachment.extension || 'this file type'}.`);
      }

      const cached = await persistentCache.get(attachment, {
        pageStart,
        pageCount,
      });

      if (cached) {
        return {
          method: 'markitdown',
          markdown: cached.markdown,
          truncated: cached.truncated,
          pageStart: cached.pageStart,
          pageCount: cached.pageCount,
        };
      }

      async function runSingleAttempt(attemptConfig, profileName) {
        if (handlerModule) {
          const converted = await handlerModule({
            attachment,
            attachmentPath: attachment.resolvedPath,
            llm: attemptConfig,
            profileName,
            options: {
              pageStart,
              pageCount,
            },
          });
          const markdown = typeof converted === 'string'
            ? converted
            : String(converted?.markdown || '');

          if (!markdown.trim()) {
            throw new Error(`MarkItDown handler returned no content for ${attachment.name}.`);
          }

          return {
            method: 'markitdown',
            markdown: markdown.slice(0, config.maxOutputChars || 24000),
            truncated: markdown.length > (config.maxOutputChars || 24000),
            pageStart,
            pageCount,
            profileName,
          };
        }

        const command = config.command || 'python';
        if (path.isAbsolute(command) && !fs.existsSync(command)) {
          throw new Error(`Bundled MarkItDown runtime is missing at ${command}. Run npm install or npm run markitdown:install.`);
        }
        const configuredArgs = Array.isArray(config.args) ? config.args : ['-m', 'markitdown', '{input}'];
        const args = configuredArgs.map(arg => replaceArgPlaceholders(arg, {
          input: attachment.resolvedPath,
          llmClient: attemptConfig?.client || '',
          llmModel: attemptConfig?.model || '',
          llmBaseURL: attemptConfig?.baseURL || '',
          llmPrompt: attemptConfig?.prompt || '',
          pageStart,
          pageCount,
          ocrConcurrency: config?.ocrConcurrency || 1,
          ocrPageGroupSize: config?.ocrPageGroupSize || 1,
        }));

        if (!configuredArgs.some(arg => typeof arg === 'string' && arg.includes('{input}'))) {
          args.push(attachment.resolvedPath);
        }

        const result = await runCommand(command, args, config.timeoutMs || 30000, createCommandEnv({
          ...config,
          llm: attemptConfig,
        }));
        const markdown = String(result.stdout || '').trim();

        if (!markdown) {
          throw new Error(`MarkItDown returned no content for ${attachment.name}.`);
        }

        return {
          method: 'markitdown',
          markdown: markdown.slice(0, config.maxOutputChars || 24000),
          truncated: markdown.length > (config.maxOutputChars || 24000),
          pageStart,
          pageCount,
          profileName,
        };
      }

      const primaryProfileName = config.activeLlmProfile || 'default';
      const fallbackProfileName = config.fallbackLlmProfile || '';
      const fallbackLlmConfig = config && typeof config.fallbackLlm === 'object' && !Array.isArray(config.fallbackLlm)
        ? config.fallbackLlm
        : null;

      try {
        const primaryResult = await runSingleAttempt(config?.llm || {}, primaryProfileName);
        await persistentCache.set(attachment, {
          pageStart,
          pageCount,
        }, primaryResult);

        return primaryResult;
      } catch (primaryError) {
        const failure = classifyExtractionFailure(primaryError, {
          profileName: primaryProfileName,
          fallbackProfileName,
        });

        const canUseFallback = Boolean(
          fallbackLlmConfig
          && fallbackProfileName
          && fallbackProfileName !== primaryProfileName
          && failure.canRetryWithFallback
        );

        if (!canUseFallback) {
          throw createExtractionError(failure.rawMessage, {
            code: failure.code,
            userMessage: failure.userMessage,
            primaryProfile: primaryProfileName,
            fallbackProfile: fallbackProfileName || null,
            fallbackAttempted: false,
            rawMessage: failure.rawMessage,
          });
        }

        try {
          const fallbackResult = await runSingleAttempt(fallbackLlmConfig, fallbackProfileName);
          await persistentCache.set(attachment, {
            pageStart,
            pageCount,
          }, fallbackResult);

          return {
            ...fallbackResult,
            fallbackUsed: true,
            primaryProfile: primaryProfileName,
          };
        } catch (fallbackError) {
          const fallbackFailure = classifyExtractionFailure(fallbackError, {
            profileName: fallbackProfileName,
            fallbackProfileName,
          });
          throw createExtractionError(fallbackFailure.rawMessage, {
            code: failure.code,
            userMessage: `${failure.userMessage} 已尝试回退到 OCR profile "${fallbackProfileName}"，但仍然失败。`,
            primaryProfile: primaryProfileName,
            fallbackProfile: fallbackProfileName,
            fallbackAttempted: true,
            fallbackErrorCode: fallbackFailure.code,
            rawMessage: `${failure.rawMessage}\n\nFallback "${fallbackProfileName}" failed: ${fallbackFailure.rawMessage}`,
          });
        }
      }
    })();

    cache.set(cacheKey, promise);

    try {
      return await promise;
    } catch (error) {
      cache.delete(cacheKey);
      throw error;
    }
  }

  return {
    enabled,
    canExtract,
    extract,
    close: () => persistentCache.close(),
  };
}

module.exports = {
  createExtractionError,
  createCommandEnv,
  createMarkItDownExtractor,
  replaceArgPlaceholders,
};
