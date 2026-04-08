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

module.exports = async function runAgentDocumentContextTest() {
  const rootDir = makeTempDir('agent-document-context-');
  const generatedDocxPath = path.join(rootDir, 'storage', 'users', 'u1', 'workspace', 'generated', 'weekly-report.docx');
  fs.mkdirSync(path.dirname(generatedDocxPath), { recursive: true });
  fs.writeFileSync(generatedDocxPath, 'fake-docx-binary');

  let callIndex = 0;
  const model = new MockLanguageModelV3({
    doGenerate: ({ prompt }) => {
      callIndex += 1;

      if (callIndex === 1) {
        return generateResult([
          toolCall('send-file-1', 'sendFile', {
            path: generatedDocxPath,
            name: 'weekly-report.docx',
          }),
        ]);
      }

      if (callIndex === 2) {
        return generateResult([
          textPart('Word 已经发给您了。'),
        ], 'stop');
      }

      const serializedPrompt = JSON.stringify(prompt);
      assert.match(serializedPrompt, /weekly-report\.docx/);
      assert.match(serializedPrompt, /assistant-generated files from earlier turns/i);

      return generateResult([
        textPart('我会基于刚才那份 Word 继续修改。'),
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

    const firstReply = await agent.chat('u1', '先把本周周报 Word 发给我');
    assert.equal(firstReply, 'Word 已经发给您了。');

    const savedMessages = agent.sessionManager.getMessages('u1');
    const latestAssistantMessage = findLastAssistantMessage(savedMessages);
    assert.ok(latestAssistantMessage);
    assert.equal(Array.isArray(latestAssistantMessage.attachments), true);
    assert.equal(latestAssistantMessage.attachments[0].path, generatedDocxPath);
    assert.equal(latestAssistantMessage.attachments[0].kind, 'file');

    const secondReply = await agent.chat('u1', '基于刚才那份 Word 再补一页执行建议');
    assert.equal(secondReply, '我会基于刚才那份 Word 继续修改。');
    assert.equal(callIndex, 3);
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
