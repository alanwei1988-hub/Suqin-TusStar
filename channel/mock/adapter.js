const EventEmitter = require('events');

class MockChannelAdapter extends EventEmitter {
  constructor(config = {}, storageConfig = {}) {
    super();
    this.config = config;
    this.storageConfig = storageConfig;
    this.replies = [];
    this.streamReplies = [];
    this.sentAttachments = [];
    this.sentTexts = [];
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

  createStreamingReply(userId, context = {}) {
    const stream = {
      userId,
      context,
      updates: [],
      finalContent: '',
    };
    this.streamReplies.push(stream);

    return {
      updateStatus: async content => {
        stream.updates.push({ content, finish: false, kind: 'status' });
      },
      updateDraft: async content => {
        stream.updates.push({ content, finish: false, kind: 'draft' });
      },
      finish: async content => {
        stream.finalContent = content;
        stream.updates.push({ content, finish: true, kind: 'final' });
        this.replies.push({
          userId,
          content,
          context,
          streamed: true,
        });
      },
    };
  }

  async sendWelcome(userId, content, context = {}) {
    this.welcomeMessages.push({
      userId,
      content,
      context,
    });
  }

  async sendAttachments(userId, attachments = [], context = {}) {
    this.sentAttachments.push({
      userId,
      attachments,
      context,
    });
  }

  async sendText(userId, content, context = {}) {
    this.sentTexts.push({
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
