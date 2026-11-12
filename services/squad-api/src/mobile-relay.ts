import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import type { Env } from "./env.js";
import type { Principal } from "./auth.js";
import { ApiError, body, digest, ok, requireValue, token } from "./http.js";
import { accessOwner } from "./owners.js";
import { verifyIdentity } from "./auth.js";

const registrationSchema = z.object({
  computerID: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), actorID: z.string().min(1).max(256),
  ownerScope: z.string().regex(/^[a-f0-9]{64}$/), teamID: z.string().min(1).max(256).optional(),
}).strict();
type RelayScope = { roomID: string; principalID: string; ownerKey: string; computerID: string; teamID: string | null };
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const packetSchema = z.object({ version: z.literal(1), kind: z.enum(["pair", "device"]), computerID: identifier, peerID: identifier, requestID: identifier, sealed: z.string().min(40).max(2_800_000) }).strict();
type Packet = z.infer<typeof packetSchema>;
type ForwardResult = { status: number; packet?: Packet };
type ControlResult<T> = { success: true; data: T } | { success: false; status: number; code: string; message: string };
const failure = (status: number, code: string, message: string): ControlResult<never> => ({ success: false, status, code, message });
function accepted<T>(result: ControlResult<T>): T {
  if (!result.success) throw new ApiError(result.status, result.code, result.message);
  return result.data;
}
type CapabilityRow = { hash: string; pairing_id: string; device_id: string | null; expires_at: number };
interface Pending { host: WebSocket; packet: Packet; resolve: (result: ForwardResult) => void; timer: ReturnType<typeof setTimeout> }
const hostAttachment = z.object({ leaseUntil: z.number(), connectedAt: z.number() });

