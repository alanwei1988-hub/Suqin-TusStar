const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createRuntimeTools } = require('../agent/tools');
const { makeTempDir, repoRoot } = require('./helpers/test-helpers');

module.exports = async function runAgentToolsTest() {
  const rootDir = makeTempDir('agent-tools-');
  const mockMarkItDownHandler = path.join(repoRoot, 'tests', 'helpers', 'mock-markitdown-handler.js');
  const localTextPath = path.join(rootDir, 'notes.md');
  const localPdfPath = path.join(rootDir, 'local.pdf');
  const attachmentTextPath = path.join(rootDir, 'user-upload.txt');
  const attachmentPdfPath = path.join(rootDir, 'scan.pdf');
  const largeTextPath = path.join(rootDir, 'large.txt');

  fs.writeFileSync(localTextPath, 'hello local file');
  fs.writeFileSync(localPdfPath, '%PDF-1.7\nlocal pdf body');
  fs.writeFileSync(attachmentTextPath, 'alpha beta gamma delta');
  fs.writeFileSync(attachmentPdfPath, '%PDF-1.7\nfake pdf body');
  fs.writeFileSync(largeTextPath, 'x'.repeat(300 * 1024));

  const runtime = await createRuntimeTools({
    workspaceDir: rootDir,
    skillsDir: path.join(repoRoot, 'skills'),
    mcpServers: [],
    attachmentExtraction: {
      markitdown: {
        enabled: true,
        handlerModule: mockMarkItDownHandler,
        supportedExtensions: ['.pdf'],
        maxOutputChars: 24000,
      },
    },
    attachments: [
      { id: 'attachment-1', name: 'user-upload.txt', path: attachmentTextPath, kind: 'text' },
      { id: 'attachment-2', name: 'scan.pdf', path: attachmentPdfPath },
    ],
  });

  try {
    const localRead = await runtime.tools.readFile.execute({ path: localTextPath });
    assert.equal(localRead.content, 'hello local file');

    await assert.rejects(
      () => runtime.tools.readFile.execute({ path: attachmentTextPath }),
      /user-provided attachment/i,
    );

    await assert.rejects(
      () => runtime.tools.readFile.execute({ path: localPdfPath }),
      /not a plain text file/i,
    );

    await assert.rejects(
      () => runtime.tools.readFile.execute({ path: largeTextPath }),
      /too large/i,
    );

    const attachmentInspection = await runtime.tools.inspectAttachment.execute({
      attachment: 'attachment-1',
      maxChars: 12,
    });
    assert.equal(attachmentInspection.success, true);
    assert.equal(attachmentInspection.attachment.textLike, true);
    assert.equal(attachmentInspection.preview.text, 'alpha beta g');

    const attachmentText = await runtime.tools.readAttachmentText.execute({
      attachment: 'attachment-1',
      maxChars: 5,
    });
    assert.equal(attachmentText.success, true);
    assert.equal(attachmentText.content, 'alpha');

    const pdfInspection = await runtime.tools.inspectAttachment.execute({
      attachment: 'attachment-2',
    });
    assert.equal(pdfInspection.success, true);
    assert.equal(pdfInspection.attachment.textLike, false);
    assert.equal(pdfInspection.attachment.kind, 'pdf');
    assert.equal(pdfInspection.attachment.extraction.method, 'markitdown');
    assert.match(pdfInspection.preview.text, /Converted scan\.pdf/i);

    const pdfRead = await runtime.tools.readAttachmentText.execute({
      attachment: 'attachment-2',
    });
    assert.equal(pdfRead.success, true);
    assert.match(pdfRead.content, /fake pdf body/i);
    assert.equal(pdfRead.cursorType, 'char');
  } finally {
    await runtime.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
