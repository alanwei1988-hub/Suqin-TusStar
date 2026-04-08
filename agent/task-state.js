const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_TASKS = 24;
const MAX_LIST_ITEMS = 8;
const MAX_TITLE_LENGTH = 80;
const MAX_TEXT_LENGTH = 240;

function nowIsoString() {
  return new Date().toISOString();
}

function normalizeString(value, maxLength = MAX_TEXT_LENGTH) {
  return typeof value === 'string'
    ? value.trim().slice(0, maxLength)
    : '';
}

function normalizeStringList(values = [], maxItems = MAX_LIST_ITEMS, maxLength = MAX_TEXT_LENGTH) {
  const normalized = [];
  const seen = new Set();

  for (const value of Array.isArray(values) ? values : []) {
    const item = normalizeString(value, maxLength);

    if (!item || seen.has(item)) {
      continue;
    }

    seen.add(item);
    normalized.push(item);

    if (normalized.length >= maxItems) {
      break;
    }
  }

  return normalized;
}

function normalizeArtifact(artifact = {}) {
  const pathValue = normalizeString(artifact?.path, 400);
  const name = normalizeString(artifact?.name, 120);

  if (!pathValue && !name) {
    return null;
  }

  return {
    path: pathValue,
    name: name || path.basename(pathValue || 'artifact'),
    kind: normalizeString(artifact?.kind, 40) || 'file',
    updatedAt: normalizeString(artifact?.updatedAt, 80) || nowIsoString(),
  };
}

function mergeArtifacts(existingArtifacts = [], nextArtifacts = []) {
  const merged = [];
  const seen = new Set();

  for (const artifact of [...existingArtifacts, ...nextArtifacts]) {
    const normalized = normalizeArtifact(artifact);

    if (!normalized) {
      continue;
    }

    const identityKey = `${normalized.path}::${normalized.name}`;

    if (seen.has(identityKey)) {
      continue;
    }

    seen.add(identityKey);
    merged.push(normalized);

    if (merged.length >= MAX_LIST_ITEMS) {
      break;
    }
  }

  return merged;
}

function normalizeStatus(status) {
  const normalized = normalizeString(status, 20).toLowerCase();
  return ['active', 'paused', 'completed', 'cancelled'].includes(normalized)
    ? normalized
    : 'active';
}

function createEmptyTaskState() {
  return {
    version: 1,
    activeTaskByChat: {},
    tasks: [],
  };
}

function buildChatKey({ chatId = '', chatType = 1, userId = '' } = {}) {
  return `${Number.isFinite(chatType) ? chatType : 1}:${normalizeString(chatId || userId, 120) || 'default'}`;
}

function normalizeTask(task = {}) {
  const id = normalizeString(task?.id, 80);

  if (!id) {
    return null;
  }

  return {
    id,
    userId: normalizeString(task?.userId, 120),
    chatId: normalizeString(task?.chatId, 120),
    chatType: Number.isFinite(task?.chatType) ? Math.max(1, Math.trunc(task.chatType)) : 1,
    title: normalizeString(task?.title, MAX_TITLE_LENGTH),
    objective: normalizeString(task?.objective),
    summary: normalizeString(task?.summary),
    status: normalizeStatus(task?.status),
    currentPlan: normalizeStringList(task?.currentPlan),
    constraints: normalizeStringList(task?.constraints),
    latestUserRequest: normalizeString(task?.latestUserRequest),
    nextStep: normalizeString(task?.nextStep),
    artifacts: mergeArtifacts([], task?.artifacts),
    createdAt: normalizeString(task?.createdAt, 80) || nowIsoString(),
    updatedAt: normalizeString(task?.updatedAt, 80) || nowIsoString(),
    activatedAt: normalizeString(task?.activatedAt, 80) || '',
    completedAt: normalizeString(task?.completedAt, 80) || '',
  };
}

