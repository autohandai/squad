// Squad's own Google connector: a dependency-free stdio MCP server for one
// Google product per process (`--product gmail|drive|calendar`).
//
// The access token never travels in argv or the member's config. The server
// asks the Squad bridge for it over loopback with a per-work connector token,
// keeps it in memory until shortly before it expires, and asks again with
// `stale: true` when Google refuses it. Every text the server returns is
// scrubbed of any token it has held.
//
// Framing: newline-delimited JSON-RPC per the MCP spec, and Content-Length
// headers for clients that open with them (the pinned Autohand CLI does).
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFrameReader, encodeMessage, negotiateProtocol } from './framing.mjs';

export const TEXT_LIMIT = 12000;
export const PRODUCTS = ['gmail', 'drive', 'calendar'];
const ORIGINS = { gmail: 'https://gmail.googleapis.com', drive: 'https://www.googleapis.com', calendar: 'https://www.googleapis.com' };
const API_NAMES = { gmail: 'Gmail', drive: 'Google Drive', calendar: 'Google Calendar' };
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const BRIDGE_TIMEOUT_MS = 15000;
const GOOGLE_TIMEOUT_MS = 20000;
const BACKOFF_MS = [500, 1500];
const MAX_RETRY_AFTER_MS = 5000;
const REFRESH_MARGIN_S = 60;
const MAX_DOWNLOAD = 10 * 1024 * 1024;
const SIGN_IN_AGAIN = 'Sign in to Google again in Settings › Connectors.';
const SCOPE_MISSING = "Google didn't grant this permission. Sign in to Google again in Settings › Connectors and allow access.";

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const count = (max, fallback) => ({ type: 'integer', minimum: 1, maximum: max, description: `How many results (default ${fallback}, at most ${max}).` });
const MAIL = {
  type: 'object',
  properties: {
    to: { type: 'string', description: 'Recipients: email addresses separated by commas.' },
    cc: { type: 'string', description: 'Optional Cc recipients, comma-separated.' },
    bcc: { type: 'string', description: 'Optional Bcc recipients, comma-separated.' },
    subject: { type: 'string', description: 'Subject line (one line).' },
    body: { type: 'string', description: 'Plain-text message body.' },
  },
  required: ['to', 'subject', 'body'],
};

