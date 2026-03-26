const fs = require('fs/promises');
const path = require('path');

const SUPPORTED_ROLE_EXTENSIONS = new Set(['.md', '.txt']);

async function listRolePromptFiles(rolePromptDir) {
  const values = Array.isArray(rolePromptDir) ? rolePromptDir : [rolePromptDir];
  const rootDirs = [...new Set(
    values
      .filter(value => typeof value === 'string' && value.trim().length > 0)
      .map(value => path.resolve(value)),
  )];

  if (rootDirs.length === 0) {
    return [];
  }

  const files = [];
  const seenRelativePaths = new Set();

  async function walk(rootDir, currentDir, prefix = '') {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walk(rootDir, fullPath, relativePath);
        continue;
      }

      if (SUPPORTED_ROLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && !seenRelativePaths.has(relativePath)) {
        seenRelativePaths.add(relativePath);
        files.push({
          relativePath,
          fullPath,
        });
      }
    }
  }

  for (const rootDir of rootDirs) {
    try {
      await walk(rootDir, rootDir);
    } catch {
      continue;
    }
  }

  return files;
}

async function loadRolePrompt(rolePromptDir) {
  const files = await listRolePromptFiles(rolePromptDir);

  if (files.length === 0) {
    return '';
  }

  const sections = [];

  for (const file of files) {
    const content = (await fs.readFile(file.fullPath, 'utf8')).trim();

    if (!content) {
      continue;
    }

    sections.push(`[${file.relativePath}]\n${content}`);
  }

  if (sections.length === 0) {
    return '';
  }

  return [
    'Role Duties',
    'Follow the loaded operating handbook for this role in addition to the general machine rules.',
    ...sections,
  ].join('\n\n');
}

module.exports = {
  listRolePromptFiles,
  loadRolePrompt,
};
