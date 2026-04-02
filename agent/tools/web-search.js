const { tool } = require('ai');
const { z } = require('zod');

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_LIMIT = 10;

function clampMaxResults(value, fallback = DEFAULT_MAX_RESULTS) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(MAX_RESULTS_LIMIT, Math.trunc(value)));
}

async function fetchJson(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function flattenDuckDuckGoTopics(topics = []) {
  const flat = [];

  for (const item of topics) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    if (Array.isArray(item.Topics)) {
      flat.push(...flattenDuckDuckGoTopics(item.Topics));
      continue;
    }

    flat.push(item);
  }

  return flat;
}

async function searchWithDuckDuckGo(query, { maxResults = DEFAULT_MAX_RESULTS, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const payload = await fetchJson(url, {}, timeoutMs);
  const results = [];

  if (payload.AbstractText && payload.AbstractURL) {
    results.push({
      title: payload.Heading || 'DuckDuckGo 摘要',
      url: payload.AbstractURL,
      snippet: payload.AbstractText,
      source: 'duckduckgo',
    });
  }

  const related = flattenDuckDuckGoTopics(payload.RelatedTopics || []);
  for (const item of related) {
    if (!item?.Text || !item?.FirstURL) {
      continue;
    }

    results.push({
      title: item.Text.split(' - ')[0].trim() || 'DuckDuckGo 结果',
      url: item.FirstURL,
      snippet: item.Text,
      source: 'duckduckgo',
    });
  }

  return results.slice(0, clampMaxResults(maxResults));
}

async function searchWithTavily(query, {
  apiKey,
  maxResults = DEFAULT_MAX_RESULTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!apiKey) {
    throw new Error('Tavily API key is missing. Set TAVILY_API_KEY.');
  }

  const payload = await fetchJson(
    'https://api.tavily.com/search',
    {
      method: 'POST',
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: clampMaxResults(maxResults),
        search_depth: 'advanced',
        include_answer: false,
        include_raw_content: false,
      }),
    },
    timeoutMs,
  );

  const rows = Array.isArray(payload.results) ? payload.results : [];
  return rows.map(item => ({
    title: item?.title || 'Tavily 结果',
    url: item?.url || '',
    snippet: item?.content || '',
    source: 'tavily',
  })).filter(item => item.url);
}

function buildWebSearchPrompt(config = {}) {
  if (config.enabled === false) {
    return '';
  }

  return [
    'External Information Search',
    '- You can use `webSearch` to retrieve public external information when the user asks for web/company/news/trend details.',
    '- For anything time-sensitive or potentially outdated, run `webSearch` before answering.',
    '- In your final reply, include source links for externally retrieved facts.',
  ].join('\n');
}

function createWebSearchTool(config = {}) {
  const normalized = {
    enabled: config.enabled !== false,
    provider: typeof config.provider === 'string' ? config.provider.trim().toLowerCase() : 'duckduckgo',
    timeoutMs: Number.isFinite(config.timeoutMs) ? Math.max(1000, Math.trunc(config.timeoutMs)) : DEFAULT_TIMEOUT_MS,
    maxResults: clampMaxResults(config.maxResults),
    tavilyApiKey: typeof config.tavilyApiKey === 'string' ? config.tavilyApiKey.trim() : '',
  };

  if (!normalized.enabled) {
    return null;
  }

  return tool({
    description: [
      'Search public web information for external facts such as company background, recent news, and industry updates.',
      'Use this for questions that depend on current external information.',
    ].join(' '),
    inputSchema: z.object({
      query: z.string().min(2).describe('Search query'),
      maxResults: z.number().int().min(1).max(MAX_RESULTS_LIMIT).optional().describe('Number of results to return'),
    }),
    execute: async ({ query, maxResults }) => {
      const requestedCount = clampMaxResults(maxResults, normalized.maxResults);

      let providerUsed = normalized.provider;
      let results = [];

      if (providerUsed === 'tavily') {
        try {
          results = await searchWithTavily(query, {
            apiKey: normalized.tavilyApiKey,
            maxResults: requestedCount,
            timeoutMs: normalized.timeoutMs,
          });
        } catch (error) {
          providerUsed = 'duckduckgo';
          results = await searchWithDuckDuckGo(query, {
            maxResults: requestedCount,
            timeoutMs: normalized.timeoutMs,
          });

          return {
            query,
            providerUsed,
            warning: `Tavily search failed and fallback was used: ${error.message}`,
            results,
            searchedAt: new Date().toISOString(),
          };
        }
      } else {
        results = await searchWithDuckDuckGo(query, {
          maxResults: requestedCount,
          timeoutMs: normalized.timeoutMs,
        });
      }

      return {
        query,
        providerUsed,
        results,
        searchedAt: new Date().toISOString(),
      };
    },
  });
}

module.exports = {
  buildWebSearchPrompt,
  createWebSearchTool,
};