function normalizeTaskState(rawState) {
  const state = rawState && typeof rawState === 'object' && !Array.isArray(rawState)
    ? rawState
    : {};
  const tasks = Array.isArray(state.tasks)
    ? state.tasks.map(normalizeTask).filter(Boolean).slice(-MAX_TASKS)
    : [];
  const taskIds = new Set(tasks.map(task => task.id));
  const activeTaskByChat = state.activeTaskByChat && typeof state.activeTaskByChat === 'object' && !Array.isArray(state.activeTaskByChat)
    ? Object.fromEntries(
      Object.entries(state.activeTaskByChat)
        .map(([chatKey, taskId]) => [normalizeString(chatKey, 160), normalizeString(taskId, 80)])
        .filter(([chatKey, taskId]) => chatKey && taskId && taskIds.has(taskId)),
    )
    : {};

  return {
    version: 1,
    activeTaskByChat,
    tasks,
  };
}

function buildTaskStatePrompt(task = null) {
  const lines = [
    'Task state',
    '- Use `updateTaskState` for ongoing work that may continue across turns, such as drafting, revisions, deliverables, and multi-step projects.',
    '- Store the current objective, constraints, current plan, next step, and key artifact paths so the user does not need to repeat them.',
    '- When the user clearly starts a different workstream, create a new task state instead of overwriting the current one.',
  ];

  if (!task) {
    return lines.join('\n');
  }

  lines.push('- Active task is available below. Reuse it before asking the user to restate previous context.');
  lines.push(`- Active task id: ${task.id}`);

  if (task.title) {
    lines.push(`- Title: ${task.title}`);
  }

  lines.push(`- Status: ${task.status}`);

  if (task.objective) {
    lines.push(`- Objective: ${task.objective}`);
  }

  if (task.summary) {
    lines.push(`- Summary: ${task.summary}`);
  }

  if (task.latestUserRequest) {
    lines.push(`- Latest user request: ${task.latestUserRequest}`);
  }

  if (task.constraints.length > 0) {
    lines.push('- Constraints:');
    for (const item of task.constraints) {
      lines.push(`  - ${item}`);
    }
  }

  if (task.currentPlan.length > 0) {
    lines.push('- Current plan:');
    for (const item of task.currentPlan) {
      lines.push(`  - ${item}`);
    }
  }

  if (task.artifacts.length > 0) {
    lines.push('- Key artifacts:');
    for (const artifact of task.artifacts) {
      lines.push(`  - ${artifact.name || 'artifact'} | ${artifact.path || 'no-path'} | kind=${artifact.kind}`);
    }
  }

  if (task.nextStep) {
    lines.push(`- Next step: ${task.nextStep}`);
  }

  return lines.join('\n');
}

function taskStateEquals(left, right) {
  return JSON.stringify(normalizeTaskState(left)) === JSON.stringify(normalizeTaskState(right));
}

