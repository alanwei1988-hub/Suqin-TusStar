const { createMCPClient } = require('@ai-sdk/mcp');
const { Experimental_StdioMCPTransport } = require('@ai-sdk/mcp/mcp-stdio');

const DEFAULT_MCP_INIT_TIMEOUT_MS = 8000;

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

  if (type === 'mock') {
    if (!server.mockTransport) {
      throw new Error(`MCP server "${server.name || 'unnamed'}" is missing a mockTransport`);
    }

    return server.mockTransport;
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

function describeServer(server) {
  return server.name || server.url || server.command || 'unnamed';
}

function withTimeout(promise, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
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
  const readOnlyToolNames = [];
  const summaries = [];

  try {
    for (const server of enabledServers) {
      assertServerConfig(server);
      const serverLabel = describeServer(server);
      const timeoutMs = server.initTimeoutMs || DEFAULT_MCP_INIT_TIMEOUT_MS;
      const failOpen = server.failOpen !== false;
      let client;

      try {
        console.log(`[MCP] Initializing ${serverLabel} via ${server.transport || server.type}...`);

        client = await withTimeout(
          createMCPClient({
            name: server.clientName || 'wxwork-bot',
            version: server.clientVersion || '1.0.0',
            transport: buildTransport(server),
            onUncaughtError: error => {
              console.error(`[MCP:${serverLabel}]`, error);
            },
          }),
          timeoutMs,
          `MCP server ${serverLabel} initialization`,
        );

        clients.push(client);

        const definitions = await withTimeout(
          client.listTools(),
          timeoutMs,
          `MCP server ${serverLabel} tool discovery`,
        );
        const tools = client.toolsFromDefinitions(definitions);
        const prefix = server.toolPrefix ? `${server.toolPrefix}_` : '';
        const toolNames = [];

        for (const tool of definitions.tools) {
          const mergedName = `${prefix}${tool.name}`;

          if (mergedTools[mergedName]) {
            throw new Error(`Duplicate MCP tool name detected: ${mergedName}`);
          }

          mergedTools[mergedName] = tools[tool.name];
          toolNames.push(mergedName);

          if (tool.annotations?.readOnlyHint === true || tool._meta?.readOnlyHint === true) {
            readOnlyToolNames.push(mergedName);
          }
        }

        summaries.push({
          name: serverLabel,
          transport: server.transport || server.type,
          toolNames,
        });

        console.log(`[MCP] ${serverLabel} ready with ${toolNames.length} tool(s).`);
      } catch (error) {
        if (client) {
          await Promise.allSettled([client.close()]);
        }

        if (failOpen) {
          console.error(`[MCP] ${serverLabel} disabled for this run: ${error.message}`);
          continue;
        }

        throw error;
      }
    }

    return {
      tools: mergedTools,
      readOnlyToolNames,
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
