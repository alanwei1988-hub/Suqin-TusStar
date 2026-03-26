const fs = require('fs');
const path = require('path');
const { generateText } = require('ai');

const DEFAULT_REFLECTION_INTERVAL_TURNS = 20;
const DEFAULT_MEMORY_DIALOGUE_LIMIT = 8;
const MAX_NOTES = 8;
const MAX_NOTE_LENGTH = 200;

function nowIsoString() {
  return new Date().toISOString();
}

function createEmptyMemory() {
  return {
    version: 1,
    profile: {
      realName: '',
      realNameSource: '',
      realNameUpdatedAt: '',
      awaitingRealNameReply: false,
    },
    notes: [],
    stats: {
      userTurnCount: 0,
      lastReflectionTurnCount: 0,
      lastUserMessageAt: '',
      lastAssistantMessageAt: '',
      realNameAskedCount: 0,
      lastAskedRealNameAt: '',
    },
  };
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNote(note) {
  const text = normalizeString(note?.text);

  if (!text) {
    return null;
  }

  return {
    text: text.slice(0, MAX_NOTE_LENGTH),
    kind: normalizeString(note?.kind) || 'general',
    trigger: normalizeString(note?.trigger),
    updatedAt: normalizeString(note?.updatedAt) || nowIsoString(),
  };
}

function normalizeMemory(rawMemory) {
  const memory = rawMemory && typeof rawMemory === 'object' && !Array.isArray(rawMemory)
    ? rawMemory
    : {};
  const profile = memory.profile && typeof memory.profile === 'object' && !Array.isArray(memory.profile)
    ? memory.profile
    : {};
  const stats = memory.stats && typeof memory.stats === 'object' && !Array.isArray(memory.stats)
    ? memory.stats
    : {};
  const notes = Array.isArray(memory.notes)
    ? memory.notes.map(normalizeNote).filter(Boolean).slice(-MAX_NOTES)
    : [];

  return {
    version: 1,
    profile: {
      realName: normalizeString(profile.realName).slice(0, 40),
      realNameSource: normalizeString(profile.realNameSource).slice(0, 80),
      realNameUpdatedAt: normalizeString(profile.realNameUpdatedAt),
      awaitingRealNameReply: profile.awaitingRealNameReply === true,
    },
    notes,
    stats: {
      userTurnCount: Number.isFinite(stats.userTurnCount) ? Math.max(0, Math.trunc(stats.userTurnCount)) : 0,
      lastReflectionTurnCount: Number.isFinite(stats.lastReflectionTurnCount)
        ? Math.max(0, Math.trunc(stats.lastReflectionTurnCount))
        : 0,
      lastUserMessageAt: normalizeString(stats.lastUserMessageAt),
      lastAssistantMessageAt: normalizeString(stats.lastAssistantMessageAt),
      realNameAskedCount: Number.isFinite(stats.realNameAskedCount) ? Math.max(0, Math.trunc(stats.realNameAskedCount)) : 0,
      lastAskedRealNameAt: normalizeString(stats.lastAskedRealNameAt),
    },
  };
}

function extractTextFromContentPart(part) {
  if (!part) {
    return '';
  }

  if (typeof part === 'string') {
    return part;
  }

  if (part.type === 'text' && typeof part.text === 'string') {
    return part.text;
  }

  return '';
}

function extractMessageText(message) {
  if (!message) {
    return '';
  }

  if (typeof message.content === 'string') {
    return normalizeString(message.content);
  }

  if (!Array.isArray(message.content)) {
    return '';
  }

  return normalizeString(
    message.content
      .map(extractTextFromContentPart)
      .filter(Boolean)
      .join(' '),
  );
}

function sanitizeConversationMessages(messages = [], limit = DEFAULT_MEMORY_DIALOGUE_LIMIT) {
  return messages
    .filter(message => message && (message.role === 'user' || message.role === 'assistant'))
    .map(message => ({
      role: message.role,
      content: extractMessageText(message),
    }))
    .filter(message => message.content)
    .slice(-Math.max(1, Math.trunc(limit)));
}

function buildMemoryPrompt(memory, options = {}) {
  const normalized = normalizeMemory(memory);
  const lines = ['User Memory'];
  const userId = normalizeString(options.userId);
  const realName = normalized.profile.realName;

  if (userId) {
    lines.push(`- Stable channel user id: ${userId}`);
  }

  if (realName) {
    lines.push(`- Remembered real name: ${realName}`);
    lines.push('- When handling contracts, operator fields, or other formal records, prefer this real name unless the user explicitly asks for a different display name.');
  } else if (normalized.profile.awaitingRealNameReply) {
    lines.push('- The assistant has already asked the user how they should be addressed and is waiting for the answer. Avoid asking again until the user responds.');
  } else {
    lines.push('- The user real name is currently unknown. If it becomes useful and natural, you may ask once and then call `updateMemory` with a direct patch.');
  }

  if (normalized.notes.length > 0) {
    lines.push('- Long-term notes:');

    for (const note of normalized.notes.slice(-4)) {
      lines.push(`  - ${note.text}`);
    }
  }

  return lines.join('\n');
}

function parseJsonObject(text) {
  const source = normalizeString(text);

  if (!source) {
    throw new Error('Memory model returned empty text.');
  }

  const fencedMatch = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : source;
  return JSON.parse(candidate);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function mergeMemoryWithPatch(currentMemory, patchMemory) {
  const current = normalizeMemory(currentMemory);
  const next = normalizeMemory(current);
  const patch = patchMemory && typeof patchMemory === 'object' && !Array.isArray(patchMemory)
    ? patchMemory
    : {};
  const profilePatch = patch.profile && typeof patch.profile === 'object' && !Array.isArray(patch.profile)
    ? patch.profile
    : {};
  const nextRealName = normalizeString(profilePatch.realName);

  if (hasOwn(profilePatch, 'realName') && nextRealName) {
    const currentRealName = normalizeString(current.profile.realName);
    next.profile.realName = nextRealName;
    next.profile.realNameSource = normalizeString(profilePatch.realNameSource) || 'memory_patch';
    next.profile.awaitingRealNameReply = false;

    if (nextRealName !== currentRealName) {
      next.profile.realNameUpdatedAt = nowIsoString();
    } else {
      next.profile.realNameUpdatedAt = current.profile.realNameUpdatedAt || nowIsoString();
    }
  } else if (hasOwn(profilePatch, 'awaitingRealNameReply')) {
    next.profile.awaitingRealNameReply = profilePatch.awaitingRealNameReply === true;
  }

  if (Array.isArray(patch.notes)) {
    next.notes = patch.notes.map(normalizeNote).filter(Boolean).slice(-MAX_NOTES);
  } else {
    next.notes = current.notes.slice(-MAX_NOTES);
  }

  next.stats = current.stats;

  return next;
}

function memoryContentEquals(left, right) {
  const normalizedLeft = normalizeMemory(left);
  const normalizedRight = normalizeMemory(right);

  return JSON.stringify({
    profile: normalizedLeft.profile,
    notes: normalizedLeft.notes,
  }) === JSON.stringify({
    profile: normalizedRight.profile,
    notes: normalizedRight.notes,
  });
}

function buildMemoryUpdateSystemPrompt() {
  return [
    'You update long-term user memory for a multi-user workplace assistant.',
    'Return JSON only.',
    'Be conservative: keep only stable identity, naming preference, long-term collaboration preferences, and durable correction instructions.',
    'Do not store one-off tasks, transient emotions, temporary files, or short-lived scheduling details.',
    'Use only the supplied old memory and dialogue slice.',
    'If evidence is weak, preserve the old memory instead of guessing.',
    'Set `awaitingRealNameReply` to true only when the assistant has explicitly asked how to address the user and the user has not answered yet.',
    'If the user has clearly provided their real name, set `realName`, set a useful `realNameSource`, and set `awaitingRealNameReply` to false.',
    'Keep notes short, concrete, and reusable in future turns.',
    'Output schema:',
    '{"shouldUpdate":boolean,"memory":{"profile":{"realName":"","realNameSource":"","awaitingRealNameReply":false},"notes":[{"text":"","kind":"","trigger":""}]},"changeSummary":""}',
  ].join('\n');
}

function buildMemoryUpdatePrompt({ userId, currentMemory, dialogueMessages, reason, trigger }) {
  return [
    `User ID: ${normalizeString(userId) || 'unknown'}`,
    `Trigger: ${normalizeString(trigger) || 'unspecified'}`,
    `Reason: ${normalizeString(reason) || 'none'}`,
    'Current memory JSON:',
    JSON.stringify({
      profile: currentMemory.profile,
      notes: currentMemory.notes,
    }, null, 2),
    'Recent dialogue JSON (tool messages removed):',
    JSON.stringify(dialogueMessages, null, 2),
    'Decide whether the memory should change now. Preserve existing values when no strong evidence exists.',
  ].join('\n\n');
}

class MemoryManager {
  constructor(filePath, options = {}) {
    this.filePath = path.resolve(filePath);
    this.reflectionIntervalTurns = Number.isFinite(options.reflectionIntervalTurns)
      ? Math.max(1, Math.trunc(options.reflectionIntervalTurns))
      : DEFAULT_REFLECTION_INTERVAL_TURNS;
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return normalizeMemory(JSON.parse(raw));
    } catch {
      return createEmptyMemory();
    }
  }

  save(memory) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(normalizeMemory(memory), null, 2), 'utf8');
  }

  prepareForTurn({ userMessage }) {
    const memory = this.load();
    memory.stats.userTurnCount += 1;
    memory.stats.lastUserMessageAt = nowIsoString();
    this.save(memory);

    return {
      memory,
      shouldTriggerAsyncReflection: memory.stats.userTurnCount > 0
        && memory.stats.userTurnCount % this.reflectionIntervalTurns === 0
        && memory.stats.userTurnCount > memory.stats.lastReflectionTurnCount,
    };
  }

  finalizeTurn() {
    const memory = this.load();
    memory.stats.lastAssistantMessageAt = nowIsoString();
    this.save(memory);
    return memory;
  }

  async updateWithLlm({
    model,
    providerOptions,
    userId,
    conversationMessages = [],
    reason = '',
    trigger = 'tool_call',
    dialogueLimit = DEFAULT_MEMORY_DIALOGUE_LIMIT,
  }) {
    const currentMemory = this.load();
    const dialogueMessages = sanitizeConversationMessages(conversationMessages, dialogueLimit);
    const result = await generateText({
      model,
      providerOptions,
      system: buildMemoryUpdateSystemPrompt(),
      prompt: buildMemoryUpdatePrompt({
        userId,
        currentMemory,
        dialogueMessages,
        reason,
        trigger,
      }),
    });
    const parsed = parseJsonObject(result.text);
    const nextMemory = mergeMemoryWithPatch(currentMemory, parsed?.memory || {});
    const changed = parsed?.shouldUpdate === true && !memoryContentEquals(currentMemory, nextMemory);

    if (changed) {
      this.save(nextMemory);
    }

    return {
      changed,
      trigger,
      changeSummary: normalizeString(parsed?.changeSummary) || (changed ? 'Memory updated.' : 'No durable memory change.'),
      memory: changed ? nextMemory : currentMemory,
      dialogueMessages,
    };
  }

  applyPatch({
    patch,
    reason = '',
    trigger = 'tool_call',
  }) {
    const currentMemory = this.load();
    const nextMemory = mergeMemoryWithPatch(currentMemory, patch);
    const changed = !memoryContentEquals(currentMemory, nextMemory);

    if (changed) {
      this.save(nextMemory);
    }

    return {
      changed,
      trigger,
      changeSummary: normalizeString(reason) || (changed ? 'Memory updated from direct patch.' : 'No durable memory change.'),
      memory: changed ? nextMemory : currentMemory,
    };
  }

  triggerReflectionAsync({
    model,
    providerOptions,
    userId,
    conversationMessages = [],
    dialogueLimit = DEFAULT_MEMORY_DIALOGUE_LIMIT,
  }) {
    const currentMemory = this.load();
    const shouldReflect = currentMemory.stats.userTurnCount > 0
      && currentMemory.stats.userTurnCount % this.reflectionIntervalTurns === 0
      && currentMemory.stats.userTurnCount > currentMemory.stats.lastReflectionTurnCount;

    if (!shouldReflect) {
      return;
    }

    setImmediate(async () => {
      try {
        await this.updateWithLlm({
          model,
          providerOptions,
          userId,
          conversationMessages,
          reason: 'Periodic memory reflection after the configured dialogue threshold.',
          trigger: 'threshold_reflection',
          dialogueLimit,
        });
        const latestMemory = this.load();
        latestMemory.stats.lastReflectionTurnCount = Math.max(
          latestMemory.stats.lastReflectionTurnCount,
          latestMemory.stats.userTurnCount,
        );
        this.save(latestMemory);
      } catch (error) {
        console.error('[Memory] Reflection failed:', error);
      }
    });
  }
}

module.exports = {
  MemoryManager,
  buildMemoryPrompt,
  createEmptyMemory,
  normalizeMemory,
  sanitizeConversationMessages,
};
