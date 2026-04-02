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

function decodeHtmlEntities(text = '') {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/g, '/')
    .replace(/&#x3D;/g, '=')
    .replace(/&#x26;/g, '&');
}

function stripHtmlTags(text = '') {
  return decodeHtmlEntities(String(text || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeResults(results = [], maxResults = DEFAULT_MAX_RESULTS) {
  const seen = new Set();
  const deduped = [];

  for (const item of results) {
    const url = String(item?.url || '').trim();
    const title = String(item?.title || '').trim();
    const key = url || title;

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push({
      title: title || '搜索结果',
      url,
      snippet: String(item?.snippet || '').trim(),
      source: String(item?.source || 'web'),
    });

    if (deduped.length >= maxResults) {
      break;
    }
  }

  return deduped;
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

async function fetchText(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
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

function normalizeDuckDuckGoResultUrl(rawUrl = '') {
  const value = String(rawUrl || '').trim();

  if (!value) {
    return '';
  }

  if (value.startsWith('/l/?')) {
    const match = value.match(/[?&]uddg=([^&]+)/i);
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
  }

  return decodeHtmlEntities(value);
}

async function searchWithDuckDuckGoHtml(query, { maxResults = DEFAULT_MAX_RESULTS, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url, {
    method: 'GET',
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  }, timeoutMs);
  const results = [];
  const blockRegex = /<div[^>]*class="[^"]*\bresult\b[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi;
  const blocks = html.match(blockRegex) || [];

  for (const block of blocks) {
    const linkMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) {
      continue;
    }

    const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const resultUrl = normalizeDuckDuckGoResultUrl(linkMatch[1]);
    const title = stripHtmlTags(linkMatch[2]);
    const snippet = stripHtmlTags(snippetMatch ? snippetMatch[1] : '');

    if (!resultUrl || !title) {
      continue;
    }

    results.push({
      title,
      url: resultUrl,
      snippet,
      source: 'duckduckgo-html',
    });
  }

  return dedupeResults(results, clampMaxResults(maxResults));
}

async function searchWithDuckDuckGoInstant(query, { maxResults = DEFAULT_MAX_RESULTS, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const payload = await fetchJson(url, {}, timeoutMs);
  const results = [];

  if (payload.AbstractText && payload.AbstractURL) {
    results.push({
      title: payload.Heading || 'DuckDuckGo 摘要',
      url: payload.AbstractURL,
      snippet: payload.AbstractText,
      source: 'duckduckgo-instant',
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
      source: 'duckduckgo-instant',
    });
  }

  return dedupeResults(results, clampMaxResults(maxResults));
}

async function searchWithBingRss(query, { maxResults = DEFAULT_MAX_RESULTS, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
  const xml = await fetchText(url, {
    method: 'GET',
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
    },
  }, timeoutMs);
  const results = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1] || '';
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
    const descMatch = block.match(/<description>([\s\S]*?)<\/description>/i);
    const title = stripHtmlTags(titleMatch ? titleMatch[1] : '');
    const resultUrl = decodeHtmlEntities(linkMatch ? linkMatch[1] : '').trim();
    const snippet = stripHtmlTags(descMatch ? descMatch[1] : '');

    if (!title || !resultUrl) {
      continue;
    }

    results.push({
      title,
      url: resultUrl,
      snippet,
      source: 'bing-rss',
    });
  }

  return dedupeResults(results, clampMaxResults(maxResults));
}

async function searchWithDuckDuckGo(query, { maxResults = DEFAULT_MAX_RESULTS, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const targetCount = clampMaxResults(maxResults);
  const aggregated = [];
  const warnings = [];

  try {
    const htmlResults = await searchWithDuckDuckGoHtml(query, { maxResults: targetCount, timeoutMs });
    aggregated.push(...htmlResults);
  } catch (error) {
    warnings.push(`duckduckgo-html: ${error.message}`);
  }

  if (aggregated.length < targetCount) {
    try {
      const instantResults = await searchWithDuckDuckGoInstant(query, {
        maxResults: targetCount,
        timeoutMs,
      });
      aggregated.push(...instantResults);
    } catch (error) {
      warnings.push(`duckduckgo-instant: ${error.message}`);
    }
  }

  return {
    results: dedupeResults(aggregated, targetCount),
    warnings,
  };
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
  return dedupeResults(rows.map(item => ({
    title: item?.title || 'Tavily 结果',
    url: item?.url || '',
    snippet: item?.content || '',
    source: 'tavily',
  })).filter(item => item.url), clampMaxResults(maxResults));
}

function buildWebSearchPrompt(config = {}) {
  if (config.enabled === false) {
    return '';
  }

  return [
    'External Information Search',
    '- You can use `webSearch` to retrieve public external information when the user asks for web/company/news/trend details.',
    '- For anything time-sensitive or potentially outdated, run `webSearch` before answering.',
    '- If the first search has no useful result, automatically retry with 2-3 query variants (company full name, short name, keyword combinations).',
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
      'Uses multiple fallback sources to improve recall for Chinese company queries.',
    ].join(' '),
    inputSchema: z.object({
      query: z.string().min(2).describe('Search query'),
      maxResults: z.number().int().min(1).max(MAX_RESULTS_LIMIT).optional().describe('Number of results to return'),
    }),
    execute: async ({ query, maxResults }) => {
      const requestedCount = clampMaxResults(maxResults, normalized.maxResults);

      let providerUsed = normalized.provider;
      let results = [];
      const warnings = [];

      if (providerUsed === 'tavily') {
        try {
          results = await searchWithTavily(query, {
            apiKey: normalized.tavilyApiKey,
            maxResults: requestedCount,
            timeoutMs: normalized.timeoutMs,
          });
        } catch (error) {
          providerUsed = 'duckduckgo';
          const fallback = await searchWithDuckDuckGo(query, {
            maxResults: requestedCount,
            timeoutMs: normalized.timeoutMs,
          });
          results = fallback.results;
          warnings.push(`Tavily failed and fallback was used: ${error.message}`);
          warnings.push(...(fallback.warnings || []));
        }
      } else {
        const primary = await searchWithDuckDuckGo(query, {
          maxResults: requestedCount,
          timeoutMs: normalized.timeoutMs,
        });
        results = primary.results;
        warnings.push(...(primary.warnings || []));

        if (results.length < requestedCount) {
          try {
            const bingResults = await searchWithBingRss(query, {
              maxResults: requestedCount,
              timeoutMs: normalized.timeoutMs,
            });
            results = dedupeResults([...results, ...bingResults], requestedCount);
          } catch (error) {
            warnings.push(`bing-rss: ${error.message}`);
          }
        }
      }

      const finalResults = dedupeResults(results, requestedCount);

      return {
        query,
        providerUsed,
        results: finalResults,
        ...(warnings.length > 0 ? { warnings } : {}),
        resultCount: finalResults.length,
        searchedAt: new Date().toISOString(),
      };
    },
  });
}

module.exports = {
  buildWebSearchPrompt,
  createWebSearchTool,
};
