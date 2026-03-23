const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { loadRawConfig, processConfig } = require('../app');
const { createMarkItDownExtractor } = require('../markitdown/extractor');
const { getProjectMarkItDownPython } = require('../markitdown/runtime');
const { makeTempDir, markitdownOcrSamplePdf, repoRoot } = require('./helpers/test-helpers');

const execFileAsync = promisify(execFile);

function getPageLimit() {
  const pagesArgIndex = process.argv.indexOf('--pages');
  if (pagesArgIndex === -1) {
    const positionalValue = process.argv.slice(2).find(value => /^\d+$/.test(value));
    if (!positionalValue) {
      return 3;
    }

    const positionalPages = Number.parseInt(positionalValue, 10);
    if (!Number.isFinite(positionalPages) || positionalPages < 1) {
      throw new Error('Invalid page count argument. Use a positive integer.');
    }

    return positionalPages;
  }

  const value = Number.parseInt(process.argv[pagesArgIndex + 1] || '', 10);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error('Invalid --pages value. Use a positive integer.');
  }

  return value;
}

function hr() {
  console.log('='.repeat(72));
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

async function splitPdfIntoPages(sourcePdf, outputDir, pageCount, pythonExe) {
  const scriptPath = path.join(repoRoot, 'tests', 'helpers', 'extract_pdf_pages.py');
  const result = await execFileAsync(
    pythonExe,
    [scriptPath, sourcePdf, outputDir, String(pageCount)],
    {
      cwd: repoRoot,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30000,
    },
  );

  return String(result.stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

async function main() {
  if (!fs.existsSync(markitdownOcrSamplePdf)) {
    throw new Error(`OCR sample PDF is missing: ${markitdownOcrSamplePdf}`);
  }

  if (!process.env.MARKITDOWN_OCR_OPENAI_API_KEY) {
    throw new Error('MARKITDOWN_OCR_OPENAI_API_KEY is required for the live OCR test.');
  }

  const rawConfig = loadRawConfig(repoRoot);
  const processedConfig = processConfig(rawConfig, {
    rootDir: repoRoot,
    env: process.env,
  });
  const extractor = createMarkItDownExtractor(processedConfig.agent.attachmentExtraction.markitdown);
  const pythonExe = getProjectMarkItDownPython(repoRoot);
  const tempDir = makeTempDir('markitdown-ocr-live-');
  const pagesDir = path.join(tempDir, 'pages');
  const startedAt = Date.now();
  const pageLimit = getPageLimit();

  try {
    hr();
    console.log('MarkItDown OCR live test');
    console.log(`Sample PDF: ${markitdownOcrSamplePdf}`);
    console.log(`Page limit: ${pageLimit}`);
    console.log(`Per-page timeout: ${processedConfig.agent.attachmentExtraction.markitdown.timeoutMs}ms`);
    hr();
    console.log('Preparing single-page PDFs...');

    const pagePaths = await splitPdfIntoPages(markitdownOcrSamplePdf, pagesDir, pageLimit, pythonExe);
    assert.ok(pagePaths.length > 0, 'No pages were extracted from the sample PDF.');

    console.log(`Prepared ${pagePaths.length} page file(s):`);
    for (const pagePath of pagePaths) {
      console.log(`- ${pagePath}`);
    }

    hr();
    const pageResults = [];

    for (const [index, pagePath] of pagePaths.entries()) {
      const label = `Page ${index + 1}`;
      console.log(`${label}: OCR started`);
      const pageStart = Date.now();

      try {
        const result = await extractor.extract({
          resolvedPath: pagePath,
          extension: '.pdf',
          name: path.basename(pagePath),
        });
        const elapsedMs = Date.now() - pageStart;

        assert.equal(result.method, 'markitdown');
        assert.equal(typeof result.markdown, 'string');
        assert.match(result.markdown, /\S/);

        pageResults.push({
          ok: true,
          page: index + 1,
          elapsedMs,
          markdownLength: result.markdown.length,
          markdown: result.markdown,
        });

        console.log(`${label}: OCR finished in ${formatDuration(elapsedMs)}`);
        console.log(`${label}: markdown chars = ${result.markdown.length}`);
        console.log(`${label}: full markdown`);
        console.log(result.markdown);
        hr();
      } catch (error) {
        const elapsedMs = Date.now() - pageStart;
        pageResults.push({
          ok: false,
          page: index + 1,
          elapsedMs,
          error: error.message || String(error),
        });
        console.log(`${label}: OCR failed after ${formatDuration(elapsedMs)}`);
        console.log(`${label}: ${error.message || error}`);
        hr();
      }
    }

    const totalElapsedMs = Date.now() - startedAt;
    const okCount = pageResults.filter(item => item.ok).length;

    console.log('Summary');
    for (const item of pageResults) {
      if (item.ok) {
        console.log(`- Page ${item.page}: OK, ${formatDuration(item.elapsedMs)}, ${item.markdownLength} chars`);
      } else {
        console.log(`- Page ${item.page}: FAIL, ${formatDuration(item.elapsedMs)}, ${item.error}`);
      }
    }
    console.log(`Total elapsed: ${formatDuration(totalElapsedMs)}`);

    assert.ok(okCount > 0, 'All OCR page tests failed.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
