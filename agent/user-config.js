const fs = require('fs');
const path = require('path');
const { buildUserPaths, ensureUserPaths } = require('../user-space');

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneValue(child)]),
    );
  }

  return value;
}

function deepMerge(base, override) {
  if (typeof override === 'undefined') {
    return cloneValue(base);
  }

  if (Array.isArray(override)) {
    return override.map(cloneValue);
  }

  if (!isPlainObject(override)) {
    return cloneValue(override);
  }

  const baseObject = isPlainObject(base) ? base : {};
  const merged = {};
  const keys = new Set([...Object.keys(baseObject), ...Object.keys(override)]);

  for (const key of keys) {
    merged[key] = deepMerge(baseObject[key], override[key]);
  }

  return merged;
}

function resolveRelativePath(rootDir, value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return value;
  }

  return path.isAbsolute(value)
    ? path.normalize(value)
    : path.resolve(rootDir, value);
}

function normalizeMcpServer(rootDir, server) {
  const normalized = {
    ...server,
    cwd: resolveRelativePath(rootDir, server.cwd),
    ...(Number.isFinite(server.toolTimeoutMs)
      ? { toolTimeoutMs: Math.max(1, Math.trunc(server.toolTimeoutMs)) }
      : {}),
  };

  if ((normalized.transport || normalized.type) !== 'stdio') {
    return normalized;
  }

  if (typeof normalized.command === 'string' && /^node(?:\.exe)?$/i.test(normalized.command.trim())) {
    normalized.command = process.execPath;
  }

  if (Array.isArray(normalized.args) && normalized.args.length > 0) {
    normalized.args = normalized.args.map((arg, index) => {
      if (
        index === 0
        && typeof arg === 'string'
        && /\.m?js$/i.test(arg)
      ) {
        return resolveRelativePath(normalized.cwd || rootDir, arg);
      }

      return arg;
    });
  }

  return normalized;
}

function normalizeAgentOverrides(agentOverrides, rootDir) {
  const normalized = deepMerge({}, agentOverrides);

  if (!isPlainObject(normalized)) {
    return {};
  }

  if (typeof normalized.skillsDir === 'string') {
    normalized.skillsDir = resolveRelativePath(rootDir, normalized.skillsDir);
  }

  if (Array.isArray(normalized.skillsDirs)) {
    normalized.skillsDirs = normalized.skillsDirs.map(value => resolveRelativePath(rootDir, value)).filter(Boolean);
  }

  if (typeof normalized.rolePromptDir === 'string') {
    normalized.rolePromptDir = resolveRelativePath(rootDir, normalized.rolePromptDir);
  }

  if (Array.isArray(normalized.rolePromptDirs)) {
    normalized.rolePromptDirs = normalized.rolePromptDirs.map(value => resolveRelativePath(rootDir, value)).filter(Boolean);
  }

  if (typeof normalized.sessionDb === 'string') {
    normalized.sessionDb = resolveRelativePath(rootDir, normalized.sessionDb);
  }

  if (isPlainObject(normalized.attachmentExtraction?.markitdown)) {
    const markitdown = normalized.attachmentExtraction.markitdown;

    if (typeof markitdown.handlerModule === 'string' && markitdown.handlerModule.trim().length > 0) {
      markitdown.handlerModule = resolveRelativePath(rootDir, markitdown.handlerModule);
    }

    if (typeof markitdown.command === 'string' && markitdown.command.startsWith('.')) {
      markitdown.command = resolveRelativePath(rootDir, markitdown.command);
    }

    if (Array.isArray(markitdown.args)) {
      markitdown.args = markitdown.args.map(arg => {
        if (typeof arg === 'string' && arg.startsWith('.')) {
          return resolveRelativePath(rootDir, arg);
        }

        return arg;
      });
    }

    if (isPlainObject(markitdown.cache) && typeof markitdown.cache.dbPath === 'string') {
      markitdown.cache.dbPath = resolveRelativePath(rootDir, markitdown.cache.dbPath);
    }
  }

  if (isPlainObject(normalized.workspacePython)) {
    if (typeof normalized.workspacePython.command === 'string' && normalized.workspacePython.command.startsWith('.')) {
      normalized.workspacePython.command = resolveRelativePath(rootDir, normalized.workspacePython.command);
    }

    if (typeof normalized.workspacePython.requirementsPath === 'string' && normalized.workspacePython.requirementsPath.trim().length > 0) {
      normalized.workspacePython.requirementsPath = resolveRelativePath(rootDir, normalized.workspacePython.requirementsPath);
    }

    if (typeof normalized.workspacePython.userVenvDir === 'string' && normalized.workspacePython.userVenvDir.trim().length > 0) {
      normalized.workspacePython.userVenvDir = resolveRelativePath(rootDir, normalized.workspacePython.userVenvDir);
    }
  }

  if (isPlainObject(normalized.imageGeneration)) {
    if (typeof normalized.imageGeneration.scriptPath === 'string' && normalized.imageGeneration.scriptPath.trim().length > 0) {
      normalized.imageGeneration.scriptPath = resolveRelativePath(rootDir, normalized.imageGeneration.scriptPath.trim());
    }
  }

  if (isPlainObject(normalized.imageModel)) {
    if (typeof normalized.imageModel.handlerModule === 'string' && normalized.imageModel.handlerModule.trim().length > 0) {
      normalized.imageModel.handlerModule = resolveRelativePath(rootDir, normalized.imageModel.handlerModule.trim());
    }
  }

  if (Array.isArray(normalized.mcpServers)) {
    normalized.mcpServers = normalized.mcpServers.map(server => normalizeMcpServer(rootDir, server));
  }

  return normalized;
}

