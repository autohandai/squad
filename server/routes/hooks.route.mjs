// Sessions started outside Squad (ADR-0127).
//
//   POST /api/hooks/:engine            a lifecycle event from server/hooks/forward.mjs → { runId? }
//   GET  /api/hooks/status             { claude: { installed, path, exists, error? }, codex: { ... } }
//   POST /api/hooks/:engine/install    add Squad's hooks to that engine's config (backup kept) → status
//   POST /api/hooks/:engine/uninstall  remove only Squad's entries → status
//
// :engine is claude or codex. Installing writes the person's own config
// file, so it happens only on this explicit request from Settings.
import { HOOK_ENGINES, hookStatus, installHooks, uninstallHooks } from "../hooks/install.mjs";
import { createExternalSessions } from "../hooks/sessions.mjs";

export const name = "hooks";

const EVENT = /^\/api\/hooks\/(claude|codex)$/;
const ACTION = /^\/api\/hooks\/(claude|codex)\/(install|uninstall)$/;
let sessions = null;

export async function init(ctx) {
  sessions = createExternalSessions({ runs: ctx.runs, persist: () => ctx.persistRuns?.(), emit: (name, payload) => ctx.emit?.(name, payload) });
}

function fail(ctx, res, error) {
  ctx.json(res, error?.status || 400, { success: false, error: error?.message || String(error) });
}

export async function handle(req, res, url, ctx) {
  if (url.pathname === "/api/hooks/status" && req.method === "GET") {
    const entries = await Promise.all(HOOK_ENGINES.map((engine) => hookStatus(engine)));
    ctx.json(res, 200, { success: true, data: Object.fromEntries(entries.map((entry) => [entry.engine, entry])) });
    return true;
  }
  let match = url.pathname.match(ACTION);
  if (match && req.method === "POST") {
    try {
      const [, engine, action] = match;
      const port = req.socket?.localPort || 19821;
      const status = action === "install"
        ? await installHooks(engine, { nodePath: process.execPath, rootDir: ctx.rootDir, port })
        : await uninstallHooks(engine);
      ctx.logEvent?.(ctx.SEVERITY?.INFO ?? 9, `${engine} hooks ${action === "install" ? "installed" : "removed"} in ${status.path}`, { "event.name": `hooks.${action}`, "autohand.harness": engine });
      ctx.json(res, 200, { success: true, data: status });
    } catch (error) {
      fail(ctx, res, error);
    }
    return true;
  }
  match = url.pathname.match(EVENT);
  if (match && req.method === "POST") {
    try {
      const body = await ctx.readBody(req, 512 * 1024);
      const result = sessions ? await sessions.ingest(match[1], body) : null;
      ctx.json(res, 200, { success: true, data: result || {} });
    } catch (error) {
      fail(ctx, res, error);
    }
    return true;
  }
  return false;
}
