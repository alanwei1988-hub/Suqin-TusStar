const crypto = require('crypto');
const { ToolLoopAgent, stepCountIs } = require('ai');
const path = require('path');
const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
const { enrichAttachmentMetadata } = require('./tools/attachments');
const {
  appendFinalAssistantMessageIfNeeded,
  buildToolErrorContinuationPrompt,
  buildFinalResponse,
  buildSystemPrompt,
  createPrepareStep,
  extractToolErrorSummaries,
  getContextSettings,
  getToolChoiceSetting,
} = require('./loop');
const { createRuntimeTools } = require('./tools/index');
const { listAvailableSkills } = require('./tools/skills');
const { loadRolePrompt } = require('./roles');
const SessionManager = require('./session');
const { buildOpenAICompatibleProviderOptions } = require('../llm-thinking');

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

      if (Number.isFinite(a.pageCount)) {
        parts.push(`Pages: ${a.pageCount}`);
      }

      return `[Attachment] ${parts.join(', ')}`;
    }).join('\n');
    content = `${userMessage}

The user has provided the following attachment(s) for reference:
${attachmentInfo}

Important attachment handling rule:
- Attachments are not ordinary local text files. Do not use readFile on attachment paths.
- Do not inspect or read an attachment just because it appeared in the latest message.
- First decide what the user is trying to get done from the message and prior conversation.
- If the task is still ambiguous, ask a clarifying question before touching the attachment.
- Only inspect or read an attachment after both conditions are true:
  1. the task is clear enough;
  2. file access is actually needed to complete that task.
- Use inspectAttachment only for metadata, page count, file type, or a small preview.
- Use readAttachmentText only when bounded text extraction is needed for the current task.
- Once file access is justified, prefer fewer, larger reads and continue searching before asking the user to restate details.
- For contracts or business documents, extract likely key fields yourself only after file access is justified.
- Only pass an attachment path to another tool when that tool explicitly requires a file path.`;
  }

  return content;
}

function buildRequestContextPrompt(requestContext = {}) {
  const lines = [];

  if (requestContext.userId) {
    lines.push('Current Request');
    lines.push(`- Current requester user id: ${requestContext.userId}`);
  }

  if (Number.isFinite(requestContext.context?.chatType) || requestContext.context?.chatId) {
    lines.push(`- Current chat target: ${requestContext.context?.chatId || requestContext.userId} (chatType=${requestContext.context?.chatType || 1})`);
  }

  return lines.join('\n');
}

