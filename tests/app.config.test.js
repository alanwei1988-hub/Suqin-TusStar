const assert = require('node:assert/strict');
const { processConfig } = require('../app');
const {
  QWEN_API_KEY_ENV,
  QWEN_DOCUMENT_MARKDOWN_PROMPT,
  QWEN_OPENAI_COMPAT_BASE_URL,
} = require('../markitdown/llm');
const { getProjectMarkItDownPython } = require('../markitdown/runtime');

module.exports = async function runAppConfigTest() {
  const baseConfig = {
    agent: {
      model: 'test-model',
      provider: 'openai',
      openai: {
        baseURL: 'http://example.invalid/v1',
      },
      skillsDir: './skills',
      rolePromptDir: './roles/contract-manager',
      sessionDb: './data/sessions.db',
      mcpServers: [],
    },
    channel: {
      type: 'wxwork',
      wxwork: {
        debug: false,
      },
    },
    storage: {
      tempDir: './storage/temp',
    },
    contractMcp: {
      storageRoot: './contract-library',
      contractIdPrefix: 'CT',
    },
  };

  const processedDefault = processConfig(baseConfig, {
    rootDir: __dirname,
    env: {},
  });
  assert.equal(processedDefault.channel.wxwork.streamingResponse, true);
  assert.equal(processedDefault.agent.attachmentExtraction.markitdown.enabled, false);
  assert.equal(processedDefault.agent.attachmentExtraction.markitdown.handlerModule, '');
  assert.equal(processedDefault.agent.attachmentExtraction.markitdown.command, getProjectMarkItDownPython(__dirname));
  assert.deepEqual(processedDefault.agent.attachmentExtraction.markitdown.args, ['-X', 'utf8', '-m', 'markitdown', '{input}']);
  assert.equal(processedDefault.agent.attachmentExtraction.markitdown.previewPageCount, 1);
  assert.equal(processedDefault.agent.attachmentExtraction.markitdown.readPageCount, 2);
  assert.equal(processedDefault.agent.attachmentExtraction.markitdown.ocrConcurrency, 2);
  assert.equal(processedDefault.agent.attachmentExtraction.markitdown.ocrPageGroupSize, 4);
  assert.deepEqual(processedDefault.agent.attachmentExtraction.markitdown.supportedExtensions, ['.pdf', '.docx', '.pptx', '.xls', '.xlsx']);
  assert.equal(processedDefault.agent.attachmentExtraction.markitdown.cache.enabled, true);
  assert.equal(processedDefault.agent.attachmentExtraction.markitdown.cache.dbPath, `${__dirname}\\data\\attachment-extraction-cache.db`);
  assert.equal(processedDefault.agent.attachmentExtraction.markitdown.activeLlmProfile, '');
  assert.equal(processedDefault.agent.attachmentExtraction.markitdown.fallbackLlmProfile, '');
  assert.deepEqual(processedDefault.agent.attachmentExtraction.markitdown.llmProfiles, {});
  assert.deepEqual(processedDefault.agent.attachmentExtraction.markitdown.llm, {
    client: '',
    model: '',
    baseURL: '',
    apiKeyEnv: '',
    prompt: '',
  });
  assert.equal(processedDefault.agent.attachmentExtraction.markitdown.fallbackLlm, null);
  assert.equal(processedDefault.contractMcp.storageRoot, `${__dirname}\\contract-library`);
  assert.equal(processedDefault.contractMcp.dbPath, `${__dirname}\\contract-library\\contracts.db`);
  assert.equal(processedDefault.contractMcp.stagingDir, `${__dirname}\\contract-library\\.staging`);
  assert.equal(processedDefault.contractMcp.libraryRoot, `${__dirname}\\contract-library`);

  const processedDisabled = processConfig({
    ...baseConfig,
    channel: {
      ...baseConfig.channel,
      wxwork: {
        ...baseConfig.channel.wxwork,
        streamingResponse: false,
      },
    },
  }, {
    rootDir: __dirname,
    env: {},
  });
  assert.equal(processedDisabled.channel.wxwork.streamingResponse, false);

  const processedMarkItDown = processConfig({
    ...baseConfig,
    agent: {
      ...baseConfig.agent,
      attachmentExtraction: {
        markitdown: {
          enabled: true,
          handlerModule: '.\\scripts\\mock-handler.js',
          command: '{runner}',
          args: ['.\\scripts\\runner.py', '--llm-client', '{llmClient}', '--llm-model', '{llmModel}', '--llm-prompt', '{llmPrompt}', '--page-start', '{pageStart}', '--page-count', '{pageCount}', '--ocr-concurrency', '{ocrConcurrency}', '--ocr-page-group-size', '{ocrPageGroupSize}', '{input}'],
          previewPageCount: 1,
          readPageCount: 3,
          ocrConcurrency: 5,
          ocrPageGroupSize: 6,
          supportedExtensions: ['.PDF'],
          cache: {
            enabled: false,
            dbPath: '.\\data\\custom-attachment-cache.db',
          },
          llm: {
            client: 'openai',
            model: 'ocr-model',
            baseURL: 'https://ocr.example.invalid/v1',
            apiKeyEnv: 'MARKITDOWN_OCR_OPENAI_API_KEY',
            prompt: 'Extract OCR text only.',
          },
        },
      },
    },
  }, {
    rootDir: __dirname,
    env: {},
  });
  assert.equal(processedMarkItDown.agent.attachmentExtraction.markitdown.enabled, true);
  assert.equal(processedMarkItDown.agent.attachmentExtraction.markitdown.handlerModule.endsWith('\\scripts\\mock-handler.js'), true);
  assert.equal(processedMarkItDown.agent.attachmentExtraction.markitdown.command, getProjectMarkItDownPython(__dirname));
  assert.equal(processedMarkItDown.agent.attachmentExtraction.markitdown.args[0].endsWith('\\scripts\\runner.py'), true);
  assert.equal(processedMarkItDown.agent.attachmentExtraction.markitdown.args[2], '{llmClient}');
  assert.equal(processedMarkItDown.agent.attachmentExtraction.markitdown.args[4], '{llmModel}');
  assert.equal(processedMarkItDown.agent.attachmentExtraction.markitdown.args[6], '{llmPrompt}');
  assert.equal(processedMarkItDown.agent.attachmentExtraction.markitdown.args[8], '{pageStart}');
  assert.equal(processedMarkItDown.agent.attachmentExtraction.markitdown.args[10], '{pageCount}');
  assert.equal(processedMarkItDown.agent.attachmentExtraction.markitdown.args[12], '{ocrConcurrency}');
  assert.equal(processedMarkItDown.agent.attachmentExtraction.markitdown.args[14], '{ocrPageGroupSize}');
  assert.equal(processedMarkItDown.agent.attachmentExtraction.markitdown.previewPageCount, 1);
  assert.equal(processedMarkItDown.agent.attachmentExtraction.markitdown.readPageCount, 3);
  assert.equal(processedMarkItDown.agent.attachmentExtraction.markitdown.ocrConcurrency, 5);
  assert.equal(processedMarkItDown.agent.attachmentExtraction.markitdown.ocrPageGroupSize, 6);
  assert.deepEqual(processedMarkItDown.agent.attachmentExtraction.markitdown.supportedExtensions, ['.pdf']);
  assert.equal(processedMarkItDown.agent.attachmentExtraction.markitdown.cache.enabled, false);
  assert.equal(processedMarkItDown.agent.attachmentExtraction.markitdown.cache.dbPath, `${__dirname}\\data\\custom-attachment-cache.db`);
  assert.deepEqual(processedMarkItDown.agent.attachmentExtraction.markitdown.llm, {
    client: 'openai',
    model: 'ocr-model',
    baseURL: 'https://ocr.example.invalid/v1',
    apiKeyEnv: 'MARKITDOWN_OCR_OPENAI_API_KEY',
    prompt: 'Extract OCR text only.',
  });

  const processedQwenMarkItDown = processConfig({
    ...baseConfig,
    agent: {
      ...baseConfig.agent,
      attachmentExtraction: {
        markitdown: {
          enabled: true,
          activeLlmProfile: 'qwen-vl-flash',
          fallbackLlmProfile: 'legacy-openai-compatible',
          llmProfiles: {
            'legacy-openai-compatible': {
              client: 'openai',
              model: 'legacy-model',
              baseURL: 'https://legacy.example.invalid/v1',
              apiKeyEnv: 'LEGACY_MARKITDOWN_OCR_KEY',
              prompt: 'Legacy OCR prompt.',
            },
            'qwen-vl-flash': {
              client: 'qwen',
              model: 'qwen3-vl-flash',
            },
          },
        },
      },
    },
  }, {
    rootDir: __dirname,
    env: {},
  });
  assert.equal(processedQwenMarkItDown.agent.attachmentExtraction.markitdown.activeLlmProfile, 'qwen-vl-flash');
  assert.equal(processedQwenMarkItDown.agent.attachmentExtraction.markitdown.fallbackLlmProfile, 'legacy-openai-compatible');
  assert.deepEqual(processedQwenMarkItDown.agent.attachmentExtraction.markitdown.llmProfiles, {
    'legacy-openai-compatible': {
      client: 'openai',
      model: 'legacy-model',
      baseURL: 'https://legacy.example.invalid/v1',
      apiKeyEnv: 'LEGACY_MARKITDOWN_OCR_KEY',
      prompt: 'Legacy OCR prompt.',
    },
    'qwen-vl-flash': {
      client: 'qwen',
      model: 'qwen3-vl-flash',
      baseURL: QWEN_OPENAI_COMPAT_BASE_URL,
      apiKeyEnv: QWEN_API_KEY_ENV,
      prompt: QWEN_DOCUMENT_MARKDOWN_PROMPT,
    },
  });
  assert.deepEqual(processedQwenMarkItDown.agent.attachmentExtraction.markitdown.llm, {
    client: 'qwen',
    model: 'qwen3-vl-flash',
    baseURL: QWEN_OPENAI_COMPAT_BASE_URL,
    apiKeyEnv: QWEN_API_KEY_ENV,
    prompt: QWEN_DOCUMENT_MARKDOWN_PROMPT,
  });
  assert.deepEqual(processedQwenMarkItDown.agent.attachmentExtraction.markitdown.fallbackLlm, {
    client: 'openai',
    model: 'legacy-model',
    baseURL: 'https://legacy.example.invalid/v1',
    apiKeyEnv: 'LEGACY_MARKITDOWN_OCR_KEY',
    prompt: 'Legacy OCR prompt.',
  });

  const processedLegacyProfileMarkItDown = processConfig({
    ...baseConfig,
    agent: {
      ...baseConfig.agent,
      attachmentExtraction: {
        markitdown: {
          enabled: true,
          activeLlmProfile: 'missing-profile',
          llm: {
            client: 'openai',
            model: 'legacy-model',
            baseURL: 'https://legacy.example.invalid/v1',
            apiKeyEnv: 'LEGACY_MARKITDOWN_OCR_KEY',
            prompt: 'Legacy OCR prompt.',
          },
        },
      },
    },
  }, {
    rootDir: __dirname,
    env: {},
  });
  assert.deepEqual(processedLegacyProfileMarkItDown.agent.attachmentExtraction.markitdown.llm, {
    client: 'openai',
    model: 'legacy-model',
    baseURL: 'https://legacy.example.invalid/v1',
    apiKeyEnv: 'LEGACY_MARKITDOWN_OCR_KEY',
    prompt: 'Legacy OCR prompt.',
  });
};
