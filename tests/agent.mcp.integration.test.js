const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MockLanguageModelV3 } = require('ai/test');
const AgentCore = require('../agent');
const { createContractMcpFixture, generateResult, makeTempDir, psQuote, repoRoot, toolCall } = require('./helpers/test-helpers');

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
          toolCall('bash-1', 'bash', {
            command: `Get-ChildItem -Force ${psQuote(rootDir)}`,
          }),
        ]);
      }

      if (callIndex === 2) {
        return generateResult([
          toolCall('mcp-1', 'contract_create', {
            contract: {
              contractName: 'Agent MCP 测试合同',
              partyAName: '甲方公司',
              partyBName: '乙方公司',
              signingDate: '2026-03-19',
              effectiveEndDate: '2026-12-31',
              contractAmount: 9999,
              summary: 'Agent 和 MCP 联调',
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
          answer: '合同已归档',
          summary: 'created contract',
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

  try {
    await agent.init();
    const response = await agent.chat('u1', '请帮我归档这份合同', [
      { name: 'contract.pdf', path: attachmentPath },
    ]);

    assert.equal(response, '合同已归档');
    const contractDirs = fs.readdirSync(path.join(fixture.storageRoot, 'contracts'));
    assert.equal(contractDirs.length, 1);
    assert.equal(fs.existsSync(path.join(fixture.storageRoot, 'contracts', contractDirs[0], 'metadata.json')), true);
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
