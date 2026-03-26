const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { simulateReadableStream } = require('ai');
const { MockLanguageModelV3 } = require('ai/test');
const AgentCore = require('../agent');
const { createUsage, makeTempDir, repoRoot } = require('./helpers/test-helpers');

module.exports = async function runAgentStreamingTest() {
  const rootDir = makeTempDir('agent-streaming-');
  const deltas = [];
  const model = new MockLanguageModelV3({
    provider: 'streaming-mock',
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'o' },
          { type: 'text-delta', id: 'text-1', delta: 'k' },
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: createUsage(),
          },
        ],
      }),
    }),
  });

  const agent = new AgentCore({
    model: 'mock-model',
    provider: 'openai',
    openai: {
      apiKey: 'test',
      baseURL: 'http://example.invalid/v1',
    },
    workspaceDir: repoRoot,
    skillsDir: path.join(repoRoot, 'skills'),
    rolePromptDir: path.join(repoRoot, 'roles', 'contract-manager'),
    sessionDb: path.join(rootDir, 'sessions.db'),
    mcpServers: [],
  }, { model });

  try {
    await agent.init();
    const response = await agent.chat('u1', '你好', [], {
      onTextDelta: async ({ textDelta }) => {
        deltas.push(textDelta);
      },
    });

    assert.equal(response, 'ok');
    assert.deepEqual(deltas, ['o', 'k']);
    assert.equal(model.doStreamCalls.length, 1);
    assert.equal(model.doGenerateCalls.length, 0);
  } finally {
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
