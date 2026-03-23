const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { getProjectMarkItDownPython } = require('./runtime');

async function readBufferChunk(resolvedPath, start = 0, length = 8192) {
  const handle = await fs.open(resolvedPath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function extractPageCountFromPdfText(text) {
  const countMatches = [...text.matchAll(/\/Count\s+(\d{1,6})\b/g)];
  const counts = countMatches
    .map(match => Number.parseInt(match[1], 10))
    .filter(Number.isFinite)
    .filter(count => count > 0);

  return counts.length > 0
    ? Math.max(...counts)
    : null;
}

async function readPdfPageCountFromBytes(resolvedPath) {
  const stat = await fs.stat(resolvedPath);
  const firstSampleBytes = Math.min(stat.size, 512 * 1024);
  const firstBuffer = await readBufferChunk(resolvedPath, 0, firstSampleBytes);
  const firstPageCount = extractPageCountFromPdfText(firstBuffer.toString('latin1'));

  if (firstPageCount) {
    return firstPageCount;
  }

  if (stat.size <= firstSampleBytes) {
    return null;
  }

  const fullBuffer = await fs.readFile(resolvedPath);
  return extractPageCountFromPdfText(fullBuffer.toString('latin1'));
}

async function readPdfPageCountViaPython(resolvedPath, rootDir = path.resolve(__dirname, '..')) {
  const pythonPath = getProjectMarkItDownPython(rootDir);
  const scriptPath = path.resolve(rootDir, 'markitdown', 'pdf_info.py');

  return new Promise(resolve => {
    execFile(
      pythonPath,
      [scriptPath, resolvedPath],
      {
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 128 * 1024,
      },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        try {
          const parsed = JSON.parse(String(stdout || '').trim());
          const pageCount = Number(parsed?.pageCount);
          resolve(Number.isFinite(pageCount) && pageCount > 0 ? pageCount : null);
        } catch {
          resolve(null);
        }
      },
    );
  });
}

async function getPdfInfo(resolvedPath, options = {}) {
  const pageCountFromBytes = await readPdfPageCountFromBytes(resolvedPath);

  if (pageCountFromBytes) {
    return { pageCount: pageCountFromBytes };
  }

  const pageCountFromPython = await readPdfPageCountViaPython(
    resolvedPath,
    options.rootDir || path.resolve(__dirname, '..'),
  );

  return pageCountFromPython
    ? { pageCount: pageCountFromPython }
    : {};
}

module.exports = {
  getPdfInfo,
};
