const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ContractRepository = require('./repository');
const { normalizeDateText, normalizeTimestampText } = require('./date-normalize');

const DEFAULT_ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.xls', '.xlsx'];
const DEFAULT_EXCLUDED_SEARCH_NAMES = new Set(['协议台账.xlsx', '电子协议归档规则.txt']);
const LEDGER_SHEET_TEMPLATES = {
  '有结算款项协议': {
    description: '适用于有明确结算金额的收入类或合作结算类协议。',
    fields: [
      { key: '协议类型', required: true },
      { key: '甲方', required: true },
      { key: '乙方', required: true },
      { key: '他方', required: false },
      { key: '签约时', required: true },
      { key: '起始时', required: false },
      { key: '结束时', required: false },
      { key: '我方负责', required: false },
      { key: '他方负责人及联系方式', required: false },
      { key: '总金额', required: false },
      { key: '首期款', required: false },
      { key: '首期付款时间', required: false },
      { key: '尾款', required: false },
      { key: '尾款付款时间', required: false },
      { key: '支付结算情况', required: false },
      { key: '保密要求', required: false },
    ],
  },
  '费用支出协议': {
    description: '适用于采购、外包、租赁等我方支出类协议。',
    fields: [
      { key: '协议类型', required: true },
      { key: '甲方', required: true },
      { key: '乙方', required: true },
      { key: '他方', required: false },
      { key: '签约时', required: true },
      { key: '起始时', required: false },
      { key: '结束时', required: false },
      { key: '我方负责', required: false },
      { key: '他方负责人及联系方式', required: false },
      { key: '总金额', required: false },
      { key: '首期款', required: false },
      { key: '首期付款时间', required: false },
      { key: '尾款', required: false },
      { key: '尾款付款时间', required: false },
      { key: '支付结算情况', required: false },
      { key: '保密要求', required: false },
    ],
  },
  '无结算款项协议': {
    description: '适用于没有固定结算金额、框架协议、MOU、原则性合作协议。',
    fields: [
      { key: '协议类型', required: true },
      { key: '甲方', required: true },
      { key: '乙方', required: true },
      { key: '他方', required: false },
      { key: '签约时', required: true },
      { key: '起始时', required: false },
      { key: '结束时', required: false },
      { key: '我方负责人', required: false },
      { key: '他方负责人及联系方式', required: false },
      { key: '备注', required: false },
      { key: '保密要求', required: false },
    ],
  },
};

function toIsoTimestamp(value = new Date()) {
  return new Date(value).toISOString();
}

function dayKey(value = new Date()) {
  return toIsoTimestamp(value).slice(0, 10).replace(/-/g, '');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureParentDir(filePath) {
  ensureDir(path.dirname(filePath));
}

function normalizeDate(value) {
  return normalizeDateText(value);
}

function normalizeTimestamp(value, { endOfDay = false } = {}) {
  return normalizeTimestampText(value, { endOfDay });
}

function formatDateForMessage(value) {
  if (value == null || value === '') {
    return '';
  }

  const normalized = normalizeDate(value);

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [year, month, day] = normalized.split('-').map(part => String(Number(part)));
    return `${year}.${month}.${day}`;
  }

  return String(value);
}

function sanitizePathPart(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ');
}

function normalizeCompanyNameForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[（）()《》【】\[\]<>〈〉「」『』"'\s\-—_.,，。:：;；·&＆]/g, '');
}

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeRelativeLibraryPath(libraryRoot, requestedPath = '') {
  const text = String(requestedPath || '').trim();

  if (!text) {
    return '';
  }

  const resolved = path.resolve(libraryRoot, text);

  if (!isPathInside(libraryRoot, resolved)) {
    throw new Error(`Path escapes library root: ${requestedPath}`);
  }

  return path.relative(libraryRoot, resolved);
}

function resolveLibraryPath(libraryRoot, relativePath = '') {
  const normalizedRelativePath = normalizeRelativeLibraryPath(libraryRoot, relativePath);
  return path.resolve(libraryRoot, normalizedRelativePath);
}

function computeFileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function toNumberOrNull(value) {
  if (value == null || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value).replace(/,/g, '').trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAmount(value) {
  if (value == null || value === '') {
    return '';
  }

  const numeric = toNumberOrNull(value);

  if (numeric == null) {
    return String(value);
  }

  return String(numeric);
}

function formatBooleanForMessage(value) {
  if (typeof value !== 'boolean') {
    return '';
  }

  return value ? '是' : '否';
}

function formatDirectionForMessage(value) {
  if (value === 'income') {
    return '收入';
  }

  if (value === 'expense') {
    return '支出';
  }

  return '';
}

function formatPreviewValue(value, formatter) {
  const resolved = typeof formatter === 'function' ? formatter(value) : value;

  if (resolved == null) {
    return '';
  }

  if (Array.isArray(resolved)) {
    const items = resolved
      .map(item => String(item == null ? '' : item).trim())
      .filter(Boolean);
    return items.join('、');
  }

  if (typeof resolved === 'object') {
    return JSON.stringify(resolved);
  }

  return String(resolved).trim();
}

function buildKeywordList(values = []) {
  const keywords = new Set();

  for (const value of values) {
    if (value == null || value === '') {
      continue;
    }

    const text = String(value).trim();

    if (!text) {
      continue;
    }

    keywords.add(text);
  }

  return [...keywords];
}

function buildSearchTerms(values = []) {
  const terms = new Set();

  for (const value of values) {
    if (value == null || value === '') {
      continue;
    }

    const text = String(value).trim();

    if (!text) {
      continue;
    }

    for (const term of text.split(/[\s,，;；|/\\]+/u)) {
      const normalized = term.trim();

      if (!normalized) {
        continue;
      }

      terms.add(normalized);
    }
  }

  return [...terms];
}

function hasMeaningfulContractInput(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return false;
  }

  return Object.values(contract).some(value => {
    if (value == null) {
      return false;
    }

    if (typeof value === 'string') {
      return value.trim().length > 0;
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return true;
  });
}

function buildMissingContractGuidance() {
  return [
    'contract_archive 不能省略 contract，也不能传空对象。',
    '请先从附件中提取合同字段后，再重试调用。',
    '至少回填这些已识别字段：contractName、partyAName、partyBName、signingDate 或 effectiveStartDate、direction、uploadedBy。',
    '如果附件里还能识别，也请一并补充：agreementType、otherPartyName、effectiveEndDate、contractAmount、hasSettlement、firstPaymentAmount、firstPaymentDate、finalPaymentAmount、finalPaymentDate、ourOwner、counterpartyContact、paymentStatus、confidentialityRequirement、keywordTags、summary、remarks。',
  ].join(' ');
}

function walkDirectory(rootPath, callback, { includeRoot = false } = {}) {
  const stack = [];

  if (includeRoot) {
    stack.push(rootPath);
  } else {
    for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
      stack.push(path.join(rootPath, entry.name));
    }
  }

  while (stack.length > 0) {
    const currentPath = stack.pop();
    const stat = fs.statSync(currentPath);
    const isDirectory = stat.isDirectory();

    callback(currentPath, stat, isDirectory);

    if (isDirectory) {
      const children = fs.readdirSync(currentPath, { withFileTypes: true })
        .map(entry => path.join(currentPath, entry.name))
        .sort((left, right) => right.localeCompare(left, 'zh-CN'));
      stack.push(...children);
    }
  }
}

