const assert = require('node:assert/strict');
const { registerChannelHandlers } = require('../app');
const MockChannelAdapter = require('../channel/mock/adapter');
const { waitFor } = require('./helpers/test-helpers');

module.exports = async function runChannelUserQueueIsolationTest() {
  const channel = new MockChannelAdapter({}, {});
  const startedTexts = [];
  const callOrder = [];
  let firstUserResolver;

  const agent = {
    async chat(userId, text) {
      callOrder.push(`start:${userId}:${text}`);
      startedTexts.push(`${userId}:${text}`);

      if (userId === 'user-1' && text === '第一条') {
        await new Promise(resolve => {
          firstUserResolver = resolve;
        });
      }

      callOrder.push(`finish:${userId}:${text}`);
      return {
        text: `${userId}:${text} 已处理`,
        outboundAttachments: [],
      };
    },
  };

  registerChannelHandlers({ agent, channel });

  channel.simulateMessage({
    userId: 'user-1',
    text: '第一条',
    context: { reqId: 'req-1' },
  });

  await waitFor(() => startedTexts.length === 1);

  channel.simulateMessage({
    userId: 'user-2',
    text: '并发消息',
    context: { reqId: 'req-2' },
  });

  await waitFor(() => startedTexts.length === 2);
  assert.deepEqual(startedTexts, ['user-1:第一条', 'user-2:并发消息']);
  assert.equal(
    channel.streamReplies[1].updates.some(update => update.kind === 'status' && update.content.includes('前方还有')),
    false,
  );

  firstUserResolver();

  await waitFor(() => channel.replies.length === 2);
  assert.deepEqual(callOrder, [
    'start:user-1:第一条',
    'start:user-2:并发消息',
    'finish:user-2:并发消息',
    'finish:user-1:第一条',
  ]);
};
