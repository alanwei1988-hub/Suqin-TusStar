const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MockLanguageModelV3 } = require('ai/test');
const { registerChannelHandlers } = require('../app');
const AgentCore = require('../agent');
const MockChannelAdapter = require('../channel/mock/adapter');
const { generateResult, makeTempDir, repoRoot, textPart, toolCall, waitFor } = require('./helpers/test-helpers');

module.exports = async function runChannelFileReplyTest() {
  const rootDir = makeTempDir('channel-file-reply-');
  const reportPath = path.join(rootDir, 'report.txt');
  fs.writeFileSync(reportPath, 'export ready');
  let callIndex = 0;

  const model = new MockLanguageModelV3({
    doGenerate: () => {
      callIndex += 1;

      if (callIndex === 1) {
        return generateResult([
          toolCall('read-file-1', 'readFile', {
            path: reportPath,
          }),
        ]);
      }

      if (callIndex === 2) {
        return generateResult([
          toolCall('send-file-1', 'sendFile', {
            path: reportPath,
            name: 'report.txt',
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
    await agent.init();
    registerChannelHandlers({ agent, channel });

    await channel.simulateMessage({
      userId: 'user-1',
      text: '把报告发给我',
      context: { reqId: 'mock-req' },
    });

    await waitFor(() => channel.replies.length > 0);
    assert.equal(channel.replies[0].content, '报告已生成，文件已发送。');

    await waitFor(() => channel.sentAttachments.length === 1);
    assert.deepEqual(channel.sentAttachments[0], {
      userId: 'user-1',
      attachments: [{
        path: reportPath,
        name: 'report.txt',
        sizeBytes: fs.statSync(reportPath).size,
      }],
      context: { reqId: 'mock-req' },
    });
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
