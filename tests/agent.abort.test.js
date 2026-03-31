const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ToolLoopAgent } = require('ai');
const { MockLanguageModelV3 } = require('ai/test');
const AgentCore = require('../agent');
const { makeTempDir, repoRoot } = require('./helpers/test-helpers');

module.exports = async function runAgentAbortTest() {
  const rootDir = makeTempDir('agent-abort-');
  const originalStream = ToolLoopAgent.prototype.stream;
  let observedAbortSignal;

  ToolLoopAgent.prototype.stream = async function streamWithAbortSpy(options = {}) {
    observedAbortSignal = options.abortSignal;

    const abortPromise = new Promise((resolve, reject) => {
      const onAbort = () => {
        reject(options.abortSignal.reason || new Error('aborted'));
      };

      if (!options.abortSignal) {
        reject(new Error('Expected abortSignal.'));
        return;
      }

      if (options.abortSignal.aborted) {
        onAbort();
        return;
      }

      options.abortSignal.addEventListener('abort', onAbort, { once: true });
    });

    return {
      textStream: {
        async *[Symbol.asyncIterator]() {
          await abortPromise;
        },
      },
      response: abortPromise,
      text: abortPromise,
    };
  };

  const model = new MockLanguageModelV3({
    provider: 'abort-mock',
    doGenerate: async () => {
      throw new Error('generate should not be used in abort test');
    },
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
    const controller = new AbortController();
    const chatPromise = agent.chat('u1', '请开始但不要完成', [], {
      abortSignal: controller.signal,
    });

    await new Promise(resolve => setTimeout(resolve, 30));
    controller.abort(new Error('Stopped by test.'));

    await assert.rejects(chatPromise, error => {
      assert.equal(error.message, 'Stopped by test.');
      return true;
    });
    if (observedAbortSignal) {
      assert.equal(observedAbortSignal, controller.signal);
    }
  } finally {
    ToolLoopAgent.prototype.stream = originalStream;
    agent.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};
