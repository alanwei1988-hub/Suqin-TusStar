const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const SchedulerStore = require('../scheduler/store');
const { makeTempDir } = require('./helpers/test-helpers');

module.exports = async function runSchedulerStoreTest() {
  const rootDir = makeTempDir('scheduler-store-');
  const dbPath = path.join(rootDir, 'scheduled-tasks.db');
  const store = new SchedulerStore(dbPath);

  try {
    const created = store.createTask({
      userId: 'user-1',
      chatId: 'chat-1',
      chatType: 2,
      title: 'Weekly contract report',
      prompt: 'Summarize this week contract activity and send a concise report.',
      scheduleType: 'weekly',
      weekday: 'friday',
      timeOfDay: '17:00',
      timeZone: 'Asia/Shanghai',
      referenceDate: new Date('2026-04-03T00:00:00.000Z'),
    });

    assert.equal(created.title, 'Weekly contract report');
    assert.equal(created.scheduleType, 'weekly');
    assert.equal(created.weekday, 'friday');
    assert.equal(created.enabled, true);
    assert.equal(typeof created.nextRunAt, 'string');
    assert.equal(created.nextRunLocal.includes('Asia/Shanghai'), true);

    const userTasks = store.listTasksForUser('user-1');
    assert.equal(userTasks.length, 1);
    assert.equal(userTasks[0].id, created.id);

    store.db.prepare('UPDATE scheduled_tasks SET nextRunAt = ? WHERE id = ?').run(
      new Date(Date.now() - 1000).toISOString(),
      created.id,
    );
    const dueTasks = store.listDueTasks(new Date(), 5);
    assert.equal(dueTasks.length, 1);
    assert.equal(dueTasks[0].id, created.id);

    store.markTaskRunning(created.id);
    const running = store.getTaskById(created.id);
    assert.equal(running.lastStatus, 'running');

    const finished = store.markTaskFinished(created.id, {
      succeeded: true,
      runAt: new Date(),
      resultPreview: 'Weekly contract report sent.',
    });
    assert.equal(finished.lastStatus, 'succeeded');
    assert.equal(finished.lastResultPreview, 'Weekly contract report sent.');
    assert.equal(finished.lastRunAt.length > 0, true);

    const cancelled = store.cancelTask(created.id, 'user-1');
    assert.equal(cancelled.enabled, false);
    assert.equal(cancelled.lastStatus, 'cancelled');
  } finally {
    store.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
