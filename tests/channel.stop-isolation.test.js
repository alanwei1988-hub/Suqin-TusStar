const assert = require('node:assert/strict');
const { registerChannelHandlers } = require('../app');
const MockChannelAdapter = require('../channel/mock/adapter');
const { waitFor } = require('./helpers/test-helpers');

module.exports = async function runChannelStopIsolationTest() {
  const channel = new MockChannelAdapter({}, {});
  const startedTexts = [];

  const agent = {
    async chat(userId, text, attachments = [], options = {}) {
      assert.ok(options.abortSignal);
      startedTexts.push(`${userId}:${text}`);

      if (userId === 'user-1' && text === '第一条') {
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
    userId: 'user-2',
    text: '并发消息',
    context: { reqId: 'req-2' },
  });

  await waitFor(() => startedTexts.includes('user-2:并发消息'));

  channel.simulateMessage({
    userId: 'user-1',
    text: '/stop',
    context: { reqId: 'req-stop' },
  });

  await waitFor(() => channel.replies.some(reply => reply.content === 'user-2:并发消息 已处理'));
  await waitFor(() => channel.replies.some(reply => reply.content === '已停止当前正在处理的请求。'));

  assert.equal(
    channel.replies.some(reply => reply.content === '已按 /stop 停止当前响应。'),
    true,
  );
  assert.equal(
    channel.replies.some(reply => reply.content === 'user-2:并发消息 已处理'),
    true,
  );
};
