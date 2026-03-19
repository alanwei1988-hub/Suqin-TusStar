#!/usr/bin/env node
const { loadContractMcpConfig } = require('./config');
const { ContractService } = require('./service');
const { createContractToolRegistry } = require('./tools');

const PROTOCOL_VERSION = '2025-06-18';
const service = new ContractService(loadContractMcpConfig());
const registry = createContractToolRegistry(service);

function resultText(value) {
  return JSON.stringify(value, null, 2);
}

function successResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: resultText(payload),
      },
    ],
    structuredContent: payload,
  };
}

function toolErrorResult(error) {
  return {
    content: [
      {
        type: 'text',
        text: error.message,
      },
    ],
    structuredContent: {
      error: error.message,
    },
    isError: true,
  };
}

const toolDefinitions = registry.tools;
const toolByName = registry.toolByName;

function sendMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResponse(id, result) {
  sendMessage({
    jsonrpc: '2.0',
    id,
    result,
  });
}

function sendError(id, code, message) {
  sendMessage({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  });
}

async function handleToolCall(id, params) {
  const tool = toolByName.get(params?.name);

  if (!tool) {
    sendError(id, -32601, `Unknown tool: ${params?.name || 'unknown'}`);
    return;
  }

  try {
    const input = tool.parse.parse(params?.arguments || {});
    const result = await tool.execute(input);
    sendResponse(id, successResult(result));
  } catch (error) {
    sendResponse(id, toolErrorResult(error));
  }
}

async function handleMessage(message) {
  if (message.method === 'notifications/initialized') {
    return;
  }

  if (typeof message.id === 'undefined') {
    return;
  }

  try {
    switch (message.method) {
      case 'initialize':
        sendResponse(message.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'contract-manager-mcp',
            version: '1.0.0',
          },
          instructions: 'Use these tools to archive, update, and query contracts without bypassing the database or contract repository.',
        });
        break;
      case 'tools/list':
        sendResponse(message.id, {
          tools: toolDefinitions.map(tool => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            ...(tool.annotations ? { annotations: tool.annotations } : {}),
          })),
        });
        break;
      case 'tools/call':
        await handleToolCall(message.id, message.params || {});
        break;
      default:
        sendError(message.id, -32601, `Method not found: ${message.method}`);
        break;
    }
  } catch (error) {
    sendError(message.id, -32603, error.message);
  }
}

let queue = Promise.resolve();

let lineBuffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  lineBuffer += chunk;

  while (true) {
    const newlineIndex = lineBuffer.indexOf('\n');
    if (newlineIndex === -1) {
      return;
    }

    const line = lineBuffer.slice(0, newlineIndex).trim();
    lineBuffer = lineBuffer.slice(newlineIndex + 1);

    if (!line) {
      continue;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      process.stderr.write(`[contract-mcp] Invalid JSON message: ${error.message}\n`);
      continue;
    }

    queue = queue
      .then(() => handleMessage(message))
      .catch(error => {
        process.stderr.write(`[contract-mcp] ${error.stack || error.message}\n`);
      });
  }
});

process.on('SIGINT', () => {
  service.close();
  process.exit(0);
});

process.on('exit', () => {
  try {
    service.close();
  } catch {
    // Ignore shutdown errors.
  }
});