function buildFileNameStem({ contractName, counterpartyName, signingDate, effectiveStartDate }) {
  const prefix = dayKey(signingDate || effectiveStartDate || new Date());
  const name = sanitizePathPart(contractName || '协议文件');
  const counterparty = sanitizePathPart(counterpartyName || '');
  return counterparty ? `${prefix}${name}（${counterparty}）` : `${prefix}${name}`;
}

function dedupeTargetFileName(existingNames, candidateName) {
  const extension = path.extname(candidateName);
  const stem = path.basename(candidateName, extension);
  let uniqueName = candidateName;
  let suffix = 2;

  while (existingNames.has(uniqueName.toLowerCase())) {
    uniqueName = `${stem} (${suffix})${extension}`;
    suffix += 1;
  }

  existingNames.add(uniqueName.toLowerCase());
  return uniqueName;
}

function copyFileSync(sourcePath, targetPath) {
  ensureParentDir(targetPath);
  fs.copyFileSync(sourcePath, targetPath);
}

function inferSheetName({ sheetName, contract = {}, archiveRelativeDir = '' }) {
  if (sheetName && LEDGER_SHEET_TEMPLATES[sheetName]) {
    return sheetName;
  }

  const direction = String(contract.direction || '').trim().toLowerCase();
  const hasSettlement = contract.hasSettlement;
  const relativeDir = String(archiveRelativeDir || '');
  const firstSegment = relativeDir.split(/[\\/]/).filter(Boolean)[0] || '';

  if (direction === 'expense' || firstSegment.startsWith('采购')) {
    return '费用支出协议';
  }

  if (hasSettlement === false) {
    return '无结算款项协议';
  }

  if (
    toNumberOrNull(contract.contractAmount) != null
    || toNumberOrNull(contract.firstPaymentAmount) != null
    || toNumberOrNull(contract.finalPaymentAmount) != null
    || hasSettlement === true
  ) {
    return '有结算款项协议';
  }

  return '无结算款项协议';
}

function buildArchivePreviewFieldDefinitions() {
  return [
    { key: 'contractName', label: '合同名称' },
    { key: 'agreementType', label: '协议类型' },
    { key: 'partyAName', label: '甲方' },
    { key: 'partyBName', label: '乙方' },
    { key: 'otherPartyName', label: '他方' },
    { key: 'counterpartyName', label: '相对方' },
    { key: 'direction', label: '启迪视角', formatter: formatDirectionForMessage },
    { key: 'signingDate', label: '签署日期', formatter: formatDateForMessage },
    { key: 'effectiveStartDate', label: '生效开始', formatter: formatDateForMessage },
    { key: 'effectiveEndDate', label: '生效结束', formatter: formatDateForMessage },
    {
      key: 'contractAmount',
      label: '合同金额',
      formatter: (value, context) => {
        const amount = formatAmount(value);
        return amount ? `${amount} ${context.contract.currency || 'CNY'}` : '';
      },
    },
    { key: 'hasSettlement', label: '是否有结算', formatter: formatBooleanForMessage },
    { key: 'firstPaymentAmount', label: '首期款', formatter: formatAmount },
    { key: 'firstPaymentDate', label: '首期付款时间', formatter: formatDateForMessage },
    { key: 'finalPaymentAmount', label: '尾款', formatter: formatAmount },
    { key: 'finalPaymentDate', label: '尾款付款时间', formatter: formatDateForMessage },
    { key: 'paymentStatus', label: '支付结算情况' },
    { key: 'ourOwner', label: '我方负责人' },
    { key: 'counterpartyContact', label: '他方负责人及联系方式' },
    { key: 'confidentialityRequirement', label: '保密要求' },
    { key: 'summary', label: '摘要' },
    { key: 'remarks', label: '备注' },
    { key: 'uploadedBy', label: '上传人' },
    { key: 'uploaderUserId', label: '上传人ID' },
    { key: 'operator', label: '归档操作人' },
    { key: 'sheetName', label: '归档台账分类' },
    { key: 'archiveRelativeDir', label: '归档相对目录' },
    { key: 'archiveAbsoluteDir', label: '归档绝对目录' },
    { key: 'searchKeywords', label: '检索关键词' },
    { key: 'keywordTags', label: '标签关键词' },
    { key: 'uncertainFields', label: '当前不确定字段' },
  ];
}

