const { ToolLoopAgent, stepCountIs } = require('ai');
const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
const {
  DONE_TOOL_NAME,
  appendFinalAssistantMessageIfNeeded,
  buildDoneResponse,
  buildSystemPrompt,
  createPrepareStep,
  doneTool,
  getContextSettings,
  getToolChoiceSetting,
} = require('./loop');
const { createRuntimeTools } = require('./tools/index');
const { listAvailableSkills } = require('./tools/skills');
const { loadRolePrompt } = require('./roles');
const SessionManager = require('./session');

/**
 * AgentCore - 纯粹的通用 AI 大脑，通过配置初始化
 */
class AgentCore {
  constructor(config, options = {}) {
    this.config = config;
    this.provider = createOpenAICompatible({
      name: config.provider || 'openaiCompatible',
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseURL,
      includeUsage: true,
    });
    this.modelOverride = options.model;
    this.sessionManager = new SessionManager(config.sessionDb);
    this.skills = [];
  }

  async init() {
    this.skills = await listAvailableSkills({
      skillsDir: this.config.skillsDir,
      workspaceDir: this.config.workspaceDir,
    });
    console.log(`[Agent] Loaded ${this.skills.length} skills: ${this.skills.map(s => s.name).join(', ')}`);

    const strictMcpServers = (this.config.mcpServers || []).filter(
      server => server && server.enabled !== false && server.failOpen === false,
    );

    if (strictMcpServers.length > 0) {
      console.log(`[Agent] Preflighting strict MCP servers: ${strictMcpServers.map(server => server.name || server.command || server.url).join(', ')}`);
      const runtime = await createRuntimeTools({
        workspaceDir: this.config.workspaceDir,
        skillsDir: this.config.skillsDir,
        mcpServers: this.config.mcpServers || [],
      });
      await runtime.close();
      console.log('[Agent] MCP preflight passed.');
    }
  }

  async chat(userId, userMessage, attachments = [], onStepFinish) {
    const contextSettings = getContextSettings(this.config);
    const toolChoice = getToolChoiceSetting(this.config);
    const fullMessages = this.sessionManager.getMessages(userId);

    let content = userMessage;
    if (attachments && attachments.length > 0) {
      const attachmentInfo = attachments.map(a => `[File: ${a.name}, Path: ${a.path}]`).join('\n');
      content = `${userMessage}\n\nI have provided the following file(s) for your reference:\n${attachmentInfo}`;
    }

    fullMessages.push({ role: 'user', content });
    const context = this.sessionManager.buildModelContext(fullMessages, {
      recentMessagesCount: contextSettings.recentMessagesCount,
      summaryLineCount: contextSettings.summaryLineCount,
      summaryMaxChars: contextSettings.summaryMaxChars,
    });

    const runtime = await createRuntimeTools({
      workspaceDir: this.config.workspaceDir,
      skillsDir: this.config.skillsDir,
      mcpServers: this.config.mcpServers || [],
    });
    const rolePrompt = await loadRolePrompt(this.config.rolePromptDir);
    const promptSections = [
      rolePrompt,
      ...runtime.promptSections,
      context.summary,
    ].filter(Boolean);

    const agent = new ToolLoopAgent({
      model: this.modelOverride || this.provider(this.config.model),
      instructions: buildSystemPrompt(promptSections),
      tools: {
        ...runtime.tools,
        [DONE_TOOL_NAME]: doneTool,
      },
      stopWhen: stepCountIs(this.config.maxSteps || 12),
      toolChoice,
      prepareStep: createPrepareStep({
        runtime,
        contextSettings,
        basePromptSections: promptSections,
        toolChoice,
      }),
    });

    try {
      const result = await agent.generate({
        messages: context.messages,
        onStepFinish: step => {
          if (onStepFinish) {
            onStepFinish(step);
          }
        },
      });
      const finalResponse = buildDoneResponse(result);

      appendFinalAssistantMessageIfNeeded(fullMessages, result.response.messages, finalResponse);
      this.sessionManager.saveMessages(userId, fullMessages);

      return finalResponse;
    } finally {
      await runtime.close();
    }
  }

  close() {
    this.sessionManager.close();
  }
}

module.exports = AgentCore;
