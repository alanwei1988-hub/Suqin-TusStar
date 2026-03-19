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
      CREATE TABLE IF NOT EXISTS contract_sequences (
        sequence_key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contracts (
        contract_id TEXT PRIMARY KEY,
        contract_name TEXT NOT NULL,
        party_a_name TEXT NOT NULL,
        party_b_name TEXT NOT NULL,
        signing_date TEXT,
        effective_start_date TEXT,
        effective_end_date TEXT,
        contract_amount REAL,
        currency TEXT,
        summary TEXT,
        status TEXT NOT NULL,
        uploaded_at TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        source_channel TEXT,
        source_message_id TEXT,
        remarks TEXT,
        idempotency_key TEXT UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contract_files (
        file_id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL,
        file_role TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        stored_filename TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        uploaded_at TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        version_no INTEGER NOT NULL,
        FOREIGN KEY (contract_id) REFERENCES contracts(contract_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS contract_events (
        event_id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        operator TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (contract_id) REFERENCES contracts(contract_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
      CREATE INDEX IF NOT EXISTS idx_contracts_effective_end_date ON contracts(effective_end_date);
      CREATE INDEX IF NOT EXISTS idx_contracts_party_a_name ON contracts(party_a_name);
      CREATE INDEX IF NOT EXISTS idx_contracts_party_b_name ON contracts(party_b_name);
      CREATE INDEX IF NOT EXISTS idx_contract_files_contract_id ON contract_files(contract_id);
      CREATE INDEX IF NOT EXISTS idx_contract_events_contract_id ON contract_events(contract_id);
    `);
  }

  close() {
    this.db.close();
  }

  transaction(callback) {
    return this.db.transaction(callback)();
  }

  nextContractId(prefix, dateKey) {
    const current = this.db.prepare(
      'SELECT value FROM contract_sequences WHERE sequence_key = ?',
    ).get(dateKey);

    const nextValue = current ? current.value + 1 : 1;

    if (current) {
      this.db.prepare(
        'UPDATE contract_sequences SET value = ? WHERE sequence_key = ?',
      ).run(nextValue, dateKey);
    } else {
      this.db.prepare(
        'INSERT INTO contract_sequences (sequence_key, value) VALUES (?, ?)',
      ).run(dateKey, nextValue);
    }

    return `${prefix}-${dateKey}-${String(nextValue).padStart(4, '0')}`;
  }

  findContractByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) {
      return null;
    }

    return this.db.prepare(
      'SELECT * FROM contracts WHERE idempotency_key = ?',
    ).get(idempotencyKey) || null;
  }

  insertContract(record) {
    this.db.prepare(`
      INSERT INTO contracts (
        contract_id, contract_name, party_a_name, party_b_name,
        signing_date, effective_start_date, effective_end_date,
        contract_amount, currency, summary, status, uploaded_at,
        uploaded_by, source_channel, source_message_id, remarks,
        idempotency_key, created_at, updated_at
      ) VALUES (
        @contract_id, @contract_name, @party_a_name, @party_b_name,
        @signing_date, @effective_start_date, @effective_end_date,
        @contract_amount, @currency, @summary, @status, @uploaded_at,
        @uploaded_by, @source_channel, @source_message_id, @remarks,
        @idempotency_key, @created_at, @updated_at
      )
    `).run(record);
  }

  updateContract(contractId, patch, updatedAt) {
    const fields = Object.keys(patch);

    if (fields.length === 0) {
      return;
    }

    const assignments = fields.map(field => `${field} = @${field}`);
    const params = {
      ...patch,
      contract_id: contractId,
      updated_at: updatedAt,
    };

    this.db.prepare(`
      UPDATE contracts
      SET ${assignments.join(', ')}, updated_at = @updated_at
      WHERE contract_id = @contract_id
    `).run(params);
  }

  getContractRow(contractId) {
    return this.db.prepare(
      'SELECT * FROM contracts WHERE contract_id = ?',
    ).get(contractId) || null;
  }

  listFiles(contractId) {
    return this.db.prepare(`
      SELECT *
      FROM contract_files
      WHERE contract_id = ?
      ORDER BY version_no ASC, uploaded_at ASC, original_filename ASC
    `).all(contractId);
  }

  listEvents(contractId, limit = 20) {
    return this.db.prepare(`
      SELECT *
      FROM contract_events
      WHERE contract_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(contractId, limit);
  }

  nextFileVersion(contractId, fileRole) {
    const row = this.db.prepare(`
      SELECT MAX(version_no) AS max_version
      FROM contract_files
      WHERE contract_id = ? AND file_role = ?
    `).get(contractId, fileRole);

    return (row?.max_version || 0) + 1;
  }

  insertFile(record) {
    this.db.prepare(`
      INSERT INTO contract_files (
        file_id, contract_id, file_role, original_filename, stored_filename,
        stored_path, mime_type, size_bytes, sha256, uploaded_at, uploaded_by, version_no
      ) VALUES (
        @file_id, @contract_id, @file_role, @original_filename, @stored_filename,
        @stored_path, @mime_type, @size_bytes, @sha256, @uploaded_at, @uploaded_by, @version_no
      )
    `).run(record);
  }

  insertEvent(record) {
    this.db.prepare(`
      INSERT INTO contract_events (
        event_id, contract_id, event_type, payload_json, operator, created_at
      ) VALUES (
        @event_id, @contract_id, @event_type, @payload_json, @operator, @created_at
      )
    `).run(record);
  }

  searchContracts(filters = {}) {
    const where = [];
    const params = {};

    if (filters.keyword) {
      where.push(`
        (
          contract_id LIKE @keyword
          OR contract_name LIKE @keyword
          OR party_a_name LIKE @keyword
          OR party_b_name LIKE @keyword
          OR IFNULL(summary, '') LIKE @keyword
        )
      `);
      params.keyword = `%${filters.keyword}%`;
    }

    if (filters.party_a_name) {
      where.push('party_a_name LIKE @party_a_name');
      params.party_a_name = `%${filters.party_a_name}%`;
    }

    if (filters.party_b_name) {
      where.push('party_b_name LIKE @party_b_name');
      params.party_b_name = `%${filters.party_b_name}%`;
    }

    if (Array.isArray(filters.statuses) && filters.statuses.length > 0) {
      const placeholders = filters.statuses.map((_, index) => `@status_${index}`);
      where.push(`status IN (${placeholders.join(', ')})`);
      filters.statuses.forEach((status, index) => {
        params[`status_${index}`] = status;
      });
    }

    if (filters.effective_end_before) {
      where.push('effective_end_date <= @effective_end_before');
      params.effective_end_before = filters.effective_end_before;
    }

    if (filters.effective_start_after) {
      where.push('effective_start_date >= @effective_start_after');
      params.effective_start_after = filters.effective_start_after;
    }

    if (filters.signing_date_from) {
      where.push('signing_date >= @signing_date_from');
      params.signing_date_from = filters.signing_date_from;
    }

    if (filters.signing_date_to) {
      where.push('signing_date <= @signing_date_to');
      params.signing_date_to = filters.signing_date_to;
    }

    if (typeof filters.min_amount === 'number') {
      where.push('contract_amount >= @min_amount');
      params.min_amount = filters.min_amount;
    }

    if (typeof filters.max_amount === 'number') {
      where.push('contract_amount <= @max_amount');
      params.max_amount = filters.max_amount;
    }

    params.limit = filters.limit;
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    return this.db.prepare(`
      SELECT *
      FROM contracts
      ${whereClause}
      ORDER BY updated_at DESC, contract_id DESC
      LIMIT @limit
    `).all(params);
  }

  listExpiringContracts({ cutoffDate, statuses, limit }) {
    const params = {
      cutoff_date: cutoffDate,
      limit,
    };

    const statusClause = Array.isArray(statuses) && statuses.length > 0
      ? `AND status IN (${statuses.map((_, index) => `@status_${index}`).join(', ')})`
      : '';

    statuses?.forEach((status, index) => {
      params[`status_${index}`] = status;
    });

    return this.db.prepare(`
      SELECT *
      FROM contracts
      WHERE effective_end_date IS NOT NULL
        AND effective_end_date <= @cutoff_date
        ${statusClause}
      ORDER BY effective_end_date ASC, contract_id ASC
      LIMIT @limit
    `).all(params);
  }
}

module.exports = ContractRepository;
