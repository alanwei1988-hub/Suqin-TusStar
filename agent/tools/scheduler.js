const { tool } = require('ai');
const { z } = require('zod');
const { DEFAULT_TIMEZONE, WEEKDAY_NAMES } = require('../../scheduler/time');

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function buildSchedulerPrompt(schedulerRuntime) {
  if (!schedulerRuntime) {
    return '';
  }

  return [
    'Recurring tasks',
    'Use `createScheduleTask` when the user asks for daily or weekly automatic work such as recurring reports, contract summaries, or periodic file delivery.',
    'Write `taskPrompt` as a self-contained future instruction so the scheduled run can execute without asking what to do.',
    'Use `listScheduledTasks` when the user asks what recurring tasks already exist.',
    'Use `cancelScheduledTask` when the user wants to stop a recurring task.',
    `Default timezone: \`${schedulerRuntime.defaultTimeZone || DEFAULT_TIMEZONE}\`.`,
  ].join('\n');
}

function createScheduleTaskTool(schedulerRuntime) {
  return tool({
    description: [
      'Create a recurring task that will run automatically in the current chat.',
      'Use this for daily or weekly automatic reports, summaries, reminders, or recurring file delivery.',
      'The taskPrompt must be self-contained because the future run will use it without asking the user to restate the goal.',
    ].join(' '),
    inputSchema: z.object({
      title: z.string().min(1).describe('Short task title shown in task lists.'),
      taskPrompt: z.string().min(1).describe('Self-contained instruction for future scheduled runs.'),
      scheduleType: z.enum(['daily', 'weekly']).describe('Recurring schedule type.'),
      weekday: z.enum(WEEKDAY_NAMES).optional().describe('Required for weekly schedules.'),
      timeOfDay: z.string().regex(TIME_OF_DAY_PATTERN).describe('Target local execution time in HH:MM format.'),
      timeZone: z.string().optional().describe('Optional IANA timezone name. Defaults to the configured scheduler timezone.'),
    }),
    execute: async ({ title, taskPrompt, scheduleType, weekday, timeOfDay, timeZone }) => {
      const task = schedulerRuntime.createTask({
        title,
        prompt: taskPrompt,
        scheduleType,
        weekday,
        timeOfDay,
        timeZone,
      });

      return {
        success: true,
        task,
      };
    },
  });
}

function createListScheduledTasksTool(schedulerRuntime) {
  return tool({
    description: 'List recurring tasks that belong to the current user.',
    inputSchema: z.object({
      includeDisabled: z.boolean().optional().describe('Whether to include cancelled tasks. Defaults to true.'),
    }),
    execute: async ({ includeDisabled }) => ({
      success: true,
      tasks: schedulerRuntime.listTasks({
        includeDisabled: includeDisabled !== false,
      }),
    }),
  });
}

function createCancelScheduledTaskTool(schedulerRuntime) {
  return tool({
    description: 'Cancel a recurring task by task id.',
    inputSchema: z.object({
      taskId: z.string().min(1).describe('The task id returned by createScheduleTask or listScheduledTasks.'),
    }),
    execute: async ({ taskId }) => {
      const task = schedulerRuntime.cancelTask(taskId);

      if (!task) {
        throw new Error(`Scheduled task not found or not owned by the current user: ${taskId}`);
      }

      return {
        success: true,
        task,
      };
    },
  });
}

function createSchedulerTools(schedulerRuntime) {
  if (!schedulerRuntime) {
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
      createScheduleTask: createScheduleTaskTool(schedulerRuntime),
      listScheduledTasks: createListScheduledTasksTool(schedulerRuntime),
      cancelScheduledTask: createCancelScheduledTaskTool(schedulerRuntime),
    },
    prompt: buildSchedulerPrompt(schedulerRuntime),
    toolNames: ['createScheduleTask', 'listScheduledTasks', 'cancelScheduledTask'],
    readOnlyToolNames: ['listScheduledTasks'],
    toolDisplayByName: {
      createScheduleTask: {
        displayName: 'schedule create',
        statusText: 'create recurring task',
      },
      listScheduledTasks: {
        displayName: 'schedule list',
        statusText: 'list recurring tasks',
      },
      cancelScheduledTask: {
        displayName: 'schedule cancel',
        statusText: 'cancel recurring task',
      },
    },
  };
}

module.exports = {
  buildSchedulerPrompt,
  createSchedulerTools,
};
