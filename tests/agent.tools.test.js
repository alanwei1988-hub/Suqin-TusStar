const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  buildBashToolPrompt,
  createBashTool,
  createRuntimeTools,
  decodeShellOutput,
  getBlockedCommandReason,
  runCommand,
  wrapWindowsPowerShellCommand,
} = require('../agent/tools');
const {
  createImageInspector,
  DEFAULT_IMAGE_INSPECTION_TIMEOUT_MS,
} = require('../agent/tools/image-inspector');
const { buildAttachmentLogicalPath } = require('../user-space');
const { makeTempDir, repoRoot } = require('./helpers/test-helpers');
const { getWorkspacePythonBinary } = require('../workspace-runtime/runtime');

function createFakeWorkspacePythonRuntime() {
  const installedWorkspacePackages = new Set();

  return {
    async runCommand(command, args = [], options = {}) {
      if (args[0] === '--version') {
        return { stdout: 'Python 3.11.9\n', stderr: '', exitCode: 0, timedOut: false };
      }

      if (args[0] === '-c') {
        const runtimeBaseDir = path.isAbsolute(command)
          ? path.dirname(path.dirname(command))
          : (options.cwd || repoRoot);
        return {
          stdout: JSON.stringify({
            sitePackages: [path.join(runtimeBaseDir, '.fake-site-packages')],
            stdlib: [path.join(runtimeBaseDir, '.fake-stdlib')],
          }),
          stderr: '',
          exitCode: 0,
          timedOut: false,
        };
      }

      if (args[0] === '-m' && args[1] === 'venv') {
        const venvDir = args[2];
        const pythonPath = getWorkspacePythonBinary(venvDir);
        fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
        fs.writeFileSync(pythonPath, '', 'utf8');
        fs.mkdirSync(path.join(venvDir, '.fake-site-packages'), { recursive: true });
        return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
      }

      if (args[0] === '-m' && args[1] === 'pip' && args[2] === 'install') {
        for (const spec of args.slice(4)) {
          if (String(spec).includes('local-py-package')) {
            installedWorkspacePackages.add('demo_pkg');
          }
        }
        return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
      }

      const invokedScriptPath = args[0] || '';
      if (invokedScriptPath.endsWith(path.join('workspace-runtime', 'run_python_in_workspace.py'))) {
        const code = fs.readFileSync(options.env.WXWORK_CODE_PATH, 'utf8');
        const tempWorkspaceDir = options.env.WXWORK_WORKSPACE_ROOT;
        if (code.includes('../escape.txt')) {
          return {
            stdout: '',
            stderr: 'path escapes workspace: ../escape.txt',
            exitCode: 1,
            timedOut: false,
          };
        }

        if (code.includes('demo_pkg')) {
          if (!installedWorkspacePackages.has('demo_pkg')) {
            return {
              stdout: '',
              stderr: 'No module named demo_pkg',
              exitCode: 1,
              timedOut: false,
            };
          }

          return {
            stdout: 'demo-installed\n',
            stderr: '',
            exitCode: 0,
            timedOut: false,
          };
        }

        if (code.includes('py-out.txt')) {
          fs.writeFileSync(path.join(tempWorkspaceDir, 'py-out.txt'), 'py-done', 'utf8');
          return {
            stdout: 'shared contract note\n',
            stderr: '',
            exitCode: 0,
            timedOut: false,
          };
        }

        return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
      }

      if (invokedScriptPath.endsWith(path.join('workspace-runtime', 'archive_workspace_zip.py'))) {
        const sourcePath = args[1];
        const outputPath = args[2];
        const countFiles = targetPath => {
          const stat = fs.statSync(targetPath);
          if (stat.isFile()) {
            return 1;
          }

          return fs.readdirSync(targetPath, { withFileTypes: true }).reduce((sum, entry) => {
            const childPath = path.join(targetPath, entry.name);
            return sum + (entry.isDirectory() ? countFiles(childPath) : 1);
          }, 0);
        };

        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, 'PK\x03\x04fake', 'utf8');
        return {
          stdout: `${outputPath}\n${countFiles(sourcePath)}\n`,
          stderr: '',
          exitCode: 0,
          timedOut: false,
        };
      }

      if (invokedScriptPath.endsWith(path.join('workspace-runtime', 'create_xlsx.py'))) {
        const outputPath = args[2];
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, 'fake-xlsx-binary', 'utf8');
        return {
          stdout: JSON.stringify({
            ok: true,
            outputPath,
            sheetCount: 1,
            sheetNames: ['Sheet1'],
          }),
          stderr: '',
          exitCode: 0,
          timedOut: false,
        };
      }

      if (invokedScriptPath.endsWith(path.join('workspace-runtime', 'read_spreadsheet.py'))) {
        const inputPath = args[2];
        return {
          stdout: JSON.stringify({
            type: 'delimited',
            path: inputPath,
            sheetNames: ['Sheet1'],
            sheets: [
              {
                name: 'Sheet1',
                headers: ['Company', 'Amount'],
                rows: [
                  ['启迪之星', 120],
                  ['辛芮智能', 88],
                ],
                rowCount: 2,
                columnCount: 2,
                truncated: false,
              },
            ],
          }),
          stderr: '',
          exitCode: 0,
          timedOut: false,
        };
      }

      throw new Error(`Unexpected fake python command: ${command} ${args.join(' ')}`);
    },
    async pathExists(candidatePath) {
      return fs.existsSync(candidatePath);
    },
  };
}

