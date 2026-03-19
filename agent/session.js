const Database = require('better-sqlite3');
const path = require('path');

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
    stmt.run(userId, JSON.stringify(messages));
  }

  clearSession(userId) {
    this.db.prepare('DELETE FROM sessions WHERE userId = ?').run(userId);
  }
}

module.exports = SessionManager;
