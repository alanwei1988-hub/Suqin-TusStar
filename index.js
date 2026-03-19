const {
  createAgent,
  loadChannelAdapter,
  loadRawConfig,
  processConfig,
  registerChannelHandlers,
} = require('./app');

const processedConfig = processConfig(loadRawConfig(__dirname), { rootDir: __dirname, env: process.env });

async function main() {
  const agent = await createAgent(processedConfig);

  const channelType = processedConfig.channel.type;
  const ChannelAdapter = await loadChannelAdapter(channelType);
  const channelConfig = processedConfig.channel[channelType];
  const channel = new ChannelAdapter(channelConfig, processedConfig.storage);
  registerChannelHandlers({ agent, channel });

  await channel.start();
  console.log(`[Main] System is up with channel: ${channelType}`);
}

process.on('SIGINT', () => process.exit());

main().catch(console.error);
