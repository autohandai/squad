// Built-in "Web research" connector: a dependency-free stdio MCP server that
// exposes `web_search` (Firecrawl v2 search) and `web_fetch` (Firecrawl v2
// scrape to markdown). Every result carries its source URL so a reply can
// cite it. The Firecrawl key arrives through the environment from the
// bridge; it is never printed and never reaches the browser (ADR-0107).
//
// Framing: newline-delimited JSON-RPC per the MCP spec, and Content-Length
// headers for clients that open with them (the pinned Autohand CLI does).
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFrameReader, encodeMessage, negotiateProtocol } from './framing.mjs';

export const FETCH_LIMIT = 12000;
const SEARCH_LIMIT = 10;
const DEFAULT_BASE_URL = 'https://api.firecrawl.dev';
const SERVER_INFO = { name: 'squad-web-research', version: '1' };

export const TOOLS = [
  {
    name: 'web_search',
    description: 'Search the web. Returns titles, URLs and snippets ranked by relevance. Follow up with web_fetch to read a result in full. Cite the URLs you rely on.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What to search for.' }, limit: { type: 'integer', minimum: 1, maximum: SEARCH_LIMIT, description: 'How many results (default 5).' } }, required: ['query'] },
  },
  {
    name: 'web_fetch',
    description: `Read one web page as clean markdown (main content only, at most ${FETCH_LIMIT} characters). The response starts with the source URL; cite it.`,
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'The http(s) address to read.' } }, required: ['url'] },
  },
];

const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max)}\n… ${text.length - max} more characters not shown`);

export function createWebResearch({ apiKey = process.env.FIRECRAWL_API_KEY || '', baseUrl = process.env.FIRECRAWL_API_URL || DEFAULT_BASE_URL, fetchRequest = fetch, timeoutMs = 60000 } = {}) {
  const base = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  async function firecrawl(path, body) {
    if (!apiKey) throw new Error('Web research needs a Firecrawl API key. Add one in Settings → Connectors → Web research.');
    const response = await fetchRequest(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json || json.success === false) throw new Error(String(json?.error || `Firecrawl answered ${response.status}`).slice(0, 300));
    return json.data ?? json;
  }
  async function search({ query, limit }) {
    const text = String(query || '').trim();
    if (!text) throw new Error('web_search needs a query.');
    const count = Math.min(SEARCH_LIMIT, Math.max(1, Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 5));
    const data = await firecrawl('/v2/search', { query: text, limit: count });
    const results = (Array.isArray(data?.web) ? data.web : Array.isArray(data) ? data : [])
      .filter((item) => item && typeof item.url === 'string')
      .slice(0, count)
      .map((item) => ({ title: String(item.title || item.url), url: item.url, snippet: clip(String(item.description || '').replace(/\s+/g, ' ').trim(), 400) }));
    const lines = results.length
      ? results.map((item, index) => `${index + 1}. ${item.title}\n   Source: ${item.url}${item.snippet ? `\n   ${item.snippet}` : ''}`)
      : [`No results for "${text}".`];
    return { content: [{ type: 'text', text: lines.join('\n\n') }], structuredContent: { query: text, results } };
  }
  async function fetchPage({ url }) {
    let parsed;
    try { parsed = new URL(String(url || '')); } catch { throw new Error('web_fetch needs an http or https address.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('web_fetch only reads http or https addresses.');
    const data = await firecrawl('/v2/scrape', { url: parsed.toString(), formats: ['markdown'], onlyMainContent: true });
    const source = String(data?.metadata?.sourceURL || parsed.toString());
    const title = data?.metadata?.title ? String(data.metadata.title) : '';
    const markdown = clip(String(data?.markdown || ''), FETCH_LIMIT);
    const header = [`Source: ${source}`, title ? `Title: ${title}` : ''].filter(Boolean).join('\n');
    const text = `${header}\n\n${markdown || '(The page had no readable main content.)'}`;
    return { content: [{ type: 'text', text }], structuredContent: { url: source, title: title || null, status: data?.metadata?.statusCode ?? null, truncated: String(data?.markdown || '').length > FETCH_LIMIT } };
  }
  async function handle(request) {
    switch (request.method) {
      case 'initialize':
        return { protocolVersion: negotiateProtocol(request.params?.protocolVersion), capabilities: { tools: {} }, serverInfo: SERVER_INFO };
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call': {
        const name = request.params?.name;
        const args = request.params?.arguments && typeof request.params.arguments === 'object' ? request.params.arguments : {};
        try {
          if (name === 'web_search') return await search(args);
          if (name === 'web_fetch') return await fetchPage(args);
          throw new Error(`Unknown tool: ${String(name).slice(0, 60)}`);
        } catch (failure) {
          return { content: [{ type: 'text', text: String(failure.message || failure).slice(0, 400) }], isError: true };
        }
      }
      default:
        throw Object.assign(new Error(`Method not found: ${String(request.method).slice(0, 60)}`), { code: -32601 });
    }
  }
  return { handle, configured: Boolean(apiKey), baseUrl: base };
}

/** Serve stdin/stdout until the input ends. */
export async function runWebResearchServer({ input = process.stdin, output = process.stdout, service = createWebResearch() } = {}) {
  let chain = Promise.resolve();
  const reader = createFrameReader((message, framing) => {
    chain = chain.then(async () => {
      if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') return;
      if (message.id === undefined || message.id === null) return; // notifications need no reply
      let reply;
      try { reply = { jsonrpc: '2.0', id: message.id, result: await service.handle(message) }; }
      catch (failure) { reply = { jsonrpc: '2.0', id: message.id, error: { code: failure.code || -32000, message: String(failure.message || failure).slice(0, 400) } }; }
      output.write(encodeMessage(reply, framing));
    }).catch(() => {});
  });
  for await (const chunk of input) reader.feed(chunk);
  await chain;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWebResearchServer().catch((failure) => { process.stderr.write(`Web research stopped: ${String(failure.message || failure).slice(0, 200)}\n`); process.exitCode = 1; });
}
