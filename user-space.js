const fs = require('fs');
const path = require('path');

function encodeUserScopeSegment(userId) {
  return encodeURIComponent(String(userId || 'anonymous'));
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
  buildUserPaths,
  encodeUserScopeSegment,
  ensureUserPaths,
};
