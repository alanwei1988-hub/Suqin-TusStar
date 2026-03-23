require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AgentCore = require('./agent/index');
const { resolveContractMcpConfig } = require('./contract-mcp/config');
const {
  getDefaultApiKeyEnvForLlmClient,
  getDefaultBaseURLForLlmClient,
  getDefaultPromptForLlmClient,
} = require('./markitdown/llm');
const { getProjectMarkItDownPython } = require('./markitdown/runtime');

function loadRawConfig(rootDir = __dirname) {
  const configPath = path.resolve(rootDir, 'config.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function resolveRelativePath(rootDir, value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return value;
  }

  return path.isAbsolute(value)
    ? value
    : path.resolve(rootDir, value);
}

function ensureDirExists(dirPath) {
  if (typeof dirPath !== 'string' || dirPath.trim().length === 0) {
    return;
  }

  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureParentDirExists(filePath) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    return;
  }

  ensureDirExists(path.dirname(filePath));
}

function normalizeMcpServer(rootDir, server) {
  const normalized = {
    ...server,
    cwd: resolveRelativePath(rootDir, server.cwd),
  };

  if ((normalized.transport || normalized.type) !== 'stdio') {
    return normalized;
  }

  if (typeof normalized.command === 'string' && /^node(?:\.exe)?$/i.test(normalized.command.trim())) {
    normalized.command = process.execPath;
  }

  if (Array.isArray(normalized.args) && normalized.args.length > 0) {
    normalized.args = normalized.args.map((arg, index) => {
      if (
        index === 0
        && typeof arg === 'string'
        && /\.m?js$/i.test(arg)
      ) {
        return resolveRelativePath(normalized.cwd || rootDir, arg);
      }

      return arg;
    });
  }

  return normalized;
}

function normalizeMarkItDownLlmConfig(config = {}) {
  const normalizedConfig = config && typeof config === 'object' && !Array.isArray(config)
    ? config
    : {};
  const llmClient = typeof normalizedConfig.client === 'string' ? normalizedConfig.client.trim() : '';
  return {
    client: llmClient,
    model: typeof normalizedConfig.model === 'string' ? normalizedConfig.model.trim() : '',
    baseURL: typeof normalizedConfig.baseURL === 'string' && normalizedConfig.baseURL.trim().length > 0
      ? normalizedConfig.baseURL.trim()
      : getDefaultBaseURLForLlmClient(llmClient),
    apiKeyEnv: typeof normalizedConfig.apiKeyEnv === 'string' && normalizedConfig.apiKeyEnv.trim().length > 0
      ? normalizedConfig.apiKeyEnv.trim()
      : getDefaultApiKeyEnvForLlmClient(llmClient),
    prompt: typeof normalizedConfig.prompt === 'string' && normalizedConfig.prompt.trim().length > 0
      ? normalizedConfig.prompt.trim()
      : getDefaultPromptForLlmClient(llmClient),
  };
}

