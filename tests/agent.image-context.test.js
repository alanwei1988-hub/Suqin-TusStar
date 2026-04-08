const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MockLanguageModelV3 } = require('ai/test');
const AgentCore = require('../agent');
const { generateResult, makeTempDir, repoRoot, textPart, toolCall } = require('./helpers/test-helpers');

function findLastAssistantMessage(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') {
      return messages[index];
    }
  }

  return null;
}

module.exports = async function runAgentImageContextTest() {
  const rootDir = makeTempDir('agent-image-context-');
  const generatedPosterPath = path.join(rootDir, 'storage', 'users', 'u1', 'workspace', 'generated', 'poster-warm.png');
  fs.mkdirSync(path.dirname(generatedPosterPath), { recursive: true });
  fs.writeFileSync(generatedPosterPath, 'fake-png-bytes');

  let callIndex = 0;
  const model = new MockLanguageModelV3({
    doGenerate: ({ prompt }) => {
      callIndex += 1;

      if (callIndex === 1) {
        return generateResult([
          toolCall('send-file-1', 'sendFile', {
            path: generatedPosterPath,
            name: 'poster-warm.png',
          }),
        ]);
      }

      if (callIndex === 2) {
        return generateResult([
          textPart('海报已经发给您了。'),
        ], 'stop');
      }

      const serializedPrompt = JSON.stringify(prompt);
      assert.match(serializedPrompt, /poster-warm\.png/);
      assert.match(serializedPrompt, /assistant-generated files from earlier turns/i);

      return generateResult([
        textPart('我会沿用上一张海报继续修改。'),
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

  try {
    await agent.init();

    const firstReply = await agent.chat('u1', '先把海报发给我');
    assert.equal(firstReply, '海报已经发给您了。');

    const savedMessages = agent.sessionManager.getMessages('u1');
    const latestAssistantMessage = findLastAssistantMessage(savedMessages);
    assert.ok(latestAssistantMessage);
    assert.equal(Array.isArray(latestAssistantMessage.attachments), true);
    assert.equal(latestAssistantMessage.attachments[0].path, generatedPosterPath);
    assert.equal(latestAssistantMessage.attachments[0].kind, 'image');

    const secondReply = await agent.chat('u1', '基于上一张海报继续改，保留构图');
    assert.equal(secondReply, '我会沿用上一张海报继续修改。');
    assert.equal(callIndex, 3);
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
