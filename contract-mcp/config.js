const fs = require('fs');
const path = require('path');

const DEFAULT_ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];

function parseCliArgs(argv = process.argv.slice(2)) {
  const result = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--config') {
      result.configPath = argv[index + 1];
      index += 1;
    }
  }

  return result;
}

function resolveConfigPath(cliArgs = parseCliArgs(), env = process.env) {
  return cliArgs.configPath
    || env.CONTRACT_MCP_CONFIG
    || path.resolve(__dirname, '../config.json');
}

function resolveRelative(baseDir, value, fallback) {
  const candidate = value || fallback;

  if (!candidate) {
    return candidate;
  }

  return path.isAbsolute(candidate)
    ? candidate
    : path.resolve(baseDir, candidate);
}

function loadContractMcpConfig({ configPath = resolveConfigPath() } = {}) {
  const resolvedConfigPath = path.resolve(configPath);
  const configDir = path.dirname(resolvedConfigPath);
  const rootConfig = JSON.parse(fs.readFileSync(resolvedConfigPath, 'utf8'));
  const contractMcp = rootConfig.contractMcp || {};

  return {
    configPath: resolvedConfigPath,
    dbPath: resolveRelative(configDir, contractMcp.dbPath, './data/contracts.db'),
    storageRoot: resolveRelative(configDir, contractMcp.storageRoot, './storage/contracts'),
    stagingDir: resolveRelative(configDir, contractMcp.stagingDir, './storage/contracts/.staging'),
    contractIdPrefix: contractMcp.contractIdPrefix || 'CT',
    allowedExtensions: Array.isArray(contractMcp.allowedExtensions) && contractMcp.allowedExtensions.length > 0
      ? contractMcp.allowedExtensions
      : DEFAULT_ALLOWED_EXTENSIONS,
    maxFileSizeMb: Number.isFinite(contractMcp.maxFileSizeMb)
      ? contractMcp.maxFileSizeMb
      : 50,
    defaultSearchLimit: Number.isFinite(contractMcp.defaultSearchLimit)
      ? contractMcp.defaultSearchLimit
      : 20,
  };
}

module.exports = {
  loadContractMcpConfig,
  parseCliArgs,
  resolveConfigPath,
};