class ContractService {
  constructor(config) {
    this.config = {
      libraryRoot: path.resolve(config.libraryRoot),
      dbPath: config.dbPath
        ? path.resolve(config.dbPath)
        : path.resolve(config.libraryRoot, '合同归档.db'),
      archiveIdPrefix: config.archiveIdPrefix || config.contractIdPrefix || 'A',
      allowedExtensions: (config.allowedExtensions || DEFAULT_ALLOWED_EXTENSIONS).map(value => String(value).toLowerCase()),
      maxFileSizeMb: Number.isFinite(config.maxFileSizeMb) ? config.maxFileSizeMb : 50,
      defaultSearchLimit: Number.isFinite(config.defaultSearchLimit) ? config.defaultSearchLimit : 20,
      excludedSearchNames: new Set([
        ...DEFAULT_EXCLUDED_SEARCH_NAMES,
        ...(Array.isArray(config.excludedSearchNames) ? config.excludedSearchNames : []),
      ]),
      ourCompanyAliases: Array.isArray(config.ourCompanyAliases)
        ? config.ourCompanyAliases.map(value => String(value || '').trim()).filter(Boolean)
        : [],
    };

    ensureDir(this.config.libraryRoot);
    ensureParentDir(this.config.dbPath);
    this.repository = new ContractRepository(this.config.dbPath);
  }

  close() {
    this.repository?.close();
    return undefined;
  }

  nextArchiveId() {
    const prefix = sanitizePathPart(this.config.archiveIdPrefix || 'A') || 'A';
    return this.repository.nextArchiveId(prefix, dayKey());
  }

  mapArchiveRecordRow(row, fileRows = []) {
    if (!row) {
      return null;
    }

    const mappedFiles = Array.isArray(fileRows)
      ? fileRows.map(fileRow => this.mapArchiveFileRow(fileRow))
      : [];

    return {
      archiveId: row.archive_id,
      pendingId: row.pending_id || '',
      contractName: row.contract_name,
      agreementType: row.agreement_type || '',
      partyAName: row.party_a_name || '',
      partyBName: row.party_b_name || '',
      otherPartyName: row.other_party_name || '',
      counterpartyName: row.counterparty_name || '',
      direction: row.direction || '',
      signingDate: row.signing_date || '',
      effectiveStartDate: row.effective_start_date || '',
      effectiveEndDate: row.effective_end_date || '',
      contractAmount: row.contract_amount,
      currency: row.currency || 'CNY',
      summary: row.summary || '',
      remarks: row.remarks || '',
      ourOwner: row.our_owner || '',
      counterpartyContact: row.counterparty_contact || '',
      firstPaymentAmount: row.first_payment_amount,
      firstPaymentDate: row.first_payment_date || '',
      finalPaymentAmount: row.final_payment_amount,
      finalPaymentDate: row.final_payment_date || '',
      paymentStatus: row.payment_status || '',
      confidentialityRequirement: row.confidentiality_requirement || '',
      hasSettlement: row.has_settlement == null ? undefined : row.has_settlement === 1,
      uploadedBy: row.uploaded_by || '',
      uploaderUserId: row.uploader_user_id || '',
      operator: row.operator || '',
      sheetName: row.sheet_name || '',
      archiveRelativeDir: row.archive_relative_dir,
      archiveAbsoluteDir: row.archive_absolute_dir,
      keywordTags: JSON.parse(row.keyword_tags_json || '[]'),
      searchKeywords: JSON.parse(row.search_keywords_json || '[]'),
      uncertainFields: JSON.parse(row.uncertain_fields_json || '[]'),
      ledgerFields: JSON.parse(row.ledger_fields_json || '{}'),
      status: row.status,
      sourceChannel: row.source_channel || '',
      sourceMessageId: row.source_message_id || '',
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      fileCount: mappedFiles.length,
      storedFiles: mappedFiles.map(file => file.storedName),
    };
  }

  mapArchiveFileRow(row) {
    return {
      fileId: row.file_id,
      archiveId: row.archive_id,
      sourceName: row.source_name,
      storedName: row.stored_name,
      absolutePath: row.absolute_path,
      relativePath: row.relative_path,
      extension: row.extension || '',
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
    };
  }

  mapArchiveEventRow(row) {
    return {
      eventId: row.event_id,
      archiveId: row.archive_id,
      eventType: row.event_type,
      operator: row.operator,
      createdAt: row.created_at,
      payload: JSON.parse(row.payload_json),
    };
  }

  composeArchiveRecordDetail(archiveRow) {
    const fileRows = this.repository.listFiles(archiveRow?.archive_id);
    const files = fileRows.map(row => this.mapArchiveFileRow(row));
    const archive = this.mapArchiveRecordRow(archiveRow, fileRows);

    if (!archive) {
      return null;
    }

    return {
      archive,
      files,
      events: this.repository.listEvents(archive.archiveId).map(row => this.mapArchiveEventRow(row)),
    };
  }

