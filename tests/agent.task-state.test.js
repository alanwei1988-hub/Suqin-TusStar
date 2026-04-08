const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MockLanguageModelV3 } = require('ai/test');
const AgentCore = require('../agent');
const { generateResult, makeTempDir, repoRoot, textPart, toolCall } = require('./helpers/test-helpers');

function getTaskStatePath(rootDir, userId) {
  return path.join(rootDir, 'storage', 'users', encodeURIComponent(userId), 'data', 'task-state.json');
}

module.exports = async function runAgentTaskStateTest() {
  await testTaskStatePromptInjection();
  await testArtifactRecordingForActiveTask();
};

async function testTaskStatePromptInjection() {
  const rootDir = makeTempDir('agent-task-state-');
  let callIndex = 0;

  const model = new MockLanguageModelV3({
    doGenerate: ({ prompt }) => {
      callIndex += 1;

      if (callIndex === 1) {
        return generateResult([
          toolCall('task-1', 'updateTaskState', {
            reason: 'The user is starting an ongoing proposal task that will span multiple turns.',
            taskPatch: {
              title: '复兴岛数字化方案',
              objective: '为复兴岛整理一版可继续扩写的数字化建设方案。',
              summary: '已进入方案搭建阶段。',
              latestUserRequest: '先起一版框架',
              nextStep: '补充三个重点模块和交付结构。',
              currentPlan: ['整理方案骨架', '补三大模块', '准备可交付文稿'],
              constraints: ['口吻正式', '适合汇报', '后续可导出 Word'],
            },
          }),
        ]);
      }

      if (callIndex === 2) {
        return generateResult([
          textPart('任务脉络我已经记住了，后面我们可以接着推进。'),
        ], 'stop');
      }

      const serializedPrompt = JSON.stringify(prompt);
      assert.match(serializedPrompt, /Task state/);
      assert.match(serializedPrompt, /复兴岛数字化方案/);
      assert.match(serializedPrompt, /口吻正式/);
      assert.match(serializedPrompt, /补充三个重点模块和交付结构/);

      return generateResult([
        textPart('我会沿着刚才那条任务继续写。'),
      ], 'stop');
    },
  });

  const agent = new AgentCore({
    model: 'mock-model',
    provider: 'openai',
    openai: {
      apiKey: 'test',
      baseURL: 'http://example.invalid/v1',
    },
    workspaceDir: rootDir,
    projectRootDir: rootDir,
    skillsDir: path.join(repoRoot, 'skills'),
    rolePromptDir: path.join(repoRoot, 'roles', 'contract-manager'),
    sessionDb: path.join(rootDir, 'sessions.db'),
    mcpServers: [],
  }, { model });

  try {
    await agent.init();

    const firstReply = await agent.chat('u1', '帮我先起一版复兴岛数字化方案框架');
    assert.match(firstReply, /记住/);

    const taskState = JSON.parse(fs.readFileSync(getTaskStatePath(rootDir, 'u1'), 'utf8'));
    assert.equal(taskState.tasks.length, 1);
    assert.equal(taskState.tasks[0].title, '复兴岛数字化方案');
    assert.equal(taskState.tasks[0].constraints.includes('口吻正式'), true);

    const secondReply = await agent.chat('u1', '继续，把三大模块展开');
    assert.match(secondReply, /继续写/);
    assert.equal(callIndex, 3);
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

async function testArtifactRecordingForActiveTask() {
  const rootDir = makeTempDir('agent-task-artifact-');
  const outputPath = path.join(rootDir, 'storage', 'users', 'u2', 'workspace', 'generated', 'weekly-report.docx');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, 'fake-docx-binary');

  let callIndex = 0;
  const model = new MockLanguageModelV3({
    doGenerate: () => {
      callIndex += 1;

      if (callIndex === 1) {
        return generateResult([
          toolCall('task-1', 'updateTaskState', {
            reason: 'The user is starting a weekly report drafting task.',
            taskPatch: {
              title: '周报整理',
              objective: '整理并输出一版本周周报 Word。',
              nextStep: '先发送当前版本。',
            },
          }),
        ]);
      }

      if (callIndex === 2) {
        return generateResult([
          toolCall('send-file-1', 'sendFile', {
            path: outputPath,
            name: 'weekly-report.docx',
          }),
        ]);
      }

      return generateResult([
        textPart('周报 Word 已经发给您。'),
      ], 'stop');
    },
  });

  const agent = new AgentCore({
    model: 'mock-model',
    provider: 'openai',
    openai: {
      apiKey: 'test',
      baseURL: 'http://example.invalid/v1',
    },
    workspaceDir: rootDir,
    projectRootDir: rootDir,
    skillsDir: path.join(repoRoot, 'skills'),
    rolePromptDir: path.join(repoRoot, 'roles', 'contract-manager'),
    sessionDb: path.join(rootDir, 'sessions.db'),
    mcpServers: [],
  }, { model });

  try {
    await agent.init();

    const reply = await agent.chat('u2', '先把本周周报 Word 发给我');
    assert.match(reply, /Word 已经发给您/);

    const taskState = JSON.parse(fs.readFileSync(getTaskStatePath(rootDir, 'u2'), 'utf8'));
    assert.equal(taskState.tasks.length, 1);
    assert.equal(taskState.tasks[0].artifacts.length, 1);
    assert.equal(taskState.tasks[0].artifacts[0].path, outputPath);
    assert.equal(taskState.tasks[0].artifacts[0].name, 'weekly-report.docx');
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}
