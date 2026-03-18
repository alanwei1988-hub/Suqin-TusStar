const WeComAIBot = require('./wecom-bot');
const fs = require('fs');
const path = require('path');

class MockAgent {
  constructor() {
    this.config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
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

  handleOtherMessage(body, reqId) {
    const streamId = `sid_${Date.now()}`;
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
