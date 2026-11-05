// Settings → System (ADR-0105, docs/integration/system.md).
//
//   GET  /api/system/summary   counts of members, channels, threads, messages
//                              and memory entries plus the data folder path
//   GET  /api/system/settings  update and Quick Chat preferences
//   PUT  /api/system/settings  partial preference patch -> stored settings
//   POST /api/system/reveal    open the data folder in Finder / Explorer

import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { countMemoryEntries, systemSummary } from "../system/summary.mjs";
import { publicSystemSettings, readSystemSettings, writeSystemSettings } from "../system/settings.mjs";
import { revealActionLabel, revealFolder } from "../system/reveal.mjs";
import { archiveSquadState, readResetProgress, writeResetProgress } from "../system/reset.mjs";

export const name = "system";

function appStateDirFor(ctx) {
  return ctx.appStateDir || join(ctx.rootDir, ".autohand");
}

export async function handle(req, res, url, ctx) {
  if (url.pathname === "/api/system/reset/status" && req.method === "GET") {
    const requestId = url.searchParams.get("requestId");
    const active = ctx.currentSystemReset?.();
    const progress = await readResetProgress(ctx.squadStateDir);
    let data = progress?.requestId === requestId ? progress : null;
    if (active?.requestId === requestId) data ||= { requestId, phase: "working", previousPid: process.pid };
    else if (!data && Number(url.searchParams.get("previousPid")) === process.pid) data = { requestId, phase: "not-started", previousPid: process.pid, error: "The reset did not start. Restart Squad and try again." };
    ctx.json(res, 200, { success: true, data });
    return true;
  }
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
    if (!body || typeof body !== "object" || Array.isArray(body)) { ctx.json(res, 400, { success: false, error: "Settings must be an object." }); return true; }
    const invalid = ["autoCheckUpdates", "autoDownloadUpdates", "quickChatEnabled", "quickChatShowUsage"].find(key => key in body && typeof body[key] !== "boolean");
    if ("quickChatAppearance" in body && !["glass", "solid"].includes(body.quickChatAppearance)) {
      ctx.json(res, 400, { success: false, error: "Choose glass or solid for Quick Chat appearance." }); return true;
    }
    if ("quickChatMenuBarMode" in body && !["single", "active-agents"].includes(body.quickChatMenuBarMode)) {
      ctx.json(res, 400, { success: false, error: "Choose single or active-agents for the menu bar." }); return true;
    }
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
    const requestId = body.requestId || randomUUID();
    if (!/^[a-f0-9-]{36}$/i.test(requestId)) {
      ctx.json(res, 400, { success: false, error: "A valid reset request ID is required." });
      return true;
    }
    const previous = await readResetProgress(ctx.squadStateDir);
    if (previous?.requestId === requestId && previous.phase === "complete") {
      ctx.json(res, 200, { success: true, data: previous });
      return true;
    }
    let releaseReset;
    try {
      // Every engine process goes first: a warm session (a member's direct
      // chat, a channel thread) that outlived the bridge wrote its session
      // files under the original path after the rename, and the restarted
      // bridge found an existing install (demo run 14 on the installed app).
      releaseReset = ctx.holdSystemReset?.(requestId);
      await writeResetProgress(ctx.squadStateDir, { requestId, phase: "working", previousPid: process.pid });
      if (typeof ctx.stopManagedRuns === "function") {
        let timer;
        try {
          await Promise.race([ctx.stopManagedRuns("Squad reset by the person"), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Squad could not finish stopping its work. No folders have been moved; restart Squad and try again.")), 20_000); })]);
        } finally { clearTimeout(timer); }
      }
      const receipt = { ...await archiveSquadState({ squadStateDir: ctx.squadStateDir, appStateDir: appStateDirFor(ctx), memberWorkspaceRoots: ctx.memberWorkspaceRoots }), requestId, phase: "complete" };
      await writeResetProgress(ctx.squadStateDir, receipt);
      const { moved } = receipt;
      ctx.logEvent?.(ctx.SEVERITY?.WARN, `Squad reset by the person; ${moved.length} folders moved aside`, { "event.name": "system.reset", "autohand.reset.folders": moved.map((entry) => entry.folder).join(",") });
      // Leave nothing of the old state in memory: let the supervisor bring
      // the bridge back empty, as soon as the answer is on the wire so no
      // later request writes state into the fresh folder.
      res.once("finish", () => setTimeout(() => process.exit(0), 50));
      ctx.json(res, 200, { success: true, data: receipt });
    } catch (error) {
      if (releaseReset) await writeResetProgress(ctx.squadStateDir, { requestId, phase: "failed", previousPid: process.pid, error: error.message }).catch(() => {});
      releaseReset?.();
      ctx.json(res, error.status || 500, { success: false, error: error?.message || "Squad could not be reset." });
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
