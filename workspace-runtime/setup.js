const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const {
  WORKSPACE_PYTHON_RUNTIME_VERSION,
  getProjectWorkspacePython,
  getWorkspacePythonRequirementsPath,
  getWorkspacePythonVenvDir,
} = require('./runtime');

const rootDir = path.resolve(__dirname, '..');
const venvDir = getWorkspacePythonVenvDir(rootDir);
const venvPython = getProjectWorkspacePython(rootDir);
const requirementsPath = resolveRequirementsPath();
const requirementsStampPath = path.join(venvDir, '.requirements.sha256');

function loadRawConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function resolveRequirementsPath() {
  const rawConfig = loadRawConfig();
  const configuredPath = rawConfig?.agent?.workspacePython?.requirementsPath;

  if (typeof configuredPath === 'string' && configuredPath.trim().length > 0) {
    return path.isAbsolute(configuredPath)
      ? path.normalize(configuredPath)
      : path.resolve(rootDir, configuredPath);
  }

  return getWorkspacePythonRequirementsPath(rootDir);
}

function runShell(command, args) {
  execFileSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    windowsHide: true,
  });
}

function tryGetOutput(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: rootDir,
      windowsHide: true,
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

function detectBootstrapPython() {
  const candidates = process.platform === 'win32'
    ? ['python', 'py']
    : ['python3', 'python'];

  for (const candidate of candidates) {
    const output = tryGetOutput(candidate, ['--version']);
    if (output) {
      return candidate;
    }
  }

  throw new Error('Python 3 is required to install the workspace runtime, but no Python executable was found.');
}

function ensureVirtualEnv() {
  if (fs.existsSync(venvPython)) {
    return;
  }

  fs.mkdirSync(path.dirname(venvDir), { recursive: true });
  const bootstrap = detectBootstrapPython();
  console.log(`[postinstall] Creating workspace Python runtime at ${venvDir}`);
  runShell(bootstrap, ['-m', 'venv', venvDir]);
}

function getRequirementsHash() {
  return crypto
    .createHash('sha256')
    .update(`${WORKSPACE_PYTHON_RUNTIME_VERSION}\n${fs.readFileSync(requirementsPath)}`)
    .digest('hex');
}

function getInstalledRequirementsHash() {
  try {
    return fs.readFileSync(requirementsStampPath, 'utf8').trim();
  } catch {
    return '';
  }
}

function writeInstalledRequirementsHash(requirementsHash) {
  fs.writeFileSync(requirementsStampPath, `${requirementsHash}\n`, 'utf8');
}

function installWorkspaceRuntime(requirementsHash) {
  console.log('[postinstall] Installing workspace Python runtime dependencies');
  runShell(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  runShell(venvPython, ['-m', 'pip', 'install', '-r', requirementsPath]);
  writeInstalledRequirementsHash(requirementsHash);
}

function getInstallReason(requirementsHash) {
  if (!fs.existsSync(venvPython)) {
    return 'virtualenv is missing';
  }

  const installedRequirementsHash = getInstalledRequirementsHash();
  if (installedRequirementsHash !== requirementsHash) {
    return installedRequirementsHash
      ? 'requirements changed since the last successful install'
      : 'no dependency stamp was found for the current runtime';
  }

  return '';
}

function main() {
  if (process.env.WORKSPACE_PYTHON_SKIP_INSTALL === '1') {
    console.log('[postinstall] Skipping workspace Python install because WORKSPACE_PYTHON_SKIP_INSTALL=1');
    return;
  }

  if (!fs.existsSync(requirementsPath)) {
    console.log(`[postinstall] Skipping workspace Python install because requirements file is missing: ${requirementsPath}`);
    return;
  }

  ensureVirtualEnv();

  const requirementsHash = getRequirementsHash();
  const installReason = getInstallReason(requirementsHash);
  if (!installReason) {
    console.log('[postinstall] Workspace Python runtime is ready');
    return;
  }

  console.log(`[postinstall] Reinstalling workspace Python runtime because ${installReason}`);
  installWorkspaceRuntime(requirementsHash);
}

try {
  main();
} catch (error) {
  console.error(`[postinstall] Failed to prepare workspace Python runtime: ${error.message}`);
  process.exit(1);
}
