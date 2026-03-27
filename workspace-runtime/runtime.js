const path = require('path');

const WORKSPACE_PYTHON_RUNTIME_VERSION = '1';

function getWorkspacePythonVenvDir(rootDir) {
  return path.resolve(rootDir, '.tools', 'workspace-python');
}

function getWorkspacePythonBinary(venvDir) {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
}

function getProjectWorkspacePython(rootDir) {
  return getWorkspacePythonBinary(getWorkspacePythonVenvDir(rootDir));
}

function getWorkspacePythonRequirementsPath(rootDir) {
  return path.resolve(rootDir, 'workspace-runtime', 'requirements.txt');
}

module.exports = {
  WORKSPACE_PYTHON_RUNTIME_VERSION,
  getProjectWorkspacePython,
  getWorkspacePythonBinary,
  getWorkspacePythonRequirementsPath,
  getWorkspacePythonVenvDir,
};
