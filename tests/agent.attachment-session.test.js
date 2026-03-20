const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MockLanguageModelV3 } = require('ai/test');
const AgentCore = require('../agent');
const { generateResult, makeTempDir, repoRoot, textPart, toolCall } = require('./helpers/test-helpers');

module.exports = async function runAgentAttachmentSessionTest() {
  const rootDir = makeTempDir('agent-attachment-session-');
  const attachmentPath = path.join(rootDir, 'meeting-notes.docx');
  const mockMarkItDownHandler = path.join(repoRoot, 'tests', 'helpers', 'mock-markitdown-handler.js');
  fs.writeFileSync(attachmentPath, '第一部分：项目范围。\n第二部分：验收节点。\n');

  let callIndex = 0;
  const model = new MockLanguageModelV3({
    doGenerate: ({ prompt }) => {
      callIndex += 1;

      if (callIndex === 1) {
        return generateResult([
          textPart('请说明需要如何处理这份文件。'),
        ], 'stop');
      }

      if (callIndex === 2) {
        const serializedPrompt = JSON.stringify(prompt);
        assert.match(serializedPrompt, /meeting-notes\.docx/);
        assert.match(serializedPrompt, /readAttachmentText/);

        return generateResult([
          toolCall('attachment-read-1', 'readAttachmentText', {
            attachment: 'meeting-notes.docx',
            maxChars: 2000,
          }),
        ]);
      }

      const serializedPrompt = JSON.stringify(prompt);
      assert.match(serializedPrompt, /第一部分：项目范围/);

      return generateResult([
        textPart('文档主要说明了项目范围和验收节点。'),
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
    attachmentExtraction: {
      markitdown: {
        enabled: true,
        handlerModule: mockMarkItDownHandler,
        supportedExtensions: ['.docx'],
        maxOutputChars: 24000,
      },
    },
  }, { model });

  try {
    await agent.init();

    const firstReply = await agent.chat('u1', '[Sent a file: meeting-notes.docx]', [
      { name: 'meeting-notes.docx', path: attachmentPath, kind: 'document' },
    ]);
    assert.equal(firstReply, '请说明需要如何处理这份文件。');

    const secondReply = await agent.chat('u1', '内容总结');
    assert.equal(secondReply, '文档主要说明了项目范围和验收节点。');
    assert.equal(callIndex, 3);
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
