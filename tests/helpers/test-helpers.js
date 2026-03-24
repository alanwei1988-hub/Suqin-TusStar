const fs = require('fs');
const os = require('os');
const path = require('path');
const { ContractMCPMockTransport } = require('../../contract-mcp/mock-transport');

const repoRoot = path.resolve(__dirname, '..', '..');
const testDataDir = path.join(repoRoot, 'tests', 'test_data');
const markitdownOcrSamplePdf = path.join(testDataDir, 'markitdown-ocr-scan-sample.pdf');

function makeTempDir(prefix = 'wxwork-bot-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function createContractMcpFixture(rootDir) {
  const configPath = path.join(rootDir, 'contract-config.json');
  const libraryRoot = path.join(rootDir, '已签署协议电子档');
  const dbPath = path.join(libraryRoot, '合同归档.db');
  fs.mkdirSync(path.join(libraryRoot, '采购（启迪支出）', '算力'), { recursive: true });
  fs.mkdirSync(path.join(libraryRoot, '专业服务收入协议（活动+算力+商业化）', '算力客户协议（启迪收入）'), { recursive: true });
  fs.mkdirSync(path.join(libraryRoot, '其他协议'), { recursive: true });
  fs.writeFileSync(path.join(libraryRoot, '电子协议归档规则.txt'), '1、命名规则：以时间为开头，协议名称在后，最后为乙方。', 'utf8');

  writeJson(configPath, {
    contractMcp: {
      libraryRoot,
      dbPath,
      archiveIdPrefix: 'A',
      ourCompanyAliases: ['上海启迪创业孵化器有限公司', '上海启迪'],
      allowedExtensions: ['.pdf', '.docx', '.doc'],
      maxFileSizeMb: 10,
      defaultSearchLimit: 20,
    },
  });

  return {
    configPath,
    libraryRoot,
    dbPath,
    contractConfig: {
      libraryRoot,
      dbPath,
      archiveIdPrefix: 'A',
      ourCompanyAliases: ['上海启迪创业孵化器有限公司', '上海启迪'],
      allowedExtensions: ['.pdf', '.docx', '.doc'],
      maxFileSizeMb: 10,
      defaultSearchLimit: 20,
    },
    mcpServer: {
      name: 'contract-manager',
      transport: 'mock',
      mockTransport: new ContractMCPMockTransport({
        libraryRoot,
        dbPath,
        archiveIdPrefix: 'A',
        ourCompanyAliases: ['上海启迪创业孵化器有限公司', '上海启迪'],
        allowedExtensions: ['.pdf', '.docx', '.doc'],
        maxFileSizeMb: 10,
        defaultSearchLimit: 20,
      }),
    },
  };
}

function createUsage() {
  return {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: {
      total: 5,
      text: 5,
      reasoning: 0,
    },
  };
}

function toolCall(toolCallId, toolName, input) {
  return {
    type: 'tool-call',
    toolCallId,
    toolName,
    input: JSON.stringify(input),
  };
}

function textPart(text) {
  return {
    type: 'text',
    text,
  };
}

function generateResult(content, finishReason = 'tool-calls') {
  return {
    content,
    finishReason: {
      unified: finishReason,
      raw: finishReason,
    },
    usage: createUsage(),
    warnings: [],
  };
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = await predicate();

    if (value) {
      return value;
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error('Timed out while waiting for condition.');
}

module.exports = {
  createContractMcpFixture,
  generateResult,
  markitdownOcrSamplePdf,
  makeTempDir,
  psQuote,
  repoRoot,
  textPart,
  testDataDir,
  toolCall,
  waitFor,
};
