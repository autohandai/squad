// Settings → System (ADR-0105, docs/integration/system.md).
//
//   GET  /api/system/summary   counts of members, channels, threads, messages
//                              and memory entries plus the data folder path
//   GET  /api/system/settings  { autoCheckUpdates }
//   PUT  /api/system/settings  { autoCheckUpdates? } -> stored settings
//   POST /api/system/reveal    open the data folder in Finder / Explorer

import { rename } from "node:fs/promises";
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
    const invalid = ["autoCheckUpdates", "autoDownloadUpdates"].find(key => key in body && typeof body[key] !== "boolean");
    if (invalid) {
      ctx.json(res, 400, { success: false, error: `${invalid} must be true or false.` });
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

  // Reset Squad to a clean install (ADR-0161 §3.1). Squad's own folders are
  // moved aside with a timestamp, never deleted: the state folder, the
  // members' isolated homes and the members' working folders. The person's
  // Autohand Code sign-in, sessions and skills in ~/.autohand stay. The
  // bridge then exits so its supervisor starts it empty; the window clears
  // its own storage and returns to first run. Keychain items, ~/Library
  // folders and macOS privacy grants belong to the desktop shell and are
  // listed in SETUP_GUIDE for a hand clean-out.
  if (url.pathname === "/api/system/reset" && req.method === "POST") {
    const body = await ctx.readBody(req);
    if (body?.confirm !== "RESET") {
      ctx.json(res, 400, { success: false, error: "Send { confirm: \"RESET\" } to reset Squad." });
      return true;
    }
    try {
      // Every engine process goes first: a warm session (a member's direct
      // chat, a channel thread) that outlived the bridge wrote its session
      // files under the original path after the rename, and the restarted
      // bridge found an existing install (demo run 14 on the installed app).
      if (typeof ctx.stopManagedRuns === "function") await ctx.stopManagedRuns("Squad reset by the person").catch(() => {});
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const moved = [];
      const candidates = [ctx.squadStateDir, appStateDirFor(ctx), ...(Array.isArray(ctx.memberWorkspaceRoots) ? ctx.memberWorkspaceRoots : [])].filter(Boolean);
      for (const folder of [...new Set(candidates)]) {
        const backup = `${folder.replace(/\/+$/, "")}.reset-${stamp}`;
        try { await rename(folder, backup); moved.push({ folder, backup }); }
        catch (error) { if (error?.code !== "ENOENT") throw error; }
      }
      ctx.logEvent?.(ctx.SEVERITY?.WARN, `Squad reset by the person; ${moved.length} folders moved aside`, { "event.name": "system.reset", "autohand.reset.folders": moved.map((entry) => entry.folder).join(",") });
      // Leave nothing of the old state in memory: let the supervisor bring
      // the bridge back empty, as soon as the answer is on the wire so no
      // later request writes state into the fresh folder.
      res.once("finish", () => setTimeout(() => process.exit(0), 50));
      ctx.json(res, 200, { success: true, data: { moved, restarting: true } });
    } catch (error) {
      ctx.json(res, 500, { success: false, error: error?.message || "Squad could not be reset." });
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
