const fs = require('fs/promises');
const path = require('path');
const { buildAttachmentLogicalPath } = require('../../user-space');
const { createMarkItDownExtractor } = require('../../markitdown/extractor');
const { getPdfInfo } = require('../../markitdown/pdf-info');
const { createImageInspector } = require('./image-inspector');

const MAX_LOCAL_TEXT_FILE_BYTES = 256 * 1024;
const MAX_LOCAL_TEXT_CHARS = 20000;
const DEFAULT_ATTACHMENT_PREVIEW_CHARS = 2000;
const MAX_ATTACHMENT_PREVIEW_CHARS = 4000;
const DEFAULT_ATTACHMENT_TEXT_CHARS = 4000;
const MAX_ATTACHMENT_TEXT_CHARS = 12000;
const SAMPLE_BYTES = 8192;
const MAX_ATTACHMENT_CHUNK_BYTES = 48 * 1024;
const LOGICAL_SHARED_PREFIX = 'shared://';

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.jsonl', '.yaml', '.yml', '.xml', '.csv', '.tsv', '.log',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.java', '.go', '.rs',
  '.sql', '.sh', '.ps1', '.html', '.css', '.scss', '.toml', '.ini', '.env',
]);

const BINARY_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.mp3', '.wav', '.ogg', '.aac', '.m4a',
  '.mp4', '.mov', '.avi', '.mkv',
  '.zip', '.rar', '.7z', '.tar', '.gz',
]);

const MIME_BY_EXTENSION = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.cjs': 'application/javascript',
  '.py': 'text/x-python',
  '.html': 'text/html',
  '.css': 'text/css',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
};

function inferMime(extension) {
  return MIME_BY_EXTENSION[extension] || '';
}

function inferKind(extension, mimeType = '') {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (extension === '.pdf') return 'pdf';
  if (['.doc', '.docx'].includes(extension)) return 'document';
  if (['.xls', '.xlsx', '.csv', '.tsv'].includes(extension)) return 'spreadsheet';
  if (['.ppt', '.pptx'].includes(extension)) return 'presentation';
  if (TEXT_EXTENSIONS.has(extension) || mimeType.startsWith('text/')) return 'text';
  return 'file';
}

function truncateText(value, maxChars) {
  if (value.length <= maxChars) {
    return { text: value, contentTruncated: false };
  }
  return { text: value.slice(0, maxChars), contentTruncated: true };
}

async function readBufferChunk(resolvedPath, start = 0, length = SAMPLE_BYTES) {
  const handle = await fs.open(resolvedPath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function looksLikeUtf8Text(buffer) {
  if (!buffer || buffer.length === 0) return true;
  if (buffer.includes(0x00)) return false;
  const text = buffer.toString('utf8');
  if (text.includes('\uFFFD')) return false;
  let printable = 0;
  for (const char of Array.from(text)) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || code >= 32) printable += 1;
  }
  return printable / text.length >= 0.9;
}

function isTextLike(extension, mimeType, sampleBuffer) {
  if (BINARY_EXTENSIONS.has(extension)) return false;
  if (TEXT_EXTENSIONS.has(extension)) return true;
  if (mimeType.startsWith('text/') || ['application/json', 'application/xml', 'application/javascript'].includes(mimeType)) return true;
  return looksLikeUtf8Text(sampleBuffer);
}