/** One actor/owner/dataset/computer route. Encryption keys stay on the devices. */
export class MobileRelay extends DurableObject<Env> {
  private pending = new Map<string, Pending>();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS scope (id INTEGER PRIMARY KEY CHECK(id=1), roomID TEXT NOT NULL, principalID TEXT NOT NULL, ownerKey TEXT NOT NULL, computerID TEXT NOT NULL, teamID TEXT)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS capabilities (hash TEXT PRIMARY KEY, pairing_id TEXT NOT NULL UNIQUE, device_id TEXT, expires_at INTEGER NOT NULL)");
  }
  configure(scope: RelayScope): ControlResult<{ roomID: string }> {
    const saved = this.ctx.storage.sql.exec<RelayScope>("SELECT roomID,principalID,ownerKey,computerID,teamID FROM scope WHERE id=1").toArray()[0];
    if (saved && (saved.roomID !== scope.roomID || saved.principalID !== scope.principalID || saved.ownerKey !== scope.ownerKey
      || saved.computerID !== scope.computerID || saved.teamID !== scope.teamID)) return failure(409, "relay_scope_changed", "This relay belongs to a different computer context.");
    if (!saved) this.ctx.storage.sql.exec("INSERT INTO scope(id,roomID,principalID,ownerKey,computerID,teamID) VALUES (1,?,?,?,?,?)", scope.roomID, scope.principalID, scope.ownerKey, scope.computerID, scope.teamID);
    return { success: true, data: { roomID: scope.roomID } };
  }
  saveOffer(pairingID: string, hash: string, expiresAt: number): ControlResult<{ saved: true }> {
    if (expiresAt <= Date.now() / 1000 || expiresAt > Date.now() / 1000 + 610) return failure(400, "offer_expired", "Generate a new pairing code.");
    this.ctx.storage.sql.exec("DELETE FROM capabilities WHERE device_id IS NULL");
    this.ctx.storage.sql.exec("INSERT INTO capabilities(hash,pairing_id,device_id,expires_at) VALUES (?,?,NULL,?)", hash, pairingID, expiresAt * 1000);
    return { success: true, data: { saved: true } };
  }
  approve(pairingID: string, deviceID: string): ControlResult<{ approved: true }> {
    const row = this.ctx.storage.sql.exec<CapabilityRow>("SELECT * FROM capabilities WHERE pairing_id=?", pairingID).toArray()[0];
    if (!row || row.expires_at <= Date.now()) return failure(400, "offer_expired", "Generate a new pairing code.");
    if (row.device_id && row.device_id !== deviceID) return failure(409, "claim_changed", "This pairing code already belongs to another phone.");
    if (!row.device_id && this.ctx.storage.sql.exec<{ total: number }>("SELECT COUNT(*) AS total FROM capabilities WHERE device_id IS NOT NULL").one().total >= 20) return failure(409, "device_limit", "Disconnect a phone before pairing another one.");
    this.ctx.storage.sql.exec("UPDATE capabilities SET device_id=? WHERE pairing_id=?", deviceID, pairingID);
    return { success: true, data: { approved: true } };
  }
  revoke(deviceID: string): { removed: true } {
    this.ctx.storage.sql.exec("DELETE FROM capabilities WHERE device_id=?", deviceID);
    return { removed: true };
  }
  synchronize(deviceIDs: string[]): { synchronized: true } {
    if (!deviceIDs.length) this.ctx.storage.sql.exec("DELETE FROM capabilities WHERE device_id IS NOT NULL");
    else this.ctx.storage.sql.exec(`DELETE FROM capabilities WHERE device_id IS NOT NULL AND device_id NOT IN (${deviceIDs.map(() => "?").join(",")})`, ...deviceIDs);
    return { synchronized: true };
  }
  renew(): { renewed: boolean; leaseUntil: number } {
    const socket = this.ctx.getWebSockets("host").find(socket => socket.readyState === WebSocket.OPEN);
    if (!socket) return { renewed: false, leaseUntil: 0 };
    const current = hostAttachment.parse(socket.deserializeAttachment()), leaseUntil = Date.now() + 10 * 60_000;
    socket.serializeAttachment({ ...current, leaseUntil });
    return { renewed: true, leaseUntil };
  }
  private finish(id: string, result: ForwardResult): void {
    const pending = this.pending.get(id); if (!pending) return;
    this.pending.delete(id); clearTimeout(pending.timer); pending.resolve(result);
  }
  private host(): WebSocket | undefined {
    return this.ctx.getWebSockets("host").find(socket => {
      const attachment = hostAttachment.safeParse(socket.deserializeAttachment());
      return socket.readyState === WebSocket.OPEN && attachment.success && attachment.data.leaseUntil > Date.now();
    });
  }
  async forward(hash: string, packet: Packet): Promise<ForwardResult> {
    const row = this.ctx.storage.sql.exec<CapabilityRow>("SELECT * FROM capabilities WHERE hash=?", hash).toArray()[0];
    const scope = this.ctx.storage.sql.exec<{ computerID: string }>("SELECT computerID FROM scope WHERE id=1").toArray()[0];
    if (!row || !scope || scope.computerID !== packet.computerID) return { status: 403 };
    const authorized = packet.kind === "pair" ? row.pairing_id === packet.peerID && row.expires_at > Date.now() : row.device_id === packet.peerID;
    if (!authorized) return { status: 403 };
    const host = this.host(); if (!host) return { status: 503 };
    if (this.pending.size >= 16) return { status: 429 };
    const id = crypto.randomUUID(), { promise, resolve } = Promise.withResolvers<ForwardResult>();
    const timer = setTimeout(() => this.finish(id, { status: 504 }), 25_000);
    this.pending.set(id, { host, packet, timer, resolve });
    try { host.send(JSON.stringify({ type: "packet", id, packet })); }
    catch { this.finish(id, { status: 503 }); }
    return promise;
  }
  async fetch(request: Request): Promise<Response> {
    // Only the authenticated Worker control route can reach this upgrade.
    if (request.headers.get("upgrade") !== "websocket") return new Response("WebSocket required.", { status: 426 });
    for (const socket of this.ctx.getWebSockets("host")) {
      for (const [id, pending] of this.pending) if (pending.host === socket) this.finish(id, { status: 503 });
      socket.close(1000, "Computer reconnected.");
    }
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server, ["host"]);
    const leaseUntil = Date.now() + 10 * 60_000;
    server.serializeAttachment({ leaseUntil, connectedAt: Date.now() });
    const scope = this.ctx.storage.sql.exec<{ computerID: string }>("SELECT computerID FROM scope WHERE id=1").one();
    server.send(JSON.stringify({ type: "relay.ready", protocolVersion: 1, computerID: scope.computerID, leaseUntil }));
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(socket: WebSocket, input: string | ArrayBuffer): void {
    try {
      if (typeof input !== "string" || new TextEncoder().encode(input).byteLength > 3 * 1024 * 1024) { socket.close(1009, "Invalid relay response."); return; }
      const message = z.discriminatedUnion("type", [
        z.object({ type: z.literal("packet.reply"), id: z.uuid(), packet: packetSchema }).strict(),
        z.object({ type: z.literal("packet.error"), id: z.uuid(), status: z.union([z.literal(400), z.literal(401), z.literal(403), z.literal(409), z.literal(429), z.literal(503)]) }).strict(),
      ]).parse(JSON.parse(input));
      const pending = this.pending.get(message.id);
      if (!pending || pending.host !== socket) return;
      if (message.type === "packet.error") { this.finish(message.id, { status: message.status }); return; }
      if (message.packet.computerID !== pending.packet.computerID || message.packet.peerID !== pending.packet.peerID
        || message.packet.requestID !== pending.packet.requestID || message.packet.kind !== pending.packet.kind) { this.finish(message.id, { status: 502 }); return; }
      this.finish(message.id, { status: 200, packet: message.packet });
    } catch { socket.close(1008, "Invalid relay response."); }
  }
  webSocketClose(socket: WebSocket): void {
    for (const [id, pending] of this.pending) if (pending.host === socket) this.finish(id, { status: 503 });
  }
  webSocketError(socket: WebSocket): void { this.webSocketClose(socket); }
}

