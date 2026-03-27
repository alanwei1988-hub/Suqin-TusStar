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
const { createMcpToolkit } = require('./tools/mcp');
const { buildMemoryPrompt, MemoryManager } = require('./memory');
const { listAvailableSkills } = require('./tools/skills');
const { loadRolePrompt } = require('./roles');
const SessionManager = require('./session');
const { resolveUserAgentConfig } = require('./user-config');
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
  const temporalContext = buildTemporalContextPrompt(requestContext);

  if (temporalContext) {
    lines.push(temporalContext);
  }

  if (requestContext.userId) {
    lines.push('Current Request');
    lines.push(`- Current requester user id: ${requestContext.userId}`);
  }

  if (requestContext.userDisplayName) {
    lines.push(`- Current requester display name: ${requestContext.userDisplayName}`);
  }

  if (Number.isFinite(requestContext.context?.chatType) || requestContext.context?.chatId) {
    lines.push(`- Current chat target: ${requestContext.context?.chatId || requestContext.userId} (chatType=${requestContext.context?.chatType || 1})`);
  }

  return lines.join('\n');
}

function resolvePromptNow(requestContext = {}) {
  const candidates = [
    requestContext.currentDateTime,
    requestContext.currentDate,
    requestContext.context?.currentDateTime,
    requestContext.context?.currentDate,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      continue;
    }

    const parsed = new Date(candidate);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function formatDateTimeParts(value, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(value)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function buildTemporalContextPrompt(requestContext = {}) {
  const configuredTimeZone = requestContext.timezone || requestContext.context?.timezone || 'Asia/Shanghai';
  const now = resolvePromptNow(requestContext);
  const { date, time } = formatDateTimeParts(now, configuredTimeZone);

  return [
    'Current Time',
    `- Current date (${configuredTimeZone}): ${date}`,
    `- Current time (${configuredTimeZone}): ${time}`,
    '- Interpret relative time words such as today, tomorrow, yesterday, recent, and this month against this timestamp unless the user gives an explicit date.',
  ].join('\n');
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

function isArchiveIntentText(message = '') {
  const text = typeof message === 'string' ? message.trim() : '';

  if (!text) {
    return false;
  }

  return /归档|存档|入档|按此归档|直接归档|确认归档/u.test(text);
}

function buildArchiveIdentityPrompt({
  memory,
  userId,
  userMessage,
  attachments = [],
  fullMessages = [],
} = {}) {
  const normalizedMemory = memory && typeof memory === 'object' ? memory : {};
  const realName = typeof normalizedMemory.profile?.realName === 'string'
    ? normalizedMemory.profile.realName.trim()
    : '';

  if (realName) {
    return '';
  }

  const awaitingRealNameReply = normalizedMemory.profile?.awaitingRealNameReply === true;
  const hasPendingArchiveDraft = collectActivePendingArchiveDrafts(fullMessages).length > 0;
  const hasArchiveIntent = hasPendingArchiveDraft
    || isArchiveIntentText(userMessage)
    || (Array.isArray(attachments) && attachments.length > 0 && isArchiveIntentText(userMessage));

  if (!hasArchiveIntent) {
    return '';
  }

  const stableUserId = typeof userId === 'string' ? userId.trim() : '';

  return [
    'Formal identity gate',
    '- This turn is on the contract archive path and the requester real name is still unknown.',
    stableUserId ? `- The stable channel user id "${stableUserId}" is only a technical id and must not be used as the person name in contract archive records.` : '- Do not use a technical channel id as the person name in contract archive records.',
    '- Before calling `contract_preview_archive` or `contract_archive`, first obtain the requester real name that should appear in formal archive records.',
    '- After the user provides the real name, call `updateMemory` to store it with a direct patch, then continue the archive flow.',
    awaitingRealNameReply
      ? '- You already asked for the real name earlier. If the user still has not answered, briefly remind them that contract archiving cannot proceed until they provide it.'
      : '- Ask a direct Chinese question now, such as: “归档前我需要确认一下您的真实姓名，合同记录里要用这个姓名，不能用企微 userid 代替。请问您怎么称呼？” Then call `updateMemory` with `awaitingRealNameReply: true` if you are still waiting for the answer.',
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

function checkpointSessionMessages(sessionManager, userId, fullMessages, responseMessages) {
  sessionManager.saveMessages(userId, [
    ...fullMessages,
    ...responseMessages,
  ]);
}

function checkpointSessionMessagesForStep(sessionManager, userId, fullMessages, responseMessages, step) {
  const stepMessages = Array.isArray(step?.response?.messages)
    ? step.response.messages
    : [];

  if (stepMessages.length === 0) {
    return;
  }

  sessionManager.saveMessages(userId, [
    ...fullMessages,
    ...responseMessages,
    ...stepMessages,
  ]);
}

/**
 * AgentCore - 纯粹的通用 AI 大脑，通过配置初始化
 */
class AgentCore {
  constructor(config, options = {}) {
    this.config = config;
    this.modelOverride = options.model;
    this.memoryManagers = new Map();
    this.sessionManagers = new Map();
    this.sessionManager = this.getSessionManager(config.sessionDb);
    this.skills = [];
  }

  getSessionManager(dbPath) {
    const key = path.resolve(dbPath);

    if (!this.sessionManagers.has(key)) {
      this.sessionManagers.set(key, new SessionManager(key));
    }

    return this.sessionManagers.get(key);
  }

  getMemoryManager(filePath, options = {}) {
    const key = path.resolve(filePath);

    if (!this.memoryManagers.has(key)) {
      this.memoryManagers.set(key, new MemoryManager(key, options));
    }

    return this.memoryManagers.get(key);
  }

  async init() {
    this.skills = await listAvailableSkills({
      skillsDir: this.config.skillsDirs || this.config.skillsDir,
      workspaceDir: this.config.projectRootDir || this.config.workspaceDir,
    });
    console.log(`[Agent] Loaded ${this.skills.length} skills: ${this.skills.map(s => s.name).join(', ')}`);

    const strictMcpServers = (this.config.mcpServers || []).filter(
      server => server && server.enabled !== false && server.failOpen === false,
    );

    if (strictMcpServers.length > 0) {
      console.log(`[Agent] Preflighting strict MCP servers: ${strictMcpServers.map(server => server.name || server.command || server.url).join(', ')}`);
      const toolkit = await createMcpToolkit(this.config.mcpServers || [], {
        defaultToolTimeoutMs: this.config.toolTimeouts?.mcpToolTimeoutMs,
      });
      await toolkit.close();
      console.log('[Agent] MCP preflight passed.');
    }
  }

  async chat(userId, userMessage, attachments = [], options = {}) {
    const normalizedOptions = typeof options === 'function'
      ? { onStepFinish: options }
      : (options || {});
    const {
      includeArtifacts = false,
      requestContext = {},
      ...callbacks
    } = normalizedOptions;
    const { config: effectiveConfig } = resolveUserAgentConfig(this.config, userId);
    const contextSettings = getContextSettings(effectiveConfig);
    const toolChoice = getToolChoiceSetting(effectiveConfig);
    const sessionManager = this.getSessionManager(effectiveConfig.sessionDb);
    const fullMessages = sessionManager.getMessages(userId);
    const memoryPath = path.join(effectiveConfig.userPaths.dataDir, 'memory.json');
    const memoryManager = this.getMemoryManager(memoryPath, {
      reflectionIntervalTurns: effectiveConfig.memory?.reflectionIntervalTurns,
    });
    const normalizedAttachments = await enrichAttachmentMetadata(
      normalizeConversationAttachments(attachments),
      effectiveConfig.projectRootDir || effectiveConfig.workspaceDir,
      (_workspaceDir, requestedPath) => path.isAbsolute(requestedPath)
        ? path.normalize(requestedPath)
        : path.resolve(effectiveConfig.projectRootDir || effectiveConfig.workspaceDir, requestedPath),
    );
    const content = buildUserContent(userMessage, normalizedAttachments);

    fullMessages.push({ role: 'user', content, attachments: normalizedAttachments });
    const turnMemory = memoryManager.prepareForTurn({ userMessage });
    const memory = turnMemory.memory;
    const userDisplayName = typeof memory.profile?.realName === 'string'
      ? memory.profile.realName.trim()
      : '';
    const conversationAttachments = collectConversationAttachments(fullMessages);
    const pendingArchiveDraftPrompt = buildPendingArchiveDraftPrompt(fullMessages);
    const archiveIdentityPrompt = buildArchiveIdentityPrompt({
      memory,
      userId,
      userMessage,
      attachments: normalizedAttachments,
      fullMessages,
    });
    const context = sessionManager.buildModelContext(fullMessages, {
      recentMessagesCount: contextSettings.recentMessagesCount,
      summaryLineCount: contextSettings.summaryLineCount,
      summaryMaxChars: contextSettings.summaryMaxChars,
    });

    const liveRequestContext = {
      ...requestContext,
      memory,
      userDisplayName,
    };

    const provider = createOpenAICompatible({
      name: effectiveConfig.provider || 'openaiCompatible',
      apiKey: effectiveConfig.openai.apiKey,
      baseURL: effectiveConfig.openai.baseURL,
      includeUsage: true,
    });
    const model = this.modelOverride || provider(effectiveConfig.model);
    const providerOptions = buildOpenAICompatibleProviderOptions(
      effectiveConfig.provider || 'openaiCompatible',
      effectiveConfig.thinking,
    );
    const runtime = await createRuntimeTools({
      workspaceDir: effectiveConfig.workspaceDir,
      projectRootDir: effectiveConfig.projectRootDir || effectiveConfig.workspaceDir,
      sharedReadRoots: effectiveConfig.sharedReadRoots || [],
      skillsDir: effectiveConfig.skillsDirs || effectiveConfig.skillsDir,
      mcpServers: effectiveConfig.mcpServers || [],
      attachments: conversationAttachments,
      attachmentExtraction: effectiveConfig.attachmentExtraction || {},
      toolTimeouts: effectiveConfig.toolTimeouts || {},
      requestContext: liveRequestContext,
      memoryRuntime: {
        applyPatch({ reason = '', patch = {} } = {}) {
          const result = memoryManager.applyPatch({
            reason,
            patch,
            trigger: 'tool_call',
          });

          liveRequestContext.memory = result.memory;
          liveRequestContext.userDisplayName = typeof result.memory?.profile?.realName === 'string'
            ? result.memory.profile.realName.trim()
            : '';

          return result;
        },
      },
    });
    const rolePrompt = await loadRolePrompt(effectiveConfig.rolePromptDirs || effectiveConfig.rolePromptDir);
    const promptSections = [
      rolePrompt,
      buildRequestContextPrompt({
        ...requestContext,
        userDisplayName,
      }),
      buildMemoryPrompt(memory, { userId }),
      archiveIdentityPrompt,
      ...runtime.promptSections,
      pendingArchiveDraftPrompt,
      context.summary,
    ].filter(Boolean);

    const agent = new ToolLoopAgent({
      model,
      instructions: buildSystemPrompt(promptSections),
      tools: runtime.tools,
      stopWhen: stepCountIs(effectiveConfig.maxSteps || 12),
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
      const maxContinuationAttempts = Number.isFinite(effectiveConfig.maxContinuationAttempts)
        ? Math.max(1, Math.trunc(effectiveConfig.maxContinuationAttempts))
        : 2;
      const preferStreaming = !(this.modelOverride && this.modelOverride.provider === 'mock-provider');

      for (let continuationAttempt = 0; continuationAttempt < maxContinuationAttempts; continuationAttempt += 1) {
        if (!preferStreaming) {
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
              checkpointSessionMessagesForStep(sessionManager, userId, fullMessages, responseMessages, step);
              if (callbacks.onStepFinish) {
                await callbacks.onStepFinish(enrichStepWithDisplay(step, runtime));
              }
            },
          });

          const newResponseMessages = Array.isArray(result?.response?.messages)
            ? result.response.messages
            : [];

          responseMessages.push(...newResponseMessages);
          checkpointSessionMessages(sessionManager, userId, fullMessages, responseMessages);
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
          continue;
        }

        let streamResult;

        try {
          streamResult = await agent.stream({
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
              checkpointSessionMessagesForStep(sessionManager, userId, fullMessages, responseMessages, step);
              if (callbacks.onStepFinish) {
                await callbacks.onStepFinish(enrichStepWithDisplay(step, runtime));
              }
            },
          });
        } catch (error) {
          const shouldFallbackToGenerate = error instanceof Error && error.message === 'Not implemented';

          if (!shouldFallbackToGenerate) {
            throw error;
          }

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
              checkpointSessionMessagesForStep(sessionManager, userId, fullMessages, responseMessages, step);
              if (callbacks.onStepFinish) {
                await callbacks.onStepFinish(enrichStepWithDisplay(step, runtime));
              }
            },
          });

          const newResponseMessages = Array.isArray(result?.response?.messages)
            ? result.response.messages
            : [];

          responseMessages.push(...newResponseMessages);
          checkpointSessionMessages(sessionManager, userId, fullMessages, responseMessages);
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
          continue;
        }

        let streamedText = '';
        for await (const delta of streamResult.textStream) {
          streamedText += delta;

          if (callbacks.onTextDelta && delta) {
            await callbacks.onTextDelta({
              textDelta: delta,
              text: streamedText,
              continuationAttempt,
            });
          }
        }

        const [streamResponse, streamText] = await Promise.all([
          streamResult.response,
          streamResult.text,
        ]);
        const newResponseMessages = Array.isArray(streamResponse?.messages)
          ? streamResponse.messages
          : [];

        responseMessages.push(...newResponseMessages);
        checkpointSessionMessages(sessionManager, userId, fullMessages, responseMessages);
        finalResponse = streamText || '已处理完成。';
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
      sessionManager.saveMessages(userId, fullMessages);
      memoryManager.finalizeTurn({ assistantMessage: finalResponse });
      if (effectiveConfig.memory?.asyncReflectionEnabled !== false) {
        memoryManager.triggerReflectionAsync({
          model,
          providerOptions,
          userId,
          conversationMessages: fullMessages,
          dialogueLimit: effectiveConfig.memory?.dialogueLimit,
        });
      }

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
    this.memoryManagers.clear();
    for (const sessionManager of this.sessionManagers.values()) {
      sessionManager.close();
    }
    this.sessionManagers.clear();
  }
}

module.exports = AgentCore;
module.exports.buildRequestContextPrompt = buildRequestContextPrompt;
module.exports.buildTemporalContextPrompt = buildTemporalContextPrompt;
module.exports.buildArchiveIdentityPrompt = buildArchiveIdentityPrompt;
