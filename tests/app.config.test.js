const assert = require('node:assert/strict');
const { processConfig } = require('../app');

module.exports = async function runAppConfigTest() {
  const baseConfig = {
    agent: {
      model: 'test-model',
      provider: 'openai',
      openai: {
        baseURL: 'http://example.invalid/v1',
      },
      skillsDir: './skills',
      rolePromptDir: './roles/contract-manager',
      sessionDb: './data/sessions.db',
      mcpServers: [],
    },
    channel: {
      type: 'wxwork',
      wxwork: {
        debug: false,
      },
    },
    storage: {
      tempDir: './storage/temp',
    },
  };

  const processedDefault = processConfig(baseConfig, {
    rootDir: __dirname,
    env: {},
  });
  assert.equal(processedDefault.channel.wxwork.streamingResponse, true);

  const processedDisabled = processConfig({
    ...baseConfig,
    channel: {
      ...baseConfig.channel,
      wxwork: {
        ...baseConfig.channel.wxwork,
        streamingResponse: false,
      },
    },
  }, {
    rootDir: __dirname,
    env: {},
  });
  assert.equal(processedDisabled.channel.wxwork.streamingResponse, false);
};
