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
    userRootDir: path.join(tempDir, 'users'),
  });

  const streamCalls = [];
  const uploadCalls = [];
  const sendCalls = [];
  const events = [];
  const downloadCalls = [];
  let releaseFirstDownload;
  const minimalPdfBuffer = Buffer.from(`%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 1 /Kids [3 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF`);
  const buffersByUrl = {
    'https://example.invalid/file': minimalPdfBuffer,
    'https://example.invalid/file-no-ext': minimalPdfBuffer,
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
    adapter.bot.downloadMedia = async url => {
      downloadCalls.push(url);
      if (url === 'https://example.invalid/file') {
        await new Promise(resolve => {
          releaseFirstDownload = resolve;
        });
      }
      return buffersByUrl[url];
    };
    adapter.bot.decryptMedia = encryptedBuffer => encryptedBuffer;
    adapter.bot.uploadMedia = async (type, filename, buffer) => {
      uploadCalls.push({ type, filename, size: buffer.length });
      return `media-${uploadCalls.length}`;
    };
    adapter.bot.sendMsg = (chatId, chatType, msgType, content) => {
      sendCalls.push({ chatId, chatType, msgType, content });
      return true;
    };

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
    assert.equal(downloadCalls.length, 0);

    assert.equal(events[0].context.reqId, 'req-1');
    assert.equal(events[0].context.initialStatusSent, true);
    assert.equal(events[0].context.streamId, streamCalls[0].streamId);
    assert.equal(typeof events[0].prepareMessage, 'function');
    assert.equal(events[0].attachments.length, 0);

    const firstPreparedPromise = events[0].prepareMessage();
    await waitFor(() => downloadCalls.length === 1);
    releaseFirstDownload();
    const firstPrepared = await firstPreparedPromise;

    assert.equal(firstPrepared.text, '[Sent a file: contract.pdf, pages=1]');
    assert.equal(firstPrepared.attachments.length, 1);
    assert.equal(firstPrepared.attachments[0].path.startsWith('attachment://'), true);
    assert.equal(path.extname(firstPrepared.attachments[0].path), '.pdf');
    assert.equal(firstPrepared.attachments[0].extension, '.pdf');
    assert.equal(firstPrepared.attachments[0].mimeType, 'application/pdf');
    assert.equal(firstPrepared.attachments[0].kind, 'pdf');
    assert.equal(firstPrepared.attachments[0].sizeBytes, buffersByUrl['https://example.invalid/file'].length);
    assert.equal(firstPrepared.attachments[0].pageCount, 1);
    assert.equal(firstPrepared.attachments[0].pageRangeSupported, true);

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
    const secondPrepared = await events[1].prepareMessage();
    assert.equal(path.extname(secondPrepared.attachments[0].path), '.pdf');
    assert.equal(secondPrepared.attachments[0].pageCount, 1);

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
    const thirdPrepared = await events[2].prepareMessage();
    assert.equal(path.extname(thirdPrepared.attachments[0].path), '.doc');

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
    const fourthPrepared = await events[3].prepareMessage();
    assert.equal(path.extname(fourthPrepared.attachments[0].path), '.csv');
    assert.equal(fourthPrepared.attachments[0].kind, 'spreadsheet');
    assert.equal(fourthPrepared.attachments[0].mimeType, 'text/csv');

    await adapter.sendAttachments('u4', [{
      path: fourthPrepared.attachments[0].path,
      name: 'monthly_report.csv',
    }], events[3].context);

    assert.deepEqual(uploadCalls[0], {
      type: 'file',
      filename: 'monthly_report.csv',
      size: buffersByUrl['https://example.invalid/file-csv'].length,
    });
    assert.deepEqual(sendCalls[0], {
      chatId: 'u4',
      chatType: 1,
      msgType: 'file',
      content: {
        file: {
          media_id: 'media-1',
        },
      },
    });

    adapter.bot.uploadMedia = async () => {
      throw new Error('初始化上传失败: file too large (代码: 40058)');
    };

    await assert.rejects(
      () => adapter.sendAttachments('u4', [{
        path: fourthPrepared.attachments[0].path,
        name: 'oversized.csv',
      }], events[3].context),
      error => {
        assert.equal(error.code, 'ATTACHMENT_SEND_FAILED');
        assert.equal(path.isAbsolute(error.absolutePath), true);
        assert.equal(path.basename(error.absolutePath).endsWith('monthly_report.csv'), true);
        assert.equal(error.userMessage.includes('文件太大，当前无法直接发送。'), true);
        assert.equal(error.userMessage.includes('[点击打开文件](file:///'), true);
        assert.equal(error.userMessage.includes('绝对路径：'), false);
        return true;
      },
    );

    adapter.bot.uploadMedia = async () => {
      throw new Error('初始化上传失败: invalid file size, hint: [123], more info at https://open.work.weixin.qq.com/devtool/query?e=40006 (代码: 40006)');
    };

    await assert.rejects(
      () => adapter.sendAttachments('u4', [{
        path: fourthPrepared.attachments[0].path,
        name: 'oversized-invalid-size.csv',
      }], events[3].context),
      error => {
        assert.equal(error.code, 'ATTACHMENT_SEND_FAILED');
        assert.equal(error.userMessage.includes('文件太大，当前无法直接发送。'), true);
        assert.equal(error.userMessage.includes('hint: [123]'), false);
        assert.equal(error.userMessage.includes('more info at https://open.work.weixin.qq.com/devtool/query?e=40006'), false);
        assert.equal(error.userMessage.includes('invalid file size'), false);
        return true;
      },
    );

    await adapter.sendText('u5', '待录入协议台账\n编号：P20260324-001', { chatId: 'u5', chatType: 1 });
    assert.deepEqual(sendCalls[1], {
      chatId: 'u5',
      chatType: 1,
      msgType: 'markdown',
      content: {
        markdown: {
          content: '待录入协议台账\n编号：P20260324-001',
        },
      },
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};
