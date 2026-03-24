const EventEmitter = require('events');
const WeComAIBot = require('./src/wecom-bot');
const fs = require('fs');
const path = require('path');
const { getPdfInfo } = require('../../markitdown/pdf-info');

const FALLBACK_MEDIA_EXTENSIONS = {
  image: '.jpg',
  file: '.dat',
  video: '.mp4',
};

const MIME_BY_EXTENSION = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
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

function inferMimeType(extension, msgType) {
  if (MIME_BY_EXTENSION[extension]) {
    return MIME_BY_EXTENSION[extension];
  }

  if (msgType === 'image') {
    return 'image/*';
  }

  if (msgType === 'video') {
    return 'video/*';
  }

  return 'application/octet-stream';
}

function inferAttachmentKind(msgType, extension, mimeType) {
  if (msgType === 'image' || mimeType.startsWith('image/')) {
    return 'image';
  }

  if (msgType === 'video' || mimeType.startsWith('video/')) {
    return 'video';
  }

  if (extension === '.pdf') {
    return 'pdf';
  }

  if (['.doc', '.docx'].includes(extension)) {
    return 'document';
  }

  if (['.xls', '.xlsx', '.csv', '.tsv'].includes(extension)) {
    return 'spreadsheet';
  }

  if (['.ppt', '.pptx'].includes(extension)) {
    return 'presentation';
  }

  if (['.txt', '.md', '.json', '.xml'].includes(extension) || mimeType.startsWith('text/')) {
    return 'text';
  }

  return msgType === 'file' ? 'file' : msgType;
}

function resolveChatTarget(userId, context = {}) {
  if (context.chatType === 2 && context.chatId) {
    return {
      chatId: context.chatId,
      chatType: 2,
    };
  }

  return {
    chatId: context.chatId || userId,
    chatType: context.chatType || 1,
  };
}

function isLikelyFileTooLargeMessage(message = '') {
  return /too large|文件太大|超出.{0,12}(大小|限制)|超过.{0,12}(限制|大小)|40058|40009|40006|size limit|total_size|invalid file size/i.test(message);
}

function toFileUri(filePath = '') {
  const normalizedPath = String(filePath || '').replace(/\\/g, '/');
  return `file:///${encodeURI(normalizedPath)}`;
}

function formatAbsolutePathLink(fileName, resolvedPath) {
  const label = fileName || '点击打开文件';
  return `${label}： [点击打开文件](${toFileUri(resolvedPath)})\n绝对路径：\`${resolvedPath}\``;
}

function buildAttachmentSendError(fileName, resolvedPath, cause) {
  const causeMessage = String(cause?.message || '').trim();
  let userMessage = `文件暂时无法直接发送。请直接打开：${formatAbsolutePathLink(fileName, resolvedPath)}`;

  if (isLikelyFileTooLargeMessage(causeMessage)) {
    userMessage = `文件太大，当前无法直接发送。请直接打开：${formatAbsolutePathLink(fileName, resolvedPath)}`;
  } else if (causeMessage) {
    userMessage = `文件暂时无法直接发送。请直接打开：${formatAbsolutePathLink(fileName, resolvedPath)}`;
  }

  const error = new Error(`Failed to send attachment: ${fileName}. ${causeMessage || 'Unknown error'}`);
  error.code = 'ATTACHMENT_SEND_FAILED';
  error.cause = cause;
  error.fileName = fileName;
  error.absolutePath = resolvedPath;
  error.userMessage = userMessage;
  return error;
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
            const extension = path.extname(filePath).toLowerCase();
            const mimeType = inferMimeType(extension, body.msgtype);

            const attachment = {
              path: path.relative(process.cwd(), filePath),
              storedPath: path.relative(process.cwd(), filePath),
              name: originalName,
              extension,
              mimeType,
              kind: inferAttachmentKind(body.msgtype, extension, mimeType),
              sizeBytes: decryptedBuffer.length,
            };

            if (extension === '.pdf') {
              try {
                const pdfInfo = await getPdfInfo(filePath, {
                  rootDir: path.resolve(__dirname, '..', '..'),
                });
                if (Number.isFinite(pdfInfo.pageCount) && pdfInfo.pageCount > 0) {
                  attachment.pageCount = pdfInfo.pageCount;
                  attachment.pageRangeSupported = true;
                }
              } catch {}
            }

            attachments.push(attachment);

            text = Number.isFinite(attachment.pageCount)
              ? `[Sent a file: ${originalName}, pages=${attachment.pageCount}]`
              : `[Sent a file: ${originalName}]`;
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
          chatId: body.chattype === 'group' ? body.chatid : userId,
          chatType: body.chattype === 'group' ? 2 : 1,
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

  async sendText(userId, content, context = {}) {
    const target = resolveChatTarget(userId, context);
    this.bot.sendMsg(target.chatId, target.chatType, 'markdown', {
      markdown: {
        content,
      },
    });
  }

  async sendAttachments(userId, attachments = [], context = {}) {
    const target = resolveChatTarget(userId, context);

    for (const attachment of attachments) {
      const attachmentPath = attachment?.path;

      if (typeof attachmentPath !== 'string' || attachmentPath.trim().length === 0) {
        throw new Error('Attachment path is required.');
      }

      const resolvedPath = path.isAbsolute(attachmentPath)
        ? attachmentPath
        : path.resolve(process.cwd(), attachmentPath);
      const fileName = attachment?.name || path.basename(resolvedPath);
      
      try {
        const buffer = fs.readFileSync(resolvedPath);
        const mediaId = await this.bot.uploadMedia('file', fileName, buffer);
        const sent = this.bot.sendMsg(target.chatId, target.chatType, 'file', {
          file: {
            media_id: mediaId,
          },
        });

        if (!sent) {
          throw new Error('通道返回发送失败');
        }
      } catch (error) {
        throw buildAttachmentSendError(fileName, resolvedPath, error);
      }
    }
  }
}

module.exports = WxWorkAdapter;
