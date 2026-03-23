const assert = require('node:assert/strict');
const fs = require('fs');
const {
  createCommandEnv,
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
