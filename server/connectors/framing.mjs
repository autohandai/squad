// MCP stdio framing. The spec is newline-delimited JSON-RPC, but the pinned
// Autohand CLI 0.9.7 opens with Content-Length headers (ADR-0070), and some
// older servers only speak that. Everything here reads both and writes
// whichever framing it was told to.

export const MAX_MESSAGE = 16 * 1024 * 1024;

/** Encode one JSON-RPC message in the given framing ("newline" | "header"). */
export function encodeMessage(message, framing = 'newline') {
  const encoded = Buffer.from(JSON.stringify(message));
  return framing === 'header'
    ? Buffer.concat([Buffer.from(`Content-Length: ${encoded.length}\r\n\r\n`), encoded])
    : Buffer.concat([encoded, Buffer.from('\n')]);
}

/**
 * Incremental reader. `onMessage(message, framing)` is called for every
 * parseable JSON object; unparseable lines (server chatter) are dropped.
 * Throws when a single message exceeds MAX_MESSAGE.
 */
export function createFrameReader(onMessage) {
  let buffer = Buffer.alloc(0);
  return {
    feed(chunk) {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      if (buffer.length > MAX_MESSAGE) throw new Error('MCP message exceeds its size limit.');
      for (;;) {
        if (!buffer.length) return;
        if (buffer.subarray(0, 15).toString().toLowerCase().startsWith('content-length:')) {
          const end = buffer.indexOf('\r\n\r\n');
          if (end < 0) return;
          const match = buffer.subarray(0, end).toString().match(/^Content-Length:\s*(\d+)/i);
          const size = Number(match?.[1]);
          if (!Number.isSafeInteger(size) || size > MAX_MESSAGE) throw new Error('Invalid MCP message size.');
          if (buffer.length < end + 4 + size) return;
          const body = buffer.subarray(end + 4, end + 4 + size);
          buffer = buffer.subarray(end + 4 + size);
          deliver(body, 'header');
        } else {
          const end = buffer.indexOf('\n');
          if (end < 0) return;
          const body = buffer.subarray(0, end);
          buffer = buffer.subarray(end + 1);
          if (body.length) deliver(body, 'newline');
        }
      }
    },
  };
  function deliver(body, framing) {
    let message;
    try { message = JSON.parse(body.toString()); } catch { return; }
    if (message && typeof message === 'object') onMessage(message, framing);
  }
}

/** Protocol versions the bridge and the built-in server understand. */
export const PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];
export const LATEST_PROTOCOL = '2025-06-18';

/** The version to answer an initialize with: echo a known one, else the latest. */
export function negotiateProtocol(requested) {
  return PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL;
}

/** A one-line error no longer than `limit` characters, for the browser. */
export function boundedError(value, limit = 240) {
  const text = String(value?.message ?? value ?? 'Unknown error').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
