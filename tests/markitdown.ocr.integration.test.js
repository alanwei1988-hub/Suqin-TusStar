const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { loadRawConfig, processConfig } = require('../app');
const {
  createCommandEnv,
  createMarkItDownExtractor,
  replaceArgPlaceholders,
} = require('../markitdown/extractor');
const { getProjectMarkItDownPython } = require('../markitdown/runtime');
const { makeTempDir, markitdownOcrSamplePdf, repoRoot } = require('./helpers/test-helpers');

const execFileAsync = promisify(execFile);

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getNumericFlag(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  const value = Number.parseInt(process.argv[index + 1] || '', 10);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`Invalid ${flag} value. Use a positive integer.`);
  }

  return value;
}

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

function buildMarkItDownCommand(markitdownConfig, inputPath) {
  const configuredArgs = Array.isArray(markitdownConfig.args)
    ? markitdownConfig.args
    : ['-m', 'markitdown', '{input}'];
  const args = configuredArgs.map(arg => replaceArgPlaceholders(arg, {
    input: inputPath,
    llmClient: markitdownConfig?.llm?.client || '',
    llmModel: markitdownConfig?.llm?.model || '',
    llmBaseURL: markitdownConfig?.llm?.baseURL || '',
    llmPrompt: markitdownConfig?.llm?.prompt || '',
    pageStart: 1,
    pageCount: 0,
    ocrConcurrency: markitdownConfig?.ocrConcurrency || 1,
    ocrPageGroupSize: markitdownConfig?.ocrPageGroupSize || 1,
  }));

  if (!configuredArgs.some(arg => typeof arg === 'string' && arg.includes('{input}'))) {
    args.push(inputPath);
  }

  return {
    command: markitdownConfig.command,
    args,
  };
}

function getRunnerTimingLines(stderr = '') {
  return String(stderr || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('[runner-timing]'));
}

function getRunnerTimingErrorLines(stderr = '') {
  return getRunnerTimingLines(stderr)
    .filter(line => /error=/.test(line))
    .filter(line => !line.endsWith('error='));
}

