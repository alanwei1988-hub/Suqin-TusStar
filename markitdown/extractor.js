const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function replaceArgPlaceholders(value, attachmentPath) {
  return String(value).replaceAll('{input}', attachmentPath);
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8',
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
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

function createMarkItDownExtractor(config = {}) {
  const enabled = config?.enabled === true;
  const supportedExtensions = new Set((config?.supportedExtensions || []).map(value => String(value).toLowerCase()));
  const cache = new Map();
  const handlerModule = typeof config.handlerModule === 'string' && config.handlerModule.trim().length > 0
    ? require(config.handlerModule)
    : null;

  function canExtract(attachment) {
    return enabled && supportedExtensions.has(String(attachment?.extension || '').toLowerCase());
  }

  async function extract(attachment) {
    const cacheKey = path.normalize(attachment.resolvedPath);

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const promise = (async () => {
      if (!canExtract(attachment)) {
        throw new Error(`MarkItDown is not configured for ${attachment.extension || 'this file type'}.`);
      }

      if (handlerModule) {
        const converted = await handlerModule({
          attachment,
          attachmentPath: attachment.resolvedPath,
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
        };
      }

      const command = config.command || 'python';
      if (path.isAbsolute(command) && !fs.existsSync(command)) {
        throw new Error(`Bundled MarkItDown runtime is missing at ${command}. Run npm install or npm run markitdown:install.`);
      }
      const configuredArgs = Array.isArray(config.args) ? config.args : ['-m', 'markitdown', '{input}'];
      const args = configuredArgs.map(arg => replaceArgPlaceholders(arg, attachment.resolvedPath));

      if (!configuredArgs.some(arg => typeof arg === 'string' && arg.includes('{input}'))) {
        args.push(attachment.resolvedPath);
      }

      const result = await runCommand(command, args, config.timeoutMs || 30000);
      const markdown = String(result.stdout || '').trim();

      if (!markdown) {
        throw new Error(`MarkItDown returned no content for ${attachment.name}.`);
      }

      return {
        method: 'markitdown',
        markdown: markdown.slice(0, config.maxOutputChars || 24000),
        truncated: markdown.length > (config.maxOutputChars || 24000),
      };
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
  };
}

module.exports = {
  createMarkItDownExtractor,
};
