const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

function hashString(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function buildFallbackDbPath(dbPath) {
  const baseName = hashString(path.resolve(String(dbPath || 'attachment-extraction-cache.db')));
  return path.join(os.tmpdir(), 'wxwork-bot-cache', `${baseName}.db`);
}

class AttachmentExtractionCache {
  constructor(config = {}) {
    this.enabled = config.enabled !== false;
    this.dbPath = config.dbPath ? path.resolve(config.dbPath) : '';
    this.extractorKey = config.extractorKey ? String(config.extractorKey) : '';
    this.fileHashCache = new Map();
    this.rowCache = new Map();
    this.db = null;

    if (!this.enabled || !this.dbPath) {
      return;
    }

    try {
      this.initializeDatabase(this.dbPath);
    } catch (error) {
      const fallbackPath = buildFallbackDbPath(this.dbPath);

      if (fallbackPath !== this.dbPath) {
        this.initializeDatabase(fallbackPath);
        this.dbPath = fallbackPath;
      } else {
        throw error;
      }
    }
  }

  initializeDatabase(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    try {
      this.db.pragma('journal_mode = WAL');
    } catch {
      // Some Windows or network-backed filesystems reject WAL mode. Fall back
      // to SQLite's default journal mode so cache persistence still works.
    }
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS attachment_extraction_cache (
          cacheKey TEXT PRIMARY KEY,
          extractorKey TEXT NOT NULL,
          fileHash TEXT NOT NULL,
          extension TEXT,
          fileSizeBytes INTEGER,
          fileMtimeMs INTEGER,
          pageStart INTEGER NOT NULL,
          pageCount INTEGER NOT NULL,
          markdown TEXT NOT NULL,
          truncated INTEGER NOT NULL DEFAULT 0,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          lastAccessedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_attachment_extraction_cache_file_hash
          ON attachment_extraction_cache (fileHash, extractorKey);
      `);
    } catch (error) {
      this.db.close();
      this.db = null;
      throw error;
    }
    this.selectStmt = this.db.prepare(`
      SELECT markdown, truncated, pageStart, pageCount
      FROM attachment_extraction_cache
      WHERE cacheKey = ?
    `);
    this.upsertStmt = this.db.prepare(`
      INSERT INTO attachment_extraction_cache (
        cacheKey,
        extractorKey,
        fileHash,
        extension,
        fileSizeBytes,
        fileMtimeMs,
        pageStart,
        pageCount,
        markdown,
        truncated,
        updatedAt,
        lastAccessedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(cacheKey) DO UPDATE SET
        markdown = excluded.markdown,
        truncated = excluded.truncated,
        fileSizeBytes = excluded.fileSizeBytes,
        fileMtimeMs = excluded.fileMtimeMs,
        updatedAt = CURRENT_TIMESTAMP,
        lastAccessedAt = CURRENT_TIMESTAMP
    `);
    this.touchStmt = this.db.prepare(`
      UPDATE attachment_extraction_cache
      SET lastAccessedAt = CURRENT_TIMESTAMP
      WHERE cacheKey = ?
    `);
  }

  async getFileDescriptor(attachment) {
    const resolvedPath = path.normalize(String(attachment?.resolvedPath || ''));

    if (!resolvedPath) {
      throw new Error('Attachment cache requires attachment.resolvedPath.');
    }

    const stat = await fs.promises.stat(resolvedPath);
    const fingerprintKey = `${resolvedPath}::${stat.size}::${stat.mtimeMs}`;

    if (!this.fileHashCache.has(fingerprintKey)) {
      const promise = hashFile(resolvedPath).then(fileHash => ({
        fileHash,
        fileSizeBytes: stat.size,
        fileMtimeMs: stat.mtimeMs,
      }));
      this.fileHashCache.set(fingerprintKey, promise);
    }

    return this.fileHashCache.get(fingerprintKey);
  }

  buildCacheKey({ fileHash, attachment, pageStart, pageCount }) {
    return hashString(JSON.stringify({
      extractorKey: this.extractorKey,
      fileHash,
      extension: String(attachment?.extension || '').toLowerCase(),
      pageStart,
      pageCount,
    }));
  }

  async get(attachment, options = {}) {
    if (!this.db) {
      return null;
    }

    const pageStart = Number.isFinite(options.pageStart) ? Math.max(1, Math.trunc(options.pageStart)) : 1;
    const pageCount = Number.isFinite(options.pageCount) ? Math.max(0, Math.trunc(options.pageCount)) : 0;
    const descriptor = await this.getFileDescriptor(attachment);
    const cacheKey = this.buildCacheKey({
      fileHash: descriptor.fileHash,
      attachment,
      pageStart,
      pageCount,
    });

    if (this.rowCache.has(cacheKey)) {
      const cached = this.rowCache.get(cacheKey);
      this.touchStmt.run(cacheKey);
      return {
        ...cached,
        fileHash: descriptor.fileHash,
      };
    }

    const row = this.selectStmt.get(cacheKey);

    if (!row) {
      return null;
    }

    const cached = {
      markdown: String(row.markdown || ''),
      truncated: row.truncated === 1,
      pageStart: row.pageStart,
      pageCount: row.pageCount,
      cacheKey,
      fileHash: descriptor.fileHash,
    };
    this.rowCache.set(cacheKey, cached);
    this.touchStmt.run(cacheKey);
    return cached;
  }

  async set(attachment, options = {}, result = {}) {
    if (!this.db) {
      return null;
    }

    const pageStart = Number.isFinite(options.pageStart) ? Math.max(1, Math.trunc(options.pageStart)) : 1;
    const pageCount = Number.isFinite(options.pageCount) ? Math.max(0, Math.trunc(options.pageCount)) : 0;
    const descriptor = await this.getFileDescriptor(attachment);
    const cacheKey = this.buildCacheKey({
      fileHash: descriptor.fileHash,
      attachment,
      pageStart,
      pageCount,
    });
    const normalized = {
      markdown: String(result.markdown || ''),
      truncated: result.truncated === true,
      pageStart,
      pageCount,
      cacheKey,
      fileHash: descriptor.fileHash,
    };

    this.upsertStmt.run(
      cacheKey,
      this.extractorKey,
      descriptor.fileHash,
      String(attachment?.extension || '').toLowerCase(),
      descriptor.fileSizeBytes,
      descriptor.fileMtimeMs,
      pageStart,
      pageCount,
      normalized.markdown,
      normalized.truncated ? 1 : 0,
    );
    this.rowCache.set(cacheKey, normalized);
    return normalized;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = {
  AttachmentExtractionCache,
  hashString,
};
