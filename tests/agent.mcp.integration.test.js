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
          toolCall('mcp-2', 'contract_archive', {
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
          textPart('合同已归档'),
        ]);
      }

      if (callIndex === 4) {
        return generateResult([
          toolCall('mcp-3', 'contract_search_archive_records', {
            keyword: 'Agent MCP 测试算力采购合同',
            limit: 5,
          }),
        ]);
      }

      return generateResult([textPart('归档记录已检索')], 'stop');
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
    assert.match(firstResponse, /合同已归档/);

    const searchResponse = await agent.chat('u1', '帮我查一下刚才归档的记录', [], {
      includeArtifacts: true,
      requestContext: {
        userId: 'u1',
        context: { chatId: 'u1', chatType: 1 },
      },
    });

    assert.equal(searchResponse.text, '归档记录已检索');
    const archivedFiles = servicePaths(fixture.libraryRoot);
    assert.equal(archivedFiles.some(filePath => filePath.includes('Agent MCP 测试算力采购合同')), true);
    const dbPath = path.join(fixture.libraryRoot, '合同归档.db');
    assert.equal(fs.existsSync(dbPath), true);
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
