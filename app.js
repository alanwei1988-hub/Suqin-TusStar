require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AgentCore = require('./agent/index');

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

function processConfig(rawConfig, { rootDir = __dirname, env = process.env } = {}) {
  const channelType = rawConfig.channel.type;
  const channelConfig = rawConfig.channel[channelType] || {};
  const normalizedChannelConfig = {
    ...channelConfig,
    botId: env.BOT_ID,
    secret: env.SECRET,
    debug: env.DEBUG === 'true' || channelConfig.debug,
  };

  if (channelType === 'wxwork') {
    normalizedChannelConfig.streamingResponse = channelConfig.streamingResponse !== false;
  }

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
      sessionDb: resolveRelativePath(rootDir, rawConfig.agent.sessionDb),
      mcpServers: (rawConfig.agent.mcpServers || []).map(server => normalizeMcpServer(rootDir, server)),
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
      ? {
        ...rawConfig.contractMcp,
        dbPath: resolveRelativePath(rootDir, rawConfig.contractMcp.dbPath),
        storageRoot: resolveRelativePath(rootDir, rawConfig.contractMcp.storageRoot),
        stagingDir: resolveRelativePath(rootDir, rawConfig.contractMcp.stagingDir),
      }
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
  if (step.toolCalls && step.toolCalls.length > 0) {
    return `正在处理（第 ${step.stepNumber + 1} 步）：${step.toolCalls.map(toolCall => toolCall.toolName).join(', ')}`;
  }

  if (step.text && step.text.trim().length > 0) {
    return `正在整理回复（第 ${step.stepNumber + 1} 步）...`;
  }

  return `正在处理（第 ${step.stepNumber + 1} 步）...`;
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

function registerChannelHandlers({ agent, channel }) {
  channel.on('message', async ({ userId, text, attachments, context }) => {
    console.log(`[Main] Message from ${userId}: ${text} (${attachments.length} files)`);
    const streamReply = typeof channel.createStreamingReply === 'function'
      ? channel.createStreamingReply(userId, context)
      : null;

    try {
      if (streamReply) {
        await streamReply.updateStatus('已收到，正在处理...');
      }

      const response = await agent.chat(userId, text, attachments, {
        onStepFinish: async step => {
          if (step.toolCalls && step.toolCalls.length > 0) {
            console.log('[Main] Agent tools:', step.toolCalls.map(toolCall => toolCall.toolName).join(', '));
          }

          if (streamReply) {
            await streamReply.updateStatus(formatStepStatus(step));
          }
        },
      });

      if (streamReply) {
        await streamFinalReply(streamReply, response);
      } else {
        await channel.reply(userId, response, context);
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
  loadChannelAdapter,
  loadRawConfig,
  normalizeMcpServer,
  processConfig,
  registerChannelHandlers,
  splitReplyIntoChunks,
};
