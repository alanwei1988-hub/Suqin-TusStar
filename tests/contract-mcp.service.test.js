const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ContractService } = require('../contract-mcp/nas-service');
const { makeTempDir } = require('./helpers/test-helpers');

module.exports = async function runContractServiceTest() {
  const rootDir = makeTempDir('contract-service-');
  const libraryRoot = path.join(rootDir, '已签署协议电子档');
  const serviceConfig = {
    libraryRoot,
    dbPath: path.join(libraryRoot, '合同归档.db'),
    archiveIdPrefix: 'A',
    ourCompanyAliases: ['上海启迪创业孵化器有限公司', '上海启迪'],
    allowedExtensions: ['.pdf', '.docx', '.doc'],
    maxFileSizeMb: 10,
    defaultSearchLimit: 20,
  };
  let service = new ContractService(serviceConfig);

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

    const preview = service.previewArchive({
      contract: {
        contractName: '直归档测试算力采购协议',
        agreementType: '采购',
        partyAName: '上海启迪',
        partyBName: '算力供应商',
        signingDate: '2026-03-19',
        contractAmount: 12888,
        uploadedBy: 'tester',
      },
      sourceFiles: [{ path: scanPath, name: 'scan.pdf' }],
      archiveRelativeDir: path.join('采购（启迪支出）', '算力'),
      sheetName: '费用支出协议',
      operator: 'tester',
      uploaderUserId: 'tester',
    });
    assert.match(preview.confirmationMessage, /请确认以下归档预览信息/u);
    assert.match(preview.confirmationMessage, /合同名称：直归档测试算力采购协议/u);
    assert.match(preview.confirmationMessage, /将写入归档数据库的字段：/u);
    assert.match(preview.confirmationMessage, /未填写字段：/u);
    assert.equal(preview.importantFields.some(field => field.label === '合同名称' && field.filled), true);
    assert.equal(preview.mergedPreviewFields.some(field => field.label === '合同名称' && field.filled), true);
    assert.equal(preview.importantFields.some(field => field.label === '他方' && !field.filled), true);

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
    assert.equal(fs.existsSync(scanPath), true);
    assert.equal(fs.existsSync(path.join(libraryRoot, '合同归档.db')), true);
    assert.match(directArchived.userReplyMessage, /数据库/u);
    assert.match(directArchived.userReplyMessage, /本次写入归档数据库的字段/u);
    assert.match(directArchived.userReplyMessage, /合同名称：直归档测试算力采购协议/u);

    const loadedArchive = service.getArchiveRecord(directArchived.archive.archiveId);
    assert.equal(loadedArchive.archive.contractName, '直归档测试算力采购协议');
    assert.equal(loadedArchive.files.length, 1);
    assert.equal(loadedArchive.archive.fileCount, 1);
    assert.equal(loadedArchive.archive.storedFiles.length, 1);
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

    const looseArchiveSearch = service.searchArchiveRecords({
      keyword: `${directArchived.archive.archiveId} 35000 直归档测试算力`,
      contractName: '直归档测试算力',
      limit: 5,
    });
    assert.equal(looseArchiveSearch.items.length, 1);
    assert.equal(looseArchiveSearch.items[0].archiveId, directArchived.archive.archiveId);
    assert.equal(looseArchiveSearch.items[0].fileCount, 1);

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

    const looseNasSearch = service.searchContracts({
      keyword: '艾哎思维 算力技术服务协议 35000',
      keywords: ['艾哎思维（上海）科技有限公司', '35000'],
      topLevelCategory: '专业服务收入协议（活动+算力+商业化）',
      recentMonths: 2,
    });
    assert.equal(looseNasSearch.items.length >= 1, true);
    assert.match(looseNasSearch.items[0].relativePath, /艾哎思维/u);

    const paymentArchived = service.archiveContract({
      contract: {
        contractName: '分期付款测试协议',
        agreementType: '采购',
        partyAName: '上海启迪',
        partyBName: '付款供应商',
        signingDate: '2026-03-20',
        contractAmount: '3000',
        firstPaymentAmount: '1000',
        firstPaymentDate: '2026.3.4',
        finalPaymentAmount: '2000',
        finalPaymentDate: '2026.12.5',
        paymentStatus: '首期已付',
        hasSettlement: true,
        ourOwner: '张三',
        uploadedBy: 'tester',
      },
      sourceFiles: [{ path: wordPath, name: 'contract.docx' }],
      archiveRelativeDir: path.join('采购（启迪支出）', '算力'),
      sheetName: '费用支出协议',
      operator: 'tester',
      uploaderUserId: 'tester',
    });
    assert.equal(paymentArchived.archive.firstPaymentDate, '2026-03-04');
    assert.equal(paymentArchived.archive.finalPaymentDate, '2026-12-05');
    assert.equal(fs.existsSync(wordPath), true);

    const loadedPaymentArchive = service.getArchiveRecord(paymentArchived.archive.archiveId);
    assert.equal(loadedPaymentArchive.archive.firstPaymentDate, '2026-03-04');
    assert.equal(loadedPaymentArchive.archive.finalPaymentDate, '2026-12-05');
    assert.equal(loadedPaymentArchive.events[0].payload.contract.firstPaymentDate, '2026-03-04');
    assert.equal(loadedPaymentArchive.events[0].payload.contract.finalPaymentDate, '2026-12-05');

    const filteredArchiveSearch = service.searchArchiveRecords({
      contractName: '分期付款测试',
      counterpartyName: '付款供应商',
      agreementType: '采购',
      ourOwner: '张三',
      paymentStatus: '首期已付',
      hasSettlement: true,
      firstPaymentDateFrom: '2026-03-01',
      firstPaymentDateTo: '2026-03-31',
      finalPaymentDateFrom: '2026-12-01',
      finalPaymentDateTo: '2026-12-31',
      minAmount: '2500',
      maxAmount: '3500',
      archivedAtFrom: loadedPaymentArchive.archive.archivedAt,
      archivedAtTo: loadedPaymentArchive.archive.archivedAt,
      limit: 5,
    });
    assert.equal(filteredArchiveSearch.items.length, 1);
    assert.equal(filteredArchiveSearch.items[0].archiveId, paymentArchived.archive.archiveId);

    service.repository.db.prepare(`
      UPDATE archive_records
      SET archived_at = ?, created_at = ?, updated_at = ?
      WHERE archive_id = ?
    `).run(
      '2026-03-23T16:30:00.000Z',
      '2026-03-23T16:30:00.000Z',
      '2026-03-23T16:30:00.000Z',
      paymentArchived.archive.archiveId,
    );

    const beijingDaySearch = service.searchArchiveRecords({
      contractName: '分期付款测试',
      archivedAtFrom: '2026-03-24',
      archivedAtTo: '2026-03-24',
      createdAtFrom: '2026-03-24',
      createdAtTo: '2026-03-24',
      updatedAtFrom: '2026-03-24',
      updatedAtTo: '2026-03-24',
      limit: 5,
    });
    assert.equal(beijingDaySearch.items.length, 1);
    assert.equal(beijingDaySearch.items[0].archiveId, paymentArchived.archive.archiveId);

    service.repository.db.prepare(`
      UPDATE archive_records
      SET first_payment_date = ?, final_payment_date = ?
      WHERE archive_id = ?
    `).run('2026.3.6', '2026.12.7', paymentArchived.archive.archiveId);

    service.close();
    service = new ContractService(serviceConfig);

    const migratedArchive = service.getArchiveRecord(paymentArchived.archive.archiveId);
    assert.equal(migratedArchive.archive.firstPaymentDate, '2026-03-06');
    assert.equal(migratedArchive.archive.finalPaymentDate, '2026-12-07');

    fs.writeFileSync(scanPath, 'scan-file-multi');
    fs.writeFileSync(wordPath, 'word-file-multi');
    fs.writeFileSync(appendixPath, 'appendix-file-multi');

    const multiFileArchived = service.archiveContract({
      contract: {
        contractName: '多文件归档测试协议',
        agreementType: '采购',
        partyAName: '上海启迪',
        partyBName: '多文件供应商',
        signingDate: '2026-03-21',
        uploadedBy: 'tester',
      },
      sourceFiles: [
        { path: scanPath, name: 'scan.pdf' },
        { path: wordPath, name: 'contract.docx' },
        { path: appendixPath, name: 'appendix.pdf' },
      ],
      archiveRelativeDir: path.join('采购（启迪支出）', '算力'),
      operator: 'tester',
      uploaderUserId: 'tester',
    });
    assert.equal(multiFileArchived.files.length, 3);
    assert.equal(multiFileArchived.archive.fileCount, 3);
    assert.equal(multiFileArchived.archive.storedFiles.length, 3);
    assert.equal(fs.existsSync(scanPath), true);
    assert.equal(fs.existsSync(wordPath), true);
    assert.equal(fs.existsSync(appendixPath), true);

    const loadedMultiFileArchive = service.getArchiveRecord(multiFileArchived.archive.archiveId);
    assert.equal(loadedMultiFileArchive.files.length, 3);
    assert.equal(loadedMultiFileArchive.archive.fileCount, 3);
    assert.deepEqual(
      loadedMultiFileArchive.files.map(file => file.sourceName),
      ['scan.pdf', 'contract.docx', 'appendix.pdf'],
    );

    const multiFileSearch = service.searchArchiveRecords({
      contractName: '多文件归档测试',
      limit: 5,
    });
    assert.equal(multiFileSearch.items.length, 1);
    assert.equal(multiFileSearch.items[0].fileCount, 3);
    assert.equal(multiFileSearch.items[0].storedFiles.length, 3);
  } finally {
    service.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