export async function publicMobileRelay(request: Request, env: Env, url: URL, ctx: ExecutionContext): Promise<Response | null> {
  const match = url.pathname.match(/^\/mobile\/([a-f0-9]{64})\/v1\/mobile$/);
  if (!match || request.method !== "POST") return null;
  requireValue(!request.headers.has("origin"), 403, "native_required", "Use the native phone connection.");
  const input = await body(request, z.object({ relayToken: z.string().regex(/^[a-f0-9]{64}$/), packet: packetSchema }).strict());
  // An untrusted URL cannot allocate a persistent object for a guessed route.
  const registered = await env.DB.prepare("SELECT id FROM mobile_relay_routes WHERE id=?").bind(match[1]).first();
  requireValue(registered, 403, "relay_unavailable", "The encrypted request could not be accepted.");
  const result = await ctx.exports.MobileRelay.getByName(match[1]).forward(await digest(input.relayToken), input.packet);
  return Response.json(result.packet || { error: "The computer could not accept this request. Reconnect and try again." }, { status: result.status, headers: { "cache-control": "no-store" } });
}

interface RouteRow { id: string; principal_id: string; owner_key: string; computer_id: string; team_id: string | null }
async function currentIdentity(request: Request, env: Env, user: Principal): Promise<void> {
  const identity = request.headers.get("x-autohand-identity");
  requireValue(identity, 401, "identity_required", "Present the computer's current Autohand credential.");
  const profile = await verifyIdentity(identity, env);
  requireValue(profile.id === user.subject && user.issuer === new URL(env.IDENTITY_ORIGIN).origin, 401, "identity_mismatch", "The account on this computer changed.");
}

export async function mobileRelayRoutes(request: Request, env: Env, user: Principal, url: URL, ctx: ExecutionContext): Promise<Response | null> {
  if (url.pathname !== "/v1/mobile-relays" && !url.pathname.startsWith("/v1/mobile-relays/")) return null;
  await currentIdentity(request, env, user);
  if (url.pathname === "/v1/mobile-relays" && request.method === "POST") {
    const input = await body(request, registrationSchema);
    requireValue(input.actorID === user.subject, 403, "relay_actor_mismatch", "The computer must use its current signed-in account.");
    const access = await accessOwner(request, env, user, input.teamID, true);
    const roomID = await digest(JSON.stringify([user.id, access.key, input.ownerScope, input.computerID]));
    const room = ctx.exports.MobileRelay.getByName(roomID);
    accepted(await room.configure({ roomID, principalID: user.id, ownerKey: access.key, computerID: input.computerID, teamID: input.teamID || null }));
    await env.DB.prepare(`INSERT INTO mobile_relay_routes(id,principal_id,owner_key,computer_id,team_id,last_seen_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at`).bind(roomID, user.id, access.key, input.computerID, input.teamID || null, new Date().toISOString()).run();
    return ok({ roomID }, 201);
  }
  const match = url.pathname.match(/^\/v1\/mobile-relays\/([a-f0-9]{64})(.*)$/); if (!match) return null;
  const row = await env.DB.prepare("SELECT * FROM mobile_relay_routes WHERE id=? AND principal_id=?").bind(match[1], user.id).first<RouteRow>();
  requireValue(row, 404, "relay_not_found", "Computer relay not found.");
  const access = await accessOwner(request, env, user, row.team_id || undefined, true);
  requireValue(access.key === row.owner_key, 404, "relay_not_found", "Computer relay not found.");
  const room = ctx.exports.MobileRelay.getByName(row.id), path = match[2];
  if (path === "/host" && request.method === "GET") return room.fetch(new Request("https://relay.internal/host", { headers: { upgrade: request.headers.get("upgrade") || "" } }));
  if (path === "/lease" && request.method === "POST") return ok(await room.renew());
  if (path === "/devices/sync" && request.method === "POST") {
    const input = await body(request, z.object({ deviceIDs: z.array(z.uuid()).max(20) }).strict());
    return ok(await room.synchronize(input.deviceIDs));
  }
  if (path === "/offers" && request.method === "POST") {
    const input = await body(request, z.object({ pairingID: z.uuid(), expiresAt: z.number().finite() }).strict());
    const relayToken = token("");
    accepted(await room.saveOffer(input.pairingID, await digest(relayToken), input.expiresAt));
    return ok({ relayToken, endpoint: `${url.origin}/mobile/${row.id}` }, 201);
  }
  const approval = path.match(/^\/offers\/([a-f0-9-]{36})\/approve$/);
  if (approval && request.method === "POST") {
    const input = await body(request, z.object({ deviceID: z.uuid() }).strict());
    return ok(accepted(await room.approve(approval[1], input.deviceID)));
  }
  const device = path.match(/^\/devices\/([a-f0-9-]{36})$/);
  if (device && request.method === "DELETE") return ok(await room.revoke(device[1]));
  return null;
}
