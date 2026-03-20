const EventEmitter = require('events');
const WeComAIBot = require('./src/wecom-bot');
const fs = require('fs');
const path = require('path');

const FALLBACK_MEDIA_EXTENSIONS = {
  image: '.jpg',
  file: '.dat',
  video: '.mp4',
};

let fileTypeModulePromise;

function containsAsciiOrUtf16(buffer, value) {
  return buffer.includes(Buffer.from(value))
    || buffer.includes(Buffer.from(value, 'utf16le'));
}

function detectLegacyOfficeExtension(buffer) {
  const oleHeader = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);

  if (!buffer || buffer.length < oleHeader.length || !buffer.subarray(0, oleHeader.length).equals(oleHeader)) {
    return '';
  }

  if (containsAsciiOrUtf16(buffer, 'WordDocument')) {
    return '.doc';
  }

  if (
    containsAsciiOrUtf16(buffer, 'Workbook')
    || containsAsciiOrUtf16(buffer, 'Book')
  ) {
    return '.xls';
  }

  if (containsAsciiOrUtf16(buffer, 'PowerPoint Document')) {
    return '.ppt';
  }

  if (containsAsciiOrUtf16(buffer, 'VisioDocument')) {
    return '.vsd';
  }

  return '.cfb';
}

function looksLikeDelimitedText(lines, delimiter) {
  const nonEmptyLines = lines.filter(line => line.trim().length > 0).slice(0, 6);

  if (nonEmptyLines.length < 2) {
    return false;
  }

  const widths = nonEmptyLines.map(line => line.split(delimiter).length);
  return widths[0] >= 2 && widths.every(width => width === widths[0]);
}

function detectTextExtension(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));

  if (sample.length === 0 || sample.includes(0x00)) {
    return '';
  }

  const text = sample.toString('utf8');

  if (text.includes('\uFFFD')) {
    return '';
  }

  const printableChars = Array.from(text).filter(char => {
    const code = char.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
  }).length;

  if (printableChars / text.length < 0.85) {
    return '';
  }

  const trimmed = text.trimStart();
  const lines = text.split(/\r?\n/);

  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<')) {
    return '.xml';
  }

  if (looksLikeDelimitedText(lines, ',')) {
    return '.csv';
  }

  if (looksLikeDelimitedText(lines, '\t')) {
    return '.tsv';
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return '.json';
  }

  return '.txt';
}

async function detectExtensionFromBuffer(buffer) {
  try {
    fileTypeModulePromise ||= import('file-type');
    const { fileTypeFromBuffer } = await fileTypeModulePromise;
    const result = await fileTypeFromBuffer(buffer);

    if (result?.ext && result.ext !== 'cfb') {
      return `.${result.ext}`;
    }

    if (result?.ext === 'cfb') {
      return detectLegacyOfficeExtension(buffer);
    }
  } catch {
    // Fall through to heuristic detection below.
  }

  return detectLegacyOfficeExtension(buffer) || detectTextExtension(buffer);
}

async function buildStoredFileName(msgType, originalName, buffer) {
  let safeFileName = `${Date.now()}_${originalName.replace(/[\\/:"*?<>|]/g, '_')}`;

  if (path.extname(safeFileName)) {
    return safeFileName;
  }

  const detectedExtension = await detectExtensionFromBuffer(buffer);
  safeFileName += detectedExtension || FALLBACK_MEDIA_EXTENSIONS[msgType] || '.dat';

  return safeFileName;
}

/**
 * WxWorkAdapter - 将企业微信长连接协议适配为通用 Channel 接口
 */
class WxWorkAdapter extends EventEmitter {
  constructor(config, storageConfig) {
    super();
    this.streamingResponse = config.streamingResponse !== false;
    this.bot = new WeComAIBot({
      botId: config.botId,
      secret: config.secret,
      debug: config.debug
    });
    this.tempDir = storageConfig.tempDir;
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    this.setupHandlers();
  }

  async start() {
    this.bot.connect();
  }

  stop() {
    this.bot.disconnect();
  }

  setupHandlers() {
    this.bot.on('message', async (body, reqId) => {
      const userId = body.from.userid;
      let text = '';
      let attachments = [];
      let streamId;
      let initialStatusSent = false;

      if (body.msgtype === 'text') {
        text = body.text.content;
      } else if (['image', 'file', 'video'].includes(body.msgtype)) {
        const mediaObj = body[body.msgtype];
        if (mediaObj.url && mediaObj.aeskey) {
          try {
            if (this.streamingResponse) {
              streamId = `sid_${Date.now()}`;
              const mediaLabel = body.msgtype === 'file'
                ? '文件'
                : (body.msgtype === 'image' ? '图片' : '视频');
              this.bot.respondStreamMsg(reqId, `已收到${mediaLabel}，正在下载并处理...`, streamId, false);
              initialStatusSent = true;
            }

            const originalName = mediaObj.name || mediaObj.title || mediaObj.filename || `file_${Date.now()}`;
            const encryptedBuffer = await this.bot.downloadMedia(mediaObj.url);
            const decryptedBuffer = this.bot.decryptMedia(encryptedBuffer, mediaObj.aeskey);
            
            const safeFileName = await buildStoredFileName(body.msgtype, originalName, decryptedBuffer);
            const filePath = path.join(this.tempDir, safeFileName);
            fs.writeFileSync(filePath, decryptedBuffer);
            
            attachments.push({
              path: path.relative(process.cwd(), filePath),
              name: originalName
            });
            
            text = `[Sent a file: ${originalName}]`;
          } catch (err) {
            console.error('[WxWorkAdapter] Media process error:', err);
          }
        }
      }

      this.emit('message', {
        userId,
        text,
        attachments,
        context: {
          reqId,
          ...(streamId ? { streamId } : {}),
          ...(initialStatusSent ? { initialStatusSent: true } : {}),
        }
      });
    });

    this.bot.on('event', (body, reqId) => {
      if (body.event.eventtype === 'enter_chat') {
        this.emit('user_enter', {
          userId: body.event.userid,
          context: { reqId }
        });
      }
    });

    this.bot.on('server_error', (msg) => {
      console.error('[WxWorkAdapter] Server error:', JSON.stringify(msg, null, 2));
    });
  }

  async reply(userId, content, context) {
    if (!this.streamingResponse) {
      this.bot.respondMarkdownMsg(context.reqId, content);
      return;
    }

    const streamId = `sid_${Date.now()}`;
    this.bot.respondStreamMsg(context.reqId, content, streamId, true);
  }

  createStreamingReply(userId, context) {
    if (!this.streamingResponse) {
      return null;
    }

    const streamId = context.streamId || `sid_${Date.now()}`;

    return {
      updateStatus: async status => {
        this.bot.respondStreamMsg(context.reqId, status, streamId, false);
      },
      updateDraft: async draft => {
        this.bot.respondStreamMsg(context.reqId, draft, streamId, false);
      },
      finish: async content => {
        this.bot.respondStreamMsg(context.reqId, content, streamId, true);
      },
    };
  }

  async sendWelcome(userId, content, context) {
    this.bot.respondWelcomeMsg(context.reqId, content);
  }
}

module.exports = WxWorkAdapter;
