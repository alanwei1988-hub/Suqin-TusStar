const assert = require('node:assert/strict');
const fs = require('fs');
const {
  createCommandEnv,
  replaceArgPlaceholders,
} = require('../markitdown/extractor');
const { makeTempDir } = require('./helpers/test-helpers');

module.exports = async function runMarkItDownExtractorTest() {
  const rootDir = makeTempDir('markitdown-extractor-');
  const previousEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    MARKITDOWN_OCR_OPENAI_API_KEY: process.env.MARKITDOWN_OCR_OPENAI_API_KEY,
  };

  process.env.OPENAI_API_KEY = 'agent-key';
  process.env.OPENAI_BASE_URL = 'https://agent.example.invalid/v1';
  process.env.MARKITDOWN_OCR_OPENAI_API_KEY = 'ocr-key';

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

    const args = [
      '--llm-client',
      replaceArgPlaceholders('{llmClient}', { llmClient: 'openai' }),
      '--llm-model',
      replaceArgPlaceholders('{llmModel}', { llmModel: 'ocr-model' }),
      replaceArgPlaceholders('{input}', { input: 'D:\\docs\\scan.pdf' }),
    ];
    assert.deepEqual(args, [
      '--llm-client',
      'openai',
      '--llm-model',
      'ocr-model',
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
