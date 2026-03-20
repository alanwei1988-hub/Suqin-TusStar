const EventEmitter = require('events');
const WeComAIBot = require('./src/wecom-bot');
const fs = require('fs');
const path = require('path');

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
            
            const safeFileName = `${Date.now()}_${originalName.replace(/[\\/:"*?<>|]/g, '_')}`;
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
