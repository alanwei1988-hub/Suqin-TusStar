const assert = require('node:assert/strict');
const { processConfig } = require('../app');
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
  assert.deepEqual(processedDefault.agent.attachmentExtraction.markitdown.supportedExtensions, ['.pdf', '.docx', '.pptx', '.xls', '.xlsx']);
  assert.deepEqual(processedDefault.agent.attachmentExtraction.markitdown.llm, {
    client: '',
    model: '',
    baseURL: '',
    apiKeyEnv: '',
  });
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
          args: ['.\\scripts\\runner.py', '--llm-client', '{llmClient}', '--llm-model', '{llmModel}', '{input}'],
          supportedExtensions: ['.PDF'],
          llm: {
            client: 'openai',
            model: 'ocr-model',
            baseURL: 'https://ocr.example.invalid/v1',
            apiKeyEnv: 'MARKITDOWN_OCR_OPENAI_API_KEY',
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
  assert.deepEqual(processedMarkItDown.agent.attachmentExtraction.markitdown.supportedExtensions, ['.pdf']);
  assert.deepEqual(processedMarkItDown.agent.attachmentExtraction.markitdown.llm, {
    client: 'openai',
    model: 'ocr-model',
    baseURL: 'https://ocr.example.invalid/v1',
    apiKeyEnv: 'MARKITDOWN_OCR_OPENAI_API_KEY',
  });
};
