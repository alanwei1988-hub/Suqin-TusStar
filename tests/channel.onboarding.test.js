const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { registerChannelHandlers } = require('../app');
const AgentCore = require('../agent');
const MockChannelAdapter = require('../channel/mock/adapter');
const { resolveUserAgentConfig } = require('../agent/user-config');
const { makeTempDir, repoRoot, waitFor } = require('./helpers/test-helpers');

function createAgentConfig(rootDir) {
  return {
    model: 'mock-model',
    provider: 'openai',
    openai: {
      apiKey: 'test',
      baseURL: 'http://example.invalid/v1',
    },
    workspaceDir: rootDir,
    projectRootDir: rootDir,
    skillsDir: path.join(repoRoot, 'skills'),
    rolePromptDir: path.join(repoRoot, 'roles', 'suqin'),
    sessionDb: path.join(rootDir, 'sessions.db'),
    mcpServers: [],
    scheduler: {
      enabled: false,
    },
  };
}

module.exports = async function runChannelOnboardingTest() {
  const rootDir = makeTempDir('channel-onboarding-');
  const agent = new AgentCore(createAgentConfig(rootDir));
  const channel = new MockChannelAdapter({}, {});

  try {
    await agent.init();
    registerChannelHandlers({
      agent,
      channel,
    });

    await channel.simulateUserEnter({
      userId: 'fresh-user',
      context: {
        reqId: 'welcome-1',
      },
    });

    await waitFor(() => channel.welcomeMessages.some(message => message.userId === 'fresh-user'));
    const freshUserWelcome = channel.welcomeMessages.find(message => message.userId === 'fresh-user');
    assert.match(freshUserWelcome.content, /我是苏秦/);
    assert.equal(agent.shouldSendOnboardingGreeting('fresh-user'), false);

    const { config: historyUserConfig } = resolveUserAgentConfig(agent.config, 'history-user');
    agent.getSessionManager(historyUserConfig.sessionDb).saveMessages('history-user', [
      { role: 'user', content: '之前已经聊过需求了' },
      { role: 'assistant', content: '好的，我继续推进。' },
    ]);

    await channel.simulateUserEnter({
      userId: 'history-user',
      context: {
        reqId: 'welcome-2',
      },
    });

    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(channel.welcomeMessages.some(message => message.userId === 'history-user'), false);

    const { config: preferredAddressConfig } = resolveUserAgentConfig(agent.config, 'known-user');
    const memoryPath = path.join(preferredAddressConfig.userPaths.dataDir, 'memory.json');
    agent.getMemoryManager(memoryPath, {
      reflectionIntervalTurns: preferredAddressConfig.memory?.reflectionIntervalTurns,
    }).applyPatch({
      reason: 'Test preferred address already stored.',
      patch: {
        profile: {
          preferredAddress: 'Alan老师',
          preferredAddressSource: 'test_fixture',
          awaitingPreferredAddressReply: false,
        },
      },
      trigger: 'test_fixture',
    });

    await channel.simulateUserEnter({
      userId: 'known-user',
      context: {
        reqId: 'welcome-3',
      },
    });

    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(channel.welcomeMessages.some(message => message.userId === 'known-user'), false);
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
