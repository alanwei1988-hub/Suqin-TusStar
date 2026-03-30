const Database = require('better-sqlite3');
const path = require('path');

function serializeMessages(messages) {
  return JSON.stringify(messages, null, 2);
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateText(value, maxLength = 240) {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function extractTextFromContentPart(part) {
  if (!part) {
    return '';
  }

  if (typeof part === 'string') {
    return part;
  }

  if (part.type === 'text' && typeof part.text === 'string') {
    return part.text;
  }

  return '';
}

function extractMessageText(message, options = {}) {
  const summaryMaxChars = options.summaryMaxChars || 240;

  if (!message) {
    return '';
  }

  if (typeof message.content === 'string') {
    return normalizeWhitespace(message.content);
  }

  if (!Array.isArray(message.content)) {
    return '';
  }

  const text = message.content
    .map(extractTextFromContentPart)
    .filter(Boolean)
    .join(' ');

  return truncateText(normalizeWhitespace(text), summaryMaxChars);
}

function summarizeMessage(message, options = {}) {
  const text = extractMessageText(message, options);

  if (!text) {
    return null;
  }

  if (message.role === 'user') {
    return `User: ${text}`;
  }

  if (message.role === 'assistant') {
    return `Assistant: ${text}`;
  }

  return null;
}

function sanitizeMessageForModel(message, options = {}) {
  if (!message || message.role === 'tool') {
    return null;
  }

  if (message.role !== 'user' && message.role !== 'assistant') {
    return null;
  }

  const text = extractMessageText(message, options);

  if (!text) {
    return null;
  }

  return {
    role: message.role,
    content: text,
  };
}

function hasToolCallPart(message) {
  return Array.isArray(message?.content)
    && message.content.some(part => part?.type === 'tool-call');
}

function hasToolResultPart(message) {
  return message?.role === 'tool'
    && Array.isArray(message?.content)
    && message.content.some(part => part?.type === 'tool-result');
}

function findLatestTurnToolContextIndexes(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  let effectiveEnd = messages.length - 1;

  if (messages[effectiveEnd]?.role === 'user') {
    effectiveEnd -= 1;
  }

  if (effectiveEnd < 0) {
    return [];
  }

  let turnStart = -1;

  for (let index = effectiveEnd; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      turnStart = index;
      break;
    }
  }

  if (turnStart < 0) {
    return [];
  }

  let toolResultIndex = -1;

  for (let index = effectiveEnd; index > turnStart; index -= 1) {
    if (hasToolResultPart(messages[index])) {
      toolResultIndex = index;
      break;
    }
  }

  const toolCallSearchEnd = toolResultIndex >= 0 ? toolResultIndex - 1 : effectiveEnd;
  let toolCallIndex = -1;

  for (let index = toolCallSearchEnd; index > turnStart; index -= 1) {
    if (hasToolCallPart(messages[index])) {
      toolCallIndex = index;
      break;
    }
  }

  return [toolCallIndex, toolResultIndex].filter(index => index >= 0);
}

function sanitizeMessagesForModel(messages, options = {}) {
  if (!Array.isArray(messages)) {
    return [];
  }

  const recentMessagesCount = options.recentMessagesCount || 12;
  const toolContextIndexes = new Set(findLatestTurnToolContextIndexes(messages));
  const sanitizedByIndex = new Map();
  const conversationalIndexes = [];

  for (let index = 0; index < messages.length; index += 1) {
    const sanitized = sanitizeMessageForModel(messages[index], options);

    if (!sanitized) {
      continue;
    }

    sanitizedByIndex.set(index, sanitized);
    conversationalIndexes.push(index);
  }

  const recentConversationIndexes = conversationalIndexes.slice(-Math.max(1, recentMessagesCount));
  const retainedIndexes = new Set([...recentConversationIndexes, ...toolContextIndexes]);

  return messages.flatMap((message, index) => {
    if (!retainedIndexes.has(index)) {
      return [];
    }

    if (toolContextIndexes.has(index)) {
      return [message];
    }

    const sanitized = sanitizedByIndex.get(index);
    return sanitized ? [sanitized] : [];
  });
}

class SessionManager {
  constructor(dbPath = path.join(__dirname, '../data/sessions.db')) {
    this.db = new Database(dbPath);
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        userId TEXT PRIMARY KEY,
        messages TEXT,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.reformatStoredMessages();
  }

  reformatStoredMessages() {
    const rows = this.db.prepare('SELECT userId, messages FROM sessions').all();
    const updateStmt = this.db.prepare(`
      UPDATE sessions
      SET messages = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE userId = ?
    `);

    for (const row of rows) {
      if (!row?.messages) {
        continue;
      }

      try {
        const formatted = serializeMessages(JSON.parse(row.messages));

        if (formatted !== row.messages) {
          updateStmt.run(formatted, row.userId);
        }
      } catch (error) {
        // Keep unreadable rows untouched so a bad record does not block startup.
      }
    }
  }

  getMessages(userId) {
    const row = this.db.prepare('SELECT messages FROM sessions WHERE userId = ?').get(userId);
    if (row) {
      return JSON.parse(row.messages);
    }
    return [];
  }

  saveMessages(userId, messages) {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (userId, messages, updatedAt)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(userId) DO UPDATE SET
        messages = excluded.messages,
        updatedAt = excluded.updatedAt
    `);
    stmt.run(userId, serializeMessages(messages));
  }

  clearSession(userId) {
    this.db.prepare('DELETE FROM sessions WHERE userId = ?').run(userId);
  }

  close() {
    this.db.close();
  }

  buildModelContext(messages, options = {}) {
    const recentMessagesCount = options.recentMessagesCount || 12;
    const summaryLineCount = options.summaryLineCount || 10;
    const cleanMessages = sanitizeMessagesForModel(messages, options);
    const conversationalMessages = messages
      .map(message => sanitizeMessageForModel(message, options))
      .filter(Boolean);

    if (conversationalMessages.length <= recentMessagesCount) {
      return {
        messages: [...cleanMessages],
        summary: '',
      };
    }

    const splitIndex = Math.max(0, conversationalMessages.length - recentMessagesCount);
    const olderMessages = conversationalMessages.slice(0, splitIndex);
    const recentMessages = cleanMessages;
    const summaryLines = [];

    for (let index = olderMessages.length - 1; index >= 0; index -= 1) {
      if (summaryLines.length >= summaryLineCount) {
        break;
      }

      const message = olderMessages[index];

      const summaryLine = summarizeMessage(message, options);
      if (!summaryLine) {
        continue;
      }

      if (summaryLines[summaryLines.length - 1] === summaryLine) {
        continue;
      }

      summaryLines.push(summaryLine);
    }

    summaryLines.reverse();

    return {
      messages: recentMessages,
      summary: summaryLines.length > 0
        ? [
          'Earlier conversation summary:',
          ...summaryLines,
        ].join('\n')
        : '',
    };
  }
}

module.exports = SessionManager;
