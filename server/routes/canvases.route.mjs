// Canvases route plug-in (ADR-0023). CRUD under /api/canvases plus the two
// run-side steps: `materialize` writes the canvas to a file the integrator
// passes as an extra `--add-dir`, `absorb` reads it back and records one
// revision when the member changed it.
//
// Search: a plug-in must not fetch the bridge, so every body change emits
// `canvas.updated` on the bus and the search module indexes from there.

import * as canvases from "../canvases/store.mjs";

export const name = "canvases";

const COLLECTION = /^\/api\/canvases\/?$/;
const ITEM = /^\/api\/canvases\/([A-Za-z0-9][A-Za-z0-9_-]{0,80})$/;
const ACTION = /^\/api\/canvases\/([A-Za-z0-9][A-Za-z0-9_-]{0,80})\/(revert|materialize|absorb)$/;

function fail(ctx, res, error) {
  const status = Number(error?.status) || (error?.code === "ENOENT" ? 404 : 500);
  ctx.json(res, status, { success: false, error: String(error?.message || error) });
}

function announce(ctx, canvas, revision, reason) {
  if (!canvas) return;
  const payload = { id: canvas.id, ownerType: canvas.ownerType, ownerId: canvas.ownerId, title: canvas.title, body: canvas.body, reason };
  if (revision) payload.revision = { id: revision.id, authorId: revision.authorId, at: revision.at, summary: revision.summary };
  if (typeof ctx.emit === "function") ctx.emit("canvas.updated", payload);
  else ctx.events?.emit?.("canvas.updated", { name: "canvas.updated", at: new Date().toISOString(), ...payload });
}

export async function init(ctx) {
  // A run tagged with `canvasId` (set by startRun, see docs/integration/canvases.md)
  // is absorbed as soon as it finishes so a member edit becomes a revision
  // without a second request from the web app.
  ctx.events?.on?.("run.finished", async (event) => {
    const run = ctx.runs?.get?.(event?.runId);
    const canvasId = String(run?.canvasId || "");
    if (!canvasId) return;
    try {
      const result = await canvases.absorb(ctx.squadStateDir, canvasId, event.memberId || run.agentId || "member", {
        summary: run.title ? `Run: ${String(run.title).slice(0, 200)}` : "",
      });
      if (result.changed) {
        announce(ctx, result.canvas, result.revision, "run");
        ctx.logEvent?.(ctx.SEVERITY?.INFO, "canvas absorbed after run", { canvasId, runId: event.runId, memberId: event.memberId });
      }
    } catch (error) {
      ctx.logEvent?.(ctx.SEVERITY?.WARN, "canvas absorb failed", { canvasId, runId: event.runId, error: String(error?.message || error) });
    }
  });
}

export async function handle(req, res, url, ctx) {
  const stateDir = ctx.squadStateDir;
  const method = req.method;

  if (COLLECTION.test(url.pathname)) {
    if (method === "GET") {
      try {
        const ownerType = url.searchParams.get("ownerType") || "";
        const ownerId = url.searchParams.get("ownerId") || "";
        ctx.json(res, 200, { success: true, data: { canvases: await canvases.list(stateDir, { ownerType, ownerId }) } });
      } catch (error) {
        fail(ctx, res, error);
      }
      return true;
    }
    if (method === "POST") {
      try {
        const body = await ctx.readBody(req);
        const canvas = await canvases.create(stateDir, body || {});
        announce(ctx, canvas, canvas.revisions[0], "created");
        ctx.json(res, 201, { success: true, data: { canvas } });
      } catch (error) {
        fail(ctx, res, error);
      }
      return true;
    }
    return false;
  }

  const item = url.pathname.match(ITEM);
  if (item) {
    const id = item[1];
    try {
      if (method === "GET") {
        ctx.json(res, 200, { success: true, data: { canvas: await canvases.get(stateDir, id) } });
        return true;
      }
      if (method === "PUT" || method === "PATCH") {
        const body = (await ctx.readBody(req)) || {};
        const result = await canvases.update(stateDir, id, { title: body.title, body: body.body, authorId: body.authorId || "user", summary: body.summary || "" });
        if (result.changed) announce(ctx, result.canvas, result.revision, "edited");
        ctx.json(res, 200, { success: true, data: result });
        return true;
      }
      if (method === "DELETE") {
        const removed = await canvases.remove(stateDir, id);
        if (typeof ctx.emit === "function") ctx.emit("canvas.removed", { id: removed.id });
        ctx.json(res, 200, { success: true, data: removed });
        return true;
      }
    } catch (error) {
      fail(ctx, res, error);
      return true;
    }
    return false;
  }

  const action = url.pathname.match(ACTION);
  if (action && method === "POST") {
    const [, id, verb] = action;
    try {
      const body = (await ctx.readBody(req)) || {};
      if (verb === "revert") {
        const result = await canvases.revert(stateDir, id, body.revisionId, body.authorId || "user");
        if (result.changed) announce(ctx, result.canvas, result.revision, "reverted");
        ctx.json(res, 200, { success: true, data: result });
        return true;
      }
      if (verb === "materialize") {
        const { dir, path } = await canvases.materialize(stateDir, id);
        ctx.json(res, 200, { success: true, data: { dir, path } });
        return true;
      }
      if (verb === "absorb") {
        const result = await canvases.absorb(stateDir, id, body.authorId || "member", { summary: body.summary || "" });
        if (result.changed) announce(ctx, result.canvas, result.revision, "absorbed");
        ctx.json(res, 200, { success: true, data: { changed: result.changed, revision: result.revision, canvas: result.canvas } });
        return true;
      }
    } catch (error) {
      fail(ctx, res, error);
      return true;
    }
  }

  return false;
}
