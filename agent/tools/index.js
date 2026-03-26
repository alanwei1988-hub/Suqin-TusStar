const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { TextDecoder } = require('util');
const { tool } = require('ai');
const { z } = require('zod');
const {
  MAX_LOCAL_TEXT_CHARS,
  assertReadableLocalTextFile,
  buildAttachmentsPrompt,
  createAttachmentTools,
  normalizeAttachments,
} = require('./attachments');
const { createToolDisplayInfo } = require('./display');
const { buildMcpPrompt, createMcpToolkit } = require('./mcp');
const { buildSkillsPrompt, createSkillsToolkit } = require('./skills');

const MAX_BASH_OUTPUT_LENGTH = 20000;
const DEFAULT_BASH_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BASH_TIMEOUT_MS = 300000;
const MAX_SCRIPT_FILE_COUNT = 500;
const MAX_SCRIPT_TOTAL_BYTES = 50 * 1024 * 1024;
const SCRIPT_VIRTUAL_ROOT = '/workspace';
let bashToolModulePromise;
let justBashModulePromise;

const BLOCKED_COMMAND_RULES = [
  {
    pattern: /\bgit\s+reset\s+--hard\b/i,
    reason: 'Refusing to discard changes with git reset --hard.',
  },
  {
    pattern: /\bgit\s+clean\b[\s\S]*\b-f\b/i,
    reason: 'Refusing to run git clean with force flags.',
  },
  {
    pattern: /\brm\s+-rf\s+(\/|~|[a-zA-Z]:\\)\b/i,
    reason: 'Refusing to delete a filesystem root.',
  },
  {
    pattern: /\b(remove-item|ri)\b[\s\S]*\b(-recurse|\/s)\b[\s\S]*([a-zA-Z]:\\|\/)/i,
    reason: 'Refusing to recursively delete an absolute root path.',
  },
  {
    pattern: /\b(del|erase)\b[\s\S]*\b\/[spqf]+\b[\s\S]*[a-zA-Z]:\\/i,
    reason: 'Refusing to run a destructive absolute delete command.',
  },
  {
    pattern: /(^|[\s;|&])(?:format(?:\.com|\.exe)?|mkfs|diskpart|shutdown|reboot|format-volume)(?=$|[\s/])/i,
    reason: 'Refusing to run a destructive system command.',
  },
];

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function getBlockedCommandReason(command) {
  for (const rule of BLOCKED_COMMAND_RULES) {
    if (rule.pattern.test(command)) {
      return rule.reason;
    }
  }

  return null;
}

function truncateText(value, maxLength, label) {
  if (value.length <= maxLength) {
    return value;
  }

  const removedLength = value.length - maxLength;
  return `${value.slice(0, maxLength)}\n\n[${label} truncated: ${removedLength} characters removed]`;
}

function resolveRequestedPath(baseDir, requestedPath) {
  if (!requestedPath || typeof requestedPath !== 'string') {
    throw new Error('Path is required.');
  }

  return path.isAbsolute(requestedPath)
    ? path.normalize(requestedPath)
    : path.resolve(baseDir, requestedPath);
}

