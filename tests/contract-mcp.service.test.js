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
    statePath: path.join(rootDir, 'data', 'contract-workflow-state.json'),
    ledgerWorkbookPath: path.join(libraryRoot, '协议台账.xlsx'),
    ledgerAdminUserId: 'admin-1',
    pendingIdPrefix: 'P',
    ourCompanyAliases: ['上海启迪创业孵化器有限公司', '上海启迪'],
    allowedExtensions: ['.pdf', '.docx', '.doc'],
    maxFileSizeMb: 10,
    defaultSearchLimit: 20,
  });

  try {
    fs.mkdirSync(path.join(libraryRoot, '采购（启迪支出）', '算力'), { recursive: true });
    fs.mkdirSync(path.join(libraryRoot, '专业服务收入协议（活动+算力+商业化）', '算力客户协议（启迪收入）'), { recursive: true });
    fs.writeFileSync(path.join(libraryRoot, '协议台账.xlsx'), 'placeholder');
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
      () => service.prepareArchive({
        sourceFiles: [{ path: scanPath, name: 'scan.pdf' }],
        archiveRelativeDir: path.join('采购（启迪支出）', '算力'),
        operator: 'tester',
        uploaderUserId: 'tester',
      }),
      /不能省略 contract.*至少回填这些已识别字段/u,
    );

    const prepared = service.prepareArchive({
      contract: {
        contractName: '测试算力采购协议',
        agreementType: '采购',
        partyAName: '上海启迪',
        partyBName: '算力供应商',
        signingDate: '2026-03-19',
        effectiveEndDate: '2026-12-31',
        contractAmount: 12888,
        uploadedBy: 'tester',
      },
      sourceFiles: [
        { path: scanPath, name: 'scan.pdf' },
        { path: wordPath, name: 'contract.docx' },
      ],
      archiveRelativeDir: path.join('采购（启迪支出）', '算力'),
      sheetName: '费用支出协议',
      operator: 'tester',
      uploaderUserId: 'tester',
    });

    assert.match(prepared.pending.pendingId, /^P\d{8}-\d{3}$/);
    assert.equal(prepared.pending.status, 'drafted');
    assert.equal(prepared.pending.sheetName, '费用支出协议');
    assert.match(prepared.pending.plannedFiles[0].targetName, /算力供应商/);
    assert.match(prepared.uploaderConfirmationMessage, /请确认协议归档与台账信息/);

    const updated = service.updatePending({
      pendingId: prepared.pending.pendingId,
      operator: 'tester',
      contract: {
        counterpartyContact: '张三 13800000000',
      },
      ledgerFields: {
        总金额: '25600',
      },
    });
    assert.equal(updated.pending.ledgerFields['总金额'], '25600');

    const confirmed = service.confirmArchive({
      pendingId: prepared.pending.pendingId,
      operator: 'tester',
    });
    assert.equal(confirmed.pending.status, 'admin_pending');
    assert.equal(confirmed.pending.committedFiles.length, 2);
    assert.equal(fs.existsSync(confirmed.pending.committedFiles[0].absolutePath), true);
    assert.match(confirmed.adminLedgerMessage, /待录入协议台账/);

    const searchResult = service.searchContracts({
      keyword: '算力',
      recentMonths: 2,
    });
    assert.equal(searchResult.items.length, 2);

    const directoryMatches = service.findDirectories({
      keywords: ['算力'],
    });
    assert.equal(directoryMatches.items.length >= 2, true);

    const completed = service.completeLedger({
      pendingId: prepared.pending.pendingId,
      operator: 'admin-1',
      note: '已写入 Excel',
    });
    assert.equal(completed.pending.status, 'completed');

    const rejected = service.prepareArchive({
      contract: {
        contractName: '测试合同',
        partyAName: '甲方公司',
        partyBName: '乙方公司',
        signingDate: '2026-03-19',
      },
      sourceFiles: [{ path: appendixPath }],
      archiveRelativeDir: '专业服务收入协议（活动+算力+商业化）\\算力客户协议（启迪收入）',
      operator: 'tester',
      uploaderUserId: 'tester',
    });
    const rejectedResult = service.rejectPending({
      pendingId: rejected.pending.pendingId,
      operator: 'tester',
      reason: '目录不对',
    });
    assert.equal(rejectedResult.pending.status, 'uploader_rejected');

    const incomePrepared = service.prepareArchive({
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
    assert.match(incomePrepared.pending.plannedFiles[0].targetName, /艾哎思维/);
    assert.doesNotMatch(incomePrepared.pending.plannedFiles[0].targetName, /上海启迪创业孵化器有限公司/);
  } finally {
    service.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