  persistArchiveRecord({
    pendingId = '',
    contract,
    sheetName,
    ledgerFields,
    uncertainFields,
    searchKeywords,
    archiveRelativeDir,
    archiveAbsoluteDir,
    committedFiles,
    operator = '',
    uploaderUserId = '',
    idempotencyKey = '',
    sourceChannel = '',
    sourceMessageId = '',
  }) {
    const existing = this.repository.findRecordByIdempotencyKey(idempotencyKey);

    if (existing) {
      return this.composeArchiveRecordDetail(existing);
    }

    const timestamp = toIsoTimestamp();
    const archiveId = this.nextArchiveId();
    const counterpartyName = this.deriveCounterpartyName(contract);
    const detail = this.repository.transaction(() => {
      this.repository.insertRecord({
        archive_id: archiveId,
        pending_id: pendingId || null,
        contract_name: contract.contractName || '',
        agreement_type: contract.agreementType || '',
        party_a_name: contract.partyAName || '',
        party_b_name: contract.partyBName || '',
        other_party_name: contract.otherPartyName || '',
        counterparty_name: counterpartyName || '',
        direction: contract.direction || '',
        signing_date: contract.signingDate || null,
        effective_start_date: contract.effectiveStartDate || null,
        effective_end_date: contract.effectiveEndDate || null,
        contract_amount: contract.contractAmount,
        currency: contract.currency || 'CNY',
        summary: contract.summary || '',
        remarks: contract.remarks || '',
        our_owner: contract.ourOwner || '',
        counterparty_contact: contract.counterpartyContact || '',
        first_payment_amount: contract.firstPaymentAmount,
        first_payment_date: contract.firstPaymentDate || null,
        final_payment_amount: contract.finalPaymentAmount,
        final_payment_date: contract.finalPaymentDate || null,
        payment_status: contract.paymentStatus || '',
        confidentiality_requirement: contract.confidentialityRequirement || '',
        has_settlement: typeof contract.hasSettlement === 'boolean' ? (contract.hasSettlement ? 1 : 0) : null,
        uploaded_by: contract.uploadedBy || operator || '',
        uploader_user_id: uploaderUserId || '',
        operator: operator || '',
        sheet_name: sheetName || '',
        archive_relative_dir: archiveRelativeDir,
        archive_absolute_dir: archiveAbsoluteDir,
        keyword_tags_json: JSON.stringify(contract.keywordTags || []),
        search_keywords_json: JSON.stringify(searchKeywords || []),
        uncertain_fields_json: JSON.stringify(uncertainFields || []),
        ledger_fields_json: JSON.stringify(ledgerFields || {}),
        status: 'archived',
        source_channel: sourceChannel || null,
        source_message_id: sourceMessageId || null,
        idempotency_key: idempotencyKey || null,
        archived_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
      });

      committedFiles.forEach((file, index) => {
        this.repository.insertFile({
          file_id: crypto.randomUUID(),
          archive_id: archiveId,
          source_name: file.sourceName,
          stored_name: path.basename(file.absolutePath),
          absolute_path: file.absolutePath,
          relative_path: file.relativePath,
          extension: path.extname(file.absolutePath).toLowerCase(),
          size_bytes: file.sizeBytes,
          sha256: computeFileSha256(file.absolutePath),
          sort_order: index,
          created_at: timestamp,
        });
      });

      this.repository.insertEvent({
        event_id: crypto.randomUUID(),
        archive_id: archiveId,
        event_type: 'archived',
        payload_json: JSON.stringify({
          archiveId,
          pendingId: pendingId || null,
          contract: {
            ...contract,
            counterpartyName,
          },
          sheetName: sheetName || '',
          archiveRelativeDir,
          archiveAbsoluteDir,
          ledgerFields: ledgerFields || {},
          uncertainFields: uncertainFields || [],
          searchKeywords: searchKeywords || [],
          uploaderUserId: uploaderUserId || '',
          operator: operator || '',
          archivedAt: timestamp,
          committedFiles: committedFiles.map(file => ({
            relativePath: file.relativePath,
            absolutePath: file.absolutePath,
            sourceName: file.sourceName,
            sizeBytes: file.sizeBytes,
          })),
        }),
        operator: operator || contract.uploadedBy || '',
        created_at: timestamp,
      });

      return this.composeArchiveRecordDetail(this.repository.getRecordRow(archiveId));
    });

    return detail;
  }

  rollbackCommittedFiles(committedFiles = []) {
    for (const file of [...committedFiles].reverse()) {
      try {
        if (fs.existsSync(file.absolutePath)) {
          fs.unlinkSync(file.absolutePath);
        }
      } catch {
        // Best effort rollback only.
      }
    }
  }

  normalizeContract(contract = {}) {
    return {
      contractName: contract.contractName || '',
      agreementType: contract.agreementType || '',
      partyAName: contract.partyAName || '',
      partyBName: contract.partyBName || '',
      otherPartyName: contract.otherPartyName || '',
      signingDate: normalizeDate(contract.signingDate),
      effectiveStartDate: normalizeDate(contract.effectiveStartDate),
      effectiveEndDate: normalizeDate(contract.effectiveEndDate),
      contractAmount: toNumberOrNull(contract.contractAmount),
      currency: contract.currency || 'CNY',
      summary: contract.summary || '',
      remarks: contract.remarks || '',
      ourOwner: contract.ourOwner || '',
      counterpartyContact: contract.counterpartyContact || '',
      firstPaymentAmount: toNumberOrNull(contract.firstPaymentAmount),
      firstPaymentDate: normalizeDate(contract.firstPaymentDate),
      finalPaymentAmount: toNumberOrNull(contract.finalPaymentAmount),
      finalPaymentDate: normalizeDate(contract.finalPaymentDate),
      paymentStatus: contract.paymentStatus || '',
      confidentialityRequirement: contract.confidentialityRequirement || '',
      hasSettlement: typeof contract.hasSettlement === 'boolean' ? contract.hasSettlement : undefined,
      direction: contract.direction || '',
      uploadedBy: contract.uploadedBy || '',
      keywordTags: Array.isArray(contract.keywordTags) ? buildKeywordList(contract.keywordTags) : [],
    };
  }

  isOurCompany(name) {
    const normalizedName = normalizeCompanyNameForMatch(name);

    if (!normalizedName) {
      return false;
    }

    return this.config.ourCompanyAliases.some(alias => {
      const normalizedAlias = normalizeCompanyNameForMatch(alias);
      return normalizedAlias && (normalizedName.includes(normalizedAlias) || normalizedAlias.includes(normalizedName));
    });
  }

  deriveCounterpartyName(contract = {}) {
    if (contract.otherPartyName) {
      return contract.otherPartyName;
    }

    const partyAIsUs = this.isOurCompany(contract.partyAName);
    const partyBIsUs = this.isOurCompany(contract.partyBName);

    if (partyAIsUs && !partyBIsUs && contract.partyBName) {
      return contract.partyBName;
    }

    if (partyBIsUs && !partyAIsUs && contract.partyAName) {
      return contract.partyAName;
    }

    return contract.partyBName || contract.partyAName || '';
  }

