const fs = require('fs/promises');
const path = require('path');
const matter = require('gray-matter');
const { tool } = require('ai');
const { z } = require('zod');
const { createToolDisplayInfo } = require('./display');

function normalizeSkillMetadata(content) {
  try {
    const { data } = matter(content);

    if (
      typeof data.name !== 'string' ||
      typeof data.description !== 'string' ||
      !data.name.trim() ||
      !data.description.trim()
    ) {
      return null;
    }

    return {
      name: data.name.trim(),
      description: data.description.trim(),
    };
  } catch {
    return null;
  }
}

function extractSkillBody(content) {
  try {
    const parsed = matter(content);
    return parsed.content.trim();
  } catch {
    return content.trim();
  }
}

async function listSkillFiles(skillDir) {
  const files = [];

  async function walk(currentDir, prefix = '') {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walk(path.join(currentDir, entry.name), relativePath);
        continue;
      }

      files.push(relativePath);
    }
  }

  try {
    await walk(skillDir);
  } catch {
    return [];
  }

  return files;
}

async function discoverSkills(skillsDir) {
  const resolvedSkillsDir = path.resolve(skillsDir);
  const skills = [];

  let entries = [];
  try {
    entries = await fs.readdir(resolvedSkillsDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Failed to read skills directory: ${resolvedSkillsDir}. ${error.message}`);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const localPath = path.join(resolvedSkillsDir, entry.name);
    const skillFilePath = path.join(localPath, 'SKILL.md');

    try {
      const content = await fs.readFile(skillFilePath, 'utf8');
      const metadata = normalizeSkillMetadata(content);

      if (!metadata) {
        continue;
      }

      skills.push({
        ...metadata,
        localPath,
        skillFilePath,
        files: await listSkillFiles(localPath),
      });
    } catch {
      // Ignore directories without a valid SKILL.md file.
    }
  }

  return skills;
}

function buildSkillToolDescription(skills) {
  const lines = [
    'Load a skill\'s instructions for role-specific guidance.',
    'Call this when the request clearly matches one of the listed skills.',
    '',
    'Available skills:',
  ];

  if (skills.length === 0) {
    lines.push('  (no skills found)');
  } else {
    for (const skill of skills) {
      lines.push(`  - skill(${JSON.stringify(skill.name)}): ${skill.description}`);
    }
  }

  return lines.join('\n');
}

function createSkillTool(skills) {
  const skillMap = new Map(skills.map(skill => [skill.name, skill]));

  return tool({
    description: buildSkillToolDescription(skills),
    inputSchema: z.object({
      skillName: z.string().describe('The name of the skill to load'),
    }),
    execute: async ({ skillName }) => {
      const skill = skillMap.get(skillName);

      if (!skill) {
        const availableNames = skills.map(item => item.name).join(', ');
        return {
          success: false,
          error: `Skill "${skillName}" not found. Available skills: ${availableNames || 'none'}`,
        };
      }

      try {
        const content = await fs.readFile(skill.skillFilePath, 'utf8');
        const instructions = extractSkillBody(content);
        const files = skill.files.filter(file => file !== 'SKILL.md');

        return {
          success: true,
          skill: {
            name: skill.name,
            description: skill.description,
            path: skill.localPath,
          },
          instructions,
          files,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to read skill "${skillName}": ${error.message}`,
        };
      }
    },
  });
}

async function createSkillsToolkit({ skillsDir }) {
  const skills = await discoverSkills(skillsDir);

  return {
    skills,
    skill: createSkillTool(skills),
    toolDisplayByName: {
      skill: createToolDisplayInfo('skill', {
        displayName: '技能加载',
        statusText: '加载处理技能',
      }),
    },
  };
}

async function listAvailableSkills({ skillsDir }) {
  return discoverSkills(skillsDir);
}

function buildSkillsPrompt(skills) {
  if (!skills || skills.length === 0) {
    return 'No skills are currently available.';
  }

  const lines = skills.map(
    skill => `- ${skill.name}: ${skill.description}`,
  );

  return [
    'Skills',
    'Use the `skill` tool when the task clearly matches one of these capabilities.',
    ...lines,
  ].join('\n');
}

module.exports = {
  buildSkillsPrompt,
  createSkillsToolkit,
  listAvailableSkills,
};
