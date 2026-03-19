const tests = [
  ['app.config', require('./app.config.test')],
  ['contract-mcp.service', require('./contract-mcp.service.test')],
  ['agent.roles', require('./agent.roles.test')],
  ['mcp.toolkit', require('./mcp.toolkit.test')],
  ['agent.mcp.integration', require('./agent.mcp.integration.test')],
  ['channel.integration', require('./channel.integration.test')],
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
