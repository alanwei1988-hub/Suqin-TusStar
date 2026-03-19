const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MockLanguageModelV3 } = require('ai/test');
const AgentCore = require('../agent');
const { loadRolePrompt } = require('../agent/roles');
const { generateResult, makeTempDir, repoRoot, toolCall } = require('./helpers/test-helpers');

module.exports = async function runAgentRoleTest() {
  const rolePrompt = await loadRolePrompt(path.join(repoRoot, 'roles', 'contract-manager'));
  assert.match(rolePrompt, /合同管理员/);
  assert.match(rolePrompt, /不要编造/);

  const rootDir = makeTempDir('agent-role-');
  const model = new MockLanguageModelV3({
    doGenerate: () => generateResult([
      toolCall('done-1', 'done', {
        answer: 'ok',
        summary: 'finished',
        verified: true,
      }),
    ]),
  });

  const agent = new AgentCore({
    model: 'mock-model',
    provider: 'openai',
    openai: {
      apiKey: 'test',
      baseURL: 'http://example.invalid/v1',
    },
    workspaceDir: repoRoot,
    skillsDir: path.join(repoRoot, 'skills'),
    rolePromptDir: path.join(repoRoot, 'roles', 'contract-manager'),
    sessionDb: path.join(rootDir, 'sessions.db'),
    mcpServers: [],
  }, { model });

  try {
    await agent.init();
    const response = await agent.chat('u1', '你好');
    assert.equal(response, 'ok');
    assert.equal(model.doGenerateCalls.length > 0, true);
    assert.match(JSON.stringify(model.doGenerateCalls[0].prompt), /合同管理员/);
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
