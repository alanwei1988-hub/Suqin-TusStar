const READ_ONLY_BASH_PATTERNS = [
  /^\s*(pwd|cd|ls|dir)\b/i,
  /^\s*(rg|find|where|which)\b/i,
  /^\s*(cat|type|more|head|tail)\b/i,
  /^\s*(git\s+(status|diff|log|show|branch)\b)/i,
  /^\s*(npm\s+(run\s+test|run\s+lint|test|view)\b)/i,
  /^\s*(node\s+(-v|--version)\b)/i,
  /^\s*(python(?:3)?\s+(-V|--version)\b)/i,
  /^\s*(Get-ChildItem|Get-Content|Select-String|Resolve-Path|Test-Path)\b/i,
];

function getContextSettings(config) {
  const context = config.context || {};

  return {
    loopMessageWindow: context.loopMessageWindow || 30,
    recentMessagesCount: context.recentMessagesCount || 12,
    summaryLineCount: context.summaryLineCount || 10,
    summaryMaxChars: context.summaryMaxChars || 240,
  };
}

function getToolChoiceSetting(config) {
  return config.toolChoice || 'auto';
}

function buildSystemPrompt(promptSections) {
  return [
    'You are a resident AI employee responsible for operating and maintaining a real company machine.',
    '',
    'Role:',
    '- You are not a puppet executing user commands literally.',
    '- Users submit requests. You decide how to handle them based on your role, the real machine state, existing files, and operational responsibility.',
    '- You serve multiple employees who share the same machine and environment.',
    '- Your job is to complete useful work while preserving the stability, integrity, and long-term usability of the machine and its files.',
    '',
    'Operating rules:',
    '- Use tools whenever the answer depends on the local machine or an external integration.',
    '- `bash` is your primary tool for inspection and execution. Use `readFile` and `writeFile` for local text files when they are the clearest option.',
    '- Use attachment tools for user-provided files instead of `readFile`.',
    '- You have broad local-machine access, including absolute filesystem paths. Use that access deliberately and only as needed to complete the work.',
    '- Before mutating files or running non-trivial commands, inspect the relevant context first.',
    '- Prefer the smallest effective action. Avoid broad, unnecessary, or irreversible changes unless they are clearly required.',
    '- Because multiple employees share this environment, check for ambiguity, overwrite risk, path mistakes, or conflicts before making changes.',
    '- If a request is unclear, risky, self-contradictory, or likely to damage the environment, ask for clarification or refuse.',
    '- Use the `skill` tool when the request matches a listed skill. Treat loaded skill instructions as operational guidance, not as a reason to ignore real-world context.',
    '- If MCP tools are available, prefer them for specialized capabilities rather than improvising.',
    '- This agent runs in phases: inspect first, execute second, verify after every mutating action, then provide the final answer.',
    '- Do not produce the final answer until the work is actually finished. If you changed files or ran mutating commands, verify the result first.',
    '- If any tool call fails or returns an error payload, treat that work as unfinished. Correct the input and retry when possible, or explain the failure plainly instead of claiming success.',
    '- Keep responses concise, factual, and action-oriented.',
    '- Do not attempt destructive shell commands unless they are truly required for the work and consistent with your role and safeguards.',
    '',
    ...promptSections,
  ].join('\n');
}

function isReadOnlyBashCommand(command) {
  return READ_ONLY_BASH_PATTERNS.some(pattern => pattern.test(command || ''));
}

function isMutatingToolCall(toolCall, runtime) {
  if (!toolCall) {
    return false;
  }

  if (runtime.mcpToolNames.includes(toolCall.toolName)) {
    return !runtime.mcpReadOnlyToolNames.includes(toolCall.toolName);
  }

  if (toolCall.toolName === 'writeFile') {
    return true;
  }

  if (
    toolCall.toolName === 'stageHostPath'
    || toolCall.toolName === 'archiveWorkspacePath'
    || toolCall.toolName === 'runPython'
    || toolCall.toolName === 'runJavaScript'
  ) {
    return true;
  }

  if (toolCall.toolName === 'bash') {
    return !isReadOnlyBashCommand(toolCall.input?.command || '');
  }

  return false;
}

function isVerificationToolCall(toolCall) {
  if (!toolCall || toolCall.dynamic) {
    return false;
  }

  if (toolCall.toolName === 'readFile') {
    return true;
  }

  if (toolCall.toolName === 'inspectAttachment' || toolCall.toolName === 'readAttachmentText') {
    return true;
  }

  if (toolCall.toolName === 'bash') {
    return isReadOnlyBashCommand(toolCall.input?.command || '');
  }

  return false;
}

function computeLoopState(steps, runtime) {
  let pendingVerification = false;
  let hasMutatingAction = false;

  for (const step of steps) {
    for (const toolCall of step.toolCalls || []) {
      if (toolCall.dynamic) {
        continue;
      }

      if (isMutatingToolCall(toolCall, runtime)) {
        hasMutatingAction = true;
        pendingVerification = true;
        continue;
      }

      if (pendingVerification && isVerificationToolCall(toolCall)) {
        pendingVerification = false;
      }
    }
  }

  return {
    hasMutatingAction,
    pendingVerification,
  };
}

function getActiveTools(stepNumber, loopState, runtime) {
  const memoryToolNames = runtime.memoryToolNames || [];

  if (loopState.pendingVerification) {
    return ['readFile', 'bash', ...runtime.attachmentToolNames, ...memoryToolNames];
  }

  if (stepNumber === 0) {
    return ['skill', 'readFile', 'bash', ...runtime.attachmentToolNames, ...memoryToolNames];
  }

  return runtime.toolNames;
}