function normalizeMarkItDownConfig(rootDir, config = {}) {
  const runnerPath = getProjectMarkItDownPython(rootDir);
  const llmConfig = config && typeof config.llm === 'object' && !Array.isArray(config.llm)
    ? config.llm
    : {};
  const llmProfilesConfig = config && typeof config.llmProfiles === 'object' && !Array.isArray(config.llmProfiles)
    ? config.llmProfiles
    : {};
  const activeLlmProfile = typeof config.activeLlmProfile === 'string'
    ? config.activeLlmProfile.trim()
    : '';
  const fallbackLlmProfile = typeof config.fallbackLlmProfile === 'string'
    ? config.fallbackLlmProfile.trim()
    : '';
  const cacheConfig = config && typeof config.cache === 'object' && !Array.isArray(config.cache)
    ? config.cache
    : {};
  const normalizedLlmProfiles = Object.fromEntries(
    Object.entries(llmProfilesConfig)
      .filter(([name]) => typeof name === 'string' && name.trim().length > 0)
      .map(([name, profileConfig]) => [name.trim(), normalizeMarkItDownLlmConfig(profileConfig)])
  );
  const fallbackLlmConfig = normalizeMarkItDownLlmConfig(llmConfig);
  const activeProfileLlmConfig = activeLlmProfile && normalizedLlmProfiles[activeLlmProfile]
    ? normalizedLlmProfiles[activeLlmProfile]
    : null;
  const fallbackProfileLlmConfig = fallbackLlmProfile && normalizedLlmProfiles[fallbackLlmProfile]
    ? normalizedLlmProfiles[fallbackLlmProfile]
    : null;
  const normalized = {
    enabled: config.enabled === true,
    handlerModule: typeof config.handlerModule === 'string' && config.handlerModule.trim().length > 0
      ? resolveRelativePath(rootDir, config.handlerModule)
      : '',
    command: typeof config.command === 'string' && config.command.trim().length > 0
      ? config.command
      : runnerPath,
    args: Array.isArray(config.args) && config.args.length > 0
      ? [...config.args]
      : ['-X', 'utf8', '-m', 'markitdown', '{input}'],
    timeoutMs: Number.isFinite(config.timeoutMs) ? config.timeoutMs : 30000,
    maxOutputChars: Number.isFinite(config.maxOutputChars) ? config.maxOutputChars : 24000,
    previewPageCount: Number.isFinite(config.previewPageCount) ? Math.max(1, Math.trunc(config.previewPageCount)) : 1,
    readPageCount: Number.isFinite(config.readPageCount) ? Math.max(1, Math.trunc(config.readPageCount)) : 2,
    ocrConcurrency: Number.isFinite(config.ocrConcurrency) ? Math.max(1, Math.trunc(config.ocrConcurrency)) : 2,
    ocrPageGroupSize: Number.isFinite(config.ocrPageGroupSize) ? Math.max(1, Math.trunc(config.ocrPageGroupSize)) : 4,
    supportedExtensions: Array.isArray(config.supportedExtensions) && config.supportedExtensions.length > 0
      ? config.supportedExtensions.map(value => String(value).toLowerCase())
      : ['.pdf', '.docx', '.pptx', '.xls', '.xlsx'],
    cache: {
      enabled: cacheConfig.enabled !== false,
      dbPath: typeof cacheConfig.dbPath === 'string' && cacheConfig.dbPath.trim().length > 0
        ? resolveRelativePath(rootDir, cacheConfig.dbPath.trim())
        : path.resolve(rootDir, 'data', 'attachment-extraction-cache.db'),
    },
    activeLlmProfile,
    fallbackLlmProfile: fallbackProfileLlmConfig ? fallbackLlmProfile : '',
    llmProfiles: normalizedLlmProfiles,
    llm: activeProfileLlmConfig || fallbackLlmConfig,
    fallbackLlm: fallbackProfileLlmConfig,
  };

  if (normalized.command === '{runner}') {
    normalized.command = runnerPath;
  } else if (typeof normalized.command === 'string' && normalized.command.startsWith('.')) {
    normalized.command = resolveRelativePath(rootDir, normalized.command);
  }

  normalized.args = normalized.args.map(arg => {
    if (typeof arg !== 'string') {
      return arg;
    }

    if (
      arg === '{input}'
      || arg === '{output}'
      || arg === '{runner}'
      || arg === '{llmClient}'
      || arg === '{llmModel}'
      || arg === '{llmBaseURL}'
      || arg === '{llmPrompt}'
      || arg === '{pageStart}'
      || arg === '{pageCount}'
      || arg === '{ocrConcurrency}'
      || arg === '{ocrPageGroupSize}'
    ) {
      return arg;
    }

    if (arg.startsWith('.')) {
      return resolveRelativePath(rootDir, arg);
    }

    return arg;
  });

  return normalized;
}

