// The Squad API Worker in Miniflare for the desktop's profile check
// (scripts/check-cloud-profiles.mjs, ADR-0280): it trusts one fixture
// identity, the owner the isolated bridge signed in with.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export async function startProfilesWorker({ port, issuer, ownerId }) {
  const bundle = await build({ entryPoints: [join(root, "src/index.ts")], bundle: true, write: false, format: "esm", platform: "browser", target: "es2024", external: ["cloudflare:workers"] });
  const worker = new Miniflare(convertV4MiniflareOptions({ host: "127.0.0.1", port, workers: [{ name: "squad-api", modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-10-27",
    d1Databases: ["DB"], r2Buckets: ["MEMORY", "RELEASES"], bindings: { IDENTITY_ORIGIN: issuer, WEB_ORIGIN: "http://127.0.0.1:5173", RELEASE_PUBLISHER_TOKEN: "unused-local-release-publisher-credential" },
    outboundService: "identity" }, { name: "identity", modules: true, compatibilityDate: "2026-10-27", script: `export default { async fetch(request) {
      if (!/^Bearer fixture/.test(request.headers.get('authorization') || '')) return Response.json({success:false},{status:401});
      return Response.json({success:true,profile:{id:${JSON.stringify(ownerId)},email:'reliability@example.test',name:'Reliability fixture',status:'active'}});
    }};` }] }));
  await worker.ready;
  const db = await worker.getD1Database("DB", "squad-api");
  for (const name of (await readdir(join(root, "migrations"))).filter(name => name.endsWith(".sql")).sort()) {
    const sql = await readFile(join(root, "migrations", name), "utf8");
    await db.batch(sql.split(";").filter(part => part.replace(/--.*$/gm, "").trim()).map(part => db.prepare(part)));
  }
  return worker;
}
