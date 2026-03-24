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

class MachineBackend {
  constructor(workingDir, options = {}) {
    this.workingDir = path.resolve(workingDir);
    this.outboundAttachments = [];
    this.outboundNotifications = [];
    this.bashTimeoutMs = Number.isFinite(options.bashTimeoutMs)
      ? Math.max(1, Math.trunc(options.bashTimeoutMs))
      : DEFAULT_BASH_TIMEOUT_MS;
    this.maxBashTimeoutMs = Number.isFinite(options.maxBashTimeoutMs)
      ? Math.max(1, Math.trunc(options.maxBashTimeoutMs))
      : DEFAULT_MAX_BASH_TIMEOUT_MS;
  }

  async executeCommand(command, timeoutMs = this.bashTimeoutMs) {
    const blockedReason = getBlockedCommandReason(command);

    if (blockedReason) {
      return {
        stdout: '',
        stderr: blockedReason,
        exitCode: 126,
        timedOut: false,
      };
    }

    const normalizedTimeoutMs = Number.isFinite(timeoutMs)
      ? Math.max(1, Math.min(Math.trunc(timeoutMs), this.maxBashTimeoutMs))
      : this.bashTimeoutMs;

    return runShellCommand(command, this.workingDir, normalizedTimeoutMs);
  }

  async readFile(filePath) {
    const resolvedPath = resolveRequestedPath(this.workingDir, filePath);
    return fs.readFile(resolvedPath, 'utf8');
  }

  async writeFile(filePath, content) {
    const resolvedPath = resolveRequestedPath(this.workingDir, filePath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, content);
    return resolvedPath;
  }

