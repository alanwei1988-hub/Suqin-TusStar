const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const SessionManager = require('../agent/session');
const { makeTempDir } = require('./helpers/test-helpers');

module.exports = async function runAgentSessionTest() {
  const rootDir = makeTempDir('agent-session-');
  const dbPath = path.join(rootDir, 'sessions.db');

  try {
    const sessionManager = new SessionManager(dbPath);
    sessionManager.saveMessages('u1', [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ]);
    sessionManager.close();

    const inspectDb = new Database(dbPath, { readonly: true });
    const savedRow = inspectDb.prepare('SELECT messages FROM sessions WHERE userId = ?').get('u1');
    inspectDb.close();

    assert.match(savedRow.messages, /\n/);
    assert.match(savedRow.messages, /  "role": "user"/);

    const legacyDb = new Database(dbPath);
    legacyDb.prepare('UPDATE sessions SET messages = ? WHERE userId = ?').run(
      JSON.stringify([{ role: 'user', content: 'legacy' }]),
      'u1',
    );
    legacyDb.close();

    const migratedSessionManager = new SessionManager(dbPath);
    assert.deepEqual(migratedSessionManager.getMessages('u1'), [
      { role: 'user', content: 'legacy' },
    ]);
    migratedSessionManager.close();

    const migratedInspectDb = new Database(dbPath, { readonly: true });
    const migratedRow = migratedInspectDb.prepare('SELECT messages FROM sessions WHERE userId = ?').get('u1');
    migratedInspectDb.close();

    assert.match(migratedRow.messages, /\n/);
    assert.match(migratedRow.messages, /  "content": "legacy"/);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
