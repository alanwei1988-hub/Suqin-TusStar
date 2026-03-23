const fs = require('fs/promises');
const path = require('path');
const { tool } = require('ai');
const { z } = require('zod');
const { createMarkItDownExtractor } = require('../../markitdown/extractor');
const { getPdfInfo } = require('../../markitdown/pdf-info');
const { createToolDisplayInfo } = require('./display');

const MAX_LOCAL_TEXT_FILE_BYTES = 256 * 1024;
const MAX_LOCAL_TEXT_CHARS = 20000;
const DEFAULT_ATTACHMENT_PREVIEW_CHARS = 2000;
const MAX_ATTACHMENT_PREVIEW_CHARS = 4000;
const DEFAULT_ATTACHMENT_TEXT_CHARS = 4000;
const MAX_ATTACHMENT_TEXT_CHARS = 12000;
const SAMPLE_BYTES = 8192;
const MAX_ATTACHMENT_CHUNK_BYTES = 48 * 1024;

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

function normalizeAttachments(attachments = [], workspaceDir, resolveRequestedPath) {
  return attachments.map((attachment, index) => {
    const inputPath = typeof attachment?.path === 'string' ? attachment.path : '';
    const resolvedPath = inputPath ? resolveRequestedPath(workspaceDir, inputPath) : '';
    const extension = String(attachment?.extension || path.extname(resolvedPath || attachment?.name || '')).toLowerCase();
    const mimeType = attachment?.mimeType || attachment?.mime || inferMime(extension);
    return {
      ...attachment,
      id: attachment?.id || `attachment-${index + 1}`,
      name: attachment?.name || path.basename(resolvedPath || `attachment-${index + 1}`),
      path: inputPath,
      resolvedPath,
      extension,
      mimeType,
      kind: attachment?.kind || inferKind(extension, mimeType),
    };
  });
}

