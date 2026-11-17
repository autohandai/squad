#!/usr/bin/env node
// A local Squad API with the marketplace, for the website and the desktop to
// develop against (ADR-0246). The Worker runs in workerd exactly as in the
// tests; D1 persists under .cloudflare/local-marketplace; migrations and the
// seeds (agents, teams, featured) are applied on start (both idempotent). The Autohand identity
// service is a fixture: `identity-<name>` signs in as <name>, the desktop
// checks' `fixture…` token as "reliability"; "alice" and "reliability" own
// the team "Kahu Studio". Nothing here reaches Cloudflare.
//
//   node scripts/local-marketplace.mjs [--port 8797]
//   AUTOHAND_SQUAD_API_URL=http://127.0.0.1:8797   (desktop bridge)
//   SQUAD_API_URL=http://127.0.0.1:8797            (website functions)
//   admin credential: local-only-marketplace-admin-credential-0000
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { allSeedStatements } from "./marketplace-seed.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const port = Number(args.includes("--port") ? args[args.indexOf("--port") + 1] : 8797);
export const LOCAL_ADMIN_TOKEN = "local-only-marketplace-admin-credential-0000";
// Website dev servers whose pages may post reports and listing events here;
// LOCAL_SITE_ORIGINS adds more, comma separated (ADR-0248).
const siteOrigins = ["https://autohand.ai", "https://www.autohand.ai", "http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:8788", ...String(process.env.LOCAL_SITE_ORIGINS || "").split(",").filter(Boolean)].join(",");

const identityFixture = `export default { async fetch(request) {
  const url = new URL(request.url);
  const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  // identity-<name> signs in as <name>; the desktop checks' fixture token as "reliability".
  const who = /^identity-[a-z]{2,20}$/.test(token) ? token.slice(9) : /^fixture[-_a-z0-9]*$/i.test(token) ? 'reliability' : '';
  if (!who) return Response.json({success:false}, {status:401});
  if (url.pathname === '/v1/profile') return Response.json({success:true,profile:{id:'identity_'+who,email:who+'@example.test',name:who[0].toUpperCase()+who.slice(1),status:'active'}});
  if (url.pathname === '/v1/accounts') return Response.json({success:true,accounts:[
    {account:{id:'personal-'+who,name:who,type:'personal',accessMode:'full',status:'active'},role:'owner',permissions:['resources:operate']},
    {account:{id:'team-kahu',name:'Kahu Studio',type:'team',accessMode:'full',status:'active'},role:['alice','reliability'].includes(who)?'owner':'contributor',permissions:['resources:operate']}
  ]});
  return Response.json({success:false},{status:404});
}};`;

async function applyMigrations(db, folder) {
  await db.exec("CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)");
  for (const name of (await readdir(join(root, folder))).filter((file) => file.endsWith(".sql")).sort()) {
    if (await db.prepare("SELECT 1 FROM local_migrations WHERE name=?").bind(`${folder}/${name}`).first()) continue;
    const sql = await readFile(join(root, folder, name), "utf8");
    await db.batch([...sql.split(";").filter((part) => part.replace(/--.*$/gm, "").trim()).map((part) => db.prepare(part)), db.prepare("INSERT INTO local_migrations(name) VALUES (?)").bind(`${folder}/${name}`)]);
  }
}

export async function startLocalMarketplace({ port: listen = port, persist = join(root, ".cloudflare", "local-marketplace"), seed = true } = {}) {
  const bundle = await build({ entryPoints: [join(root, "src/index.ts")], bundle: true, write: false, format: "esm", platform: "browser", target: "es2024", external: ["cloudflare:workers"] });
  const runtime = new Miniflare(convertV4MiniflareOptions({
    host: "127.0.0.1", port: listen, resourcePersistencePath: persist,
    workers: [{ name: "squad-api", modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-10-27",
      d1Databases: ["DB", "MARKETPLACE"], r2Buckets: ["MEMORY", "RELEASES"],
      bindings: { IDENTITY_ORIGIN: "https://api.autohand.ai", WEB_ORIGIN: "http://127.0.0.1:5173", RELEASE_PUBLISHER_TOKEN: "local-only-release-publisher-credential-000", MARKETPLACE_ADMIN_TOKEN: LOCAL_ADMIN_TOKEN, MARKETPLACE_SITE_ORIGINS: siteOrigins },
      outboundService: "identity" },
    { name: "identity", modules: true, compatibilityDate: "2026-10-27", script: identityFixture }],
  }));
  await runtime.ready;
  await applyMigrations(await runtime.getD1Database("DB", "squad-api"), "migrations");
  const market = await runtime.getD1Database("MARKETPLACE", "squad-api");
  await applyMigrations(market, "marketplace-migrations");
  const statements = seed ? await allSeedStatements() : [];
  for (let index = 0; index < statements.length; index += 40) await market.batch(statements.slice(index, index + 40).map(({ sql, params }) => market.prepare(sql).bind(...params)));
  return runtime;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runtime = await startLocalMarketplace();
  const count = await (await runtime.getD1Database("MARKETPLACE", "squad-api")).prepare("SELECT count(*) AS n FROM listings WHERE status='published'").first();
  console.log(`local Squad API with the marketplace on http://127.0.0.1:${port} (${count.n} published agents)`);
  const stop = async () => { await runtime.dispose(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
