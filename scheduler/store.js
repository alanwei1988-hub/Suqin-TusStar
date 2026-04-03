const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const {
  DEFAULT_TIMEZONE,
  WEEKDAY_NAMES,
  computeNextRunAt,
  formatDateTimeInTimeZone,
  normalizeTimeZone,
  normalizeWeekday,
  parseTimeOfDay,
} = require('./time');

function nowIsoString() {
  return new Date().toISOString();
}

function normalizeScheduleType(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';

  if (candidate === 'daily' || candidate === 'weekly') {
    return candidate;
  }

  throw new Error(`Unsupported scheduleType: ${value}`);
}

function normalizeTaskInput(input = {}) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  const scheduleType = normalizeScheduleType(input.scheduleType);
  const timeOfDay = parseTimeOfDay(input.timeOfDay).normalized;
  const timeZone = normalizeTimeZone(input.timeZone || input.timezone || DEFAULT_TIMEZONE);
  const weekday = normalizeWeekday(input.weekday);

  if (!title) {
    throw new Error('Task title is required.');
  }

  if (!prompt) {
    throw new Error('Task prompt is required.');
  }

  if (!input.userId) {
    throw new Error('Task userId is required.');
  }

  if (!input.chatId) {
    throw new Error('Task chatId is required.');
  }

  if (scheduleType === 'weekly' && !weekday) {
    throw new Error(`Weekly schedules require weekday to be one of: ${WEEKDAY_NAMES.join(', ')}`);
  }

  return {
    id: typeof input.id === 'string' && input.id.trim().length > 0 ? input.id.trim() : crypto.randomUUID(),
    userId: String(input.userId),
    chatId: String(input.chatId),
    chatType: Number.isFinite(input.chatType) ? Math.max(1, Math.trunc(input.chatType)) : 1,
    title,
    prompt,
    scheduleType,
    weekday: scheduleType === 'weekly' ? weekday : '',
    timeOfDay,
    timeZone,
    enabled: input.enabled !== false,
    referenceDate: input.referenceDate instanceof Date ? input.referenceDate : new Date(),
  };
}

function normalizeTaskRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.userId,
    chatId: row.chatId,
    chatType: row.chatType,
    title: row.title,
    prompt: row.prompt,
    scheduleType: row.scheduleType,
    weekday: row.weekday || '',
    timeOfDay: row.timeOfDay,
    timeZone: normalizeTimeZone(row.timeZone),
    enabled: Number(row.enabled) === 1,
    nextRunAt: row.nextRunAt || '',
    nextRunLocal: row.nextRunAt
      ? formatDateTimeInTimeZone(new Date(row.nextRunAt), row.timeZone || DEFAULT_TIMEZONE)
      : '',
    lastRunAt: row.lastRunAt || '',
    lastRunLocal: row.lastRunAt
      ? formatDateTimeInTimeZone(new Date(row.lastRunAt), row.timeZone || DEFAULT_TIMEZONE)
      : '',
    lastStatus: row.lastStatus || '',
    lastError: row.lastError || '',
    lastResultPreview: row.lastResultPreview || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  };
}

