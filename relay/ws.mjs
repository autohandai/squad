// Dependency-free WebSocket (RFC 6455) for the relay and the bridge client.
//
//   acceptWebSocket(req, socket, head)      server side, after an "upgrade" event
//   connectWebSocket(url, { headers })      client side, returns a Promise<connection>
//
// A connection is an EventEmitter: "message" (string), "close" ({ code, reason }),
// "error", "pong". It exposes send(stringOrObject), ping(), close(code, reason),
// and `open`. Text frames only; binary frames are delivered as UTF-8 strings.
// Fragmented messages are reassembled; control frames are answered inline.

import { EventEmitter } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OPCODE = { CONTINUATION: 0, TEXT: 1, BINARY: 2, CLOSE: 8, PING: 9, PONG: 10 };
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

export function acceptKey(key) {
  return createHash("sha1").update(`${key}${GUID}`).digest("base64");
}

export function encodeFrame({ opcode, payload = Buffer.alloc(0), mask = false, fin = true }) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  const length = data.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = (fin ? 0x80 : 0) | (opcode & 0x0f);
  if (!mask) return Buffer.concat([header, data]);
  header[1] |= 0x80;
  const key = randomBytes(4);
  const masked = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i += 1) masked[i] = data[i] ^ key[i & 3];
  return Buffer.concat([header, key, masked]);
}

// Incremental frame parser. Feed it buffers; it calls onFrame({ fin, opcode, payload }).
export class FrameParser {
  constructor(onFrame, { maxBytes = MAX_MESSAGE_BYTES } = {}) {
    this.onFrame = onFrame;
    this.maxBytes = maxBytes;
    this.buffer = Buffer.alloc(0);
  }

  feed(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const frame = this.next();
      if (!frame) break;
      this.onFrame(frame);
    }
  }

  next() {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let length = buf[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buf.length < 4) return null;
      length = buf.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buf.length < 10) return null;
      const big = buf.readBigUInt64BE(2);
      if (big > BigInt(this.maxBytes)) throw new Error("websocket frame too large");
      length = Number(big);
      offset = 10;
    }
    if (length > this.maxBytes) throw new Error("websocket frame too large");
    const keyLength = masked ? 4 : 0;
    if (buf.length < offset + keyLength + length) return null;
    let payload = buf.subarray(offset + keyLength, offset + keyLength + length);
    if (masked) {
      const key = buf.subarray(offset, offset + 4);
      const unmasked = Buffer.allocUnsafe(length);
      for (let i = 0; i < length; i += 1) unmasked[i] = payload[i] ^ key[i & 3];
      payload = unmasked;
    } else {
      payload = Buffer.from(payload);
    }
    this.buffer = buf.subarray(offset + keyLength + length);
    return { fin, opcode, payload };
  }
}

class Connection extends EventEmitter {
  constructor(socket, { mask }) {
    super();
    this.socket = socket;
    this.mask = mask;
    this.open = true;
    this.closing = false;
    this.fragments = [];
    this.fragmentOpcode = 0;
    this.parser = new FrameParser((frame) => this.handleFrame(frame));
    socket.setNoDelay?.(true);
    socket.on("data", (chunk) => {
      try {
        this.parser.feed(chunk);
      } catch (error) {
        this.emit("error", error);
        this.terminate();
      }
    });
    socket.on("close", () => this.finish(1006, "connection lost"));
    socket.on("end", () => this.finish(1006, "connection ended"));
    socket.on("error", (error) => {
      this.emit("error", error);
      this.finish(1006, error?.message || "socket error");
    });
  }

  // Bytes that arrived with the handshake are parsed on the next turn so the
  // caller has attached its listeners before the first frame is emitted.
  feedLater(head) {
    if (!head?.length) return;
    setImmediate(() => {
      if (!this.open) return;
      try {
        this.parser.feed(head);
      } catch (error) {
        this.emit("error", error);
        this.terminate();
      }
    });
  }