function isPathInside(baseDir, candidatePath) {
  const relativePath = path.relative(path.resolve(baseDir), path.resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function resolveWorkspacePath(baseDir, requestedPath) {
  const resolvedPath = resolveRequestedPath(baseDir, requestedPath);

  if (!isPathInside(baseDir, resolvedPath)) {
    throw new Error(`Path escapes the user workspace: ${requestedPath}`);
  }

  return resolvedPath;
}

function resolveReadablePath(workspaceDir, sharedReadRoots, requestedPath) {
  const resolvedPath = resolveRequestedPath(workspaceDir, requestedPath);

  if (isPathInside(workspaceDir, resolvedPath)) {
    return resolvedPath;
  }

  for (const rootDir of sharedReadRoots || []) {
    if (isPathInside(rootDir, resolvedPath)) {
      return resolvedPath;
    }
  }

  throw new Error(`Path is outside the readable roots: ${requestedPath}`);
}

async function loadBashToolModule() {
  bashToolModulePromise ||= import('bash-tool');
  return bashToolModulePromise;
}

async function loadJustBashModule() {
  justBashModulePromise ||= import('just-bash');
  return justBashModulePromise;
}

function wrapWindowsPowerShellCommand(command) {
  return [
    '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    'chcp.com 65001 > $null',
    command,
  ].join('\n');
}

function decodeShellOutput(output) {
  if (!output) {
    return '';
  }

  if (typeof output === 'string') {
    return output;
  }

  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output);

  if (buffer.length === 0) {
    return '';
  }

  if (buffer.includes(0)) {
    return new TextDecoder('utf-16le').decode(buffer);
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (_error) {
    try {
      return new TextDecoder('gb18030').decode(buffer);
    } catch (_fallbackError) {
      return buffer.toString('utf8');
    }
  }
}

function runShellCommand(command, cwd, timeoutMs = DEFAULT_BASH_TIMEOUT_MS) {
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'powershell.exe' : '/bin/sh';
  const args = isWindows
    ? ['-NoProfile', '-NonInteractive', '-Command', wrapWindowsPowerShellCommand(command)]
    : ['-lc', command];

  return new Promise(resolve => {
    execFile(
      shell,
      args,
      {
        cwd,
        encoding: 'buffer',
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        const decodedStdout = decodeShellOutput(stdout);
        const decodedStderr = decodeShellOutput(stderr);
        const timedOut = Boolean(error && !Number.isFinite(error.code) && /timed out/i.test(String(error.message || '')));

        resolve({
          stdout: decodedStdout,
          stderr: timedOut
            ? `Command timed out after ${timeoutMs}ms.`
            : (decodedStderr || error?.message || ''),
          exitCode: typeof error?.code === 'number'
            ? error.code
            : (timedOut ? 124 : 0),
          timedOut,
        });
      },
    );
  });
}

class LocalWorkspaceBackend {
  constructor(workingDir, options = {}) {
    this.workingDir = path.resolve(workingDir);
    this.sharedReadRoots = Array.isArray(options.sharedReadRoots)
      ? options.sharedReadRoots.map(rootDir => path.resolve(rootDir))
      : [];
    this.outboundAttachments = [];
  }

  async readFile(filePath) {
    const resolvedPath = resolveReadablePath(this.workingDir, this.sharedReadRoots, filePath);
    return fs.readFile(resolvedPath, 'utf8');
  }

  async writeFile(filePath, content) {
    const resolvedPath = resolveWorkspacePath(this.workingDir, filePath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, content);
    return resolvedPath;
  }

  async registerOutboundAttachment(filePath, displayName) {
    const resolvedPath = resolveReadablePath(this.workingDir, this.sharedReadRoots, filePath);
    const stat = await fs.stat(resolvedPath);

    if (!stat.isFile()) {
      throw new Error(`Not a file: ${resolvedPath}`);
    }

    const name = typeof displayName === 'string' && displayName.trim().length > 0
      ? displayName.trim()
      : path.basename(resolvedPath);
    const identityKey = `${resolvedPath}::${name}`;
    const existing = this.outboundAttachments.find(item => item.identityKey === identityKey);

    if (existing) {
      return {
        path: existing.path,
        name: existing.name,
        sizeBytes: existing.sizeBytes,
      };
    }

    const record = {
      identityKey,
      path: resolvedPath,
      name,
      sizeBytes: stat.size,
    };
    this.outboundAttachments.push(record);

    return {
      path: record.path,
      name: record.name,
      sizeBytes: record.sizeBytes,
    };
  }

  getOutboundAttachments() {
    return this.outboundAttachments.map(({ path: filePath, name, sizeBytes }) => ({
      path: filePath,
      name,
      sizeBytes,
    }));
  }
}

function mergeToolSets(toolSets) {
  const merged = {};

  for (const toolSet of toolSets) {
    for (const [toolName, toolDef] of Object.entries(toolSet || {})) {
      if (merged[toolName]) {
        throw new Error(`Duplicate tool name detected: ${toolName}`);
      }

      merged[toolName] = toolDef;
    }
  }

  return merged;
}

function buildBashToolPrompt(workspaceDir) {
  const promptLines = [
    'Use the bash tool inside the sandboxed per-user workspace.',
    `Workspace root: ${toPosixPath(path.resolve(workspaceDir))}`,
    '- Commands run in an isolated bash sandbox, not on the host machine shell.',
    '- The sandbox only mirrors this user workspace and cannot reach the shared host filesystem.',
    '- Prefer `rg` for fast file and text search when available.',
    '- Use shell commands for directory listing, script execution, builds, tests, file operations, and system inspection.',
    '- Any files written by bash stay inside the sandbox for this run only.',
    '- If you need a persistent file that `readFile`, `writeFile`, or `sendFile` can see, use `writeFile` instead of shell redirection.',
    '- If a needed host file is outside the workspace, use `stageHostPath` to copy it into a dedicated subdirectory under the workspace before processing it.',
    '- Use `runPython` or `runJavaScript` for restricted code execution against files already staged inside the workspace.',
    '- Avoid destructive commands even inside the sandbox unless they are truly necessary.',
  ];

  return promptLines.join('\n');
}

function createBashTool(machine, workspaceDir) {
  return tool({
    description: buildBashToolPrompt(workspaceDir),
    inputSchema: z.object({
      command: z.string().describe('The shell command to execute on the local machine'),
      timeoutMs: z.number().int().positive().optional().describe('Optional command timeout in milliseconds'),
    }),
    execute: async ({ command, timeoutMs }) => {
      const result = await machine.executeCommand(command, timeoutMs);

      return {
        ...result,
        stdout: truncateText(result.stdout, MAX_BASH_OUTPUT_LENGTH, 'stdout'),
        stderr: truncateText(result.stderr, MAX_BASH_OUTPUT_LENGTH, 'stderr'),
      };
    },
  });
}

async function createSandboxedBashTool(workspaceDir) {
  const { createBashTool: createSdkBashTool } = await loadBashToolModule();
  const toolkit = await createSdkBashTool({
    uploadDirectory: {
      source: workspaceDir,
    },
    extraInstructions: buildBashToolPrompt(workspaceDir),
    onBeforeBashCall: ({ command }) => {
      const blockedReason = getBlockedCommandReason(command);

      if (blockedReason) {
        throw new Error(blockedReason);
      }

      return undefined;
    },
    maxOutputLength: MAX_BASH_OUTPUT_LENGTH,
  });

  return {
    tool: toolkit.bash,
    close: async () => {
      if (typeof toolkit.sandbox?.stop === 'function') {
        await toolkit.sandbox.stop();
      }
    },
  };
}

async function pathExists(candidatePath) {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function copyPathRecursive(sourcePath, destinationPath, options = {}) {
  const sourceStat = await fs.stat(sourcePath);

  if (sourceStat.isDirectory()) {
    await fs.mkdir(destinationPath, { recursive: true });
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    let fileCount = 0;

    for (const entry of entries) {
      const nestedSource = path.join(sourcePath, entry.name);
      const nestedDestination = path.join(destinationPath, entry.name);
      const nestedResult = await copyPathRecursive(nestedSource, nestedDestination, options);
      fileCount += nestedResult.fileCount;
    }

    return {
      fileCount,
      directory: true,
    };
  }

  if (!options.overwrite && await pathExists(destinationPath)) {
    throw new Error(`Destination already exists: ${destinationPath}`);
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
  return {
    fileCount: 1,
    directory: false,
  };
}

function normalizeWorkspaceRelativePath(workspaceDir, requestedPath) {
  const resolvedPath = resolveWorkspacePath(workspaceDir, requestedPath);
  const relativePath = path.relative(workspaceDir, resolvedPath);
  return relativePath ? relativePath.split(path.sep).join(path.posix.sep) : '';
}

async function snapshotHostDirectory(hostDir) {
  const initialFiles = {};
  const initialBuffers = new Map();
  let totalBytes = 0;
  let fileCount = 0;

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(hostDir, absolutePath).split(path.sep).join(path.posix.sep);

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const buffer = await fs.readFile(absolutePath);
      fileCount += 1;
      totalBytes += buffer.length;

      if (fileCount > MAX_SCRIPT_FILE_COUNT) {
        throw new Error(`Script workspace has too many files (${fileCount}). Limit: ${MAX_SCRIPT_FILE_COUNT}.`);
      }

      if (totalBytes > MAX_SCRIPT_TOTAL_BYTES) {
        throw new Error(`Script workspace is too large (${totalBytes} bytes). Limit: ${MAX_SCRIPT_TOTAL_BYTES} bytes.`);
      }

      const virtualPath = path.posix.join(SCRIPT_VIRTUAL_ROOT, relativePath);
      initialFiles[virtualPath] = buffer;
      initialBuffers.set(relativePath, buffer);
    }
  }

  if (await pathExists(hostDir)) {
    await walk(hostDir);
  }

  return {
    initialFiles,
    initialBuffers,
  };
}

function buffersEqual(left, right) {
  if (!left || !right) {
    return false;
  }

  return Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
}

async function syncVirtualWorkspaceToHost(virtualFs, hostDir, initialBuffers, excludedVirtualPaths = new Set()) {
  const changedFiles = [];
  const seenRelativePaths = new Set();
  const allPaths = typeof virtualFs.getAllPaths === 'function' ? virtualFs.getAllPaths() : [];

  for (const virtualPath of allPaths) {
    if (!virtualPath.startsWith(`${SCRIPT_VIRTUAL_ROOT}/`) || excludedVirtualPaths.has(virtualPath)) {
      continue;
    }

    const stat = await virtualFs.stat(virtualPath);
    if (!stat.isFile) {
      continue;
    }

    const relativePath = path.posix.relative(SCRIPT_VIRTUAL_ROOT, virtualPath);
    seenRelativePaths.add(relativePath);
    const buffer = Buffer.from(await virtualFs.readFileBuffer(virtualPath));
    const initialBuffer = initialBuffers.get(relativePath);

    if (initialBuffer && buffersEqual(buffer, initialBuffer)) {
      continue;
    }

    const hostPath = path.join(hostDir, relativePath.split(path.posix.sep).join(path.sep));
    await fs.mkdir(path.dirname(hostPath), { recursive: true });
    await fs.writeFile(hostPath, buffer);
    changedFiles.push(hostPath);
  }

  for (const [relativePath] of initialBuffers.entries()) {
    if (seenRelativePaths.has(relativePath)) {
      continue;
    }

    const hostPath = path.join(hostDir, relativePath.split(path.posix.sep).join(path.sep));
    if (await pathExists(hostPath)) {
      await fs.rm(hostPath, { force: true });
      changedFiles.push(hostPath);
    }
  }

  return changedFiles;
}

function createJavaScriptConsole() {
  const state = {
    stdout: '',
    stderr: '',
  };

  const appendLine = (target, formatter, args) => {
    state[target] += `${formatter(...args)}\n`;
  };

  return {
    console: {
      log: (...args) => appendLine('stdout', require('util').format, args),
      info: (...args) => appendLine('stdout', require('util').format, args),
      warn: (...args) => appendLine('stderr', require('util').format, args),
      error: (...args) => appendLine('stderr', require('util').format, args),
    },
    state,
  };
}

function createSafeWorkspaceFs(workspaceDir, currentDir) {
  const resolveWorkspaceTarget = requestedPath => {
    const candidatePath = path.isAbsolute(requestedPath)
      ? path.resolve(workspaceDir, requestedPath.slice(1))
      : path.resolve(currentDir, requestedPath);

    if (!isPathInside(workspaceDir, candidatePath)) {
      throw new Error(`Path escapes the workspace: ${requestedPath}`);
    }

    return candidatePath;
  };

  return {
    readFileSync(filePath, encoding = null) {
      return require('fs').readFileSync(resolveWorkspaceTarget(filePath), encoding || undefined);
    },
    writeFileSync(filePath, content, options) {
      const resolvedPath = resolveWorkspaceTarget(filePath);
      require('fs').mkdirSync(path.dirname(resolvedPath), { recursive: true });
      return require('fs').writeFileSync(resolvedPath, content, options);
    },
    appendFileSync(filePath, content, options) {
      const resolvedPath = resolveWorkspaceTarget(filePath);
      require('fs').mkdirSync(path.dirname(resolvedPath), { recursive: true });
      return require('fs').appendFileSync(resolvedPath, content, options);
    },
    readdirSync(dirPath, options) {
      return require('fs').readdirSync(resolveWorkspaceTarget(dirPath), options);
    },
    mkdirSync(dirPath, options) {
      return require('fs').mkdirSync(resolveWorkspaceTarget(dirPath), options);
    },
    rmSync(targetPath, options) {
      return require('fs').rmSync(resolveWorkspaceTarget(targetPath), options);
    },
    existsSync(targetPath) {
      return require('fs').existsSync(resolveWorkspaceTarget(targetPath));
    },
    statSync(targetPath) {
      return require('fs').statSync(resolveWorkspaceTarget(targetPath));
    },
    promises: {
      readFile: async (filePath, encoding = null) => require('fs').promises.readFile(resolveWorkspaceTarget(filePath), encoding || undefined),
      writeFile: async (filePath, content, options) => {
        const resolvedPath = resolveWorkspaceTarget(filePath);
        await require('fs').promises.mkdir(path.dirname(resolvedPath), { recursive: true });
        return require('fs').promises.writeFile(resolvedPath, content, options);
      },
      mkdir: async (dirPath, options) => require('fs').promises.mkdir(resolveWorkspaceTarget(dirPath), options),
      readdir: async (dirPath, options) => require('fs').promises.readdir(resolveWorkspaceTarget(dirPath), options),
      rm: async (targetPath, options) => require('fs').promises.rm(resolveWorkspaceTarget(targetPath), options),
      stat: async targetPath => require('fs').promises.stat(resolveWorkspaceTarget(targetPath)),
    },
  };
}

async function executeJavaScriptInWorkspace(workspaceDir, workingDirectory, code, timeoutMs) {
  const vm = require('vm');
  const { console: sandboxConsole, state: consoleState } = createJavaScriptConsole();
  const moduleCache = new Map();

  const createRequire = baseDir => requestedPath => {
    const normalizedRequest = requestedPath.startsWith('node:')
      ? requestedPath.slice(5)
      : requestedPath;

    if (normalizedRequest === 'fs') {
      return createSafeWorkspaceFs(workspaceDir, workingDirectory);
    }

    if (['path', 'assert', 'util', 'events', 'buffer', 'url', 'querystring', 'string_decoder'].includes(normalizedRequest)) {
      return require(normalizedRequest);
    }

    if (requestedPath.startsWith('./') || requestedPath.startsWith('../') || requestedPath.startsWith('/')) {
      let resolvedPath = requestedPath.startsWith('/')
        ? path.resolve(workspaceDir, requestedPath.slice(1))
        : path.resolve(baseDir, requestedPath);

      if (!isPathInside(workspaceDir, resolvedPath)) {
        throw new Error(`require path escapes the workspace: ${requestedPath}`);
      }

      if (!path.extname(resolvedPath)) {
        if (require('fs').existsSync(`${resolvedPath}.js`)) {
          resolvedPath = `${resolvedPath}.js`;
        } else if (require('fs').existsSync(`${resolvedPath}.cjs`)) {
          resolvedPath = `${resolvedPath}.cjs`;
        } else if (require('fs').existsSync(`${resolvedPath}.json`)) {
          resolvedPath = `${resolvedPath}.json`;
        }
      }

      if (moduleCache.has(resolvedPath)) {
        return moduleCache.get(resolvedPath).exports;
      }

      if (resolvedPath.endsWith('.json')) {
        return JSON.parse(require('fs').readFileSync(resolvedPath, 'utf8'));
      }

      const source = require('fs').readFileSync(resolvedPath, 'utf8');
      const module = { exports: {} };
      moduleCache.set(resolvedPath, module);
      const wrapped = new vm.Script(
        `(function(exports, require, module, __filename, __dirname, console, process, Buffer, URL, URLSearchParams){${source}\n})`,
        { filename: resolvedPath },
      );
      const fn = wrapped.runInContext(context, { timeout: timeoutMs });
      fn(
        module.exports,
        createRequire(path.dirname(resolvedPath)),
        module,
        resolvedPath,
        path.dirname(resolvedPath),
        sandboxConsole,
        sandboxProcess,
        Buffer,
        URL,
        URLSearchParams,
      );
      return module.exports;
    }

    throw new Error(`Module is not allowed in runJavaScript: ${requestedPath}`);
  };

  const sandboxProcess = Object.freeze({
    argv: [],
    env: Object.freeze({}),
    cwd: () => workingDirectory,
    platform: process.platform,
    version: process.version,
  });

  const context = vm.createContext({
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
  });
  const inlinePath = path.join(workingDirectory, '__inline__.js');
  const wrapped = new vm.Script(
    `(async function(exports, require, module, __filename, __dirname, console, process, Buffer, URL, URLSearchParams){${code}\n})`,
    { filename: inlinePath },
  );
  const fn = wrapped.runInContext(context, { timeout: timeoutMs });
  const inlineModule = { exports: {} };
  await fn(
    inlineModule.exports,
    createRequire(workingDirectory),
    inlineModule,
    inlinePath,
    workingDirectory,
    sandboxConsole,
    sandboxProcess,
    Buffer,
    URL,
    URLSearchParams,
  );

  return {
    stdout: consoleState.stdout,
    stderr: consoleState.stderr,
    exitCode: 0,
  };
}

function createStageHostPathTool(machine, workspaceDir) {
  return tool({
    description: [
      'Copy a readable host file or directory into the current user workspace.',
      'Use this when a needed host file lives outside the workspace and must be staged before sandboxed processing.',
      `Destination paths must stay inside ${toPosixPath(path.resolve(workspaceDir))}.`,
    ].join(' '),
    inputSchema: z.object({
      sourcePath: z.string().describe('Readable host file or directory path. Must be inside the workspace or a shared read-only root.'),
      destinationDir: z.string().describe('Workspace directory where the staged copy should be placed. Create a dedicated task subdirectory when staging files for scripts.'),
      newName: z.string().optional().describe('Optional replacement name for the copied file or directory.'),
      overwrite: z.boolean().optional().describe('Whether to overwrite the destination if it already exists. Defaults to false.'),
    }),
    execute: async ({ sourcePath, destinationDir, newName, overwrite }) => {
      const resolvedSourcePath = resolveReadablePath(workspaceDir, machine.sharedReadRoots, sourcePath);
      const resolvedDestinationDir = resolveWorkspacePath(workspaceDir, destinationDir);
      const destinationPath = path.join(
        resolvedDestinationDir,
        (typeof newName === 'string' && newName.trim()) || path.basename(resolvedSourcePath),
      );
      const result = await copyPathRecursive(resolvedSourcePath, destinationPath, {
        overwrite: overwrite === true,
      });

      return {
        success: true,
        sourcePath: resolvedSourcePath,
        destinationPath,
        fileCount: result.fileCount,
        directory: result.directory,
      };
    },
  });
}

function createRunPythonTool(workspaceDir) {
  return tool({
    description: [
      'Run Python code in a restricted in-memory sandbox mirrored from a workspace directory.',
      'The script can only see files from the selected workspace directory, and any file changes are synced back into that same directory.',
    ].join(' '),
    inputSchema: z.object({
      workingDirectory: z.string().describe('Workspace directory where the Python script should run. Relative paths resolve inside the current user workspace.'),
      code: z.string().describe('Python code to execute.'),
      timeoutMs: z.number().int().positive().optional().describe('Optional execution timeout in milliseconds.'),
    }),
    execute: async ({ workingDirectory, code, timeoutMs }) => {
      const resolvedWorkingDirectory = resolveWorkspacePath(workspaceDir, workingDirectory);
      await fs.mkdir(resolvedWorkingDirectory, { recursive: true });
      const effectiveTimeoutMs = Math.min(
        Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_BASH_TIMEOUT_MS,
        DEFAULT_MAX_BASH_TIMEOUT_MS,
      );
      const { Bash, InMemoryFs } = await loadJustBashModule();
      const { initialFiles, initialBuffers } = await snapshotHostDirectory(resolvedWorkingDirectory);
      const virtualFs = new InMemoryFs({
        ...initialFiles,
        [`${SCRIPT_VIRTUAL_ROOT}/__runner.py`]: code,
      });
      const bashEnv = new Bash({
        fs: virtualFs,
        cwd: SCRIPT_VIRTUAL_ROOT,
        python: true,
        executionLimits: {
          maxPythonTimeoutMs: effectiveTimeoutMs,
        },
      });
      const result = await bashEnv.exec('python3 __runner.py');
      const changedFiles = await syncVirtualWorkspaceToHost(
        virtualFs,
        resolvedWorkingDirectory,
        initialBuffers,
        new Set([`${SCRIPT_VIRTUAL_ROOT}/__runner.py`]),
      );

      return {
        stdout: truncateText(result.stdout || '', MAX_BASH_OUTPUT_LENGTH, 'stdout'),
        stderr: truncateText(result.stderr || '', MAX_BASH_OUTPUT_LENGTH, 'stderr'),
        exitCode: result.exitCode,
        changedFiles,
      };
    },
  });
}

function createRunJavaScriptTool(workspaceDir) {
  return tool({
    description: [
      'Run JavaScript code with access limited to the current user workspace.',
      'The script may read or write files inside the workspace, but network access and external module loading are blocked.',
    ].join(' '),
    inputSchema: z.object({
      workingDirectory: z.string().describe('Workspace directory where the JavaScript code should run. Relative paths resolve inside the current user workspace.'),
      code: z.string().describe('JavaScript code to execute.'),
      timeoutMs: z.number().int().positive().optional().describe('Optional execution timeout in milliseconds.'),
    }),
    execute: async ({ workingDirectory, code, timeoutMs }) => {
      const resolvedWorkingDirectory = resolveWorkspacePath(workspaceDir, workingDirectory);
      await fs.mkdir(resolvedWorkingDirectory, { recursive: true });
      const effectiveTimeoutMs = Math.min(
        Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_BASH_TIMEOUT_MS,
        DEFAULT_MAX_BASH_TIMEOUT_MS,
      );
      const executionResult = await executeJavaScriptInWorkspace(
        workspaceDir,
        resolvedWorkingDirectory,
        code,
        effectiveTimeoutMs,
      );

      return {
        stdout: truncateText(executionResult.stdout || '', MAX_BASH_OUTPUT_LENGTH, 'stdout'),
        stderr: truncateText(executionResult.stderr || '', MAX_BASH_OUTPUT_LENGTH, 'stderr'),
        exitCode: executionResult.exitCode,
      };
    },
  });
}

function createReadFileTool(machine, workspaceDir, attachmentIndex) {
  return tool({
    description: [
      'Read a UTF-8 text file from the current user workspace on the host.',
      `Relative paths resolve from ${toPosixPath(path.resolve(workspaceDir))}.`,
      'Relative paths must stay inside this workspace.',
      'Absolute paths may also point to configured shared read-only roots.',
      'Do not use this for user-provided attachments; use the attachment tools instead.',
    ].join(' '),
    inputSchema: z.object({
      path: z.string().describe('The path to the local text file to read'),
    }),
    execute: async ({ path: filePath }) => {
      const resolvedPath = resolveReadablePath(workspaceDir, machine.sharedReadRoots, filePath);
      const fileInfo = await assertReadableLocalTextFile(resolvedPath, attachmentIndex);
      const content = await machine.readFile(filePath);

      return {
        path: resolvedPath,
        sizeBytes: fileInfo.sizeBytes,
        content: truncateText(content, MAX_LOCAL_TEXT_CHARS, 'file content'),
      };
    },
  });
}

function createWriteFileTool(machine, workspaceDir) {
  return tool({
    description: [
      'Write UTF-8 text content to a file in the current user workspace on the host.',
      `Relative paths resolve from ${toPosixPath(path.resolve(workspaceDir))}.`,
      'Paths must stay inside this workspace.',
    ].join(' '),
    inputSchema: z.object({
      path: z.string().describe('The path where the file should be written'),
      content: z.string().describe('The content to write'),
    }),
    execute: async ({ path: filePath, content }) => {
      const resolvedPath = await machine.writeFile(filePath, content);

      return {
        success: true,
        path: resolvedPath,
      };
    },
  });
}

function createSendFileTool(machine, workspaceDir) {
  return tool({
    description: [
      'Queue a local file from the current user workspace to be sent back through the current channel before your final reply is delivered.',
      `Relative paths resolve from ${toPosixPath(path.resolve(workspaceDir))}.`,
      'Relative paths must stay inside this workspace.',
      'Absolute paths may also point to configured shared read-only roots.',
      'Use this after creating or locating a real file the user should receive.',
      'If channel delivery fails, the user will be told the file could not be sent and will receive the absolute path instead.',
    ].join(' '),
    inputSchema: z.object({
      path: z.string().describe('The path to the local file that should be sent to the user'),
      name: z.string().optional().describe('Optional filename to show to the user when sending'),
    }),
    execute: async ({ path: filePath, name }) => {
      const attachment = await machine.registerOutboundAttachment(filePath, name);

      return {
        success: true,
        attachment,
      };
    },
  });
}

function createUpdateMemoryTool(memoryRuntime) {
  return tool({
    description: [
      'Persist a direct patch to the current user long-term memory.',
      'Use this when the current turn clearly reveals durable identity information, a preferred real name, or a lasting collaboration preference/correction.',
      'Do not use this for one-off task details or short-lived context.',
    ].join(' '),
    inputSchema: z.object({
      reason: z.string().optional().describe('Why this turn likely needs a durable memory update.'),
      memoryPatch: z.object({
        profile: z.object({
          realName: z.string().optional(),
          realNameSource: z.string().optional(),
          awaitingRealNameReply: z.boolean().optional(),
        }).optional(),
        notes: z.array(z.object({
          text: z.string(),
          kind: z.string().optional(),
          trigger: z.string().optional(),
        })).optional(),
      }).describe('Direct durable memory patch derived by the main agent from the current conversation.'),
    }),
    execute: async ({ reason, memoryPatch }) => memoryRuntime.applyPatch({ reason, patch: memoryPatch }),
  });
}

async function createRuntimeTools({
  workspaceDir,
  projectRootDir = workspaceDir,
  skillsDir,
  mcpServers,
  attachments = [],
  attachmentExtraction = {},
  toolTimeouts = {},
  requestContext = {},
  memoryRuntime = null,
}) {
  const workingDir = path.resolve(workspaceDir);
  await fs.mkdir(workingDir, { recursive: true });
  const sharedLibraryRoot = path.resolve(projectRootDir, 'storage', '已签署协议电子档');
  const machine = new LocalWorkspaceBackend(workingDir, {
    sharedReadRoots: [sharedLibraryRoot],
  });
  const normalizedAttachments = normalizeAttachments(attachments, path.resolve(projectRootDir), resolveRequestedPath);
  const attachmentToolkit = createAttachmentTools(
    normalizedAttachments,
    path.resolve(projectRootDir),
    resolveRequestedPath,
    attachmentExtraction,
  );
  const bashToolkitPromise = createSandboxedBashTool(workingDir);

  const [bashToolkit, skillsToolkit, mcpToolkit] = await Promise.all([
    bashToolkitPromise,
    createSkillsToolkit({ skillsDir, workspaceDir: workingDir }),
    createMcpToolkit(mcpServers, {
      defaultToolTimeoutMs: toolTimeouts.mcpToolTimeoutMs,
      requestContext,
    }),
  ]);

    const runtimeTools = {
      bash: bashToolkit.tool,
      readFile: createReadFileTool(machine, workingDir, attachmentToolkit.attachmentIndex),
      writeFile: createWriteFileTool(machine, workingDir),
      stageHostPath: createStageHostPathTool(machine, workingDir),
      runPython: createRunPythonTool(workingDir),
      runJavaScript: createRunJavaScriptTool(workingDir),
      sendFile: createSendFileTool(machine, workingDir),
      ...(memoryRuntime ? { updateMemory: createUpdateMemoryTool(memoryRuntime) } : {}),
      ...attachmentToolkit.tools,
    };

  const tools = mergeToolSets([
    runtimeTools,
    { skill: skillsToolkit.skill },
    mcpToolkit.tools,
  ]);
  const toolDisplayByName = {
    bash: createToolDisplayInfo('bash', {
      displayName: '命令执行',
      statusText: '执行命令',
    }),
    readFile: createToolDisplayInfo('readFile', {
      displayName: '文件读取',
      statusText: '读取文件内容',
    }),
    writeFile: createToolDisplayInfo('writeFile', {
      displayName: '文件写入',
      statusText: '写入文件',
    }),
    stageHostPath: createToolDisplayInfo('stageHostPath', {
      displayName: '文件暂存',
      statusText: '复制文件到工作区',
    }),
    runPython: createToolDisplayInfo('runPython', {
      displayName: 'Python 执行',
      statusText: '运行 Python 代码',
    }),
    runJavaScript: createToolDisplayInfo('runJavaScript', {
      displayName: 'JavaScript 执行',
      statusText: '运行 JavaScript 代码',
    }),
      sendFile: createToolDisplayInfo('sendFile', {
        displayName: '文件发送',
        statusText: '准备发送文件',
      }),
      ...(memoryRuntime ? {
        updateMemory: createToolDisplayInfo('updateMemory', {
          displayName: '记忆更新',
          statusText: '更新长期记忆',
        }),
      } : {}),
      ...(attachmentToolkit.toolDisplayByName || {}),
      ...(skillsToolkit.toolDisplayByName || {}),
      ...(mcpToolkit.toolDisplayByName || {}),
  };

    return {
      tools,
      toolDisplayByName,
      toolNames: Object.keys(tools),
      mcpToolNames: Object.keys(mcpToolkit.tools),
      mcpReadOnlyToolNames: mcpToolkit.readOnlyToolNames || [],
      attachmentToolNames: attachmentToolkit.toolNames,
      memoryToolNames: memoryRuntime ? ['updateMemory'] : [],
      promptSections: [
        `Machine\nYou are operating in the current user's isolated workspace. Host workspace: \`${toPosixPath(workingDir)}\`. The \`bash\` tool remains sandboxed and cannot reach the host filesystem outside that workspace. Host file tools (\`readFile\`, \`writeFile\`, \`sendFile\`) operate on real host paths inside this workspace, and host read/send access is also allowed for the shared contract library root: \`${toPosixPath(sharedLibraryRoot)}\`.`,
        'Staging workflow\nIf a needed host file is outside the workspace, first use `stageHostPath` to copy it into a dedicated task directory such as `jobs/<task-name>/` under the workspace. After staging, use `runPython` or `runJavaScript` against that staged workspace directory instead of touching the source files directly.',
        'Reply files\nWhen the user should receive a real file, create or locate it locally and then call `sendFile` with that file path. The file will be sent before your final text reply. If channel delivery fails, the user will be told that sending failed and will receive the absolute path instead.',
        memoryRuntime
          ? 'Memory\nUse `updateMemory` when the current turn reveals durable identity, a preferred real name, or a lasting collaboration preference/correction that should influence future turns. When you call it, provide the memory patch directly from your own understanding of the conversation. Do not store one-off task details.'
          : '',
        buildSkillsPrompt(skillsToolkit.skills),
        buildMcpPrompt(mcpToolkit.summaries),
        buildAttachmentsPrompt(normalizedAttachments),
    ].filter(Boolean),
    getOutboundAttachments: () => machine.getOutboundAttachments(),
    close: async () => {
      if (typeof attachmentToolkit.close === 'function') {
        await attachmentToolkit.close();
      }
      await bashToolkit.close();
      await mcpToolkit.close();
    },
  };
}

module.exports = {
  buildBashToolPrompt,
  createBashTool,
  createRuntimeTools,
  decodeShellOutput,
  getBlockedCommandReason,
  wrapWindowsPowerShellCommand,
};
