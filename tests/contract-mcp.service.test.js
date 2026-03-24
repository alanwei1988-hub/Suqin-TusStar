const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ContractService } = require('../contract-mcp/nas-service');
const { makeTempDir } = require('./helpers/test-helpers');

module.exports = async function runContractServiceTest() {
  const rootDir = makeTempDir('contract-service-');
  const libraryRoot = path.join(rootDir, '已签署协议电子档');
  const service = new ContractService({
    libraryRoot,
    dbPath: path.join(libraryRoot, '合同归档.db'),
    archiveIdPrefix: 'A',
    ourCompanyAliases: ['上海启迪创业孵化器有限公司', '上海启迪'],
    allowedExtensions: ['.pdf', '.docx', '.doc'],
    maxFileSizeMb: 10,
    defaultSearchLimit: 20,
  });

  try {
    fs.mkdirSync(path.join(libraryRoot, '采购（启迪支出）', '算力'), { recursive: true });
    fs.mkdirSync(path.join(libraryRoot, '专业服务收入协议（活动+算力+商业化）', '算力客户协议（启迪收入）'), { recursive: true });
    const scanPath = path.join(rootDir, 'scan.pdf');
    const wordPath = path.join(rootDir, 'contract.docx');
    const appendixPath = path.join(rootDir, 'appendix.pdf');
    fs.writeFileSync(scanPath, 'scan-file');
    fs.writeFileSync(wordPath, 'word-file');
    fs.writeFileSync(appendixPath, 'appendix-file');

    const directoryTree = service.listDirectory({
      relativePath: '采购（启迪支出）',
      depth: 2,
    });
    assert.equal(directoryTree.tree.name, '采购（启迪支出）');

    assert.throws(
      () => service.archiveContract({
        sourceFiles: [{ path: scanPath, name: 'scan.pdf' }],
        archiveRelativeDir: path.join('采购（启迪支出）', '算力'),
        operator: 'tester',
        uploaderUserId: 'tester',
      }),
      /不能省略 contract.*至少回填这些已识别字段/u,
    );

    const directArchived = service.archiveContract({
      contract: {
        contractName: '直归档测试算力采购协议',
        agreementType: '采购',
        partyAName: '上海启迪',
        partyBName: '算力供应商',
        signingDate: '2026-03-19',
        effectiveEndDate: '2026-12-31',
        contractAmount: 12888,
        uploadedBy: 'tester',
      },
      sourceFiles: [{ path: scanPath, name: 'scan.pdf' }],
      archiveRelativeDir: path.join('采购（启迪支出）', '算力'),
      sheetName: '费用支出协议',
      operator: 'tester',
      uploaderUserId: 'tester',
    });
    assert.match(directArchived.archive.archiveId, /^A\d{8}-\d{4}$/);
    assert.equal(directArchived.files.length, 1);
    assert.equal(fs.existsSync(directArchived.files[0].absolutePath), true);
    assert.equal(fs.existsSync(path.join(libraryRoot, '合同归档.db')), true);
    assert.match(directArchived.userReplyMessage, /数据库/u);

    const loadedArchive = service.getArchiveRecord(directArchived.archive.archiveId);
    assert.equal(loadedArchive.archive.contractName, '直归档测试算力采购协议');
    assert.equal(loadedArchive.files.length, 1);
    assert.equal(loadedArchive.events.length, 1);
    assert.equal(loadedArchive.events[0].payload.contract.contractName, '直归档测试算力采购协议');
    assert.equal(loadedArchive.events[0].payload.archiveRelativeDir, path.join('采购（启迪支出）', '算力'));
    assert.equal(loadedArchive.events[0].payload.sheetName, '费用支出协议');
    assert.equal(Array.isArray(loadedArchive.events[0].payload.committedFiles), true);
    assert.equal(loadedArchive.events[0].payload.committedFiles[0].sourceName, 'scan.pdf');

    const archiveSearch = service.searchArchiveRecords({
      keyword: '直归档测试算力',
      limit: 5,
    });
    assert.equal(archiveSearch.items.length, 1);
    assert.equal(archiveSearch.items[0].archiveId, directArchived.archive.archiveId);

    const searchResult = service.searchContracts({
      keyword: '算力',
      recentMonths: 2,
    });
    assert.equal(searchResult.items.length >= 1, true);

    const directoryMatches = service.findDirectories({
      keywords: ['算力'],
    });
    assert.equal(directoryMatches.items.length >= 2, true);

    const incomeArchived = service.archiveContract({
      contract: {
        contractName: '算力技术服务协议',
        agreementType: '算力技术服务',
        partyAName: '艾哎思维（上海）科技有限公司',
        partyBName: '上海启迪创业孵化器有限公司',
        signingDate: '2025-12-01',
      },
      sourceFiles: [{ path: appendixPath, name: 'income.pdf' }],
      archiveRelativeDir: '专业服务收入协议（活动+算力+商业化）\\算力客户协议（启迪收入）',
      operator: 'tester',
      uploaderUserId: 'tester',
    });
    assert.match(incomeArchived.files[0].storedName, /艾哎思维/);
    assert.doesNotMatch(incomeArchived.files[0].storedName, /上海启迪创业孵化器有限公司/);
  } finally {
    service.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
