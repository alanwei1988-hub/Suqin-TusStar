const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WxWorkAdapter = require('../channel/wxwork/adapter');
const { waitFor } = require('./helpers/test-helpers');

module.exports = async function runWxworkAdapterTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxwork-adapter-'));
  const adapter = new WxWorkAdapter({
    botId: 'test-bot',
    secret: 'test-secret',
    debug: false,
    streamingResponse: true,
  }, {
    tempDir,
  });

  const streamCalls = [];
  const events = [];

  try {
    adapter.bot.respondStreamMsg = (reqId, content, streamId, finish) => {
      streamCalls.push({ reqId, content, streamId, finish });
      return true;
    };
    adapter.bot.downloadMedia = async () => Buffer.from('encrypted');
    adapter.bot.decryptMedia = () => Buffer.from('decrypted');

    adapter.on('message', payload => {
      events.push(payload);
    });

    adapter.bot.emit('message', {
      from: { userid: 'u1' },
      msgtype: 'file',
      file: {
        url: 'https://example.invalid/file',
        aeskey: 'secret',
        name: 'contract.pdf',
      },
    }, 'req-1');

    await waitFor(() => events.length === 1);

    assert.equal(streamCalls.length >= 1, true);
    assert.equal(streamCalls[0].reqId, 'req-1');
    assert.equal(streamCalls[0].content, '已收到文件，正在下载并处理...');
    assert.equal(streamCalls[0].finish, false);

    assert.equal(events[0].context.reqId, 'req-1');
    assert.equal(events[0].context.initialStatusSent, true);
    assert.equal(events[0].context.streamId, streamCalls[0].streamId);
    assert.equal(events[0].attachments.length, 1);

    const streamReply = adapter.createStreamingReply('u1', events[0].context);
    await streamReply.updateStatus('文件已下载，正在处理...');

    assert.equal(streamCalls[1].streamId, streamCalls[0].streamId);
    assert.equal(streamCalls[1].content, '文件已下载，正在处理...');
    assert.equal(streamCalls[1].finish, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};
