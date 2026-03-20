const assert = require('node:assert/strict');
const { registerChannelHandlers } = require('../app');
const MockChannelAdapter = require('../channel/mock/adapter');
const { waitFor } = require('./helpers/test-helpers');

module.exports = async function runChannelQueueTest() {
  const channel = new MockChannelAdapter({}, {});
  const callOrder = [];
  const startedTexts = [];
  let firstReplyResolver;

  const agent = {
    async chat(userId, text) {
      callOrder.push(`start:${text}`);
      startedTexts.push(text);

      if (text === '第一条') {
        await new Promise(resolve => {
          firstReplyResolver = resolve;
        });
      }

      callOrder.push(`finish:${text}`);
      return {
        text: `${text} 已处理`,
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
    userId: 'user-1',
    text: '第二条',
    context: { reqId: 'req-2' },
  });

  await waitFor(() => channel.streamReplies.length === 2);
  await waitFor(
    () => channel.streamReplies[1].updates.some(update => update.kind === 'status' && update.content.includes('前方还有 1 条消息')),
  );

  await new Promise(resolve => setTimeout(resolve, 80));
  assert.deepEqual(startedTexts, ['第一条']);

  firstReplyResolver();

  await waitFor(() => startedTexts.length === 2);
  await waitFor(() => channel.replies.length === 2);

  assert.deepEqual(callOrder, [
    'start:第一条',
    'finish:第一条',
    'start:第二条',
    'finish:第二条',
  ]);
  assert.equal(channel.replies[0].content, '第一条 已处理');
  assert.equal(channel.replies[1].content, '第二条 已处理');
};
