const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MockLanguageModelV3 } = require('ai/test');
const { registerChannelHandlers } = require('../app');
const AgentCore = require('../agent');
const MockChannelAdapter = require('../channel/mock/adapter');
const { generateResult, makeTempDir, repoRoot, textPart, toolCall, waitFor } = require('./helpers/test-helpers');

module.exports = async function runChannelFileSendFailureTest() {
  const rootDir = makeTempDir('channel-file-send-failure-');
  const reportPath = path.join(rootDir, 'oversized-report.txt');
  fs.writeFileSync(reportPath, 'export ready');
  let callIndex = 0;
  let sendAttempts = 0;

  const model = new MockLanguageModelV3({
    doGenerate: () => {
      callIndex += 1;

      if (callIndex === 1) {
        return generateResult([
          toolCall('send-file-1', 'sendFile', {
            path: reportPath,
            name: 'oversized-report.txt',
          }),
        ]);
      }

      return generateResult([
        textPart('报告已生成，文件已发送。'),
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
    channel.createStreamingReply = undefined;
    channel.sendAttachments = async () => {
      sendAttempts += 1;
      throw new Error('初始化上传失败: file too large (代码: 40058)');
    };

    await agent.init();
    registerChannelHandlers({ agent, channel });

    await channel.simulateMessage({
      userId: 'user-1',
      text: '把大文件发给我',
      context: { reqId: 'mock-req' },
    });

    await waitFor(() => channel.replies.length > 0);
    assert.equal(sendAttempts, 1);
    assert.equal(channel.replies[0].content.includes('文件太大，当前无法直接发送。'), true);
    assert.equal(channel.replies[0].content.includes(`[oversized-report.txt](file:///`), true);
    assert.equal(channel.replies[0].content.includes(reportPath), true);
    assert.equal(channel.replies[0].content.includes('报告已生成，文件已发送。'), false);
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
