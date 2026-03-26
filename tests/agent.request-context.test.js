const assert = require('node:assert/strict');
const AgentCore = require('../agent');

module.exports = async function runAgentRequestContextTest() {
  const prompt = AgentCore.buildRequestContextPrompt({
    userId: 'XiaoDao',
    userDisplayName: '小刀',
    context: {
      chatId: 'room-1',
      chatType: 2,
      currentDateTime: '2026-03-25T16:30:00.000Z',
      timezone: 'Asia/Shanghai',
    },
  });

  assert.match(prompt, /Current Time/);
  assert.match(prompt, /Current date \(Asia\/Shanghai\): 2026-03-26/);
  assert.match(prompt, /Current time \(Asia\/Shanghai\): 00:30:00/);
  assert.match(prompt, /Interpret relative time words such as today, tomorrow, yesterday, recent, and this month against this timestamp/);
  assert.match(prompt, /Current requester user id: XiaoDao/);
  assert.match(prompt, /Current requester display name: 小刀/);
  assert.match(prompt, /Current chat target: room-1 \(chatType=2\)/);
};
