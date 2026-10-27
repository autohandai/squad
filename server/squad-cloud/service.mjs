import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSquadApi, squadApiUrl } from "./client.mjs";
import { cleanMemoryText, TEAM_MEMORY_LIMIT } from "../team/store.mjs";

const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const contentFor = entry => ({ text: entry.text, scope: "team", memberId: null, projectId: null });
const validId = value => /^[a-f0-9-]{36}$/.test(value || "");
export function createSquadCloud({ stateDir, store, readIdentityToken, fetchImpl = fetch, baseUrl = squadApiUrl() }) {
  const file = join(stateDir, "cloud-sync.json");
  let chain = Promise.resolve(); let timer; let syncAbort;
  const serial = action => { const next = chain.then(action); chain = next.catch(() => {}); return next; };
  const empty = () => ({ version: 1, enabled: false, cursor: 0, entries: Object.create(null), conflicts: Object.create(null), apiUrl: baseUrl });
  const load = async () => { try { const saved = JSON.parse(await readFile(file, "utf8")); return { ...empty(), ...saved, entries: Object.assign(Object.create(null), saved.entries), conflicts: Object.assign(Object.create(null), saved.conflicts) }; } catch (error) { if (error.code === "ENOENT") return empty(); throw error; } };
  async function save(state) {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await writeFile(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
    await chmod(`${file}.tmp`, 0o600); await rename(`${file}.tmp`, file);
  }
  function publicState(state) {
    return { enabled: state.enabled, tenantId: state.tenantId || "", workspaceId: state.workspaceId || "", tenantName: state.tenantName || "", workspaceName: state.workspaceName || "", lastSyncedAt: state.lastSyncedAt || "", error: state.error || "", conflicts: Object.entries(state.conflicts).map(([id, entry]) => ({ id, localText: entry.localText || "", remoteText: entry.remote?.content?.text || "", remoteDeleted: Boolean(entry.remote?.deleted) })) };
  }
  async function client(state) {
    if (state.apiUrl !== baseUrl) throw Error("The configured Squad API changed. Disconnect and connect again before syncing.");
    const identityToken = await readIdentityToken();
    if (!identityToken) throw Error("Sign in to Squad before connecting cloud sync.");
    const sourceFingerprint = fingerprint(identityToken);
    if (!state.token || state.sourceFingerprint !== sourceFingerprint || !Number.isFinite(Date.parse(state.expiresAt)) || Date.parse(state.expiresAt) <= Date.now() + 60_000) {
      const session = await createSquadApi({ baseUrl, fetchImpl, signal: syncAbort?.signal }).request("/v1/auth/exchange", { method: "POST", body: { identityToken, deviceName: "Squad desktop" } });
      if (state.enabled && state.userId && state.userId !== session.user.id) {
        await createSquadApi({ baseUrl, fetchImpl, token: session.token }).request("/v1/auth/session", { method: "DELETE" }).catch(() => {});
        throw Error("This cloud connection belongs to another account. Disconnect before connecting with this account.");
      }
      state.token = session.token; state.expiresAt = session.expiresAt; state.userId = session.user.id; state.sourceFingerprint = sourceFingerprint; await save(state);
    }
    return createSquadApi({ baseUrl, fetchImpl, token: state.token, signal: syncAbort?.signal });
  }
  const path = state => `/v1/tenants/${state.tenantId}/workspaces/${state.workspaceId}`;
  async function syncState(state) {
    if (!state.enabled) return publicState(state);
    syncAbort = new AbortController();
    try {
      const api = await client(state); const local = await store.read();
      const localEntries = local.memory.filter(entry => entry.scope === "team");
      const deleted = new Set((local.memoryTombstones || []).map(entry => entry.id));
      const pending = localEntries.map(entry => ({ id: entry.id, content: contentFor(entry) }));
      for (const [id, entry] of Object.entries(state.entries)) if (!entry.deleted && deleted.has(id) && !localEntries.some(local => local.id === id)) pending.push({ id, content: null });
      for (const mutation of pending) {
        if (state.conflicts[mutation.id]) continue;
        const previous = state.entries[mutation.id]; const hash = fingerprint(mutation.content);
        if (previous?.hash === hash) continue;
        const body = { baseRevision: previous?.revision || 0, content: mutation.content };
        try {
          const accepted = await api.request(`${path(state)}/memory/${encodeURIComponent(mutation.id)}`, { method: "PUT", body, idempotencyKey: fingerprint({ id: mutation.id, ...body }) });
          state.entries[mutation.id] = { revision: accepted.revision, hash, deleted: accepted.deleted }; await save(state);
        } catch (error) {
          if (error.code !== "revision_conflict") throw error;
          const remote = await api.request(`${path(state)}/memory/${encodeURIComponent(mutation.id)}`);
          if (fingerprint(remote.content) === hash) state.entries[mutation.id] = { revision: remote.revision, hash, deleted: remote.deleted };
          else state.conflicts[mutation.id] = { localText: mutation.content?.text || "", remote };
          await save(state);
        }
      }
      for (let page = 0; page < 20; page++) {
        const changes = await api.request(`${path(state)}/memory/changes?cursor=${state.cursor}&limit=100`);
        for (const remote of changes.entries) {
          if (remote.scope !== "team") { state.cursor = remote.sequence; continue; }
          const previous = state.entries[remote.id];
          if ((previous?.revision || 0) >= remote.revision) { state.cursor = remote.sequence; continue; }
          if (state.conflicts[remote.id]) { state.conflicts[remote.id].remote = remote; state.cursor = remote.sequence; continue; }
          await store.mutate(current => {
            const local = current.memory.find(entry => entry.id === remote.id);
            if (local && fingerprint(contentFor(local)) !== previous?.hash) {
              state.conflicts[remote.id] = { localText: local.text, remote }; return;
            }
            if (remote.deleted) current.memory = current.memory.filter(entry => entry.id !== remote.id);
            else if (local) local.text = cleanMemoryText(remote.content.text);
            else {
              if (current.memory.length >= TEAM_MEMORY_LIMIT) throw Error("Local memory is full. Remove an entry before syncing more memories.");
              current.memory.push({ id: remote.id, text: cleanMemoryText(remote.content.text), scope: "team", memberId: "", authorId: "", authorName: "Your team", source: "cloud", createdAt: remote.updatedAt });
            }
            state.entries[remote.id] = { revision: remote.revision, hash: fingerprint(remote.content), deleted: remote.deleted };
          });
          state.cursor = remote.sequence;
          await save(state);
        }
        state.cursor = changes.cursor;
        await save(state);
        if (!changes.hasMore) break;
      }
      state.lastSyncedAt = new Date().toISOString(); state.error = "";
    } catch (error) { state.error = error.message || "Cloud sync could not finish. Your local memories are kept."; }
    await save(state); syncAbort = null; return publicState(state);
  }
  async function discover(state) {
    const api = await client(state); const tenants = await api.request("/v1/tenants");
    return { tenants: await Promise.all(tenants.map(async tenant => ({ ...tenant, workspaces: await api.request(`/v1/tenants/${tenant.id}/workspaces`) }))) };
  }
  return {
    status: async () => publicState(await load()),
    discover: () => serial(async () => discover(await load())),
    createTenant: name => serial(async () => {
      const state = await load(); const api = await client(state);
      const tenant = await api.request("/v1/tenants", { method: "POST", body: { name } });
      await api.request(`/v1/tenants/${tenant.id}/workspaces`, { method: "POST", body: { name: "Main" } });
      return discover(state);
    }),
    connect: selection => serial(async () => {
      if (!validId(selection?.tenantId) || !validId(selection?.workspaceId)) throw Error("Choose a team and workspace.");
      const state = await load(); const available = await discover(state);
      const tenant = available.tenants.find(tenant => tenant.id === selection.tenantId);
      const workspace = tenant?.workspaces.find(workspace => workspace.id === selection.workspaceId && !workspace.archivedAt);
      if (!workspace || !["owner", "admin", "editor"].includes(tenant.role)) throw Error("Choose a workspace where you can edit memories.");
      if (state.enabled && (state.tenantId !== tenant.id || state.workspaceId !== workspace.id)) throw Error("Disconnect before changing cloud workspaces.");
      Object.assign(state, { enabled: true, tenantId: tenant.id, workspaceId: workspace.id, tenantName: tenant.name, workspaceName: workspace.name, deviceId: state.deviceId || randomUUID() });
      const api = await client(state);
      await api.request(`${path(state)}/devices`, { method: "POST", body: { id: state.deviceId, label: "Squad desktop" } });
      await save(state); return syncState(state);
    }),
    sync: () => serial(async () => syncState(await load())),
    disconnect: () => { syncAbort?.abort(); return serial(async () => {
      const state = await load();
      if (state.token) await createSquadApi({ baseUrl: state.apiUrl, fetchImpl, token: state.token }).request("/v1/auth/session", { method: "DELETE" }).catch(() => {});
      const next = empty(); await save(next); return publicState(next);
    }); },
    resolve: (id, resolution) => serial(async () => {
      const state = await load(); const conflict = state.conflicts[id];
      if (!state.enabled || !conflict || !["local", "remote"].includes(resolution)) throw Error("Choose a current memory conflict and resolution.");
      if (resolution === "remote") {
        const remote = conflict.remote;
        await store.mutate(current => {
          const local = current.memory.find(entry => entry.id === id);
          if (remote.deleted) current.memory = current.memory.filter(entry => entry.id !== id);
          else if (local) local.text = cleanMemoryText(remote.content.text);
          else { if (current.memory.length >= TEAM_MEMORY_LIMIT) throw Error("Local memory is full."); current.memory.push({ id, text: cleanMemoryText(remote.content.text), scope: "team", memberId: "", source: "cloud", createdAt: remote.updatedAt }); }
        });
        state.entries[id] = { revision: remote.revision, hash: fingerprint(remote.content), deleted: remote.deleted };
      } else {
        const local = (await store.read()).memory.find(entry => entry.id === id);
        state.entries[id] = { revision: conflict.remote.revision, hash: fingerprint(conflict.remote.content), deleted: conflict.remote.deleted };
        // A missing local entry is an explicit local deletion in this resolution.
        if (!local) await store.mutate(current => { current.memoryTombstones = [...(current.memoryTombstones || []), { id, deletedAt: new Date().toISOString() }]; });
      }
      delete state.conflicts[id]; await save(state); return syncState(state);
    }),
    start() { if (!timer) { timer = setInterval(() => { void serial(async () => syncState(await load())).catch(() => {}); }, 30_000); timer.unref(); } },
    close() { syncAbort?.abort(); clearInterval(timer); timer = null; return chain; },
  };
}
