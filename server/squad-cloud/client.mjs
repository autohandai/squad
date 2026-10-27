// The desktop talks to Squad's control plane. Identity credentials are sent
// only during explicit sign-in; subsequent requests use a Squad session.
export function squadApiUrl(value = process.env.AUTOHAND_SQUAD_API_URL || "https://squad.autohand.ai") {
  const url = new URL(value);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw Error("Squad API must be an HTTPS origin (or local development server).");
  return url.origin;
}
export function createSquadApi({ baseUrl = squadApiUrl(), fetchImpl = fetch, token = "", signal: defaultSignal } = {}) {
  const origin = squadApiUrl(baseUrl);
  return {
    origin,
    async request(path, { method = "GET", body, idempotencyKey, signal } = {}) {
      if (!path.startsWith("/v1/") || path.startsWith("//")) throw Error("Invalid Squad API path.");
      const signals = [signal || defaultSignal, AbortSignal.timeout(15_000)].filter(Boolean);
      const response = await fetchImpl(`${origin}${path}`, { method, redirect: "error", signal: AbortSignal.any(signals),
        headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      let value;
      try { value = await response.json(); } catch { throw Object.assign(Error("Squad cloud returned an unreadable response. Your local data is kept."), { status: response.status }); }
      if (!response.ok || value.success !== true) throw Object.assign(Error(value.error?.message || (typeof value.error === "string" && value.error) || "Squad cloud is unavailable. Your local data is unchanged."), { status: response.status, code: value.error?.code });
      return value.data;
    },
  };
}
