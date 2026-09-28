// Designing a squad member from a sentence.
//
//   POST /api/members/draft { description }
//     -> { draft, source: "model" | "fallback", error? }
//
// The shaping rules live in src/lib/member-draft.js so the browser and the
// bridge agree on what a member looks like. This route only adds the model:
// it asks one, validates whatever comes back through the same normaliser, and
// falls back to the deterministic draft when there is no model, the model
// fails, or it answers with something that is not the JSON it was asked for.
//
// See docs/adrs/ADR-0031-member-draft-skill.md.

import { MEMBER_DESIGNER_ID, draftFromDescription, draftInstruction, mergeModelDraft } from "../../src/lib/member-draft.js";

export const name = "member-draft";

// The ceiling exists for a model that is wedged, not for one that is working.
// Twenty seconds was set when a cold start was eating the whole budget. With
// the designer warmed and given no MCP servers (ADR-0036) a real answer takes
// 12-15s, most of the difference being that the brain card the app actually
// has is seven fields rather than the five this used to ask for. Cutting a
// working model off at twenty put back the generic member all of this was
// meant to fix. The page states this number, so check-member-draft.mjs holds
// the two together.
const DRAFT_TIMEOUT_MS = 30_000;

export async function handle(req, res, url, ctx) {
  if (url.pathname !== "/api/members/draft" || req.method !== "POST") return false;

  const body = await ctx.readBody(req);
  const description = String(body?.description || "").trim();
  const fallback = draftFromDescription(description);
  const agentId = String(body?.agentId || "").trim() || MEMBER_DESIGNER_ID;

  if (!description) {
    ctx.json(res, 200, { success: true, data: { draft: fallback, source: "fallback" } });
    return true;
  }

  try {
    const reply = await askModel(ctx, description, body, req, agentId);
    const parsed = parseJsonObject(reply);
    if (!parsed) {
      ctx.json(res, 200, { success: true, data: { draft: fallback, source: "fallback", error: "the model did not answer with JSON" } });
      return true;
    }
    ctx.json(res, 200, { success: true, data: { draft: mergeModelDraft(fallback, parsed), source: "model" } });
  } catch (error) {
    // A member the person can edit beats an error dialog.
    ctx.logEvent(ctx.SEVERITY.DEBUG, `member draft fell back: ${error?.message || error}`, { "event.name": "member.draft.fallback" });
    ctx.json(res, 200, { success: true, data: { draft: fallback, source: "fallback", error: String(error?.message || error) } });
  } finally {
    recycleDesigner(ctx, req, agentId, body);
  }
  return true;
}

/**
 * Give the next design a warm process with an empty conversation.
 *
 * The session pool keeps the CLI's own transcript, which is what a member
 * chat wants and the opposite of what this wants: every draft is an
 * independent one-shot request. Measured on one session, three drafts of the
 * same sentence took 28s, then 20s, then 25s, and the last two came back as
 * prose rather than the JSON they were asked for, because by then the model
 * was continuing a conversation instead of answering a question.
 *
 * Closing the session and warming a new one costs the person nothing: it
 * happens after their answer is already sent, and the CLI boots while they
 * read it. Only the app's own designer is recycled; a caller naming their own
 * member would lose that member's chat context.
 */
function recycleDesigner(ctx, req, agentId, body) {
  if (agentId !== MEMBER_DESIGNER_ID) return;
  const workspace = String(body?.workspace || ctx.getRuntime?.()?.defaultWorkspace || "").trim();
  const host = String(req?.headers?.host || "127.0.0.1:19821");
  Promise.resolve()
    .then(() => ctx.sdkSessions?.reset?.(agentId, "member draft is one-shot"))
    .then(() => {
      if (!workspace) return null;
      return fetch(`http://${host}/api/chat/warm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, workspace }),
      });
    })
    .catch((error) => {
      ctx.logEvent(ctx.SEVERITY.DEBUG, `designer not recycled: ${error?.message || error}`, { "event.name": "member.draft.recycle.failed" });
    });
}

/**
 * One turn through the bridge's own chat route, so this uses whatever harness
 * and account the app already has rather than opening a second path to a
 * model.
 */
async function askModel(ctx, description, body, req, agentId) {
  const runtime = ctx.getRuntime?.() || {};
  const workspace = String(body?.workspace || runtime.defaultWorkspace || "").trim();
  if (!workspace) throw new Error("no workspace to run in");
  // The request arrived at this bridge, so its own Host header is the address
  // to call back on. Guessing a port would break a bridge on any other one.
  const host = String(req?.headers?.host || "127.0.0.1:19821");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);
  try {
    const response = await fetch(`http://${host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId,
        prompt: draftInstruction(description),
        workspace,
        transport: "sdk",
      }),
      signal: controller.signal,
    });
    const envelope = await response.json();
    if (!envelope?.success) throw new Error(envelope?.error || `chat returned ${response.status}`);
    return String(envelope.data?.reply || envelope.data?.output || "");
  } finally {
    clearTimeout(timer);
  }
}

/** The first JSON object in a reply, tolerating a code fence or stray prose. */
function parseJsonObject(text) {
  const value = String(text || "");
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], value, value.slice(value.indexOf("{"), value.lastIndexOf("}") + 1)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next shape.
    }
  }
  return null;
}
