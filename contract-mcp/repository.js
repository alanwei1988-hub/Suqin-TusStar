const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

class ContractRepository {
  constructor(dbPath) {
    this.dbPath = path.resolve(dbPath);
    ensureParentDir(this.dbPath);
    this.db = new Database(this.dbPath);
    this.init();
  }

  init() {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS archive_sequences (
        sequence_key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS archive_records (
        archive_id TEXT PRIMARY KEY,
        pending_id TEXT,
        contract_name TEXT NOT NULL,
        agreement_type TEXT,
        party_a_name TEXT,
        party_b_name TEXT,
        other_party_name TEXT,
        counterparty_name TEXT,
        direction TEXT,
        signing_date TEXT,
        effective_start_date TEXT,
        effective_end_date TEXT,
        contract_amount REAL,
        currency TEXT,
        summary TEXT,
        remarks TEXT,
        our_owner TEXT,
        counterparty_contact TEXT,
        first_payment_amount REAL,
        first_payment_date TEXT,
        final_payment_amount REAL,
        final_payment_date TEXT,
        payment_status TEXT,
        confidentiality_requirement TEXT,
        has_settlement INTEGER,
        uploaded_by TEXT,
        uploader_user_id TEXT,
        operator TEXT,
        sheet_name TEXT,
        archive_relative_dir TEXT NOT NULL,
        archive_absolute_dir TEXT NOT NULL,
        keyword_tags_json TEXT NOT NULL,
        search_keywords_json TEXT NOT NULL,
        uncertain_fields_json TEXT NOT NULL,
        ledger_fields_json TEXT NOT NULL,
        status TEXT NOT NULL,
        source_channel TEXT,
        source_message_id TEXT,
        idempotency_key TEXT UNIQUE,
        archived_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS archive_files (
        file_id TEXT PRIMARY KEY,
        archive_id TEXT NOT NULL,
        source_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        absolute_path TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        extension TEXT,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (archive_id) REFERENCES archive_records(archive_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS archive_events (
        event_id TEXT PRIMARY KEY,
        archive_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        operator TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (archive_id) REFERENCES archive_records(archive_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_archive_records_contract_name ON archive_records(contract_name);
      CREATE INDEX IF NOT EXISTS idx_archive_records_counterparty_name ON archive_records(counterparty_name);
      CREATE INDEX IF NOT EXISTS idx_archive_records_signing_date ON archive_records(signing_date);
      CREATE INDEX IF NOT EXISTS idx_archive_records_effective_end_date ON archive_records(effective_end_date);
      CREATE INDEX IF NOT EXISTS idx_archive_records_uploaded_by ON archive_records(uploaded_by);
      CREATE INDEX IF NOT EXISTS idx_archive_records_status ON archive_records(status);
      CREATE INDEX IF NOT EXISTS idx_archive_records_archive_relative_dir ON archive_records(archive_relative_dir);
      CREATE INDEX IF NOT EXISTS idx_archive_files_archive_id ON archive_files(archive_id);
      CREATE INDEX IF NOT EXISTS idx_archive_events_archive_id ON archive_events(archive_id);
    `);
  }

  close() {
    this.db.close();
  }

  transaction(callback) {
    return this.db.transaction(callback)();
  }

  nextArchiveId(prefix, dateKey) {
    const current = this.db.prepare(
      'SELECT value FROM archive_sequences WHERE sequence_key = ?',
    ).get(dateKey);

    const nextValue = current ? current.value + 1 : 1;

    if (current) {
      this.db.prepare(
        'UPDATE archive_sequences SET value = ? WHERE sequence_key = ?',
      ).run(nextValue, dateKey);
    } else {
      this.db.prepare(
        'INSERT INTO archive_sequences (sequence_key, value) VALUES (?, ?)',
      ).run(dateKey, nextValue);
    }

    return `${prefix}${dateKey}-${String(nextValue).padStart(4, '0')}`;
  }

  findRecordByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) {
      return null;
    }

    return this.db.prepare(
      'SELECT * FROM archive_records WHERE idempotency_key = ?',
    ).get(idempotencyKey) || null;
  }

  insertRecord(record) {
    this.db.prepare(`
      INSERT INTO archive_records (
        archive_id, pending_id, contract_name, agreement_type,
        party_a_name, party_b_name, other_party_name, counterparty_name,
        direction, signing_date, effective_start_date, effective_end_date,
        contract_amount, currency, summary, remarks, our_owner,
        counterparty_contact, first_payment_amount, first_payment_date,
        final_payment_amount, final_payment_date, payment_status,
        confidentiality_requirement, has_settlement, uploaded_by,
        uploader_user_id, operator, sheet_name, archive_relative_dir,
        archive_absolute_dir, keyword_tags_json, search_keywords_json,
        uncertain_fields_json, ledger_fields_json, status, source_channel,
        source_message_id, idempotency_key, archived_at, created_at, updated_at
      ) VALUES (
        @archive_id, @pending_id, @contract_name, @agreement_type,
        @party_a_name, @party_b_name, @other_party_name, @counterparty_name,
        @direction, @signing_date, @effective_start_date, @effective_end_date,
        @contract_amount, @currency, @summary, @remarks, @our_owner,
        @counterparty_contact, @first_payment_amount, @first_payment_date,
        @final_payment_amount, @final_payment_date, @payment_status,
        @confidentiality_requirement, @has_settlement, @uploaded_by,
        @uploader_user_id, @operator, @sheet_name, @archive_relative_dir,
        @archive_absolute_dir, @keyword_tags_json, @search_keywords_json,
        @uncertain_fields_json, @ledger_fields_json, @status, @source_channel,
        @source_message_id, @idempotency_key, @archived_at, @created_at, @updated_at
      )
    `).run(record);
  }

  getRecordRow(archiveId) {
    return this.db.prepare(
      'SELECT * FROM archive_records WHERE archive_id = ?',
    ).get(archiveId) || null;
  }

  listFiles(archiveId) {
    return this.db.prepare(`
      SELECT *
      FROM archive_files
      WHERE archive_id = ?
      ORDER BY sort_order ASC, stored_name ASC
    `).all(archiveId);
  }

  listEvents(archiveId, limit = 20) {
    return this.db.prepare(`
      SELECT *
      FROM archive_events
      WHERE archive_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(archiveId, limit);
  }

  insertFile(record) {
    this.db.prepare(`
      INSERT INTO archive_files (
        file_id, archive_id, source_name, stored_name, absolute_path,
        relative_path, extension, size_bytes, sha256, sort_order, created_at
      ) VALUES (
        @file_id, @archive_id, @source_name, @stored_name, @absolute_path,
        @relative_path, @extension, @size_bytes, @sha256, @sort_order, @created_at
      )
    `).run(record);
  }

  insertEvent(record) {
    this.db.prepare(`
      INSERT INTO archive_events (
        event_id, archive_id, event_type, payload_json, operator, created_at
      ) VALUES (
        @event_id, @archive_id, @event_type, @payload_json, @operator, @created_at
      )
    `).run(record);
  }

  searchRecords(filters = {}) {
    const where = [];
    const params = {};

    if (filters.keyword) {
      where.push(`
        (
          archive_id LIKE @keyword
          OR contract_name LIKE @keyword
          OR IFNULL(agreement_type, '') LIKE @keyword
          OR IFNULL(party_a_name, '') LIKE @keyword
          OR IFNULL(party_b_name, '') LIKE @keyword
          OR IFNULL(other_party_name, '') LIKE @keyword
          OR IFNULL(counterparty_name, '') LIKE @keyword
          OR IFNULL(summary, '') LIKE @keyword
          OR IFNULL(remarks, '') LIKE @keyword
          OR IFNULL(search_keywords_json, '') LIKE @keyword
        )
      `);
      params.keyword = `%${filters.keyword}%`;
    }

    if (filters.archive_relative_dir) {
      where.push('archive_relative_dir LIKE @archive_relative_dir');
      params.archive_relative_dir = `%${filters.archive_relative_dir}%`;
    }

    if (filters.direction) {
      where.push('direction = @direction');
      params.direction = filters.direction;
    }

    if (filters.uploaded_by) {
      where.push('uploaded_by LIKE @uploaded_by');
      params.uploaded_by = `%${filters.uploaded_by}%`;
    }

    if (filters.signing_date_from) {
      where.push('signing_date >= @signing_date_from');
      params.signing_date_from = filters.signing_date_from;
    }

    if (filters.signing_date_to) {
      where.push('signing_date <= @signing_date_to');
      params.signing_date_to = filters.signing_date_to;
    }

    if (filters.effective_end_before) {
      where.push('effective_end_date <= @effective_end_before');
      params.effective_end_before = filters.effective_end_before;
    }

    if (typeof filters.limit !== 'number' || !Number.isFinite(filters.limit)) {
      throw new Error('searchRecords requires a numeric limit.');
    }

    params.limit = filters.limit;
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    return this.db.prepare(`
      SELECT *
      FROM archive_records
      ${whereClause}
      ORDER BY archived_at DESC, archive_id DESC
      LIMIT @limit
    `).all(params);
  }
}

module.exports = ContractRepository;
