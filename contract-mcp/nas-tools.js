const { z } = require('zod');
const { LEDGER_SHEET_TEMPLATES } = require('./nas-service');

function buildContractSchema() {
  return z.object({
    contractName: z.string().optional(),
    agreementType: z.string().optional(),
    partyAName: z.string().optional(),
    partyBName: z.string().optional(),
    otherPartyName: z.string().optional(),
    signingDate: z.string().optional(),
    effectiveStartDate: z.string().optional(),
    effectiveEndDate: z.string().optional(),
    contractAmount: z.union([z.number(), z.string()]).optional(),
    currency: z.string().optional(),
    summary: z.string().optional(),
    remarks: z.string().optional(),
    ourOwner: z.string().optional(),
    counterpartyContact: z.string().optional(),
    firstPaymentAmount: z.union([z.number(), z.string()]).optional(),
    firstPaymentDate: z.string().optional(),
    finalPaymentAmount: z.union([z.number(), z.string()]).optional(),
    finalPaymentDate: z.string().optional(),
    paymentStatus: z.string().optional(),
    confidentialityRequirement: z.string().optional(),
    hasSettlement: z.boolean().optional(),
    direction: z.enum(['income', 'expense']).optional(),
    uploadedBy: z.string().optional(),
    keywordTags: z.array(z.string()).optional(),
  }).strict();
}

