import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { z } from "zod";
import { createMobileService } from "../../../server/mobile/service.mjs";
import { openPacket, sealPacket } from "../../../server/mobile/protocol.mjs";
import { createMobileRelay } from "../../../server/mobile/relay.mjs";
import { pairingURL } from "../../../server/mobile/protocol.mjs";
import { startMobileFixture } from "../../../scripts/lib/mobile-fixture.mjs";

let runtime: Miniflare, alice = "", bob = "";
const apiName = "squad-mobile-relay-test";
const registration = { computerID: "fixture-computer", actorID: "alice", ownerScope: "a".repeat(64) };
async function call(path: string, method = "GET", value?: unknown, session = alice) {
  const response = await runtime.dispatchFetch(`https://squad.example.test${path}`, {
    method, headers: { ...(session ? { authorization: `Bearer ${session}`, "x-autohand-identity": session === bob ? "identity-bob" : "identity-alice" } : {}), ...(value === undefined ? {} : { "content-type": "application/json" }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  return { status: response.status, json: await response.json<{ success: boolean; data: { token: string; roomID: string; relayToken: string; endpoint: string }; error?: { code: string } }>() };
}

before(async () => {
  const bundle = await build({ entryPoints: ["src/index.ts"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2024", external: ["cloudflare:workers"] });
  runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: apiName, modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-10-27", d1Databases: ["DB"], r2Buckets: ["MEMORY", "RELEASES"],
    durableObjects: { MOBILE_RELAYS: { className: "MobileRelay", useSQLite: true } },
    bindings: { IDENTITY_ORIGIN: "https://api.autohand.ai", WEB_ORIGIN: "https://squad.example.test", RELEASE_PUBLISHER_TOKEN: "fixture-not-for-relay-authority" },
    outboundService: "relay-identity-fixture",
  }, { name: "relay-identity-fixture", modules: true, compatibilityDate: "2026-10-27", script: `export default {fetch(request) {
    const value=request.headers.get('authorization');
    const who=value==='Bearer fixture-only-no-provider'?'fixture-owner':value?.replace('Bearer identity-','');
    if(!['alice','bob','fixture-owner'].includes(who))return Response.json({success:false},{status:401});
    return Response.json({success:true,profile:{id:who,email:who+'@example.test',name:who,status:'active'}});
  }}` }] }));
  const db = await runtime.getD1Database("DB", apiName);
  for (const name of (await readdir("migrations")).filter(name => name.endsWith(".sql")).sort()) {
    const migration = await readFile(`migrations/${name}`, "utf8");
    await db.batch(migration.split(";").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
  }
  alice = (await call("/v1/auth/exchange", "POST", { identityToken: "identity-alice", deviceName: "Alice computer" }, "")).json.data.token;
  bob = (await call("/v1/auth/exchange", "POST", { identityToken: "identity-bob", deviceName: "Bob computer" }, "")).json.data.token;
});

test("the desktop relay setting dispatches phone work to the canonical queue", async () => {
  const fixture = await startMobileFixture({ relayApiUrl: (await runtime.ready).origin });
  let approval: ReturnType<typeof setInterval> | undefined;
  let approvalFailure: unknown;
  let probe: ReturnType<typeof spawn> | undefined;
  try {
    const configured = await fixture.bridge.api('/api/mobile/config', 'PUT', { enabled: true, mode: 'relay', endpoint: '', port: 0 });
    assert.equal(configured.success, true, configured.error);
    assert.equal(configured.data.listening, true, configured.data.error);
    const offered = await fixture.bridge.api('/api/mobile/pair', 'POST'); assert.equal(offered.success, true, offered.error);
    const link = new URL(offered.data.link), offer = JSON.parse(Buffer.from(link.searchParams.get('data')!, 'base64url').toString());
    assert.equal(pairingURL(offer), offered.data.link);
    if (process.env.SQUAD_MOBILE_PROJECT) {
      const file = join(fixture.bridge.directory, 'relay-offer.txt');
      await writeFile(file, offered.data.link, { mode: 0o600 });
      let approving = false;
      approval = setInterval(() => {
        if (approving) return;
        approving = true;
        void (async () => {
          try {
            const code = await readFile(file + '.approve', 'utf8'), pending = (await fixture.bridge.api('/api/mobile/status')).data.pending;
            if (pending) {
              assert.equal(code, pending.code, 'Swift and the actual computer must display the same code');
              const result = await fixture.bridge.api('/api/mobile/approve', 'POST', { pairingID: pending.pairingID, code });
              assert.equal(result.success, true, result.error);
            }
          } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
        })().finally(() => { approving = false; }).catch(error => { approvalFailure = error; probe?.kill('SIGTERM'); });
      }, 50);
      const child = probe = spawn('swift', ['run', '--package-path', process.env.SQUAD_MOBILE_PROJECT, 'SquadMobileProbe', file], { stdio: 'inherit' });
      const deadline = setTimeout(() => child.kill('SIGTERM'), 120_000);
      try {
        const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
        if (approvalFailure) throw approvalFailure;
        assert.equal(code, 0, 'the actual Swift relay client must pass');
      }
      finally { clearTimeout(deadline); }
    } else {
      const key = randomBytes(32), deviceID = randomUUID();
      const send = async (command: string, parameters: Record<string, unknown> = {}, pair = false) => {
        const secret = pair ? Buffer.from(offer.secret, 'base64') : key;
        const packet = sealPacket({ issuedAt: Date.now() / 1000, command, parameters }, secret, { kind: pair ? 'pair' : 'device', computerID: offer.computerID, peerID: pair ? offer.pairingID : deviceID, requestID: randomUUID() }, 'request');
        const response = await fetch(offer.endpoint + '/v1/mobile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ relayToken: offer.relayToken, packet }) });
        assert.equal(response.status, 200); return openPacket(await response.json(), secret, 'response');
      };
      assert.equal((await send('pair.claim', { deviceID, deviceName: 'Queue phone', deviceKey: key.toString('base64') }, true)).data.state, 'pending');
      const pending = (await fixture.bridge.api('/api/mobile/status')).data.pending;
      assert.equal((await fixture.bridge.api('/api/mobile/approve', 'POST', { pairingID: pending.pairingID, code: pending.code })).success, true);
      const sent = await send('message', { memberID: fixture.member.id, text: 'Relay canonical queue' });
      assert.equal(sent.ok, true, sent.error);
      assert.equal((await send('device.disconnect')).data.removed, true);
    }
    const queue = (await fixture.bridge.api(`/api/queues/${fixture.member.id}`)).data;
    assert.equal(queue.items.length, 1);
    const deadline = Date.now() + 10_000;
    while ((await fixture.bridge.api(`/api/queues/${fixture.member.id}`)).data.items[0].status !== 'done') {
      if (Date.now() > deadline) throw Error('The actual relay queue did not finish.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal((await readFile(fixture.counter, 'utf8')).trim().split('\n').length, 1);
    assert.equal((await fixture.bridge.api('/api/mobile/status')).data.devices.length, 0);
  } finally { clearInterval(approval); if (probe && probe.exitCode === null && probe.signalCode === null) probe.kill('SIGTERM'); await fixture.bridge.close(); }
});

test("a phone first approved on the local network reaches the same computer through the relay without a new QR", async () => {
  const fixture = await startMobileFixture({ relayApiUrl: (await runtime.ready).origin });
  try {
    // Today's 0.1 situation: paired while the computer listened locally only.
    const local = await fixture.bridge.api('/api/mobile/config', 'PUT', { enabled: true, local: true, relay: false, tunnel: false, endpoint: '', port: 0 });
    assert.equal(local.success, true, local.error);
    const port = Number(new URL(local.data.routes.find((route: { kind: string }) => route.kind === 'local').endpoint).port);
    const offered = await fixture.bridge.api('/api/mobile/pair', 'POST'); assert.equal(offered.success, true, offered.error);
    const offer = JSON.parse(Buffer.from(new URL(offered.data.link).searchParams.get('data')!, 'base64url').toString());
    assert.equal(offer.relayToken, undefined, 'a local-only offer carries no relay capability');
    const key = randomBytes(32), deviceID = randomUUID();
    const seal = (command: string, parameters: Record<string, unknown>, pair: boolean, requestID = randomUUID()) => sealPacket({ issuedAt: Date.now() / 1000, command, parameters }, pair ? Buffer.from(offer.secret, 'base64') : key,
      { kind: pair ? 'pair' : 'device', computerID: offer.computerID, peerID: pair ? offer.pairingID : deviceID, requestID }, 'request');
    const direct = async (command: string, parameters: Record<string, unknown> = {}, pair = false) => {
      const response = await fetch(`http://127.0.0.1:${port}/v1/mobile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(seal(command, parameters, pair)) });
      assert.equal(response.status, 200); return openPacket(await response.json(), pair ? Buffer.from(offer.secret, 'base64') : key, 'response');
    };
    const relayed = (endpoint: string, relayToken: string, packet: unknown) => fetch(endpoint + '/v1/mobile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ relayToken, packet }) });
    assert.equal((await direct('pair.claim', { deviceID, deviceName: 'Wi-Fi phone', deviceKey: key.toString('base64') }, true)).data.state, 'pending');
    const pending = (await fixture.bridge.api('/api/mobile/status')).data.pending;
    assert.equal((await fixture.bridge.api('/api/mobile/approve', 'POST', { pairingID: pending.pairingID, code: pending.code })).success, true);
    assert.deepEqual((await direct('snapshot')).data.routes.map((route: { kind: string }) => route.kind), ['local'], 'only routes that exist are advertised');

    // The owner turns the relay on beside the local listener: no new QR.
    const both = await fixture.bridge.api('/api/mobile/config', 'PUT', { enabled: true, local: true, relay: true, tunnel: false, endpoint: '', port });
    assert.equal(both.success, true, both.error);
    assert.deepEqual(both.data.routes.map((route: { kind: string; connected: boolean }) => [route.kind, route.connected]), [['local', true], ['relay', true]]);
    let routes: { kind: string; endpoint: string; relayToken?: string }[] = [];
    const deadline = Date.now() + 10_000;
    while (!(routes = (await direct('snapshot')).data.routes).find(route => route.kind === 'relay')?.relayToken) {
      assert.ok(Date.now() < deadline, 'the relay grant reaches the phone in its encrypted snapshot');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const relay = routes.find(route => route.kind === 'relay')!;
    assert.match(relay.endpoint, /\/mobile\/[a-f0-9]{64}$/); assert.match(relay.relayToken!, /^[a-f0-9]{64}$/);
    const away = await relayed(relay.endpoint, relay.relayToken!, seal('message', { memberID: fixture.member.id, text: 'Sent from away' }, false));
    assert.equal(away.status, 200, 'the locally approved phone is accepted through the relay');
    assert.equal(openPacket(await away.json(), key, 'response').ok, true);
    assert.equal((await relayed(relay.endpoint, '0'.repeat(64), seal('snapshot', {}, false))).status, 403, 'only the granted capability routes');

    // A relay restart keeps the same grant: no churn of what the phone holds.
    await fixture.bridge.api('/api/mobile/config', 'PUT', { enabled: true, local: true, relay: true, tunnel: false, endpoint: '', port });
    const again = (await direct('snapshot')).data.routes.find((route: { kind: string }) => route.kind === 'relay');
    assert.equal(again.relayToken, relay.relayToken);
    assert.equal((await relayed(relay.endpoint, relay.relayToken!, seal('snapshot', {}, false))).status, 200);

    // Local revocation also ends the granted relay route.
    const device = (await fixture.bridge.api('/api/mobile/status')).data.devices[0];
    assert.equal((await fixture.bridge.api(`/api/mobile/devices/${device.id}`, 'DELETE')).success, true);
    assert.equal((await relayed(relay.endpoint, relay.relayToken!, seal('snapshot', {}, false))).status, 403);
  } finally { await fixture.bridge.close(); }
});

test("a new QR names every route; a phone pairs on one and the relay approves the same device", async () => {
  const fixture = await startMobileFixture({ relayApiUrl: (await runtime.ready).origin });
  try {
    const both = await fixture.bridge.api('/api/mobile/config', 'PUT', { enabled: true, local: true, relay: true, tunnel: false, endpoint: '', port: 0 });
    assert.equal(both.success, true, both.error);
    const offered = await fixture.bridge.api('/api/mobile/pair', 'POST'); assert.equal(offered.success, true, offered.error);
    const offer = JSON.parse(Buffer.from(new URL(offered.data.link).searchParams.get('data')!, 'base64url').toString());
    assert.deepEqual(offer.routes.map((route: { kind: string }) => route.kind), ['local'], 'the QR adds the direct route beside its relay endpoint');
    assert.match(offer.endpoint, /\/mobile\/[a-f0-9]{64}$/, 'older phones that read only `endpoint` get the route that works away from home');
    assert.match(offer.relayToken, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(offer).includes('fixture-only-no-provider'), false, 'no account credential in the QR');
    const port = Number(new URL(offer.routes[0].endpoint).port), key = randomBytes(32), deviceID = randomUUID();
    const seal = (command: string, parameters: Record<string, unknown>, pair: boolean) => sealPacket({ issuedAt: Date.now() / 1000, command, parameters }, pair ? Buffer.from(offer.secret, 'base64') : key,
      { kind: pair ? 'pair' : 'device', computerID: offer.computerID, peerID: pair ? offer.pairingID : deviceID, requestID: randomUUID() }, 'request');
    const claim = await fetch(`http://127.0.0.1:${port}/v1/mobile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(seal('pair.claim', { deviceID, deviceName: 'Two-route phone', deviceKey: key.toString('base64') }, true)) });
    assert.equal(claim.status, 200);
    const pending = (await fixture.bridge.api('/api/mobile/status')).data.pending;
    const approved = await fixture.bridge.api('/api/mobile/approve', 'POST', { pairingID: pending.pairingID, code: pending.code });
    assert.equal(approved.success, true, approved.error);
    // The QR's relay capability was promoted for this device at approval.
    const viaQR = await fetch(offer.endpoint + '/v1/mobile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ relayToken: offer.relayToken, packet: seal('snapshot', {}, false) }) });
    assert.equal(viaQR.status, 200);
    assert.ok(openPacket(await viaQR.json(), key, 'response').data.routes.some((route: { kind: string; relayToken?: string }) => route.kind === 'relay' && route.relayToken));
  } finally { await fixture.bridge.close(); }
});

test("the Swift client paired on the local network learns the relay and sends through it", { skip: !process.env.SQUAD_MOBILE_PROJECT }, async () => {
  const fixture = await startMobileFixture({ relayApiUrl: (await runtime.ready).origin });
  let probe: ReturnType<typeof spawn> | undefined;
  try {
    const local = await fixture.bridge.api('/api/mobile/config', 'PUT', { enabled: true, local: true, relay: false, tunnel: false, endpoint: '', port: 0 });
    assert.equal(local.success, true, local.error);
    const port = Number(new URL(local.data.routes[0].endpoint).port);
    const offered = await fixture.bridge.api('/api/mobile/pair', 'POST'); assert.equal(offered.success, true, offered.error);
    const file = join(fixture.bridge.directory, 'routes-offer.txt');
    await writeFile(file, offered.data.link, { mode: 0o600 });
    const child = probe = spawn('swift', ['run', '--package-path', process.env.SQUAD_MOBILE_PROJECT!, 'SquadMobileProbe', '--routes', file], { stdio: 'inherit' });
    const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    const deadline = Date.now() + 120_000;
    let code = '';
    while (!code) {
      assert.ok(Date.now() < deadline, 'the Swift client claims the local offer');
      code = await readFile(file + '.approve', 'utf8').catch(() => '');
      if (!code) await new Promise(resolve => setTimeout(resolve, 100));
    }
    const pending = (await fixture.bridge.api('/api/mobile/status')).data.pending;
    assert.equal(code, pending.code, 'Swift and the computer display the same code');
    assert.equal((await fixture.bridge.api('/api/mobile/approve', 'POST', { pairingID: pending.pairingID, code })).success, true);
    // Only now does the owner turn on the relay, as on a computer upgraded after pairing.
    const both = await fixture.bridge.api('/api/mobile/config', 'PUT', { enabled: true, local: true, relay: true, tunnel: false, endpoint: '', port });
    assert.equal(both.success, true, both.error);
    const timer = setTimeout(() => child.kill('SIGTERM'), 120_000);
    try { assert.equal(await exited, 0, 'the actual Swift client reaches the relay with its granted route'); } finally { clearTimeout(timer); }
    assert.equal((await fixture.bridge.api(`/api/queues/${fixture.member.id}`)).data.items.length, 1);
  } finally { if (probe && probe.exitCode === null && probe.signalCode === null) probe.kill('SIGTERM'); await fixture.bridge.close(); }
});

test("an approved device's standing grant routes device packets only, within the device limit", async () => {
  const room = await call("/v1/mobile-relays", "POST", { ...registration, computerID: "grant-computer" });
  const control = `/v1/mobile-relays/${room.json.data.roomID}`;
  const grants = Array.from({ length: 21 }, () => ({ deviceID: randomUUID(), hash: randomBytes(32).toString("hex") }));
  assert.equal((await call(`${control}/devices/grants`, "POST", { grants: grants.slice(0, 20) })).status, 200);
  assert.equal((await call(`${control}/devices/grants`, "POST", { grants: grants.slice(0, 20) })).status, 200, "re-asserting the same grants is idempotent");
  assert.equal((await call(`${control}/devices/grants`, "POST", { grants: [grants[20]] })).json.error?.code, "device_limit");
  assert.equal((await call(`${control}/devices/grants`, "POST", { grants: [{ deviceID: grants[0].deviceID, hash: "A".repeat(64) }] })).status, 400);
  assert.equal((await call(`${control}/devices/grants`, "POST", { grants: grants.slice(0, 1) }, bob)).status, 404, "another actor cannot grant routes into this room");
  assert.equal((await call(`${control}/devices/sync`, "POST", { deviceIDs: [] })).status, 200);
  assert.equal((await call(`${control}/devices/grants`, "POST", { grants: [grants[20]] })).status, 200, "sync removed grants for devices the computer no longer keeps");
});

test("native iPhone UI pairs, chats and revokes through the outbound relay", { skip: !process.env.SQUAD_MOBILE_NATIVE_DEVICE || !process.env.SQUAD_MOBILE_PROJECT }, async () => {
  const child = spawn(process.execPath, [join(process.env.SQUAD_MOBILE_PROJECT!, 'Scripts/native-smoke.mjs'), fileURLToPath(new URL('../../../', import.meta.url)), process.env.SQUAD_MOBILE_NATIVE_DEVICE!], {
    stdio: 'inherit', env: { ...process.env, SQUAD_MOBILE_RELAY_API_URL: (await runtime.ready).origin },
  });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 10 * 60_000);
  try { assert.equal(await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }), 0); }
  finally { clearTimeout(timeout); if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); }
});
after(async () => { await runtime?.dispose(); });

test("relay registration is private to the current actor and owner scope", async () => {
  assert.equal((await call("/v1/mobile-relays", "POST", registration, "")).status, 401);
  const room = await call("/v1/mobile-relays", "POST", registration);
  assert.equal(room.status, 201, JSON.stringify(room.json));
  assert.match(room.json.data.roomID, /^[a-f0-9]{64}$/);
  assert.equal((await call("/v1/mobile-relays", "POST", registration)).json.data.roomID, room.json.data.roomID, "reconnect keeps this actor/owner/computer route");
  assert.equal((await call("/v1/mobile-relays", "POST", registration, bob)).status, 403, "another actor cannot register this host identity");
  const other = await call("/v1/mobile-relays", "POST", { ...registration, actorID: "bob" }, bob);
  assert.notEqual(other.json.data.roomID, room.json.data.roomID);
  const dataset = await call("/v1/mobile-relays", "POST", { ...registration, ownerScope: "b".repeat(64) });
  assert.notEqual(dataset.json.data.roomID, room.json.data.roomID, "a new owner/dataset gets an independent relay");
});

test("the relay forwards ciphertext only after approval, and revocation closes that phone route", async () => {
  const directory = await mkdtemp(join(tmpdir(), "squad-relay-phone-"));
  let executions = 0;
  const service = await createMobileService({ directory, computerName: "Ciphertext fixture", assertCurrent: async () => {}, execute: async () => ({ receipt: ++executions }) });
  let host: Awaited<ReturnType<Miniflare["dispatchFetch"]>>["webSocket"] = null;
  try {
    const room = await call("/v1/mobile-relays", "POST", { ...registration, computerID: service.computerID });
    const control = `/v1/mobile-relays/${room.json.data.roomID}`;
    const offer = await service.createOffer("http://127.0.0.1:1");
    const created = await call(`${control}/offers`, "POST", { pairingID: offer.pairingID, expiresAt: offer.expiresAt });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const { relayToken, endpoint } = created.json.data;
    assert.match(relayToken, /^[a-f0-9]{64}$/);
    const key = randomBytes(32), deviceID = randomUUID(), pairingKey = Buffer.from(offer.secret, "base64");
    const packet = (command: string, parameters: Record<string, unknown> = {}, pair = false, requestID = randomUUID()) => sealPacket({ issuedAt: Date.now() / 1000, command, parameters }, pair ? pairingKey : key,
      { kind: pair ? "pair" : "device", computerID: offer.computerID, peerID: pair ? offer.pairingID : deviceID, requestID }, "request");
    const forward = (value: unknown, token = relayToken) => runtime.dispatchFetch(endpoint + "/v1/mobile", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ relayToken: token, packet: value }),
    });
    const claim = packet("pair.claim", { deviceID, deviceName: "Fixture iPhone", deviceKey: key.toString("base64") }, true);
    assert.equal((await forward(claim, "0".repeat(64))).status, 403);
    assert.equal((await forward(claim)).status, 503, "offline host is never reported as connected");
    assert.equal((await call(`${control}/host`, "GET", undefined, bob)).status, 404);
    const upgraded = await runtime.dispatchFetch(`https://squad.example.test${control}/host`, { headers: { authorization: `Bearer ${alice}`, "x-autohand-identity": "identity-alice", upgrade: "websocket" } });
    assert.equal(upgraded.status, 101);
    host = upgraded.webSocket; assert.ok(host);
    const socket = host, errors: unknown[] = [];
    socket.addEventListener("message", event => {
      const decoded = z.object({ type: z.string() }).passthrough().parse(JSON.parse(String(event.data)));
      if (decoded.type !== "packet") return;
      const message = z.object({ type: z.literal("packet"), id: z.uuid(), packet: z.unknown() }).strict().parse(decoded);
      void service.packet(message.packet).then(response => socket.send(JSON.stringify({ type: "packet.reply", id: message.id, packet: response }))).catch(error => {
        const status = error instanceof Error && "status" in error && error.status === 401 ? 401 : 503;
        if (status !== 401) errors.push(error);
        socket.send(JSON.stringify({ type: "packet.error", id: message.id, status }));
      });
    });
    socket.accept();
    const claimed = await forward(claim);
    assert.equal(claimed.status, 200);
    assert.equal(openPacket(await claimed.json(), pairingKey, "response").data.state, "pending");
    assert.equal((await forward(packet("message", { text: "Encrypted phone work" }))).status, 403, "bootstrap capability cannot dispatch device commands");
    await service.approve(offer.pairingID, service.status().pending.code);
    assert.equal((await call(`${control}/offers/${offer.pairingID}/approve`, "POST", { deviceID })).status, 200);
    const message = packet("message", { text: "Encrypted phone work" });
    assert.equal((await forward({ ...message, sealed: "A".repeat(100) })).status, 401, "an invalid ciphertext cannot close the computer connection");
    const first = await forward(message); assert.equal(first.status, 200);
    const original = openPacket(await first.json(), key, "response");
    const retry = await forward(message); assert.equal(retry.status, 200);
    assert.deepEqual(openPacket(await retry.json(), key, "response"), original);
    assert.equal(executions, 1, "transport retries retain the computer's durable receipt");
    assert.equal((await call(`${control}/devices/${deviceID}`, "DELETE")).status, 200);
    assert.equal((await forward(message)).status, 403, "revoked routing capability cannot reach the host");
    assert.equal(executions, 1); assert.deepEqual(errors, []);
  } finally { host?.close(); await rm(directory, { recursive: true, force: true }); }
});

test("the production computer client pairs, reconnects with retained credentials and synchronizes local revocation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "squad-relay-client-"));
  const baseUrl = (await runtime.ready).origin;
  let relay: ReturnType<typeof createMobileRelay> | undefined;
  let executions = 0;
  const options = { directory, computerName: "Outbound computer", assertCurrent: async () => {}, execute: async () => ({ receipt: ++executions }),
    beforeApprove: (input: { pairingID: string; deviceID: string }) => relay?.approve(input), afterRevoke: (id: string) => relay?.revoke(id) };
  const identity = () => ({ token: "identity-alice", actorID: "alice" });
  try {
    let service = await createMobileService(options);
    const computerID = service.computerID;
    service = await createMobileService(options);
    assert.equal(service.computerID, computerID, "computer identity survives restart before its first approval");
    relay = createMobileRelay({ service, identity, ownerScope: "c".repeat(64), baseUrl });
    await relay.start(); assert.equal(relay.status().connected, true, relay.status().error);
    const offer = await service.createOffer(metadata => relay!.offer(metadata));
    assert.match(offer.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/mobile\/[a-f0-9]{64}$/);
    assert.ok(offer.relayToken); assert.equal(new URL(offer.endpoint).search, "");
    const deviceID = randomUUID(), key = randomBytes(32), pairKey = Buffer.from(offer.secret, "base64");
    const request = (command: string, parameters: Record<string, unknown> = {}, pair = false, requestID = randomUUID()) => sealPacket({ command, parameters, issuedAt: Date.now() / 1000 }, pair ? pairKey : key,
      { kind: pair ? "pair" : "device", peerID: pair ? offer.pairingID : deviceID, computerID, requestID }, "request");
    const forward = (packet: unknown) => fetch(offer.endpoint + "/v1/mobile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ relayToken: offer.relayToken, packet }) });
    const claim = await forward(request("pair.claim", { deviceID, deviceName: "Phone", deviceKey: key.toString("base64") }, true));
    assert.equal(claim.status, 200);
    assert.equal(openPacket(await claim.json(), pairKey, "response").data.state, "pending");
    await service.approve(offer.pairingID, service.status().pending.code);
    const message = request("message", { text: "Actual outbound WebSocket" });
    assert.equal((await forward(message)).status, 200);
    assert.equal(executions, 1);
    relay.close();
    service = await createMobileService(options);
    relay = createMobileRelay({ service, identity, ownerScope: "c".repeat(64), baseUrl });
    await relay.start(); assert.equal(relay.status().connected, true);
    assert.equal(relay.status().endpoint, offer.endpoint);
    assert.equal((await forward(message)).status, 200); assert.equal(executions, 1, "restart retains the same message receipt");
    relay.close(); relay = undefined;
    await service.revoke(deviceID); // Offline local revocation is durable.
    service = await createMobileService(options);
    relay = createMobileRelay({ service, identity, ownerScope: "c".repeat(64), baseUrl });
    await relay.start(); assert.equal(relay.status().connected, true);
    assert.equal((await forward(message)).status, 403, "reconnect removes cloud capabilities absent from the private local key store");
    assert.equal(executions, 1);
  } finally { relay?.close(); await rm(directory, { recursive: true, force: true }); }
});
