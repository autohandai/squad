// Canvases: Markdown documents owned by a channel or a member that the user
// and squad members edit together (ADR-0023). State lives in
// `<stateDir>/canvases.json`; a run that should edit a canvas gets it as a
// plain file under `<stateDir>/canvas/<id>.md` (materialize) and the bridge
// reads it back afterwards (absorb), recording one revision when it changed.
//
// Pure Node, no bridge imports: `scripts/check-canvases.mjs` drives it against
// a temp directory.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const STORE_FILE = "canvases.json";
export const CANVAS_DIR = "canvas";
export const OWNER_TYPES = ["channel", "member"];

const MAX_TITLE = 200;
const MAX_BODY = 512 * 1024;
const MAX_SUMMARY = 280;
const MAX_REVISIONS = 200;

function now() {
  return new Date().toISOString();
}

function text(value, limit) {
  return String(value ?? "").slice(0, limit);
}

function normalizeBody(value) {
  return text(value, MAX_BODY).replace(/\r\n?/g, "\n");
}

function safeId(id) {
  const value = String(id || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(value)) throw new Error("invalid canvas id");
  return value;
}

async function readStore(stateDir) {
  try {
    const parsed = JSON.parse(await readFile(join(stateDir, STORE_FILE), "utf8"));
    return { version: 1, canvases: Array.isArray(parsed?.canvases) ? parsed.canvases : [] };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, canvases: [] };
    throw error;
  }
}

async function writeStore(stateDir, store) {
  const path = join(stateDir, STORE_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function revision({ authorId, body, summary }) {
  return { id: randomUUID(), authorId: text(authorId, 120), at: now(), body, summary: text(summary, MAX_SUMMARY) };
}

function findCanvas(store, id) {
  const canvasId = safeId(id);
  const canvas = store.canvases.find((item) => item.id === canvasId);
  if (!canvas) throw Object.assign(new Error("canvas not found"), { code: "ENOTFOUND", status: 404 });
  return canvas;
}

function capRevisions(canvas) {
  if (canvas.revisions.length > MAX_REVISIONS) canvas.revisions.splice(0, canvas.revisions.length - MAX_REVISIONS);
}

export function publicCanvas(canvas) {
  return { ...canvas, revisions: canvas.revisions.map((item) => ({ ...item })) };
}

export function canvasPath(stateDir, id) {
  return join(stateDir, CANVAS_DIR, `${safeId(id)}.md`);
}

export function canvasDir(stateDir) {
  return join(stateDir, CANVAS_DIR);
}

/** Canvases for one owner, newest updated first. Without a filter, all of them. */
export async function list(stateDir, { ownerType = "", ownerId = "" } = {}) {
  const store = await readStore(stateDir);
  return store.canvases
    .filter((item) => (!ownerType || item.ownerType === ownerType) && (!ownerId || item.ownerId === ownerId))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map(publicCanvas);
}

export async function get(stateDir, id) {
  return publicCanvas(findCanvas(await readStore(stateDir), id));
}

export async function create(stateDir, { ownerType, ownerId, title, body = "", authorId = "user" }) {
  if (!OWNER_TYPES.includes(ownerType)) throw Object.assign(new Error("ownerType must be channel or member"), { status: 400 });
  const owner = String(ownerId || "").trim();
  if (!owner) throw Object.assign(new Error("ownerId is required"), { status: 400 });
  const at = now();
  const normalizedBody = normalizeBody(body);
  const canvas = {
    id: randomUUID(),
    ownerType,
    ownerId: owner,
    title: text(title, MAX_TITLE).trim() || "Untitled canvas",
    body: normalizedBody,
    createdAt: at,
    updatedAt: at,
    revisions: [revision({ authorId, body: normalizedBody, summary: "Created" })],
  };
  const store = await readStore(stateDir);
  store.canvases.push(canvas);
  await writeStore(stateDir, store);
  return publicCanvas(canvas);
}

/**
 * Update title and/or body. Exactly one revision is appended when the body
 * actually changed; a title-only change or an identical body records none.
 */
export async function update(stateDir, id, { title, body, authorId = "user", summary = "" } = {}) {
  const store = await readStore(stateDir);
  const canvas = findCanvas(store, id);
  let changed = false;
  let added = null;
  if (typeof title === "string") {
    const nextTitle = text(title, MAX_TITLE).trim();
    if (nextTitle && nextTitle !== canvas.title) {
      canvas.title = nextTitle;
      changed = true;
    }
  }
  if (typeof body === "string") {
    const nextBody = normalizeBody(body);
    if (nextBody !== canvas.body) {
      canvas.body = nextBody;
      added = revision({ authorId, body: nextBody, summary: summary || "Edited" });
      canvas.revisions.push(added);
      capRevisions(canvas);
      changed = true;
    }
  }
  if (changed) {
    canvas.updatedAt = now();
    await writeStore(stateDir, store);
  }
  return { canvas: publicCanvas(canvas), changed, revision: added ? { ...added } : null };
}

/** Restore the body of an earlier revision; recorded as a new revision by `authorId`. */
export async function revert(stateDir, id, revisionId, authorId = "user") {
  const store = await readStore(stateDir);
  const canvas = findCanvas(store, id);
  const target = canvas.revisions.find((item) => item.id === String(revisionId || ""));
  if (!target) throw Object.assign(new Error("revision not found"), { status: 404 });
  if (target.body === canvas.body) return { canvas: publicCanvas(canvas), changed: false, revision: null };
  canvas.body = target.body;
  const added = revision({ authorId, body: target.body, summary: `Reverted to ${target.at}` });
  canvas.revisions.push(added);
  capRevisions(canvas);
  canvas.updatedAt = now();
  await writeStore(stateDir, store);
  return { canvas: publicCanvas(canvas), changed: true, revision: { ...added } };
}

export async function remove(stateDir, id) {
  const store = await readStore(stateDir);
  const canvas = findCanvas(store, id);
  store.canvases = store.canvases.filter((item) => item.id !== canvas.id);
  await writeStore(stateDir, store);
  return { id: canvas.id };
}

/**
 * Write the canvas body to `<stateDir>/canvas/<id>.md` so a run can receive it
 * as an extra `--add-dir`. Returns the directory (for the flag) and the file.
 */
export async function materialize(stateDir, id) {
  const canvas = await get(stateDir, id);
  const path = canvasPath(stateDir, canvas.id);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, canvas.body, "utf8");
  return { dir: dirname(path), path, id: canvas.id, title: canvas.title };
}

/**
 * Read the materialized file back after a run. When its content differs from
 * the stored body, one revision by `authorId` is appended. A missing file
 * (the run never touched it, or it was cleaned) is not a change.
 */
export async function absorb(stateDir, id, authorId, { summary = "" } = {}) {
  let content;
  try {
    content = await readFile(canvasPath(stateDir, id), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { changed: false, revision: null, canvas: await get(stateDir, id) };
    throw error;
  }
  const result = await update(stateDir, id, { body: content, authorId, summary: summary || "Edited during a run" });
  return { changed: Boolean(result.revision), revision: result.revision, canvas: result.canvas };
}