function buildContractInputSchema() {
  return {
    type: 'object',
    properties: {
      contractName: { type: 'string' },
      agreementType: { type: 'string' },
      partyAName: { type: 'string' },
      partyBName: { type: 'string' },
      otherPartyName: { type: 'string' },
      signingDate: { type: 'string' },
      effectiveStartDate: { type: 'string' },
      effectiveEndDate: { type: 'string' },
      contractAmount: {
        anyOf: [
          { type: 'number' },
          { type: 'string' },
        ],
      },
      currency: { type: 'string' },
      summary: { type: 'string' },
      remarks: { type: 'string' },
      ourOwner: { type: 'string' },
      counterpartyContact: { type: 'string' },
      firstPaymentAmount: {
        anyOf: [
          { type: 'number' },
          { type: 'string' },
        ],
      },
      firstPaymentDate: { type: 'string' },
      finalPaymentAmount: {
        anyOf: [
          { type: 'number' },
          { type: 'string' },
        ],
      },
      finalPaymentDate: { type: 'string' },
      paymentStatus: { type: 'string' },
      confidentialityRequirement: { type: 'string' },
      hasSettlement: { type: 'boolean' },
      direction: { type: 'string', enum: ['income', 'expense'] },
      uploadedBy: { type: 'string' },
      keywordTags: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    additionalProperties: false,
  };
}

function buildSourceFilesSchema() {
  return z.array(z.object({
    path: z.string().min(1),
    name: z.string().optional(),
  }).strict()).min(1);
}

function buildLedgerFieldsSchema() {
  return z.record(z.string(), z.union([z.string(), z.number()]));
}

function sheetEnumValues() {
  return Object.keys(LEDGER_SHEET_TEMPLATES);
}

function createContractToolRegistry(service) {
  const contractSchema = buildContractSchema();
  const contractInputSchema = buildContractInputSchema();
  const sourceFilesSchema = buildSourceFilesSchema();
  const ledgerFieldsSchema = buildLedgerFieldsSchema();
  const sheetNames = sheetEnumValues();

  const tools = [
    {
      name: 'contract_list_directory',
      title: 'List NAS Directory',
      description: 'List the real NAS-style contract directory tree under the configured library root.',
      annotations: { readOnlyHint: true, statusText: '查看合同目录' },
      inputSchema: {
        type: 'object',
        properties: {
          relativePath: { type: 'string' },
          depth: { type: 'integer' },
          includeFiles: { type: 'boolean' },
          maxEntries: { type: 'integer' },
        },
        additionalProperties: false,
      },
      parse: z.object({
        relativePath: z.string().optional(),
        depth: z.number().int().min(0).optional(),
        includeFiles: z.boolean().optional(),
        maxEntries: z.number().int().positive().optional(),
      }),
      execute: input => service.listDirectory(input),
    },
    {
      name: 'contract_find_directories',
      title: 'Find Archive Directories',
      description: 'Find likely existing directories for a contract based on keywords or parties.',
      annotations: { readOnlyHint: true, statusText: '查找归档目录' },
      inputSchema: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' } },
          topLevelCategory: { type: 'string' },
          limit: { type: 'integer' },
        },
        additionalProperties: false,
      },
      parse: z.object({
        keyword: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        topLevelCategory: z.string().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: input => service.findDirectories(input),
    },
    {
      name: 'contract_preview_archive',
      title: 'Preview Contract Archive',
      description: 'Preview the final archive result before writing anything. Use this to show the uploader, in Chinese, which important fields will be written into the archive database, which are still empty, the target NAS directory, and the planned file names. This tool is read-only and should normally be called before contract_archive.',
      annotations: { readOnlyHint: true, statusText: '预览归档内容' },
      inputSchema: {
        type: 'object',
        properties: {
          contract: contractInputSchema,
          sourceFiles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                name: { type: 'string' },
              },
              required: ['path'],
              additionalProperties: false,
            },
          },
          archiveRelativeDir: { type: 'string' },
          sheetName: { type: 'string', enum: sheetNames },
          ledgerFields: { type: 'object' },
          uncertainFields: { type: 'array', items: { type: 'string' } },
          searchKeywords: { type: 'array', items: { type: 'string' } },
          uploaderUserId: { type: 'string' },
          sourceChannel: { type: 'string' },
          sourceMessageId: { type: 'string' },
          operator: { type: 'string' },
        },
        required: ['sourceFiles', 'archiveRelativeDir', 'operator'],
        additionalProperties: false,
      },
      parse: z.object({
        contract: contractSchema.optional(),
        sourceFiles: sourceFilesSchema,
        archiveRelativeDir: z.string().min(1),
        sheetName: z.enum(sheetNames).optional(),
        ledgerFields: ledgerFieldsSchema.optional(),
        uncertainFields: z.array(z.string()).optional(),
        searchKeywords: z.array(z.string()).optional(),
        uploaderUserId: z.string().optional(),
        sourceChannel: z.string().optional(),
        sourceMessageId: z.string().optional(),
        operator: z.string().min(1),
      }),
      execute: input => service.previewArchive(input),
    },
    {
      name: 'contract_archive',
      title: 'Archive Contract',
      description: 'Finalize a contract archive in one step. Use this only after the uploader has already seen and confirmed the extracted archive fields, target NAS directory, and file list, unless the user explicitly asks for immediate direct archiving without an extra confirmation round. It moves files into the final NAS directory and writes a structured archive record into the contract archive database.',
      annotations: { statusText: '归档合同' },
      inputSchema: {
        type: 'object',
        properties: {
          contract: contractInputSchema,
          sourceFiles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                name: { type: 'string' },
              },
              required: ['path'],
              additionalProperties: false,
            },
          },
          archiveRelativeDir: { type: 'string' },
          sheetName: { type: 'string', enum: sheetNames },
          ledgerFields: { type: 'object' },
          uncertainFields: { type: 'array', items: { type: 'string' } },
          searchKeywords: { type: 'array', items: { type: 'string' } },
          uploaderUserId: { type: 'string' },
          sourceChannel: { type: 'string' },
          sourceMessageId: { type: 'string' },
          idempotencyKey: { type: 'string' },
          operator: { type: 'string' },
        },
        required: ['sourceFiles', 'archiveRelativeDir', 'operator'],
        additionalProperties: false,
      },
      parse: z.object({
        contract: contractSchema.optional(),
        sourceFiles: sourceFilesSchema,
        archiveRelativeDir: z.string().min(1),
        sheetName: z.enum(sheetNames).optional(),
        ledgerFields: ledgerFieldsSchema.optional(),
        uncertainFields: z.array(z.string()).optional(),
        searchKeywords: z.array(z.string()).optional(),
        uploaderUserId: z.string().optional(),
        sourceChannel: z.string().optional(),
        sourceMessageId: z.string().optional(),
        idempotencyKey: z.string().optional(),
        operator: z.string().min(1),
      }),
      execute: input => service.archiveContract(input),
    },
    {
      name: 'contract_get_archive_record',
      title: 'Get Archive Record',
      description: 'Read one archived contract record from the structured archive database, including archived files and recent events.',
      annotations: { readOnlyHint: true, statusText: '查看归档记录' },
      inputSchema: {
        type: 'object',
        properties: {
          archiveId: { type: 'string' },
        },
        required: ['archiveId'],
        additionalProperties: false,
      },
      parse: z.object({
        archiveId: z.string().min(1),
      }),
      execute: input => service.getArchiveRecord(input.archiveId),
    },
    {
      name: 'contract_search_archive_records',
      title: 'Search Archive Records',
      description: 'Search the structured archive database by keyword, direction, uploader, directory, and date filters.',
      annotations: { readOnlyHint: true, statusText: '检索归档记录' },
      inputSchema: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          archiveRelativeDir: { type: 'string' },
          contractName: { type: 'string' },
          counterpartyName: { type: 'string' },
          agreementType: { type: 'string' },
          direction: { type: 'string', enum: ['income', 'expense'] },
          uploadedBy: { type: 'string' },
          ourOwner: { type: 'string' },
          paymentStatus: { type: 'string' },
          hasSettlement: { type: 'boolean' },
          signingDateFrom: { type: 'string' },
          signingDateTo: { type: 'string' },
          effectiveStartFrom: { type: 'string' },
          effectiveStartTo: { type: 'string' },
          effectiveEndFrom: { type: 'string' },
          effectiveEndTo: { type: 'string' },
          effectiveEndBefore: { type: 'string' },
          firstPaymentDateFrom: { type: 'string' },
          firstPaymentDateTo: { type: 'string' },
          finalPaymentDateFrom: { type: 'string' },
          finalPaymentDateTo: { type: 'string' },
          minAmount: {
            anyOf: [
              { type: 'number' },
              { type: 'string' },
            ],
          },
          maxAmount: {
            anyOf: [
              { type: 'number' },
              { type: 'string' },
            ],
          },
          archivedAtFrom: { type: 'string' },
          archivedAtTo: { type: 'string' },
          createdAtFrom: { type: 'string' },
          createdAtTo: { type: 'string' },
          updatedAtFrom: { type: 'string' },
          updatedAtTo: { type: 'string' },
          limit: { type: 'integer' },
        },
        additionalProperties: false,
      },
      parse: z.object({
        keyword: z.string().optional(),
        archiveRelativeDir: z.string().optional(),
        contractName: z.string().optional(),
        counterpartyName: z.string().optional(),
        agreementType: z.string().optional(),
        direction: z.enum(['income', 'expense']).optional(),
        uploadedBy: z.string().optional(),
        ourOwner: z.string().optional(),
        paymentStatus: z.string().optional(),
        hasSettlement: z.boolean().optional(),
        signingDateFrom: z.string().optional(),
        signingDateTo: z.string().optional(),
        effectiveStartFrom: z.string().optional(),
        effectiveStartTo: z.string().optional(),
        effectiveEndFrom: z.string().optional(),
        effectiveEndTo: z.string().optional(),
        effectiveEndBefore: z.string().optional(),
        firstPaymentDateFrom: z.string().optional(),
        firstPaymentDateTo: z.string().optional(),
        finalPaymentDateFrom: z.string().optional(),
        finalPaymentDateTo: z.string().optional(),
        minAmount: z.union([z.number(), z.string()]).optional(),
        maxAmount: z.union([z.number(), z.string()]).optional(),
        archivedAtFrom: z.string().optional(),
        archivedAtTo: z.string().optional(),
        createdAtFrom: z.string().optional(),
        createdAtTo: z.string().optional(),
        updatedAtFrom: z.string().optional(),
        updatedAtTo: z.string().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: input => service.searchArchiveRecords(input),
    },
    {
      name: 'contract_search',
      title: 'Search NAS Contracts',
      description: 'Search the real NAS directory tree for archived contract files by keyword and recent time window.',
      annotations: { readOnlyHint: true, statusText: '检索合同目录' },
      inputSchema: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' } },
          topLevelCategory: { type: 'string' },
          modifiedAfter: { type: 'string' },
          modifiedBefore: { type: 'string' },
          recentMonths: { type: 'integer' },
          limit: { type: 'integer' },
        },
        additionalProperties: false,
      },
      parse: z.object({
        keyword: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        topLevelCategory: z.string().optional(),
        modifiedAfter: z.string().optional(),
        modifiedBefore: z.string().optional(),
        recentMonths: z.number().int().min(0).optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: input => service.searchContracts(input),
    },
  ];

  return {
    tools,
    toolByName: new Map(tools.map(tool => [tool.name, tool])),
  };
}

module.exports = {
  createContractToolRegistry,
  LEDGER_SHEET_TEMPLATES,
};
