const fs = require('fs');
const os = require('os');
const path = require('path');
const { ContractMCPMockTransport } = require('../../contract-mcp/mock-transport');

const repoRoot = path.resolve(__dirname, '..', '..');

function makeTempDir(prefix = 'wxwork-bot-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function createContractMcpFixture(rootDir) {
  const configPath = path.join(rootDir, 'contract-config.json');
  const storageRoot = path.join(rootDir, 'contracts-storage');
  const dbPath = path.join(rootDir, 'contracts.db');
  const stagingDir = path.join(storageRoot, '.staging');

  writeJson(configPath, {
    contractMcp: {
      dbPath,
      storageRoot,
      stagingDir,
      contractIdPrefix: 'CT',
      allowedExtensions: ['.pdf', '.docx', '.doc'],
      maxFileSizeMb: 10,
      defaultSearchLimit: 20,
    },
  });

  return {
    configPath,
    storageRoot,
    dbPath,
    stagingDir,
    contractConfig: {
      dbPath,
      storageRoot,
      stagingDir,
      contractIdPrefix: 'CT',
      allowedExtensions: ['.pdf', '.docx', '.doc'],
      maxFileSizeMb: 10,
      defaultSearchLimit: 20,
    },
    mcpServer: {
      name: 'contract-manager',
      transport: 'mock',
      mockTransport: new ContractMCPMockTransport({
        dbPath,
        storageRoot,
        stagingDir,
        contractIdPrefix: 'CT',
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
  makeTempDir,
  psQuote,
  repoRoot,
  textPart,
  toolCall,
  waitFor,
};
