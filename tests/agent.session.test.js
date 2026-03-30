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

    const contextSessionManager = new SessionManager(path.join(rootDir, 'context.db'));
    const context = contextSessionManager.buildModelContext([
      { role: 'user', content: 'old request' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'old-1', toolName: 'inspectAttachment', input: '{}' },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'old-1', toolName: 'inspectAttachment', output: { type: 'json', value: { ok: true } } },
        ],
      },
      { role: 'assistant', content: 'old done' },
      { role: 'user', content: 'previous request' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'new-1', toolName: 'generateImage', input: '{"prompt":"green"}' },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'new-1', toolName: 'generateImage', output: { type: 'json', value: { logicalPath: 'workspace://generated-images/green.png' } } },
        ],
      },
      { role: 'assistant', content: '上一版已经生成好了。' },
      { role: 'user', content: '在这一版基础上改背景色' },
    ], {
      recentMessagesCount: 2,
      summaryLineCount: 10,
      summaryMaxChars: 240,
    });
    contextSessionManager.close();

    assert.equal(context.messages.some(message => message.role === 'assistant' && Array.isArray(message.content) && JSON.stringify(message.content).includes('"new-1"')), true);
    assert.equal(context.messages.some(message => message.role === 'tool' && JSON.stringify(message.content).includes('workspace://generated-images/green.png')), true);
    assert.equal(context.messages.some(message => JSON.stringify(message).includes('"old-1"')), false);
    assert.equal(context.messages.some(message => message.role === 'user' && message.content === '在这一版基础上改背景色'), true);
    assert.match(context.summary, /User: old request/);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
