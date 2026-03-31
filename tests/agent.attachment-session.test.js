const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MockLanguageModelV3 } = require('ai/test');
const AgentCore = require('../agent');
const { generateResult, makeTempDir, repoRoot, textPart, toolCall } = require('./helpers/test-helpers');

module.exports = async function runAgentAttachmentSessionTest() {
  const rootDir = makeTempDir('agent-attachment-session-');
  const attachmentPath = path.join(rootDir, 'meeting-notes.docx');
  const pdfAttachmentPath = path.join(rootDir, 'scan.pdf');
  const mockMarkItDownHandler = path.join(repoRoot, 'tests', 'helpers', 'mock-markitdown-handler.js');
  const countingMarkItDownHandler = path.join(rootDir, 'counting-markitdown-handler.js');
  fs.writeFileSync(attachmentPath, '第一部分：项目范围。\n第二部分：验收节点。\n');
  fs.writeFileSync(pdfAttachmentPath, `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF`);
  fs.writeFileSync(countingMarkItDownHandler, `module.exports = async function countingMarkItDownHandler({ attachmentPath, options = {} }) {
  global.__agentAttachmentSessionHandlerCalls = (global.__agentAttachmentSessionHandlerCalls || 0) + 1;
  const fs = require('fs');
  const path = require('path');
  const pageStart = Number.isFinite(options.pageStart) ? options.pageStart : 1;
  const pageCount = Number.isFinite(options.pageCount) ? options.pageCount : 0;
  return '# Converted ' + path.basename(attachmentPath) + '\\n\\nPage start: ' + pageStart + '\\nPage count: ' + (pageCount || 'all') + '\\n\\n' + fs.readFileSync(attachmentPath, 'utf8') + '\\n';
};
`, 'utf8');
  delete global.__agentAttachmentSessionHandlerCalls;

  let docxCallIndex = 0;
  const docxModel = new MockLanguageModelV3({
    doGenerate: ({ prompt }) => {
      docxCallIndex += 1;

      if (docxCallIndex === 1) {
        return generateResult([
          toolCall('file-read-1', 'readFile', {
            path: attachmentPath,
            maxChars: 2000,
          }),
        ]);
      }

      if (docxCallIndex === 2) {
        const serializedPrompt = JSON.stringify(prompt);
        assert.match(serializedPrompt, /meeting-notes\.docx/);
        assert.match(serializedPrompt, /第一部分：项目范围/);

        return generateResult([
          textPart('文档主要说明了项目范围和验收节点。'),
        ], 'stop');
      }

      if (docxCallIndex === 3) {
        return generateResult([
          toolCall('file-read-2', 'readFile', {
            path: 'meeting-notes.docx',
            maxChars: 2000,
          }),
        ]);
      }

      const serializedPrompt = JSON.stringify(prompt);
      assert.match(serializedPrompt, /第一部分：项目范围/);

      return generateResult([
        textPart('再次读取后，文档仍然主要说明了项目范围和验收节点。'),
      ], 'stop');
    },
  });

  const pdfModel = new MockLanguageModelV3({
    doGenerate: ({ prompt }) => {
      const serializedPrompt = JSON.stringify(prompt);
      assert.match(serializedPrompt, /scan\.pdf/);
      assert.match(serializedPrompt, /Pages: 2/);

      return generateResult([
        textPart('请说明需要如何处理这份文件。'),
      ], 'stop');
    },
  });

  const docxAgent = new AgentCore({
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
        handlerModule: countingMarkItDownHandler,
        supportedExtensions: ['.docx'],
        maxOutputChars: 24000,
      },
    },
  }, { model: docxModel });

  const pdfAgent = new AgentCore({
    model: 'mock-model',
    provider: 'openai',
    openai: {
      apiKey: 'test',
      baseURL: 'http://example.invalid/v1',
    },
    workspaceDir: rootDir,
    skillsDir: path.join(repoRoot, 'skills'),
    rolePromptDir: path.join(repoRoot, 'roles', 'contract-manager'),
    sessionDb: path.join(rootDir, 'pdf-sessions.db'),
    mcpServers: [],
    attachmentExtraction: {
      markitdown: {
        enabled: true,
        handlerModule: mockMarkItDownHandler,
        supportedExtensions: ['.docx'],
        maxOutputChars: 24000,
      },
    },
  }, { model: pdfModel });

  try {
    await docxAgent.init();
    await pdfAgent.init();

    const firstReply = await docxAgent.chat('u1', '[Sent a file: meeting-notes.docx]', [
      { name: 'meeting-notes.docx', path: attachmentPath, kind: 'document' },
    ]);
    assert.equal(firstReply, '文档主要说明了项目范围和验收节点。');

    const secondReply = await docxAgent.chat('u1', '再总结一次');
    assert.equal(secondReply, '再次读取后，文档仍然主要说明了项目范围和验收节点。');
    assert.equal(global.__agentAttachmentSessionHandlerCalls, 1);

    const thirdReply = await pdfAgent.chat('u2', '[Sent a file: scan.pdf]', [
      { name: 'scan.pdf', path: pdfAttachmentPath, kind: 'pdf', extension: '.pdf', mimeType: 'application/pdf' },
    ]);
    assert.equal(thirdReply, '请说明需要如何处理这份文件。');
    const savedMessages = pdfAgent.sessionManager.getMessages('u2');
    assert.equal(savedMessages[0].attachments[0].pageCount, 2);
    assert.equal(savedMessages[0].attachments[0].pageRangeSupported, true);
    assert.equal(docxCallIndex, 4);
  } finally {
    docxAgent.close();
    pdfAgent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
