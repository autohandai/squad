import type { Env } from "./env.js";
import { ApiError, body, digest, equalSecret, ok, requireValue } from "./http.js";
import { channelSchema, releaseSchema } from "./schema.js";

export async function releaseRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/v1\/releases\/([^/]+)\/manifest$/); if (!match) return null;
  const channel = channelSchema.safeParse(match[1]);
  requireValue(channel.success, 404, "channel_not_found", "Release channel not found.");
  if (request.method === "GET") {
    const release = await env.DB.prepare("SELECT object_key,digest FROM releases WHERE channel=?").bind(channel.data).first<{ object_key: string; digest: string }>();
    requireValue(release, 404, "release_not_published", "No release has been published to this channel.");
    const headers = { "cache-control": "public, max-age=60, stale-while-revalidate=300", etag: `"${release.digest}"`, "content-type": "application/json" };
    if (request.headers.get("if-none-match") === headers.etag) return new Response(null, { status: 304, headers });
    const object = await env.RELEASES.get(release.object_key);
    requireValue(object, 503, "release_unavailable", "Release metadata is temporarily unavailable.");
    return new Response(object.body, { headers });
  }
  if (request.method !== "PUT") return null;
  requireValue(env.RELEASE_PUBLISHER_TOKEN && env.RELEASE_PUBLISHER_TOKEN.length >= 32, 503, "publisher_unconfigured", "Release publication is not configured.");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  requireValue(await equalSecret(bearer, env.RELEASE_PUBLISHER_TOKEN), 401, "publisher_required", "A release publisher credential is required.");
  const manifest = await body(request, releaseSchema);
  requireValue(manifest.channel === channel.data, 400, "channel_mismatch", "Release channel does not match the route.");
  requireValue(channel.data !== "stable" || !manifest.version.includes("-"), 400, "stable_prerelease", "Stable releases cannot be prereleases.");
  const seen = new Set<string>();
  for (const asset of manifest.assets) {
    const suffix = asset.os === "macos" ? [".dmg"] : asset.os === "windows" ? ["-setup.exe", ".msi"] : [".deb", ".AppImage"];
    requireValue(suffix.some(value => asset.name === `autohand-squad-${manifest.version}-${asset.os}-${asset.arch}${value}`), 400, "asset_mismatch", "Installer name does not match its version and platform.");
    const allowed = [manifest.version, `v${manifest.version}`].map(tag => `https://github.com/autohandai/squad/releases/download/${tag}/${asset.name}`);
    requireValue(allowed.includes(asset.url) && !seen.has(asset.name), 400, "asset_invalid", "Use unique installers from the official release.");
    seen.add(asset.name);
  }
  const raw = JSON.stringify(manifest); const hash = await digest(raw);
  const current = await env.DB.prepare("SELECT version,digest FROM releases WHERE channel=?").bind(channel.data).first<{ version: string; digest: string }>();
  if (current && channel.data === "stable") {
    if (current.version === manifest.version) {
      requireValue(current.digest === hash, 409, "release_immutable", "A published stable version cannot be changed.");
      return ok({ channel: channel.data, version: manifest.version, digest: hash });
    }
    const previous = current.version.split(".").map(Number); const next = manifest.version.split(".").map(Number);
    const different = next.findIndex((part, index) => part !== previous[index]);
    requireValue(different >= 0 && next[different] > previous[different], 409, "release_downgrade", "Stable publication must advance the version.");
  }
  const key = `releases/${channel.data}/${manifest.version}/${hash}.json`;
  await env.RELEASES.put(key, raw, { httpMetadata: { contentType: "application/json" } });
  // Release pointers are changed only by the separate CI publisher capability.
  const published = await env.DB.prepare(`INSERT INTO releases(channel,version,object_key,digest,published_at) VALUES (?,?,?,?,?)
    ON CONFLICT(channel) DO UPDATE SET version=excluded.version,object_key=excluded.object_key,digest=excluded.digest,published_at=excluded.published_at WHERE releases.digest=?`)
    .bind(channel.data, manifest.version, key, hash, new Date().toISOString(), current?.digest || "").run();
  requireValue(published.meta.changes, 409, "release_conflict", "Another publication won. Read the channel before retrying.");
  return ok({ channel: channel.data, version: manifest.version, digest: hash }, 201);
}
