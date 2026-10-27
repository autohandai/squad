#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { squadApiUrl } from "../server/squad-cloud/client.mjs";

export async function buildSquadRelease({ directory, version, tag = `v${version}`, channel = "stable", notes = "", releasedAt = new Date().toISOString() }) {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version) || !["stable", "nightly"].includes(channel)) throw Error("A valid release version and channel are required.");
  if (![version, `v${version}`].includes(tag)) throw Error("Publish an immutable version tag to the Squad release feed.");
  const checksums = new Map((await readFile(join(directory, "checksums.txt"), "utf8")).trim().split(/\r?\n/).map(line => { const [hash, name] = line.trim().split(/\s+/); return [name?.replace(/^\*/, ""), hash]; }));
  const assets = [];
  for (const name of (await readdir(directory)).sort()) {
    const match = name.match(/^autohand-squad-(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)-(macos|windows|linux)-(arm64|x64)(\.dmg|-setup\.exe|\.msi|\.deb|\.AppImage)$/);
    if (!match || match[1] !== version) continue;
    const hash = createHash("sha256"); for await (const chunk of createReadStream(join(directory, name))) hash.update(chunk);
    const sha256 = hash.digest("hex"); if (checksums.get(name) !== sha256) throw Error(`Published checksum does not match ${name}.`);
    assets.push({ os: match[2], arch: match[3], name, url: `https://github.com/autohandai/squad/releases/download/${tag}/${name}`, sha256, bytes: (await stat(join(directory, name))).size });
  }
  const coverage = new Set(assets.map(asset => `${asset.os}/${asset.arch}`));
  for (const target of ["macos/arm64", "macos/x64", "windows/x64", "linux/x64"]) if (!coverage.has(target)) throw Error(`Missing desktop installer for ${target}.`);
  return { schemaVersion: 1, channel, version, releasedAt, notes, releaseUrl: `https://github.com/autohandai/squad/releases/tag/${tag}`, assets };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { directory: { type: "string" }, version: { type: "string" }, tag: { type: "string" }, channel: { type: "string", default: "stable" }, notes: { type: "string" }, metadata: { type: "string" }, "released-at": { type: "string" }, out: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
  const metadata = values.metadata ? JSON.parse(await readFile(values.metadata, "utf8")) : {};
  const releasedAt = values["released-at"] || metadata.publishedAt;
  if (!releasedAt || !Number.isFinite(Date.parse(releasedAt))) throw Error("Use the immutable GitHub publishedAt timestamp so publication retries are identical.");
  const manifest = await buildSquadRelease({ directory: values.directory || "release/publish", version: values.version || "", tag: values.tag, channel: values.channel, releasedAt, notes: metadata.body || (values.notes ? await readFile(values.notes, "utf8") : "") });
  if (values.out) await writeFile(values.out, `${JSON.stringify(manifest, null, 2)}\n`);
  if (values["dry-run"]) console.log(JSON.stringify(manifest, null, 2));
  else {
    const token = process.env.SQUAD_RELEASE_PUBLISHER_TOKEN;
    if (!token || token.length < 32) throw Error("Set SQUAD_RELEASE_PUBLISHER_TOKEN to publish release metadata.");
    const response = await fetch(`${squadApiUrl()}/v1/releases/${manifest.channel}/manifest`, { method: "PUT", redirect: "error", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(manifest), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw Error(`Squad release publication failed (HTTP ${response.status}). The public release assets are unchanged; retry metadata publication.`);
    console.log(`Published ${manifest.version} to the dedicated Squad ${manifest.channel} feed.`);
  }
}