  handleFrame({ fin, opcode, payload }) {
    switch (opcode) {
      case OPCODE.TEXT:
      case OPCODE.BINARY:
        if (!fin) {
          this.fragmentOpcode = opcode;
          this.fragments = [payload];
          return;
        }
        this.emit("message", payload.toString("utf8"));
        return;
      case OPCODE.CONTINUATION:
        this.fragments.push(payload);
        if (fin) {
          const whole = Buffer.concat(this.fragments);
          this.fragments = [];
          this.emit("message", whole.toString("utf8"));
        }
        return;
      case OPCODE.PING:
        this.write(OPCODE.PONG, payload);
        return;
      case OPCODE.PONG:
        this.emit("pong");
        return;
      case OPCODE.CLOSE: {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        const reason = payload.length > 2 ? payload.subarray(2).toString("utf8") : "";
        if (!this.closing) {
          this.closing = true;
          this.write(OPCODE.CLOSE, payload);
        }
        this.finish(code, reason);
        this.socket.end();
        return;
      }
      default:
        this.close(1002, "unsupported opcode");
    }
  }

  write(opcode, payload) {
    if (!this.open || this.socket.destroyed) return false;
    try {
      this.socket.write(encodeFrame({ opcode, payload, mask: this.mask }));
      return true;
    } catch (error) {
      this.emit("error", error);
      return false;
    }
  }

  send(data) {
    const text = typeof data === "string" ? data : JSON.stringify(data);
    return this.write(OPCODE.TEXT, text);
  }

  ping(payload = "") {
    return this.write(OPCODE.PING, payload);
  }

  close(code = 1000, reason = "") {
    if (!this.open) return;
    if (!this.closing) {
      this.closing = true;
      const body = Buffer.alloc(2 + Buffer.byteLength(reason));
      body.writeUInt16BE(code, 0);
      body.write(reason, 2);
      this.write(OPCODE.CLOSE, body);
    }
    // Give the peer a moment to echo the close frame, then tear down.
    const timer = setTimeout(() => this.terminate(), 500);
    timer.unref?.();
    this.socket.once("close", () => clearTimeout(timer));
  }

  terminate() {
    if (this.socket.destroyed) return;
    this.socket.destroy();
  }

  finish(code, reason) {
    if (!this.open) return;
    this.open = false;
    this.emit("close", { code, reason });
  }
}

/** Server side: finish the upgrade handshake and return the connection. */
export function acceptWebSocket(req, socket, head = Buffer.alloc(0)) {
  const key = String(req.headers["sec-websocket-key"] || "").trim();
  const version = String(req.headers["sec-websocket-version"] || "").trim();
  if (!key || version !== "13" || !/websocket/i.test(String(req.headers.upgrade || ""))) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return null;
  }
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      "",
      "",
    ].join("\r\n")
  );
  const connection = new Connection(socket, { mask: false });
  connection.feedLater(head);
  return connection;
}

/** Reject an upgrade with an HTTP status (before the handshake completes). */
export function rejectWebSocket(socket, status = 401, message = "Unauthorized") {
  const body = JSON.stringify({ success: false, error: message });
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
  );
  socket.destroy();
}

/** Client side: open a WebSocket to `url` (ws://, wss://, http://, https://). */
export function connectWebSocket(url, { headers = {}, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (error) {
      reject(new Error(`invalid websocket url: ${url}`));
      return;
    }
    const secure = target.protocol === "wss:" || target.protocol === "https:";
    const transport = secure ? https : http;
    const key = randomBytes(16).toString("base64");
    const request = transport.request({
      method: "GET",
      hostname: target.hostname,
      port: target.port || (secure ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": key,
        "Sec-WebSocket-Version": "13",
        Host: target.host,
        ...headers,
      },
      timeout: timeoutMs,
    });
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.on("timeout", () => {
      request.destroy(new Error("websocket connect timed out"));
    });
    request.on("error", fail);
    request.on("response", (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        let detail = "";
        try {
          detail = JSON.parse(body)?.error || "";
        } catch {
          detail = "";
        }
        const error = new Error(detail || `websocket upgrade refused (${response.statusCode})`);
        error.status = response.statusCode;
        fail(error);
      });
    });
    request.on("upgrade", (response, socket, head) => {
      if (String(response.headers["sec-websocket-accept"] || "") !== acceptKey(key)) {
        socket.destroy();
        fail(new Error("websocket accept key mismatch"));
        return;
      }
      settled = true;
      const connection = new Connection(socket, { mask: true });
      connection.feedLater(head);
      resolve(connection);
    });
    request.end();
  });
}

export const opcodes = OPCODE;
