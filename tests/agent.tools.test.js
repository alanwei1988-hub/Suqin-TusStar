const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  buildBashToolPrompt,
  createRuntimeTools,
  decodeShellOutput,
  getBlockedCommandReason,
  wrapWindowsPowerShellCommand,
} = require('../agent/tools');
const { makeTempDir, repoRoot } = require('./helpers/test-helpers');

module.exports = async function runAgentToolsTest() {
  const rootDir = makeTempDir('agent-tools-');
  const mockMarkItDownHandler = path.join(repoRoot, 'tests', 'helpers', 'mock-markitdown-handler.js');
  const localTextPath = path.join(rootDir, 'notes.md');
  const localPdfPath = path.join(rootDir, 'local.pdf');
  const attachmentTextPath = path.join(rootDir, 'user-upload.txt');
  const attachmentPdfPath = path.join(rootDir, 'scan.pdf');
  const attachmentPagedPdfPath = path.join(rootDir, 'paged.pdf');
  const largeTextPath = path.join(rootDir, 'large.txt');
  const failingHandlerPath = path.join(rootDir, 'failing-markitdown-handler.js');
  const pagedHandlerPath = path.join(rootDir, 'paged-markitdown-handler.js');

  fs.writeFileSync(localTextPath, 'hello local file');
  fs.writeFileSync(localPdfPath, '%PDF-1.7\nlocal pdf body');
  fs.writeFileSync(attachmentTextPath, 'alpha beta gamma delta');
  fs.writeFileSync(attachmentPdfPath, `%PDF-1.7
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
  fs.writeFileSync(attachmentPagedPdfPath, `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 4 /Kids [3 0 R 4 0 R 5 0 R 6 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>
endobj
5 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>
endobj
6 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF`);
  fs.writeFileSync(largeTextPath, 'x'.repeat(300 * 1024));
  fs.writeFileSync(failingHandlerPath, `const { createExtractionError } = require(${JSON.stringify(path.join(repoRoot, 'markitdown', 'extractor.js'))});
module.exports = async function failingHandler({ llm, profileName }) {
  if (llm && llm.model === 'primary-ocr-model') {
    throw createExtractionError('primary ocr failed', {
      code: 'ocr_safety_review_blocked',
      userMessage: 'OCR 模型触发了安全审查，当前模型无法继续提取该附件内容。',
      rawMessage: 'data_inspection_failed',
      primaryProfile: profileName,
      canRetryWithFallback: true,
    });
  }
  throw createExtractionError('fallback ocr failed', {
    code: 'ocr_request_failed',
    userMessage: 'OCR 模型请求失败，当前未能提取附件文本。',
    rawMessage: 'fallback request failed',
    primaryProfile: 'qwen-vl',
    fallbackProfile: profileName,
  });
};`, 'utf8');
  fs.writeFileSync(pagedHandlerPath, `module.exports = async function pagedHandler({ options = {} }) {
  const pageStart = Number.isFinite(options.pageStart) ? options.pageStart : 1;
  const pageCount = Number.isFinite(options.pageCount) ? options.pageCount : 0;
  const renderedPageCount = pageCount || 4;
  return Array.from({ length: renderedPageCount }, (_, index) => {
    const pageNumber = pageStart + index;
    return 'PAGE ' + pageNumber + ' :: ' + 'content '.repeat(60);
  }).join('\\n\\n');
};`, 'utf8');

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
      { id: 'attachment-3', name: 'paged.pdf', path: attachmentPagedPdfPath },
    ],
  });

  try {
    assert.equal(runtime.toolDisplayByName.bash.statusText, '执行命令');
    assert.equal(runtime.toolDisplayByName.readFile.statusText, '读取文件内容');
    assert.equal(runtime.toolDisplayByName.inspectAttachment.statusText, '分析附件内容');
    assert.equal(runtime.toolDisplayByName.readAttachmentText.statusText, '提取附件文本');
    assert.equal(runtime.toolDisplayByName.sendFile.statusText, '准备发送文件');

    if (process.platform === 'win32') {
      const wrappedCommand = wrapWindowsPowerShellCommand("Get-ChildItem -LiteralPath '\\\\server\\共享'");
      assert.match(wrappedCommand, /\[Console\]::OutputEncoding = \[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
      assert.match(wrappedCommand, /\$OutputEncoding = \[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
      assert.match(wrappedCommand, /chcp\.com 65001 > \$null/);

      const prompt = buildBashToolPrompt(rootDir);
      assert.match(prompt, /runs in Windows PowerShell/i);
      assert.match(prompt, /Do not use bash\/cmd-only syntax like `&&`, `ls -la`, `dir \/a`, or `chcp`/i);

      assert.equal(getBlockedCommandReason("'ok' | Format-Table"), null);
      assert.match(getBlockedCommandReason('format C:'), /destructive system command/i);

      const unicodeOutput = decodeShellOutput(Buffer.from('已签署协议电子档', 'utf8'));
      assert.equal(unicodeOutput, '已签署协议电子档');
    }

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
    assert.equal('preview' in attachmentInspection.attachment, false);
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
    assert.equal(pdfInspection.attachment.totalPageCount, 2);
    assert.equal(pdfInspection.attachment.pageRangeSupported, true);
    assert.equal('preview' in pdfInspection.attachment, false);
    assert.equal(pdfInspection.attachment.extraction.method, 'markitdown');
    assert.equal(pdfInspection.attachment.extraction.extractionTruncated, false);
    assert.equal(pdfInspection.preview.totalPageCount, 2);
    assert.equal(pdfInspection.preview.extractionTruncated, false);
    assert.equal(typeof pdfInspection.preview.contentTruncated, 'boolean');
    assert.match(pdfInspection.preview.text, /Converted scan\.pdf/i);
    assert.match(pdfInspection.preview.text, /Page count: 1/i);

    const pdfRead = await runtime.tools.readAttachmentText.execute({
      attachment: 'attachment-2',
    });
    assert.equal(pdfRead.success, true);
    assert.match(pdfRead.content, /%PDF-1\.7/i);
    assert.equal(pdfRead.cursorType, 'document-char');
    assert.equal(pdfRead.attachment.totalPageCount, 2);
    assert.equal('pageCount' in pdfRead.attachment, false);
    assert.equal(pdfRead.pageStart, 1);
    assert.equal(pdfRead.pageCount, 2);
    assert.equal(pdfRead.totalPageCount, 2);
    assert.equal(pdfRead.pageRangeSupported, true);
    assert.equal(pdfRead.attachment.extraction.extractionTruncated, false);
    assert.equal(typeof pdfRead.contentTruncated, 'boolean');

    const pdfTailInspection = await runtime.tools.inspectAttachment.execute({
      attachment: 'attachment-2',
      pageFromEnd: 1,
      pageCount: 1,
    });
    assert.equal(pdfTailInspection.success, true);
    assert.equal(pdfTailInspection.preview.previewPageStart, 2);
    assert.equal(pdfTailInspection.preview.previewPageCount, 1);
    assert.match(pdfTailInspection.preview.text, /Page start: 2/i);
    assert.match(pdfTailInspection.preview.text, /Page count: 1/i);

    const pdfTailRead = await runtime.tools.readAttachmentText.execute({
      attachment: 'attachment-2',
      pageFromEnd: 1,
      pageCount: 1,
    });
    assert.equal(pdfTailRead.success, true);
    assert.equal(pdfTailRead.pageStart, 2);
    assert.equal(pdfTailRead.pageCount, 1);
    assert.equal(pdfTailRead.nextPageStart, 3);
    assert.equal(pdfTailRead.totalPageCount, 2);

    const pagedRuntime = await createRuntimeTools({
      workspaceDir: rootDir,
      skillsDir: path.join(repoRoot, 'skills'),
      mcpServers: [],
      attachmentExtraction: {
        markitdown: {
          enabled: true,
          supportedExtensions: ['.pdf'],
          handlerModule: pagedHandlerPath,
          readPageCount: 2,
          previewPageCount: 1,
        },
      },
      attachments: [
        { id: 'attachment-3', name: 'paged.pdf', path: attachmentPagedPdfPath },
      ],
    });

    try {
      const firstPagedRead = await pagedRuntime.tools.readAttachmentText.execute({
        attachment: 'attachment-3',
        maxChars: 12000,
      });
      assert.equal(firstPagedRead.success, true);
      assert.equal(firstPagedRead.cursorType, 'document-char');
      assert.equal(firstPagedRead.pageStart, 1);
      assert.equal(firstPagedRead.pageCount, 2);
      assert.equal(firstPagedRead.nextPageStart, 3);
      assert.match(firstPagedRead.content, /PAGE 1/);
      assert.match(firstPagedRead.content, /PAGE 2/);

      const secondPagedRead = await pagedRuntime.tools.readAttachmentText.execute({
        attachment: 'attachment-3',
        offset: firstPagedRead.nextOffset,
        maxChars: 12000,
      });
      assert.equal(secondPagedRead.success, true);
      assert.equal(secondPagedRead.cursorType, 'document-char');
      assert.equal(secondPagedRead.pageStart, 3);
      assert.equal(secondPagedRead.pageCount, 2);
      assert.equal(secondPagedRead.offset, firstPagedRead.nextOffset);
      assert.equal(secondPagedRead.nextPageStart, 5);
      assert.match(secondPagedRead.content, /PAGE 3/);
      assert.match(secondPagedRead.content, /PAGE 4/);
      assert.ok(!/PAGE 1/.test(secondPagedRead.content));
    } finally {
      await pagedRuntime.close();
    }

    const failingRuntime = await createRuntimeTools({
      workspaceDir: rootDir,
      skillsDir: path.join(repoRoot, 'skills'),
      mcpServers: [],
      attachmentExtraction: {
        markitdown: {
          enabled: true,
          supportedExtensions: ['.pdf'],
          handlerModule: failingHandlerPath,
          activeLlmProfile: 'qwen-vl',
          fallbackLlmProfile: 'legacy-openai-compatible',
          llm: {
            client: 'qwen',
            model: 'primary-ocr-model',
          },
          fallbackLlm: {
            client: 'openai',
            model: 'fallback-ocr-model',
          },
        },
      },
      attachments: [
        { id: 'attachment-2', name: 'scan.pdf', path: attachmentPdfPath },
      ],
    });

    try {
      const failedPdfRead = await failingRuntime.tools.readAttachmentText.execute({
        attachment: 'attachment-2',
      });
      assert.equal(failedPdfRead.success, false);
      assert.equal(failedPdfRead.errorCode, 'ocr_safety_review_blocked');
      assert.match(failedPdfRead.error, /安全审查/);
      assert.equal(failedPdfRead.fallbackAttempted, true);
      assert.equal(failedPdfRead.fallbackProfile, 'legacy-openai-compatible');
      assert.match(failedPdfRead.errorDetails, /data_inspection_failed/i);
    } finally {
      await failingRuntime.close();
    }

    const outbound = await runtime.tools.sendFile.execute({
      path: localPdfPath,
      name: 'result.pdf',
    });
    assert.equal(outbound.success, true);
    assert.equal(outbound.attachment.name, 'result.pdf');

    assert.deepEqual(runtime.getOutboundAttachments(), [{
      path: localPdfPath,
      name: 'result.pdf',
      sizeBytes: fs.statSync(localPdfPath).size,
    }]);
  } finally {
    await runtime.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
