// Remote access route plug-in (ADR-0102, docs/integration/remote-access.md).
//
//   GET    /api/remote-access/status            bot, pairing, owner, notify mode (never the token)
//   PUT    /api/remote-access/token             body: { token } → connects; a bad token is not saved
//   DELETE /api/remote-access/token             disconnect and forget the token
//   POST   /api/remote-access/unpair            forget the paired account, new pairing code
//   POST   /api/remote-access/pairing/rotate    new pairing code (while unpaired)
//   PUT    /api/remote-access/settings          body: { notifyMode: "long" | "all" | "off" }
//   GET    /api/remote-access/turns?memberId=   turns started from Telegram, for the app to show

import { createRemoteAccessBridge } from "../remote-access/bridge.mjs";

export const name = "remote-access";

export function createRemoteAccessPlugin(options = {}) {
  let bridge = null;

  async function init(ctx) {
    bridge = createRemoteAccessBridge({ ctx, ...options });
    await bridge.init();
  }

  async function handle(req, res, url, ctx) {
    if (!url.pathname.startsWith("/api/remote-access")) return false;
    if (!bridge) await init(ctx);
    const json = ctx.json;
    const path = url.pathname;
    const method = req.method;
    bridge.rememberAppUrl(req.headers?.host);
    try {
      if (path === "/api/remote-access/status" && method === "GET") {
        json(res, 200, { success: true, data: bridge.status() });
        return true;
      }
      if (path === "/api/remote-access/token" && method === "PUT") {
        const body = await ctx.readBody(req);
        json(res, 200, { success: true, data: await bridge.connect(body?.token) });
        return true;
      }
      if (path === "/api/remote-access/token" && method === "DELETE") {
        json(res, 200, { success: true, data: await bridge.disconnect() });
        return true;
      }
      if (path === "/api/remote-access/unpair" && method === "POST") {
        json(res, 200, { success: true, data: await bridge.unpair() });
        return true;
      }
      if (path === "/api/remote-access/pairing/rotate" && method === "POST") {
        json(res, 200, { success: true, data: await bridge.rotatePairing() });
        return true;
      }
      if (path === "/api/remote-access/settings" && method === "PUT") {
        const body = await ctx.readBody(req);
        json(res, 200, { success: true, data: await bridge.setNotifyMode(body?.notifyMode) });
        return true;
      }
      if (path === "/api/remote-access/turns" && method === "GET") {
        json(res, 200, { success: true, data: { turns: bridge.turns(url.searchParams.get("memberId") || "") } });
        return true;
      }
    } catch (error) {
      json(res, error?.status || 500, { success: false, error: error?.message || String(error) });
      return true;
    }
    return false;
  }

  return { init, handle, get bridge() { return bridge; } };
}

const plugin = createRemoteAccessPlugin();
export const init = plugin.init;
export const handle = plugin.handle;