class SchedulerStore {
  constructor(dbPath = path.join(__dirname, '..', 'data', 'scheduled-tasks.db')) {
    this.dbPath = path.resolve(dbPath);
    this.db = new Database(this.dbPath);
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        chatId TEXT NOT NULL,
        chatType INTEGER NOT NULL DEFAULT 1,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        scheduleType TEXT NOT NULL,
        weekday TEXT NOT NULL DEFAULT '',
        timeOfDay TEXT NOT NULL,
        timeZone TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        nextRunAt TEXT NOT NULL,
        lastRunAt TEXT DEFAULT '',
        lastStatus TEXT DEFAULT '',
        lastError TEXT DEFAULT '',
        lastResultPreview TEXT DEFAULT '',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_userId ON scheduled_tasks (userId, enabled, nextRunAt);
      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_due ON scheduled_tasks (enabled, nextRunAt);
    `);
  }

  createTask(input = {}) {
    const normalized = normalizeTaskInput(input);
    const createdAt = nowIsoString();
    const nextRunAt = computeNextRunAt(normalized, normalized.referenceDate).toISOString();
    const insert = this.db.prepare(`
      INSERT INTO scheduled_tasks (
        id, userId, chatId, chatType, title, prompt, scheduleType, weekday, timeOfDay, timeZone,
        enabled, nextRunAt, lastRunAt, lastStatus, lastError, lastResultPreview, createdAt, updatedAt
      )
      VALUES (
        @id, @userId, @chatId, @chatType, @title, @prompt, @scheduleType, @weekday, @timeOfDay, @timeZone,
        @enabled, @nextRunAt, '', 'scheduled', '', '', @createdAt, @updatedAt
      )
    `);

    insert.run({
      ...normalized,
      enabled: normalized.enabled ? 1 : 0,
      nextRunAt,
      createdAt,
      updatedAt: createdAt,
    });

    return this.getTaskById(normalized.id);
  }

  getTaskById(taskId) {
    const row = this.db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId);
    return normalizeTaskRow(row);
  }

  listTasksForUser(userId, { includeDisabled = true } = {}) {
    const rows = includeDisabled
      ? this.db.prepare(`
        SELECT * FROM scheduled_tasks
        WHERE userId = ?
        ORDER BY enabled DESC, nextRunAt ASC, createdAt DESC
      `).all(userId)
      : this.db.prepare(`
        SELECT * FROM scheduled_tasks
        WHERE userId = ? AND enabled = 1
        ORDER BY nextRunAt ASC, createdAt DESC
      `).all(userId);

    return rows.map(normalizeTaskRow);
  }

  cancelTask(taskId, userId) {
    const updatedAt = nowIsoString();
    const result = this.db.prepare(`
      UPDATE scheduled_tasks
      SET enabled = 0,
          lastStatus = 'cancelled',
          updatedAt = ?
      WHERE id = ? AND userId = ?
    `).run(updatedAt, taskId, userId);

    if (result.changes === 0) {
      return null;
    }

    return this.getTaskById(taskId);
  }

  listDueTasks(now = new Date(), limit = 20) {
    const rows = this.db.prepare(`
      SELECT * FROM scheduled_tasks
      WHERE enabled = 1 AND nextRunAt <= ?
      ORDER BY nextRunAt ASC
      LIMIT ?
    `).all(now.toISOString(), Math.max(1, Math.trunc(limit)));

    return rows.map(normalizeTaskRow);
  }

  markTaskRunning(taskId) {
    this.db.prepare(`
      UPDATE scheduled_tasks
      SET lastStatus = 'running',
          lastError = '',
          updatedAt = ?
      WHERE id = ?
    `).run(nowIsoString(), taskId);

    return this.getTaskById(taskId);
  }

  markTaskFinished(taskId, { succeeded, runAt = new Date(), resultPreview = '', errorMessage = '' } = {}) {
    const currentTask = this.getTaskById(taskId);

    if (!currentTask) {
      return null;
    }

    const nextRunAt = computeNextRunAt(currentTask, new Date(runAt.getTime() + 60 * 1000)).toISOString();
    const updatedAt = nowIsoString();
    this.db.prepare(`
      UPDATE scheduled_tasks
      SET nextRunAt = ?,
          lastRunAt = ?,
          lastStatus = ?,
          lastError = ?,
          lastResultPreview = ?,
          updatedAt = ?
      WHERE id = ?
    `).run(
      nextRunAt,
      runAt.toISOString(),
      succeeded ? 'succeeded' : 'failed',
      succeeded ? '' : String(errorMessage || '').slice(0, 400),
      String(resultPreview || '').slice(0, 400),
      updatedAt,
      taskId,
    );

    return this.getTaskById(taskId);
  }

  close() {
    this.db.close();
  }
}

module.exports = SchedulerStore;
module.exports.normalizeTaskRow = normalizeTaskRow;
