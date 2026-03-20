const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MockLanguageModelV3 } = require('ai/test');
const { registerChannelHandlers } = require('../app');
const AgentCore = require('../agent');
const MockChannelAdapter = require('../channel/mock/adapter');
const { generateResult, makeTempDir, repoRoot, textPart, toolCall, waitFor } = require('./helpers/test-helpers');

module.exports = async function runChannelStreamingStatusTest() {
  const rootDir = makeTempDir('channel-status-');
  let callIndex = 0;

  const model = new MockLanguageModelV3({
    doGenerate: () => {
      callIndex += 1;

      if (callIndex === 1) {
        return generateResult([
          toolCall('bash-1', 'bash', {
            command: 'Write-Output step-1',
          }),
        ]);
      }

      if (callIndex === 2) {
        return generateResult([
          toolCall('bash-2', 'bash', {
            command: 'Start-Sleep -Milliseconds 900; Write-Output step-2',
          }),
        ]);
      }

      return generateResult([
        textPart('状态测试完成'),
      ], 'stop');
    },
  });

  const agent = new AgentCore({
    model: 'mock-model',
    provider: 'openai',
    openai: {
      apiKey: 'test',
      baseURL: 'http://example.invalid/v1',
    },
    workspaceDir: rootDir,
    skillsDir: path.join(repoRoot, 'skills'),
    rolePromptDir: path.join(repoRoot, 'roles', 'contract-manager'),
    sessionDb: path.join(rootDir, 'sessions.db'),
    mcpServers: [],
  }, { model });
  const channel = new MockChannelAdapter({}, {});

  try {
    await agent.init();
    registerChannelHandlers({ agent, channel });

    await channel.simulateMessage({
      userId: 'user-1',
      text: '连续执行两个 bash',
      context: { reqId: 'mock-req' },
    });

    await waitFor(() => channel.streamReplies.length === 1);
    const stream = channel.streamReplies[0];

    await waitFor(() => stream.updates.some(update => update.kind === 'status' && update.content.includes('第 1 步') && update.content.includes('bash')));
    await waitFor(
      () => stream.finalContent.length === 0
        && stream.updates.some(update => update.kind === 'status' && update.content.includes('第 2 步') && update.content.includes('bash')),
      { timeoutMs: 400, intervalMs: 20 },
    );

    await waitFor(() => channel.replies.length > 0);
    assert.equal(channel.replies[0].content, '状态测试完成');
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
