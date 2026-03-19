const { generateText } = require('ai');
const { createOpenAI } = require('@ai-sdk/openai');
const { createTools, discoverSkills } = require('./tools');
const SessionManager = require('./session');

/**
 * AgentCore - 纯粹的通用 AI 大脑，通过配置初始化
 */
class AgentCore {
  constructor(config) {
    this.config = config;
    this.openai = createOpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseURL,
    });
    this.sessionManager = new SessionManager(config.sessionDb);
    this.skills = [];
  }

  async init() {
    this.skills = await discoverSkills(this.config.skillsDir);
    console.log(`[Agent] Loaded ${this.skills.length} skills: ${this.skills.map(s => s.name).join(', ')}`);
  }

  buildSystemPrompt() {
    const skillsList = this.skills
      .map(s => `- ${s.name}: ${s.description}`)
      .join('\n');

    return `
You are a proactive and capable AI Employee. You solve tasks by using your tools and can load specialized skills when needed.

## Core Rules
1. **Tool Usage**: Use your base tools to explore the workspace and handle general requests.
2. **Specialized Skills**: If a task matches an available skill, you can use \`loadSkill\` to get additional instructions.
3. **FileSystem**: You have access to your workspace via \`listDir\`, \`readFile\`, and \`bash\`.
4. **Autonomy**: When you receive a file, examine it and determine the appropriate action.
5. **Transparency**: Briefly mention which tool or skill you are using if it helps the user follow your process.

## Available Skills
${skillsList || 'No specialized skills available currently.'}

## Base Tools
- \`listDir\`: List files in a directory.
- \`readFile\`: Read the content of a file.
- \`bash\`: Execute terminal commands (mv, cp, python, etc.).
- \`loadSkill\`: Load specialized instructions for a specific domain.
`;
  }

  async chat(userId, userMessage, attachments = [], onStepFinish) {
    const messages = this.sessionManager.getMessages(userId);
    
    let content = userMessage;
    if (attachments && attachments.length > 0) {
      const attachmentInfo = attachments.map(a => `[File: ${a.name}, Path: ${a.path}]`).join('\n');
      content = `${userMessage}\n\nI have provided the following file(s) for your reference:\n${attachmentInfo}`;
    }
    
    messages.push({ role: 'user', content });

    const tools = createTools(this.skills);

    const result = await generateText({
      model: this.openai(this.config.model),
      system: this.buildSystemPrompt(),
      messages,
      tools,
      maxSteps: 10,
      onStepFinish: (step) => {
        if (onStepFinish) onStepFinish(step);
      }
    });

    messages.push({ role: 'assistant', content: result.text });
    this.sessionManager.saveMessages(userId, messages);

    return result.text;
  }
}

module.exports = AgentCore;