function isPathInside(baseDir, candidatePath) {
  const relativePath = path.relative(path.resolve(baseDir), path.resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function buildSharedLogicalPath(sharedRoot, resolvedPath) {
  const relativePath = path.relative(sharedRoot, resolvedPath).split(path.sep).join(path.posix.sep);
  return `${LOGICAL_SHARED_PREFIX}${relativePath}`;
}

function buildLogicalPathForResolvedPath({
  workspaceDir = '',
  attachmentRootDir = '',
  primarySharedRoot = '',
  resolvedPath,
}) {
  if (workspaceDir && isPathInside(workspaceDir, resolvedPath)) {
    const relativePath = path.relative(workspaceDir, resolvedPath).split(path.sep).join(path.posix.sep);
    return `workspace://${relativePath}`;
  }

  if (attachmentRootDir && isPathInside(attachmentRootDir, resolvedPath)) {
    return buildAttachmentLogicalPath(attachmentRootDir, resolvedPath);
  }

  if (primarySharedRoot && isPathInside(primarySharedRoot, resolvedPath)) {
    return buildSharedLogicalPath(primarySharedRoot, resolvedPath);
  }

  return '';
}

function normalizeAttachments(attachments = [], workspaceDir, resolveRequestedPath, attachmentRootDir = '') {
  return attachments.map((attachment, index) => {
    const inputPath = typeof attachment?.path === 'string' ? attachment.path : '';
    const resolvedPath = inputPath ? resolveRequestedPath(workspaceDir, inputPath) : '';
    const extension = String(attachment?.extension || path.extname(resolvedPath || attachment?.name || '')).toLowerCase();
    const mimeType = attachment?.mimeType || attachment?.mime || inferMime(extension);
    const logicalPath = typeof attachment?.logicalPath === 'string' && attachment.logicalPath.trim().length > 0
      ? attachment.logicalPath.trim()
      : (attachmentRootDir && resolvedPath && isPathInside(attachmentRootDir, resolvedPath)
        ? buildAttachmentLogicalPath(attachmentRootDir, resolvedPath)
        : inputPath);
    return {
      ...attachment,
      id: attachment?.id || `attachment-${index + 1}`,
      name: attachment?.name || path.basename(resolvedPath || `attachment-${index + 1}`),
      path: logicalPath,
      logicalPath,
      resolvedPath,
      extension,
      mimeType,
      kind: attachment?.kind || inferKind(extension, mimeType),
    };
  });
}

async function enrichAttachmentMetadata(attachments = [], workspaceDir, resolveRequestedPath, attachmentRootDir = '') {
  const normalized = normalizeAttachments(attachments, workspaceDir, resolveRequestedPath, attachmentRootDir);
  const enriched = [];

  for (const attachment of normalized) {
    if (attachment.extension === '.pdf' && attachment.resolvedPath) {
      try {
        const pdfInfo = await getPdfInfo(attachment.resolvedPath);
        enriched.push({
          ...attachment,
          ...(typeof pdfInfo.pageCount === 'number' ? {
            pageCount: pdfInfo.pageCount,
            pageRangeSupported: true,
          } : {}),
        });
        continue;
      } catch {
        enriched.push(attachment);
        continue;
      }
    }

    enriched.push(attachment);
  }

  return enriched;
}

function createAttachmentIndex(attachments) {
  const byId = new Map();
  const byPath = new Map();
  const byName = new Map();
  for (const attachment of attachments) {
    byId.set(attachment.id, attachment);
    if (attachment.resolvedPath) byPath.set(path.normalize(attachment.resolvedPath), attachment);
    const sameName = byName.get(attachment.name) || [];
    sameName.push(attachment);
    byName.set(attachment.name, sameName);
  }
  return { items: attachments, byId, byPath, byName };
}

function buildResolvedFileReference({
  requestedPath = '',
  resolvedPath,
  workspaceDir = '',
  attachmentRootDir = '',
  primarySharedRoot = '',
  attachmentIndex = null,
}) {
  const normalizedResolvedPath = path.normalize(resolvedPath);
  const indexedAttachment = attachmentIndex?.byPath?.get(normalizedResolvedPath);

  if (indexedAttachment) {
    return indexedAttachment;
  }

  const extension = String(path.extname(normalizedResolvedPath || requestedPath || '')).toLowerCase();
  const mimeType = inferMime(extension);
  const logicalPath = buildLogicalPathForResolvedPath({
    workspaceDir,
    attachmentRootDir,
    primarySharedRoot,
    resolvedPath: normalizedResolvedPath,
  });
  const preferredPath = logicalPath
    || (path.isAbsolute(requestedPath) ? path.normalize(requestedPath) : normalizedResolvedPath);

  return {
    id: '',
    name: path.basename(normalizedResolvedPath),
    path: preferredPath,
    logicalPath,
    resolvedPath: normalizedResolvedPath,
    extension,
    mimeType,
    kind: inferKind(extension, mimeType),
  };
}

async function inspectResolvedFile(fileReference, previewChars = DEFAULT_ATTACHMENT_PREVIEW_CHARS, extractor = null, imageInspector = null) {
  const stat = await fs.stat(fileReference.resolvedPath);
  const sampleBuffer = await readBufferChunk(fileReference.resolvedPath, 0, SAMPLE_BYTES);
  const mimeType = fileReference.mimeType || inferMime(fileReference.extension) || (looksLikeUtf8Text(sampleBuffer) ? 'text/plain' : 'application/octet-stream');
  const textLike = isTextLike(fileReference.extension, mimeType, sampleBuffer);
  const markitdownCapable = extractor && extractor.canExtract(fileReference);
  const imageInspectable = imageInspector && imageInspector.canInspect(fileReference);
  const result = {
    id: fileReference.id,
    name: fileReference.name,
    path: fileReference.logicalPath || fileReference.path || fileReference.resolvedPath,
    extension: fileReference.extension,
    mimeType,
    kind: fileReference.kind || inferKind(fileReference.extension, mimeType),
    sizeBytes: Number.isFinite(fileReference.sizeBytes) ? fileReference.sizeBytes : stat.size,
    textLike,
    extraction: textLike
      ? { available: true, method: 'direct-text' }
      : (imageInspectable
        ? { available: true, method: 'image-model' }
        : (markitdownCapable
        ? { available: true, method: 'markitdown' }
        : { available: false, method: 'none' })),
  };
  if (fileReference.extension === '.pdf') {
    const pdfInfo = await getPdfInfo(fileReference.resolvedPath);
    if (typeof pdfInfo.pageCount === 'number') {
      result.totalPageCount = pdfInfo.pageCount;
      result.pageRangeSupported = true;
    }
  }
  if (previewChars > 0 && textLike) {
    result.preview = await readDirectTextChunk(fileReference.resolvedPath, stat.size, 0, previewChars);
  } else if (previewChars > 0 && imageInspectable) {
    const inspected = await imageInspector.inspect(fileReference);
    result.preview = {
      ...truncateText(inspected.text, previewChars),
      cursorType: 'char',
      method: 'image-model',
      model: inspected.model,
      offset: 0,
      nextOffset: inspected.text.length,
      totalChars: inspected.text.length,
      truncated: inspected.text.length > previewChars,
    };
    result.extraction.model = inspected.model;
  } else if (previewChars > 0 && markitdownCapable) {
    const extracted = await extractor.extract(fileReference, {
      pageStart: 1,
      pageCount: fileReference.extension === '.pdf'
        ? Math.max(1, extractor.previewPageCount || 1)
        : 0,
    });
    result.preview = readExtractedText(extracted.markdown, 0, previewChars);
    result.preview.cursorType = 'char';
    result.preview.method = 'markitdown';
    result.preview.extractionTruncated = extracted.truncated;
    if (Number.isFinite(result.totalPageCount)) {
      result.preview.totalPageCount = result.totalPageCount;
    }
    if (typeof extracted.pageStart === 'number') {
      result.preview.previewPageStart = extracted.pageStart;
    }
    if (typeof extracted.pageCount === 'number' && extracted.pageCount > 0) {
      result.preview.previewPageCount = extracted.pageCount;
    }
    result.extraction.extractionTruncated = extracted.truncated;
    result.extraction.truncated = extracted.truncated;
  }
  return result;
}

async function readDirectTextChunk(resolvedPath, totalBytes, offset = 0, maxChars = DEFAULT_ATTACHMENT_TEXT_CHARS) {
  const buffer = await readBufferChunk(resolvedPath, Math.max(0, offset), Math.min(MAX_ATTACHMENT_CHUNK_BYTES, Math.max(4096, maxChars * 4)));
  const text = truncateText(buffer.toString('utf8'), Math.min(MAX_ATTACHMENT_TEXT_CHARS, maxChars));
  const contentTruncated = text.contentTruncated || offset + buffer.length < totalBytes;
  return {
    text: text.text,
    contentTruncated,
    truncated: contentTruncated,
    offset: Math.max(0, offset),
    nextOffset: Math.max(0, offset) + buffer.length,
    totalBytes,
  };
}

function readExtractedText(text, offset = 0, maxChars = DEFAULT_ATTACHMENT_TEXT_CHARS) {
  const safeOffset = Math.max(0, offset);
  const limit = Math.min(MAX_ATTACHMENT_TEXT_CHARS, maxChars);
  const chunk = text.slice(safeOffset, safeOffset + limit);

  return {
    text: chunk,
    contentTruncated: safeOffset + limit < text.length,
    truncated: safeOffset + limit < text.length,
    offset: safeOffset,
    nextOffset: safeOffset + chunk.length,
    totalChars: text.length,
  };
}

async function readPagedExtractedTextWithDocumentOffset({
  extractor,
  target,
  inspection,
  offset = 0,
  maxChars = DEFAULT_ATTACHMENT_TEXT_CHARS,
}) {
  const effectiveOffset = Math.max(0, offset);
  const pageStep = Math.max(1, extractor.readPageCount || 1);
  const totalPageCount = Number.isFinite(inspection.totalPageCount) ? inspection.totalPageCount : 0;
  let remainingOffset = effectiveOffset;
  let currentPageStart = 1;

  while (totalPageCount <= 0 || currentPageStart <= totalPageCount) {
    const selectedPageCount = totalPageCount > 0
      ? Math.min(pageStep, totalPageCount - currentPageStart + 1)
      : pageStep;
    const extracted = await extractor.extract(target, {
      pageStart: currentPageStart,
      pageCount: selectedPageCount,
    });
    const extractedText = String(extracted.markdown || '');
    const effectivePageCount = Math.max(1, extracted.pageCount || selectedPageCount || pageStep);
    const lastWindow = totalPageCount > 0
      ? (currentPageStart + effectivePageCount - 1) >= totalPageCount
      : true;

    if (remainingOffset < extractedText.length || lastWindow || extractedText.length === 0) {
      const localChunk = readExtractedText(extractedText, remainingOffset, maxChars);
      const consumedBeforeChunk = effectiveOffset - remainingOffset;
      return {
        extracted,
        chunk: {
          text: localChunk.text,
          contentTruncated: localChunk.contentTruncated,
          truncated: localChunk.truncated,
          offset: effectiveOffset,
          nextOffset: consumedBeforeChunk + localChunk.nextOffset,
          totalChars: null,
        },
      };
    }

    remainingOffset -= extractedText.length;
    currentPageStart += effectivePageCount;
  }

  return {
    extracted: {
      markdown: '',
      pageStart: totalPageCount || 1,
      pageCount: 0,
      truncated: false,
    },
    chunk: {
      text: '',
      contentTruncated: false,
      truncated: false,
      offset: effectiveOffset,
      nextOffset: effectiveOffset,
      totalChars: null,
    },
  };
}

function splitFileInspection(inspection) {
  if (!inspection || typeof inspection !== 'object') {
    return {
      file: inspection,
      preview: null,
    };
  }

  const { preview = null, ...file } = inspection;
  return {
    file,
    preview,
  };
}

function buildFileExtractionFailurePayload(inspection, error) {
  const errorCode = typeof error?.code === 'string' && error.code.trim().length > 0
    ? error.code.trim()
    : 'file_extraction_failed';
  const userMessage = typeof error?.userMessage === 'string' && error.userMessage.trim().length > 0
    ? error.userMessage.trim()
    : `Text extraction failed for "${inspection.name}".`;
  const rawMessage = typeof error?.rawMessage === 'string' && error.rawMessage.trim().length > 0
    ? error.rawMessage.trim()
    : String(error?.message || userMessage);

  return {
    success: false,
    error: `${userMessage} 文件: "${inspection.name}"。`,
    errorCode,
    errorDetails: rawMessage,
    fallbackErrorCode: error?.fallbackErrorCode || null,
    primaryProfile: error?.primaryProfile || null,
    fallbackProfile: error?.fallbackProfile || null,
    fallbackAttempted: error?.fallbackAttempted === true,
    file: inspection,
  };
}

function resolvePdfPageSelection(_inspection, pageStart, pageCount, defaultPageCount) {
  const selectedPageCount = pageCount || defaultPageCount || 0;

  if (pageStart) {
    return {
      pageStart,
      pageCount: selectedPageCount,
    };
  }

  return {
    pageStart: 1,
    pageCount: selectedPageCount,
  };
}

async function assertReadableLocalTextFile(resolvedPath) {
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile()) throw new Error(`Not a file: ${resolvedPath}`);
  if (stat.size > MAX_LOCAL_TEXT_FILE_BYTES) {
    throw new Error(`Refusing to read ${resolvedPath} with readFile because it is too large (${stat.size} bytes).`);
  }
  const extension = path.extname(resolvedPath).toLowerCase();
  const mimeType = inferMime(extension);
  const sampleBuffer = await readBufferChunk(resolvedPath, 0, SAMPLE_BYTES);
  if (!isTextLike(extension, mimeType, sampleBuffer)) {
    throw new Error(`Refusing to read ${resolvedPath} with readFile because it is not a plain text file.`);
  }
  return { sizeBytes: stat.size };
}

async function readResolvedFile({
  target,
  extractor,
  imageInspector,
  offset = 0,
  maxChars = DEFAULT_ATTACHMENT_TEXT_CHARS,
  pageStart,
  pageCount,
}) {
  const inspection = await inspectResolvedFile(target, 0, null, imageInspector);

  if (!inspection.textLike) {
    if (imageInspector.canInspect(target)) {
      try {
        const inspected = await imageInspector.inspect(target);
        const content = truncateText(inspected.text, Math.min(MAX_ATTACHMENT_TEXT_CHARS, maxChars ?? DEFAULT_ATTACHMENT_TEXT_CHARS));
        return {
          success: true,
          file: {
            ...inspection,
            extraction: {
              available: true,
              method: 'image-model',
              model: inspected.model,
            },
          },
          content: content.text,
          contentTruncated: content.contentTruncated,
          truncated: content.contentTruncated,
          offset: 0,
          nextOffset: inspected.text.length,
          totalChars: inspected.text.length,
          cursorType: 'char',
        };
      } catch (error) {
        return buildFileExtractionFailurePayload({
          ...inspection,
          extraction: {
            available: false,
            method: 'image-model',
          },
        }, error);
      }
    }

    if (!extractor.canExtract(target)) {
      return { success: false, error: `File "${inspection.name}" is not a plain text-like file.`, file: inspection };
    }

    try {
      const useImplicitPagedCursor = target.extension === '.pdf'
        && inspection.pageRangeSupported === true
        && !pageStart
        && !pageCount;
      const pageSelection = target.extension === '.pdf'
        ? resolvePdfPageSelection(inspection, pageStart, pageCount, extractor.readPageCount)
        : { pageStart: pageStart || 1, pageCount: pageCount || 0 };
      let extracted;
      let chunk;

      if (useImplicitPagedCursor) {
        const pagedRead = await readPagedExtractedTextWithDocumentOffset({
          extractor,
          target,
          inspection,
          offset: offset ?? 0,
          maxChars: maxChars ?? DEFAULT_ATTACHMENT_TEXT_CHARS,
        });
        extracted = pagedRead.extracted;
        chunk = pagedRead.chunk;
      } else {
        extracted = await extractor.extract(target, {
          pageStart: pageSelection.pageStart,
          pageCount: pageSelection.pageCount,
        });
        chunk = readExtractedText(extracted.markdown, offset ?? 0, maxChars ?? DEFAULT_ATTACHMENT_TEXT_CHARS);
      }

      const selectedPageStart = pageSelection.pageStart;
      const selectedPageCount = pageSelection.pageCount;
      return {
        success: true,
        file: {
          ...inspection,
          extraction: {
            available: true,
            method: 'markitdown',
            extractionTruncated: extracted.truncated,
            truncated: extracted.truncated,
          },
        },
        content: chunk.text,
        contentTruncated: chunk.contentTruncated,
        truncated: chunk.truncated,
        offset: chunk.offset,
        nextOffset: chunk.nextOffset,
        totalChars: chunk.totalChars,
        cursorType: useImplicitPagedCursor ? 'document-char' : 'char',
        pageStart: extracted.pageStart || selectedPageStart,
        pageCount: extracted.pageCount || selectedPageCount || null,
        nextPageStart: extracted.pageCount ? (extracted.pageStart + extracted.pageCount) : null,
        totalPageCount: inspection.totalPageCount || null,
        pageRangeSupported: inspection.pageRangeSupported === true,
      };
    } catch (error) {
      return buildFileExtractionFailurePayload(inspection, error);
    }
  }

  const chunk = await readDirectTextChunk(target.resolvedPath, inspection.sizeBytes, offset ?? 0, maxChars ?? DEFAULT_ATTACHMENT_TEXT_CHARS);
  return {
    success: true,
    file: {
      ...inspection,
      extraction: {
        available: true,
        method: 'direct-text',
      },
    },
    content: chunk.text,
    contentTruncated: chunk.contentTruncated,
    truncated: chunk.truncated,
    offset: chunk.offset,
    nextOffset: chunk.nextOffset,
    totalBytes: chunk.totalBytes,
    cursorType: 'byte',
  };
}

function createAttachmentTools(attachments, workspaceDir, resolveRequestedPath, attachmentExtraction = {}, options = {}) {
  const index = createAttachmentIndex(attachments);
  const attachmentRootDir = typeof options.attachmentRootDir === 'string' ? options.attachmentRootDir : '';
  const primarySharedRoot = typeof options.primarySharedRoot === 'string' ? options.primarySharedRoot : '';
  const resolveHostFilePath = typeof options.resolveHostFilePath === 'function'
    ? options.resolveHostFilePath
    : (requestedPath => resolveRequestedPath(workspaceDir, requestedPath));
  const markitdownConfig = {
    ...(attachmentExtraction.markitdown || {}),
  };
  const cacheConfig = markitdownConfig.cache && typeof markitdownConfig.cache === 'object' && !Array.isArray(markitdownConfig.cache)
    ? markitdownConfig.cache
    : {};
  markitdownConfig.cache = {
    enabled: cacheConfig.enabled !== false,
    dbPath: typeof cacheConfig.dbPath === 'string' && cacheConfig.dbPath.trim().length > 0
      ? cacheConfig.dbPath
      : path.join(workspaceDir, 'data', 'attachment-extraction-cache.db'),
  };
  const extractor = createMarkItDownExtractor(markitdownConfig);
  const imageInspector = createImageInspector(
    attachmentExtraction.imageModel || {},
    attachmentExtraction.agentModelFallback || {},
  );
  extractor.previewPageCount = markitdownConfig.previewPageCount || 1;
  extractor.readPageCount = markitdownConfig.readPageCount || 2;

  function resolveFileReferenceByPath(requestedPath) {
    const resolvedPath = resolveHostFilePath(requestedPath);
    return buildResolvedFileReference({
      requestedPath,
      resolvedPath,
      workspaceDir,
      attachmentRootDir,
      primarySharedRoot,
      attachmentIndex: index,
    });
  }

  function resolveFileReference(requestedReference) {
    if (!requestedReference || !String(requestedReference).trim()) {
      if (index.items.length === 1) {
        return index.items[0];
      }

      if (index.items.length > 1) {
        throw new Error('File path or attachment identifier is required when multiple attachments are present.');
      }

      throw new Error('File path is required.');
    }

    const key = String(requestedReference).trim();

    if (index.byId.has(key)) {
      return index.byId.get(key);
    }

    const named = index.byName.get(key) || [];
    if (named.length === 1) {
      return named[0];
    }

    if (named.length > 1) {
      throw new Error(`Multiple attachments are named "${key}". Use a path or attachment id instead.`);
    }

    return resolveFileReferenceByPath(key);
  }

  async function inspectAnyFile(target, maxChars) {
    let inspection;

    try {
      inspection = await inspectResolvedFile(target, maxChars ?? DEFAULT_ATTACHMENT_PREVIEW_CHARS, {
        ...extractor,
        extract: (currentAttachment, extractorOptions = {}) => extractor.extract(currentAttachment, {
          pageStart: extractorOptions.pageStart || 1,
          pageCount: extractorOptions.pageCount || 0,
        }),
      }, imageInspector);
    } catch (error) {
      inspection = await inspectResolvedFile(target, 0, null, null);
      inspection.extraction = {
        available: false,
        method: target.kind === 'image'
          ? 'image-model'
          : (target.kind === 'text' ? 'direct-text' : 'markitdown'),
        error: error.message,
      };
    }

    const separated = splitFileInspection(inspection);
    return {
      success: true,
      file: separated.file,
      preview: separated.preview,
    };
  }

  async function readAnyFile(target, readOptions = {}) {
    return readResolvedFile({
      target,
      extractor,
      imageInspector,
      offset: readOptions.offset,
      maxChars: readOptions.maxChars,
      pageStart: readOptions.pageStart,
      pageCount: readOptions.pageCount,
    });
  }

  return {
    attachmentIndex: index,
    inspectFileByPath: async (requestedPath, maxChars) => inspectAnyFile(resolveFileReference(requestedPath), maxChars),
    readFileByPath: async (requestedPath, readOptions = {}) => readAnyFile(resolveFileReference(requestedPath), readOptions),
    toolNames: [],
    toolDisplayByName: {},
    close: async () => {
      if (typeof extractor.close === 'function') {
        extractor.close();
      }
    },
    tools: {},
  };
}

function buildAttachmentsPrompt(attachments) {
  if (!attachments || attachments.length === 0) return '';
  const lines = attachments.map(attachment => `- id=${attachment.id}, name=${attachment.name}, path=${attachment.logicalPath || attachment.path || attachment.resolvedPath}, kind=${attachment.kind}${attachment.mimeType ? `, mime=${attachment.mimeType}` : ''}`);
  return [
    'Attachments',
    'These user-provided attachments are currently available in the conversation, including files from earlier turns that may still be relevant.',
    'Do not treat the presence of an attachment as a reason to inspect it immediately.',
    'First decide the concrete task from the latest message and prior conversation.',
    'If the task is ambiguous, ask a clarifying question before touching the attachment.',
    'Use `inspectFile` or `readFile` only after the task is clear and file access is actually needed.',
    'For supported document formats, `readFile` may convert the file to Markdown before returning a bounded chunk.',
    'For image files, `inspectFile` or `readFile` may call a multimodal model to summarize visible content and readable text.',
    'Prefer `inspectFile` before `readFile` when you only need file type, page range, metadata, or a small preview.',
    'Once file access is justified, prefer fewer, larger reads and continue searching instead of stopping after the first chunk.',
    'For contracts and similar business documents, extract likely key fields yourself only after file access is justified.',
    'Ask the user for missing details only after a reasonable file search fails.',
    'You can pass current-conversation attachment ids, attachment names, `attachment://...`, `workspace://...`, supported shared paths, or absolute paths to `inspectFile` and `readFile`.',
    ...lines,
  ].join('\n');
}

module.exports = {
  MAX_LOCAL_TEXT_CHARS,
  assertReadableLocalTextFile,
  buildAttachmentsPrompt,
  buildResolvedFileReference,
  createAttachmentTools,
  enrichAttachmentMetadata,
  inspectResolvedFile,
  normalizeAttachments,
  readResolvedFile,
};
