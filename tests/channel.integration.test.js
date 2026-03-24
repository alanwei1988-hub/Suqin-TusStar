const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MockLanguageModelV3 } = require('ai/test');
const { registerChannelHandlers } = require('../app');
const AgentCore = require('../agent');
const MockChannelAdapter = require('../channel/mock/adapter');
const { createContractMcpFixture, generateResult, makeTempDir, repoRoot, textPart, toolCall, waitFor } = require('./helpers/test-helpers');

module.exports = async function runChannelIntegrationTest() {
  const rootDir = makeTempDir('channel-mcp-');
  const fixture = createContractMcpFixture(rootDir);
  const attachmentPath = path.join(rootDir, 'contract.pdf');
  fs.writeFileSync(attachmentPath, 'channel contract file');
  let pendingId = '';

  let callIndex = 0;
  const model = new MockLanguageModelV3({
    doGenerate: () => {
      callIndex += 1;

      if (callIndex === 1) {
        return generateResult([
          toolCall('mcp-1', 'contract_list_directory', {
            relativePath: '采购（启迪支出）',
            depth: 2,
          }),
        ]);
      }

      if (callIndex === 2) {
        return generateResult([
          toolCall('mcp-2', 'contract_prepare_archive', {
            contract: {
              contractName: '渠道联调算力合同',
              agreementType: '采购',
              partyAName: '上海启迪',
              partyBName: '乙方',
              signingDate: '2026-03-19',
              uploadedBy: 'tester',
            },
            sourceFiles: [{ path: attachmentPath, name: 'contract.pdf' }],
            archiveRelativeDir: '采购（启迪支出）\\算力',
            operator: 'tester',
            uploaderUserId: 'user-1',
          }),
        ]);
      }

      if (callIndex === 3) {
        return generateResult([
          textPart('请确认协议归档与台账信息'),
        ], 'stop');
      }

      if (callIndex === 4) {
        return generateResult([
          toolCall('mcp-3', 'contract_confirm_archive', {
            pendingId,
            operator: 'user-1',
          }),
        ]);
      }

      if (callIndex === 5) {
        return generateResult([
          toolCall('notify-1', 'notifyUser', {
            recipient: 'contract_admin',
            content: `待录入协议台账\n编号：${pendingId}`,
          }),
        ]);
      }

      return generateResult([textPart('渠道测试完成')], 'stop');
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
    mcpServers: [fixture.mcpServer],
  }, { model });
  const channel = new MockChannelAdapter({}, {});

  try {
    await agent.init();
    registerChannelHandlers({
      agent,
      channel,
      contractMcpConfig: fixture.contractConfig,
    });

    await channel.simulateMessage({
      userId: 'user-1',
      text: '帮我存这份合同',
      attachments: [{ name: 'contract.pdf', path: attachmentPath }],
      context: { reqId: 'mock-req' },
    });

    await waitFor(() => channel.replies.length > 0);
    assert.match(channel.replies[0].content, /请确认协议归档与台账信息/);
    pendingId = JSON.parse(fs.readFileSync(fixture.statePath, 'utf8')).pendingRecords[0].pendingId;

    await channel.simulateMessage({
      userId: 'user-1',
      text: `确认 ${pendingId}`,
      attachments: [],
      context: { reqId: 'mock-req-2' },
    });

    await waitFor(() => channel.replies.length > 1);
    assert.equal(channel.replies[1].content, '渠道测试完成');
    assert.equal(channel.streamReplies.length, 2);
    assert.equal(channel.streamReplies[0].updates.length > 1, true);
    assert.equal(channel.sentTexts.length, 1);
    assert.equal(channel.sentTexts[0].userId, 'admin-1');
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
