const { tool } = require('ai');
const { z } = require('zod');

function buildTaskStateToolsPrompt(taskStateRuntime) {
  if (!taskStateRuntime) {
    return '';
  }

  return [
    'Ongoing task state',
    'Use `updateTaskState` to save the current work objective, confirmed constraints, current plan, next step, and latest artifact paths for multi-turn work.',
    'Use it when the user is drafting, revising, iterating on files, or continuing a project across turns.',
    'Use `listTaskStates` when the user asks what ongoing tasks already exist.',
    'Use `completeTaskState` when a task is finished or the user explicitly closes/cancels that workstream.',
  ].join('\n');
}

function createUpdateTaskStateTool(taskStateRuntime) {
  return tool({
    description: [
      'Create or update the current ongoing task state for this chat.',
      'Use this for multi-turn work such as drafting, revisions, project planning, or iterative deliverables.',
      'Store durable task progress so the user does not need to repeat the context next turn.',
    ].join(' '),
    inputSchema: z.object({
      reason: z.string().optional().describe('Why the current task state should be updated now.'),
      taskPatch: z.object({
        taskId: z.string().optional().describe('Optional existing task id to update. Omit to update the current active task or create a new one.'),
        forceNewTask: z.boolean().optional().describe('Whether to create a new task even if an active task already exists in this chat.'),
        markAsActive: z.boolean().optional().describe('Whether the updated task should remain the active task for this chat. Defaults to true.'),
        title: z.string().optional().describe('Short task title.'),
        objective: z.string().optional().describe('The concrete work objective.'),
        summary: z.string().optional().describe('Short status summary of current progress.'),
        latestUserRequest: z.string().optional().describe('The latest user instruction that changed the task direction.'),
        nextStep: z.string().optional().describe('The next action that should happen on this task.'),
        status: z.enum(['active', 'paused', 'completed', 'cancelled']).optional().describe('Current task status.'),
        currentPlan: z.array(z.string()).optional().describe('Compact list of current work items or plan steps.'),
        constraints: z.array(z.string()).optional().describe('Confirmed constraints, style requirements, or boundaries.'),
        artifacts: z.array(z.object({
          path: z.string().optional(),
          name: z.string().optional(),
          kind: z.string().optional(),
        })).optional().describe('Important task artifacts such as latest files or image outputs.'),
      }).describe('Direct task-state patch derived from the current conversation.'),
    }),
    execute: async ({ reason, taskPatch }) => taskStateRuntime.applyPatch({
      reason,
      patch: taskPatch,
    }),
  });
}

function createListTaskStatesTool(taskStateRuntime) {
  return tool({
    description: 'List recent task states for the current user and mark which one is active in this chat.',
    inputSchema: z.object({
      limit: z.number().int().min(1).max(10).optional().describe('Maximum number of tasks to return. Defaults to 5.'),
    }),
    execute: async ({ limit }) => ({
      success: true,
      tasks: taskStateRuntime.listTasks({ limit }),
    }),
  });
}

function createCompleteTaskStateTool(taskStateRuntime) {
  return tool({
    description: 'Mark a task as completed or cancelled so it no longer stays active in this chat.',
    inputSchema: z.object({
      taskId: z.string().optional().describe('Optional task id. Omit to close the current active task.'),
      status: z.enum(['completed', 'cancelled']).optional().describe('Completion status. Defaults to completed.'),
      summary: z.string().optional().describe('Optional closing summary for the task.'),
      nextStep: z.string().optional().describe('Optional follow-up suggestion to preserve before closing the task.'),
    }),
    execute: async ({ taskId, status, summary, nextStep }) => taskStateRuntime.applyPatch({
      reason: 'Closing the current ongoing task.',
      patch: {
        ...(taskId ? { taskId } : {}),
        status: status || 'completed',
        ...(summary ? { summary } : {}),
        ...(nextStep ? { nextStep } : {}),
      },
    }),
  });
}

function createTaskStateTools(taskStateRuntime) {
  if (!taskStateRuntime) {
    return {
      tools: {},
      prompt: '',
      toolNames: [],
      readOnlyToolNames: [],
      toolDisplayByName: {},
    };
  }

  return {
    tools: {
      updateTaskState: createUpdateTaskStateTool(taskStateRuntime),
      listTaskStates: createListTaskStatesTool(taskStateRuntime),
      completeTaskState: createCompleteTaskStateTool(taskStateRuntime),
    },
    prompt: buildTaskStateToolsPrompt(taskStateRuntime),
    toolNames: ['updateTaskState', 'listTaskStates', 'completeTaskState'],
    readOnlyToolNames: ['listTaskStates'],
    toolDisplayByName: {
      updateTaskState: {
        displayName: 'task update',
        statusText: 'update task state',
      },
      listTaskStates: {
        displayName: 'task list',
        statusText: 'list task states',
      },
      completeTaskState: {
        displayName: 'task complete',
        statusText: 'complete task state',
      },
    },
  };
}

module.exports = {
  buildTaskStateToolsPrompt,
  createTaskStateTools,
};
