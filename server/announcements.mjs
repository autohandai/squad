import { squadApiUrl } from "./squad-cloud/client.mjs";

const fail = (message, status = 502) => Object.assign(Error(message), { status });
const bounded = (value, length) => typeof value === "string" ? value.slice(0, length) : "";
export function announcementUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}
function announcement(item) {
  if (!item || !/^[\w-]{1,100}$/.test(item.id) || !item.title) return null;
  return {
    id: item.id, title: bounded(item.title, 200), description: bounded(item.description, 4000),
    placement: item.placement === "sidebar" ? "sidebar" : "modal",
    ctaLabel: bounded(item.ctaLabel, 120), ctaUrl: announcementUrl(item.ctaUrl),
    steps: (Array.isArray(item.steps) ? item.steps : []).slice(0, 50).map(step => ({
      type: step.type === "video" ? "video" : "image", mediaUrl: announcementUrl(step.mediaUrl), posterUrl: announcementUrl(step.posterUrl),
      title: bounded(step.title, 200), description: bounded(step.description, 4000),
      ctaLabel: bounded(step.ctaLabel, 120), ctaUrl: announcementUrl(step.ctaUrl),
    })),
  };
}

export function createAnnouncements({ token, version, platform = process.platform, baseUrl = process.env.AUTOHAND_API_URL || "https://api.autohand.ai", fetchImpl = fetch }) {
  const origin = squadApiUrl(baseUrl);
  async function request(path, body) {
    const credential = token();
    if (!credential) throw fail("Sign in to read Squad announcements.", 401);
    const response = await fetchImpl(`${origin}/v1/announcements${path}`, {
      method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${credential}`, accept: "application/json", "x-client-type": "squad", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (credential !== token()) throw fail("The signed-in account changed. Try again.", 409);
    if (!response.ok) throw fail("Squad news is unavailable. Try again later.", response.status === 401 ? 401 : 502);
    const text = await response.text();
    if (text.length > 512 * 1024) throw fail("Squad news could not be read.");
    let result;
    try { result = JSON.parse(text); } catch { throw fail("Squad news could not be read."); }
    if (result.success === false) throw fail("Squad news could not be loaded.");
    return result;
  }
  return {
    async list() {
      if (!token()) return { announcements: [] };
      const query = new URLSearchParams({ clientType: "squad", appVersion: version, platform: ({ darwin: "macos", win32: "windows" })[platform] || platform });
      const result = await request(`?${query}`);
      return { announcements: (Array.isArray(result.announcements) ? result.announcements : []).slice(0, 50).map(announcement).filter(Boolean) };
    },
    async act(id, action, step) {
      if (!/^[\w-]{1,100}$/.test(id) || !["seen", "dismiss"].includes(action)) throw fail("Invalid announcement action.", 400);
      await request(`/${encodeURIComponent(id)}/${action}`, action === "seen" ? { lastStep: Math.max(0, Math.min(49, Number.isInteger(step) ? step : 0)) } : {});
      return { ok: true };
    },
  };
}
