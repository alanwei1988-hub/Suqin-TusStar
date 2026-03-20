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
  const buffersByUrl = {
    'https://example.invalid/file': Buffer.from('encrypted'),
    'https://example.invalid/file-no-ext': Buffer.from('%PDF-1.7\nfake pdf body'),
    'https://example.invalid/file-old-doc': Buffer.concat([
      Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]),
      Buffer.from('WordDocument', 'utf16le'),
      Buffer.from('fake legacy doc'),
    ]),
    'https://example.invalid/file-csv': Buffer.from('name,amount\nalice,12\nbob,18\n'),
  };

  try {
    adapter.bot.respondStreamMsg = (reqId, content, streamId, finish) => {
      streamCalls.push({ reqId, content, streamId, finish });
      return true;
    };
    adapter.bot.downloadMedia = async url => buffersByUrl[url];
    adapter.bot.decryptMedia = encryptedBuffer => encryptedBuffer;

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
    assert.equal(path.extname(events[0].attachments[0].path), '.pdf');
    assert.equal(events[0].attachments[0].extension, '.pdf');
    assert.equal(events[0].attachments[0].mimeType, 'application/pdf');
    assert.equal(events[0].attachments[0].kind, 'pdf');
    assert.equal(events[0].attachments[0].sizeBytes, buffersByUrl['https://example.invalid/file'].length);

    const streamReply = adapter.createStreamingReply('u1', events[0].context);
    await streamReply.updateStatus('文件已下载，正在处理...');

    assert.equal(streamCalls[1].streamId, streamCalls[0].streamId);
    assert.equal(streamCalls[1].content, '文件已下载，正在处理...');
    assert.equal(streamCalls[1].finish, false);

    adapter.bot.emit('message', {
      from: { userid: 'u2' },
      msgtype: 'file',
      file: {
        url: 'https://example.invalid/file-no-ext',
        aeskey: 'secret',
        name: 'file_1773891048009',
      },
    }, 'req-2');

    await waitFor(() => events.length === 2);
    assert.equal(path.extname(events[1].attachments[0].path), '.pdf');

    adapter.bot.emit('message', {
      from: { userid: 'u3' },
      msgtype: 'file',
      file: {
        url: 'https://example.invalid/file-old-doc',
        aeskey: 'secret',
        name: 'legacy_word_file',
      },
    }, 'req-3');

    await waitFor(() => events.length === 3);
    assert.equal(path.extname(events[2].attachments[0].path), '.doc');

    adapter.bot.emit('message', {
      from: { userid: 'u4' },
      msgtype: 'file',
      file: {
        url: 'https://example.invalid/file-csv',
        aeskey: 'secret',
        name: 'monthly_report',
      },
    }, 'req-4');

    await waitFor(() => events.length === 4);
    assert.equal(path.extname(events[3].attachments[0].path), '.csv');
    assert.equal(events[3].attachments[0].kind, 'spreadsheet');
    assert.equal(events[3].attachments[0].mimeType, 'text/csv');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};
