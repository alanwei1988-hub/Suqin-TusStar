const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const {
  MARKITDOWN_VERSION,
  getMarkItDownRequirementsPath,
  getMarkItDownVenvDir,
  getProjectMarkItDownPython,
} = require('./runtime');

const rootDir = path.resolve(__dirname, '..');
const venvDir = getMarkItDownVenvDir(rootDir);
const venvPython = getProjectMarkItDownPython(rootDir);
const requirementsPath = getMarkItDownRequirementsPath(rootDir);
const requirementsStampPath = path.join(venvDir, '.requirements.sha256');

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
    ? [
      { command: 'py', args: ['-3'] },
      { command: 'python', args: [] },
    ]
    : [
      { command: 'python3', args: [] },
      { command: 'python', args: [] },
    ];

  for (const candidate of candidates) {
    const output = tryGetOutput(candidate.command, [...candidate.args, '--version']);
    if (output) {
      return candidate;
    }
  }

  throw new Error('Python 3 is required to install the bundled MarkItDown runtime, but no Python executable was found.');
}

function ensureVirtualEnv() {
  if (fs.existsSync(venvPython)) {
    return;
  }

  fs.mkdirSync(path.dirname(venvDir), { recursive: true });
  const bootstrap = detectBootstrapPython();
  console.log(`[postinstall] Creating MarkItDown virtualenv at ${venvDir}`);
  runShell(bootstrap.command, [...bootstrap.args, '-m', 'venv', venvDir]);
}

function getInstalledVersion() {
  if (!fs.existsSync(venvPython)) {
    return '';
  }

  const output = tryGetOutput(venvPython, ['-m', 'pip', 'show', 'markitdown']);
  const versionLine = output.split(/\r?\n/).find(line => /^Version:\s+/i.test(line));
  return versionLine ? versionLine.replace(/^Version:\s+/i, '').trim() : '';
}

function getRequirementsHash() {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(requirementsPath))
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

function installMarkItDown(requirementsHash) {
  console.log(`[postinstall] Installing MarkItDown ${MARKITDOWN_VERSION} into project runtime`);
  runShell(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  runShell(venvPython, ['-m', 'pip', 'install', '-r', requirementsPath]);
  writeInstalledRequirementsHash(requirementsHash);
}

function getInstallReason(requirementsHash) {
  if (!fs.existsSync(venvPython)) {
    return 'virtualenv is missing';
  }

  const installedVersion = getInstalledVersion();
  if (installedVersion !== MARKITDOWN_VERSION) {
    return installedVersion
      ? `installed MarkItDown version is ${installedVersion}`
      : 'MarkItDown is not installed';
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
  if (process.env.MARKITDOWN_SKIP_INSTALL === '1') {
    console.log('[postinstall] Skipping MarkItDown install because MARKITDOWN_SKIP_INSTALL=1');
    return;
  }

  ensureVirtualEnv();

  const requirementsHash = getRequirementsHash();
  const installReason = getInstallReason(requirementsHash);
  if (!installReason) {
    console.log(`[postinstall] MarkItDown ${MARKITDOWN_VERSION} runtime is ready`);
    return;
  }

  console.log(`[postinstall] Reinstalling MarkItDown runtime because ${installReason}`);
  installMarkItDown(requirementsHash);
}

try {
  main();
} catch (error) {
  console.error(`[postinstall] Failed to prepare MarkItDown runtime: ${error.message}`);
  process.exit(1);
}
