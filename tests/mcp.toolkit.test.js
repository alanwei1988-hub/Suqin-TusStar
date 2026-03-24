const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createMcpToolkit } = require('../agent/tools/mcp');
const { createContractMcpFixture, makeTempDir } = require('./helpers/test-helpers');

class HangingMcpMockTransport {
  constructor() {
    this.onmessage = undefined;
    this.onclose = undefined;
    this.onerror = undefined;
  }

  async start() {
    return undefined;
  }

  async send(message) {
    if (message.method === 'initialize') {
      this.onmessage?.({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-06-18',
          serverInfo: {
            name: 'hanging-mock',
            version: '1.0.0',
          },
          capabilities: {
            tools: {},
          },
          instructions: 'Hanging mock transport.',
        },
      });
      return;
    }

    if (message.method === 'tools/list') {
      this.onmessage?.({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: [{
            name: 'hang_forever',
            title: 'Hang Forever',
            description: 'Never returns a result.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
          }],
        },
      });
    }
  }

  async close() {
    this.onclose?.();
  }
}

module.exports = async function runMcpToolkitTest() {
  const rootDir = makeTempDir('mcp-toolkit-');
  const fixture = createContractMcpFixture(rootDir);
  const scanPath = path.join(rootDir, 'scan.pdf');
  fs.writeFileSync(scanPath, 'scan');

  const toolkit = await createMcpToolkit([fixture.mcpServer]);

  try {
    assert.equal(typeof toolkit.tools.contract_prepare_archive.execute, 'function');
    assert.equal(toolkit.toolDisplayByName.contract_list_directory.statusText, '查看合同目录');
    assert.equal(toolkit.toolDisplayByName.contract_confirm_archive.statusText, '正式归档合同');
    assert(toolkit.readOnlyToolNames.includes('contract_list_directory'));
    assert(toolkit.readOnlyToolNames.includes('contract_search'));
    assert.equal(
      toolkit.toolSchemasByName.contract_prepare_archive.properties.contract.additionalProperties,
      false,
    );
    assert.equal(
      toolkit.toolSchemasByName.contract_prepare_archive.properties.contract.properties.contractName.type,
      'string',
    );
    assert.deepEqual(
      toolkit.toolSchemasByName.contract_prepare_archive.properties.contract.properties.direction.enum,
      ['income', 'expense'],
    );

    const directoryResult = await toolkit.tools.contract_list_directory.execute({
      relativePath: '采购（启迪支出）',
      depth: 1,
    });
    assert.equal(directoryResult.structuredContent.tree.name, '采购（启迪支出）');

    const prepareResult = await toolkit.tools.contract_prepare_archive.execute({
      contract: {
        contractName: 'MCP 测试算力合同',
        agreementType: '采购',
        partyAName: '上海启迪',
        partyBName: '算力供应商',
        signingDate: '2026-03-19',
        uploadedBy: 'tester',
      },
      sourceFiles: [{ path: scanPath, name: 'scan.pdf' }],
      archiveRelativeDir: '采购（启迪支出）\\算力',
      operator: 'tester',
    });
    assert.match(prepareResult.structuredContent.pending.pendingId, /^P\d{8}-\d{3}$/);

    await assert.rejects(
      () => toolkit.tools.contract_prepare_archive.execute({
        sourceFiles: [{ path: scanPath, name: 'scan.pdf' }],
        archiveRelativeDir: '专业服务收入协议（活动+算力+商业化）\\算力客户协议（启迪收入）',
        sheetName: '有结算款项协议',
        operator: 'tester',
        uploaderUserId: 'tester',
      }),
      /不能省略 contract.*至少回填这些已识别字段/u,
    );

    const hangingToolkit = await createMcpToolkit([{
      name: 'hanging-mock',
      transport: 'mock',
      toolTimeoutMs: 20,
      mockTransport: new HangingMcpMockTransport(),
    }]);

    try {
      await assert.rejects(
        () => hangingToolkit.tools.hang_forever.execute({}),
        /timed out after 20ms/i,
      );
    } finally {
      await hangingToolkit.close();
    }
  } finally {
    await toolkit.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
