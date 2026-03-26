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
let bashToolModulePromise;

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

async function loadBashToolModule() {
  bashToolModulePromise ||= import('bash-tool');
  return bashToolModulePromise;
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
  constructor(workingDir) {
    this.workingDir = path.resolve(workingDir);
    this.outboundAttachments = [];
  }

  async readFile(filePath) {
    const resolvedPath = resolveWorkspacePath(this.workingDir, filePath);
    return fs.readFile(resolvedPath, 'utf8');
  }

  async writeFile(filePath, content) {
    const resolvedPath = resolveWorkspacePath(this.workingDir, filePath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, content);
    return resolvedPath;
  }

  async registerOutboundAttachment(filePath, displayName) {
    const resolvedPath = resolveWorkspacePath(this.workingDir, filePath);
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
    '- Avoid destructive commands even inside the sandbox unless they are truly necessary.',
  ];

  return promptLines.join('\n');
}

function createBashTool(machine, workspaceDir) {
  return tool({
    description: buildBashToolPrompt(workspaceDir, machine.bashTimeoutMs, machine.maxBashTimeoutMs),
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

function createReadFileTool(machine, workspaceDir, attachmentIndex) {
  return tool({
    description: [
      'Read a UTF-8 text file from the current user workspace on the host.',
      `Relative paths resolve from ${toPosixPath(path.resolve(workspaceDir))}.`,
      'Paths must stay inside this workspace.',
      'Do not use this for user-provided attachments; use the attachment tools instead.',
    ].join(' '),
    inputSchema: z.object({
      path: z.string().describe('The path to the local text file to read'),
    }),
    execute: async ({ path: filePath }) => {
      const resolvedPath = resolveWorkspacePath(workspaceDir, filePath);
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
      'Paths must stay inside this workspace.',
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

async function createRuntimeTools({
  workspaceDir,
  projectRootDir = workspaceDir,
  skillsDir,
  mcpServers,
  attachments = [],
  attachmentExtraction = {},
  toolTimeouts = {},
  requestContext = {},
}) {
  const workingDir = path.resolve(workspaceDir);
  await fs.mkdir(workingDir, { recursive: true });
  const machine = new LocalWorkspaceBackend(workingDir);
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
    sendFile: createSendFileTool(machine, workingDir),
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
    sendFile: createToolDisplayInfo('sendFile', {
      displayName: '文件发送',
      statusText: '准备发送文件',
    }),
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
    promptSections: [
      `Machine\nYou are operating in the current user's isolated workspace. Host workspace: \`${toPosixPath(workingDir)}\`. The \`bash\` tool runs in a sandboxed copy-on-write environment rooted at this workspace. Host file tools (\`readFile\`, \`writeFile\`, \`sendFile\`) are restricted to this workspace only.`,
      'Reply files\nWhen the user should receive a real file, create or locate it locally and then call `sendFile` with that file path. The file will be sent before your final text reply. If channel delivery fails, the user will be told that sending failed and will receive the absolute path instead.',
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
