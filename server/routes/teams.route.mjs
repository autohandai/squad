// Team sharing and presets (ADR-0106).
//
//   POST   /api/teams/export            a team file for a member selection
//   POST   /api/teams/presets/export    a preset file for one member
//   POST   /api/teams/import/plan       what a file would create, nothing created
//   POST   /api/teams/import            create channels and paused workflows,
//                                       save skills and presets, return the
//                                       members the browser creates next
//   GET    /api/teams/presets           presets offered in New member
//   DELETE /api/teams/presets/:id       forget an imported preset
//   GET    /api/teams/templates         the built-in team templates (ADR-0118)
//
// An import also creates the file's routines (paused, through the routines
// route) and connectors (off) when `choices.routines` / `choices.connectors`
// are not false (ADR-0118).
//
// Members are created by the browser through its confirmed creation path
// (ADR-0077), so a member arriving half-made is impossible here: this route
// only ever hands back the drafts. See docs/integration/teams.md.

import { TeamFileError, parseTeamUpload } from "../teams/validate.mjs";
import { addPresets, assemblePresetExport, assembleTeamExport, createChannelsAndWorkflows, createConnectors, createRoutines, listTemplates, planTeamImport, readPresets, removePreset, writeImportedSkills } from "../teams/package.mjs";
import { TEAM_LIMITS } from "../../src/lib/teams.js";
import { channelGoalInstruction, channelGoalSystemInstruction, channelGoalProposal, CHANNEL_GOAL_LIMIT } from "../../src/lib/channel-goals.js";
import { roleTemplates } from "../../src/lib/member-profiles.js";

export const name = "teams";

const PRESET_PATH = /^\/api\/teams\/presets\/([^/]+)$/;
// A file at the limit plus the envelope around it. Anything larger is
// refused while it is still being read.
const UPLOAD_BYTES = TEAM_LIMITS.fileBytes + 256 * 1024;

function fail(ctx, res, error) {
  const status = Number(error?.status) || Number(error?.statusCode) || 500;
  const message = status === 413 ? `This file is larger than ${Math.round(TEAM_LIMITS.fileBytes / 1024 / 1024)} MB, which is more than a team file can be.` : error?.message || "Something went wrong.";
  ctx.json(res, status, { success: false, error: message, ...(error?.runId ? { runId: error.runId } : {}) });
  return true;
}

function ok(ctx, res, status, data) {
  ctx.json(res, status, { success: true, data });
  return true;
}

function memberNames(value) {
  return (Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 1000);
}

