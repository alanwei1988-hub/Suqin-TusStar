const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
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
          toolCall('mcp-1', 'contract_archive', {
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
          textPart('我先补全关键字段，再继续归档。'),
        ], 'stop');
      }

      if (callIndex === 3) {
        return generateResult([
          toolCall('mcp-2', 'contract_archive', {
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
        textPart('合同已归档并写入数据库。'),
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

    assert.match(response, /合同已归档并写入数据库/);
    assert.equal(fs.existsSync(fixture.dbPath), true);
    const archivedFiles = fs.readdirSync(path.join(fixture.libraryRoot, '专业服务收入协议（活动+算力+商业化）', '算力客户协议（启迪收入）'));
    assert.equal(archivedFiles.some(name => name.includes('算力技术服务协议')), true);
    assert.equal(callIndex, 4);
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }

  const checkpointRootDir = makeTempDir('agent-tool-error-checkpoint-');
  const checkpointFixture = createContractMcpFixture(checkpointRootDir);
  const checkpointAttachmentPath = path.join(checkpointRootDir, 'contract.pdf');
  const checkpointSessionDb = path.join(checkpointRootDir, 'sessions.db');
  fs.writeFileSync(checkpointAttachmentPath, 'tool error checkpoint contract file');

  let checkpointCallIndex = 0;
  const checkpointModel = new MockLanguageModelV3({
    doGenerate: () => {
      checkpointCallIndex += 1;

      if (checkpointCallIndex === 1) {
        return generateResult([
          toolCall('mcp-checkpoint-1', 'contract_archive', {
            sourceFiles: [{ path: checkpointAttachmentPath, name: 'contract.pdf' }],
            archiveRelativeDir: '专业服务收入协议（活动+算力+商业化）\\算力客户协议（启迪收入）',
            sheetName: '有结算款项协议',
            operator: 'user-1',
            uploaderUserId: 'user-1',
          }),
        ]);
      }

      throw new Error('checkpoint-stop');
    },
  });

  const checkpointAgent = new AgentCore({
    model: 'mock-model',
    provider: 'openai',
    openai: {
      apiKey: 'test',
      baseURL: 'http://example.invalid/v1',
    },
    workspaceDir: checkpointRootDir,
    skillsDir: path.join(repoRoot, 'skills'),
    rolePromptDir: path.join(repoRoot, 'roles', 'contract-manager'),
    sessionDb: checkpointSessionDb,
    mcpServers: [checkpointFixture.mcpServer],
  }, { model: checkpointModel });

  try {
    await checkpointAgent.init();
    await assert.rejects(
      () => checkpointAgent.chat('user-1', '帮我归档这份算力合同', [
        { name: 'contract.pdf', path: checkpointAttachmentPath },
      ]),
      /checkpoint-stop/,
    );

    const inspectDb = new Database(checkpointSessionDb, { readonly: true });
    const savedRow = inspectDb.prepare('SELECT messages FROM sessions WHERE userId = ?').get('user-1');
    inspectDb.close();
    assert.equal(Boolean(savedRow), true);
    assert.match(savedRow.messages, /contract_archive/);
    assert.match(savedRow.messages, /不能省略 contract，也不能传空对象/);
  } finally {
    checkpointAgent.close();
    fs.rmSync(checkpointRootDir, { recursive: true, force: true });
  }
};
