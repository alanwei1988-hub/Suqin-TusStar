const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createMcpToolkit } = require('../agent/tools/mcp');
const { createContractMcpFixture, makeTempDir } = require('./helpers/test-helpers');

module.exports = async function runMcpToolkitTest() {
  const rootDir = makeTempDir('mcp-toolkit-');
  const fixture = createContractMcpFixture(rootDir);
  const scanPath = path.join(rootDir, 'scan.pdf');
  fs.writeFileSync(scanPath, 'scan');

  const toolkit = await createMcpToolkit([fixture.mcpServer]);

  try {
    assert.equal(typeof toolkit.tools.contract_validate.execute, 'function');
    assert.equal(toolkit.toolDisplayByName.contract_validate.statusText, '查询合同信息');
    assert.equal(toolkit.toolDisplayByName.contract_create.statusText, '处理合同信息');
    assert(toolkit.readOnlyToolNames.includes('contract_validate'));
    assert(toolkit.readOnlyToolNames.includes('contract_search'));

    const validationResult = await toolkit.tools.contract_validate.execute({
      contract: {
        contractName: '测试合同',
      },
      files: [],
    });
    assert.equal(validationResult.structuredContent.ok, false);

    const createResult = await toolkit.tools.contract_create.execute({
      contract: {
        contractName: 'MCP 测试合同',
        partyAName: '甲方',
        partyBName: '乙方',
        signingDate: '2026-03-19',
        uploadedBy: 'tester',
      },
      files: [{ path: scanPath, role: 'scan' }],
      operator: 'tester',
    });
    assert.match(createResult.structuredContent.contract.contractId, /^CT-\d{8}-\d{4}$/);
  } finally {
    await toolkit.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
