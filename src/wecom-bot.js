const WebSocket = require('ws');
const crypto = require('crypto');
const EventEmitter = require('events');
const https = require('https');

/**
 * WeComAIBot - Optimized for WeCom AI Bot Long Connection Protocol
 */
class WeComAIBot extends EventEmitter {
  constructor(config = {}) {
    super();
    this.botId = config.botId;
    this.secret = config.secret;
    this.wsUrl = config.wsUrl || 'wss://openws.work.weixin.qq.com';
    this.pingIntervalMs = config.pingInterval || 30000;
    this.reconnectIntervalMs = config.reconnectInterval || 5000;
    this.debug = config.debug || false;

    this.ws = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.isClosing = false;
    this.pendingRequests = new Map(); // Store pending waitForResponse resolvers
  }

  log(...args) {
    if (this.debug) {
      console.log('[WeComAIBot]', ...args);
    }
  }

  error(...args) {
    console.error('[WeComAIBot ERROR]', ...args);
  }

  connect() {
    this.isClosing = false;
    this.log('Connecting to', this.wsUrl);
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      this.log('WebSocket opened, sending subscribe...');
      this.subscribe();
      this.startHeartbeat();
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch (err) {
        this.error('Failed to parse message:', err);
      }
    });

    this.ws.on('close', (code, reason) => {
      this.log(`WebSocket closed: code=${code}, reason=${reason}`);
      this.stopHeartbeat();
      if (!this.isClosing) {
        this.reconnect();
      }
    });

    this.ws.on('error', (err) => {
      this.error('WebSocket error:', err);
      this.ws.terminate();
    });
  }

  reconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.log('Reconnecting...');
      this.connect();
    }, this.reconnectIntervalMs);
  }

  disconnect() {
    this.isClosing = true;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
    }
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Create a shallow copy for logging to avoid modifying the original payload
      const logPayload = JSON.parse(JSON.stringify(payload));
      if (logPayload.body && logPayload.body.base64_data) {
        const len = logPayload.body.base64_data.length;
        if (len > 100) {
          logPayload.body.base64_data = logPayload.body.base64_data.substring(0, 50) + '...' + logPayload.body.base64_data.substring(len - 50);
        }
      }
      
      const data = JSON.stringify(payload);
      this.log('Sending:', JSON.stringify(logPayload));
      this.ws.send(data);
      return true;
    }
    this.error('Cannot send, WebSocket not open');
    return false;
  }

  genReqId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({
        cmd: 'ping',
        headers: { req_id: this.genReqId() }
      });
    }, this.pingIntervalMs);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  subscribe() {
    this.send({
      cmd: 'aibot_subscribe',
      headers: { req_id: this.genReqId() },
      body: {
        bot_id: this.botId,
        secret: this.secret
      }
    });
  }

  handleMessage(msg) {
    this.log('Received:', JSON.stringify(msg));
    
    // Check if we can resolve a pending request
    const reqId = msg.headers?.req_id;
    if (reqId && this.pendingRequests.has(reqId)) {
      const resolve = this.pendingRequests.get(reqId);
      this.pendingRequests.delete(reqId);
      resolve(msg);
      return;
    }

    // Handle 'naked' errors (no headers/req_id from WeCom)
    if (msg.errcode !== undefined && msg.errcode !== 0 && !reqId) {
      this.error(`Server returned a naked error: ${msg.errmsg} (${msg.errcode})`);
      // If there's only one pending request, it's likely the cause
      if (this.pendingRequests.size === 1) {
        const [id, resolve] = this.pendingRequests.entries().next().value;
        this.pendingRequests.delete(id);
        resolve(msg);
        return;
      }
      this.emit('server_error', msg);
    }
    
    const { cmd } = msg;
    if (cmd === 'aibot_msg_callback') {
      this.emit('message', msg.body, msg.headers.req_id);
    } else if (cmd === 'aibot_event_callback') {
      this.emit('event', msg.body, msg.headers.req_id);
    } else if (cmd === 'ping') {
      this.log('Pong received');
    } else if (msg.errmsg === 'ok') {
      this.log('Operation success for', msg.headers?.req_id);
    }
  }

  /**
   * Respond to a message callback (Stream version - preferred for long connection)
   * @param {string} reqId - req_id from callback
   * @param {string} content - markdown/text content
   * @param {string} streamId - stream identification
   * @param {boolean} finish - whether it's the final chunk
   */
  respondStreamMsg(reqId, content, streamId, finish = true) {
    return this.send({
      cmd: 'aibot_respond_msg',
      headers: { req_id: reqId },
      body: {
        msgtype: 'stream',
        stream: {
          id: streamId,
          content: content,
          finish: finish
        }
      }
    });
  }

  /**
   * Respond with Template Card (using stream_with_template_card for better compatibility)
   */
  respondCardMsg(reqId, templateCard, streamId, finish = true) {
    return this.send({
      cmd: 'aibot_respond_msg',
      headers: { req_id: reqId },
      body: {
        msgtype: 'stream_with_template_card',
        stream: {
          id: streamId,
          finish: finish
        },
        template_card: templateCard
      }
    });
  }

  /**
   * Respond with Welcome message (Strictly following WelcomeReplyBody)
   */
  respondWelcomeMsg(reqId, textContent) {
    return this.send({
      cmd: 'aibot_respond_welcome_msg',
      headers: { req_id: reqId },
      body: {
        msgtype: 'text',
        text: {
          content: textContent
        }
      }
    });
  }

  /**
   * Update template card
   */
  respondUpdateMsg(reqId, templateCard) {
    return this.send({
      cmd: 'aibot_respond_update_msg',
      headers: { req_id: reqId },
      body: {
        response_type: 'update_template_card',
        template_card: templateCard
      }
    });
  }

  /**
   * Active push message (Remains same as documented)
   */
  sendMsg(chatId, chatType, msgType, content) {
    return this.send({
      cmd: 'aibot_send_msg',
      headers: { req_id: this.genReqId() },
      body: {
        chatid: chatId,
        chat_type: chatType,
        msgtype: msgType,
        ...content
      }
    });
  }

  /**
   * Upload media file in chunks
   */
  async uploadMedia(type, filename, buffer) {
    const totalSize = buffer.length;
    const chunkSize = 512 * 1024;
    const totalChunks = Math.ceil(totalSize / chunkSize);
    const md5 = crypto.createHash('md5').update(buffer).digest('hex');

    const initRes = await this.waitForResponse('aibot_upload_media_init', {
      body: { type, filename, total_size: totalSize, total_chunks: totalChunks, md5 }
    });

    if (!initRes || initRes.errcode !== 0) {
      const errorDetail = initRes ? `${initRes.errmsg} (代码: ${initRes.errcode})` : '服务器无响应';
      throw new Error(`初始化上传失败: ${errorDetail}`);
    }
    const uploadId = initRes.body.upload_id;

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, totalSize);
      const chunkRes = await this.waitForResponse('aibot_upload_media_chunk', {
        body: {
          upload_id: uploadId,
          chunk_index: String(i),
          base64_data: buffer.slice(start, end).toString('base64')
        }
      });
      if (!chunkRes || chunkRes.errcode !== 0) {
        const errorDetail = chunkRes ? `${chunkRes.errmsg} (代码: ${chunkRes.errcode})` : '服务器无响应';
        throw new Error(`分片 ${i} 上传失败: ${errorDetail}`);
      }
    }

    const finishRes = await this.waitForResponse('aibot_upload_media_finish', {
      body: { upload_id: uploadId }
    });

    if (!finishRes || finishRes.errcode !== 0) {
      const errorDetail = finishRes ? `${finishRes.errmsg} (代码: ${finishRes.errcode})` : '服务器无响应';
      throw new Error(`合并文件失败: ${errorDetail}`);
    }
    return finishRes.body.media_id;
  }

  waitForResponse(cmd, payload) {
    const reqId = this.genReqId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          resolve(null);
        }
      }, 15000);

      this.pendingRequests.set(reqId, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });

      if (!this.send({ cmd, headers: { req_id: reqId }, ...payload })) {
        clearTimeout(timer);
        this.pendingRequests.delete(reqId);
        resolve(null);
      }
    });
  }

  /**
   * Respond with Media (image, file, voice, video)
   */
  respondMediaMsg(reqId, msgType, mediaId) {
    const body = { msgtype: msgType };
    body[msgType] = { media_id: mediaId };
    return this.send({
      cmd: 'aibot_respond_msg',
      headers: { req_id: reqId },
      body: body
    });
  }

  /**
   * Download media from URL
   */
  downloadMedia(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  decryptMedia(encryptedBuffer, aesKeyBase64) {
    const aesKey = Buffer.from(aesKeyBase64, 'base64');
    const iv = aesKey.slice(0, 16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
    
    // Disable auto padding because WeCom pads to 32 bytes, which exceeds standard AES block size (16 bytes)
    decipher.setAutoPadding(false);
    
    let decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
    
    // Manual PKCS#7 unpadding for up to 32 bytes
    const paddingLen = decrypted[decrypted.length - 1];
    if (paddingLen > 0 && paddingLen <= 32) {
      // Verify padding bytes (all must be equal to paddingLen)
      let isPaddingValid = true;
      for (let i = 1; i <= paddingLen; i++) {
        if (decrypted[decrypted.length - i] !== paddingLen) {
          isPaddingValid = false;
          break;
        }
      }
      if (isPaddingValid) {
        decrypted = decrypted.slice(0, decrypted.length - paddingLen);
      }
    }
    
    return decrypted;
  }
}

module.exports = WeComAIBot;