export async function handle(req, res, url, ctx) {
  const path = url.pathname;
  if (!path.startsWith("/api/teams")) return false;

  if (path === "/api/teams/design" && req.method === "POST") {
    let runId;
    try {
      const body = await ctx.readBody(req), objective = String(body.objective || "").trim();
      if (!objective || objective.length > CHANNEL_GOAL_LIMIT) throw new TeamFileError(`Describe the channel's goal in 1–${CHANNEL_GOAL_LIMIT} characters.`, 400);
      const workspace = await ctx.cleanWorkspace(body.workspace);
      const skills = [...new Set(roleTemplates.flatMap(role => role.skills || []))];
      const summary = await ctx.startRun({ agentId: "squad-designer", workspace, profile: channelGoalSystemInstruction({ skills }), prompt: channelGoalInstruction(objective, { channelName: String(body.channelName || "").slice(0, 80) }), title: "Design a team for the channel goal", mode: "prompt", policy: "yes", ephemeralSession: true, resumeSession: false });
      runId = summary.id;
      const deadline = Date.now() + 90_000;
      let run;
      while (Date.now() < deadline) {
        run = ctx.runs.get(runId);
        if (run?.finishedAt) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!run?.finishedAt) throw new TeamFileError("The team design took too long. Your goal is saved; retry when the engine is ready.", 504);
      if (run.status !== "completed") throw new TeamFileError("The engine could not design the team. Your goal is saved; retry the design.", 502);
      const reply = String(run.reply || "").trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      let design;
      try { design = JSON.parse(reply); } catch { throw new TeamFileError("The engine did not return a valid team design. Your goal is saved; retry the design.", 502); }
      const proposal = channelGoalProposal(design, { objective, channelName: String(body.channelName || "team"), existingNames: memberNames(body.existingNames), skills });
      return ok(ctx, res, 200, { proposal, source: "model", runId });
    } catch (error) {
      if (runId) error.runId = runId;
      if (runId && ctx.isLiveRun(ctx.runs.get(runId))) await ctx.stopRun(runId, "team design could not finish").catch(() => {});
      return fail(ctx, res, error);
    }
  }

  if (path === "/api/teams/export" && req.method === "POST") {
    try {
      const body = await ctx.readBody(req);
      const result = await assembleTeamExport(ctx, body);
      ctx.logEvent(ctx.SEVERITY.INFO, `team file assembled: ${result.summary.members} members, ${result.summary.skills} skills, ${result.summary.channels} channels, ${result.summary.workflows} workflows`, { "event.name": "team.exported", "autohand.team.redactions": result.redacted.length });
      return ok(ctx, res, 200, result);
    } catch (error) {
      return fail(ctx, res, error);
    }
  }

  if (path === "/api/teams/presets/export" && req.method === "POST") {
    try {
      const body = await ctx.readBody(req);
      return ok(ctx, res, 200, await assemblePresetExport(ctx, body));
    } catch (error) {
      return fail(ctx, res, error);
    }
  }

  if (path === "/api/teams/import/plan" && req.method === "POST") {
    try {
      const body = await ctx.readBody(req, UPLOAD_BYTES);
      const { document, warnings } = parseTeamUpload(body);
      const plan = await planTeamImport(ctx, document, { existingMemberNames: memberNames(body?.existingMemberNames) });
      return ok(ctx, res, 200, { plan, warnings, document });
    } catch (error) {
      return fail(ctx, res, error);
    }
  }

  if (path === "/api/teams/import" && req.method === "POST") {
    try {
      const body = await ctx.readBody(req, UPLOAD_BYTES);
      const { document, warnings } = parseTeamUpload(body);
      const choices = body?.choices && typeof body.choices === "object" ? body.choices : {};
      const plan = await planTeamImport(ctx, document, { existingMemberNames: memberNames(body?.existingMemberNames) });
      const memberIds = body?.memberIds && typeof body.memberIds === "object" ? body.memberIds : {};
      const skills = choices.skills === false ? { added: [], kept: [] } : await writeImportedSkills(ctx, plan.skills);
      const presets = choices.presets === false ? { added: [], kept: [] } : await addPresets(ctx, plan.presets, { packageName: plan.team });
      const bridge = choices.channels === false
        ? { channels: [], workflows: [] }
        : await createChannelsAndWorkflows(ctx, { ...plan, workflows: choices.workflows === false ? [] : plan.workflows }, memberIds);
      // Routines and connectors are additive: a routine that cannot be made
      // stops the rest and is reported, but the channel just made stays, since
      // the members it holds already exist.
      let routines = [];
      let routineError = "";
      try {
        routines = choices.routines === false ? [] : await createRoutines(ctx, plan, memberIds, { host: String(req.headers?.host || ""), timeZone: String(body?.timeZone || "") });
      } catch (error) {
        routineError = error?.message || "routines could not be created";
      }
      const connectors = choices.connectors === false ? { added: [], kept: [] } : await createConnectors(ctx, plan);
      ctx.logEvent(ctx.SEVERITY.INFO, `team file imported: ${bridge.channels.length} channels, ${bridge.workflows.length} workflows, ${routines.length} routines, ${connectors.added.length} connectors, ${skills.added.length} skills, ${presets.added.length} presets`, { "event.name": "team.imported" });
      return ok(ctx, res, 201, {
        members: plan.members,
        channels: bridge.channels,
        workflows: bridge.workflows,
        routines,
        connectors,
        skills,
        presets: { added: presets.added.map((entry) => ({ id: entry.id, name: entry.preset.name })), kept: presets.kept.map((entry) => ({ id: entry.id, name: entry.preset.name })) },
        dropped: routineError ? [...plan.dropped, { what: "routines", reason: routineError }] : plan.dropped,
        warnings,
      });
    } catch (error) {
      return fail(ctx, res, error);
    }
  }

  if (path === "/api/teams/templates" && req.method === "GET") {
    try {
      return ok(ctx, res, 200, { templates: await listTemplates(ctx) });
    } catch (error) {
      return fail(ctx, res, error);
    }
  }

  if (path === "/api/teams/presets" && req.method === "GET") {
    try {
      return ok(ctx, res, 200, { presets: await readPresets(ctx), limit: TEAM_LIMITS.presets });
    } catch (error) {
      return fail(ctx, res, error);
    }
  }

  const presetMatch = path.match(PRESET_PATH);
  if (presetMatch && req.method === "DELETE") {
    try {
      const removed = await removePreset(ctx, decodeURIComponent(presetMatch[1]));
      if (!removed) throw new TeamFileError("That preset is not here any more.", 404);
      return ok(ctx, res, 200, { id: removed.id });
    } catch (error) {
      return fail(ctx, res, error);
    }
  }

  return false;
}
