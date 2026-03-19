require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AgentCore = require('./agent/index');

// 1. 加载并解析文本配置文件 (config.json)
const configRaw = fs.readFileSync(path.resolve(__dirname, 'config.json'), 'utf8');
const config = JSON.parse(configRaw);

// 2. 预处理路径和环境变量 (Path Resolution & Env Merging)
// 将相对路径解析为绝对路径，并从环境变量注入敏感信息
const processedConfig = {
  agent: {
    ...config.agent,
    model: process.env.MODEL_NAME || config.agent.model,
    openai: {
      ...config.agent.openai,
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || config.agent.openai.baseURL,
    },
    skillsDir: path.resolve(__dirname, config.agent.skillsDir),
    sessionDb: path.resolve(__dirname, config.agent.sessionDb),
  },
  channel: {
    ...config.channel,
    [config.channel.type]: {
      ...config.channel[config.channel.type],
      botId: process.env.BOT_ID,
      secret: process.env.SECRET,
      debug: process.env.DEBUG === 'true' || config.channel[config.channel.type].debug,
    }
  },
  storage: {
    tempDir: path.resolve(__dirname, config.storage.tempDir),
  }
};

async function main() {
  // 3. 初始化大脑
  const agent = new AgentCore(processedConfig.agent);
  await agent.init();

  // 4. 动态加载渠道
  const channelType = processedConfig.channel.type;
  let ChannelAdapter;
  try {
    ChannelAdapter = require(`./channel/${channelType}/adapter`);
  } catch (err) {
    throw new Error(`Failed to load channel adapter for type: ${channelType}. ${err.message}`);
  }

  const channelConfig = processedConfig.channel[channelType];
  const channel = new ChannelAdapter(channelConfig, processedConfig.storage);

  // 5. 业务编排
  channel.on('message', async ({ userId, text, attachments, context }) => {
    console.log(`[Main] Message from ${userId}: ${text} (${attachments.length} files)`);
    try {
      const response = await agent.chat(userId, text, attachments, (step) => {
        if (step.toolCalls && step.toolCalls.length > 0) {
          console.log(`[Main] Agent tools:`, step.toolCalls.map(tc => tc.toolName).join(', '));
        }
      });
      await channel.reply(userId, response, context);
    } catch (err) {
      console.error('[Main] Chat error:', err);
      await channel.reply(userId, '抱歉，我现在处理消息时遇到了点问题。', context);
    }
  });

  channel.on('user_enter', async ({ userId, context }) => {
    const welcomeMsg = '您好！我是您的智能 AI 员工。我可以为您处理消息和文件。';
    await channel.sendWelcome(userId, welcomeMsg, context);
  });

  await channel.start();
  console.log(`[Main] System is up with channel: ${channelType}`);
}

process.on('SIGINT', () => process.exit());

main().catch(console.error);
