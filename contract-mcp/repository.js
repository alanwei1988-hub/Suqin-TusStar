const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { normalizeDateText } = require('./date-normalize');

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
      CREATE INDEX IF NOT EXISTS idx_archive_records_agreement_type ON archive_records(agreement_type);
      CREATE INDEX IF NOT EXISTS idx_archive_records_counterparty_name ON archive_records(counterparty_name);
      CREATE INDEX IF NOT EXISTS idx_archive_records_signing_date ON archive_records(signing_date);
      CREATE INDEX IF NOT EXISTS idx_archive_records_effective_start_date ON archive_records(effective_start_date);
      CREATE INDEX IF NOT EXISTS idx_archive_records_effective_end_date ON archive_records(effective_end_date);
      CREATE INDEX IF NOT EXISTS idx_archive_records_first_payment_date ON archive_records(first_payment_date);
      CREATE INDEX IF NOT EXISTS idx_archive_records_final_payment_date ON archive_records(final_payment_date);
      CREATE INDEX IF NOT EXISTS idx_archive_records_contract_amount ON archive_records(contract_amount);
      CREATE INDEX IF NOT EXISTS idx_archive_records_uploaded_by ON archive_records(uploaded_by);
      CREATE INDEX IF NOT EXISTS idx_archive_records_our_owner ON archive_records(our_owner);
      CREATE INDEX IF NOT EXISTS idx_archive_records_payment_status ON archive_records(payment_status);
      CREATE INDEX IF NOT EXISTS idx_archive_records_has_settlement ON archive_records(has_settlement);
      CREATE INDEX IF NOT EXISTS idx_archive_records_status ON archive_records(status);
      CREATE INDEX IF NOT EXISTS idx_archive_records_archive_relative_dir ON archive_records(archive_relative_dir);
      CREATE INDEX IF NOT EXISTS idx_archive_records_archived_at ON archive_records(archived_at);
      CREATE INDEX IF NOT EXISTS idx_archive_records_created_at ON archive_records(created_at);
      CREATE INDEX IF NOT EXISTS idx_archive_records_updated_at ON archive_records(updated_at);
      CREATE INDEX IF NOT EXISTS idx_archive_files_archive_id ON archive_files(archive_id);
      CREATE INDEX IF NOT EXISTS idx_archive_events_archive_id ON archive_events(archive_id);
    `);

    this.normalizeLegacyArchiveDates();
  }

  close() {
    this.db.close();
  }

  transaction(callback) {
    return this.db.transaction(callback)();
  }

  normalizeLegacyArchiveDates() {
    const rows = this.db.prepare(`
      SELECT
        archive_id,
        signing_date,
        effective_start_date,
        effective_end_date,
        first_payment_date,
        final_payment_date
      FROM archive_records
    `).all();

    if (rows.length === 0) {
      return;
    }

    const update = this.db.prepare(`
      UPDATE archive_records
      SET
        signing_date = @signing_date,
        effective_start_date = @effective_start_date,
        effective_end_date = @effective_end_date,
        first_payment_date = @first_payment_date,
        final_payment_date = @final_payment_date
      WHERE archive_id = @archive_id
    `);

    this.db.transaction(() => {
      for (const row of rows) {
        const normalized = {
          signing_date: normalizeLegacyDateValue(row.signing_date),
          effective_start_date: normalizeLegacyDateValue(row.effective_start_date),
          effective_end_date: normalizeLegacyDateValue(row.effective_end_date),
          first_payment_date: normalizeLegacyDateValue(row.first_payment_date),
          final_payment_date: normalizeLegacyDateValue(row.final_payment_date),
        };

        if (
          normalized.signing_date === row.signing_date
          && normalized.effective_start_date === row.effective_start_date
          && normalized.effective_end_date === row.effective_end_date
          && normalized.first_payment_date === row.first_payment_date
          && normalized.final_payment_date === row.final_payment_date
        ) {
          continue;
        }

        update.run({
          archive_id: row.archive_id,
          ...normalized,
        });
      }
    })();
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

    const keywordTerms = Array.isArray(filters.keyword_terms)
      ? filters.keyword_terms
        .map(value => String(value || '').trim())
        .filter(Boolean)
      : [];

    if (keywordTerms.length > 0) {
      const keywordClauses = keywordTerms.map((_, index) => {
        const paramName = `keyword_${index}`;
        params[paramName] = `%${keywordTerms[index]}%`;

        return `
          archive_id LIKE @${paramName}
          OR contract_name LIKE @${paramName}
          OR IFNULL(agreement_type, '') LIKE @${paramName}
          OR IFNULL(party_a_name, '') LIKE @${paramName}
          OR IFNULL(party_b_name, '') LIKE @${paramName}
          OR IFNULL(other_party_name, '') LIKE @${paramName}
          OR IFNULL(counterparty_name, '') LIKE @${paramName}
          OR IFNULL(summary, '') LIKE @${paramName}
          OR IFNULL(remarks, '') LIKE @${paramName}
          OR IFNULL(search_keywords_json, '') LIKE @${paramName}
        `;
      });

      where.push(`(${keywordClauses.map(clause => `(${clause})`).join(' OR ')})`);
    } else if (filters.keyword) {
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

    if (filters.contract_name) {
      where.push('contract_name LIKE @contract_name');
      params.contract_name = `%${filters.contract_name}%`;
    }

    if (filters.counterparty_name) {
      where.push('counterparty_name LIKE @counterparty_name');
      params.counterparty_name = `%${filters.counterparty_name}%`;
    }

    if (filters.agreement_type) {
      where.push('agreement_type LIKE @agreement_type');
      params.agreement_type = `%${filters.agreement_type}%`;
    }

    if (filters.direction) {
      where.push('direction = @direction');
      params.direction = filters.direction;
    }

    if (filters.uploaded_by) {
      where.push('uploaded_by LIKE @uploaded_by');
      params.uploaded_by = `%${filters.uploaded_by}%`;
    }

    if (filters.our_owner) {
      where.push('our_owner LIKE @our_owner');
      params.our_owner = `%${filters.our_owner}%`;
    }

    if (filters.payment_status) {
      where.push('payment_status LIKE @payment_status');
      params.payment_status = `%${filters.payment_status}%`;
    }

    if (typeof filters.has_settlement === 'number') {
      where.push('has_settlement = @has_settlement');
      params.has_settlement = filters.has_settlement;
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

    if (filters.effective_start_from) {
      where.push('effective_start_date >= @effective_start_from');
      params.effective_start_from = filters.effective_start_from;
    }

    if (filters.effective_start_to) {
      where.push('effective_start_date <= @effective_start_to');
      params.effective_start_to = filters.effective_start_to;
    }

    if (filters.effective_end_from) {
      where.push('effective_end_date >= @effective_end_from');
      params.effective_end_from = filters.effective_end_from;
    }

    if (filters.effective_end_to) {
      where.push('effective_end_date <= @effective_end_to');
      params.effective_end_to = filters.effective_end_to;
    }

    if (filters.first_payment_date_from) {
      where.push('first_payment_date >= @first_payment_date_from');
      params.first_payment_date_from = filters.first_payment_date_from;
    }

    if (filters.first_payment_date_to) {
      where.push('first_payment_date <= @first_payment_date_to');
      params.first_payment_date_to = filters.first_payment_date_to;
    }

    if (filters.final_payment_date_from) {
      where.push('final_payment_date >= @final_payment_date_from');
      params.final_payment_date_from = filters.final_payment_date_from;
    }

    if (filters.final_payment_date_to) {
      where.push('final_payment_date <= @final_payment_date_to');
      params.final_payment_date_to = filters.final_payment_date_to;
    }

    if (typeof filters.min_amount === 'number') {
      where.push('contract_amount >= @min_amount');
      params.min_amount = filters.min_amount;
    }

    if (typeof filters.max_amount === 'number') {
      where.push('contract_amount <= @max_amount');
      params.max_amount = filters.max_amount;
    }

    if (filters.archived_at_from) {
      where.push('archived_at >= @archived_at_from');
      params.archived_at_from = filters.archived_at_from;
    }

    if (filters.archived_at_to) {
      where.push('archived_at <= @archived_at_to');
      params.archived_at_to = filters.archived_at_to;
    }

    if (filters.created_at_from) {
      where.push('created_at >= @created_at_from');
      params.created_at_from = filters.created_at_from;
    }

    if (filters.created_at_to) {
      where.push('created_at <= @created_at_to');
      params.created_at_to = filters.created_at_to;
    }

    if (filters.updated_at_from) {
      where.push('updated_at >= @updated_at_from');
      params.updated_at_from = filters.updated_at_from;
    }

    if (filters.updated_at_to) {
      where.push('updated_at <= @updated_at_to');
      params.updated_at_to = filters.updated_at_to;
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

function normalizeLegacyDateValue(value) {
  if (value == null) {
    return null;
  }

  if (value === '') {
    return '';
  }

  return normalizeDateText(value);
}