function parseToolResultOutput(part) {
  const output = part?.output;

  if (!output || typeof output !== 'object') {
    return null;
  }

  if (output.type === 'json') {
    return output.value || null;
  }

  if (output.type === 'content' && Array.isArray(output.value)) {
    const text = output.value
      .filter(item => item?.type === 'text' && typeof item.text === 'string')
      .map(item => item.text)
      .join('\n')
      .trim();

    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  return null;
}

function collectActivePendingArchiveDrafts(messages = []) {
  const activeDrafts = new Map();

  for (const message of messages) {
    if (message?.role !== 'tool' || !Array.isArray(message.content)) {
      continue;
    }

    for (const part of message.content) {
      if (part?.type !== 'tool-result') {
        continue;
      }

      const result = parseToolResultOutput(part);

      if (part.toolName === 'contract_preview_archive' && result?.pendingId) {
        activeDrafts.set(result.pendingId, {
          pendingId: result.pendingId,
          contractName: result.contract?.contractName || '',
          archiveRelativeDir: result.archiveRelativeDir || '',
          operator: result.contract?.uploadedBy || '',
        });
        continue;
      }

      if (part.toolName === 'contract_archive') {
        const pendingId = result?.pendingId || result?.archive?.pendingId || '';

        if (pendingId) {
          activeDrafts.delete(pendingId);
        }
      }
    }
  }

  return [...activeDrafts.values()];
}

function buildPendingArchiveDraftPrompt(messages = []) {
  const drafts = collectActivePendingArchiveDrafts(messages).slice(-3);

  if (drafts.length === 0) {
    return '';
  }

  return [
    'Active pending archive drafts',
    'If the user is confirming or revising a previous archive preview, call `contract_archive` with the matching `pendingId` and only the changed fields. Do not reconstruct the full archive fields from memory.',
    ...drafts.map(draft => `- pendingId=${draft.pendingId}; contractName=${draft.contractName || '未命名'}; archiveRelativeDir=${draft.archiveRelativeDir || '未定'}; operator=${draft.operator || '未定'}`),
  ].join('\n');
}

function enrichToolCallWithDisplay(toolCall, runtime) {
  if (!toolCall || typeof toolCall !== 'object') {
    return toolCall;
  }

  const display = runtime?.toolDisplayByName?.[toolCall.toolName];

  if (!display) {
    return toolCall;
  }

  return {
    ...toolCall,
    displayName: display.displayName,
    statusText: display.statusText,
  };
}

function enrichToolEventWithDisplay(event, runtime) {
  if (!event || typeof event !== 'object') {
    return event;
  }

  return {
    ...event,
    toolCall: enrichToolCallWithDisplay(event.toolCall, runtime),
  };
}

function enrichStepWithDisplay(step, runtime) {
  if (!step || typeof step !== 'object' || !Array.isArray(step.toolCalls)) {
    return step;
  }

  return {
    ...step,
    toolCalls: step.toolCalls.map(toolCall => enrichToolCallWithDisplay(toolCall, runtime)),
  };
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
        toolTimeouts: this.config.toolTimeouts || {},
      });
      await runtime.close();
      console.log('[Agent] MCP preflight passed.');
    }
  }

  async chat(userId, userMessage, attachments = [], options = {}) {
    const contextSettings = getContextSettings(this.config);
    const toolChoice = getToolChoiceSetting(this.config);
    const fullMessages = this.sessionManager.getMessages(userId);
    const normalizedOptions = typeof options === 'function'
      ? { onStepFinish: options }
      : (options || {});
    const {
      includeArtifacts = false,
      requestContext = {},
      ...callbacks
    } = normalizedOptions;
    const normalizedAttachments = await enrichAttachmentMetadata(
      normalizeConversationAttachments(attachments),
      this.config.workspaceDir,
      (_workspaceDir, requestedPath) => path.isAbsolute(requestedPath)
        ? path.normalize(requestedPath)
        : path.resolve(this.config.workspaceDir, requestedPath),
    );
    const content = buildUserContent(userMessage, normalizedAttachments);

    fullMessages.push({ role: 'user', content, attachments: normalizedAttachments });
    const conversationAttachments = collectConversationAttachments(fullMessages);
    const pendingArchiveDraftPrompt = buildPendingArchiveDraftPrompt(fullMessages);
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
      toolTimeouts: this.config.toolTimeouts || {},
    });
    const rolePrompt = await loadRolePrompt(this.config.rolePromptDir);
    const providerOptions = buildOpenAICompatibleProviderOptions(
      this.config.provider || 'openaiCompatible',
      this.config.thinking,
    );
    const promptSections = [
      rolePrompt,
      buildRequestContextPrompt(requestContext),
      ...runtime.promptSections,
      pendingArchiveDraftPrompt,
      context.summary,
    ].filter(Boolean);

    const agent = new ToolLoopAgent({
      model: this.modelOverride || this.provider(this.config.model),
      instructions: buildSystemPrompt(promptSections),
      tools: runtime.tools,
      stopWhen: stepCountIs(this.config.maxSteps || 12),
      toolChoice,
      providerOptions,
      prepareStep: createPrepareStep({
        runtime,
        contextSettings,
        basePromptSections: promptSections,
        toolChoice,
      }),
    });

    try {
      const responseMessages = [];
      let finalResponse = '已处理完成。';
      let messagesForRun = context.messages;
      const maxContinuationAttempts = 3;

      for (let continuationAttempt = 0; continuationAttempt < maxContinuationAttempts; continuationAttempt += 1) {
        const result = await agent.generate({
          messages: messagesForRun,
          experimental_onStepStart: async step => {
            if (callbacks.onStepStart) {
              await callbacks.onStepStart(step);
            }
          },
          experimental_onToolCallStart: async event => {
            if (callbacks.onToolCallStart) {
              await callbacks.onToolCallStart(enrichToolEventWithDisplay(event, runtime));
            }
          },
          experimental_onToolCallFinish: async event => {
            if (callbacks.onToolCallFinish) {
              await callbacks.onToolCallFinish(enrichToolEventWithDisplay(event, runtime));
            }
          },
          onStepFinish: async step => {
            if (callbacks.onStepFinish) {
              await callbacks.onStepFinish(enrichStepWithDisplay(step, runtime));
            }
          },
        });

        const newResponseMessages = Array.isArray(result?.response?.messages)
          ? result.response.messages
          : [];

        responseMessages.push(...newResponseMessages);
        finalResponse = buildFinalResponse(result);
        const toolErrors = extractToolErrorSummaries(newResponseMessages);
        const needsToolErrorRecovery = toolErrors.length > 0;

        if (continuationAttempt === maxContinuationAttempts - 1 || !needsToolErrorRecovery) {
          break;
        }

        messagesForRun = [
          ...messagesForRun,
          ...newResponseMessages,
          {
            role: 'user',
            content: buildToolErrorContinuationPrompt(toolErrors),
          },
        ];
      }

      const outboundAttachments = typeof runtime.getOutboundAttachments === 'function'
        ? runtime.getOutboundAttachments()
        : [];

      appendFinalAssistantMessageIfNeeded(fullMessages, responseMessages, finalResponse);
      this.sessionManager.saveMessages(userId, fullMessages);

      if (includeArtifacts) {
        return {
          text: finalResponse,
          outboundAttachments,
        };
      }

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
