const { z } = require('zod');
const { LEDGER_SHEET_TEMPLATES, VALID_PENDING_STATUSES } = require('./nas-service');

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
      name: 'contract_prepare_archive',
      title: 'Prepare Contract Archive',
      description: 'Create a pending archive plan without moving files yet. Use this only after you have already identified the contract fields, chosen the target archive directory, and decided the ledger sheet or direction. The contract object must use the canonical keys defined in this schema, such as contractName, partyAName, partyBName, otherPartyName, signingDate, effectiveStartDate, contractAmount, direction, and uploadedBy.',
      annotations: { statusText: '准备合同归档' },
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
        operator: z.string().min(1),
      }),
      execute: input => service.prepareArchive(input),
    },
    {
      name: 'contract_get_pending',
      title: 'Get Pending Archive',
      description: 'Read a pending archive record, including the uploader confirmation text and admin ledger reminder.',
      annotations: { readOnlyHint: true, statusText: '查看归档待办' },
      inputSchema: {
        type: 'object',
        properties: {
          pendingId: { type: 'string' },
        },
        required: ['pendingId'],
        additionalProperties: false,
      },
      parse: z.object({
        pendingId: z.string().min(1),
      }),
      execute: input => service.getPending(input.pendingId),
    },
    {
      name: 'contract_update_pending',
      title: 'Update Pending Archive',
      description: 'Update a pending archive plan after the uploader provides corrections.',
      annotations: { statusText: '更新归档待办' },
      inputSchema: {
        type: 'object',
        properties: {
          pendingId: { type: 'string' },
          contract: contractInputSchema,
          archiveRelativeDir: { type: 'string' },
          sheetName: { type: 'string', enum: sheetNames },
          ledgerFields: { type: 'object' },
          uncertainFields: { type: 'array', items: { type: 'string' } },
          operator: { type: 'string' },
        },
        required: ['pendingId', 'operator'],
        additionalProperties: false,
      },
      parse: z.object({
        pendingId: z.string().min(1),
        contract: contractSchema.partial().optional(),
        archiveRelativeDir: z.string().optional(),
        sheetName: z.enum(sheetNames).optional(),
        ledgerFields: ledgerFieldsSchema.optional(),
        uncertainFields: z.array(z.string()).optional(),
        operator: z.string().min(1),
      }),
      execute: input => service.updatePending(input),
    },
    {
      name: 'contract_confirm_archive',
      title: 'Confirm Contract Archive',
      description: 'After the uploader confirms, move the files into the final NAS directory and produce the admin ledger reminder.',
      annotations: { statusText: '正式归档合同' },
      inputSchema: {
        type: 'object',
        properties: {
          pendingId: { type: 'string' },
          operator: { type: 'string' },
          force: { type: 'boolean' },
        },
        required: ['pendingId', 'operator'],
        additionalProperties: false,
      },
      parse: z.object({
        pendingId: z.string().min(1),
        operator: z.string().min(1),
        force: z.boolean().optional(),
      }),
      execute: input => service.confirmArchive(input),
    },
    {
      name: 'contract_reject_pending',
      title: 'Reject Pending Archive',
      description: 'Reject a pending archive request and record the reason.',
      annotations: { statusText: '驳回归档待办' },
      inputSchema: {
        type: 'object',
        properties: {
          pendingId: { type: 'string' },
          operator: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['pendingId', 'operator'],
        additionalProperties: false,
      },
      parse: z.object({
        pendingId: z.string().min(1),
        operator: z.string().min(1),
        reason: z.string().optional(),
      }),
      execute: input => service.rejectPending(input),
    },
    {
      name: 'contract_complete_ledger',
      title: 'Complete Ledger Reminder',
      description: 'Mark the pending archive as completed after the contract admin records the Excel ledger entry.',
      annotations: { statusText: '完成台账待办' },
      inputSchema: {
        type: 'object',
        properties: {
          pendingId: { type: 'string' },
          operator: { type: 'string' },
          note: { type: 'string' },
          force: { type: 'boolean' },
        },
        required: ['pendingId', 'operator'],
        additionalProperties: false,
      },
      parse: z.object({
        pendingId: z.string().min(1),
        operator: z.string().min(1),
        note: z.string().optional(),
        force: z.boolean().optional(),
      }),
      execute: input => service.completeLedger(input),
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
  VALID_PENDING_STATUSES,
};
