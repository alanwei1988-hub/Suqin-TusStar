const { createMCPClient } = require('@ai-sdk/mcp');
const { Experimental_StdioMCPTransport } = require('@ai-sdk/mcp/mcp-stdio');
const { createToolDisplayInfo } = require('./display');

const DEFAULT_MCP_INIT_TIMEOUT_MS = 8000;
const DEFAULT_MCP_TOOL_TIMEOUT_MS = 30000;

function extractMcpErrorMessage(result) {
  const structuredError = result?.structuredContent?.error;

  if (typeof structuredError === 'string' && structuredError.trim().length > 0) {
    return structuredError.trim();
  }

  if (Array.isArray(result?.content)) {
    const text = result.content
      .filter(part => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text.trim())
      .filter(Boolean)
      .join(' ');

    if (text.length > 0) {
      return text;
    }
  }

  return 'MCP tool returned an error.';
}

function wrapMcpTool(toolName, toolDefinition, timeoutMs = DEFAULT_MCP_TOOL_TIMEOUT_MS) {
  if (!toolDefinition || typeof toolDefinition.execute !== 'function') {
    return toolDefinition;
  }

  return {
    ...toolDefinition,
    execute: async (args, options) => {
      const result = await withTimeout(
        toolDefinition.execute(args, options),
        timeoutMs,
        `MCP tool ${toolName}`,
      );

      if (result?.isError === true) {
        throw new Error(`${toolName}: ${extractMcpErrorMessage(result)}`);
      }

      return result;
    },
  };
}

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

function pickMcpDisplayName(toolDefinition) {
  const explicitName = toolDefinition.annotations?.title
    || toolDefinition._meta?.title
    || toolDefinition._meta?.displayName;

  if (typeof explicitName === 'string' && explicitName.trim().length > 0) {
    return explicitName.trim();
  }

  return '';
}

function pickMcpStatusText(toolName, toolDefinition) {
  const explicitStatus = toolDefinition.annotations?.statusText
    || toolDefinition._meta?.statusText
    || toolDefinition._meta?.progressText;

  if (typeof explicitStatus === 'string' && explicitStatus.trim().length > 0) {
    return explicitStatus.trim();
  }

  return undefined;
}

async function createMcpToolkit(servers = [], options = {}) {
  const enabledServers = servers.filter(server => server && server.enabled !== false);
  const clients = [];
  const mergedTools = {};
  const toolSchemasByName = {};
  const toolDisplayByName = {};
  const readOnlyToolNames = [];
  const summaries = [];
  const defaultToolTimeoutMs = Number.isFinite(options.defaultToolTimeoutMs)
    ? Math.max(1, Math.trunc(options.defaultToolTimeoutMs))
    : DEFAULT_MCP_TOOL_TIMEOUT_MS;

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

          const toolTimeoutMs = Number.isFinite(server.toolTimeoutMs)
            ? Math.max(1, Math.trunc(server.toolTimeoutMs))
            : defaultToolTimeoutMs;
          mergedTools[mergedName] = wrapMcpTool(mergedName, tools[tool.name], toolTimeoutMs);
          toolSchemasByName[mergedName] = tool.inputSchema || null;
          toolNames.push(mergedName);
          toolDisplayByName[mergedName] = createToolDisplayInfo(mergedName, {
            displayName: pickMcpDisplayName(tool) || undefined,
            statusText: pickMcpStatusText(mergedName, tool),
          });

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
      toolSchemasByName,
      toolDisplayByName,
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