function writeFullReport({
  inputPath,
  markitdownConfig,
  effectiveTimeoutMs,
  elapsedMs,
  stderr,
  markdown,
}) {
  const reportPath = path.join(repoRoot, 'storage', 'temp', 'markitdown-ocr-full-report.txt');
  const reportLines = [
    'MarkItDown OCR full PDF live test',
    '='.repeat(72),
    `Input PDF: ${inputPath}`,
    `Active profile: ${markitdownConfig.activeLlmProfile || '(legacy llm fallback)'}`,
    `LLM client: ${markitdownConfig.llm.client || '(none)'}`,
    `LLM model: ${markitdownConfig.llm.model || '(none)'}`,
    `Configured extractor timeout: ${markitdownConfig.timeoutMs}ms`,
    `Effective test timeout: ${effectiveTimeoutMs}ms`,
    `Observed elapsed: ${elapsedMs}ms (${formatDuration(elapsedMs)})`,
    '',
    'Runner timing stderr',
    '-'.repeat(72),
    String(stderr || '').trim(),
    '',
    'Full markdown stdout',
    '-'.repeat(72),
    String(markdown || '').trim(),
    '',
  ];

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf8');
  return reportPath;
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

async function runFullPdfTest({
  markitdownConfig,
  inputPath,
  effectiveTimeoutMs,
  timingEnabled,
}) {
  const { command, args } = buildMarkItDownCommand(markitdownConfig, inputPath);
  const env = createCommandEnv(markitdownConfig);

  if (timingEnabled) {
    env.MARKITDOWN_TIMING = '1';
  }

  const startedAt = Date.now();
  const result = await execFileAsync(command, args, {
    cwd: repoRoot,
    windowsHide: true,
    encoding: 'utf8',
    timeout: effectiveTimeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    env,
  });
  const elapsedMs = Date.now() - startedAt;

  return {
    elapsedMs,
    markdown: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

async function main() {
  if (!fs.existsSync(markitdownOcrSamplePdf)) {
    throw new Error(`OCR sample PDF is missing: ${markitdownOcrSamplePdf}`);
  }

  const rawConfig = loadRawConfig(repoRoot);
  const processedConfig = processConfig(rawConfig, {
    rootDir: repoRoot,
    env: process.env,
  });
  const ocrApiKeyEnv = processedConfig.agent.attachmentExtraction.markitdown.llm.apiKeyEnv;
  if (ocrApiKeyEnv && !process.env[ocrApiKeyEnv]) {
    throw new Error(`${ocrApiKeyEnv} is required for the live OCR test.`);
  }
  const markitdownConfig = processedConfig.agent.attachmentExtraction.markitdown;
  const extractor = createMarkItDownExtractor(markitdownConfig);
  const pythonExe = getProjectMarkItDownPython(repoRoot);
  const tempDir = makeTempDir('markitdown-ocr-live-');
  const pagesDir = path.join(tempDir, 'pages');
  const startedAt = Date.now();
  const fullMode = hasFlag('--full');
  const timingEnabled = hasFlag('--timing');
  const timeoutOverrideMs = getNumericFlag('--timeout-ms');
  const effectiveTimeoutMs = timeoutOverrideMs || (fullMode
    ? Math.max(markitdownConfig.timeoutMs, 15 * 60 * 1000)
    : markitdownConfig.timeoutMs);
  const pageLimit = fullMode ? null : getPageLimit();

  try {
    hr();
    console.log('MarkItDown OCR live test');
    console.log(`Sample PDF: ${markitdownOcrSamplePdf}`);
    console.log(`Active profile: ${markitdownConfig.activeLlmProfile || '(legacy llm fallback)'}`);
    console.log(`LLM client: ${markitdownConfig.llm.client || '(none)'}`);
    console.log(`LLM model: ${markitdownConfig.llm.model || '(none)'}`);
    console.log(`Mode: ${fullMode ? 'full-pdf' : 'per-page'}`);
    if (!fullMode) {
      console.log(`Page limit: ${pageLimit}`);
    }
    console.log(`Configured timeout: ${markitdownConfig.timeoutMs}ms`);
    console.log(`Effective test timeout: ${effectiveTimeoutMs}ms`);
    console.log(`Runner timing enabled: ${timingEnabled}`);
    hr();

    if (fullMode) {
      console.log('Running OCR for the full PDF...');
      const result = await runFullPdfTest({
        markitdownConfig,
        inputPath: markitdownOcrSamplePdf,
        effectiveTimeoutMs,
        timingEnabled,
      });

      assert.match(result.markdown, /\S/, 'Full PDF OCR returned empty markdown.');

      console.log(`Full PDF: OCR finished in ${formatDuration(result.elapsedMs)}`);
      console.log(`Full PDF: markdown chars = ${result.markdown.length}`);

      const timingLines = getRunnerTimingLines(result.stderr);
      const timingErrorLines = getRunnerTimingErrorLines(result.stderr);
      if (timingEnabled) {
        hr();
        console.log('Runner timing');
        if (timingLines.length > 0) {
          for (const line of timingLines) {
            console.log(line);
          }
        } else {
          console.log('(no runner timing lines captured)');
        }
      }

      const reportPath = writeFullReport({
        inputPath: markitdownOcrSamplePdf,
        markitdownConfig,
        effectiveTimeoutMs,
        elapsedMs: result.elapsedMs,
        stderr: result.stderr,
        markdown: result.markdown,
      });

      if (timingErrorLines.length > 0) {
        throw new Error(`Full PDF OCR encountered backend errors:\n${timingErrorLines.join('\n')}`);
      }
      assert.match(result.markdown, /\[Image OCR\]|\S{40,}/, 'Full PDF OCR did not return substantive extracted text.');

      hr();
      console.log('Full PDF markdown');
      console.log(result.markdown);
      hr();
      console.log(`Saved full report: ${reportPath}`);
      console.log(`Total elapsed: ${formatDuration(Date.now() - startedAt)}`);
      return;
    }

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
