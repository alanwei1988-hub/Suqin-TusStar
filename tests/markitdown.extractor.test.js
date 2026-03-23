const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  createCommandEnv,
  createMarkItDownExtractor,
  replaceArgPlaceholders,
} = require('../markitdown/extractor');
const {
  QWEN_API_KEY_ENV,
  QWEN_DOCUMENT_MARKDOWN_PROMPT,
  QWEN_OPENAI_COMPAT_BASE_URL,
} = require('../markitdown/llm');
const { makeTempDir } = require('./helpers/test-helpers');

module.exports = async function runMarkItDownExtractorTest() {
  const rootDir = makeTempDir('markitdown-extractor-');
  const previousEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    MARKITDOWN_OCR_OPENAI_API_KEY: process.env.MARKITDOWN_OCR_OPENAI_API_KEY,
    DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY,
  };

  process.env.OPENAI_API_KEY = 'agent-key';
  process.env.OPENAI_BASE_URL = 'https://agent.example.invalid/v1';
  process.env.MARKITDOWN_OCR_OPENAI_API_KEY = 'ocr-key';
  process.env.DASHSCOPE_API_KEY = 'dashscope-key';

  try {
    const env = createCommandEnv({
      llm: {
        client: 'openai',
        model: 'ocr-model',
        baseURL: 'https://ocr.example.invalid/v1',
        apiKeyEnv: 'MARKITDOWN_OCR_OPENAI_API_KEY',
      },
    });

    assert.equal(env.OPENAI_API_KEY, 'ocr-key');
    assert.equal(env.OPENAI_BASE_URL, 'https://ocr.example.invalid/v1');
    assert.equal(env.PYTHONIOENCODING, 'utf-8');
    assert.equal(env.PYTHONUTF8, '1');

    const qwenEnv = createCommandEnv({
      llm: {
        client: 'qwen',
        model: 'qwen3-vl-flash',
        apiKeyEnv: QWEN_API_KEY_ENV,
      },
    });

    assert.equal(qwenEnv.OPENAI_API_KEY, 'dashscope-key');
    assert.equal(qwenEnv.OPENAI_BASE_URL, QWEN_OPENAI_COMPAT_BASE_URL);

    const args = [
      '--llm-client',
      replaceArgPlaceholders('{llmClient}', { llmClient: 'qwen' }),
      '--llm-model',
      replaceArgPlaceholders('{llmModel}', { llmModel: 'qwen3-vl-flash' }),
      '--llm-prompt',
      replaceArgPlaceholders('{llmPrompt}', { llmPrompt: QWEN_DOCUMENT_MARKDOWN_PROMPT }),
      '--page-start',
      replaceArgPlaceholders('{pageStart}', { pageStart: 3 }),
      '--page-count',
      replaceArgPlaceholders('{pageCount}', { pageCount: 2 }),
      '--ocr-concurrency',
      replaceArgPlaceholders('{ocrConcurrency}', { ocrConcurrency: 3 }),
      '--ocr-page-group-size',
      replaceArgPlaceholders('{ocrPageGroupSize}', { ocrPageGroupSize: 4 }),
      replaceArgPlaceholders('{input}', { input: 'D:\\docs\\scan.pdf' }),
    ];
    assert.deepEqual(args, [
      '--llm-client',
      'qwen',
      '--llm-model',
      'qwen3-vl-flash',
      '--llm-prompt',
      QWEN_DOCUMENT_MARKDOWN_PROMPT,
      '--page-start',
      '3',
      '--page-count',
      '2',
      '--ocr-concurrency',
      '3',
      '--ocr-page-group-size',
      '4',
      'D:\\docs\\scan.pdf',
    ]);

    const handlerModulePath = path.join(rootDir, 'counting-handler.js');
    const cacheDbPath = path.join(rootDir, 'attachment-cache.db');
    const firstPdfPath = path.join(rootDir, 'scan-a.pdf');
    const secondPdfPath = path.join(rootDir, 'scan-b.pdf');

    fs.writeFileSync(handlerModulePath, `module.exports = async function countingHandler({ attachmentPath, options = {} }) {
  global.__markitdownCacheHandlerCalls = (global.__markitdownCacheHandlerCalls || 0) + 1;
  const fs = require('fs');
  const path = require('path');
  const pageStart = Number.isFinite(options.pageStart) ? options.pageStart : 1;
  const pageCount = Number.isFinite(options.pageCount) ? options.pageCount : 0;
  return '# Cached ' + path.basename(attachmentPath) + '\\nPage start: ' + pageStart + '\\nPage count: ' + (pageCount || 'all') + '\\n' + fs.readFileSync(attachmentPath, 'utf8');
};
`, 'utf8');
    fs.writeFileSync(firstPdfPath, '%PDF-1.7\nsame content');
    fs.writeFileSync(secondPdfPath, '%PDF-1.7\nsame content');
    delete global.__markitdownCacheHandlerCalls;

    const extractorConfig = {
      enabled: true,
      handlerModule: handlerModulePath,
      supportedExtensions: ['.pdf'],
      maxOutputChars: 24000,
      cache: {
        enabled: true,
        dbPath: cacheDbPath,
      },
    };
    const firstExtractor = createMarkItDownExtractor(extractorConfig);
    const secondExtractor = createMarkItDownExtractor(extractorConfig);

    try {
      const firstResult = await firstExtractor.extract({
        resolvedPath: firstPdfPath,
        extension: '.pdf',
        name: 'scan-a.pdf',
      }, {
        pageStart: 1,
        pageCount: 2,
      });
      const secondResult = await secondExtractor.extract({
        resolvedPath: secondPdfPath,
        extension: '.pdf',
        name: 'scan-b.pdf',
      }, {
        pageStart: 1,
        pageCount: 2,
      });
      const thirdResult = await secondExtractor.extract({
        resolvedPath: secondPdfPath,
        extension: '.pdf',
        name: 'scan-b.pdf',
      }, {
        pageStart: 2,
        pageCount: 1,
      });

      assert.equal(global.__markitdownCacheHandlerCalls, 2);
      assert.match(firstResult.markdown, /Cached scan-a\.pdf/);
      assert.match(secondResult.markdown, /Cached scan-a\.pdf/);
      assert.equal(secondResult.pageStart, 1);
      assert.equal(secondResult.pageCount, 2);
      assert.match(thirdResult.markdown, /Cached scan-b\.pdf/);
      assert.equal(thirdResult.pageStart, 2);
      assert.equal(thirdResult.pageCount, 1);
    } finally {
      firstExtractor.close();
      secondExtractor.close();
    }
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (typeof value === 'string') {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }

    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