function processConfig(rawConfig, { rootDir = __dirname, env = process.env } = {}) {
  const channelType = rawConfig.channel.type;
  const channelConfig = rawConfig.channel[channelType] || {};
  const sessionDbPath = resolveRelativePath(rootDir, rawConfig.agent.sessionDb);
  const markitdownConfig = normalizeMarkItDownConfig(rootDir, rawConfig.agent.attachmentExtraction?.markitdown || {});
  const normalizedChannelConfig = {
    ...channelConfig,
    botId: env.BOT_ID,
    secret: env.SECRET,
    debug: env.DEBUG === 'true' || channelConfig.debug,
  };

  if (channelType === 'wxwork') {
    normalizedChannelConfig.streamingResponse = channelConfig.streamingResponse !== false;
  }

  ensureParentDirExists(sessionDbPath);
  ensureParentDirExists(markitdownConfig.cache.dbPath);

  return {
    agent: {
      ...rawConfig.agent,
      model: env.MODEL_NAME || rawConfig.agent.model,
      workspaceDir: path.resolve(rootDir),
      openai: {
        ...rawConfig.agent.openai,
        apiKey: env.OPENAI_API_KEY,
        baseURL: env.OPENAI_BASE_URL || rawConfig.agent.openai.baseURL,
      },
      skillsDir: resolveRelativePath(rootDir, rawConfig.agent.skillsDir),
      rolePromptDir: resolveRelativePath(rootDir, rawConfig.agent.rolePromptDir),
      sessionDb: sessionDbPath,
      mcpServers: (rawConfig.agent.mcpServers || []).map(server => normalizeMcpServer(rootDir, server)),
      attachmentExtraction: {
        markitdown: markitdownConfig,
      },
    },
    channel: {
      ...rawConfig.channel,
      [channelType]: normalizedChannelConfig,
    },
    storage: {
      ...rawConfig.storage,
      tempDir: resolveRelativePath(rootDir, rawConfig.storage.tempDir),
    },
    contractMcp: rawConfig.contractMcp
      ? resolveContractMcpConfig(rootDir, rawConfig.contractMcp)
      : undefined,
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function splitReplyIntoChunks(content, maxChunkLength = 48) {
  const normalized = String(content || '');

  if (normalized.length <= maxChunkLength) {
    return [normalized];
  }

  const chunks = [];
  let buffer = '';

  for (const char of normalized) {
    buffer += char;
    if (buffer.length >= maxChunkLength || /[，。！？；\n]/.test(char)) {
      chunks.push(buffer);
      buffer = '';
    }
  }

  if (buffer.length > 0) {
    chunks.push(buffer);
  }

  return chunks.filter(Boolean);
}

function formatStepStatus(step) {
  if (step.text && step.text.trim().length > 0) {
    return `正在整理回复（第 ${step.stepNumber + 1} 步）...`;
  }

  return `已完成第 ${step.stepNumber + 1} 步，继续处理中...`;
}

function formatToolCallStatus(event) {
  return `正在处理（第 ${event.stepNumber + 1} 步）：${event.toolCall.toolName}`;
}

function normalizeAgentResponse(response) {
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    return {
      text: typeof response.text === 'string' && response.text.trim().length > 0
        ? response.text
        : '已处理完成。',
      outboundAttachments: Array.isArray(response.outboundAttachments)
        ? response.outboundAttachments
        : [],
    };
  }

  return {
    text: response || '已处理完成。',
    outboundAttachments: [],
  };
}

function getConversationQueueKey(userId, context = {}) {
  const chatType = Number.isFinite(context.chatType) ? context.chatType : 1;
  const chatId = context.chatId || userId;
  return `${chatType}:${chatId}`;
}

function createConversationQueue() {
  const states = new Map();

  return {
    enqueue(key, task) {
      const queueKey = String(key || 'default');
      const state = states.get(queueKey) || {
        tail: Promise.resolve(),
        pending: 0,
      };
      const queuedAhead = state.pending;

      state.pending += 1;

      const run = state.tail
        .catch(() => {})
        .then(task);
      const tracked = run.finally(() => {
        state.pending -= 1;

        if (state.tail === tracked && state.pending === 0) {
          states.delete(queueKey);
        }
      });

      state.tail = tracked;
      states.set(queueKey, state);

      return {
        queuedAhead,
        promise: run,
      };
    },
  };
}

async function streamFinalReply(streamReply, response) {
  const finalResponse = response || '已处理完成。';
  const chunks = splitReplyIntoChunks(finalResponse);
  let partial = '';

  await streamReply.updateStatus('正在整理回复...');

  for (const chunk of chunks) {
    partial += chunk;
    await streamReply.updateDraft(partial);
    await delay(80);
  }

  await streamReply.finish(finalResponse);
}

function isLikelyFileTooLargeMessage(message = '') {
  return /too large|文件太大|超出.{0,12}(大小|限制)|超过.{0,12}(限制|大小)|40058|40009|40006|size limit|total_size|invalid file size/i.test(message);
}

function toFileUri(filePath = '') {
  const normalizedPath = String(filePath || '').replace(/\\/g, '/');
  return `file:///${encodeURI(normalizedPath)}`;
}

function formatAttachmentLink(attachment) {
  const filePath = attachment?.path || '';
  const fileName = attachment?.name || '点击打开文件';
  return `[${fileName}](${toFileUri(filePath)})`;
}

function formatAttachmentPaths(attachments = []) {
  if (attachments.length === 1) {
    return `${formatAttachmentLink(attachments[0])}\n绝对路径：\`${attachments[0].path}\``;
  }

  return attachments.map((attachment, index) => `${index + 1}. ${formatAttachmentLink(attachment)}\n绝对路径：\`${attachment.path}\``).join('\n');
}

function buildAttachmentFailureReply(attachments = [], error) {
  if (error?.userMessage) {
    return error.userMessage;
  }

  const rawMessage = String(error?.cause?.message || error?.message || '').trim();
  let prefix = '文件发送失败。';

  if (isLikelyFileTooLargeMessage(rawMessage)) {
    prefix = '文件太大，当前无法直接发送。';
  } else if (rawMessage) {
    prefix = '文件暂时无法直接发送。';
  }

  if (attachments.length === 1) {
    return `${prefix} 请直接打开：${formatAttachmentPaths(attachments)}`;
  }

  return `${prefix} 请直接打开这些文件：\n${formatAttachmentPaths(attachments)}`;
}

async function sendOutboundAttachments({ channel, userId, attachments, context, streamReply }) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return { ok: true };
  }

  if (typeof channel.sendAttachments !== 'function') {
    return {
      ok: false,
      message: buildAttachmentFailureReply(attachments, new Error('当前通道不支持发送文件')),
    };
  }

  if (streamReply) {
    await streamReply.updateStatus('正在发送文件...');
  }

  try {
    await channel.sendAttachments(userId, attachments, context);
    return { ok: true };
  } catch (attachmentError) {
    console.error('[Main] Attachment send error:', attachmentError);
    return {
      ok: false,
      message: buildAttachmentFailureReply(attachments, attachmentError),
    };
  }
}

