const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MockLanguageModelV3 } = require('ai/test');
const { registerChannelHandlers } = require('../app');
const AgentCore = require('../agent');
const MockChannelAdapter = require('../channel/mock/adapter');
const { createContractMcpFixture, generateResult, makeTempDir, psQuote, repoRoot, toolCall, waitFor } = require('./helpers/test-helpers');

module.exports = async function runChannelIntegrationTest() {
  const rootDir = makeTempDir('channel-mcp-');
  const fixture = createContractMcpFixture(rootDir);
  const attachmentPath = path.join(rootDir, 'contract.pdf');
  fs.writeFileSync(attachmentPath, 'channel contract file');

  let callIndex = 0;
  const model = new MockLanguageModelV3({
    doGenerate: () => {
      callIndex += 1;

      if (callIndex === 1) {
        return generateResult([
          toolCall('bash-1', 'bash', {
            command: `Get-ChildItem -Force ${psQuote(rootDir)}`,
          }),
        ]);
      }

      if (callIndex === 2) {
        return generateResult([
          toolCall('mcp-1', 'contract_create', {
            contract: {
              contractName: '渠道联调合同',
              partyAName: '甲方',
              partyBName: '乙方',
              signingDate: '2026-03-19',
              uploadedBy: 'tester',
            },
            files: [{ path: attachmentPath, role: 'scan' }],
            operator: 'tester',
          }),
        ]);
      }

      if (callIndex === 3) {
        return generateResult([
          toolCall('bash-2', 'bash', {
            command: `Get-ChildItem -Recurse ${psQuote(fixture.storageRoot)}`,
          }),
        ]);
      }

      return generateResult([
        toolCall('done-1', 'done', {
          answer: '渠道测试完成',
          summary: 'channel ok',
          verified: true,
        }),
      ]);
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
    registerChannelHandlers({ agent, channel });

    await channel.simulateMessage({
      userId: 'user-1',
      text: '帮我存这份合同',
      attachments: [{ name: 'contract.pdf', path: attachmentPath }],
      context: { reqId: 'mock-req' },
    });

    await waitFor(() => channel.replies.length > 0);
    assert.equal(channel.replies[0].content, '渠道测试完成');
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
