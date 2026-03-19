const { tool } = require('ai');
const { z } = require('zod');
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');

function runCommand(command, cwd) {
  const isWindows = process.platform === 'win32';
  const file = isWindows ? 'powershell.exe' : '/bin/sh';
  const args = isWindows
    ? ['-NoProfile', '-NonInteractive', '-Command', command]
    : ['-c', command];

  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

class Sandbox {
  constructor(workDir = process.cwd()) {
    this.workDir = workDir;
  }

  async readFile(filePath, encoding = 'utf-8') {
    const fullPath = path.resolve(this.workDir, filePath);
    if (!fullPath.startsWith(this.workDir)) {
      throw new Error('Access denied: path outside working directory');
    }
    return fs.readFile(fullPath, encoding);
  }

  async readdir(dirPath) {
    const fullPath = path.resolve(this.workDir, dirPath);
    if (!fullPath.startsWith(this.workDir)) {
      throw new Error('Access denied: path outside working directory');
    }
    return fs.readdir(fullPath, { withFileTypes: true });
  }

  async exec(command) {
    // Basic safety: avoid some dangerous characters/commands
    // In a real production app, this should be much more robust (e.g., containerized)
    if (command.includes('rm -rf /') || command.includes('del /s /q c:')) {
      throw new Error('Dangerous command blocked');
    }
    try {
      const { stdout, stderr } = await runCommand(command, this.workDir);
      return { stdout, stderr, code: 0 };
    } catch (error) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        code: typeof error.code === 'number' ? error.code : 1,
        failed: true,
      };
    }
  }
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) return null;
  const frontmatter = {};
  match[1].split('\n').forEach(line => {
    const [key, ...val] = line.split(':');
    if (key && val.length) {
      frontmatter[key.trim()] = val.join(':').trim();
    }
  });
  return frontmatter;
}

function stripFrontmatter(content) {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? content.slice(match[0].length).trim() : content.trim();
}

const sandbox = new Sandbox();

const createTools = (skills) => ({
  loadSkill: tool({
    description: 'Load a skill to get specialized instructions',
    parameters: z.object({
      name: z.string().describe('The skill name to load'),
    }),
    execute: async ({ name }) => {
      const skill = skills.find(s => s.name.toLowerCase() === name.toLowerCase());
      if (!skill) {
        return { error: `Skill '${name}' not found` };
      }

      const skillFile = path.join(skill.path, 'SKILL.md');
      const content = await sandbox.readFile(skillFile);
      const body = stripFrontmatter(content);

      return {
        skillDirectory: skill.path,
        instructions: body,
      };
    },
  }),

  readFile: tool({
    description: 'Read a file from the filesystem',
    parameters: z.object({
      path: z.string().describe('The path to the file to read'),
    }),
    execute: async ({ path: filePath }) => {
      return sandbox.readFile(filePath);
    },
  }),

  listDir: tool({
    description: 'List contents of a directory',
    parameters: z.object({
      path: z.string().describe('The path to the directory to list'),
    }),
    execute: async ({ path: dirPath }) => {
      const entries = await sandbox.readdir(dirPath);
      return entries.map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`);
    },
  }),

  bash: tool({
    description: 'Execute a terminal command. On Windows this runs in PowerShell; on Unix-like systems it runs in sh.',
    parameters: z.object({
      command: z.string().describe('The command to execute'),
    }),
    execute: async ({ command }) => {
      return sandbox.exec(command);
    },
  }),
});

async function discoverSkills(skillsDir = 'skills') {
  const skills = [];
  const entries = await sandbox.readdir(skillsDir);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillPath = path.join(skillsDir, entry.name);
    const skillFile = path.join(skillPath, 'SKILL.md');

    try {
      const content = await sandbox.readFile(skillFile);
      const frontmatter = parseFrontmatter(content);

      if (frontmatter && frontmatter.name) {
        skills.push({
          name: frontmatter.name,
          description: frontmatter.description || '',
          path: skillPath,
        });
      }
    } catch (err) {
      // Skip skills without valid SKILL.md
    }
  }
  return skills;
}

module.exports = { createTools, discoverSkills, sandbox };
