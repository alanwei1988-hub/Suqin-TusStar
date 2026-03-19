const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ContractService } = require('../contract-mcp/service');
const { makeTempDir } = require('./helpers/test-helpers');

module.exports = async function runContractServiceTest() {
  const rootDir = makeTempDir('contract-service-');
  const storageRoot = path.join(rootDir, 'storage');
  const service = new ContractService({
    dbPath: path.join(rootDir, 'contracts.db'),
    storageRoot,
    stagingDir: path.join(storageRoot, '.staging'),
    contractIdPrefix: 'CT',
    allowedExtensions: ['.pdf', '.docx', '.doc'],
    maxFileSizeMb: 10,
    defaultSearchLimit: 20,
  });

  try {
    const scanPath = path.join(rootDir, 'scan.pdf');
    const wordPath = path.join(rootDir, 'contract.docx');
    const appendixPath = path.join(rootDir, 'appendix.pdf');
    fs.writeFileSync(scanPath, 'scan-file');
    fs.writeFileSync(wordPath, 'word-file');
    fs.writeFileSync(appendixPath, 'appendix-file');

    const validation = service.validateContractPayload({
      contract: {
        contractName: '测试合同',
        partyAName: '甲方公司',
      },
      files: [],
    });
    assert.equal(validation.ok, false);
    assert(validation.missingFields.includes('contract.partyBName'));
    assert(validation.missingFields.includes('files'));

    const created = service.createContract({
      contract: {
        contractName: '测试合同',
        partyAName: '甲方公司',
        partyBName: '乙方公司',
        signingDate: '2026-03-19',
        effectiveEndDate: '2026-12-31',
        contractAmount: 12888,
        summary: '合同归档测试',
        uploadedBy: 'tester',
      },
      files: [
        { path: scanPath, role: 'scan' },
        { path: wordPath, role: 'original_word' },
      ],
      operator: 'tester',
      idempotencyKey: 'create-001',
    });

    assert.equal(created.reused, false);
    assert.match(created.contract.contractId, /^CT-\d{8}-\d{4}$/);
    assert.equal(created.files.length, 2);
    assert.equal(fs.existsSync(path.join(storageRoot, 'contracts', created.contract.contractId, 'metadata.json')), true);

    const reused = service.createContract({
      contract: {
        contractName: '测试合同',
        partyAName: '甲方公司',
        partyBName: '乙方公司',
        signingDate: '2026-03-19',
        uploadedBy: 'tester',
      },
      files: [{ path: scanPath, role: 'scan' }],
      operator: 'tester',
      idempotencyKey: 'create-001',
    });
    assert.equal(reused.reused, true);
    assert.equal(reused.contract.contractId, created.contract.contractId);

    const searchResult = service.searchContracts({ keyword: '测试合同' });
    assert.equal(searchResult.items.length, 1);

    const updated = service.updateContract({
      contractId: created.contract.contractId,
      patch: {
        summary: '更新后的摘要',
        contractAmount: 25600,
      },
      operator: 'tester',
      changeReason: '修正金额',
    });
    assert.equal(updated.contract.summary, '更新后的摘要');
    assert.equal(updated.contract.contractAmount, 25600);

    const attached = service.attachFiles({
      contractId: created.contract.contractId,
      files: [{ path: appendixPath, role: 'attachment' }],
      operator: 'tester',
    });
    assert.equal(attached.files.length, 3);

    const expiring = service.listExpiringContracts({ withinDays: 365 });
    assert.equal(expiring.items.length, 1);

    const archived = service.archiveContract({
      contractId: created.contract.contractId,
      operator: 'tester',
      reason: '测试归档',
    });
    assert.equal(archived.contract.status, 'archived');
  } finally {
    service.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
