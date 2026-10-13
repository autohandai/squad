// Folders a person mentions in plain English (ADR-0120).
//
//   POST /api/folders/check    { paths: [string] } → { folders: [{ given, path, exists, directory, folder, allowed }] }
//                              ~ expands to the home directory; a file resolves to its folder;
//                              `allowed` is the bridge's own rule (inside the home directory, not the home itself).
//   POST /api/folders/request  { memberId, folder, prompt } → { requested: true }
//                              emits `folder.request.pending`, which the notifications plug-in turns into
//                              a feed item and a native notification like a vault request.
//
// The grant itself lives in the browser (the member's folders), which the
// bridge turns into `--add-dir` on every later turn; this route only answers
// what exists and raises the request.
import { stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export const name = "folders";

const MAX_PATHS = 12;
const MEMBER_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;

function expandHome(given, homeDir) {
  const text = String(given || "").trim();
  if (text === "~") return homeDir;
  if (text.startsWith("~/") || text.startsWith("~\\")) return join(homeDir, text.slice(2));
  return text;
}

function insideHome(path, homeDir) {
  const home = resolve(homeDir);
  const target = resolve(path);
  return target !== home && (target.startsWith(home + sep) || target.startsWith(home + "/"));
}

async function describe(given, homeDir) {
  const expanded = expandHome(given, homeDir);
  const path = isAbsolute(expanded) ? resolve(expanded) : "";
  const entry = { given: String(given || ""), path, exists: false, directory: false, folder: "", allowed: false };
  if (!path) return entry;
  try {
    const info = await stat(path);
    entry.exists = true;
    entry.directory = info.isDirectory();
    entry.folder = entry.directory ? path : dirname(path);
  } catch {
    // A path that does not exist (yet) still names its folder; the person can
    // say no. A file-looking name resolves to its folder.
    entry.folder = /\.[A-Za-z0-9]{1,8}$/.test(basename(path)) ? dirname(path) : path;
  }
  entry.allowed = Boolean(entry.folder) && insideHome(entry.folder, homeDir);
  return entry;
}

export async function handle(req, res, url, ctx) {
  if (url.pathname === "/api/folders/check" && req.method === "POST") {
    try {
      const body = await ctx.readBody(req);
      const paths = (Array.isArray(body?.paths) ? body.paths : []).map((item) => String(item || "").trim()).filter(Boolean).slice(0, MAX_PATHS);
      const folders = await Promise.all(paths.map((given) => describe(given, ctx.homeDir)));
      ctx.json(res, 200, { success: true, data: { folders } });
    } catch (error) {
      ctx.json(res, error?.status || 400, { success: false, error: error?.message || String(error) });
    }
    return true;
  }
  if (url.pathname === "/api/folders/request" && req.method === "POST") {
    try {
      const body = await ctx.readBody(req);
      const memberId = String(body?.memberId || "").toLowerCase();
      const folder = String(body?.folder || "").trim();
      if (!MEMBER_ID.test(memberId)) throw Object.assign(new Error("member id is invalid"), { status: 400 });
      if (!folder) throw Object.assign(new Error("folder is required"), { status: 400 });
      ctx.emit("folder.request.pending", {
        memberId,
        memberName: String(body?.memberName || ""),
        folder,
        prompt: String(body?.prompt || "").slice(0, 400),
        at: new Date().toISOString(),
      });
      ctx.json(res, 200, { success: true, data: { requested: true } });
    } catch (error) {
      ctx.json(res, error?.status || 400, { success: false, error: error?.message || String(error) });
    }
    return true;
  }
  return false;
}