function uniquePaths(paths = []) {
  return [...new Set(paths.filter(value => typeof value === 'string' && value.trim().length > 0).map(value => path.resolve(value)))];
}

function readUserConfig(configPath) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function resolveUserAgentConfig(baseConfig, userId) {
  const userRootDir = baseConfig.userRootDir
    || path.join(baseConfig.projectRootDir || baseConfig.workspaceDir || process.cwd(), 'storage', 'users');
  const userPaths = buildUserPaths(userRootDir, userId);
  ensureUserPaths(userPaths);

  const rawUserConfig = readUserConfig(userPaths.configPath);
  const rawAgentOverrides = isPlainObject(rawUserConfig.agent)
    ? rawUserConfig.agent
    : (isPlainObject(rawUserConfig) ? rawUserConfig : {});
  const normalizedAgentOverrides = normalizeAgentOverrides(rawAgentOverrides, userPaths.rootDir);
  const mergedConfig = deepMerge(baseConfig, normalizedAgentOverrides);
  const baseSkillsDirs = uniquePaths([
    ...(Array.isArray(baseConfig.skillsDirs) ? baseConfig.skillsDirs : []),
    baseConfig.skillsDir,
  ]);
  const baseRolePromptDirs = uniquePaths([
    ...(Array.isArray(baseConfig.rolePromptDirs) ? baseConfig.rolePromptDirs : []),
    baseConfig.rolePromptDir,
  ]);
  const userSkillsDirs = Array.isArray(normalizedAgentOverrides.skillsDirs) && normalizedAgentOverrides.skillsDirs.length > 0
    ? normalizedAgentOverrides.skillsDirs
    : (typeof normalizedAgentOverrides.skillsDir === 'string' && normalizedAgentOverrides.skillsDir.trim().length > 0
      ? [normalizedAgentOverrides.skillsDir]
      : (fs.existsSync(userPaths.skillsDir) ? [userPaths.skillsDir] : []));
  const userRolePromptDirs = Array.isArray(normalizedAgentOverrides.rolePromptDirs) && normalizedAgentOverrides.rolePromptDirs.length > 0
    ? normalizedAgentOverrides.rolePromptDirs
    : (typeof normalizedAgentOverrides.rolePromptDir === 'string' && normalizedAgentOverrides.rolePromptDir.trim().length > 0
      ? [normalizedAgentOverrides.rolePromptDir]
      : (fs.existsSync(userPaths.rolePromptDir) ? [userPaths.rolePromptDir] : []));

  mergedConfig.projectRootDir = baseConfig.projectRootDir || baseConfig.workspaceDir;
  mergedConfig.userRootDir = userRootDir;
  mergedConfig.workspaceDir = userPaths.workspaceDir;
  mergedConfig.userPaths = userPaths;
  mergedConfig.skillsDirs = uniquePaths([...userSkillsDirs, ...baseSkillsDirs]);
  mergedConfig.skillsDir = mergedConfig.skillsDirs[0] || '';
  mergedConfig.rolePromptDirs = uniquePaths([...userRolePromptDirs, ...baseRolePromptDirs]);
  mergedConfig.rolePromptDir = mergedConfig.rolePromptDirs[0] || '';

  if (!isPlainObject(normalizedAgentOverrides.attachmentExtraction?.markitdown?.cache) || !normalizedAgentOverrides.attachmentExtraction.markitdown.cache.dbPath) {
    if (isPlainObject(mergedConfig.attachmentExtraction?.markitdown)) {
      mergedConfig.attachmentExtraction.markitdown.cache = {
        ...(mergedConfig.attachmentExtraction.markitdown.cache || {}),
        dbPath: path.join(userPaths.dataDir, 'attachment-extraction-cache.db'),
      };
    }
  }

  if (!isPlainObject(normalizedAgentOverrides.workspacePython) || !normalizedAgentOverrides.workspacePython.userVenvDir) {
    if (isPlainObject(mergedConfig.workspacePython)) {
      mergedConfig.workspacePython = {
        ...mergedConfig.workspacePython,
        userVenvDir: path.join(userPaths.dataDir, 'workspace-python'),
      };
    }
  }

  if (isPlainObject(mergedConfig.workspacePython) && mergedConfig.workspacePython.command === '{runtime}') {
    mergedConfig.workspacePython.command = baseConfig.workspacePython?.command || mergedConfig.workspacePython.command;
  }

  return {
    config: mergedConfig,
    userPaths,
  };
}

module.exports = {
  resolveUserAgentConfig,
};
