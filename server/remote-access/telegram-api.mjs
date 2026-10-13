// A minimal Telegram Bot API client: plain fetch from this machine, no SDK,
// no inbound ports (ADR-0088). https://core.telegram.org/bots/api
//
// The base URL is injectable so scripts/check-remote-access.mjs can point the
// real bridge at a fake Bot API on loopback.

export const DEFAULT_TELEGRAM_API_URL = "https://api.telegram.org";

export class TelegramError extends Error {
  constructor(message, code, retryAfter) {
    super(message);
    this.name = "TelegramError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function telegramApiUrl() {
  return String(process.env.AUTOHAND_SQUAD_TELEGRAM_API_URL || DEFAULT_TELEGRAM_API_URL).replace(/\/+$/, "");
}

/** Bot API commands the bridge registers with setMyCommands. */
export const BOT_COMMANDS = Object.freeze([
  { command: "members", description: "Pick the member you are talking to" },
  { command: "channels", description: "List the squad's channels" },
  { command: "new", description: "Start a fresh conversation" },
  { command: "stop", description: "Stop the turn in progress" },
  { command: "status", description: "What Squad is running" },
  { command: "help", description: "How this works" },
]);

/**
 * Build a client bound to one token. `call(method, params, { signal,
 * timeoutMs })` resolves with the `result` or throws a TelegramError carrying
 * the Bot API error code (401 bad token, 409 another poller, 429 flood).
 */
export function createTelegramApi({ token, baseUrl = telegramApiUrl(), fetchImpl = fetch } = {}) {
  const base = String(baseUrl || DEFAULT_TELEGRAM_API_URL).replace(/\/+$/, "");
  const endpoint = (method) => `${base}/bot${token}/${method}`;

  async function call(method, params = {}, { signal, timeoutMs = 30_000 } = {}) {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (signal) signals.push(signal);
    let response;
    try {
      response = await fetchImpl(endpoint(method), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.any(signals),
        cache: "no-store",
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new TelegramError(`Can't reach Telegram: ${error?.message || error}`, 0);
    }
    const json = await response.json().catch(() => null);
    if (!json?.ok) {
      throw new TelegramError(json?.description || `Telegram answered ${response.status}`, json?.error_code ?? response.status, json?.parameters?.retry_after);
    }
    return json.result;
  }

  return { call, token };
}
