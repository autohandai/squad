// Forwarding to another machine's bridge. Every request carries the remote's
// bearer token and `x-autohand-transport: remote`; SSE bodies are piped
// through byte for byte; every failure names the remote's label.

import { Readable } from "node:stream";

import { REMOTE_TRANSPORT_HEADER, REMOTE_TRANSPORT_VALUE } from "./auth.mjs";

export const CONNECT_TIMEOUT_MS = 10_000;

export class RemoteError extends Error {
  constructor(remote, message, { status = 502, cause, retryable = true } = {}) {
    super(`${remoteLabel(remote)}: ${message}`);
    this.name = "RemoteError";
    this.status = status;
    this.remote = { label: remoteLabel(remote), url: remote?.url || "" };
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

export function remoteLabel(remote) {
  if (remote?.label) return String(remote.label);
  try {
    return new URL(remote?.url || "").host || "remote bridge";
  } catch {
    return "remote bridge";
  }
}

function remoteUrl(remote, path) {
  if (!remote?.url) throw new RemoteError(remote, "no bridge URL configured", { status: 400, retryable: false });
  const base = String(remote.url).replace(/\/+$/, "");
  const suffix = String(path || "").startsWith("/") ? path : `/${path || ""}`;
  return `${base}${suffix}`;
}

function requestHeaders(remote, { stream = false, body } = {}) {
  const headers = {
    accept: stream ? "text/event-stream" : "application/json",
    [REMOTE_TRANSPORT_HEADER]: REMOTE_TRANSPORT_VALUE,
  };
  if (remote?.token) headers.authorization = `Bearer ${remote.token}`;
  if (body !== undefined) headers["content-type"] = "application/json; charset=utf-8";
  return headers;
}

function formatTimeout(ms) {
  return ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${ms} ms`;
}

function describeFailure(error) {
  const cause = error?.cause || error;
  const code = cause?.code || "";
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return "was cancelled";
  if (code === "ECONNREFUSED") return "refused the connection";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "host not found";
  if (code === "ECONNRESET") return "closed the connection";
  if (code === "CERT_HAS_EXPIRED" || /certificate/i.test(cause?.message || "")) return `TLS problem (${cause.message})`;
  return `unreachable (${cause?.message || error?.message || "unknown error"})`;
}

/**
 * Open a request to the remote. Resolves once headers arrive (bounded by
 * the connect timeout); the body may keep streaming afterwards. `signal`
 * aborts the whole exchange (used when the browser goes away).
 */
async function open(remote, path, { method = "POST", body, stream = false, signal, timeoutMs = CONNECT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const release = () => signal && signal.removeEventListener("abort", onAbort);
  const timer = setTimeout(() => controller.abort(new Error("connect timeout")), timeoutMs);
  let response;
  try {
    response = await fetchImpl(remoteUrl(remote, path), {
      method,
      headers: requestHeaders(remote, { stream, body }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      redirect: "manual",
    });
  } catch (error) {
    clearTimeout(timer);
    release();
    if (error instanceof RemoteError) throw error;
    const timedOut = controller.signal.aborted && !(signal && signal.aborted);
    throw new RemoteError(remote, timedOut ? `did not answer within ${formatTimeout(timeoutMs)}` : describeFailure(error), { status: timedOut ? 504 : 502, cause: error });
  }
  clearTimeout(timer);
  return { response, controller, release };
}

async function envelopeFrom(remote, response) {
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (response.status === 401 || response.status === 403) {
    throw new RemoteError(remote, parsed?.error ? `rejected the token (${parsed.error})` : "rejected the token", { status: 401, retryable: false });
  }
  if (parsed && typeof parsed === "object" && "success" in parsed) {
    if (parsed.success) return parsed.data;
    const error = new RemoteError(remote, parsed.error || `answered ${response.status}`, { status: response.status >= 400 ? response.status : 502 });
    if (parsed.data !== undefined) error.details = parsed.data;
    throw error;
  }
  if (!response.ok) throw new RemoteError(remote, `answered ${response.status}${text ? ` (${text.slice(0, 120)})` : ""}`);
  throw new RemoteError(remote, "answered with something that is not a bridge envelope");
}

/**
 * Send JSON to `<url>/api/...` and return the envelope's data, stamped with
 * `transport: "remote"` and `remote: { label, url }` when it is an object.
 * With no body the request is a GET.
 */
export async function proxyJson(remote, path, body, { method = body === undefined ? "GET" : "POST", signal, timeoutMs, fetchImpl } = {}) {
  const { response, release } = await open(remote, path, { method, body, signal, timeoutMs, fetchImpl });
  try {
    const data = await envelopeFrom(remote, response);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return { ...data, transport: "remote", remote: { label: remoteLabel(remote), url: remote.url } };
    }
    return data;
  } finally {
    release();
  }
}

/**
 * POST to an SSE route on the remote and pipe the event stream into `res`
 * unchanged. Before the first upstream byte, one `remote` event tells the
 * client which bridge is answering. Failures before headers arrive throw a
 * RemoteError (the caller can still write a JSON error); failures mid-stream
 * become an `error` event because the response is already open.
 */
export async function proxyStream(remote, path, body, res, { signal, timeoutMs, fetchImpl } = {}) {
  const clientAbort = new AbortController();
  const onClose = () => clientAbort.abort();
  res.on("close", onClose);
  if (signal) signal.addEventListener("abort", onClose, { once: true });
  const detach = () => {
    res.off("close", onClose);
    if (signal) signal.removeEventListener("abort", onClose);
  };

  let opened;
  try {
    opened = await open(remote, path, { method: "POST", body, stream: true, signal: clientAbort.signal, timeoutMs, fetchImpl });
  } catch (error) {
    detach();
    throw error;
  }
  const { response, controller, release } = opened;
  const contentType = String(response.headers.get("content-type") || "");
  if (!response.ok || !contentType.includes("text/event-stream")) {
    release();
    detach();
    await envelopeFrom(remote, response); // throws with the remote's reason
    throw new RemoteError(remote, `answered ${response.status} instead of an event stream`);
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    [REMOTE_TRANSPORT_HEADER]: REMOTE_TRANSPORT_VALUE,
  });
  res.write(`event: remote\ndata: ${JSON.stringify({ transport: "remote", label: remoteLabel(remote), url: remote.url })}\n\n`);

  await new Promise((resolve) => {
    const upstream = Readable.fromWeb(response.body);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      release();
      detach();
      if (!res.destroyed && !res.writableEnded) res.end();
      resolve();
    };
    upstream.on("error", (error) => {
      if (!res.destroyed && !res.writableEnded && !clientAbort.signal.aborted) {
        const message = new RemoteError(remote, `stream ended early (${error?.message || "connection lost"})`).message;
        res.write(`event: error\ndata: ${JSON.stringify({ error: message, transport: "remote", retryable: true })}\n\n`);
      }
      finish();
    });
    upstream.on("end", finish);
    clientAbort.signal.addEventListener(
      "abort",
      () => {
        controller.abort();
        upstream.destroy();
        finish();
      },
      { once: true },
    );
    upstream.pipe(res, { end: false });
  });
}

/** GET /api/runtime on the remote and summarise what answers. */
export async function probe(remote, { fetchImpl, timeoutMs } = {}) {
  const startedAt = Date.now();
  const runtime = await proxyJson(remote, "/api/runtime", undefined, { fetchImpl, timeoutMs });
  const sessions = runtime?.sessions || {};
  return {
    ok: true,
    label: remoteLabel(remote),
    url: remote.url,
    latencyMs: Date.now() - startedAt,
    squadVersion: String(runtime?.squadVersion || ""),
    cliVersion: String(runtime?.version || ""),
    cliAvailable: Boolean(runtime?.available),
    harnesses: Array.isArray(runtime?.harnesses?.ids) ? runtime.harnesses.ids : [],
    account: runtime?.account?.email || runtime?.account?.label || "",
    activeSessions: Number(sessions.active) || 0,
    busySessions: Number(sessions.busy) || 0,
    serverStartedAt: String(runtime?.serverStartedAt || ""),
    checkedAt: new Date().toISOString(),
  };
}

/** One sentence for the settings row, from a probe result or a failure. */
export function probeSentence(result) {
  if (!result) return "";
  if (result.ok === false || result.error) return result.error || "The remote did not answer.";
  const parts = [`Reached ${result.label} in ${result.latencyMs} ms`];
  if (result.squadVersion) parts.push(`Squad ${result.squadVersion}`);
  if (result.cliVersion) parts.push(`autohand ${result.cliVersion}`);
  else if (result.cliAvailable === false) parts.push("autohand CLI not installed there");
  if (result.account) parts.push(result.account);
  return `${parts.join(" · ")}.`;
}
