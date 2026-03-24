module.exports = require('./nas-service');
/*
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const ContractRepository = require('./repository');

const VALID_STATUSES = ['draft', 'active', 'expired', 'terminated', 'archived'];
const VALID_FILE_ROLES = ['scan', 'original_word', 'pdf', 'attachment'];

const fileInputSchema = z.object({
  path: z.string().min(1),
  role: z.enum(VALID_FILE_ROLES),
});

const contractPayloadSchema = z.object({
  contractName: z.string().trim().optional(),
  partyAName: z.string().trim().optional(),
  partyBName: z.string().trim().optional(),
  signingDate: z.string().trim().optional(),
  effectiveStartDate: z.string().trim().optional(),
  effectiveEndDate: z.string().trim().optional(),
  contractAmount: z.number().finite().optional(),
  currency: z.string().trim().optional(),
  summary: z.string().trim().optional(),
  uploadedBy: z.string().trim().optional(),
  sourceChannel: z.string().trim().optional(),
  sourceMessageId: z.string().trim().optional(),
  remarks: z.string().trim().optional(),
  status: z.enum(VALID_STATUSES).optional(),
}).strict();

const updatePatchSchema = z.object({
  contractName: z.string().trim().optional(),
  partyAName: z.string().trim().optional(),
  partyBName: z.string().trim().optional(),
  signingDate: z.string().trim().optional(),
  effectiveStartDate: z.string().trim().optional(),
  effectiveEndDate: z.string().trim().optional(),
  contractAmount: z.number().finite().nullable().optional(),
  currency: z.string().trim().nullable().optional(),
  summary: z.string().trim().nullable().optional(),
  remarks: z.string().trim().nullable().optional(),
  status: z.enum(VALID_STATUSES).optional(),
}).strict();

function normalizeDate(value, fieldName) {
  if (value == null || value === '') {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date for ${fieldName}: ${value}`);
  }

  return date.toISOString().slice(0, 10);
}

function toIsoTimestamp(value = new Date()) {
  return value.toISOString();
}

function dateKey(value = new Date()) {
  return value.toISOString().slice(0, 10).replace(/-/g, '');
}

function sanitizeFilePart(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeByExt = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
  };

  return mimeByExt[ext] || 'application/octet-stream';
}

function mapContractRow(row) {
  if (!row) {
    return null;
  }

  return {
    contractId: row.contract_id,
    contractName: row.contract_name,
    partyAName: row.party_a_name,
    partyBName: row.party_b_name,
    signingDate: row.signing_date,
    effectiveStartDate: row.effective_start_date,
    effectiveEndDate: row.effective_end_date,
    contractAmount: row.contract_amount,
    currency: row.currency,
    summary: row.summary,
    status: row.status,
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by,
    sourceChannel: row.source_channel,
    sourceMessageId: row.source_message_id,
    remarks: row.remarks,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    idempotencyKey: row.idempotency_key,
  };
}

function mapFileRow(row) {
  return {
    fileId: row.file_id,
    contractId: row.contract_id,
    fileRole: row.file_role,
    originalFilename: row.original_filename,
    storedFilename: row.stored_filename,
    storedPath: row.stored_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by,
    versionNo: row.version_no,
  };
}

function mapEventRow(row) {
  return {
    eventId: row.event_id,
    contractId: row.contract_id,
    eventType: row.event_type,
    operator: row.operator,
    createdAt: row.created_at,
    payload: JSON.parse(row.payload_json),
  };
}

class ContractService {
  constructor(config) {
    this.config = {
      ...config,
      dbPath: path.resolve(config.dbPath),
      storageRoot: path.resolve(config.storageRoot),
      stagingDir: path.resolve(config.stagingDir),
      allowedExtensions: config.allowedExtensions.map(ext => ext.toLowerCase()),
    };
    this.repository = new ContractRepository(this.config.dbPath);
    ensureDir(this.config.storageRoot);
    ensureDir(this.config.stagingDir);
  }

  close() {
    this.repository.close();
  }

  normalizeContract(contract) {
    return {
      contractName: contract.contractName || null,
      partyAName: contract.partyAName || null,
      partyBName: contract.partyBName || null,
      signingDate: normalizeDate(contract.signingDate, 'signingDate'),
      effectiveStartDate: normalizeDate(contract.effectiveStartDate, 'effectiveStartDate'),
      effectiveEndDate: normalizeDate(contract.effectiveEndDate, 'effectiveEndDate'),
      contractAmount: contract.contractAmount == null ? null : contract.contractAmount,
      currency: contract.currency || 'CNY',
      summary: contract.summary || null,
      uploadedBy: contract.uploadedBy || null,
      sourceChannel: contract.sourceChannel || null,
      sourceMessageId: contract.sourceMessageId || null,
      remarks: contract.remarks || null,
      status: contract.status || 'active',
    };
  }

  normalizePatch(patch) {
    const parsedPatch = updatePatchSchema.parse(patch || {});
    const mapped = {};

    if ('contractName' in parsedPatch) mapped.contract_name = parsedPatch.contractName || null;
    if ('partyAName' in parsedPatch) mapped.party_a_name = parsedPatch.partyAName || null;
    if ('partyBName' in parsedPatch) mapped.party_b_name = parsedPatch.partyBName || null;
    if ('signingDate' in parsedPatch) mapped.signing_date = normalizeDate(parsedPatch.signingDate, 'signingDate');
    if ('effectiveStartDate' in parsedPatch) mapped.effective_start_date = normalizeDate(parsedPatch.effectiveStartDate, 'effectiveStartDate');
    if ('effectiveEndDate' in parsedPatch) mapped.effective_end_date = normalizeDate(parsedPatch.effectiveEndDate, 'effectiveEndDate');
    if ('contractAmount' in parsedPatch) mapped.contract_amount = parsedPatch.contractAmount;
    if ('currency' in parsedPatch) mapped.currency = parsedPatch.currency || null;
    if ('summary' in parsedPatch) mapped.summary = parsedPatch.summary || null;
    if ('remarks' in parsedPatch) mapped.remarks = parsedPatch.remarks || null;
    if ('status' in parsedPatch) mapped.status = parsedPatch.status;

    return mapped;
  }

  validateContractPayload({ contract, files = [] }) {
    const parsedContract = contractPayloadSchema.parse(contract || {});
    const parsedFiles = z.array(fileInputSchema).parse(files);
    const normalizedContract = this.normalizeContract(parsedContract);
    const missingFields = [];
    const warnings = [];

    if (!normalizedContract.contractName) {
      missingFields.push('contract.contractName');
    }

    if (!normalizedContract.partyAName) {
      missingFields.push('contract.partyAName');
    }

    if (!normalizedContract.partyBName) {
      missingFields.push('contract.partyBName');
    }

    if (!normalizedContract.uploadedBy) {
      missingFields.push('contract.uploadedBy');
    }

    if (!normalizedContract.signingDate && !normalizedContract.effectiveStartDate) {
      missingFields.push('contract.signingDate or contract.effectiveStartDate');
    }

    if (parsedFiles.length === 0) {
      missingFields.push('files');
    }

    if (!normalizedContract.effectiveEndDate) {
      warnings.push('effectiveEndDate is empty, so expiration reminders will be limited.');
    }

    if (normalizedContract.contractAmount == null) {
      warnings.push('contractAmount is empty.');
    }

    return {
      ok: missingFields.length === 0,
      missingFields,
      warnings,
      normalizedContract,
      normalizedFiles: parsedFiles.map(file => ({
        path: path.resolve(file.path),
        role: file.role,
      })),
    };
  }

  getContract(contractId) {
    const contractRow = this.repository.getContractRow(contractId);

    if (!contractRow) {
      throw new Error(`Contract not found: ${contractId}`);
    }

    return this.composeContractDetail(contractRow);
  }

  composeContractDetail(contractRow) {
    return {
      contract: mapContractRow(contractRow),
      files: this.repository.listFiles(contractRow.contract_id).map(mapFileRow),
      events: this.repository.listEvents(contractRow.contract_id).map(mapEventRow),
    };
  }

  searchContracts(filters = {}) {
    const normalizedFilters = {
      keyword: filters.keyword || '',
      party_a_name: filters.partyAName || '',
      party_b_name: filters.partyBName || '',
      statuses: Array.isArray(filters.statuses) ? filters.statuses : [],
      effective_end_before: normalizeDate(filters.effectiveEndBefore, 'effectiveEndBefore'),
      effective_start_after: normalizeDate(filters.effectiveStartAfter, 'effectiveStartAfter'),
      signing_date_from: normalizeDate(filters.signingDateFrom, 'signingDateFrom'),
      signing_date_to: normalizeDate(filters.signingDateTo, 'signingDateTo'),
      min_amount: typeof filters.minAmount === 'number' ? filters.minAmount : undefined,
      max_amount: typeof filters.maxAmount === 'number' ? filters.maxAmount : undefined,
      limit: Number.isInteger(filters.limit) && filters.limit > 0
        ? Math.min(filters.limit, 100)
        : this.config.defaultSearchLimit,
    };

    return {
      items: this.repository.searchContracts(normalizedFilters).map(row => mapContractRow(row)),
    };
  }

  listExpiringContracts({ withinDays = 30, statuses = ['active'] } = {}) {
    const limit = this.config.defaultSearchLimit;
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() + withinDays);

    return {
      withinDays,
      items: this.repository.listExpiringContracts({
        cutoffDate: cutoff.toISOString().slice(0, 10),
        statuses,
        limit,
      }).map(row => mapContractRow(row)),
    };
  }

  createContract({ contract, files, operator, idempotencyKey }) {
    const validation = this.validateContractPayload({ contract, files });

    if (!validation.ok) {
      throw new Error(`Missing required fields: ${validation.missingFields.join(', ')}`);
    }

    const existing = this.repository.findContractByIdempotencyKey(idempotencyKey);
    if (existing) {
      return {
        reused: true,
        warnings: validation.warnings,
        ...this.composeContractDetail(existing),
      };
    }

    const timestamp = new Date();
    const stagedFiles = validation.normalizedFiles.map(file => this.stageFile(file));
    const movedPaths = [];
    let createdContractId = null;

    try {
      const detail = this.repository.transaction(() => {
        createdContractId = this.repository.nextContractId(this.config.contractIdPrefix, dateKey(timestamp));

        this.repository.insertContract({
          contract_id: createdContractId,
          contract_name: validation.normalizedContract.contractName,
          party_a_name: validation.normalizedContract.partyAName,
          party_b_name: validation.normalizedContract.partyBName,
          signing_date: validation.normalizedContract.signingDate,
          effective_start_date: validation.normalizedContract.effectiveStartDate,
          effective_end_date: validation.normalizedContract.effectiveEndDate,
          contract_amount: validation.normalizedContract.contractAmount,
          currency: validation.normalizedContract.currency,
          summary: validation.normalizedContract.summary,
          status: validation.normalizedContract.status,
          uploaded_at: toIsoTimestamp(timestamp),
          uploaded_by: validation.normalizedContract.uploadedBy,
          source_channel: validation.normalizedContract.sourceChannel,
          source_message_id: validation.normalizedContract.sourceMessageId,
          remarks: validation.normalizedContract.remarks,
          idempotency_key: idempotencyKey || null,
          created_at: toIsoTimestamp(timestamp),
          updated_at: toIsoTimestamp(timestamp),
        });

        for (const stagedFile of stagedFiles) {
          const versionNo = this.repository.nextFileVersion(createdContractId, stagedFile.role);
          const finalLocation = this.buildFinalFileLocation({
            contractId: createdContractId,
            fileRole: stagedFile.role,
            versionNo,
            originalPath: stagedFile.originalPath,
            sha256: stagedFile.sha256,
          });

          ensureDir(path.dirname(finalLocation.fullPath));
          fs.renameSync(stagedFile.stagedPath, finalLocation.fullPath);
          movedPaths.push(finalLocation.fullPath);

          this.repository.insertFile({
            file_id: crypto.randomUUID(),
            contract_id: createdContractId,
            file_role: stagedFile.role,
            original_filename: path.basename(stagedFile.originalPath),
            stored_filename: finalLocation.fileName,
            stored_path: finalLocation.fullPath,
            mime_type: stagedFile.mimeType,
            size_bytes: stagedFile.sizeBytes,
            sha256: stagedFile.sha256,
            uploaded_at: toIsoTimestamp(timestamp),
            uploaded_by: operator || validation.normalizedContract.uploadedBy,
            version_no: versionNo,
          });
        }

        this.repository.insertEvent({
          event_id: crypto.randomUUID(),
          contract_id: createdContractId,
          event_type: 'contract_created',
          payload_json: JSON.stringify({
            contract: validation.normalizedContract,
            files: validation.normalizedFiles,
            idempotencyKey: idempotencyKey || null,
          }),
          operator: operator || validation.normalizedContract.uploadedBy,
          created_at: toIsoTimestamp(timestamp),
        });

        return this.getContract(createdContractId);
      });

      this.writeMetadataSnapshot(createdContractId);
      return {
        reused: false,
        warnings: validation.warnings,
        ...detail,
      };
    } catch (error) {
      this.cleanupFiles([...stagedFiles.map(file => file.stagedPath), ...movedPaths]);

      if (createdContractId) {
        this.cleanupEmptyContractDir(createdContractId);
      }

      throw error;
    }
  }

  updateContract({ contractId, patch, operator, changeReason }) {
    const existing = this.getContract(contractId);
    const normalizedPatch = this.normalizePatch(patch);
    const changedFields = {};

    for (const [field, nextValue] of Object.entries(normalizedPatch)) {
      const currentValue = existing.contract[this.toCamelCase(field)];

      if (currentValue !== nextValue) {
        changedFields[field] = nextValue;
      }
    }

    if (Object.keys(changedFields).length === 0) {
      return {
        unchanged: true,
        ...existing,
      };
    }

    const timestamp = new Date();

    const detail = this.repository.transaction(() => {
      this.repository.updateContract(contractId, changedFields, toIsoTimestamp(timestamp));
      this.repository.insertEvent({
        event_id: crypto.randomUUID(),
        contract_id: contractId,
        event_type: 'contract_updated',
        payload_json: JSON.stringify({
          changeReason: changeReason || null,
          changedFields,
        }),
        operator,
        created_at: toIsoTimestamp(timestamp),
      });

      return this.getContract(contractId);
    });

    this.writeMetadataSnapshot(contractId);

    return {
      unchanged: false,
      ...detail,
    };
  }

  attachFiles({ contractId, files, operator }) {
    this.getContract(contractId);
    const parsedFiles = z.array(fileInputSchema).min(1).parse(files);
    const stagedFiles = parsedFiles.map(file => this.stageFile({
      path: path.resolve(file.path),
      role: file.role,
    }));
    const movedPaths = [];
    const timestamp = new Date();

    try {
      const detail = this.repository.transaction(() => {
        for (const stagedFile of stagedFiles) {
          const versionNo = this.repository.nextFileVersion(contractId, stagedFile.role);
          const finalLocation = this.buildFinalFileLocation({
            contractId,
            fileRole: stagedFile.role,
            versionNo,
            originalPath: stagedFile.originalPath,
            sha256: stagedFile.sha256,
          });

          ensureDir(path.dirname(finalLocation.fullPath));
          fs.renameSync(stagedFile.stagedPath, finalLocation.fullPath);
          movedPaths.push(finalLocation.fullPath);

          this.repository.insertFile({
            file_id: crypto.randomUUID(),
            contract_id: contractId,
            file_role: stagedFile.role,
            original_filename: path.basename(stagedFile.originalPath),
            stored_filename: finalLocation.fileName,
            stored_path: finalLocation.fullPath,
            mime_type: stagedFile.mimeType,
            size_bytes: stagedFile.sizeBytes,
            sha256: stagedFile.sha256,
            uploaded_at: toIsoTimestamp(timestamp),
            uploaded_by: operator,
            version_no: versionNo,
          });
        }

        this.repository.insertEvent({
          event_id: crypto.randomUUID(),
          contract_id: contractId,
          event_type: 'files_attached',
          payload_json: JSON.stringify({
            files: parsedFiles,
          }),
          operator,
          created_at: toIsoTimestamp(timestamp),
        });

        return this.getContract(contractId);
      });

      this.writeMetadataSnapshot(contractId);
      return detail;
    } catch (error) {
      this.cleanupFiles([...stagedFiles.map(file => file.stagedPath), ...movedPaths]);
      throw error;
    }
  }

  archiveContract({ contractId, operator, reason }) {
    return this.updateContract({
      contractId,
      patch: { status: 'archived' },
      operator,
      changeReason: reason || 'archived',
    });
  }

  stageFile(file) {
    const sourcePath = path.resolve(file.path);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`File not found: ${sourcePath}`);
    }

    const extension = path.extname(sourcePath).toLowerCase();
    if (!this.config.allowedExtensions.includes(extension)) {
      throw new Error(`File type is not allowed: ${extension}`);
    }

    const stats = fs.statSync(sourcePath);
    const maxBytes = this.config.maxFileSizeMb * 1024 * 1024;

    if (stats.size > maxBytes) {
      throw new Error(`File is too large: ${sourcePath}`);
    }

    const buffer = fs.readFileSync(sourcePath);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const stagedName = `${Date.now()}_${crypto.randomUUID()}${extension}`;
    const stagedPath = path.join(this.config.stagingDir, stagedName);
    fs.writeFileSync(stagedPath, buffer);

    return {
      role: file.role,
      originalPath: sourcePath,
      stagedPath,
      sha256,
      sizeBytes: stats.size,
      mimeType: detectMimeType(sourcePath),
    };
  }

  buildFinalFileLocation({ contractId, fileRole, versionNo, originalPath, sha256 }) {
    const extension = path.extname(originalPath).toLowerCase();
    const fileName = `v${versionNo}_${sanitizeFilePart(fileRole)}_${sha256.slice(0, 8)}${extension}`;

    return {
      fileName,
      fullPath: path.join(this.contractFilesDir(contractId), fileName),
    };
  }

  contractDir(contractId) {
    return path.join(this.config.storageRoot, 'contracts', contractId);
  }

  contractFilesDir(contractId) {
    return path.join(this.contractDir(contractId), 'files');
  }

  writeMetadataSnapshot(contractId) {
    const detail = this.getContract(contractId);
    ensureDir(this.contractDir(contractId));
    fs.writeFileSync(
      path.join(this.contractDir(contractId), 'metadata.json'),
      JSON.stringify(detail, null, 2),
      'utf8',
    );
  }

  cleanupFiles(filePaths) {
    for (const filePath of filePaths) {
      if (!filePath) {
        continue;
      }

      try {
        if (fs.existsSync(filePath)) {
          fs.rmSync(filePath, { force: true });
        }
      } catch {
        // Ignore best-effort cleanup failures.
      }
    }
  }

  cleanupEmptyContractDir(contractId) {
    try {
      fs.rmSync(this.contractDir(contractId), { recursive: true, force: true });
    } catch {
      // Ignore best-effort cleanup failures.
    }
  }

  toCamelCase(field) {
    const mapping = {
      contract_name: 'contractName',
      party_a_name: 'partyAName',
      party_b_name: 'partyBName',
      signing_date: 'signingDate',
      effective_start_date: 'effectiveStartDate',
      effective_end_date: 'effectiveEndDate',
      contract_amount: 'contractAmount',
      currency: 'currency',
      summary: 'summary',
      remarks: 'remarks',
      status: 'status',
    };

    return mapping[field];
  }
}

module.exports = {
  ContractService,
  VALID_FILE_ROLES,
  VALID_STATUSES,
  contractPayloadSchema,
  fileInputSchema,
  updatePatchSchema,
};
*/
