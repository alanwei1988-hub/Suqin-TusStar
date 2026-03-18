const WeComAIBot = require('./wecom-bot');
const fs = require('fs');
const path = require('path');

class MockAgent {
  constructor() {
    this.config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
    this.mediaDir = path.join(__dirname, '../media');
    if (!fs.existsSync(this.mediaDir)) {
      fs.mkdirSync(this.mediaDir, { recursive: true });
    }
    this.bot = new WeComAIBot({
      botId: process.env.BOT_ID,
      secret: process.env.SECRET,
      debug: this.config.debug
    });

    this.setupHandlers();
  }

  setupHandlers() {
    this.bot.on('message', (body, reqId) => {
      console.log(`[MockAgent] Received message from ${body.from.userid}:`, body.msgtype);
      if (body.msgtype === 'text') {
        this.handleTextMessage(body, reqId);
      } else {
        this.handleOtherMessage(body, reqId);
      }
    });

    this.bot.on('event', (body, reqId) => {
      console.log(`[MockAgent] Received event: ${body.event.eventtype}`);
      if (body.event.eventtype === 'enter_chat') {
        this.handleEnterChat(body, reqId);
      } else if (body.event.eventtype === 'template_card_event') {
        this.handleTemplateCardEvent(body, reqId);
      }
    });

    this.bot.on('server_error', (msg) => {
      console.error('[MockAgent] Server Error:', JSON.stringify(msg, null, 2));
    });
  }

  async handleTextMessage(body, reqId) {
    const text = body.text.content.trim();
    const streamId = `sid_${Date.now()}`;

    // 1. Streaming Test
    if (this.config.features.streaming_response && (text.includes('流式') || text.toLowerCase().includes('stream'))) {
      const chunks = ["你好！", "我是基于 OpenClaw 标准实现的 AI 助手。", "正在为你流式生成内容...", "生成完毕！"];
      let currentContent = "";
      for (let i = 0; i < chunks.length; i++) {
        currentContent += chunks[i];
        this.bot.respondStreamMsg(reqId, currentContent, streamId, i === chunks.length - 1);
        await new Promise(r => setTimeout(r, 800));
      }
      return;
    }

    // 2. Card Test
    if (this.config.features.template_card && (text.includes('卡片') || text.includes('card'))) {
      this.bot.respondCardMsg(reqId, {
        card_type: "button_interaction",
        main_title: { title: "OpenClaw 标准卡片", desc: "点击下方测试交互" },
        button_list: [
          { text: "同意", style: 1, key: "btn_ok" },
          { text: "拒绝", style: 2, key: "btn_no" }
        ]
      }, streamId, true);
      return;
    }

    // 3. Active Push Test
    if (this.config.features.active_push && text.includes('推送')) {
      this.bot.respondStreamMsg(reqId, "好的，5秒后推送消息。", streamId, true);
      setTimeout(() => {
        this.bot.sendMsg(body.from.userid, 1, 'markdown', {
          markdown: { content: `### 主动推送测试\n这是一条符合 OpenClaw 规范的**主动推送**消息。` }
        });
      }, 5000);
      return;
    }

    // Default Echo
    this.bot.respondStreamMsg(reqId, `你刚才说: ${text}`, streamId, true);
  }

  handleEnterChat(body, reqId) {
    if (this.config.features.welcome_msg) {
      this.bot.respondWelcomeMsg(reqId, "欢迎使用基于 OpenClaw 标准的企业微信机器人！");
    }
  }

  handleTemplateCardEvent(body, reqId) {
    const event = body.event;
    console.log(`[MockAgent] Interaction key: ${event.event_key}`);
    this.bot.respondUpdateMsg(reqId, {
      card_type: "button_interaction",
      main_title: { title: "卡片已更新", desc: `你选择了: ${event.event_key}` },
      button_list: []
    });
  }

