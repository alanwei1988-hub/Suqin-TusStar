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
        ourCompanyAliases: ['上海启迪创业孵化器有限公司', '上海启迪'],
      },
    }, null, 2));

    const loaded = loadContractMcpConfig({ configPath });
    assert.equal(loaded.libraryRoot, path.join(rootDir, 'contract-library'));
    assert.equal(loaded.userStorageRoot, path.join(rootDir, 'users'));
    assert.equal(loaded.dbPath, path.join(rootDir, 'contract-library', '合同归档.db'));
    assert.deepEqual(loaded.ourCompanyAliases, ['上海启迪创业孵化器有限公司', '上海启迪']);

    const resolved = resolveContractMcpConfig(rootDir, {
      libraryRoot: '\\\\192.168.20.100\\启迪之星\\技术商业化事业部\\板块-产业化\\合同管理',
      ourCompanyAliases: ['上海启迪创业孵化器有限公司'],
    });
    assert.equal(resolved.libraryRoot, '\\\\192.168.20.100\\启迪之星\\技术商业化事业部\\板块-产业化\\合同管理');
    assert.equal(resolved.userStorageRoot, '\\\\192.168.20.100\\启迪之星\\技术商业化事业部\\板块-产业化\\users');
    assert.equal(resolved.dbPath, '\\\\192.168.20.100\\启迪之星\\技术商业化事业部\\板块-产业化\\合同管理\\合同归档.db');
    assert.deepEqual(resolved.ourCompanyAliases, ['上海启迪创业孵化器有限公司']);

    const resolvedCustomDbName = resolveContractMcpConfig(rootDir, {
      libraryRoot: './contract-library',
      dbPath: 'custom-archive.db',
    });
    assert.equal(resolvedCustomDbName.dbPath, path.join(rootDir, 'contract-library', 'custom-archive.db'));

    const resolvedCustomUserStorage = resolveContractMcpConfig(rootDir, {
      libraryRoot: './contract-library',
      userStorageRoot: './storage/users',
    });
    assert.equal(resolvedCustomUserStorage.userStorageRoot, path.join(rootDir, 'storage', 'users'));
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
