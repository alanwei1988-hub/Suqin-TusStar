const path = require('path');

const MARKITDOWN_VERSION = '0.1.5';

function getMarkItDownVenvDir(rootDir) {
  return path.resolve(rootDir, '.tools', 'markitdown');
}

function getProjectMarkItDownPython(rootDir) {
  const venvDir = getMarkItDownVenvDir(rootDir);

  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
}

function getMarkItDownRequirementsPath(rootDir) {
  return path.resolve(rootDir, 'markitdown', 'requirements.txt');
}

module.exports = {
  MARKITDOWN_VERSION,
  getMarkItDownRequirementsPath,
  getMarkItDownVenvDir,
  getProjectMarkItDownPython,
};
