const { createMCPClient } = require('@ai-sdk/mcp');
const { Experimental_StdioMCPTransport } = require('@ai-sdk/mcp/mcp-stdio');

function buildTransport(server) {
  const type = server.transport || server.type;

  if (type === 'stdio') {
    return new Experimental_StdioMCPTransport({
      command: server.command,
      args: server.args,
      env: server.env,
      cwd: server.cwd,
    });
  }

  if (type === 'http' || type === 'sse') {
    return {
      type,
      url: server.url,
      headers: server.headers,
      redirect: server.redirect,
    };
  }

  throw new Error(`Unsupported MCP transport type: ${type}`);
}

function assertServerConfig(server) {
  const type = server.transport || server.type;

  if (!type) {
    throw new Error(`MCP server "${server.name || 'unnamed'}" is missing a transport type`);
  }

  if (type === 'stdio' && !server.command) {
    throw new Error(`MCP server "${server.name || 'unnamed'}" is missing a command`);
  }

  if ((type === 'http' || type === 'sse') && !server.url) {
    throw new Error(`MCP server "${server.name || 'unnamed'}" is missing a url`);
  }
}

async function createMcpToolkit(servers = []) {
  const enabledServers = servers.filter(server => server && server.enabled !== false);
  const clients = [];
  const mergedTools = {};
  const summaries = [];

  try {
    for (const server of enabledServers) {
      assertServerConfig(server);

      const client = await createMCPClient({
        name: server.clientName || 'wxwork-bot',
        version: server.clientVersion || '1.0.0',
        transport: buildTransport(server),
        onUncaughtError: error => {
          console.error(`[MCP:${server.name || server.url || server.command}]`, error);
        },
      });

      clients.push(client);

      const tools = await client.tools();
      const toolNames = Object.keys(tools);

      for (const toolName of toolNames) {
        if (mergedTools[toolName]) {
          throw new Error(`Duplicate MCP tool name detected: ${toolName}`);
        }

        mergedTools[toolName] = tools[toolName];
      }

      summaries.push({
        name: server.name || server.url || server.command,
        transport: server.transport || server.type,
        toolNames,
      });
    }

    return {
      tools: mergedTools,
      summaries,
      close: async () => {
        await Promise.allSettled(clients.map(client => client.close()));
      },
    };
  } catch (error) {
    await Promise.allSettled(clients.map(client => client.close()));
    throw error;
  }
}

function buildMcpPrompt(summaries) {
  if (!summaries || summaries.length === 0) {
    return 'No MCP servers are configured for this run.';
  }

  const lines = summaries.map(summary => {
    const toolList = summary.toolNames.length > 0
      ? summary.toolNames.join(', ')
      : 'no tools discovered';

    return `- ${summary.name} (${summary.transport}): ${toolList}`;
  });

  return [
    'MCP',
    'Use MCP tools when they are a better fit than local workspace tools.',
    ...lines,
  ].join('\n');
}

module.exports = {
  buildMcpPrompt,
  createMcpToolkit,
};
