const { formatDateTimeInTimeZone } = require('./time');

const DEFAULT_HEARTBEAT_MS = 10 * 60 * 1000;

function truncateText(value, maxLength = 240) {
  const normalized = String(value || '').trim();

  if (!normalized) {
    return '';
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength)}...`;
}

function buildScheduledTaskPrompt(task, now = new Date()) {
  return [
    '[Scheduled Task]',
    'This request was triggered automatically by a saved recurring task.',
    'Run it now and deliver the result directly to the current chat. Do not ask the user to confirm.',
    `Task title: ${task.title}`,
    `Schedule: ${task.scheduleType}${task.weekday ? ` ${task.weekday}` : ''} at ${task.timeOfDay} (${task.timeZone})`,
    `Execution time: ${formatDateTimeInTimeZone(now, task.timeZone)}`,
    'Task instructions:',
    task.prompt,
  ].join('\n');
}

class SchedulerEngine {
  constructor({
    store,
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
    onExecuteTask,
    logger = console,
    now = () => new Date(),
    dueTaskLimit = 10,
  } = {}) {
    if (!store) {
      throw new Error('SchedulerEngine requires a store.');
    }

    if (typeof onExecuteTask !== 'function') {
      throw new Error('SchedulerEngine requires onExecuteTask.');
    }

    this.store = store;
    this.heartbeatMs = Number.isFinite(heartbeatMs) ? Math.max(1, Math.trunc(heartbeatMs)) : DEFAULT_HEARTBEAT_MS;
    this.onExecuteTask = onExecuteTask;
    this.logger = logger;
    this.now = now;
    this.dueTaskLimit = Number.isFinite(dueTaskLimit) ? Math.max(1, Math.trunc(dueTaskLimit)) : 10;
    this.timer = null;
    this.running = false;
    this.activeTaskIds = new Set();
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.scheduleNextTick(0);
  }

  stop() {
    this.running = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  scheduleNextTick(delayMs = this.heartbeatMs) {
    if (!this.running) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, Math.max(0, delayMs));

    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  async tick() {
    if (!this.running) {
      return;
    }

    try {
      const dueTasks = this.store.listDueTasks(this.now(), this.dueTaskLimit);

      for (const task of dueTasks) {
        if (this.activeTaskIds.has(task.id)) {
          continue;
        }

        this.activeTaskIds.add(task.id);
        await this.executeTask(task);
        this.activeTaskIds.delete(task.id);
      }
    } catch (error) {
      this.logger.error?.('[Scheduler] Tick failed:', error);
    } finally {
      this.scheduleNextTick(this.heartbeatMs);
    }
  }

  async executeTask(task) {
    const runAt = this.now();
    this.store.markTaskRunning(task.id);

    try {
      const result = await this.onExecuteTask({
        task,
        prompt: buildScheduledTaskPrompt(task, runAt),
        runAt,
      });
      const resultPreview = truncateText(result?.text || result?.message || '');
      this.store.markTaskFinished(task.id, {
        succeeded: true,
        runAt,
        resultPreview,
      });
    } catch (error) {
      this.logger.error?.(`[Scheduler] Task failed: ${task.id}`, error);
      this.store.markTaskFinished(task.id, {
        succeeded: false,
        runAt,
        errorMessage: error?.message || String(error || ''),
        resultPreview: '',
      });
    }
  }
}

module.exports = SchedulerEngine;
module.exports.DEFAULT_HEARTBEAT_MS = DEFAULT_HEARTBEAT_MS;
module.exports.buildScheduledTaskPrompt = buildScheduledTaskPrompt;
