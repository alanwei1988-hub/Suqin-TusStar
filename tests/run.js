const tests = [
  ['app.config', require('./app.config.test')],
  ['contract-mcp.service', require('./contract-mcp.service.test')],
  ['agent.roles', require('./agent.roles.test')],
  ['agent.session', require('./agent.session.test')],
  ['agent.tools', require('./agent.tools.test')],
  ['agent.attachment-session', require('./agent.attachment-session.test')],
  ['mcp.toolkit', require('./mcp.toolkit.test')],
  ['agent.mcp.integration', require('./agent.mcp.integration.test')],
  ['wxwork.adapter', require('./wxwork.adapter.test')],
  ['wecom-bot.callback-queue', require('./wecom-bot.callback-queue.test')],
  ['wecom-bot.logging', require('./wecom-bot.logging.test')],
  ['channel.integration', require('./channel.integration.test')],
  ['channel.streaming-status', require('./channel.streaming-status.test')],
];

async function main() {
  let failed = 0;

  for (const [name, run] of tests) {
    try {
      await run();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}`);
      console.error(error.stack || error.message || error);
    }
  }

  if (failed > 0) {
    process.exitCode = 1;
    console.error(`\n${failed} test(s) failed.`);
    return;
  }

  console.log('\nAll tests passed.');
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
