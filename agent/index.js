const crypto = require('crypto');
const { ToolLoopAgent, stepCountIs } = require('ai');
const path = require('path');
const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
const {
  appendFinalAssistantMessageIfNeeded,
  buildFinalResponse,
  buildSystemPrompt,
  createPrepareStep,
  getContextSettings,
  getToolChoiceSetting,
} = require('./loop');
const { createRuntimeTools } = require('./tools/index');
const { listAvailableSkills } = require('./tools/skills');
const { loadRolePrompt } = require('./roles');
const SessionManager = require('./session');

function normalizeConversationAttachments(attachments = []) {
  return attachments.map((attachment, index) => {
    const filePath = attachment?.path || '';
    const fallbackKey = filePath || attachment?.name || `attachment-${index + 1}`;
    const generatedId = `attachment-${crypto.createHash('sha1').update(String(fallbackKey)).digest('hex').slice(0, 10)}`;
    return {
      ...attachment,
      sourceId: attachment?.id || null,
      id: attachment?.id || generatedId,
      name: attachment?.name || path.basename(filePath || `attachment-${index + 1}`),
      path: filePath,
      kind: attachment?.kind || 'file',
      mimeType: attachment?.mimeType || attachment?.mime || '',
    };
  });
}

function collectConversationAttachments(messages = []) {
  const collected = [];
  const seenIdentityKeys = new Set();

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role !== 'user' || !Array.isArray(message.attachments) || message.attachments.length === 0) {
      continue;
    }

    for (const attachment of message.attachments) {
      const identityKey = String(attachment?.path || attachment?.name || attachment?.id || '');

      if (!identityKey || seenIdentityKeys.has(identityKey)) {
        continue;
      }

      seenIdentityKeys.add(identityKey);
      collected.push(attachment);
    }
  }

  const reversed = collected.reverse();
  const usedIds = new Set();

  return reversed.map((attachment, index) => {
    const identityKey = String(attachment?.path || attachment?.name || attachment?.id || `attachment-${index + 1}`);
    const candidateId = String(attachment?.id || `attachment-${index + 1}`);

    if (!usedIds.has(candidateId)) {
      usedIds.add(candidateId);
      return attachment;
    }

    const uniqueId = `${candidateId}-${crypto.createHash('sha1').update(identityKey).digest('hex').slice(0, 8)}`;
    usedIds.add(uniqueId);
    return {
      ...attachment,
      id: uniqueId,
    };
  });
}

function buildUserContent(userMessage, attachments = []) {
  let content = userMessage;

  if (attachments && attachments.length > 0) {
    const attachmentInfo = attachments.map(a => {
      const parts = [
        `ID: ${a.id}`,
        `Name: ${a.name}`,
        `Path: ${a.path}`,
      ];

      if (a.kind) {
        parts.push(`Kind: ${a.kind}`);
      }

      if (a.mimeType) {
        parts.push(`MIME: ${a.mimeType}`);
      }

      return `[Attachment] ${parts.join(', ')}`;
    }).join('\n');
    content = `${userMessage}

The user has provided the following attachment(s) for reference:
${attachmentInfo}

Important attachment handling rule:
- User-provided attachments are not ordinary local text files.
- Do not use readFile on attachment paths.
- First infer the user's intent from the current message and prior conversation.
- If the intended operation on the file is not clear enough, ask a clarifying question first.
- Use inspectAttachment to inspect metadata or get a safe preview.
- Use readAttachmentText only when bounded text extraction is actually needed.
- Only pass an attachment path to another tool when that tool explicitly requires a file path.`;
  }

  return content;
}

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
        attachmentExtraction: this.config.attachmentExtraction || {},
      });
      await runtime.close();
      console.log('[Agent] MCP preflight passed.');
    }
  }

  async chat(userId, userMessage, attachments = [], options = {}) {
    const contextSettings = getContextSettings(this.config);
    const toolChoice = getToolChoiceSetting(this.config);
    const fullMessages = this.sessionManager.getMessages(userId);
    const callbacks = typeof options === 'function'
      ? { onStepFinish: options }
      : (options || {});
    const normalizedAttachments = normalizeConversationAttachments(attachments);
    const content = buildUserContent(userMessage, normalizedAttachments);

    fullMessages.push({ role: 'user', content, attachments: normalizedAttachments });
    const conversationAttachments = collectConversationAttachments(fullMessages);
    const context = this.sessionManager.buildModelContext(fullMessages, {
      recentMessagesCount: contextSettings.recentMessagesCount,
      summaryLineCount: contextSettings.summaryLineCount,
      summaryMaxChars: contextSettings.summaryMaxChars,
    });

    const runtime = await createRuntimeTools({
      workspaceDir: this.config.workspaceDir,
      skillsDir: this.config.skillsDir,
      mcpServers: this.config.mcpServers || [],
      attachments: conversationAttachments,
      attachmentExtraction: this.config.attachmentExtraction || {},
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
      tools: runtime.tools,
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
        experimental_onStepStart: async step => {
          if (callbacks.onStepStart) {
            await callbacks.onStepStart(step);
          }
        },
        experimental_onToolCallStart: async event => {
          if (callbacks.onToolCallStart) {
            await callbacks.onToolCallStart(event);
          }
        },
        experimental_onToolCallFinish: async event => {
          if (callbacks.onToolCallFinish) {
            await callbacks.onToolCallFinish(event);
          }
        },
        onStepFinish: async step => {
          if (callbacks.onStepFinish) {
            await callbacks.onStepFinish(step);
          }
        },
      });
      const finalResponse = buildFinalResponse(result);

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
