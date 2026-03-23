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
  }));
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

      if (handlerModule) {
        const converted = await handlerModule({
          attachment,
          attachmentPath: attachment.resolvedPath,
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

        const result = {
          method: 'markitdown',
          markdown: markdown.slice(0, config.maxOutputChars || 24000),
          truncated: markdown.length > (config.maxOutputChars || 24000),
          pageStart,
          pageCount,
        };

        await persistentCache.set(attachment, {
          pageStart,
          pageCount,
        }, result);

        return result;
      }

      const command = config.command || 'python';
      if (path.isAbsolute(command) && !fs.existsSync(command)) {
        throw new Error(`Bundled MarkItDown runtime is missing at ${command}. Run npm install or npm run markitdown:install.`);
      }
      const configuredArgs = Array.isArray(config.args) ? config.args : ['-m', 'markitdown', '{input}'];
      const args = configuredArgs.map(arg => replaceArgPlaceholders(arg, {
        input: attachment.resolvedPath,
        llmClient: config?.llm?.client || '',
        llmModel: config?.llm?.model || '',
        llmBaseURL: config?.llm?.baseURL || '',
        llmPrompt: config?.llm?.prompt || '',
        pageStart,
        pageCount,
        ocrConcurrency: config?.ocrConcurrency || 1,
        ocrPageGroupSize: config?.ocrPageGroupSize || 1,
      }));

      if (!configuredArgs.some(arg => typeof arg === 'string' && arg.includes('{input}'))) {
        args.push(attachment.resolvedPath);
      }

      const result = await runCommand(command, args, config.timeoutMs || 30000, createCommandEnv(config));
      const markdown = String(result.stdout || '').trim();

      if (!markdown) {
        throw new Error(`MarkItDown returned no content for ${attachment.name}.`);
      }

      const normalized = {
        method: 'markitdown',
        markdown: markdown.slice(0, config.maxOutputChars || 24000),
        truncated: markdown.length > (config.maxOutputChars || 24000),
        pageStart,
        pageCount,
      };

      await persistentCache.set(attachment, {
        pageStart,
        pageCount,
      }, normalized);

      return normalized;
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
  createCommandEnv,
  createMarkItDownExtractor,
  replaceArgPlaceholders,
};