async function enrichAttachmentMetadata(attachments = [], workspaceDir, resolveRequestedPath) {
  const normalized = normalizeAttachments(attachments, workspaceDir, resolveRequestedPath);
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

function resolveAttachment(index, workspaceDir, resolveRequestedPath, reference) {
  if (index.items.length === 0) throw new Error('No user-provided attachments are available in the current conversation.');
  if (!reference || !String(reference).trim()) {
    if (index.items.length === 1) return index.items[0];
    throw new Error('Attachment identifier is required when multiple attachments are present.');
  }
  const key = String(reference).trim();
  if (index.byId.has(key)) return index.byId.get(key);
  try {
    const resolvedPath = resolveRequestedPath(workspaceDir, key);
    if (index.byPath.has(path.normalize(resolvedPath))) return index.byPath.get(path.normalize(resolvedPath));
  } catch {}
  const named = index.byName.get(key) || [];
  if (named.length === 1) return named[0];
  if (named.length > 1) throw new Error(`Multiple attachments are named "${key}". Use the attachment id instead.`);
  throw new Error(`Attachment "${key}" was not found.`);
}

async function inspectAttachmentFile(attachment, previewChars = DEFAULT_ATTACHMENT_PREVIEW_CHARS, extractor = null) {
  const stat = await fs.stat(attachment.resolvedPath);
  const sampleBuffer = await readBufferChunk(attachment.resolvedPath, 0, SAMPLE_BYTES);
  const mimeType = attachment.mimeType || inferMime(attachment.extension) || (looksLikeUtf8Text(sampleBuffer) ? 'text/plain' : 'application/octet-stream');
  const textLike = isTextLike(attachment.extension, mimeType, sampleBuffer);
  const markitdownCapable = extractor && extractor.canExtract(attachment);
  const result = {
    id: attachment.id,
    name: attachment.name,
    path: attachment.resolvedPath,
    extension: attachment.extension,
    mimeType,
    kind: attachment.kind || inferKind(attachment.extension, mimeType),
    sizeBytes: Number.isFinite(attachment.sizeBytes) ? attachment.sizeBytes : stat.size,
    textLike,
    extraction: textLike
      ? { available: true, method: 'direct-text' }
      : (markitdownCapable
        ? { available: true, method: 'markitdown' }
        : { available: false, method: 'none' }),
  };
  if (attachment.extension === '.pdf') {
    const pdfInfo = await getPdfInfo(attachment.resolvedPath);
    if (typeof pdfInfo.pageCount === 'number') {
      result.totalPageCount = pdfInfo.pageCount;
      result.pageRangeSupported = true;
    }
  }
  if (previewChars > 0 && textLike) {
    result.preview = await readAttachmentText(attachment.resolvedPath, stat.size, 0, previewChars);
  } else if (previewChars > 0 && markitdownCapable) {
    const extracted = await extractor.extract(attachment, {
      pageStart: 1,
      pageCount: attachment.extension === '.pdf'
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

async function readAttachmentText(resolvedPath, totalBytes, offset = 0, maxChars = DEFAULT_ATTACHMENT_TEXT_CHARS) {
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

function splitAttachmentInspection(inspection) {
  if (!inspection || typeof inspection !== 'object') {
    return {
      attachment: inspection,
      preview: null,
    };
  }

  const { preview = null, ...attachment } = inspection;
  return {
    attachment,
    preview,
  };
}

function buildAttachmentExtractionFailurePayload(inspection, error) {
  const errorCode = typeof error?.code === 'string' && error.code.trim().length > 0
    ? error.code.trim()
    : 'attachment_extraction_failed';
  const userMessage = typeof error?.userMessage === 'string' && error.userMessage.trim().length > 0
    ? error.userMessage.trim()
    : `MarkItDown extraction failed for "${inspection.name}".`;
  const rawMessage = typeof error?.rawMessage === 'string' && error.rawMessage.trim().length > 0
    ? error.rawMessage.trim()
    : String(error?.message || userMessage);

  return {
    success: false,
    error: `${userMessage} 附件: "${inspection.name}"。`,
    errorCode,
    errorDetails: rawMessage,
    fallbackErrorCode: error?.fallbackErrorCode || null,
    primaryProfile: error?.primaryProfile || null,
    fallbackProfile: error?.fallbackProfile || null,
    fallbackAttempted: error?.fallbackAttempted === true,
    attachment: inspection,
  };
}

function resolvePdfPageSelection(inspection, pageStart, pageCount, pageFromEnd, defaultPageCount) {
  const selectedPageCount = pageCount || defaultPageCount || 0;

  if (!pageFromEnd) {
    return {
      pageStart: pageStart || 1,
      pageCount: selectedPageCount,
    };
  }

  if (inspection.pageRangeSupported !== true || !Number.isFinite(inspection.totalPageCount) || inspection.totalPageCount <= 0) {
    throw new Error(`Attachment "${inspection.name}" does not expose a reliable total page count for pageFromEnd.`);
  }

  const effectivePageCount = Math.max(1, selectedPageCount || 1);
  const computedPageStart = Math.max(1, inspection.totalPageCount - pageFromEnd + 1);
  const boundedPageStart = Math.min(computedPageStart, inspection.totalPageCount);
  const remainingPages = inspection.totalPageCount - boundedPageStart + 1;

  return {
    pageStart: boundedPageStart,
    pageCount: Math.min(effectivePageCount, remainingPages),
  };
}

async function assertReadableLocalTextFile(resolvedPath, attachmentIndex) {
  if (attachmentIndex.byPath.has(path.normalize(resolvedPath))) {
    throw new Error('This path belongs to a user-provided attachment. Use inspectAttachment or readAttachmentText instead of readFile.');
  }
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

function createAttachmentTools(attachments, workspaceDir, resolveRequestedPath, attachmentExtraction = {}) {
  const index = createAttachmentIndex(attachments);
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
  extractor.previewPageCount = markitdownConfig.previewPageCount || 1;
  extractor.readPageCount = markitdownConfig.readPageCount || 2;
  if (attachments.length === 0) {
    return {
      tools: {},
      toolNames: [],
      toolDisplayByName: {},
      attachmentIndex: index,
      close: async () => {
        if (typeof extractor.close === 'function') {
          extractor.close();
        }
      },
    };
  }
  return {
    attachmentIndex: index,
    toolNames: ['inspectAttachment', 'readAttachmentText'],
    toolDisplayByName: {
      inspectAttachment: createToolDisplayInfo('inspectAttachment', {
        displayName: '附件分析',
        statusText: '分析附件内容',
      }),
      readAttachmentText: createToolDisplayInfo('readAttachmentText', {
        displayName: '附件读取',
        statusText: '提取附件文本',
      }),
    },
    close: async () => {
      if (typeof extractor.close === 'function') {
        extractor.close();
      }
    },
    tools: {
      inspectAttachment: tool({
        description: 'Inspect a user-provided attachment by id, name, or path. Returns metadata and a bounded preview for plain text-like attachments.',
        inputSchema: z.object({
          attachment: z.string().optional(),
          maxChars: z.number().int().min(0).max(MAX_ATTACHMENT_PREVIEW_CHARS).optional(),
          pageStart: z.number().int().min(1).optional(),
          pageCount: z.number().int().min(1).max(20).optional(),
          pageFromEnd: z.number().int().min(1).max(20).optional(),
        }),
        execute: async ({ attachment, maxChars, pageStart, pageCount, pageFromEnd }) => {
          const target = resolveAttachment(index, workspaceDir, resolveRequestedPath, attachment);
          let inspection;

          try {
            const baseInspection = await inspectAttachmentFile(target, 0, null);
            const pageSelection = target.extension === '.pdf'
              ? resolvePdfPageSelection(baseInspection, pageStart, pageCount, pageFromEnd, extractor.previewPageCount || 1)
              : { pageStart: pageStart || 1, pageCount: pageCount || 0 };
            inspection = await inspectAttachmentFile(target, maxChars ?? DEFAULT_ATTACHMENT_PREVIEW_CHARS, {
              ...extractor,
              extract: (currentAttachment, options = {}) => extractor.extract(currentAttachment, {
                pageStart: pageSelection.pageStart || options.pageStart || 1,
                pageCount: pageSelection.pageCount || options.pageCount || 0,
              }),
            });
          } catch (error) {
            inspection = await inspectAttachmentFile(target, 0, null);
            inspection.extraction = {
              available: false,
              method: 'markitdown',
              error: error.message,
            };
          }

          const separated = splitAttachmentInspection(inspection);
          return {
            success: true,
            attachment: separated.attachment,
            preview: separated.preview,
          };
        },
      }),
      readAttachmentText: tool({
        description: 'Read a bounded chunk of text from a user-provided attachment. Plain text files are read directly; supported office or PDF files may be converted with MarkItDown first. For large PDFs, prefer reading selected pages instead of the whole document.',
        inputSchema: z.object({
          attachment: z.string().optional(),
          offset: z.number().int().min(0).optional(),
          maxChars: z.number().int().min(1).max(MAX_ATTACHMENT_TEXT_CHARS).optional(),
          pageStart: z.number().int().min(1).optional(),
          pageCount: z.number().int().min(1).max(50).optional(),
          pageFromEnd: z.number().int().min(1).max(50).optional(),
        }),
        execute: async ({ attachment, offset, maxChars, pageStart, pageCount, pageFromEnd }) => {
          const target = resolveAttachment(index, workspaceDir, resolveRequestedPath, attachment);
          const inspection = await inspectAttachmentFile(target, 0, null);
          if (!inspection.textLike) {
            if (!extractor.canExtract(target)) {
              return { success: false, error: `Attachment "${inspection.name}" is not a plain text-like file.`, attachment: inspection };
            }

            try {
              const useImplicitPagedCursor = target.extension === '.pdf'
                && inspection.pageRangeSupported === true
                && !pageStart
                && !pageCount
                && !pageFromEnd;
              const pageSelection = target.extension === '.pdf'
                ? resolvePdfPageSelection(inspection, pageStart, pageCount, pageFromEnd, extractor.readPageCount)
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
                attachment: {
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
              return buildAttachmentExtractionFailurePayload(inspection, error);
            }
          }
          const chunk = await readAttachmentText(inspection.path, inspection.sizeBytes, offset ?? 0, maxChars ?? DEFAULT_ATTACHMENT_TEXT_CHARS);
          return {
            success: true,
            attachment: {
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
        },
      }),
    },
  };
}

function buildAttachmentsPrompt(attachments) {
  if (!attachments || attachments.length === 0) return '';
  const lines = attachments.map(attachment => `- id=${attachment.id}, name=${attachment.name}, path=${attachment.resolvedPath}, kind=${attachment.kind}${attachment.mimeType ? `, mime=${attachment.mimeType}` : ''}`);
  return [
    'Attachments',
    'These user-provided attachments are currently available in the conversation, including files from earlier turns that may still be relevant.',
    'Do not treat the presence of an attachment as a reason to inspect it immediately.',
    'First decide the concrete task from the latest message and prior conversation.',
    'If the task is ambiguous, ask a clarifying question before touching the attachment.',
    'Use `inspectAttachment` or `readAttachmentText` only after the task is clear and attachment access is actually needed.',
    'For supported document formats, `readAttachmentText` may convert the attachment to Markdown before returning a bounded chunk.',
    'Prefer `inspectAttachment` before `readAttachmentText` when you only need file type, page range, metadata, or a small preview.',
    'Once file access is justified, prefer fewer, larger reads and continue searching instead of stopping after the first chunk.',
    'For contracts and similar business documents, extract likely key fields yourself only after file access is justified.',
    'Ask the user for missing details only after a reasonable file search fails.',
    'Do not use `readFile` on attachment paths. Only pass attachment paths to other tools when a tool explicitly requires a file path.',
    ...lines,
  ].join('\n');
}

module.exports = {
  MAX_LOCAL_TEXT_CHARS,
  assertReadableLocalTextFile,
  buildAttachmentsPrompt,
  createAttachmentTools,
  enrichAttachmentMetadata,
  normalizeAttachments,
};