  async registerOutboundAttachment(filePath, displayName) {
    const resolvedPath = resolveRequestedPath(this.workingDir, filePath);
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

  queueOutboundNotification(recipient, content, context = {}) {
    const normalizedRecipient = recipient && typeof recipient === 'object'
      ? {
        userId: recipient.userId || '',
        label: recipient.label || recipient.alias || recipient.userId || '',
        alias: recipient.alias || '',
      }
      : {
        userId: String(recipient || ''),
        label: String(recipient || ''),
        alias: '',
      };

    if (!normalizedRecipient.userId) {
      throw new Error('Notification recipient is required.');
    }

    const normalizedContent = String(content || '').trim();

    if (!normalizedContent) {
      throw new Error('Notification content is required.');
    }

    this.outboundNotifications.push({
      recipient: normalizedRecipient,
      content: normalizedContent,
      context,
    });

    return {
      recipient: normalizedRecipient,
      content: normalizedContent,
    };
  }

  getOutboundNotifications() {
    return this.outboundNotifications.map(notification => ({
      recipient: notification.recipient,
      content: notification.content,
      context: notification.context,
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

function buildBashToolPrompt(workspaceDir, defaultTimeoutMs = DEFAULT_BASH_TIMEOUT_MS, maxTimeoutMs = DEFAULT_MAX_BASH_TIMEOUT_MS) {
  const promptLines = [
    'Use the bash tool to inspect and operate on the local machine you are responsible for maintaining.',
    `Default working directory: ${toPosixPath(path.resolve(workspaceDir))}`,
    '- This is a shared working environment used to serve multiple employees.',
    '- Relative paths resolve from the default working directory.',
    '- Absolute paths are allowed when you need to inspect or modify files elsewhere on the machine.',
    '- Prefer `rg` for fast file and text search when available.',
    '- Use shell commands for directory listing, script execution, builds, tests, file operations, and system inspection.',
    '- Inspect first, then act. Confirm target paths and current state before mutating files or running impactful commands.',
    '- Prefer the smallest effective action and avoid unnecessary disruption to the environment.',
    '- Use `readFile` for precise inspection of local text files and `writeFile` for direct edits.',
    `- Commands time out by default after ${defaultTimeoutMs}ms. You may raise this per call with \`timeoutMs\` when the work is intentionally long-running, up to ${maxTimeoutMs}ms.`,
  ];

  if (process.platform === 'win32') {
    promptLines.push('- On Windows, this tool runs in Windows PowerShell, not bash and not cmd.exe.');
    promptLines.push('- Use PowerShell syntax and cmdlets such as `Get-ChildItem`, `Get-Content`, `Select-String`, and `ConvertTo-Json`.');
    promptLines.push('- Do not use bash/cmd-only syntax like `&&`, `ls -la`, `dir /a`, or `chcp` unless you explicitly invoke the correct shell yourself.');
    promptLines.push('- Prefer `-LiteralPath` for Windows paths and UNC paths that may contain spaces or non-ASCII characters.');
    promptLines.push('- When you need machine-readable results, prefer structured PowerShell output over formatted tables.');
  }

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

function createReadFileTool(machine, workspaceDir, attachmentIndex) {
  return tool({
    description: [
      'Read a local UTF-8 text file from the machine.',
      `Relative paths resolve from ${toPosixPath(path.resolve(workspaceDir))}.`,
      'Absolute paths are allowed.',
      'Do not use this for user-provided attachments; use the attachment tools instead.',
    ].join(' '),
    inputSchema: z.object({
      path: z.string().describe('The path to the local text file to read'),
    }),
    execute: async ({ path: filePath }) => {
      const resolvedPath = resolveRequestedPath(workspaceDir, filePath);
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
      'Write UTF-8 text content to a file on the local machine.',
      `Relative paths resolve from ${toPosixPath(path.resolve(workspaceDir))}.`,
      'Absolute paths are allowed.',
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
      'Queue a local file to be sent back to the user through the current channel before your final reply is delivered.',
      `Relative paths resolve from ${toPosixPath(path.resolve(workspaceDir))}.`,
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

function buildNotifyUserPrompt(messaging) {
  const recipients = Object.entries(messaging?.recipients || {});
  const lines = [
    'Queue a proactive text notification to another employee through the current channel after your final reply is sent.',
    'Use this when a workflow requires notifying the contract admin or another known recipient.',
  ];

  if (recipients.length > 0) {
    lines.push('Available recipients:');

    for (const [alias, recipient] of recipients) {
      const label = recipient.label || recipient.userId || alias;
      lines.push(`- ${alias}: ${label}`);
    }
  }

  return lines.join('\n');
}

function createNotifyUserTool(machine, messaging = {}) {
  const recipientMap = new Map(Object.entries(messaging.recipients || {}).map(([alias, value]) => [alias, {
    ...value,
    alias,
  }]));

  return tool({
    description: buildNotifyUserPrompt(messaging),
    inputSchema: z.object({
      recipient: z.string().describe('A configured recipient alias such as contract_admin, or a direct user id'),
      content: z.string().describe('The text message to send'),
    }),
    execute: async ({ recipient, content }) => {
      const resolvedRecipient = recipientMap.get(recipient) || {
        userId: recipient,
        label: recipient,
        alias: '',
      };

      return {
        success: true,
        queued: machine.queueOutboundNotification(resolvedRecipient, content),
      };
    },
  });
}

async function createRuntimeTools({ workspaceDir, skillsDir, mcpServers, attachments = [], attachmentExtraction = {}, messaging = null, toolTimeouts = {} }) {
  const workingDir = path.resolve(workspaceDir);
  const machine = new MachineBackend(workingDir, toolTimeouts);
  const normalizedAttachments = normalizeAttachments(attachments, workingDir, resolveRequestedPath);
  const attachmentToolkit = createAttachmentTools(
    normalizedAttachments,
    workingDir,
    resolveRequestedPath,
    attachmentExtraction,
  );

  const [skillsToolkit, mcpToolkit] = await Promise.all([
    createSkillsToolkit({ skillsDir, workspaceDir }),
    createMcpToolkit(mcpServers, {
      defaultToolTimeoutMs: toolTimeouts.mcpToolTimeoutMs,
    }),
  ]);

  const runtimeTools = {
    bash: createBashTool(machine, workingDir),
    readFile: createReadFileTool(machine, workingDir, attachmentToolkit.attachmentIndex),
    writeFile: createWriteFileTool(machine, workingDir),
    sendFile: createSendFileTool(machine, workingDir),
    ...attachmentToolkit.tools,
  };

  if (messaging && messaging.enabled !== false) {
    runtimeTools.notifyUser = createNotifyUserTool(machine, messaging);
  }

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
    ...(runtimeTools.notifyUser ? {
      notifyUser: createToolDisplayInfo('notifyUser', {
        displayName: '消息通知',
        statusText: '通知相关同事',
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
    promptSections: [
      `Machine\nYou are operating on a shared local machine. Default working directory: \`${toPosixPath(workingDir)}\`. You may use absolute filesystem paths when needed, but you are responsible for preserving the machine's long-term usability and file integrity.`,
      'Reply files\nWhen the user should receive a real file, create or locate it locally and then call `sendFile` with that file path. The file will be sent before your final text reply. If channel delivery fails, the user will be told that sending failed and will receive the absolute path instead.',
      runtimeTools.notifyUser
        ? 'Notifications\nIf a workflow requires alerting another employee, queue the message with `notifyUser` after the real work succeeds. Prefer configured aliases such as `contract_admin` instead of guessing user ids.'
        : '',
      buildSkillsPrompt(skillsToolkit.skills),
      buildMcpPrompt(mcpToolkit.summaries),
      buildAttachmentsPrompt(normalizedAttachments),
    ].filter(Boolean),
    getOutboundAttachments: () => machine.getOutboundAttachments(),
    getOutboundNotifications: () => machine.getOutboundNotifications(),
    close: async () => {
      if (typeof attachmentToolkit.close === 'function') {
        await attachmentToolkit.close();
      }
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