  validateSourceFiles(sourceFiles = []) {
    if (!Array.isArray(sourceFiles) || sourceFiles.length === 0) {
      throw new Error('At least one source file is required.');
    }

    return sourceFiles.map((sourceFile, index) => {
      const sourcePath = path.resolve(String(sourceFile?.path || ''));

      if (!sourcePath || !fs.existsSync(sourcePath)) {
        throw new Error(`Source file does not exist: ${sourceFile?.path || `#${index + 1}`}`);
      }

      const stat = fs.statSync(sourcePath);

      if (!stat.isFile()) {
        throw new Error(`Source path is not a file: ${sourcePath}`);
      }

      const extension = path.extname(sourcePath).toLowerCase();

      if (!this.config.allowedExtensions.includes(extension)) {
        throw new Error(`Unsupported file extension: ${extension}`);
      }

      const maxFileSizeBytes = this.config.maxFileSizeMb * 1024 * 1024;

      if (stat.size > maxFileSizeBytes) {
        throw new Error(`File is too large: ${sourcePath}`);
      }

      return {
        path: sourcePath,
        name: sourceFile?.name || path.basename(sourcePath),
        extension,
        sizeBytes: stat.size,
      };
    });
  }

  buildLedgerFields({ contract, sheetName, ledgerFields = {}, archiveRelativeDir = '' }) {
    const firstSegment = String(archiveRelativeDir || '').split(/[\\/]/).filter(Boolean)[0] || '';
    const fallbackAgreementType = contract.agreementType
      || (firstSegment.startsWith('采购') ? '采购' : firstSegment)
      || '';
    const baseFields = {
      协议类型: fallbackAgreementType,
      甲方: contract.partyAName,
      乙方: contract.partyBName,
      他方: contract.otherPartyName,
      签约时: formatDateForMessage(contract.signingDate),
      起始时: formatDateForMessage(contract.effectiveStartDate),
      结束时: formatDateForMessage(contract.effectiveEndDate),
      我方负责: contract.ourOwner,
      我方负责人: contract.ourOwner,
      他方负责人及联系方式: contract.counterpartyContact,
      总金额: formatAmount(contract.contractAmount),
      首期款: formatAmount(contract.firstPaymentAmount),
      首期付款时间: formatDateForMessage(contract.firstPaymentDate),
      尾款: formatAmount(contract.finalPaymentAmount),
      尾款付款时间: formatDateForMessage(contract.finalPaymentDate),
      支付结算情况: contract.paymentStatus,
      备注: contract.remarks || contract.summary,
      保密要求: contract.confidentialityRequirement,
    };

    const merged = {};

    for (const field of LEDGER_SHEET_TEMPLATES[sheetName].fields) {
      const explicitValue = ledgerFields[field.key];
      const fallbackValue = baseFields[field.key];
      const resolvedValue = explicitValue == null || explicitValue === ''
        ? fallbackValue
        : explicitValue;

      merged[field.key] = resolvedValue == null ? '' : resolvedValue;
    }

    return merged;
  }

  collectUncertainFields(sheetName, ledgerFields = {}, explicitUncertainFields = []) {
    if (Array.isArray(explicitUncertainFields) && explicitUncertainFields.length > 0) {
      return buildKeywordList(explicitUncertainFields);
    }

    return LEDGER_SHEET_TEMPLATES[sheetName].fields
      .filter(field => field.required && (ledgerFields[field.key] == null || ledgerFields[field.key] === ''))
      .map(field => field.key);
  }

  buildPlannedFiles(contract, sourceFiles) {
    const usedNames = new Set();
    const stem = buildFileNameStem({
      contractName: contract.contractName,
      counterpartyName: this.deriveCounterpartyName(contract),
      signingDate: contract.signingDate,
      effectiveStartDate: contract.effectiveStartDate,
    });

    return sourceFiles.map((sourceFile, index) => {
      const suffix = sourceFiles.length === 1
        ? ''
        : `-${index === 0 ? '正文' : `附件${index}`}`;
      const targetName = dedupeTargetFileName(usedNames, `${stem}${suffix}${sourceFile.extension}`);

      return {
        sourcePath: sourceFile.path,
        sourceName: sourceFile.name,
        extension: sourceFile.extension,
        sizeBytes: sourceFile.sizeBytes,
        targetName,
      };
    });
  }

  buildArchivePreview(draft) {
    const archiveAbsoluteDir = resolveLibraryPath(this.config.libraryRoot, draft.archiveRelativeDir);
    const plannedFiles = this.buildPlannedFiles(draft.contract, draft.sourceFiles).map(file => ({
      sourceName: file.sourceName,
      targetName: file.targetName,
      extension: file.extension,
      sizeBytes: file.sizeBytes,
      absoluteTargetPath: path.join(archiveAbsoluteDir, file.targetName),
      relativeTargetPath: path.join(draft.archiveRelativeDir, file.targetName),
    }));
    const context = {
      contract: draft.contract,
      uploaderUserId: draft.uploaderUserId,
      operator: draft.operator,
      sheetName: draft.sheetName,
      archiveRelativeDir: draft.archiveRelativeDir,
      archiveAbsoluteDir,
      searchKeywords: draft.searchKeywords,
      keywordTags: draft.contract.keywordTags || [],
      uncertainFields: draft.uncertainFields,
    };
    const importantFields = buildArchivePreviewFieldDefinitions().map(definition => {
      const rawValue = definition.key in context
        ? context[definition.key]
        : draft.contract[definition.key];
      const displayValue = formatPreviewValue(
        rawValue,
        definition.formatter ? value => definition.formatter(value, context) : undefined,
      );

      return {
        key: definition.key,
        label: definition.label,
        filled: displayValue !== '',
        value: displayValue || '未填写',
      };
    });
    const filledFields = importantFields.filter(field => field.filled);
    const emptyFields = importantFields.filter(field => !field.filled);
    const ledgerFieldEntries = Object.entries(draft.ledgerFields || {}).map(([key, value]) => {
      const displayValue = formatPreviewValue(value);
      return {
        key,
        filled: displayValue !== '',
        value: displayValue || '未填写',
      };
    });

    return {
      contract: {
        ...draft.contract,
        counterpartyName: this.deriveCounterpartyName(draft.contract),
      },
      archiveRelativeDir: draft.archiveRelativeDir,
      archiveAbsoluteDir,
      sheetName: draft.sheetName,
      plannedFiles,
      importantFields,
      missingImportantFields: emptyFields.map(field => field.label),
      ledgerFields: draft.ledgerFields,
      ledgerFieldEntries,
      uncertainFields: draft.uncertainFields,
      searchKeywords: draft.searchKeywords,
      confirmationMessage: [
        '请确认以下“最终归档时将写入归档库/目录”的内容：',
        '',
        '已填写的重要字段：',
        ...(filledFields.length > 0
          ? filledFields.map(field => `${field.label}：${field.value}`)
          : ['无']),
        '',
        '未填写的重要字段：',
        ...(emptyFields.length > 0
          ? emptyFields.map(field => `${field.label}：未填写`)
          : ['无']),
        '',
        '拟归档文件：',
        ...plannedFiles.map(file => `${file.sourceName} -> ${file.targetName}`),
        '',
        `拟归档目录：${draft.archiveRelativeDir}`,
        `拟写入台账分类：${draft.sheetName}`,
        '',
        '拟写入台账字段：',
        ...(ledgerFieldEntries.length > 0
          ? ledgerFieldEntries.map(field => `${field.key}：${field.value}`)
          : ['无']),
        '',
        `检索关键词：${draft.searchKeywords.length > 0 ? draft.searchKeywords.join('、') : '无'}`,
        `当前不确定字段：${draft.uncertainFields.length > 0 ? draft.uncertainFields.join('、') : '无'}`,
      ].join('\n'),
    };
  }

  enrichArchive(record) {
    const absoluteDir = resolveLibraryPath(this.config.libraryRoot, record.archive.relativeDir);
    const plannedFiles = record.archive.plannedFiles.map(file => ({
      ...file,
      absoluteTargetPath: path.join(absoluteDir, file.targetName),
      relativeTargetPath: path.join(record.archive.relativeDir, file.targetName),
    }));

    return {
      ...record.archive,
      absoluteDir,
      plannedFiles,
    };
  }

  buildArchiveDraft(input = {}) {
    if (!hasMeaningfulContractInput(input.contract)) {
      throw new Error(buildMissingContractGuidance());
    }

    const contract = this.normalizeContract(input.contract || {});
    const sourceFiles = this.validateSourceFiles(input.sourceFiles || input.files || []);
    const archiveRelativeDir = normalizeRelativeLibraryPath(this.config.libraryRoot, input.archiveRelativeDir || input.relativeDir || '');

    if (!archiveRelativeDir) {
      throw new Error('archiveRelativeDir is required.');
    }

    const sheetName = inferSheetName({
      sheetName: input.sheetName,
      contract,
      archiveRelativeDir,
    });
    const ledgerFields = this.buildLedgerFields({
      contract,
      sheetName,
      ledgerFields: input.ledgerFields || {},
      archiveRelativeDir,
    });
    const uncertainFields = this.collectUncertainFields(sheetName, ledgerFields, input.uncertainFields || []);
    const searchKeywords = buildKeywordList([
      contract.contractName,
      contract.agreementType,
      contract.partyAName,
      contract.partyBName,
      contract.otherPartyName,
      ...(contract.keywordTags || []),
      ...(input.searchKeywords || []),
    ]);

    return {
      contract,
      sourceFiles,
      archiveRelativeDir,
      sheetName,
      ledgerFields,
      uncertainFields,
      searchKeywords,
      uploaderUserId: String(input.uploaderUserId || input.operator || '').trim(),
      uploadedBy: contract.uploadedBy || String(input.operator || '').trim(),
      sourceChannel: String(input.sourceChannel || '').trim(),
      sourceMessageId: String(input.sourceMessageId || '').trim(),
      operator: String(input.operator || '').trim(),
    };
  }

  previewArchive(input = {}) {
    const draft = this.buildArchiveDraft(input);
    return this.buildArchivePreview(draft);
  }

  archiveContract(input = {}) {
    const draft = this.buildArchiveDraft(input);
    const preview = this.buildArchivePreview(draft);
    const archiveDir = resolveLibraryPath(this.config.libraryRoot, draft.archiveRelativeDir);
    ensureDir(archiveDir);
    const committedFiles = [];

    for (const plannedFile of this.buildPlannedFiles(draft.contract, draft.sourceFiles)) {
      let targetPath = path.join(archiveDir, plannedFile.targetName);

      if (fs.existsSync(targetPath)) {
        const extension = path.extname(plannedFile.targetName);
        const stem = path.basename(plannedFile.targetName, extension);
        let suffix = 2;

        while (fs.existsSync(targetPath)) {
          targetPath = path.join(archiveDir, `${stem} (${suffix})${extension}`);
          suffix += 1;
        }
      }

      copyFileSync(plannedFile.sourcePath, targetPath);
      committedFiles.push({
        sourcePath: plannedFile.sourcePath,
        sourceName: plannedFile.sourceName,
        absolutePath: targetPath,
        relativePath: path.relative(this.config.libraryRoot, targetPath),
        sizeBytes: plannedFile.sizeBytes,
      });
    }

    let detail;
    try {
      detail = this.persistArchiveRecord({
        contract: draft.contract,
        sheetName: draft.sheetName,
        ledgerFields: draft.ledgerFields,
        uncertainFields: draft.uncertainFields,
        searchKeywords: draft.searchKeywords,
        archiveRelativeDir: draft.archiveRelativeDir,
        archiveAbsoluteDir: archiveDir,
        committedFiles,
        operator: draft.operator,
        uploaderUserId: draft.uploaderUserId,
        idempotencyKey: input.idempotencyKey || `archive:${draft.operator}:${draft.contract.contractName}:${draft.archiveRelativeDir}:${committedFiles.map(file => file.relativePath).join('|')}`,
        sourceChannel: draft.sourceChannel,
        sourceMessageId: draft.sourceMessageId,
      });
    } catch (error) {
      this.rollbackCommittedFiles(committedFiles);
      throw error;
    }

    return {
      archive: detail.archive,
      files: detail.files,
      userReplyMessage: [
        `已按确认内容完成归档：${detail.archive.archiveId}`,
        `NAS目录：${detail.archive.archiveAbsoluteDir}`,
        `数据库：${this.config.dbPath}`,
        '本次写入归档库的重要字段：',
        ...preview.importantFields
          .filter(field => field.filled)
          .map(field => `${field.label}：${field.value}`),
        `本次写入台账分类：${preview.sheetName}`,
        `本次不确定字段：${preview.uncertainFields.length > 0 ? preview.uncertainFields.join('、') : '无'}`,
      ].join('\n'),
      archiveDatabasePath: this.config.dbPath,
    };
  }

  getArchiveRecord(archiveId) {
    const archiveRow = this.repository.getRecordRow(archiveId);

    if (!archiveRow) {
      throw new Error(`Archive record not found: ${archiveId}`);
    }

    return this.composeArchiveRecordDetail(archiveRow);
  }

  searchArchiveRecords(input = {}) {
    const keywordTerms = buildSearchTerms([input.keyword || '']);
    const normalizedFilters = {
      keyword: String(input.keyword || '').trim(),
      keyword_terms: keywordTerms,
      archive_relative_dir: String(input.archiveRelativeDir || '').trim(),
      contract_name: String(input.contractName || '').trim(),
      counterparty_name: String(input.counterpartyName || '').trim(),
      agreement_type: String(input.agreementType || '').trim(),
      direction: String(input.direction || '').trim(),
      uploaded_by: String(input.uploadedBy || '').trim(),
      our_owner: String(input.ourOwner || '').trim(),
      payment_status: String(input.paymentStatus || '').trim(),
      has_settlement: typeof input.hasSettlement === 'boolean'
        ? (input.hasSettlement ? 1 : 0)
        : undefined,
      signing_date_from: input.signingDateFrom ? normalizeDate(input.signingDateFrom) : '',
      signing_date_to: input.signingDateTo ? normalizeDate(input.signingDateTo) : '',
      effective_start_from: input.effectiveStartFrom ? normalizeDate(input.effectiveStartFrom) : '',
      effective_start_to: input.effectiveStartTo ? normalizeDate(input.effectiveStartTo) : '',
      effective_end_from: input.effectiveEndFrom ? normalizeDate(input.effectiveEndFrom) : '',
      effective_end_to: input.effectiveEndTo
        ? normalizeDate(input.effectiveEndTo)
        : (input.effectiveEndBefore ? normalizeDate(input.effectiveEndBefore) : ''),
      first_payment_date_from: input.firstPaymentDateFrom ? normalizeDate(input.firstPaymentDateFrom) : '',
      first_payment_date_to: input.firstPaymentDateTo ? normalizeDate(input.firstPaymentDateTo) : '',
      final_payment_date_from: input.finalPaymentDateFrom ? normalizeDate(input.finalPaymentDateFrom) : '',
      final_payment_date_to: input.finalPaymentDateTo ? normalizeDate(input.finalPaymentDateTo) : '',
      min_amount: typeof input.minAmount === 'number'
        ? input.minAmount
        : (input.minAmount == null || input.minAmount === '' ? undefined : Number(input.minAmount)),
      max_amount: typeof input.maxAmount === 'number'
        ? input.maxAmount
        : (input.maxAmount == null || input.maxAmount === '' ? undefined : Number(input.maxAmount)),
      archived_at_from: input.archivedAtFrom ? normalizeTimestamp(input.archivedAtFrom) : '',
      archived_at_to: input.archivedAtTo ? normalizeTimestamp(input.archivedAtTo, { endOfDay: true }) : '',
      created_at_from: input.createdAtFrom ? normalizeTimestamp(input.createdAtFrom) : '',
      created_at_to: input.createdAtTo ? normalizeTimestamp(input.createdAtTo, { endOfDay: true }) : '',
      updated_at_from: input.updatedAtFrom ? normalizeTimestamp(input.updatedAtFrom) : '',
      updated_at_to: input.updatedAtTo ? normalizeTimestamp(input.updatedAtTo, { endOfDay: true }) : '',
      limit: Number.isFinite(input.limit) ? Math.max(1, Math.min(Math.trunc(input.limit), 100)) : this.config.defaultSearchLimit,
    };

    if (normalizedFilters.min_amount != null && !Number.isFinite(normalizedFilters.min_amount)) {
      throw new Error(`Invalid minAmount: ${input.minAmount}`);
    }

    if (normalizedFilters.max_amount != null && !Number.isFinite(normalizedFilters.max_amount)) {
      throw new Error(`Invalid maxAmount: ${input.maxAmount}`);
    }

    const rows = this.repository.searchRecords(normalizedFilters);

    return {
      items: rows.map(row => {
        const fileRows = this.repository.listFiles(row.archive_id);
        return this.mapArchiveRecordRow(row, fileRows);
      }),
      archiveDatabasePath: this.config.dbPath,
    };
  }

  listDirectory(input = {}) {
    const depth = Number.isFinite(input.depth) ? Math.max(0, Math.trunc(input.depth)) : 1;
    const includeFiles = input.includeFiles === true;
    const maxEntries = Number.isFinite(input.maxEntries) ? Math.max(1, Math.trunc(input.maxEntries)) : 200;
    const targetRelativePath = normalizeRelativeLibraryPath(this.config.libraryRoot, input.relativePath || '');
    const targetAbsolutePath = resolveLibraryPath(this.config.libraryRoot, targetRelativePath);

    if (!fs.existsSync(targetAbsolutePath)) {
      throw new Error(`Directory not found: ${targetRelativePath || '.'}`);
    }

    const buildNode = (absolutePath, currentDepth) => {
      const stat = fs.statSync(absolutePath);
      const isDirectory = stat.isDirectory();
      const relativePath = path.relative(this.config.libraryRoot, absolutePath);
      const node = {
        name: path.basename(absolutePath),
        relativePath,
        absolutePath,
        type: isDirectory ? 'directory' : 'file',
        lastModifiedAt: stat.mtime.toISOString(),
      };

      if (!isDirectory) {
        node.sizeBytes = stat.size;
        return node;
      }

      if (currentDepth >= depth) {
        return node;
      }

      const children = fs.readdirSync(absolutePath, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
        .slice(0, maxEntries)
        .map(entry => path.join(absolutePath, entry.name))
        .map(childPath => buildNode(childPath, currentDepth + 1))
        .filter(child => child && (includeFiles || child.type === 'directory'));

      if (children.length > 0) {
        node.children = children;
      }

      return node;
    };

    return {
      root: {
        relativePath: targetRelativePath,
        absolutePath: targetAbsolutePath,
      },
      tree: buildNode(targetAbsolutePath, 0),
      maxEntries,
      includeFiles,
      depth,
    };
  }

  findDirectories(input = {}) {
    const keywords = buildKeywordList([...(input.keywords || []), input.keyword || '']);

    if (keywords.length === 0) {
      throw new Error('At least one keyword is required to find directories.');
    }

    const topLevelCategory = String(input.topLevelCategory || '').trim();
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.trunc(input.limit)) : this.config.defaultSearchLimit;
    const items = [];

    walkDirectory(this.config.libraryRoot, (currentPath, stat, isDirectory) => {
      if (!isDirectory || currentPath === this.config.libraryRoot) {
        return;
      }

      const relativePath = path.relative(this.config.libraryRoot, currentPath);
      const relativeLower = relativePath.toLowerCase();
      const firstSegment = relativePath.split(path.sep).filter(Boolean)[0] || '';

      if (topLevelCategory && firstSegment !== topLevelCategory) {
        return;
      }

      let score = 0;

      for (const keyword of keywords) {
        const normalizedKeyword = keyword.toLowerCase();

        if (relativeLower.includes(normalizedKeyword)) {
          score += 2;
        } else if (path.basename(relativePath).toLowerCase().includes(normalizedKeyword)) {
          score += 1;
        }
      }

      if (score === 0) {
        return;
      }

      items.push({
        relativePath,
        absolutePath: currentPath,
        lastModifiedAt: stat.mtime.toISOString(),
        score,
      });
    }, { includeRoot: false });

    items.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.lastModifiedAt.localeCompare(left.lastModifiedAt);
    });