function registerChannelHandlers({ agent, channel }) {
  const messageQueue = createConversationQueue();

  channel.on('message', async ({ userId, text, attachments, context }) => {
    console.log(`[Main] Message from ${userId}: ${text} (${attachments.length} files)`);
    const streamReply = typeof channel.createStreamingReply === 'function'
      ? channel.createStreamingReply(userId, context)
      : null;
    const queueKey = getConversationQueueKey(userId, context);
    const { queuedAhead, promise } = messageQueue.enqueue(queueKey, async () => {
      try {
        if (streamReply) {
          if (context.initialStatusSent && attachments.length > 0) {
            await streamReply.updateStatus('文件已下载，正在处理...');
          } else if (!context.initialStatusSent) {
            await streamReply.updateStatus('已收到，正在处理...');
          }
        }

        const agentResponse = normalizeAgentResponse(await agent.chat(userId, text, attachments, {
          includeArtifacts: true,
          onToolCallStart: async event => {
            if (streamReply) {
              await streamReply.updateStatus(formatToolCallStatus(event));
            }
          },
          onStepFinish: async step => {
            if (step.toolCalls && step.toolCalls.length > 0) {
              console.log('[Main] Agent tools:', step.toolCalls.map(toolCall => toolCall.toolName).join(', '));
            }

            if (streamReply && ((!step.toolCalls || step.toolCalls.length === 0) || (step.text && step.text.trim().length > 0))) {
              await streamReply.updateStatus(formatStepStatus(step));
            }
          },
        }));

        const attachmentResult = await sendOutboundAttachments({
          channel,
          userId,
          attachments: agentResponse.outboundAttachments,
          context,
          streamReply,
        });
        const finalText = attachmentResult.ok
          ? agentResponse.text
          : attachmentResult.message;

        if (streamReply) {
          await streamFinalReply(streamReply, finalText);
        } else {
          await channel.reply(userId, finalText, context);
        }
      } catch (error) {
        console.error('[Main] Chat error:', error);
        if (streamReply) {
          await streamReply.finish('抱歉，我现在处理消息时遇到了点问题。');
        } else {
          await channel.reply(userId, '抱歉，我现在处理消息时遇到了点问题。', context);
        }
      }
    });

    if (streamReply && queuedAhead > 0) {
      await streamReply.updateStatus(`前方还有 ${queuedAhead} 条消息，排队处理中...`);
    }

    await promise;
  });

  channel.on('user_enter', async ({ userId, context }) => {
    const welcomeMsg = '您好！我是您的智能 AI 员工。我可以为您处理消息和文件。';
    await channel.sendWelcome(userId, welcomeMsg, context);
  });
}

async function loadChannelAdapter(channelType) {
  try {
    return require(`./channel/${channelType}/adapter`);
  } catch (error) {
    throw new Error(`Failed to load channel adapter for type: ${channelType}. ${error.message}`);
  }
}

async function createAgent(processedConfig, options = {}) {
  const agent = new AgentCore(processedConfig.agent, options);
  await agent.init();
  return agent;
}

module.exports = {
  createAgent,
  formatStepStatus,
  formatToolCallStatus,
  loadChannelAdapter,
  loadRawConfig,
  normalizeAgentResponse,
  normalizeMcpServer,
  processConfig,
  registerChannelHandlers,
  splitReplyIntoChunks,
};
