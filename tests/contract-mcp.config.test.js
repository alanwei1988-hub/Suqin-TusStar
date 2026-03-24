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
        libraryRoot: './contract-library',
        pendingIdPrefix: 'P',
        ourCompanyAliases: ['上海启迪创业孵化器有限公司', '上海启迪'],
      },
    }, null, 2));

    const loaded = loadContractMcpConfig({ configPath });
    assert.equal(loaded.libraryRoot, path.join(rootDir, 'contract-library'));
    assert.equal(loaded.statePath, path.join(rootDir, 'data', 'contract-workflow-state.json'));
    assert.equal(loaded.ledgerWorkbookPath, path.join(rootDir, 'contract-library', '协议台账.xlsx'));
    assert.equal(loaded.pendingIdPrefix, 'P');
    assert.deepEqual(loaded.ourCompanyAliases, ['上海启迪创业孵化器有限公司', '上海启迪']);

    const resolved = resolveContractMcpConfig(rootDir, {
      libraryRoot: '\\\\192.168.20.100\\启迪之星\\技术商业化事业部\\板块-产业化\\合同管理',
      pendingIdPrefix: 'P',
      ourCompanyAliases: ['上海启迪创业孵化器有限公司'],
    });
    assert.equal(resolved.libraryRoot, '\\\\192.168.20.100\\启迪之星\\技术商业化事业部\\板块-产业化\\合同管理');
    assert.equal(resolved.ledgerWorkbookPath, '\\\\192.168.20.100\\启迪之星\\技术商业化事业部\\板块-产业化\\合同管理\\协议台账.xlsx');
    assert.equal(resolved.pendingIdPrefix, 'P');
    assert.deepEqual(resolved.ourCompanyAliases, ['上海启迪创业孵化器有限公司']);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
