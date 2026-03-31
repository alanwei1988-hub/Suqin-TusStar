const assert = require('node:assert/strict');
const { registerChannelHandlers } = require('../app');
const MockChannelAdapter = require('../channel/mock/adapter');
const { waitFor } = require('./helpers/test-helpers');

module.exports = async function runChannelStopTest() {
  const channel = new MockChannelAdapter({}, {});
  const startedTexts = [];

  const agent = {
    async chat(userId, text, attachments = [], options = {}) {
      assert.ok(options.abortSignal);
      startedTexts.push(`${userId}:${text}`);

      if (text === '第一条') {
        await new Promise((resolve, reject) => {
          const onAbort = () => {
            reject(options.abortSignal.reason || new Error('aborted'));
          };

          if (options.abortSignal.aborted) {
            onAbort();
            return;
          }

          options.abortSignal.addEventListener('abort', onAbort, { once: true });
        });
      }

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
    userId: 'user-1',
    text: '第二条',
    context: { reqId: 'req-2' },
  });

  await waitFor(() => channel.streamReplies.length === 2);

  channel.simulateMessage({
    userId: 'user-1',
    text: '/stop',
    context: { reqId: 'req-stop' },
  });

  await waitFor(() => channel.replies.length >= 3);
  await new Promise(resolve => setTimeout(resolve, 80));

  assert.deepEqual(startedTexts, ['user-1:第一条']);
  assert.equal(channel.streamReplies[0].finalContent, '已按 /stop 停止当前响应。');
  assert.equal(channel.streamReplies[1].finalContent, '已按 /stop 取消排队中的请求。');
  assert.equal(
    channel.replies.some(reply => reply.content === '已停止 1 条正在处理的请求，并取消 1 条排队请求。'),
    true,
  );
};