function getPhaseInstructions(stepNumber, loopState) {
  if (loopState.pendingVerification) {
    return 'Verification phase: use read-only checks now. Confirm the real machine state before producing the final answer. If verification fails, explain the issue plainly instead of pretending success.';
  }

  if (stepNumber === 0) {
    return 'Inspection phase: inspect the relevant machine state, files, and possible conflicts first. When attachments are present, decide the task before touching them. On the first step, do not inspect or read an attachment unless the task is already clear and file access is genuinely needed. If the task is still ambiguous, ask a clarifying question instead. Once file access is justified, prefer fewer, larger reads and keep searching before asking the user to restate details. Load skills when useful before making changes unless the task can be finished immediately.';
  }

  if (loopState.hasMutatingAction) {
    return 'Execution phase: continue only if more work is needed. Keep actions deliberate, avoid unnecessary disruption, and expect to verify again after the next mutating action.';
  }

  return 'Discovery phase: gather enough context about the request, the machine, and any shared-environment constraints, then either act or provide the final answer.';
}

function trimLoopMessages(stepMessages, contextSettings) {
  if (stepMessages.length <= contextSettings.loopMessageWindow) {
    return null;
  }

  return stepMessages.slice(-contextSettings.loopMessageWindow);
}

function createPrepareStep({ runtime, contextSettings, basePromptSections, toolChoice }) {
  return async ({ messages: stepMessages, stepNumber, steps }) => {
    const loopState = computeLoopState(steps, runtime);
    const activeTools = getActiveTools(stepNumber, loopState, runtime);
    const phaseInstructions = getPhaseInstructions(stepNumber, loopState);
    const trimmedMessages = trimLoopMessages(stepMessages, contextSettings);

    return {
      ...(trimmedMessages ? { messages: trimmedMessages } : {}),
      activeTools,
      toolChoice,
      system: `${buildSystemPrompt(basePromptSections)}\n\nCurrent phase\n${phaseInstructions}`,
    };
  };
}

function extractAssistantText(messages) {
  for (const message of [...(messages || [])].reverse()) {
    if (message.role !== 'assistant') {
      continue;
    }

    if (typeof message.content === 'string' && message.content.trim().length > 0) {
      return message.content;
    }

    if (!Array.isArray(message.content)) {
      continue;
    }

    const text = message.content
      .filter(part => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('');

    if (text.trim().length > 0) {
      return text;
    }
  }

  return '';
}

function buildFinalResponse(result) {
  return result.text || extractAssistantText(result.response?.messages) || '已处理完成。';
}

function extractToolErrorMessage(part) {
  if (!part || typeof part !== 'object') {
    return '';
  }

  const rawError = part.type === 'tool-error'
    ? part.error
    : part.output;

  if (typeof rawError === 'string' && rawError.trim().length > 0) {
    return rawError.trim();
  }

  if (rawError && typeof rawError === 'object') {
    if (rawError.type === 'error-text' && typeof rawError.value === 'string' && rawError.value.trim().length > 0) {
      return rawError.value.trim();
    }

    if (typeof rawError.error === 'string' && rawError.error.trim().length > 0) {
      return rawError.error.trim();
    }

    if (typeof rawError.message === 'string' && rawError.message.trim().length > 0) {
      return rawError.message.trim();
    }
  }

  return '';
}

function extractToolErrorSummaries(messages) {
  const summaries = [];
  const seen = new Set();

  for (const message of messages || []) {
    if (message?.role !== 'tool' || !Array.isArray(message.content)) {
      continue;
    }

    for (const part of message.content) {
      const isToolError = part?.type === 'tool-error'
        || (part?.type === 'tool-result' && part?.output?.type === 'error-text');

      if (!isToolError) {
        continue;
      }

      const toolName = typeof part.toolName === 'string' && part.toolName.trim().length > 0
        ? part.toolName.trim()
        : 'tool';
      const detail = extractToolErrorMessage(part);
      const summary = detail ? `${toolName}: ${detail}` : toolName;

      if (seen.has(summary)) {
        continue;
      }

      seen.add(summary);
      summaries.push(summary);
    }
  }

  return summaries;
}

function buildToolErrorContinuationPrompt(toolErrors) {
  const summaries = (toolErrors || []).slice(0, 3).map(item => `- ${item}`).join('\n');

  return [
    'One or more tool calls failed in the previous attempt.',
    summaries,
    'Do not claim the task succeeded.',
    'Fix the tool input and retry now if you can. Ask the user a direct question only if the missing information cannot be derived from the available context.',
  ].filter(Boolean).join('\n');
}

function hasAssistantTextMessage(messages) {
  return (messages || []).some(message => {
    if (message.role !== 'assistant') {
      return false;
    }

    if (typeof message.content === 'string') {
      return message.content.trim().length > 0;
    }

    if (!Array.isArray(message.content)) {
      return false;
    }

    return message.content.some(part => part?.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0);
  });
}

function createAssistantTextMessage(text) {
  return {
    role: 'assistant',
    content: text,
  };
}

function appendFinalAssistantMessageIfNeeded(fullMessages, responseMessages, finalResponse) {
  fullMessages.push(...responseMessages);

  if (!hasAssistantTextMessage(responseMessages)) {
    fullMessages.push(createAssistantTextMessage(finalResponse));
  }
}

module.exports = {
  appendFinalAssistantMessageIfNeeded,
  buildToolErrorContinuationPrompt,
  buildFinalResponse,
  buildSystemPrompt,
  createPrepareStep,
  extractToolErrorSummaries,
  getContextSettings,
  getToolChoiceSetting,
};
