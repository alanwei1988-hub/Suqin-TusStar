const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadContractMcpConfig, resolveContractMcpConfig } = require('../contract-mcp/config');
const { makeTempDir } = require('./helpers/test-helpers');

module.exports = async function runContractMcpConfigTest() {
  const rootDir = makeTempDir('contract-config-');
  const configPath = path.join(rootDir, 'config.json');

  try {
    fs.writeFileSync(configPath, JSON.stringify({
      contractMcp: {
        storageRoot: './contract-library',
        contractIdPrefix: 'CT',
      },
    }, null, 2));

    const loaded = loadContractMcpConfig({ configPath });
    assert.equal(loaded.libraryRoot, path.join(rootDir, 'contract-library'));
    assert.equal(loaded.storageRoot, path.join(rootDir, 'contract-library'));
    assert.equal(loaded.dbPath, path.join(rootDir, 'contract-library', 'contracts.db'));
    assert.equal(loaded.stagingDir, path.join(rootDir, 'contract-library', '.staging'));

    const resolved = resolveContractMcpConfig(rootDir, {
      libraryRoot: '\\\\192.168.20.100\\启迪之星\\技术商业化事业部\\板块-产业化\\合同管理',
      contractIdPrefix: 'CT',
    });
    assert.equal(resolved.libraryRoot, '\\\\192.168.20.100\\启迪之星\\技术商业化事业部\\板块-产业化\\合同管理');
    assert.equal(resolved.storageRoot, '\\\\192.168.20.100\\启迪之星\\技术商业化事业部\\板块-产业化\\合同管理');
    assert.equal(resolved.dbPath, '\\\\192.168.20.100\\启迪之星\\技术商业化事业部\\板块-产业化\\合同管理\\contracts.db');
    assert.equal(resolved.stagingDir, '\\\\192.168.20.100\\启迪之星\\技术商业化事业部\\板块-产业化\\合同管理\\.staging');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
