const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { processConfig } = require('../app');
const {
  QWEN_API_KEY_ENV,
  QWEN_DOCUMENT_MARKDOWN_PROMPT,
  QWEN_OPENAI_COMPAT_BASE_URL,
} = require('../markitdown/llm');
const { getProjectMarkItDownPython } = require('../markitdown/runtime');
const { getProjectWorkspacePython, getWorkspacePythonRequirementsPath } = require('../workspace-runtime/runtime');

module.exports = async function runAppConfigTest() {
  const tempRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxwork-app-config-'));
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
      libraryRoot: './contract-library',
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
  assert.deepEqual(processedDefault.agent.imageModel, {
    enabled: true,
    model: '',
    baseURL: '',
    apiKeyEnv: '',
    apiKey: '',
    timeoutMs: 30000,
    prompt: 'Inspect this image attachment. Summarize the visible content, the main subject, the scene, and any clearly readable text. Keep the response concise and factual.',
    handlerModule: '',
    thinking: null,
  });
  assert.deepEqual(processedDefault.agent.attachmentExtraction.markitdown.llm, {
    client: '',
    model: '',
    baseURL: '',
    apiKeyEnv: '',
    prompt: '',
    thinking: null,
  });
  assert.equal(processedDefault.agent.attachmentExtraction.markitdown.fallbackLlm, null);
  assert.deepEqual(processedDefault.agent.attachmentExtraction.agentModelFallback, {
    model: 'test-model',
    baseURL: 'http://example.invalid/v1',
    apiKey: '',
    thinking: null,
  });
  assert.equal(processedDefault.agent.thinking, null);
  assert.equal(processedDefault.agent.maxContinuationAttempts, 2);
  assert.deepEqual(processedDefault.agent.toolTimeouts, {
    bashTimeoutMs: 30000,
    maxBashTimeoutMs: 300000,
    mcpToolTimeoutMs: 30000,
  });
  assert.deepEqual(processedDefault.agent.workspacePython, {
    enabled: true,
    command: getProjectWorkspacePython(__dirname),
    timeoutMs: 120000,
    maxTimeoutMs: 600000,
    requirementsPath: getWorkspacePythonRequirementsPath(__dirname),
    allowUserPackageInstall: true,
    userVenvDir: `${__dirname}\\data\\workspace-python-user`,
  });
  assert.deepEqual(processedDefault.agent.memory, {
    reflectionIntervalTurns: 20,
    dialogueLimit: 8,
    asyncReflectionEnabled: true,
  });
  assert.deepEqual(processedDefault.agent.scheduler, {
    enabled: true,
    dbPath: `${__dirname}\\data\\scheduled-tasks.db`,
    heartbeatMs: 600000,
    dueTaskLimit: 10,
    defaultTimezone: 'Asia/Shanghai',
  });
  assert.equal(processedDefault.contractMcp.libraryRoot, `${__dirname}\\contract-library`);
  assert.equal(processedDefault.contractMcp.dbPath, `${__dirname}\\contract-library\\合同归档.db`);
  assert.equal(processedDefault.storage.userRootDir, `${__dirname}\\storage\\users`);
  assert.equal(processedDefault.agent.userRootDir, `${__dirname}\\storage\\users`);
  assert.equal(fs.existsSync(path.join(tempRootDir, 'data')), false);

  processConfig(baseConfig, {
    rootDir: tempRootDir,
    env: {},
  });
  assert.equal(fs.existsSync(path.join(tempRootDir, 'data')), true);

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

  const processedImageModel = processConfig({
    ...baseConfig,
    agent: {
      ...baseConfig.agent,
      imageModel: {
        model: 'qwen3-vl-flash',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKeyEnv: 'DASHSCOPE_API_KEY',
        timeoutMs: 4567,
        prompt: 'Describe the image.',
        thinking: {
          enabled: false,
        },
      },
    },
  }, {
    rootDir: __dirname,
    env: {},
  });
  assert.deepEqual(processedImageModel.agent.imageModel, {
    enabled: true,
    model: 'qwen3-vl-flash',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    apiKey: '',
    timeoutMs: 4567,
    prompt: 'Describe the image.',
    handlerModule: '',
    thinking: {
      enabled: false,
    },
  });

  const processedToolTimeouts = processConfig({
    ...baseConfig,
    agent: {
      ...baseConfig.agent,
      maxContinuationAttempts: 5,
      toolTimeouts: {
        bashTimeoutMs: 1234,
        maxBashTimeoutMs: 5678,
        mcpToolTimeoutMs: 4321,
      },
      memory: {
        reflectionIntervalTurns: 15,
        dialogueLimit: 6,
        asyncReflectionEnabled: false,
      },
      thinking: {
        enabled: false,
        reasoningEffort: 'low',
        textVerbosity: 'low',
        budgetTokens: 1024,
        extraBody: {
          foo: 'bar',
        },
      },
    },
  }, {
    rootDir: __dirname,
    env: {},
  });
  assert.equal(processedToolTimeouts.agent.maxContinuationAttempts, 5);
  assert.deepEqual(processedToolTimeouts.agent.toolTimeouts, {
    bashTimeoutMs: 1234,
    maxBashTimeoutMs: 5678,
    mcpToolTimeoutMs: 4321,
  });
  assert.deepEqual(processedToolTimeouts.agent.memory, {
    reflectionIntervalTurns: 15,
    dialogueLimit: 6,
    asyncReflectionEnabled: false,
  });
  assert.deepEqual(processedToolTimeouts.agent.thinking, {
    enabled: false,
    reasoningEffort: 'low',
    textVerbosity: 'low',
    budgetTokens: 1024,
    extraBody: {
      foo: 'bar',
    },
  });

  const processedWorkspacePython = processConfig({
    ...baseConfig,
    agent: {
      ...baseConfig.agent,
      workspacePython: {
        enabled: true,
        command: '{runtime}',
        timeoutMs: 4567,
        maxTimeoutMs: 9876,
        requirementsPath: './custom-workspace-python.txt',
        allowUserPackageInstall: false,
        userVenvDir: './workspace-python-user',
      },
    },
  }, {
    rootDir: __dirname,
    env: {},
  });
  assert.deepEqual(processedWorkspacePython.agent.workspacePython, {
    enabled: true,
    command: getProjectWorkspacePython(__dirname),
    timeoutMs: 4567,
    maxTimeoutMs: 9876,
    requirementsPath: `${__dirname}\\custom-workspace-python.txt`,
    allowUserPackageInstall: false,
    userVenvDir: `${__dirname}\\workspace-python-user`,
  });

  const processedScheduler = processConfig({
    ...baseConfig,
    agent: {
      ...baseConfig.agent,
      scheduler: {
        enabled: true,
        dbPath: './custom-scheduler.db',
        heartbeatMs: 1200000,
        dueTaskLimit: 3,
        defaultTimezone: 'Asia/Tokyo',
      },
    },
  }, {
    rootDir: __dirname,
    env: {},
  });
  assert.deepEqual(processedScheduler.agent.scheduler, {
    enabled: true,
    dbPath: `${__dirname}\\custom-scheduler.db`,
    heartbeatMs: 1200000,
    dueTaskLimit: 3,
    defaultTimezone: 'Asia/Tokyo',
  });

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
            thinking: {
              enabled: true,
              reasoningEffort: 'medium',
            },
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
    thinking: {
      enabled: true,
      reasoningEffort: 'medium',
    },
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
      thinking: null,
    },
    'qwen-vl-flash': {
      client: 'qwen',
      model: 'qwen3-vl-flash',
      baseURL: QWEN_OPENAI_COMPAT_BASE_URL,
      apiKeyEnv: QWEN_API_KEY_ENV,
      prompt: QWEN_DOCUMENT_MARKDOWN_PROMPT,
      thinking: {
        enabled: false,
      },
    },
  });
  assert.deepEqual(processedQwenMarkItDown.agent.attachmentExtraction.markitdown.llm, {
    client: 'qwen',
    model: 'qwen3-vl-flash',
    baseURL: QWEN_OPENAI_COMPAT_BASE_URL,
    apiKeyEnv: QWEN_API_KEY_ENV,
    prompt: QWEN_DOCUMENT_MARKDOWN_PROMPT,
    thinking: {
      enabled: false,
    },
  });
  assert.deepEqual(processedQwenMarkItDown.agent.attachmentExtraction.markitdown.fallbackLlm, {
    client: 'openai',
    model: 'legacy-model',
    baseURL: 'https://legacy.example.invalid/v1',
    apiKeyEnv: 'LEGACY_MARKITDOWN_OCR_KEY',
    prompt: 'Legacy OCR prompt.',
    thinking: null,
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
    thinking: null,
  });

  fs.rmSync(tempRootDir, { recursive: true, force: true });
};
