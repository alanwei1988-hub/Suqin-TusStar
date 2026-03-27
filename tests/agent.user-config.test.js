const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadRolePrompt } = require('../agent/roles');
const { listAvailableSkills } = require('../agent/tools/skills');
const { resolveUserAgentConfig } = require('../agent/user-config');
const { makeTempDir } = require('./helpers/test-helpers');

module.exports = async function runAgentUserConfigTest() {
  const rootDir = makeTempDir('agent-user-config-');
  const globalSkillsDir = path.join(rootDir, 'skills');
  const globalRolesDir = path.join(rootDir, 'roles');
  const userRootDir = path.join(rootDir, 'users');

  fs.mkdirSync(path.join(globalSkillsDir, 'shared-skill'), { recursive: true });
  fs.writeFileSync(path.join(globalSkillsDir, 'shared-skill', 'SKILL.md'), `---
name: shared-skill
description: global description
---
global skill body
`, 'utf8');
  fs.mkdirSync(globalRolesDir, { recursive: true });
  fs.writeFileSync(path.join(globalRolesDir, '01-role.md'), 'global role prompt', 'utf8');
  fs.writeFileSync(path.join(globalRolesDir, '02-global.md'), 'global fallback prompt', 'utf8');

  const userConfig = {
    agent: {
      model: 'user-model',
      openai: {
        baseURL: 'http://user.example.invalid/v1',
      },
      sessionDb: './data/user-sessions.db',
    },
  };
  const userConfigDir = path.join(userRootDir, encodeURIComponent('u/1'));
  fs.mkdirSync(path.join(userConfigDir, 'skills', 'shared-skill'), { recursive: true });
  fs.mkdirSync(path.join(userConfigDir, 'roles'), { recursive: true });
  fs.writeFileSync(path.join(userConfigDir, 'config.json'), JSON.stringify(userConfig, null, 2), 'utf8');
  fs.writeFileSync(path.join(userConfigDir, 'skills', 'shared-skill', 'SKILL.md'), `---
name: shared-skill
description: user description
---
user skill body
`, 'utf8');
  fs.writeFileSync(path.join(userConfigDir, 'roles', '01-role.md'), 'user role prompt', 'utf8');

  const resolved = resolveUserAgentConfig({
    model: 'global-model',
    provider: 'openai',
    openai: {
      apiKey: 'test',
      baseURL: 'http://global.example.invalid/v1',
    },
    workspaceDir: rootDir,
    projectRootDir: rootDir,
    userRootDir,
    skillsDir: globalSkillsDir,
    skillsDirs: [globalSkillsDir],
    rolePromptDir: globalRolesDir,
    rolePromptDirs: [globalRolesDir],
    sessionDb: path.join(rootDir, 'sessions.db'),
    mcpServers: [],
    attachmentExtraction: {
      markitdown: {
        enabled: false,
        cache: {
          enabled: true,
          dbPath: path.join(rootDir, 'data', 'attachment-cache.db'),
        },
      },
    },
    workspacePython: {
      enabled: true,
      command: path.join(rootDir, '.tools', 'workspace-python', 'Scripts', 'python.exe'),
      timeoutMs: 120000,
      maxTimeoutMs: 600000,
      requirementsPath: path.join(rootDir, 'workspace-runtime', 'requirements.txt'),
      allowUserPackageInstall: true,
      userVenvDir: path.join(rootDir, 'data', 'global-workspace-python'),
    },
  }, 'u/1');

  assert.equal(resolved.config.model, 'user-model');
  assert.equal(resolved.config.openai.baseURL, 'http://user.example.invalid/v1');
  assert.equal(resolved.config.workspaceDir, path.join(userConfigDir, 'workspace'));
  assert.equal(resolved.config.sessionDb, path.join(userConfigDir, 'data', 'user-sessions.db'));
  assert.equal(resolved.config.attachmentExtraction.markitdown.cache.dbPath, path.join(userConfigDir, 'data', 'attachment-extraction-cache.db'));
  assert.equal(resolved.config.workspacePython.userVenvDir, path.join(userConfigDir, 'data', 'workspace-python'));
  assert.deepEqual(resolved.config.skillsDirs, [
    path.join(userConfigDir, 'skills'),
    globalSkillsDir,
  ]);
  assert.deepEqual(resolved.config.rolePromptDirs, [
    path.join(userConfigDir, 'roles'),
    globalRolesDir,
  ]);

  const skills = await listAvailableSkills({ skillsDir: resolved.config.skillsDirs });
  assert.equal(skills.length, 1);
  assert.equal(skills[0].description, 'user description');

  const rolePrompt = await loadRolePrompt(resolved.config.rolePromptDirs);
  assert.match(rolePrompt, /user role prompt/);
  assert.doesNotMatch(rolePrompt, /global role prompt/);
  assert.match(rolePrompt, /global fallback prompt/);

  fs.rmSync(rootDir, { recursive: true, force: true });
};
