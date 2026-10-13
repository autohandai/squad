// Previous chats (ADR-0113).
//
//   GET    /api/members/:id/chats                 { chats: [summary] } newest first
//   POST   /api/members/:id/chats                 put the current conversation away:
//                                                 { messages, startedAt, endedAt, harness, workspace, title }
//                                                 → 201 summary. Captures and forgets the member's harness
//                                                 session ids and closes its warm SDK session, so the next
//                                                 message starts a clean context.
//   GET    /api/members/:id/chats/:chatId         the full record (messages included)
//   POST   /api/members/:id/chats/:chatId/open    bring a chat back: { current? } puts the current
//                                                 conversation away first (same body as POST above), then
//                                                 restores the chosen chat's harness session ids and
//                                                 removes it from the list → { chat, archived }
//   DELETE /api/members/:id/chats/:chatId         { removed }
//
// A summary is { id, memberId, title, startedAt, endedAt, createdAt, harness,
// workspace, messageCount, turns, limited, resumable }.
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { ChatStore, buildChatRecord, validChatId, validMemberId } from "../chats/store.mjs";
import { captureHarnessSessions, restoreHarnessSessions } from "../chats/sessions.mjs";

export const name = "chats";

const LIST = /^\/api\/members\/([^/]+)\/chats$/;
const ONE = /^\/api\/members\/([^/]+)\/chats\/([^/]+)$/;
const OPEN = /^\/api\/members\/([^/]+)\/chats\/([^/]+)\/open$/;

let store = null;
let bridge = null;

export async function init(ctx) {
  bridge = ctx;
  store = new ChatStore({ squadStateDir: ctx.squadStateDir });
}

function agentHomeFor(ctx, memberId) {
  return join(ctx.appStateDir, "agents", memberId);
}

function fail(res, ctx, error) {
  ctx.json(res, error?.status || 400, { success: false, error: error?.message || String(error) });
}

function memberIdFrom(match) {
  const memberId = decodeURIComponent(match[1] || "").toLowerCase();
  if (!validMemberId(memberId)) throw Object.assign(new Error("member id is invalid"), { status: 400 });
  return memberId;
}

function chatIdFrom(match) {
  const chatId = decodeURIComponent(match[2] || "");
  if (!validChatId(chatId)) throw Object.assign(new Error("chat id is invalid"), { status: 400 });
  return chatId;
}

/** Put a conversation away and start the member's next turn from nothing. */
async function archive(ctx, memberId, input) {
  const agentHome = agentHomeFor(ctx, memberId);
  const sessions = await captureHarnessSessions(agentHome);
  let closed = 0;
  if (ctx.sdkSessions) closed = await ctx.sdkSessions.reset(memberId, "new conversation").catch(() => 0);
  const record = buildChatRecord(memberId, input, { id: `chat-${randomUUID()}`, sessions });
  const summary = await store.save(record);
  ctx.logEvent?.(ctx.SEVERITY?.INFO ?? 9, `chat put away for ${memberId}: ${record.turns} turns, ${summary.resumable ? "resumable" : "no session"}`, {
    "event.name": "chat.archived",
    "autohand.member.id": memberId,
    "autohand.chat.id": record.id,
    "autohand.chat.turns": record.turns,
    "autohand.chat.sessions_closed": closed,
  });
  return summary;
}

export async function handle(req, res, url, ctx) {
  if (!store) return false;
  const context = ctx || bridge;

  let match = url.pathname.match(OPEN);
  if (match && req.method === "POST") {
    try {
      const memberId = memberIdFrom(match);
      const chatId = chatIdFrom(match);
      const body = await context.readBody(req);
      const chat = await store.get(memberId, chatId);
      if (!chat) throw Object.assign(new Error("that chat is no longer here"), { status: 404 });
      let archived = null;
      if (body?.current && Array.isArray(body.current.messages) && body.current.messages.some((message) => message?.role === "user")) {
        archived = await archive(context, memberId, body.current);
      } else {
        // Nothing worth keeping, but the engine must still forget the
        // current session before it is handed the archived one.
        await captureHarnessSessions(agentHomeFor(context, memberId));
        if (context.sdkSessions) await context.sdkSessions.reset(memberId, "previous chat opened").catch(() => 0);
      }
      const restored = await restoreHarnessSessions(agentHomeFor(context, memberId), chat.sessions);
      await store.remove(memberId, chatId);
      context.logEvent?.(context.SEVERITY?.INFO ?? 9, `chat reopened for ${memberId}: ${chat.title}`, {
        "event.name": "chat.reopened",
        "autohand.member.id": memberId,
        "autohand.chat.id": chatId,
        "autohand.chat.sessions_restored": restored,
      });
      context.json(res, 200, { success: true, data: { chat, archived, sessionsRestored: restored } });
    } catch (error) {
      fail(res, context, error);
    }
    return true;
  }

  match = url.pathname.match(ONE);
  if (match && req.method === "GET") {
    try {
      const chat = await store.get(memberIdFrom(match), chatIdFrom(match));
      if (!chat) throw Object.assign(new Error("that chat is no longer here"), { status: 404 });
      context.json(res, 200, { success: true, data: chat });
    } catch (error) {
      fail(res, context, error);
    }
    return true;
  }
  if (match && req.method === "DELETE") {
    try {
      const removed = await store.remove(memberIdFrom(match), chatIdFrom(match));
      context.json(res, 200, { success: true, data: { removed } });
    } catch (error) {
      fail(res, context, error);
    }
    return true;
  }

  match = url.pathname.match(LIST);
  if (match && req.method === "GET") {
    try {
      context.json(res, 200, { success: true, data: { chats: await store.list(memberIdFrom(match)) } });
    } catch (error) {
      fail(res, context, error);
    }
    return true;
  }
  if (match && req.method === "POST") {
    try {
      const memberId = memberIdFrom(match);
      const body = await context.readBody(req);
      context.json(res, 201, { success: true, data: await archive(context, memberId, body) });
    } catch (error) {
      fail(res, context, error);
    }
    return true;
  }
  return false;
}