    return {
      keywords,
      items: items.slice(0, limit),
      limit,
    };
  }

  searchContracts(input = {}) {
    const keyword = String(input.keyword || '').trim();
    const keywords = buildKeywordList([keyword, ...(input.keywords || [])]);
    const searchTerms = buildSearchTerms([keyword, ...(input.keywords || [])]);
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.trunc(input.limit)) : this.config.defaultSearchLimit;
    const topLevelCategory = String(input.topLevelCategory || '').trim();
    const modifiedAfter = input.modifiedAfter ? new Date(input.modifiedAfter) : null;
    const modifiedBefore = input.modifiedBefore ? new Date(input.modifiedBefore) : null;
    const recentMonths = Number.isFinite(input.recentMonths) ? Math.max(0, Math.trunc(input.recentMonths)) : null;
    const effectiveModifiedAfter = recentMonths != null
      ? new Date(Date.now() - recentMonths * 30 * 24 * 60 * 60 * 1000)
      : modifiedAfter;
    const items = [];

    walkDirectory(this.config.libraryRoot, (currentPath, stat, isDirectory) => {
      if (isDirectory) {
        return;
      }

      const fileName = path.basename(currentPath);
      const extension = path.extname(fileName).toLowerCase();

      if (!this.config.allowedExtensions.includes(extension)) {
        return;
      }

      if (this.config.excludedSearchNames.has(fileName)) {
        return;
      }

      const relativePath = path.relative(this.config.libraryRoot, currentPath);
      const firstSegment = relativePath.split(path.sep).filter(Boolean)[0] || '';

      if (topLevelCategory && firstSegment !== topLevelCategory) {
        return;
      }

      if (effectiveModifiedAfter && stat.mtime < effectiveModifiedAfter) {
        return;
      }

      if (modifiedBefore && stat.mtime > modifiedBefore) {
        return;
      }

      const haystack = relativePath.toLowerCase();
      const matchedTerms = searchTerms.filter(entry => haystack.includes(entry.toLowerCase()));

      if (searchTerms.length > 0 && matchedTerms.length === 0) {
        return;
      }

      items.push({
        fileName,
        relativePath,
        absolutePath: currentPath,
        topLevelCategory: firstSegment,
        modifiedAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
        matchCount: matchedTerms.length,
      });
    }, { includeRoot: false });

    items.sort((left, right) => {
      if (right.matchCount !== left.matchCount) {
        return right.matchCount - left.matchCount;
      }

      return right.modifiedAt.localeCompare(left.modifiedAt);
    });

    return {
      keyword,
      keywords,
      limit,
      items: items.slice(0, limit).map(({ matchCount, ...item }) => item),
      searchedRoot: this.config.libraryRoot,
    };
  }
}

module.exports = {
  ContractService,
  LEDGER_SHEET_TEMPLATES,
};
