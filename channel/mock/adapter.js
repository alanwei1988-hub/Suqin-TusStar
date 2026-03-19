const EventEmitter = require('events');

class MockChannelAdapter extends EventEmitter {
  constructor(config = {}, storageConfig = {}) {
    super();
    this.config = config;
    this.storageConfig = storageConfig;
    this.replies = [];
    this.welcomeMessages = [];
  }

  async start() {
    return undefined;
  }

  stop() {
    return undefined;
  }

  async reply(userId, content, context = {}) {
    this.replies.push({
      userId,
      content,
      context,
    });
  }

  async sendWelcome(userId, content, context = {}) {
    this.welcomeMessages.push({
      userId,
      content,
      context,
    });
  }

  async simulateMessage({ userId, text, attachments = [], context = {} }) {
    this.emit('message', {
      userId,
      text,
      attachments,
      context,
    });
  }

  async simulateUserEnter({ userId, context = {} }) {
    this.emit('user_enter', {
      userId,
      context,
    });
  }
}

module.exports = MockChannelAdapter;
