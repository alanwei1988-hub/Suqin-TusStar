const assert = require('node:assert/strict');
const { formatToolCallStatus } = require('../app');
const { createToolDisplayInfo, fallbackStatusText, humanizeToolName } = require('../agent/tools/display');

module.exports = async function runAppStatusFormatTest() {
  assert.equal(humanizeToolName('readAttachmentText'), 'read attachment text');
  assert.equal(fallbackStatusText('contract_create'), '处理合同信息');
  assert.equal(fallbackStatusText('contract_search'), '查询合同信息');
  assert.equal(fallbackStatusText('totallyUnknownTool'), '调用系统工具处理');
  assert.deepEqual(
    createToolDisplayInfo('bash', {
      displayName: '命令执行',
      statusText: '执行命令',
    }),
    {
      displayName: '命令执行',
      statusText: '执行命令',
    },
  );

  assert.equal(
    formatToolCallStatus({
      stepNumber: 0,
      toolCall: {
        toolName: 'bash',
        statusText: '执行命令',
      },
    }),
    '正在处理（第 1 步）：执行命令',
  );

  assert.equal(
    formatToolCallStatus({
      stepNumber: 1,
      toolCall: {
        toolName: 'unknown_tool',
      },
    }),
    '正在处理（第 2 步）：调用系统工具处理',
  );
};
