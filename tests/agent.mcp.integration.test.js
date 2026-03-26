const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { MockLanguageModelV3 } = require('ai/test');
const AgentCore = require('../agent');
const { createContractMcpFixture, generateResult, makeTempDir, repoRoot, textPart, toolCall } = require('./helpers/test-helpers');

module.exports = async function runAgentMcpIntegrationTest() {
  const rootDir = makeTempDir('agent-mcp-');
  const fixture = createContractMcpFixture(rootDir);
  const attachmentPath = path.join(rootDir, 'contract.pdf');
  const memoryPath = path.join(rootDir, 'storage', 'users', 'u1', 'data', 'memory.json');
  fs.writeFileSync(attachmentPath, 'fake contract file');
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  fs.writeFileSync(memoryPath, JSON.stringify({
    profile: {
      realName: '王小明',
    },
    stats: {},
  }, null, 2));

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
              uploadedBy: '模型里随便写的人',
            },
            sourceFiles: [{ path: attachmentPath, name: 'contract.pdf' }],
            archiveRelativeDir: '采购（启迪支出）\\算力',
            operator: 'wrong-user',
            uploaderUserId: 'wrong-user',
            sourceChannel: 'wrong-channel',
            sourceMessageId: 'wrong-message-id',
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
    ], {
      requestContext: {
        userId: 'u1',
        context: {
          reqId: 'wxwork-req-1',
          channelType: 'wxwork',
          chatId: 'u1',
          chatType: 1,
        },
      },
    });
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
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare(`
      SELECT uploader_user_id, operator, source_channel, source_message_id, uploaded_by
      FROM archive_records
      WHERE contract_name = ?
      ORDER BY archived_at DESC
      LIMIT 1
    `).get('Agent MCP 测试算力采购合同');
    db.close();
    assert.equal(row.uploader_user_id, 'u1');
    assert.equal(row.operator, '王小明');
    assert.equal(row.source_channel, 'wxwork');
    assert.equal(row.source_message_id, 'wxwork-req-1');
    assert.equal(row.uploaded_by, '王小明');
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
