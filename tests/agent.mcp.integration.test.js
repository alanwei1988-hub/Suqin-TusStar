const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MockLanguageModelV3 } = require('ai/test');
const AgentCore = require('../agent');
const { createContractMcpFixture, generateResult, makeTempDir, repoRoot, textPart, toolCall } = require('./helpers/test-helpers');

module.exports = async function runAgentMcpIntegrationTest() {
  const rootDir = makeTempDir('agent-mcp-');
  const fixture = createContractMcpFixture(rootDir);
  const attachmentPath = path.join(rootDir, 'contract.pdf');
  fs.writeFileSync(attachmentPath, 'fake contract file');
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
              contractName: 'Agent MCP 测试算力采购合同',
              agreementType: '采购',
              partyAName: '上海启迪',
              partyBName: '算力供应商',
              signingDate: '2026-03-19',
              contractAmount: 9999,
              uploadedBy: 'tester',
            },
            sourceFiles: [{ path: attachmentPath, name: 'contract.pdf' }],
            archiveRelativeDir: '采购（启迪支出）\\算力',
            operator: 'tester',
            uploaderUserId: 'u1',
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
            operator: 'u1',
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

      return generateResult([textPart('合同已归档')], 'stop');
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
    const firstResponse = await agent.chat('u1', '请帮我归档这份合同', [
      { name: 'contract.pdf', path: attachmentPath },
    ]);
    assert.match(firstResponse, /请确认协议归档与台账信息/);
    pendingId = JSON.parse(fs.readFileSync(fixture.statePath, 'utf8')).pendingRecords[0].pendingId;

    const secondResponse = await agent.chat('u1', `确认 ${pendingId}`, [], {
      includeArtifacts: true,
      requestContext: {
        userId: 'u1',
        context: { chatId: 'u1', chatType: 1 },
      },
      messaging: {
        enabled: true,
        recipients: {
          contract_admin: {
            userId: 'admin-1',
            label: '合同管理员',
          },
        },
      },
    });

    assert.equal(secondResponse.text, '合同已归档');
    assert.equal(secondResponse.outboundNotifications.length, 1);
    assert.equal(secondResponse.outboundNotifications[0].recipient.userId, 'admin-1');
    const archivedFiles = servicePaths(fixture.libraryRoot);
    assert.equal(archivedFiles.some(filePath => filePath.includes('Agent MCP 测试算力采购合同')), true);
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};

function servicePaths(rootDir) {
  const files = [];

  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      files.push(fullPath);
    }
  }

  walk(rootDir);
  return files;
}