export const TOOLS = {
  gmail: [
    { name: 'gmail_search', description: 'Search the signed-in Gmail mailbox with Gmail search syntax (e.g. "from:ana newer_than:7d", "is:unread label:inbox"). Returns id, thread, sender, subject, date and a snippet per message. Follow up with gmail_read for the full text.', annotations: { title: 'Search Gmail', ...READ }, inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Gmail search query, as typed in the Gmail search box.' }, maxResults: count(25, 10) }, required: ['query'] } },
    { name: 'gmail_read', description: `Read one Gmail message: headers, the plain-text body (HTML converted to text when there is no plain part, at most ${TEXT_LIMIT} characters) and the names and sizes of attachments (not downloaded).`, annotations: { title: 'Read a Gmail message', ...READ }, inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Message id from gmail_search.' } }, required: ['id'] } },
    { name: 'gmail_create_draft', description: 'Save a plain-text email as a Gmail draft without sending it. Prefer this over gmail_send unless the person asked for the email to go out.', annotations: { title: 'Create a Gmail draft', ...WRITE }, inputSchema: MAIL },
    { name: 'gmail_send', description: 'Send a plain-text email from the signed-in Gmail account right away. It cannot be unsent; only use it when the person asked for the email to be sent.', annotations: { title: 'Send an email', readOnlyHint: false, destructiveHint: true, openWorldHint: true }, inputSchema: MAIL },
  ],
  drive: [
    { name: 'drive_search', description: 'Search Google Drive by the words inside files and their names (not in the trash). Returns id, name, type, last change, owners and link per file. Follow up with drive_read.', annotations: { title: 'Search Google Drive', ...READ }, inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Words to look for.' }, maxResults: count(25, 10) }, required: ['query'] } },
    { name: 'drive_recent', description: 'List the most recently changed files in Google Drive, newest first.', annotations: { title: 'Recent Drive files', ...READ }, inputSchema: { type: 'object', properties: { maxResults: count(25, 10) } } },
    { name: 'drive_read', description: `Read one Drive file as text (at most ${TEXT_LIMIT} characters): Google Docs and Slides as plain text, Google Sheets as CSV (first sheet), and text, CSV, Markdown, JSON or XML files as they are. Other files return their details only.`, annotations: { title: 'Read a Drive file', ...READ }, inputSchema: { type: 'object', properties: { fileId: { type: 'string', description: 'File id from drive_search or drive_recent.' } }, required: ['fileId'] } },
  ],
  calendar: [
    { name: 'calendar_list_events', description: 'List Google Calendar events in a time range (default: the next 7 days), in start order, recurring events expanded.', annotations: { title: 'List calendar events', ...READ }, inputSchema: { type: 'object', properties: { calendarId: { type: 'string', description: 'Calendar id (default "primary").' }, timeMin: { type: 'string', description: 'Start of the range, ISO 8601 (default now).' }, timeMax: { type: 'string', description: 'End of the range, ISO 8601 (default 7 days after the start).' }, query: { type: 'string', description: 'Optional words to match in events.' }, maxResults: count(50, 20) } } },
    { name: 'calendar_create_event', description: 'Create a Google Calendar event. Guests are only emailed when notifyAttendees is true.', annotations: { title: 'Create a calendar event', ...WRITE }, inputSchema: { type: 'object', properties: { calendarId: { type: 'string', description: 'Calendar id (default "primary").' }, summary: { type: 'string', description: 'Event title.' }, start: { type: 'string', description: 'ISO 8601 date-time with offset (2026-11-18T09:00:00+10:00), or YYYY-MM-DD for an all-day event.' }, end: { type: 'string', description: 'Same form as start. For all-day events this is the day after the last day.' }, timeZone: { type: 'string', description: 'IANA time zone (e.g. "Australia/Sydney"); needed when start and end have no offset.' }, description: { type: 'string' }, location: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' }, description: 'Guest email addresses.' }, notifyAttendees: { type: 'boolean', description: 'Email the guests an invitation (default false).' } }, required: ['summary', 'start', 'end'] } },
  ],
};

const clip = (text, max = TEXT_LIMIT) => (text.length <= max ? text : `${text.slice(0, max)}\n… ${text.length - max} more characters not shown`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const fail = (message) => { throw new Error(message); };
const ID = /^[A-Za-z0-9_-]{1,200}$/;
function integer(value, min, max, fallback) {
  const number = Number(value);
  return value === undefined || value === null || !Number.isFinite(number) ? fallback : Math.min(max, Math.max(min, Math.trunc(number)));
}
function text(value, field, { required = true, oneLine = false } = {}) {
  const result = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  if (required && !result.trim()) fail(`${field} is required.`);
  // A line break in a header field would start a new header (header injection).
  if (oneLine && /[\r\n]/.test(result)) fail(`${field} must be one line; refusing a line break in it.`);
  return result;
}
function addresses(value, field, required) {
  const raw = Array.isArray(value) ? value.map(String) : [text(value, field, { required })];
  if (raw.some((item) => /[\r\n]/.test(item))) fail(`${field} must not contain line breaks; refusing it.`);
  const list = raw.flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean);
  for (const item of list) if (!item.includes('@') || item.length > 320) fail(`"${item.slice(0, 80)}" in ${field} isn't an email address.`);
  if (required && !list.length) fail(`${field} needs at least one email address.`);
  return list;
}
const decodeEntities = (value) => String(value)
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
function htmlToText(html) {
  return decodeEntities(String(html)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Base64url `raw` for an RFC 2822 plain-text message. */
export function composeMessage({ to, cc, bcc, subject, body }) {
  const recipients = { To: addresses(to, 'to', true), Cc: addresses(cc, 'cc', false), Bcc: addresses(bcc, 'bcc', false) };
  const line = text(subject, 'subject', { required: false, oneLine: true });
  const encodedSubject = /[^\x20-\x7e]/.test(line) ? `=?UTF-8?B?${Buffer.from(line, 'utf8').toString('base64')}?=` : line;
  const headers = [...Object.entries(recipients).filter(([, list]) => list.length).map(([name, list]) => `${name}: ${list.join(', ')}`), `Subject: ${encodedSubject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64'];
  // Base64 body keeps UTF-8 and long lines intact through every relay.
  const content = Buffer.from(text(body, 'body', { required: false }).replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
  return { raw: Buffer.from(`${headers.join('\r\n')}\r\n\r\n${content}`, 'utf8').toString('base64url'), recipients };
}

export function createGoogleWorkspace({ product, env = process.env, fetchRequest = fetch } = {}) {
  if (!PRODUCTS.includes(product)) throw new Error(`Unknown Google product: ${String(product).slice(0, 40)}`);
  const bridge = { url: env.AUTOHAND_SQUAD_CONNECTOR_URL || '', token: env.AUTOHAND_SQUAD_CONNECTOR_TOKEN || '', id: env.AUTOHAND_SQUAD_CONNECTOR_ID || '' };
  const apiBase = env.AUTOHAND_SQUAD_GOOGLE_API_BASE || '';
  const secrets = new Set(bridge.token ? [bridge.token] : []);
  let cached = null;

  async function accessToken(stale) {
    if (!stale && cached && (cached.expiresAt === null || cached.expiresAt - REFRESH_MARGIN_S > Date.now() / 1000)) return cached.token;
    cached = null;
    if (!bridge.url || !bridge.token || !bridge.id) fail(`Google isn't connected for this member. Connect it in Settings › Connectors.`);
    let target = null;
    try { target = new URL(bridge.url); } catch { /* refused below */ }
    // The connector token only ever goes to the bridge on this computer.
    if (!target || target.protocol !== 'http:' || !LOOPBACK.has(target.hostname) || target.username || target.password) fail('The Squad connector address is not a local http address on this computer, so the Google sign-in was not requested.');
    let response;
    try {
      response = await fetchRequest(target, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'x-squad-connector-token': bridge.token }, body: JSON.stringify({ id: bridge.id, want: 'access-token', stale: Boolean(stale) }), signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS) });
    } catch (failure) {
      fail(failure?.name === 'TimeoutError' ? "Squad didn't hand out the Google sign-in within 15 seconds. Try again." : "Couldn't reach Squad for the Google sign-in. Check that Squad is still running.");
    }
    const json = await response.json().catch(() => null);
    if (json?.success !== true) fail(json && typeof json.error === 'string' && json.error.trim() ? json.error.replace(/\s+/g, ' ').trim().slice(0, 300) : `Squad couldn't hand out the Google sign-in (it answered ${response.status}).`);
    const token = json.data?.accessToken;
    if (typeof token !== 'string' || !token) fail(`Squad handed out an empty Google sign-in. ${SIGN_IN_AGAIN}`);
    const expiresAt = json.data.expiresAt === null || json.data.expiresAt === undefined ? null : Number(json.data.expiresAt);
    cached = { token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : null };
    secrets.add(token);
    return token;
  }

  function retryDelay(response, attempt) {
    const header = response?.headers.get('retry-after');
    if (header !== null && header !== undefined && header !== '') {
      const seconds = Number(header);
      const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
      if (Number.isFinite(ms)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms));
    }
    return BACKOFF_MS[attempt];
  }

  async function googleError(response) {
    const body = await response.text().catch(() => '');
    let error = {};
    try { error = JSON.parse(body).error ?? {}; } catch { /* not JSON */ }
    if (typeof error === 'string') error = { message: error };
    const reasons = [...(error.errors || []), ...(error.details || [])].map((item) => String(item?.reason || '')).join(' ');
    const message = String(error.message || body || response.statusText || 'no details').replace(/\s+/g, ' ').trim();
    if (response.status === 401) return `Google refused the sign-in. ${SIGN_IN_AGAIN}`;
    if (response.status === 403 && (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/.test(reasons) || /insufficient authentication scopes/i.test(message))) return SCOPE_MISSING;
    if (response.status === 403 && (/accessNotConfigured|SERVICE_DISABLED/.test(reasons) || /has not been used in project|is disabled/i.test(message))) return `The ${API_NAMES[product]} API is not enabled for the Google Cloud project that owns this sign-in. Enable it in that project's Google Cloud console, then try again.`;
    if (response.status === 404) return 'Google answered not found: there is nothing with that id, or this account cannot see it.';
    return `Google answered ${response.status}: ${message.slice(0, 200)}`;
  }

  /** One Google API call: bearer token, timeout, retries, one refresh on 401. */
  async function google(path, { method = 'GET', query = {}, body, as = 'json' } = {}) {
    const url = new URL(path, apiBase || ORIGINS[product]);
    for (const [key, value] of Object.entries(query)) {
      for (const item of [value].flat()) if (item !== undefined && item !== null && item !== '') url.searchParams.append(key, String(item));
    }
    const send = async (token) => {
      for (let attempt = 0; ; attempt += 1) {
        let response = null, failure = null;
        try {
          response = await fetchRequest(url, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
        } catch (error) { failure = error; }
        // A POST is only repeated when Google certainly did not act on it.
        const retryable = method === 'GET'
          ? Boolean(failure) || response.status === 429 || response.status >= 500
          : failure ? (failure.cause?.code || failure.code) === 'ECONNREFUSED' : [429, 503].includes(response.status);
        if (!retryable || attempt >= BACKOFF_MS.length) {
          if (failure) fail(failure.name === 'TimeoutError' ? `Google didn't answer within ${GOOGLE_TIMEOUT_MS / 1000} seconds. Try again.` : `Couldn't reach Google (${String(failure.cause?.code || failure.code || 'network error').slice(0, 40)}).`);
          return response;
        }
        await response?.arrayBuffer().catch(() => {});
        await sleep(retryDelay(response, attempt));
      }
    };
    let response = await send(await accessToken(false));
    if (response.status === 401) {
      await response.arrayBuffer().catch(() => {});
      response = await send(await accessToken(true));
    }
    if (!response.ok) fail(await googleError(response));
    if (as === 'text') return response.text();
    const raw = await response.text();
    return raw ? JSON.parse(raw) : {};
  }

  // --- Gmail ---
  const GMAIL = '/gmail/v1/users/me';
  const header = (message, name) => message.payload?.headers?.find((item) => String(item.name).toLowerCase() === name.toLowerCase())?.value ?? '';
  async function gmailSearch({ query, maxResults }) {
    const q = text(query, 'query').trim();
    const limit = integer(maxResults, 1, 25, 10);
    const list = await google(`${GMAIL}/messages`, { query: { q, maxResults: limit } });
    const messages = await Promise.all((list.messages || []).slice(0, limit).map((item) => google(`${GMAIL}/messages/${encodeURIComponent(item.id)}`, { query: { format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] } })));
    const results = messages.map((message) => ({ id: message.id, threadId: message.threadId, from: header(message, 'From'), to: header(message, 'To'), subject: header(message, 'Subject'), date: header(message, 'Date'), snippet: decodeEntities(message.snippet || '') }));
    const lines = results.length
      ? results.map((item, index) => `${index + 1}. ${item.subject || '(no subject)'}\n   From: ${item.from} · ${item.date}\n   id: ${item.id} · thread: ${item.threadId}${item.snippet ? `\n   ${item.snippet}` : ''}`)
      : [`No messages match "${q}".`];
    return { content: [{ type: 'text', text: clip(lines.join('\n\n')) }], structuredContent: { query: q, results } };
  }
  async function gmailRead({ id }) {
    const messageId = text(id, 'id').trim();
    if (!ID.test(messageId)) fail('id must be a Gmail message id from gmail_search.');
    const message = await google(`${GMAIL}/messages/${messageId}`, { query: { format: 'full' } });
    const found = { plain: [], html: [], attachments: [] };
    (function walk(part) {
      if (!part) return;
      const mime = String(part.mimeType || '').toLowerCase();
      if (part.filename) found.attachments.push({ filename: part.filename, mimeType: mime, size: Number(part.body?.size) || 0 });
      else if (part.body?.data && mime === 'text/plain') found.plain.push(Buffer.from(part.body.data, 'base64url').toString('utf8'));
      else if (part.body?.data && mime === 'text/html') found.html.push(Buffer.from(part.body.data, 'base64url').toString('utf8'));
      for (const child of part.parts || []) walk(child);
    })(message.payload);
    const body = (found.plain.join('\n\n').trim() || htmlToText(found.html.join('\n')) || '(This message has no readable text.)').replace(/\r\n/g, '\n');
    const fields = { from: header(message, 'From'), to: header(message, 'To'), cc: header(message, 'Cc'), date: header(message, 'Date'), subject: header(message, 'Subject') };
    const head = [`From: ${fields.from}`, `To: ${fields.to}`, fields.cc && `Cc: ${fields.cc}`, `Date: ${fields.date}`, `Subject: ${fields.subject}`].filter(Boolean).join('\n');
    const attached = found.attachments.length ? `\n\nAttachments (not downloaded):\n${found.attachments.map((item) => `- ${item.filename} (${item.size} bytes)`).join('\n')}` : '';
    const clipped = clip(body, Math.max(0, TEXT_LIMIT - head.length - attached.length - 2));
    return { content: [{ type: 'text', text: `${head}\n\n${clipped}${attached}` }], structuredContent: { id: message.id, threadId: message.threadId, ...fields, labelIds: message.labelIds || [], body: clipped, truncated: clipped !== body, attachments: found.attachments } };
  }
  async function gmailCompose(args, send) {
    const { raw, recipients } = composeMessage(args);
    const subject = String(args.subject ?? '');
    if (send) {
      const sent = await google(`${GMAIL}/messages/send`, { method: 'POST', body: { raw } });
      return { content: [{ type: 'text', text: `Sent "${subject}" to ${recipients.To.join(', ')}.\nid: ${sent.id} · thread: ${sent.threadId}` }], structuredContent: { id: sent.id, threadId: sent.threadId, to: recipients.To, cc: recipients.Cc, bcc: recipients.Bcc, subject } };
    }
    const draft = await google(`${GMAIL}/drafts`, { method: 'POST', body: { message: { raw } } });
    return { content: [{ type: 'text', text: `Saved a draft "${subject}" to ${recipients.To.join(', ')}. It has not been sent.\ndraft id: ${draft.id}` }], structuredContent: { draftId: draft.id, messageId: draft.message?.id ?? null, threadId: draft.message?.threadId ?? null, to: recipients.To, cc: recipients.Cc, bcc: recipients.Bcc, subject } };
  }

  // --- Drive ---
  const FILE_FIELDS = 'id,name,mimeType,modifiedTime,webViewLink,owners(displayName)';
  const EXPORTS = { 'application/vnd.google-apps.document': 'text/plain', 'application/vnd.google-apps.spreadsheet': 'text/csv', 'application/vnd.google-apps.presentation': 'text/plain' };
  const TEXT_TYPES = new Set(['application/json', 'application/xml', 'text/csv', 'text/markdown', 'application/x-yaml', 'application/yaml']);
  const describeFile = (file) => ({ id: file.id, name: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime ?? null, webViewLink: file.webViewLink ?? null, owners: (file.owners || []).map((owner) => owner.displayName).filter(Boolean) });
  const fileLines = (files) => files.map((file, index) => `${index + 1}. ${file.name}\n   ${file.mimeType} · modified ${file.modifiedTime || 'unknown'}${file.owners.length ? ` · ${file.owners.join(', ')}` : ''}\n   id: ${file.id}${file.webViewLink ? `\n   ${file.webViewLink}` : ''}`);
  async function driveList(query, empty) {
    const data = await google('/drive/v3/files', { query: { ...query, fields: `files(${FILE_FIELDS})`, supportsAllDrives: true, includeItemsFromAllDrives: true } });
    const files = (data.files || []).map(describeFile);
    return { content: [{ type: 'text', text: clip(files.length ? fileLines(files).join('\n\n') : empty) }], structuredContent: { files } };
  }
  function driveSearch({ query, maxResults }) {
    const words = text(query, 'query').trim();
    // Drive query strings are single-quoted: escape the backslash first, then the quote.
    const escaped = words.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return driveList({ q: `fullText contains '${escaped}' and trashed = false`, pageSize: integer(maxResults, 1, 25, 10) }, `No Drive files match "${words}".`);
  }
  const driveRecent = ({ maxResults }) => driveList({ q: 'trashed = false', orderBy: 'modifiedTime desc', pageSize: integer(maxResults, 1, 25, 10) }, 'Drive has no files.');
  async function driveRead({ fileId }) {
    const id = text(fileId, 'fileId').trim();
    if (!ID.test(id)) fail('fileId must be a Drive file id from drive_search or drive_recent.');
    const meta = await google(`/drive/v3/files/${id}`, { query: { fields: `${FILE_FIELDS},size`, supportsAllDrives: true } });
    const file = describeFile(meta);
    const mime = String(meta.mimeType || '');
    const header = `${file.name}\n${mime} · modified ${file.modifiedTime || 'unknown'}${file.webViewLink ? `\n${file.webViewLink}` : ''}`;
    if (mime === 'application/vnd.google-apps.drawing') fail(`"${file.name}" is a Google Drawing; it can't be read as text. Open it from ${file.webViewLink || 'Google Drive'}.`);
    let content;
    if (EXPORTS[mime]) content = await google(`/drive/v3/files/${id}/export`, { query: { mimeType: EXPORTS[mime] }, as: 'text' });
    else if (mime.startsWith('text/') || TEXT_TYPES.has(mime) || /\+(json|xml)$/.test(mime)) {
      if (Number(meta.size) > MAX_DOWNLOAD) return { content: [{ type: 'text', text: `${header}\n\nThis file is ${meta.size} bytes, too large to read here.` }], structuredContent: { file, readable: false, text: null, truncated: false } };
      content = await google(`/drive/v3/files/${id}`, { query: { alt: 'media', supportsAllDrives: true }, as: 'text' });
    } else {
      return { content: [{ type: 'text', text: `${header}\n\nThis is a ${mime || 'binary'} file, so it can't be read as text here.` }], structuredContent: { file, readable: false, text: null, truncated: false } };
    }
    const clipped = clip(content, Math.max(0, TEXT_LIMIT - header.length - 2));
    return { content: [{ type: 'text', text: `${header}\n\n${clipped || '(The file is empty.)'}` }], structuredContent: { file, readable: true, text: clipped, truncated: clipped !== content } };
  }

  // --- Calendar ---
  const calendarPath = (calendarId) => {
    const id = text(calendarId, 'calendarId', { required: false, oneLine: true }).trim() || 'primary';
    if (id.length > 300) fail('calendarId is too long.');
    return `/calendar/v3/calendars/${encodeURIComponent(id)}/events`;
  };
  function instant(value, field) {
    const parsed = Date.parse(String(value));
    if (!Number.isFinite(parsed)) fail(`${field} must be an ISO 8601 date-time, like 2026-11-18T09:00:00+10:00.`);
    return new Date(parsed);
  }
  const summarizeEvent = (event) => ({ id: event.id, summary: event.summary || '(no title)', start: event.start?.dateTime || event.start?.date || null, end: event.end?.dateTime || event.end?.date || null, allDay: Boolean(event.start?.date), location: event.location || null, attendees: (event.attendees || []).map((item) => item.email).filter(Boolean), status: event.status || null, htmlLink: event.htmlLink || null });
  async function calendarList({ calendarId, timeMin, timeMax, query, maxResults }) {
    const path = calendarPath(calendarId);
    const from = timeMin ? instant(timeMin, 'timeMin') : new Date();
    const to = timeMax ? instant(timeMax, 'timeMax') : new Date(from.getTime() + 7 * 24 * 3600 * 1000);
    if (to <= from) fail('timeMax must be after timeMin.');
    const q = text(query, 'query', { required: false }).trim();
    const data = await google(path, { query: { singleEvents: true, orderBy: 'startTime', timeMin: from.toISOString(), timeMax: to.toISOString(), q, maxResults: integer(maxResults, 1, 50, 20) } });
    const events = (data.items || []).map(summarizeEvent);
    const lines = events.length
      ? events.map((event, index) => `${index + 1}. ${event.summary}\n   ${event.start} → ${event.end}${event.allDay ? ' (all day)' : ''}${event.location ? `\n   Where: ${event.location}` : ''}${event.attendees.length ? `\n   Guests: ${event.attendees.length}` : ''}\n   id: ${event.id}`)
      : [`No events between ${from.toISOString()} and ${to.toISOString()}.`];
    return { content: [{ type: 'text', text: clip(lines.join('\n\n')) }], structuredContent: { timeMin: from.toISOString(), timeMax: to.toISOString(), events } };
  }
  async function calendarCreate(args) {
    const path = calendarPath(args.calendarId);
    const summary = text(args.summary, 'summary').trim();
    const timeZone = text(args.timeZone, 'timeZone', { required: false, oneLine: true }).trim();
    if (timeZone && !/^[A-Za-z0-9_+\-/]{1,64}$/.test(timeZone)) fail('timeZone must be an IANA time zone, like "Australia/Sydney".');
    const when = (value, field) => {
      const raw = text(value, field).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(raw))) return { date: raw };
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) || !Number.isFinite(Date.parse(raw))) fail(`${field} must be an ISO 8601 date-time (2026-11-18T09:00:00+10:00) or a date (2026-11-18) for an all-day event.`);
      if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(raw) && !timeZone) fail(`${field} has no UTC offset; add one (like +10:00) or pass timeZone.`);
      return timeZone ? { dateTime: raw, timeZone } : { dateTime: raw };
    };
    const start = when(args.start, 'start');
    let end = when(args.end, 'end');
    if (Boolean(start.date) !== Boolean(end.date)) fail('start and end must both be dates (all-day) or both be date-times.');
    // All-day ends are exclusive; a same-day end means a one-day event.
    if (start.date && end.date === start.date) end = { date: new Date(Date.parse(start.date) + 86400000).toISOString().slice(0, 10) };
    if (Date.parse(end.date || end.dateTime) <= Date.parse(start.date || start.dateTime)) fail('end must be after start.');
    const attendees = args.attendees === undefined || args.attendees === null ? [] : addresses(args.attendees, 'attendees', false);
    const notify = args.notifyAttendees === true;
    const body = { summary, start, end, ...(args.description ? { description: text(args.description, 'description') } : {}), ...(args.location ? { location: text(args.location, 'location') } : {}), ...(attendees.length ? { attendees: attendees.map((email) => ({ email })) } : {}) };
    const event = summarizeEvent(await google(path, { method: 'POST', query: { sendUpdates: notify ? 'all' : 'none' }, body }));
    const guests = attendees.length ? ` Guests ${notify ? 'were emailed an invitation' : 'were not emailed'}.` : '';
    return { content: [{ type: 'text', text: `Created "${event.summary}" ${event.start} → ${event.end}.${guests}\nid: ${event.id}${event.htmlLink ? `\n${event.htmlLink}` : ''}` }], structuredContent: { ...event, notified: notify } };
  }

  const handlers = {
    gmail: { gmail_search: gmailSearch, gmail_read: gmailRead, gmail_create_draft: (args) => gmailCompose(args, false), gmail_send: (args) => gmailCompose(args, true) },
    drive: { drive_search: driveSearch, drive_recent: driveRecent, drive_read: driveRead },
    calendar: { calendar_list_events: calendarList, calendar_create_event: calendarCreate },
  }[product];
  const scrub = (result) => {
    let json = JSON.stringify(result);
    for (const secret of secrets) json = json.split(secret).join('[redacted]');
    return JSON.parse(json);
  };

  async function handle(request) {
    switch (request.method) {
      case 'initialize':
        return { protocolVersion: negotiateProtocol(request.params?.protocolVersion), capabilities: { tools: {} }, serverInfo: { name: `squad-google-${product}`, version: '1' } };
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: TOOLS[product] };
      case 'tools/call': {
        const name = request.params?.name;
        const args = request.params?.arguments && typeof request.params.arguments === 'object' ? request.params.arguments : {};
        try {
          if (!Object.hasOwn(handlers, name)) fail(`Unknown tool: ${String(name).slice(0, 60)}`);
          return scrub(await handlers[name](args));
        } catch (failure) {
          return scrub({ content: [{ type: 'text', text: String(failure?.message || failure).slice(0, 400) }], isError: true });
        }
      }
      default:
        throw Object.assign(new Error(`Method not found: ${String(request.method).slice(0, 60)}`), { code: -32601 });
    }
  }
  return { handle, product };
}

/** Serve stdin/stdout until the input ends. */
export async function runGoogleWorkspaceServer({ input = process.stdin, output = process.stdout, service } = {}) {
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
  delete process.env.AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN;
  const args = process.argv.slice(2);
  const flag = args.find((arg) => arg.startsWith('--product='));
  const product = flag ? flag.slice('--product='.length) : args[args.indexOf('--product') + 1];
  if (!args.some((arg) => arg === '--product' || arg.startsWith('--product=')) || !PRODUCTS.includes(product)) {
    process.stderr.write(`Usage: google-workspace-mcp.mjs --product ${PRODUCTS.join('|')} (got ${JSON.stringify(String(product ?? '')).slice(0, 40)})\n`);
    process.exit(2);
  }
  runGoogleWorkspaceServer({ service: createGoogleWorkspace({ product }) }).catch((failure) => { process.stderr.write(`Google ${product} stopped: ${String(failure.message || failure).slice(0, 200)}\n`); process.exitCode = 1; });
}