  async handleOtherMessage(body, reqId) {
    const streamId = `sid_${Date.now()}`;
    const msgType = body.msgtype;
    const mediaObj = body[msgType];

    // 1. Special Handling for Voice (Text only in Long Connection mode)
    if (msgType === 'voice' && mediaObj && mediaObj.content) {
      this.bot.respondStreamMsg(reqId, `收到了你的语音，转写内容为：\n> "${mediaObj.content}"\n\n*(注：企微长连接模式下，语音会自动转文字，不提供原始音频下载)*`, streamId, true);
      return;
    }

    // 2. Handling for Media with Files (Image, File, Video)
    if (['image', 'file', 'video'].includes(msgType) && mediaObj && mediaObj.url && mediaObj.aeskey) {
      // Try to get original filename from various possible fields
      const originalName = mediaObj.name || mediaObj.title || mediaObj.filename;
      const fileName = originalName || `received_${msgType}_${Date.now()}`;
      
      const typeMap = { image: '图片', file: '文件', video: '视频' };
      const typeLabel = typeMap[msgType] || msgType;

      // Size limits based on WeCom API (Approximate)
      const sizeLimit = msgType === 'video' || msgType === 'file' ? 29 * 1024 * 1024 : 2 * 1024 * 1024;
      
      // We don't have the size in the header always, but we'll check it after download or if provided
      // If we want to be proactive, we can wait for download to check buffer length.
      
      // 1. Acknowledge receipt
      let ackText = `收到了你的${typeLabel}`;
      if (mediaObj.name) ackText += `: ${mediaObj.name}`;
      this.bot.respondStreamMsg(reqId, ackText + "，正在下载处理...", streamId, false);

      try {
        // 2. Download encrypted data
        const encryptedBuffer = await this.bot.downloadMedia(mediaObj.url);
        
        // 3. Decrypt
        const decryptedBuffer = this.bot.decryptMedia(encryptedBuffer, mediaObj.aeskey);

        // Save to media directory
        let safeFileName = `${Date.now()}_${fileName.replace(/[\\/:"*?<>|]/g, '_')}`;
        
        // Add extension if missing
        if (!path.extname(safeFileName)) {
          const extMap = { image: '.jpg', video: '.mp4', voice: '.amr' };
          safeFileName += extMap[msgType] || '';
        }
        
        const filePath = path.join(this.mediaDir, safeFileName);
        fs.writeFileSync(filePath, decryptedBuffer);
        console.log(`[MockAgent] Saved inbound media to: ${filePath}`);

        // 4. Re-upload to get media_id
        const mediaId = await this.bot.uploadMedia(msgType, fileName, decryptedBuffer);

        // 5. Send back (as a separate message following the stream finish)
        this.bot.respondStreamMsg(reqId, ackText + "，处理完成！", streamId, true);
        
        // Wait a bit to ensure sequence
        await new Promise(r => setTimeout(r, 1000));
        
        // Using sendMsg (active push) or respondMediaMsg (if documented)
        // Since we have reqId, respondMediaMsg is better
        this.bot.respondMediaMsg(reqId, msgType, mediaId);
      } catch (err) {
        console.error('[MockAgent] Failed to process media:', err);
        
        let userFriendlyMsg = "";
        const errMsg = err.message || "";
        
        // Map technical error codes to human-readable messages
        if (errMsg.includes('40058') || errMsg.includes('40009') || errMsg.toLowerCase().includes('too large')) {
          const limit = (msgType === 'image' ? '2MB' : '28MB');
          userFriendlyMsg = `抱歉，这个${typeLabel}太大了。企微接口对${typeLabel}的限制大约是 ${limit}，暂时无法原样发还给你。`;
        } else if (errMsg.includes('45009') || errMsg.includes('limit exceeded')) {
          userFriendlyMsg = `抱歉，机器人现在说话太快了，被系统限流了，请稍后再试。`;
        } else if (errMsg.includes('40001')) {
          userFriendlyMsg = `机器人配置好像出了点问题（凭证失效），请联系管理员。`;
        } else {
          // Only show technical details for completely unknown errors
          userFriendlyMsg = `处理${typeLabel}时出了一点小问题，请稍后重试。 (错误: ${errMsg.split(':')[0]})`;
        }

        this.bot.respondStreamMsg(reqId, userFriendlyMsg, streamId, true);
      }
      return;
    }

    this.bot.respondStreamMsg(reqId, `收到了你的 ${body.msgtype} 消息。`, streamId, true);
  }

  start() {
    this.bot.connect();
    console.log('MockAgent (OpenClaw Mode) started.');
  }

  stop() {
    this.bot.disconnect();
    console.log('MockAgent stopped.');
  }
}

module.exports = MockAgent;
