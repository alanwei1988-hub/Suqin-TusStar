const fs = require('fs');
const path = require('path');

const LOGICAL_ATTACHMENT_PREFIX = 'attachment://';

function encodeUserScopeSegment(userId) {
  return encodeURIComponent(String(userId || 'anonymous'));
}

function isPathInside(baseDir, candidatePath) {
  const relativePath = path.relative(path.resolve(baseDir), path.resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function normalizeLogicalSubpath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function buildAttachmentLogicalPath(attachmentsDir, resolvedPath) {
  const relativePath = path.relative(attachmentsDir, resolvedPath).split(path.sep).join(path.posix.sep);
  return `${LOGICAL_ATTACHMENT_PREFIX}${relativePath}`;
}

function resolveAttachmentLogicalPath(attachmentsDir, requestedPath) {
  if (typeof requestedPath !== 'string' || !requestedPath.startsWith(LOGICAL_ATTACHMENT_PREFIX)) {
    return '';
  }

  const resolvedPath = path.resolve(
    attachmentsDir,
    normalizeLogicalSubpath(requestedPath.slice(LOGICAL_ATTACHMENT_PREFIX.length)),
  );

  if (!isPathInside(attachmentsDir, resolvedPath)) {
    throw new Error(`Attachment path escapes its root: ${requestedPath}`);
  }

  return resolvedPath;
}

function buildUserPaths(userRootDir, userId) {
  const rootDir = path.resolve(userRootDir, encodeUserScopeSegment(userId));

  return {
    userId: String(userId || ''),
    rootDir,
    workspaceDir: path.join(rootDir, 'workspace'),
    attachmentsDir: path.join(rootDir, 'attachments'),
    dataDir: path.join(rootDir, 'data'),
    configPath: path.join(rootDir, 'config.json'),
    skillsDir: path.join(rootDir, 'skills'),
    rolePromptDir: path.join(rootDir, 'roles'),
  };
}

function ensureUserPaths(userPaths) {
  for (const dirPath of [
    userPaths.rootDir,
    userPaths.workspaceDir,
    userPaths.attachmentsDir,
    userPaths.dataDir,
  ]) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

module.exports = {
  buildAttachmentLogicalPath,
  buildUserPaths,
  encodeUserScopeSegment,
  ensureUserPaths,
  LOGICAL_ATTACHMENT_PREFIX,
  normalizeLogicalSubpath,
  resolveAttachmentLogicalPath,
};
