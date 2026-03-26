const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MockLanguageModelV3 } = require('ai/test');
const AgentCore = require('../agent');
const { generateResult, makeTempDir, repoRoot, textPart, toolCall, waitFor } = require('./helpers/test-helpers');

function getMemoryPath(rootDir, userId) {
  return path.join(rootDir, 'storage', 'users', encodeURIComponent(userId), 'data', 'memory.json');
}

module.exports = async function runAgentMemoryTest() {
  await testUpdateMemoryToolAndPromptInjection();
  await testThresholdReflection();
};

async function testUpdateMemoryToolAndPromptInjection() {
  const rootDir = makeTempDir('agent-memory-tool-');
  let callIndex = 0;
  const model = new MockLanguageModelV3({
    doGenerate: () => {
      callIndex += 1;

      if (callIndex === 1) {
        return generateResult([
          toolCall('memory-1', 'updateMemory', {
            reason: '用户提供了真名，并要求后续正式场景使用这个名字。',
            memoryPatch: {
              profile: {
                realName: '王小明',
                realNameSource: 'user_provided',
                awaitingRealNameReply: false,
              },
              notes: [
                {
                  text: '合同等正式场景使用真名王小明',
                  kind: 'identity',
                  trigger: 'tool_call',
                },
              ],
            },
          }),
        ]);
      }

      if (callIndex === 2) {
        return generateResult([textPart('好的，已记住，以后正式场景我会用王小明。')], 'stop');
      }

      if (callIndex === 3) {
        return generateResult([textPart('继续按真名处理。')], 'stop');
      }

      return generateResult([textPart('继续按真名处理。')], 'stop');
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
    const firstResponse = await agent.chat('u1', '我叫王小明，后面合同操作用这个真名。');
    const memory = JSON.parse(fs.readFileSync(getMemoryPath(rootDir, 'u1'), 'utf8'));
    const secondResponse = await agent.chat('u1', '继续');

    assert.match(firstResponse, /已记住/);
    assert.match(secondResponse, /真名处理/);
    assert.equal(memory.profile.realName, '王小明');
    assert.equal(memory.profile.awaitingRealNameReply, false);
    assert.match(JSON.stringify(model.doGenerateCalls[2].prompt), /Remembered real name: 王小明/);
    assert.match(JSON.stringify(model.doGenerateCalls[2].prompt), /Current requester display name: 王小明/);
    assert.equal(model.doGenerateCalls.length, 3);
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

async function testThresholdReflection() {
  const rootDir = makeTempDir('agent-memory-threshold-');
  let callIndex = 0;
  const model = new MockLanguageModelV3({
    doGenerate: () => {
      callIndex += 1;

      if (callIndex === 1) {
        return generateResult([textPart('收到')], 'stop');
      }

      return generateResult([textPart(JSON.stringify({
        shouldUpdate: true,
        memory: {
          profile: {
            realName: '',
            realNameSource: '',
            awaitingRealNameReply: false,
          },
          notes: [
            {
              text: '用户要求合同场景保持正式称呼',
              kind: 'preference',
              trigger: 'threshold_reflection',
            },
          ],
        },
        changeSummary: '反思后补充正式称呼偏好。',
      }))], 'stop');
    },
  });
  const memoryPath = getMemoryPath(rootDir, 'u3');
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  fs.writeFileSync(memoryPath, JSON.stringify({
    profile: {},
    notes: [],
    stats: {
      userTurnCount: 19,
      lastReflectionTurnCount: 0,
    },
  }, null, 2));

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
    await agent.chat('u3', '继续');
    const reflected = await waitFor(() => {
      const memory = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
      return memory.stats.lastReflectionTurnCount >= 20 && memory.notes.some(note => note.trigger === 'threshold_reflection')
        ? memory
        : null;
    });

    assert.equal(reflected.notes.some(note => note.kind === 'preference'), true);
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}
