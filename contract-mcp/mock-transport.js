const { ContractService } = require('./nas-service');
const { createContractToolRegistry } = require('./nas-tools');

class ContractMCPMockTransport {
  constructor(config) {
    this.service = new ContractService(config);
    this.registry = createContractToolRegistry(this.service);
    this.onmessage = undefined;
    this.onclose = undefined;
    this.onerror = undefined;
  }

  async start() {
    return undefined;
  }

  async send(message) {
    if (!('method' in message) || !('id' in message)) {
      return;
    }

    if (message.method === 'initialize') {
      this.onmessage?.({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-06-18',
          serverInfo: {
            name: 'contract-manager-mock',
            version: '1.0.0',
          },
          capabilities: {
            tools: {},
          },
          instructions: 'Mock MCP transport for contract management tests.',
        },
      });
      return;
    }

    if (message.method === 'tools/list') {
      this.onmessage?.({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: this.registry.tools.map(tool => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            ...(tool.annotations ? { annotations: tool.annotations } : {}),
          })),
        },
      });
      return;
    }

    if (message.method === 'tools/call') {
      const tool = this.registry.toolByName.get(message.params?.name);

      if (!tool) {
        this.onmessage?.({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32601,
            message: `Unknown tool: ${message.params?.name || 'unknown'}`,
          },
        });
        return;
      }

      try {
        const input = tool.parse.parse(message.params?.arguments || {});
        const result = await tool.execute(input);
        this.onmessage?.({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
            structuredContent: result,
          },
        });
      } catch (error) {
        this.onmessage?.({
          jsonrpc: '2.0',
          id: message.id,
          result: {
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
          },
        });
      }
    }
  }

  async close() {
    this.service.close();
    this.onclose?.();
  }
}

module.exports = {
  ContractMCPMockTransport,
};
