const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MockLanguageModelV3 } = require('ai/test');
const { registerChannelHandlers } = require('../app');
const AgentCore = require('../agent');
const MockChannelAdapter = require('../channel/mock/adapter');
const { generateResult, makeTempDir, repoRoot, textPart, waitFor } = require('./helpers/test-helpers');

module.exports = async function runSchedulerEngineTest() {
  const rootDir = makeTempDir('scheduler-engine-');
  const schedulerDbPath = path.join(rootDir, 'scheduled-tasks.db');
  const model = new MockLanguageModelV3({
    doGenerate: () => generateResult([
      textPart('自动周报完成'),
    ], 'stop'),
  });

  const agent = new AgentCore({
    model: 'mock-model',
    provider: 'openai',
    openai: {
      apiKey: 'test',
      baseURL: 'http://example.invalid/v1',
    },
    workspaceDir: rootDir,
    skillsDir: path.join(repoRoot, 'skills'),
    rolePromptDir: path.join(repoRoot, 'roles', 'suqin'),
    sessionDb: path.join(rootDir, 'sessions.db'),
    mcpServers: [],
    scheduler: {
      enabled: true,
      dbPath: schedulerDbPath,
      heartbeatMs: 50,
      dueTaskLimit: 5,
      defaultTimezone: 'Asia/Shanghai',
    },
  }, { model });
  const channel = new MockChannelAdapter({}, {});

  try {
    await agent.init();
    const task = agent.schedulerStore.createTask({
      userId: 'user-1',
      chatId: 'group-1',
      chatType: 2,
      title: 'Weekly work summary',
      prompt: 'Summarize this week work and send a concise report.',
      scheduleType: 'weekly',
      weekday: 'friday',
      timeOfDay: '17:00',
      timeZone: 'Asia/Shanghai',
      referenceDate: new Date('2026-04-03T00:00:00.000Z'),
    });
    agent.schedulerStore.db.prepare('UPDATE scheduled_tasks SET nextRunAt = ? WHERE id = ?').run(
      new Date(Date.now() - 1000).toISOString(),
      task.id,
    );

    registerChannelHandlers({
      agent,
      channel,
    });

    await waitFor(() => channel.sentTexts.length > 0, { timeoutMs: 5000 });
    assert.equal(channel.sentTexts[0].userId, 'user-1');
    assert.equal(channel.sentTexts[0].context.chatId, 'group-1');
    assert.equal(channel.sentTexts[0].content, '自动周报完成');

    const updatedTask = agent.schedulerStore.getTaskById(task.id);
    assert.equal(updatedTask.lastStatus, 'succeeded');
    assert.equal(updatedTask.lastRunAt.length > 0, true);
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
