const assert = require('node:assert/strict');
const { registerChannelHandlers } = require('../app');
const MockChannelAdapter = require('../channel/mock/adapter');
const { waitFor } = require('./helpers/test-helpers');

module.exports = async function runChannelPreprocessQueueTest() {
  const channel = new MockChannelAdapter({}, {});
  const startedTexts = [];
  const receivedAttachments = [];
  let releasePreparation;
  let releaseFirstReply;

  const agent = {
    async chat(userId, text, attachments) {
      startedTexts.push(text);
      receivedAttachments.push(attachments);

      if (text === '[Sent a file: contract.pdf]') {
        await new Promise(resolve => {
          releaseFirstReply = resolve;
        });
      }

      return {
        text: `${text} 已处理`,
        outboundAttachments: [],
      };
    },
  };

  registerChannelHandlers({ agent, channel });

  channel.simulateMessage({
    userId: 'user-1',
    context: {
      reqId: 'req-1',
      initialStatusSent: true,
      streamId: 'sid-1',
    },
    prepareMessage: async () => {
      await new Promise(resolve => {
        releasePreparation = resolve;
      });

      return {
        text: '[Sent a file: contract.pdf]',
        attachments: [{
          path: 'tmp/contract.pdf',
          name: 'contract.pdf',
        }],
      };
    },
  });

  await waitFor(() => channel.streamReplies.length === 1);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.deepEqual(startedTexts, []);

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
  assert.deepEqual(startedTexts, []);

  releasePreparation();

  await waitFor(() => startedTexts.length === 1);
  assert.deepEqual(startedTexts, ['[Sent a file: contract.pdf]']);
  assert.deepEqual(receivedAttachments[0], [{
    path: 'tmp/contract.pdf',
    name: 'contract.pdf',
  }]);

  await new Promise(resolve => setTimeout(resolve, 80));
  assert.deepEqual(startedTexts, ['[Sent a file: contract.pdf]']);

  releaseFirstReply();

  await waitFor(() => startedTexts.length === 2);
  await waitFor(() => channel.replies.length === 2);

  assert.deepEqual(startedTexts, ['[Sent a file: contract.pdf]', '第二条']);
  assert.equal(channel.replies[0].content, '[Sent a file: contract.pdf] 已处理');
  assert.equal(channel.replies[1].content, '第二条 已处理');
};