class TaskStateManager {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return normalizeTaskState(JSON.parse(raw));
    } catch {
      return createEmptyTaskState();
    }
  }

  save(state) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(normalizeTaskState(state), null, 2), 'utf8');
  }

  getTaskById(taskId) {
    const normalizedTaskId = normalizeString(taskId, 80);

    if (!normalizedTaskId) {
      return null;
    }

    return this.load().tasks.find(task => task.id === normalizedTaskId) || null;
  }

  getActiveTask({ chatId = '', chatType = 1, userId = '' } = {}) {
    const state = this.load();
    const chatKey = buildChatKey({ chatId, chatType, userId });
    const activeTaskId = state.activeTaskByChat[chatKey];

    if (!activeTaskId) {
      return null;
    }

    return state.tasks.find(task => task.id === activeTaskId) || null;
  }

  listTasks({ chatId = '', chatType = 1, userId = '', limit = 5 } = {}) {
    const normalizedLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(10, Math.trunc(limit)))
      : 5;
    const chatKey = buildChatKey({ chatId, chatType, userId });
    const activeTaskId = this.load().activeTaskByChat[chatKey];

    return this.load().tasks
      .filter(task => task.userId === normalizeString(userId, 120))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, normalizedLimit)
      .map(task => ({
        ...task,
        isActiveInCurrentChat: task.id === activeTaskId,
      }));
  }

  applyPatch({
    userId,
    chatId = '',
    chatType = 1,
    patch = {},
    reason = '',
    trigger = 'tool_call',
  }) {
    const currentState = this.load();
    const nextState = normalizeTaskState(currentState);
    const chatKey = buildChatKey({ chatId, chatType, userId });
    const normalizedPatch = patch && typeof patch === 'object' && !Array.isArray(patch)
      ? patch
      : {};
    const requestedTaskId = normalizeString(normalizedPatch.taskId, 80);
    const forceNewTask = normalizedPatch.forceNewTask === true;
    const markAsActive = normalizedPatch.markAsActive !== false;
    const now = nowIsoString();

    let task = requestedTaskId
      ? nextState.tasks.find(item => item.id === requestedTaskId)
      : null;

    if (!task && !forceNewTask) {
      const activeTaskId = nextState.activeTaskByChat[chatKey];
      task = activeTaskId
        ? nextState.tasks.find(item => item.id === activeTaskId)
        : null;
    }

    if (!task) {
      task = normalizeTask({
        id: `task-${crypto.randomUUID()}`,
        userId,
        chatId,
        chatType,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        activatedAt: now,
      });
      nextState.tasks.push(task);
    }

    task.userId = normalizeString(userId, 120) || task.userId;
    task.chatId = normalizeString(chatId, 120) || task.chatId;
    task.chatType = Number.isFinite(chatType) ? Math.max(1, Math.trunc(chatType)) : task.chatType;

    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'title')) {
      task.title = normalizeString(normalizedPatch.title, MAX_TITLE_LENGTH) || task.title;
    }

    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'objective')) {
      task.objective = normalizeString(normalizedPatch.objective) || task.objective;
    }

    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'summary')) {
      task.summary = normalizeString(normalizedPatch.summary) || task.summary;
    }

    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'latestUserRequest')) {
      task.latestUserRequest = normalizeString(normalizedPatch.latestUserRequest) || task.latestUserRequest;
    }

    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'nextStep')) {
      task.nextStep = normalizeString(normalizedPatch.nextStep) || task.nextStep;
    }

    if (Array.isArray(normalizedPatch.currentPlan)) {
      task.currentPlan = normalizeStringList(normalizedPatch.currentPlan);
    }

    if (Array.isArray(normalizedPatch.constraints)) {
      task.constraints = normalizeStringList(normalizedPatch.constraints);
    }

    if (Array.isArray(normalizedPatch.artifacts)) {
      task.artifacts = mergeArtifacts(task.artifacts, normalizedPatch.artifacts);
    }

    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'status')) {
      task.status = normalizeStatus(normalizedPatch.status);
    }

    task.updatedAt = now;

    if (task.status === 'completed' || task.status === 'cancelled') {
      task.completedAt = now;
      if (nextState.activeTaskByChat[chatKey] === task.id) {
        delete nextState.activeTaskByChat[chatKey];
      }
    } else if (markAsActive) {
      nextState.activeTaskByChat[chatKey] = task.id;
      task.activatedAt = now;
    }

    nextState.tasks = nextState.tasks
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, MAX_TASKS);

    const changed = !taskStateEquals(currentState, nextState);

    if (changed) {
      this.save(nextState);
    }

    return {
      changed,
      trigger,
      task,
      activeTask: this.getActiveTask({ chatId, chatType, userId }),
      changeSummary: normalizeString(reason) || (changed ? 'Task state updated.' : 'No task state change.'),
    };
  }

  recordArtifacts({ userId, chatId = '', chatType = 1, attachments = [] } = {}) {
    const currentTask = this.getActiveTask({ userId, chatId, chatType });

    if (!currentTask || !Array.isArray(attachments) || attachments.length === 0) {
      return {
        changed: false,
        task: currentTask,
      };
    }

    return this.applyPatch({
      userId,
      chatId,
      chatType,
      patch: {
        taskId: currentTask.id,
        artifacts: attachments.map(attachment => ({
          path: attachment?.path,
          name: attachment?.name,
          kind: attachment?.kind,
        })),
        markAsActive: true,
      },
      reason: 'Recorded generated artifacts for the active task.',
      trigger: 'artifact_record',
    });
  }
}

module.exports = {
  TaskStateManager,
  buildTaskStatePrompt,
  buildChatKey,
  createEmptyTaskState,
  normalizeTaskState,
};