module.exports = async function runAgentToolsTest() {
  const packageJson = require('../package.json');

  assert.equal(typeof packageJson.dependencies['bash-tool'], 'string');
  assert.equal(typeof packageJson.dependencies['just-bash'], 'string');

  const rootDir = makeTempDir('agent-tools-');
  const projectRootDir = path.join(rootDir, 'project');
  const workspaceDir = path.join(rootDir, 'workspace');
  const sharedLibraryRoot = path.join(projectRootDir, 'storage', '已签署协议电子档');
  const externalSharedLibraryRoot = path.join(rootDir, 'nas-share', 'archive-library');
  const mockMarkItDownHandler = path.join(repoRoot, 'tests', 'helpers', 'mock-markitdown-handler.js');
  const mockImageInspectorHandler = path.join(repoRoot, 'tests', 'helpers', 'mock-image-inspector-handler.js');
  const localTextPath = path.join(workspaceDir, 'notes.md');
  const localPdfPath = path.join(workspaceDir, 'local.pdf');
  const localCsvPath = path.join(workspaceDir, 'contracts.csv');
  const attachmentTextPath = path.join(workspaceDir, 'user-upload.txt');
  const attachmentPdfPath = path.join(workspaceDir, 'scan.pdf');
  const attachmentPagedPdfPath = path.join(workspaceDir, 'paged.pdf');
  const attachmentImagePath = path.join(workspaceDir, 'avatar.png');
  const largeTextPath = path.join(workspaceDir, 'large.txt');
  const failingHandlerPath = path.join(workspaceDir, 'failing-markitdown-handler.js');
  const pagedHandlerPath = path.join(workspaceDir, 'paged-markitdown-handler.js');
  const scrambledHeadingHandlerPath = path.join(workspaceDir, 'scrambled-heading-markitdown-handler.js');
  const headingOnlyHandlerPath = path.join(workspaceDir, 'heading-only-markitdown-handler.js');
  const localPythonPackageDir = path.join(workspaceDir, 'local-py-package');
  const sharedTextPath = path.join(sharedLibraryRoot, 'shared-note.md');
  const sharedPdfPath = path.join(sharedLibraryRoot, 'shared-contract.pdf');
  const externalSharedPdfPath = path.join(externalSharedLibraryRoot, 'external-shared.pdf');
  const absoluteHostTextPath = path.join(rootDir, 'absolute-host-note.txt');

  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(sharedLibraryRoot, { recursive: true });
  fs.mkdirSync(externalSharedLibraryRoot, { recursive: true });

  fs.writeFileSync(localTextPath, 'hello local file');
  fs.writeFileSync(localPdfPath, '%PDF-1.7\nlocal pdf body');
  fs.writeFileSync(localCsvPath, 'Company,Amount\n启迪之星,120\n辛芮智能,88\n');
  fs.writeFileSync(attachmentTextPath, 'alpha beta gamma delta');
  fs.writeFileSync(attachmentImagePath, 'fake image bytes for vision extraction');
  fs.writeFileSync(attachmentPdfPath, `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>
endobj
  trailer
<< /Root 1 0 R >>
%%EOF`);
  fs.writeFileSync(attachmentPagedPdfPath, `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 4 /Kids [3 0 R 4 0 R 5 0 R 6 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>
endobj
5 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>
endobj
6 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF`);
  fs.writeFileSync(largeTextPath, 'x'.repeat(300 * 1024));
  fs.writeFileSync(sharedTextPath, 'shared contract note');
  fs.writeFileSync(sharedPdfPath, '%PDF-1.7\nshared pdf body');
  fs.writeFileSync(externalSharedPdfPath, '%PDF-1.7\nexternal shared pdf body');
  fs.writeFileSync(absoluteHostTextPath, 'absolute host note');
  fs.mkdirSync(path.join(workspaceDir, 'bash-visible-dir'), { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, 'bash-visible-dir', 'nested.txt'), 'bash nested file');
  fs.mkdirSync(path.join(localPythonPackageDir, 'demo_pkg'), { recursive: true });
  fs.writeFileSync(path.join(localPythonPackageDir, 'setup.py'), `from setuptools import setup
setup(name='demo-pkg', version='0.1.0', packages=['demo_pkg'])
`, 'utf8');
  fs.writeFileSync(path.join(localPythonPackageDir, 'demo_pkg', '__init__.py'), `VALUE = 'demo-installed'
`, 'utf8');
  fs.writeFileSync(failingHandlerPath, `const { createExtractionError } = require(${JSON.stringify(path.join(repoRoot, 'markitdown', 'extractor.js'))});
module.exports = async function failingHandler({ llm, profileName }) {
  if (llm && llm.model === 'primary-ocr-model') {
    throw createExtractionError('primary ocr failed', {
      code: 'ocr_safety_review_blocked',
      userMessage: 'OCR 模型触发了安全审查，当前模型无法继续提取该附件内容。',
      rawMessage: 'data_inspection_failed',
      primaryProfile: profileName,
      canRetryWithFallback: true,
    });
  }
  throw createExtractionError('fallback ocr failed', {
    code: 'ocr_request_failed',
    userMessage: 'OCR 模型请求失败，当前未能提取附件文本。',
    rawMessage: 'fallback request failed',
    primaryProfile: 'qwen-vl',
    fallbackProfile: profileName,
  });
};`, 'utf8');
  fs.writeFileSync(pagedHandlerPath, `module.exports = async function pagedHandler({ options = {} }) {
  const pageStart = Number.isFinite(options.pageStart) ? options.pageStart : 1;
  const pageCount = Number.isFinite(options.pageCount) ? options.pageCount : 0;
  const renderedPageCount = pageCount || 4;
  return Array.from({ length: renderedPageCount }, (_, index) => {
    const pageNumber = pageStart + index;
    return 'PAGE ' + pageNumber + ' :: ' + 'content '.repeat(60);
  }).join('\\n\\n');
};`, 'utf8');
  fs.writeFileSync(scrambledHeadingHandlerPath, `module.exports = async function scrambledHeadingHandler({ options = {} }) {
  const pageStart = Number.isFinite(options.pageStart) ? options.pageStart : 1;
  const pageCount = Number.isFinite(options.pageCount) ? options.pageCount : 0;
  const renderedPageCount = pageCount || 4;
  return Array.from({ length: renderedPageCount }, (_, index) => {
    const wrongHeading = index === 1 ? 1 : (pageStart + index + 5);
    return '## Page ' + wrongHeading + '\\n\\nPAGE ' + (pageStart + index) + ' :: ' + 'content '.repeat(30);
  }).join('\\n\\n');
};`, 'utf8');
  fs.writeFileSync(headingOnlyHandlerPath, `module.exports = async function headingOnlyHandler({ options = {} }) {
  const pageStart = Number.isFinite(options.pageStart) ? options.pageStart : 1;
  const pageCount = Number.isFinite(options.pageCount) ? options.pageCount : 0;
  const renderedPageCount = pageCount || 2;
  return Array.from({ length: renderedPageCount }, (_, index) => '## Page ' + (pageStart + index)).join('\\n\\n');
};`, 'utf8');

  const runtime = await createRuntimeTools({
    workspaceDir,
    projectRootDir,
    attachmentRootDir: workspaceDir,
    sharedReadRoots: [externalSharedLibraryRoot],
    skillsDir: path.join(repoRoot, 'skills'),
    mcpServers: [],
    attachmentExtraction: {
      markitdown: {
        enabled: true,
        handlerModule: mockMarkItDownHandler,
        supportedExtensions: ['.pdf'],
        maxOutputChars: 24000,
      },
      imageModel: {
        enabled: true,
        handlerModule: mockImageInspectorHandler,
        model: 'mock-image-model',
      },
    },
    workspacePython: {
      enabled: true,
      command: process.platform === 'win32' ? 'python' : 'python3',
      timeoutMs: 120000,
      maxTimeoutMs: 120000,
      allowUserPackageInstall: true,
      userVenvDir: path.join(rootDir, 'user-python-runtime'),
    },
    workspacePythonRuntime: createFakeWorkspacePythonRuntime(),
    attachments: [
      { id: 'attachment-1', name: 'user-upload.txt', path: buildAttachmentLogicalPath(workspaceDir, attachmentTextPath), kind: 'text' },
      { id: 'attachment-2', name: 'scan.pdf', path: buildAttachmentLogicalPath(workspaceDir, attachmentPdfPath) },
      { id: 'attachment-3', name: 'paged.pdf', path: buildAttachmentLogicalPath(workspaceDir, attachmentPagedPdfPath) },
      { id: 'attachment-4', name: 'avatar.png', path: buildAttachmentLogicalPath(workspaceDir, attachmentImagePath), kind: 'image' },
    ],
  });
  try {
    assert.equal(runtime.toolDisplayByName.bash.statusText, '执行命令');
    assert.equal(runtime.toolDisplayByName.inspectFile.statusText, '分析文件内容');
    assert.equal(runtime.toolDisplayByName.readFile.statusText, '读取文件内容');
    assert.equal(runtime.toolDisplayByName.stageHostPath.statusText, '复制文件到工作区');
    assert.equal(runtime.toolDisplayByName.archiveWorkspacePath.statusText, '打包工作区文件');
    assert.equal(runtime.toolDisplayByName.runPython.statusText, '运行 Python 代码');
    assert.equal(runtime.toolDisplayByName.runJavaScript.statusText, '运行 JavaScript 代码');
    assert.equal(runtime.toolDisplayByName.sendFile.statusText, '准备发送文件');
    assert.equal(runtime.toolDisplayByName.createExcelWorkbook.statusText, '生成Excel工作簿');
    assert.equal(runtime.toolDisplayByName.readSpreadsheet.statusText, '读取电子表格内容');

    if (process.platform === 'win32') {
      const wrappedCommand = wrapWindowsPowerShellCommand("Get-ChildItem -LiteralPath '\\\\server\\鍏变韩'");
      assert.match(wrappedCommand, /\[Console\]::OutputEncoding = \[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
      assert.match(wrappedCommand, /\$OutputEncoding = \[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
      assert.match(wrappedCommand, /chcp\.com 65001 > \$null/);

      assert.equal(getBlockedCommandReason("'ok' | Format-Table"), null);
      assert.match(getBlockedCommandReason('format C:'), /destructive system command/i);

      const unicodeOutput = decodeShellOutput(Buffer.from('宸茬缃插崗璁數瀛愭。', 'utf8'));
      assert.equal(unicodeOutput, '宸茬缃插崗璁數瀛愭。');
    }

    const prompt = buildBashToolPrompt(rootDir);
    assert.match(prompt, /sandboxed per-user workspace/i);
    assert.match(prompt, /cannot reach the shared host filesystem/i);
    assert.match(prompt, /stageHostPath/i);
    assert.match(prompt, /workspace:\/\//i);
    assert.match(prompt, /runPython/i);
    assert.match(runtime.promptSections.join('\n'), /inspectFile/i);
    assert.match(runtime.promptSections.join('\n'), /attachment:\/\//i);
    assert.match(runtime.promptSections.join('\n'), /readSpreadsheet/i);

    const bashListResult = await runtime.tools.bash.execute({
      command: "ls -la && printf '\\n---\\n' && ls -la bash-visible-dir && printf '\\n---\\n' && cat bash-visible-dir/nested.txt",
    });
    assert.equal(bashListResult.exitCode, 0);
    assert.match(bashListResult.stdout, /bash-visible-dir/);
    assert.match(bashListResult.stdout, /nested\.txt/);
    assert.match(bashListResult.stdout, /bash nested file/);

    const localRead = await runtime.tools.readFile.execute({ path: localTextPath });
    assert.equal(localRead.success, true);
    assert.equal(localRead.content, 'hello local file');
    assert.equal(localRead.file.path, 'workspace://notes.md');

    const workspaceInspection = await runtime.tools.inspectFile.execute({
      path: 'workspace://notes.md',
      maxChars: 5,
    });
    assert.equal(workspaceInspection.success, true);
    assert.equal(workspaceInspection.file.path, 'workspace://notes.md');
    assert.equal(workspaceInspection.file.textLike, true);
    assert.equal(workspaceInspection.preview.text, 'hello');

    const sharedLogicalRead = await runtime.tools.readFile.execute({ path: 'shared://shared-note.md' });
    assert.equal(sharedLogicalRead.content, 'shared contract note');

    const sharedRead = await runtime.tools.readFile.execute({ path: sharedTextPath });
    assert.equal(sharedRead.content, 'shared contract note');

    const absoluteHostRead = await runtime.tools.readFile.execute({ path: absoluteHostTextPath });
    assert.equal(absoluteHostRead.success, true);
    assert.equal(absoluteHostRead.content, 'absolute host note');
    assert.equal(absoluteHostRead.file.path, absoluteHostTextPath);

    const stagedShared = await runtime.tools.stageHostPath.execute({
      sourcePath: 'shared://shared-note.md',
      destinationDir: 'workspace://jobs/stage-test',
    });
    assert.equal(stagedShared.success, true);
    assert.equal(stagedShared.fileCount, 1);
    assert.match(stagedShared.destinationPath, /jobs[\\/]stage-test[\\/]shared-note\.md$/);
    assert.equal(stagedShared.workspaceRelativePath, 'jobs/stage-test/shared-note.md');
    assert.equal(stagedShared.logicalPath, 'workspace://jobs/stage-test/shared-note.md');

    const copiedRead = await runtime.tools.readFile.execute({ path: path.join(workspaceDir, 'jobs', 'stage-test', 'shared-note.md') });
    assert.equal(copiedRead.content, 'shared contract note');

    const pythonResult = await runtime.tools.runPython.execute({
      workingDirectory: 'workspace://jobs/stage-test',
      code: [
        'print(open("shared-note.md", "r", encoding="utf-8").read())',
        'open("py-out.txt", "w", encoding="utf-8").write("py-done")',
      ].join('\n'),
    });
    assert.equal(pythonResult.exitCode, 0);
    assert.equal(pythonResult.stdout.trim(), 'shared contract note');
    assert.equal(pythonResult.runtimeKind, 'user');

    const pythonOutput = await runtime.tools.readFile.execute({ path: path.join(workspaceDir, 'jobs', 'stage-test', 'py-out.txt') });
    assert.equal(pythonOutput.content, 'py-done');

    const pythonPackageResult = await runtime.tools.runPython.execute({
      workingDirectory: 'workspace://jobs/stage-test',
      packages: ['workspace://local-py-package'],
      code: [
        'import demo_pkg',
        'print(demo_pkg.VALUE)',
      ].join('\n'),
    });
    assert.equal(pythonPackageResult.exitCode, 0);
    assert.equal(pythonPackageResult.stdout.trim(), 'demo-installed');

    const pythonEscapeResult = await runtime.tools.runPython.execute({
      workingDirectory: 'workspace://jobs/stage-test',
      code: 'open("../escape.txt", "w", encoding="utf-8").write("nope")',
    });
    assert.equal(pythonEscapeResult.exitCode, 1);
    assert.match(pythonEscapeResult.stderr, /escapes workspace/i);

    const nodeResult = await runtime.tools.runJavaScript.execute({
      workingDirectory: 'workspace://jobs/stage-test',
      code: [
        "const fs = require('fs');",
        "console.log(fs.readFileSync('shared-note.md', 'utf8'));",
        "fs.writeFileSync('js-out.txt', 'js-done');",
      ].join('\n'),
    });
    assert.equal(nodeResult.exitCode, 0);
    assert.equal(nodeResult.stdout.trim(), 'shared contract note');

    const jsOutput = await runtime.tools.readFile.execute({ path: path.join(workspaceDir, 'jobs', 'stage-test', 'js-out.txt') });
    assert.equal(jsOutput.content, 'js-done');

    const archiveResult = await runtime.tools.archiveWorkspacePath.execute({
      sourcePath: 'workspace://jobs/stage-test',
      outputPath: 'workspace://jobs/stage-test.zip',
      overwrite: true,
    });
    assert.equal(archiveResult.success, true);
    assert.equal(archiveResult.logicalPath, 'workspace://jobs/stage-test.zip');
    assert.ok(archiveResult.entryCount >= 3);
    assert.ok(fs.existsSync(path.join(workspaceDir, 'jobs', 'stage-test.zip')));

    const missingCommandPath = path.join(rootDir, process.platform === 'win32' ? 'missing-python.exe' : 'missing-python');
    const missingCommandResult = await runCommand(missingCommandPath, ['--version'], {
      timeoutMs: 1000,
    });
    assert.equal(missingCommandResult.exitCode, 1);
    assert.equal(missingCommandResult.timedOut, false);
    assert.match(missingCommandResult.stderr, /not found|ENOENT|spawn/i);

    const spreadsheetRead = await runtime.tools.readSpreadsheet.execute({
      path: localCsvPath,
      maxRows: 10,
    });
    assert.equal(spreadsheetRead.success, true);
    assert.equal(spreadsheetRead.workbook.type, 'delimited');
    assert.equal(spreadsheetRead.workbook.sheets[0].headers[0], 'Company');
    assert.equal(spreadsheetRead.workbook.sheets[0].rows[0][0], '启迪之星');

    const excelOutputPath = 'workspace://jobs/stage-test/contracts-summary.xlsx';
    const excelCreateResult = await runtime.tools.createExcelWorkbook.execute({
      outputPath: excelOutputPath,
      sheets: [
        {
          name: 'Summary',
          header: ['Company', 'Amount'],
          rows: [
            ['启迪之星', 120],
            ['辛芮智能', 88],
          ],
        },
      ],
      sendToUser: true,
    });
    assert.equal(excelCreateResult.success, true);
    assert.equal(excelCreateResult.logicalPath, 'workspace://jobs/stage-test/contracts-summary.xlsx');
    assert.equal(excelCreateResult.sheetCount, 1);
    assert.ok(fs.existsSync(path.join(workspaceDir, 'jobs', 'stage-test', 'contracts-summary.xlsx')));
    assert.equal(runtime.getOutboundAttachments().some(item => /contracts-summary\.xlsx$/i.test(item.path)), true);

    const imageFailureRuntime = await createRuntimeTools({
      workspaceDir,
      projectRootDir,
      skillsDir: path.join(repoRoot, 'skills'),
      mcpServers: [],
      workspacePython: {
        enabled: true,
        command: process.platform === 'win32' ? 'python' : 'python3',
        timeoutMs: 120000,
        maxTimeoutMs: 120000,
        allowUserPackageInstall: false,
      },
      workspacePythonRuntime: {
        async runCommand(command, args = []) {
          if (args[0] === '--version') {
            return { stdout: 'Python 3.11.9\n', stderr: '', exitCode: 0, timedOut: false };
          }

          if (args[0] === '-c') {
            return {
              stdout: JSON.stringify({
                sitePackages: [path.join(rootDir, '.fake-site-packages')],
                stdlib: [path.join(rootDir, '.fake-stdlib')],
              }),
              stderr: '',
              exitCode: 0,
              timedOut: false,
            };
          }

          if ((args[0] || '').endsWith(path.join('workspace-runtime', 'generate_image.py'))) {
            return {
              stdout: JSON.stringify({
                ok: true,
                outputPath: path.join(workspaceDir, 'generated-images', 'poster.png'),
                model: 'mock-image-model',
                resolution: '1K',
              }),
              stderr: 'spawn ENOENT',
              exitCode: 0,
              timedOut: false,
            };
          }

          throw new Error(`Unexpected fake python command: ${command} ${args.join(' ')}`);
        },
        async pathExists(candidatePath) {
          return candidatePath === path.join(repoRoot, 'workspace-runtime', 'generate_image.py');
        },
      },
      imageGeneration: {
        enabled: true,
        scriptPath: path.join(repoRoot, 'workspace-runtime', 'generate_image.py'),
        outputDir: 'generated-images',
        defaultResolution: '1K',
        currentProfile: 'mock-image',
        profiles: {
          'mock-image': {
            apiKey: 'test-key',
            model: 'mock-image-model',
          },
        },
      },
    });

    try {
      await assert.rejects(
        () => imageFailureRuntime.tools.generateImage.execute({
          prompt: 'Generate a poster for FounderClaw',
          sendToUser: true,
        }),
        /finished without creating an output file[\s\S]*spawn ENOENT/i,
      );
    } finally {
      await imageFailureRuntime.close();
    }

    let receivedTimeoutMs = null;
    const fakeBashTool = createBashTool({
      bashTimeoutMs: 30000,
      maxBashTimeoutMs: 300000,
      executeCommand: async (_command, timeoutMs) => {
        receivedTimeoutMs = timeoutMs;
        return {
          stdout: '',
          stderr: `Command timed out after ${timeoutMs}ms.`,
          exitCode: 124,
          timedOut: true,
        };
      },
    }, rootDir);
    const timedOutBash = await fakeBashTool.execute({
      command: 'long-running-command',
      timeoutMs: 50,
    });
    assert.equal(receivedTimeoutMs, 50);
    assert.equal(timedOutBash.timedOut, true);
    assert.equal(timedOutBash.exitCode, 124);
    assert.match(timedOutBash.stderr, /timed out/i);

    const attachmentPathRead = await runtime.tools.readFile.execute({
      path: 'attachment://user-upload.txt',
      maxChars: 5,
    });
    assert.equal(attachmentPathRead.success, true);
    assert.equal(attachmentPathRead.content, 'alpha');
    assert.equal(attachmentPathRead.file.path, 'attachment://user-upload.txt');

    const absoluteAttachmentPdfInspection = await runtime.tools.inspectFile.execute({
      path: attachmentPdfPath,
    });
    assert.equal(absoluteAttachmentPdfInspection.success, true);
    assert.equal(absoluteAttachmentPdfInspection.file.path, 'attachment://scan.pdf');
    assert.equal(absoluteAttachmentPdfInspection.file.totalPageCount, 2);

    const largeTextRead = await runtime.tools.readFile.execute({ path: largeTextPath });
    assert.equal(largeTextRead.success, true);
    assert.equal(largeTextRead.content.length > 0, true);
    assert.equal(largeTextRead.contentTruncated, true);

    const attachmentInspection = await runtime.tools.inspectFile.execute({
      path: 'attachment-1',
      maxChars: 12,
    });
    assert.equal(attachmentInspection.success, true);
    assert.equal(attachmentInspection.file.textLike, true);
    assert.equal('preview' in attachmentInspection.file, false);
    assert.equal(attachmentInspection.preview.text, 'alpha beta g');

    const attachmentText = await runtime.tools.readFile.execute({
      path: 'attachment-1',
      maxChars: 5,
    });
    assert.equal(attachmentText.success, true);
    assert.equal(attachmentText.content, 'alpha');

    const imageInspection = await runtime.tools.inspectFile.execute({
      path: 'attachment-4',
      maxChars: 80,
    });
    assert.equal(imageInspection.success, true);
    assert.equal(imageInspection.file.kind, 'image');
    assert.equal(imageInspection.file.textLike, false);
    assert.equal(imageInspection.file.path, 'attachment://avatar.png');
    assert.equal(imageInspection.file.extraction.method, 'image-model');
    assert.equal(imageInspection.preview.model, 'mock-image-model');
    assert.match(imageInspection.preview.text, /Image summary for avatar\.png/i);

    const pdfInspection = await runtime.tools.inspectFile.execute({
      path: 'attachment-2',
    });
    assert.equal(pdfInspection.success, true);
    assert.equal(pdfInspection.file.textLike, false);
    assert.equal(pdfInspection.file.kind, 'pdf');
    assert.equal(pdfInspection.file.totalPageCount, 2);
    assert.equal(pdfInspection.file.pageRangeSupported, true);
    assert.equal('preview' in pdfInspection.file, false);
    assert.equal(pdfInspection.file.extraction.method, 'markitdown');
    assert.equal(pdfInspection.file.extraction.extractionTruncated, false);
    assert.equal(pdfInspection.preview.totalPageCount, 2);
    assert.equal(pdfInspection.preview.extractionTruncated, false);
    assert.equal(typeof pdfInspection.preview.contentTruncated, 'boolean');
    assert.match(pdfInspection.preview.text, /Converted scan\.pdf/i);
    assert.match(pdfInspection.preview.text, /Page count: 1/i);

    const pdfRead = await runtime.tools.readFile.execute({
      path: 'attachment-2',
    });
    assert.equal(pdfRead.success, true);
    assert.match(pdfRead.content, /%PDF-1\.7/i);
    assert.equal(pdfRead.cursorType, 'document-char');
    assert.equal(pdfRead.file.totalPageCount, 2);
    assert.equal('pageCount' in pdfRead.file, false);
    assert.equal(pdfRead.pageStart, 1);
    assert.equal(pdfRead.pageCount, 2);
    assert.equal(pdfRead.totalPageCount, 2);
    assert.equal(pdfRead.pageRangeSupported, true);
    assert.equal(pdfRead.file.extraction.extractionTruncated, false);
    assert.equal(typeof pdfRead.contentTruncated, 'boolean');

    const pdfSmallInspection = await runtime.tools.inspectFile.execute({
      path: 'attachment-2',
      maxChars: 200,
    });
    assert.equal(pdfSmallInspection.success, true);
    assert.equal(pdfSmallInspection.preview.previewPageStart, 1);
    assert.equal(pdfSmallInspection.preview.previewPageCount, 1);

    const pdfSinglePageRead = await runtime.tools.readFile.execute({
      path: 'attachment-2',
      pageStart: 2,
      pageCount: 1,
    });
    assert.equal(pdfSinglePageRead.success, true);
    assert.equal(pdfSinglePageRead.pageStart, 2);
    assert.equal(pdfSinglePageRead.pageCount, 1);
    assert.equal(pdfSinglePageRead.nextPageStart, 3);
    assert.equal(pdfSinglePageRead.totalPageCount, 2);

    const pagedRuntime = await createRuntimeTools({
      workspaceDir: rootDir,
      skillsDir: path.join(repoRoot, 'skills'),
      mcpServers: [],
      attachmentExtraction: {
        markitdown: {
          enabled: true,
          supportedExtensions: ['.pdf'],
          handlerModule: pagedHandlerPath,
          readPageCount: 2,
          previewPageCount: 1,
        },
      },
      attachments: [
        { id: 'attachment-3', name: 'paged.pdf', path: attachmentPagedPdfPath },
      ],
    });

    try {
      const firstPagedRead = await pagedRuntime.tools.readFile.execute({
        path: 'attachment-3',
        maxChars: 12000,
      });
      assert.equal(firstPagedRead.success, true);
      assert.equal(firstPagedRead.cursorType, 'document-char');
      assert.equal(firstPagedRead.pageStart, 1);
      assert.equal(firstPagedRead.pageCount, 2);
      assert.equal(firstPagedRead.nextPageStart, 3);
      assert.match(firstPagedRead.content, /PAGE 1/);
      assert.match(firstPagedRead.content, /PAGE 2/);

      const secondPagedRead = await pagedRuntime.tools.readFile.execute({
        path: 'attachment-3',
        offset: firstPagedRead.nextOffset,
        maxChars: 12000,
      });
      assert.equal(secondPagedRead.success, true);
      assert.equal(secondPagedRead.cursorType, 'document-char');
      assert.equal(secondPagedRead.pageStart, 3);
      assert.equal(secondPagedRead.pageCount, 2);
      assert.equal(secondPagedRead.offset, firstPagedRead.nextOffset);
      assert.equal(secondPagedRead.nextPageStart, 5);
      assert.match(secondPagedRead.content, /PAGE 3/);
      assert.match(secondPagedRead.content, /PAGE 4/);
      assert.ok(!/PAGE 1/.test(secondPagedRead.content));
    } finally {
      await pagedRuntime.close();
    }

    const scrambledHeadingRuntime = await createRuntimeTools({
      workspaceDir: rootDir,
      skillsDir: path.join(repoRoot, 'skills'),
      mcpServers: [],
      attachmentExtraction: {
        markitdown: {
          enabled: true,
          supportedExtensions: ['.pdf'],
          handlerModule: scrambledHeadingHandlerPath,
          readPageCount: 2,
          previewPageCount: 1,
        },
      },
      attachments: [
        { id: 'attachment-3', name: 'paged.pdf', path: attachmentPagedPdfPath },
      ],
    });

    try {
      const scrambledRead = await scrambledHeadingRuntime.tools.readFile.execute({
        path: 'attachment-3',
        pageStart: 3,
        pageCount: 2,
        maxChars: 12000,
      });
      assert.equal(scrambledRead.success, true);
      assert.match(scrambledRead.content, /^## Page 3\b/m);
      assert.match(scrambledRead.content, /^## Page 4\b/m);
      assert.doesNotMatch(scrambledRead.content, /^## Page 1\b/m);
      assert.doesNotMatch(scrambledRead.content, /^## Page 8\b/m);
      assert.doesNotMatch(scrambledRead.content, /^## Page 9\b/m);
    } finally {
      await scrambledHeadingRuntime.close();
    }

    const failingRuntime = await createRuntimeTools({
      workspaceDir: rootDir,
      skillsDir: path.join(repoRoot, 'skills'),
      mcpServers: [],
      attachmentExtraction: {
        markitdown: {
          enabled: true,
          supportedExtensions: ['.pdf'],
          handlerModule: failingHandlerPath,
          activeLlmProfile: 'qwen-vl',
          fallbackLlmProfile: 'legacy-openai-compatible',
          llm: {
            client: 'qwen',
            model: 'primary-ocr-model',
          },
          fallbackLlm: {
            client: 'openai',
            model: 'fallback-ocr-model',
          },
        },
      },
      attachments: [
        { id: 'attachment-2', name: 'scan.pdf', path: attachmentPdfPath },
      ],
    });

    try {
      const failedPdfRead = await failingRuntime.tools.readFile.execute({
        path: 'attachment-2',
      });
      assert.equal(failedPdfRead.success, false);
      assert.equal(failedPdfRead.errorCode, 'ocr_safety_review_blocked');
      assert.match(failedPdfRead.error, /安全审查/);
      assert.equal(failedPdfRead.fallbackAttempted, true);
      assert.equal(failedPdfRead.fallbackProfile, 'legacy-openai-compatible');
      assert.match(failedPdfRead.errorDetails, /data_inspection_failed/i);
    } finally {
      await failingRuntime.close();
    }

    const headingOnlyRuntime = await createRuntimeTools({
      workspaceDir: rootDir,
      skillsDir: path.join(repoRoot, 'skills'),
      mcpServers: [],
      attachmentExtraction: {
        markitdown: {
          enabled: true,
          supportedExtensions: ['.pdf'],
          handlerModule: headingOnlyHandlerPath,
        },
      },
      attachments: [
        { id: 'attachment-2', name: 'scan.pdf', path: attachmentPdfPath },
      ],
    });

    try {
      const headingOnlyRead = await headingOnlyRuntime.tools.readFile.execute({
        path: 'attachment-2',
      });
      assert.equal(headingOnlyRead.success, false);
      assert.equal(headingOnlyRead.errorCode, 'ocr_empty_result');
      assert.match(headingOnlyRead.error, /未识别到可用正文文本/);
      assert.match(headingOnlyRead.errorDetails, /structural markdown/i);
    } finally {
      await headingOnlyRuntime.close();
    }

    const outbound = await runtime.tools.sendFile.execute({
      path: 'workspace://local.pdf',
      name: 'result.pdf',
    });
    assert.equal(outbound.success, true);
    assert.equal(outbound.attachment.name, 'result.pdf');

    const archiveOutbound = await runtime.tools.sendFile.execute({
      path: 'workspace://jobs/stage-test.zip',
      name: 'stage-test.zip',
    });
    assert.equal(archiveOutbound.success, true);
    assert.equal(archiveOutbound.attachment.name, 'stage-test.zip');

    const sharedOutbound = await runtime.tools.sendFile.execute({
      path: sharedPdfPath,
      name: 'shared-contract.pdf',
    });
    assert.equal(sharedOutbound.success, true);
    assert.equal(sharedOutbound.attachment.name, 'shared-contract.pdf');

    const externalSharedOutbound = await runtime.tools.sendFile.execute({
      path: externalSharedPdfPath,
      name: '璧炲瓨淇℃伅-4090閲囪喘.pdf',
    });
    assert.equal(externalSharedOutbound.success, true);
    assert.equal(externalSharedOutbound.attachment.name, '璧炲瓨淇℃伅-4090閲囪喘.pdf');

    const attachmentOutbound = await runtime.tools.sendFile.execute({
      path: 'attachment://avatar.png',
      name: 'avatar.png',
    });
    assert.equal(attachmentOutbound.success, true);
    assert.equal(attachmentOutbound.attachment.name, 'avatar.png');
    assert.equal(attachmentOutbound.attachment.path, attachmentImagePath);

    await assert.rejects(
      () => runtime.tools.readFile.execute({ path: path.join('..', 'outside.txt') }),
      /escapes the user workspace/i,
    );

    assert.deepEqual(runtime.getOutboundAttachments(), [{
      path: path.join(workspaceDir, 'jobs', 'stage-test', 'contracts-summary.xlsx'),
      name: 'contracts-summary.xlsx',
      sizeBytes: fs.statSync(path.join(workspaceDir, 'jobs', 'stage-test', 'contracts-summary.xlsx')).size,
    }, {
      path: localPdfPath,
      name: 'result.pdf',
      sizeBytes: fs.statSync(localPdfPath).size,
    }, {
      path: path.join(workspaceDir, 'jobs', 'stage-test.zip'),
      name: 'stage-test.zip',
      sizeBytes: fs.statSync(path.join(workspaceDir, 'jobs', 'stage-test.zip')).size,
    }, {
      path: sharedPdfPath,
      name: 'shared-contract.pdf',
      sizeBytes: fs.statSync(sharedPdfPath).size,
    }, {
      path: externalSharedPdfPath,
      name: '璧炲瓨淇℃伅-4090閲囪喘.pdf',
      sizeBytes: fs.statSync(externalSharedPdfPath).size,
    }, {
      path: attachmentImagePath,
      name: 'avatar.png',
      sizeBytes: fs.statSync(attachmentImagePath).size,
    }]);
  } finally {
    await runtime.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }

  const originalFetch = global.fetch;
  const imageInspectorRootDir = makeTempDir('image-inspector-http-');
  const imageInspectorPath = path.join(imageInspectorRootDir, 'vision.png');
  try {
    fs.writeFileSync(imageInspectorPath, 'http image bytes');
    let requestBody = null;
    global.fetch = async (_url, options = {}) => {
      requestBody = JSON.parse(String(options.body || '{}'));
      return {
        ok: true,
        async json() {
          return {
            choices: [{
              message: {
                content: 'Vision summary',
              },
            }],
          };
        },
      };
    };

    const httpImageInspector = createImageInspector({
      enabled: true,
      model: 'vision-test-model',
      baseURL: 'http://example.invalid/v1',
      apiKey: 'test-key',
      thinking: {
        enabled: true,
        reasoningEffort: 'medium',
      },
    });

    const inspected = await httpImageInspector.inspect({
      resolvedPath: imageInspectorPath,
      mimeType: 'image/png',
    });

    assert.equal(inspected.model, 'vision-test-model');
    assert.equal(inspected.text, 'Vision summary');
    assert.equal(requestBody.model, 'vision-test-model');
    assert.equal(requestBody.reasoning_effort, 'medium');
    assert.equal(requestBody.messages[0].content[0].text.length > 0, true);
    assert.equal('enable_thinking' in requestBody, false);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(imageInspectorRootDir, { recursive: true, force: true });
  }

  const timeoutRootDir = makeTempDir('image-inspector-timeout-');
  const timeoutImagePath = path.join(timeoutRootDir, 'slow.png');
  try {
    fs.writeFileSync(timeoutImagePath, 'slow image bytes');
    global.fetch = async (_url, options = {}) => new Promise((_, reject) => {
      options.signal?.addEventListener('abort', () => {
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';
        reject(abortError);
      }, { once: true });
    });

    const timeoutImageInspector = createImageInspector({
      enabled: true,
      model: 'vision-timeout-model',
      baseURL: 'http://example.invalid/v1',
      apiKey: 'test-key',
      timeoutMs: 10,
    });

    await assert.rejects(
      () => timeoutImageInspector.inspect({
        resolvedPath: timeoutImagePath,
        mimeType: 'image/png',
      }),
      /Image inspection timed out after 10ms\./i,
    );

    assert.equal(DEFAULT_IMAGE_INSPECTION_TIMEOUT_MS, 30000);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(timeoutRootDir, { recursive: true, force: true });
  }
};



