module.exports = require('./nas-tools');
/*
const { z } = require('zod');
const {
  VALID_FILE_ROLES,
  VALID_STATUSES,
  contractPayloadSchema,
  fileInputSchema,
  updatePatchSchema,
} = require('./service');

function createContractToolRegistry(service) {
  const contractSchema = {
    type: 'object',
    properties: {
      contractName: { type: 'string' },
      partyAName: { type: 'string' },
      partyBName: { type: 'string' },
      signingDate: { type: 'string' },
      effectiveStartDate: { type: 'string' },
      effectiveEndDate: { type: 'string' },
      contractAmount: { type: 'number' },
      currency: { type: 'string' },
      summary: { type: 'string' },
      uploadedBy: { type: 'string' },
      sourceChannel: { type: 'string' },
      sourceMessageId: { type: 'string' },
      remarks: { type: 'string' },
      status: { type: 'string', enum: VALID_STATUSES },
    },
  };

  const filesSchema = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        role: { type: 'string', enum: VALID_FILE_ROLES },
      },
      required: ['path', 'role'],
      additionalProperties: false,
    },
  };

  const tools = [
    {
      name: 'contract_validate',
      title: 'Validate Contract Payload',
      description: 'Validate whether a new contract payload is complete enough to archive.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          contract: contractSchema,
          files: filesSchema,
        },
        additionalProperties: false,
      },
      parse: z.object({
        contract: contractPayloadSchema.optional(),
        files: z.array(fileInputSchema).optional(),
      }),
      execute: input => service.validateContractPayload({
        contract: input.contract,
        files: input.files || [],
      }),
    },
    {
      name: 'contract_create',
      title: 'Create Contract',
      description: 'Create a contract record and import the supplied files into the contract repository.',
      inputSchema: {
        type: 'object',
        properties: {
          contract: contractSchema,
          files: filesSchema,
          operator: { type: 'string' },
          idempotencyKey: { type: 'string' },
        },
        required: ['contract', 'files', 'operator'],
        additionalProperties: false,
      },
      parse: z.object({
        contract: contractPayloadSchema,
        files: z.array(fileInputSchema).min(1),
        operator: z.string().min(1),
        idempotencyKey: z.string().optional(),
      }),
      execute: input => service.createContract(input),
    },
    {
      name: 'contract_update',
      title: 'Update Contract',
      description: 'Update contract metadata without changing the archived files.',
      inputSchema: {
        type: 'object',
        properties: {
          contractId: { type: 'string' },
          patch: {
            type: 'object',
            properties: {
              contractName: { type: 'string' },
              partyAName: { type: 'string' },
              partyBName: { type: 'string' },
              signingDate: { type: 'string' },
              effectiveStartDate: { type: 'string' },
              effectiveEndDate: { type: 'string' },
              contractAmount: { type: 'number' },
              currency: { type: 'string' },
              summary: { type: 'string' },
              remarks: { type: 'string' },
              status: { type: 'string', enum: VALID_STATUSES },
            },
          },
          operator: { type: 'string' },
          changeReason: { type: 'string' },
        },
        required: ['contractId', 'patch', 'operator'],
        additionalProperties: false,
      },
      parse: z.object({
        contractId: z.string().min(1),
        patch: updatePatchSchema,
        operator: z.string().min(1),
        changeReason: z.string().optional(),
      }),
      execute: input => service.updateContract(input),
    },
    {
      name: 'contract_attach_files',
      title: 'Attach Contract Files',
      description: 'Attach additional files to an existing contract record.',
      inputSchema: {
        type: 'object',
        properties: {
          contractId: { type: 'string' },
          files: filesSchema,
          operator: { type: 'string' },
        },
        required: ['contractId', 'files', 'operator'],
        additionalProperties: false,
      },
      parse: z.object({
        contractId: z.string().min(1),
        files: z.array(fileInputSchema).min(1),
        operator: z.string().min(1),
      }),
      execute: input => service.attachFiles(input),
    },
    {
      name: 'contract_search',
      title: 'Search Contracts',
      description: 'Search contracts by keyword, party names, dates, amount, and status.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          partyAName: { type: 'string' },
          partyBName: { type: 'string' },
          statuses: {
            type: 'array',
            items: { type: 'string', enum: VALID_STATUSES },
          },
          effectiveEndBefore: { type: 'string' },
          effectiveStartAfter: { type: 'string' },
          signingDateFrom: { type: 'string' },
          signingDateTo: { type: 'string' },
          minAmount: { type: 'number' },
          maxAmount: { type: 'number' },
          limit: { type: 'integer' },
        },
        additionalProperties: false,
      },
      parse: z.object({
        keyword: z.string().optional(),
        partyAName: z.string().optional(),
        partyBName: z.string().optional(),
        statuses: z.array(z.enum(VALID_STATUSES)).optional(),
        effectiveEndBefore: z.string().optional(),
        effectiveStartAfter: z.string().optional(),
        signingDateFrom: z.string().optional(),
        signingDateTo: z.string().optional(),
        minAmount: z.number().optional(),
        maxAmount: z.number().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: input => service.searchContracts(input),
    },
    {
      name: 'contract_get',
      title: 'Get Contract Detail',
      description: 'Get the full detail of one archived contract, including files and recent events.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          contractId: { type: 'string' },
        },
        required: ['contractId'],
        additionalProperties: false,
      },
      parse: z.object({
        contractId: z.string().min(1),
      }),
      execute: input => service.getContract(input.contractId),
    },
    {
      name: 'contract_list_expiring',
      title: 'List Expiring Contracts',
      description: 'List contracts that are expiring within a given number of days.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          withinDays: { type: 'integer' },
          statuses: {
            type: 'array',
            items: { type: 'string', enum: VALID_STATUSES },
          },
        },
        additionalProperties: false,
      },
      parse: z.object({
        withinDays: z.number().int().positive().optional(),
        statuses: z.array(z.enum(VALID_STATUSES)).optional(),
      }),
      execute: input => service.listExpiringContracts(input),
    },
    {
      name: 'contract_archive',
      title: 'Archive Contract',
      description: 'Mark a contract as archived without deleting its files or audit trail.',
      inputSchema: {
        type: 'object',
        properties: {
          contractId: { type: 'string' },
          operator: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['contractId', 'operator'],
        additionalProperties: false,
      },
      parse: z.object({
        contractId: z.string().min(1),
        operator: z.string().min(1),
        reason: z.string().optional(),
      }),
      execute: input => service.archiveContract(input),
    },
  ];

  return {
    tools,
    toolByName: new Map(tools.map(tool => [tool.name, tool])),
  };
}

module.exports = {
  createContractToolRegistry,
};
*/
