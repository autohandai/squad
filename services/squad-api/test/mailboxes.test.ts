// Agent email (ADR-0262): only @autohand.ai accounts register addresses; mail
// for an address is kept for its owner, refused for unknown or revoked ones,
// and collected once.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { localPartFrom, receiveAgentMail, validLocalPart } from "../src/mailboxes.ts";

let runtime: Miniflare, alice = "", bob = "";
const apiName = "squad-mail-test";
async function call(path: string, method = "GET", value?: unknown, session = alice) {
  const response = await runtime.dispatchFetch(`https://squad.example.test${path}`, {
    method, headers: { ...(session ? { authorization: `Bearer ${session}`, "x-autohand-identity": session === bob ? "identity-bob" : "identity-alice" } : {}), ...(value === undefined ? {} : { "content-type": "application/json" }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  return { status: response.status, json: await response.json<any>() };
}
const env = async () => ({ DB: await runtime.getD1Database("DB", apiName), MAIL_DOMAIN: "code.autohandai.com", MAIL_ACCOUNT_DOMAINS: "autohand.ai" } as any);
const mail = (to: string, subject: string, body: string, from = "Ana Lima <ana@customer.example>") =>
  new TextEncoder().encode(`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <${Math.random()}@customer.example>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`).buffer;

before(async () => {
  const bundle = await build({ entryPoints: ["src/index.ts"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2024", external: ["cloudflare:workers"] });
  runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: apiName, modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-10-27", d1Databases: ["DB", "MARKETPLACE"], r2Buckets: ["MEMORY", "RELEASES"],
    durableObjects: { MOBILE_RELAYS: { className: "MobileRelay", useSQLite: true } },
    bindings: { IDENTITY_ORIGIN: "https://api.autohand.ai", WEB_ORIGIN: "https://squad.example.test", RELEASE_PUBLISHER_TOKEN: "fixture", MAIL_DOMAIN: "code.autohandai.com", MAIL_ACCOUNT_DOMAINS: "autohand.ai", MAIL_RESERVED: "igor,noah" },
    outboundService: "mail-identity-fixture",
  }, { name: "mail-identity-fixture", modules: true, compatibilityDate: "2026-10-27", script: `export default {fetch(request) {
    const who=request.headers.get('authorization')?.replace('Bearer identity-','');
    if(!['alice','bob'].includes(who))return Response.json({success:false},{status:401});
    return Response.json({success:true,profile:{id:who,email:who==='alice'?'igor@autohand.ai':'bob@example.test',name:who,status:'active'}});
  }}` }] }));
  const db = await runtime.getD1Database("DB", apiName);
  for (const name of (await readdir("migrations")).filter(name => name.endsWith(".sql")).sort()) {
    const migration = await readFile(`migrations/${name}`, "utf8");
    await db.batch(migration.split(";").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
  }
  alice = (await call("/v1/auth/exchange", "POST", { identityToken: "identity-alice", deviceName: "Alice" }, "")).json.data.token;
  bob = (await call("/v1/auth/exchange", "POST", { identityToken: "identity-bob", deviceName: "Bob" }, "")).json.data.token;
});
after(async () => { await runtime?.dispose(); });

test("addresses come from names and avoid reserved ones", () => {
  assert.equal(localPartFrom("Thiago Álvarez"), "thiago.alvarez");
  assert.equal(localPartFrom("  Chief of Staff! "), "chief.of.staff");
  assert.equal(localPartFrom("X"), "");
  assert.equal(validLocalPart("postmaster"), false);
  assert.equal(validLocalPart("thiago"), true);
  assert.equal(validLocalPart("igor", { MAIL_RESERVED: "noah, igor" } as any), false, "an address another worker routes is never handed out");
  assert.equal(validLocalPart("-bad"), false);
});

test("only accounts on autohand.ai can give members addresses", async () => {
  const outside = await call("/v1/mailboxes", "GET", undefined, bob);
  assert.equal(outside.json.data.allowed, false);
  const refused = await call("/v1/mailboxes", "POST", { memberId: "m-bob", memberName: "Bobby" }, bob);
  assert.equal(refused.status, 403); assert.equal(refused.json.error.code, "mail_not_enabled");
  assert.equal((await call("/v1/mailboxes")).json.data.allowed, true);
});

test("register, suggest the next free address, deliver once, revoke", async () => {
  assert.equal((await call("/v1/mailboxes/suggest?name=Thiago")).json.data.address, "thiago@code.autohandai.com");
  const created = await call("/v1/mailboxes", "POST", { memberId: "m-thiago", memberName: "Thiago" });
  assert.equal(created.status, 201); assert.equal(created.json.data.mailbox.address, "thiago@code.autohandai.com");
  const again = await call("/v1/mailboxes", "POST", { memberId: "m-thiago", memberName: "Thiago" });
  assert.equal(again.json.data.created, false, "one address per member");
  assert.equal((await call("/v1/mailboxes/suggest?name=Thiago")).json.data.address, "thiago2@code.autohandai.com");
  assert.equal((await call("/v1/mailboxes/suggest?name=Igor")).json.data.address, "igor2@code.autohandai.com", "igor@ belongs to another worker");
  const reserved = await call("/v1/mailboxes", "POST", { memberId: "m-x", memberName: "X", localPart: "postmaster" });
  assert.equal(reserved.status, 400);

  const stored = await receiveAgentMail(await env(), { to: "thiago+invoices@code.autohandai.com", from: "ana@customer.example", raw: mail("thiago@code.autohandai.com", "Renewal question", "Can we move the renewal to March?") });
  assert.equal(stored.stored, true, JSON.stringify(stored));
  const unknown = await receiveAgentMail(await env(), { to: "nobody@code.autohandai.com", from: "x@y.z", raw: mail("nobody@code.autohandai.com", "hi", "hi") });
  assert.deepEqual(unknown, { stored: false, reason: "No agent has this address." });
  const elsewhere = await receiveAgentMail(await env(), { to: "thiago@other.example", from: "x@y.z", raw: mail("thiago@other.example", "hi", "hi") });
  assert.equal(elsewhere.stored, false);

  const pending = (await call("/v1/mail/pending")).json.data.messages;
  assert.equal(pending.length, 1);
  assert.deepEqual([pending[0].memberId, pending[0].from, pending[0].fromName, pending[0].subject], ["m-thiago", "ana@customer.example", "Ana Lima", "Renewal question"]);
  assert.match(pending[0].text, /move the renewal to March/);
  assert.equal((await call("/v1/mail/pending", "GET", undefined, bob)).status, 403, "another account sees nothing");
  await call(`/v1/mail/${pending[0].id}/delivered`, "POST", {});
  assert.equal((await call("/v1/mail/pending")).json.data.messages.length, 0, "collected once");

  assert.equal((await call("/v1/mailboxes/thiago", "DELETE")).status, 200);
  const afterRevoke = await receiveAgentMail(await env(), { to: "thiago@code.autohandai.com", from: "x@y.z", raw: mail("thiago@code.autohandai.com", "hi", "hi") });
  assert.equal(afterRevoke.stored, false, "a revoked address bounces");
});

test("html-only mail becomes readable text", async () => {
  await call("/v1/mailboxes", "POST", { memberId: "m-ana", memberName: "Ana" });
  const raw = new TextEncoder().encode(`From: a@b.example\r\nTo: ana@code.autohandai.com\r\nSubject: Report\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello <b>Ana</b></p><script>x()</script><p>Numbers attached.</p>\r\n`).buffer;
  assert.equal((await receiveAgentMail(await env(), { to: "ana@code.autohandai.com", from: "a@b.example", raw })).stored, true);
  const message = (await call("/v1/mail/pending")).json.data.messages.find((item: any) => item.memberId === "m-ana");
  assert.match(message.text, /Hello Ana/); assert.doesNotMatch(message.text, /x\(\)|<p>/);
});

test("marketplace routes are not found until the marketplace database is bound", async () => {
  const { publicMarketplaceRoutes, publisherMarketplaceRoutes, cleanMarketplace } = await import("../src/marketplace.ts");
  const bare = {} as any;
  await assert.rejects(publicMarketplaceRoutes(new Request("https://x/v1/marketplace/home"), bare, new URL("https://x/v1/marketplace/home")), (error: any) => error.status === 404);
  await assert.rejects(publisherMarketplaceRoutes(new Request("https://x/v1/marketplace/mine"), bare, { id: "u" } as any, new URL("https://x/v1/marketplace/mine")), (error: any) => error.status === 404);
  await cleanMarketplace(bare);
});
