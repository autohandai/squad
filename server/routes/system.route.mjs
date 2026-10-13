// Settings → System (ADR-0105, docs/integration/system.md).
//
//   GET  /api/system/summary   counts of members, channels, threads, messages
//                              and memory entries plus the data folder path
//   GET  /api/system/settings  { autoCheckUpdates }
//   PUT  /api/system/settings  { autoCheckUpdates? } -> stored settings
//   POST /api/system/reveal    open the data folder in Finder / Explorer

import { join } from "node:path";

import { countMemoryEntries, systemSummary } from "../system/summary.mjs";
import { publicSystemSettings, readSystemSettings, writeSystemSettings } from "../system/settings.mjs";
import { revealActionLabel, revealFolder } from "../system/reveal.mjs";

export const name = "system";

function appStateDirFor(ctx) {
  return ctx.appStateDir || join(ctx.rootDir, ".autohand");
}

export async function handle(req, res, url, ctx) {
  if (url.pathname === "/api/system/summary" && req.method === "GET") {
    try {
      const appStateDir = appStateDirFor(ctx);
      const [webStatus, channelsState, memory] = await Promise.all([
        ctx.readOptionalJsonFile(join(ctx.squadStateDir, "web-status.json")),
        ctx.readChannelsState().catch(() => null),
        countMemoryEntries(join(appStateDir, "agents")),
      ]);
      const summary = systemSummary({ webStatus, channelsState, memory, squadStateDir: ctx.squadStateDir, appStateDir });
      ctx.json(res, 200, { success: true, data: { ...summary, revealLabel: revealActionLabel() } });
    } catch (error) {
      ctx.json(res, 500, { success: false, error: error?.message || "The system summary could not be read." });
    }
    return true;
  }

  if (url.pathname === "/api/system/settings" && req.method === "GET") {
    ctx.json(res, 200, { success: true, data: publicSystemSettings(await readSystemSettings(ctx.squadStateDir)) });
    return true;
  }

  if (url.pathname === "/api/system/settings" && (req.method === "PUT" || req.method === "POST")) {
    const body = await ctx.readBody(req);
    if ("autoCheckUpdates" in body && typeof body.autoCheckUpdates !== "boolean") {
      ctx.json(res, 400, { success: false, error: "autoCheckUpdates must be true or false." });
      return true;
    }
    try {
      const stored = await writeSystemSettings(ctx.squadStateDir, body);
      ctx.logEvent?.(ctx.SEVERITY?.INFO, "system.settings.changed", { "event.name": "system.settings.changed", autoCheckUpdates: stored.autoCheckUpdates });
      ctx.json(res, 200, { success: true, data: publicSystemSettings(stored) });
    } catch (error) {
      ctx.json(res, 500, { success: false, error: error?.message || "Settings could not be saved." });
    }
    return true;
  }

  if (url.pathname === "/api/system/reveal" && req.method === "POST") {
    // The folder is always the bridge's own data folder; the request cannot
    // name a path.
    try {
      const data = await revealFolder(ctx.squadStateDir);
      ctx.json(res, 200, { success: true, data });
    } catch (error) {
      ctx.json(res, 502, { success: false, error: error?.message || "The folder could not be opened." });
    }
    return true;
  }

  return false;
}
