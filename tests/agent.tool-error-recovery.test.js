const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MockLanguageModelV3 } = require('ai/test');
const AgentCore = require('../agent');
const { createContractMcpFixture, generateResult, makeTempDir, repoRoot, textPart, toolCall } = require('./helpers/test-helpers');

module.exports = async function runAgentToolErrorRecoveryTest() {
  const rootDir = makeTempDir('agent-tool-error-recovery-');
  const fixture = createContractMcpFixture(rootDir);
  const attachmentPath = path.join(rootDir, 'contract.pdf');
  fs.writeFileSync(attachmentPath, 'tool error recovery contract file');

  let callIndex = 0;
  const model = new MockLanguageModelV3({
    doGenerate: () => {
      callIndex += 1;

      if (callIndex === 1) {
        return generateResult([
          toolCall('mcp-1', 'contract_prepare_archive', {
            sourceFiles: [{ path: attachmentPath, name: 'contract.pdf' }],
            archiveRelativeDir: '专业服务收入协议（活动+算力+商业化）\\算力客户协议（启迪收入）',
            sheetName: '有结算款项协议',
            operator: 'user-1',
            uploaderUserId: 'user-1',
          }),
        ]);
      }

      if (callIndex === 2) {
        return generateResult([
          textPart('我先帮你完成了归档判断，但还不能正式入库。'),
        ], 'stop');
      }

      if (callIndex === 3) {
        return generateResult([
          toolCall('mcp-2', 'contract_prepare_archive', {
            contract: {
              contractName: '算力技术服务协议',
              agreementType: '算力技术服务协议',
              partyAName: '艾哎思维（上海）科技有限公司',
              partyBName: '上海启迪创业孵化器有限公司',
              otherPartyName: '艾哎思维（上海）科技有限公司',
              signingDate: '2025-12-01',
              direction: 'income',
              uploadedBy: 'user-1',
              hasSettlement: true,
            },
            sourceFiles: [{ path: attachmentPath, name: 'contract.pdf' }],
            archiveRelativeDir: '专业服务收入协议（活动+算力+商业化）\\算力客户协议（启迪收入）',
            sheetName: '有结算款项协议',
            operator: 'user-1',
            uploaderUserId: 'user-1',
          }),
        ]);
      }

      return generateResult([
        textPart('已生成待确认归档记录，请确认协议归档与台账信息。'),
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
    mcpServers: [fixture.mcpServer],
  }, { model });

  try {
    await agent.init();
    const response = await agent.chat('user-1', '帮我归档这份算力合同', [
      { name: 'contract.pdf', path: attachmentPath },
    ]);

    assert.match(response, /已生成待确认归档记录/);
    const state = JSON.parse(fs.readFileSync(fixture.statePath, 'utf8'));
    assert.equal(state.pendingRecords.length, 1);
    assert.equal(state.pendingRecords[0].archive.relativeDir, '专业服务收入协议（活动+算力+商业化）\\算力客户协议（启迪收入）');
    assert.equal(callIndex, 4);
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
