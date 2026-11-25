// Member profiles kept in the signed-in person's Autohand account (ADR-0280).
// Each computer keeps its members; this service carries what a person writes
// about them (name, role, description, instructions, personality, skills, a
// cast bird, a voice) to and from the account that owns this Squad, so a
// second computer, and a phone through either, sees the same member.
//
// Rules: a three-way merge per field against the last profile both sides
// agreed on. A field changed on one side only is taken from that side; the
// same field changed differently on both sides keeps this computer's value
// and waits for the person to choose. A first sync with no agreed base never
// overwrites either side. Removing a member here never deletes it from the
// account. Disabled, or signed out, it sends nothing.
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSquadApi, squadApiUrl } from "./client.mjs";

export const PROFILE_FIELDS = Object.freeze(["name", "role", "description", "instructions", "personality", "skills", "avatar", "voice"]);
const LIMITS = { name: 60, role: 80, description: 600, instructions: 1200, personality: 600, voice: 80 };
const FIELD_LABELS = { name: "Name", role: "Role", description: "Description", instructions: "Instructions", personality: "Personality", skills: "Skills", avatar: "Avatar", voice: "Voice" };
const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const MEMBER_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;

/** The cloud shape of a member profile: every field present, within limits. */
export function cloudProfile(value = {}) {
  const text = field => String(value[field] ?? "").slice(0, LIMITS[field]);
  const skills = [...new Set((Array.isArray(value.skills) ? value.skills : []).map(skill => typeof skill === "string" ? skill : skill?.id || skill?.name || "").filter(skill => skill && skill.length <= 500))].slice(0, 32);
  const avatar = /^[a-z]{1,40}$/.test(String(value.avatar || "")) ? String(value.avatar) : "";
  return { name: text("name").trim() || "Member", role: text("role"), description: text("description"), instructions: text("instructions"), personality: text("personality"), skills, avatar, voice: text("voice") };
}

/**
 * @param {object} options
 * @param {string} options.stateDir private directory for profile-cloud.json
 * @param {() => string|Promise<string>} options.readIdentityToken the Autohand credential, or "" when signed out
 * @param {() => ({kind:'user'|'team', id:string, issuer:string, actorId:string}|null)} options.readOwner who owns this Squad
 * @param {() => Promise<{id:string, revision:number, profile:object}[]>} options.members this computer's members
 * @param {(id:string, changes:object, expectedRevision:number) => Promise<void>} options.apply revision-checked save
 * @param {(cloudId:string, profile:object) => Promise<string>} options.create adds a member, returns its local id
 */
export function createProfileCloud({ stateDir, readIdentityToken, readOwner, members, apply, create, fetchImpl = fetch, baseUrl = squadApiUrl(), interval = 30_000 }) {
  const file = join(stateDir, "profile-cloud.json");
  let chain = Promise.resolve(), timer, abort, nudged;
  const serial = action => { const next = chain.then(action); chain = next.catch(() => {}); return next; };
  const empty = () => ({ version: 1, enabled: null, apiUrl: baseUrl, owner: "", members: {}, conflicts: {}, notes: {}, cloudOnly: [], lastSyncedAt: "", error: "" });
  async function load() {
    try { const saved = JSON.parse(await readFile(file, "utf8")); return { ...empty(), ...saved }; }
    catch (error) { if (error.code === "ENOENT") return empty(); throw error; }
  }
  async function save(state) {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await chmod(temporary, 0o600); await rename(temporary, file);
  }
  const ownerOf = () => { const owner = readOwner(); return owner?.id && owner.actorId && ["user", "team"].includes(owner.kind) ? owner : null; };
  const ownerKeyOf = owner => owner ? JSON.stringify([owner.issuer, owner.kind, owner.id]) : "";
  const effective = (state, owner) => Boolean(owner) && (state.enabled ?? owner.kind === "user");
  // A different owner (account or team) is a different namespace: nothing
  // learnt about one is reused for the other.
  function forOwner(state, owner) {
    const key = ownerKeyOf(owner);
    if (state.owner !== key) Object.assign(state, { owner: key, enabled: null, members: {}, conflicts: {}, notes: {}, cloudOnly: [], lastSyncedAt: "", error: "" });
    return state;
  }
  function publicState(state, owner = ownerOf()) {
    return {
      available: Boolean(owner), enabled: effective(state, owner), ownerKind: owner?.kind || "", lastSyncedAt: state.lastSyncedAt || "", error: state.error || "",
      conflicts: Object.entries(state.conflicts).map(([id, conflict]) => ({ id, memberId: state.members[id]?.localId || id, name: conflict.name || id,
        fields: Object.entries(conflict.fields).map(([field, values]) => ({ field, label: FIELD_LABELS[field], local: values.local, cloud: values.cloud })) })),
      notes: Object.entries(state.notes).map(([id, message]) => ({ id, memberId: state.members[id]?.localId || id, message })),
      cloudOnly: state.cloudOnly,
    };
  }
  async function client(state, owner) {
    if (state.apiUrl !== baseUrl) Object.assign(state, { apiUrl: baseUrl, token: "", members: {}, conflicts: {}, cloudOnly: [] });
    const identityToken = await readIdentityToken();
    if (!identityToken) throw Error("Sign in to Autohand to keep member profiles in your account.");
    const sourceFingerprint = fingerprint(identityToken);
    if (!state.token || state.sourceFingerprint !== sourceFingerprint || !(Date.parse(state.expiresAt) > Date.now() + 60_000)) {
      const session = await createSquadApi({ baseUrl, fetchImpl, signal: abort?.signal }).request("/v1/auth/exchange", { method: "POST", body: { identityToken, deviceName: "Squad desktop profiles" } });
      const me = await createSquadApi({ baseUrl, fetchImpl, token: session.token, signal: abort?.signal }).request("/v1/me");
      if (me.issuer !== owner.issuer || me.subject !== owner.actorId) {
        await createSquadApi({ baseUrl, fetchImpl, token: session.token }).request("/v1/auth/session", { method: "DELETE" }).catch(() => {});
        throw Error("You are signed in to a different Autohand account than the one that owns this Squad. Profiles stay on this computer.");
      }
      Object.assign(state, { token: session.token, expiresAt: session.expiresAt, sourceFingerprint });
      await save(state);
    }
    const prefix = owner.kind === "user" ? "/v1/users/me/profiles" : `/v1/teams/${encodeURIComponent(owner.id)}/profiles`;
    // Team-owned profiles need the live Autohand credential so the API can
    // check current membership (ADR-0193); createSquadApi has no extra headers.
    async function request(path, { method = "GET", body, idempotencyKey } = {}) {
      const response = await fetchImpl(`${baseUrl}${prefix}${path}`, { method, redirect: "error", signal: AbortSignal.any([abort?.signal, AbortSignal.timeout(15_000)].filter(Boolean)),
        headers: { accept: "application/json", authorization: `Bearer ${state.token}`, ...(owner.kind === "team" ? { "x-autohand-identity": identityToken } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }), ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      let value;
      try { value = await response.json(); } catch { throw Object.assign(Error("Your Autohand account returned an unreadable answer. Profiles on this computer are unchanged."), { status: response.status }); }
      if (!response.ok || value.success !== true) throw Object.assign(Error(value.error?.message || "Your Autohand account is unavailable. Profiles on this computer are unchanged."), { status: response.status, code: value.error?.code });
      return value.data;
    }
    return {
      list: async () => (await request("")).profiles,
      get: id => request(`/${encodeURIComponent(id)}`),
      put: (id, baseRevision, content) => request(`/${encodeURIComponent(id)}`, { method: "PUT", body: { baseRevision, content }, idempotencyKey: fingerprint({ id, baseRevision, content }).slice(0, 64) }),
    };
  }

  async function syncMember(api, state, cloudId, local, remote) {
    const record = state.members[cloudId];
    const L = cloudProfile(local.profile), R = remote && !remote.deleted ? cloudProfile(remote.content) : null, remoteRevision = remote?.revision || 0;
    if (state.conflicts[cloudId]) {
      // Keep the choice current: show the newest cloud value, and drop a
      // conflict both sides have since settled the same way.
      const conflict = state.conflicts[cloudId];
      if (R) for (const field of Object.keys(conflict.fields)) conflict.fields[field] = { local: L[field], cloud: R[field] };
      for (const [field, values] of Object.entries(conflict.fields)) if (same(values.local, values.cloud)) delete conflict.fields[field];
      if (Object.keys(conflict.fields).length) { conflict.name = L.name; return; }
      delete state.conflicts[cloudId];
      if (R) state.members[cloudId] = { localId: local.id, revision: remoteRevision, base: R, local: L };
      return;
    }
    const push = async (content, baseRevision, localNow = L) => {
      try {
        const accepted = await api.put(cloudId, baseRevision, content);
        state.members[cloudId] = { localId: local.id, revision: accepted.revision, base: content, local: localNow };
      } catch (error) { if (error.code !== "revision_conflict") throw error; }
    };
    if (!R) {
      // Nothing in the account (or it was removed there): this computer's
      // profile goes up, unless an explicit removal meets an unchanged member.
      if (remote?.deleted && record && same(L, cloudProfile(record.local || record.base || {}))) return;
      return push(L, remoteRevision);
    }
    if (!record) {
      if (same(L, R)) { state.members[cloudId] = { localId: local.id, revision: remoteRevision, base: R, local: L }; return; }
      // First meeting with different content: neither side is overwritten.
      const fields = Object.fromEntries(PROFILE_FIELDS.filter(field => !same(L[field], R[field])).map(field => [field, { local: L[field], cloud: R[field] }]));
      state.conflicts[cloudId] = { name: L.name, fields };
      state.members[cloudId] = { localId: local.id, revision: remoteRevision, base: null };
      return;
    }
    // Two bases: what the account held and what this computer held when they
    // last agreed. A value this computer could not take, or filled in itself
    // (a voice on adding), is then never mistaken for a change to send.
    const RB = record.base ? cloudProfile(record.base) : R, LB = record.local ? cloudProfile(record.local) : RB, remoteNewer = remoteRevision > record.revision;
    const outgoing = { ...R }, conflicts = {}, incoming = {};
    let localEdits = false;
    for (const field of PROFILE_FIELDS) {
      const localChanged = !same(L[field], LB[field]), remoteChanged = remoteNewer && !same(R[field], RB[field]);
      if (localChanged && remoteChanged && !same(L[field], R[field])) conflicts[field] = { local: L[field], cloud: R[field] };
      else if (remoteChanged) { if (!same(L[field], R[field])) incoming[field] = R[field]; }
      else if (localChanged) { outgoing[field] = L[field]; localEdits = true; }
    }
    // A photo (or no bird) is not carried: an incoming empty avatar never
    // replaces this computer's picture.
    if ("avatar" in incoming && !incoming.avatar) delete incoming.avatar;
    const now = { ...L }, failed = [];
    if (Object.keys(incoming).length) {
      let revision = local.revision;
      try { await apply(local.id, incoming, revision); Object.assign(now, incoming); }
      catch (error) {
        if (error.status === 409) return; // edited here meanwhile: next sync
        // Take what this computer can, field by field; report the rest.
        for (const [field, value] of Object.entries(incoming)) {
          try { revision = (await members()).find(member => member.id === local.id)?.revision ?? revision; await apply(local.id, { [field]: value }, revision); now[field] = value; }
          catch (fieldError) { failed.push([field, fieldError.message]); }
        }
      }
    }
    if (failed.length) state.notes[cloudId] = `${L.name}: the account's ${failed.map(([field]) => FIELD_LABELS[field].toLowerCase()).join(", ")} could not be used here (${failed[0][1]}). This computer keeps its own until it changes.`;
    else if (Object.keys(incoming).length) delete state.notes[cloudId];
    if (Object.keys(conflicts).length) {
      state.conflicts[cloudId] = { name: L.name, fields: conflicts };
      state.members[cloudId] = { localId: local.id, revision: remoteRevision, base: R, local: now };
      return;
    }
    if (localEdits && !same(outgoing, R)) return push(outgoing, remoteRevision, now);
    state.members[cloudId] = { localId: local.id, revision: remoteRevision, base: R, local: now };
  }

  async function syncState(state) {
    const owner = ownerOf(); forOwner(state, owner);
    if (!effective(state, owner)) return publicState(state, owner);
    abort = new AbortController();
    try {
      const api = await client(state, owner);
      const remote = new Map((await api.list()).map(entry => [entry.id, entry]));
      const locals = new Map((await members()).map(member => [member.id, member]));
      const linked = new Map(Object.entries(state.members).map(([cloudId, record]) => [record.localId, cloudId]));
      for (const id of locals.keys()) if (!linked.has(id) && MEMBER_ID.test(id) && !state.members[id]) linked.set(id, id);
      for (const [localId, cloudId] of linked) {
        const local = locals.get(localId);
        if (!local) continue;
        await syncMember(api, state, cloudId, local, remote.get(cloudId));
        await save(state);
      }
      const present = new Set([...linked].filter(([localId]) => locals.has(localId)).map(([, cloudId]) => cloudId));
      state.cloudOnly = [...remote.values()].filter(entry => !entry.deleted && !present.has(entry.id))
        .map(entry => ({ id: entry.id, name: entry.content?.name || entry.id, role: entry.content?.role || "", avatar: entry.content?.avatar || "", updatedAt: entry.updatedAt }));
      for (const id of Object.keys(state.notes)) if (!present.has(id)) delete state.notes[id];
      state.lastSyncedAt = new Date().toISOString(); state.error = "";
    } catch (error) { state.error = error.message || "Profiles could not sync. Profiles on this computer are kept."; }
    abort = null; await save(state); return publicState(state, owner);
  }

  const withState = action => serial(async () => { const owner = ownerOf(), state = forOwner(await load(), owner); return action(state, owner); });
  return {
    status: () => withState(async (state, owner) => publicState(state, owner)),
    sync: () => withState(state => syncState(state)),
    setEnabled: enabled => withState(async (state, owner) => {
      if (!owner) throw Error("Sign in to Autohand to keep member profiles in your account.");
      state.enabled = Boolean(enabled); await save(state); return enabled ? syncState(state) : publicState(state, owner);
    }),
    /** Keep this computer's value ("local") or use the account's ("cloud") for every field in conflict. */
    resolve: (cloudId, choice) => withState(async (state, owner) => {
      const conflict = state.conflicts[cloudId];
      if (!effective(state, owner) || !conflict || !["local", "cloud"].includes(choice)) throw Error("Choose a current profile conflict and which version to keep.");
      const api = await client(state, owner), remote = await api.get(cloudId).catch(error => { if (error.status === 404) return null; throw error; });
      const local = (await members()).find(member => member.id === (state.members[cloudId]?.localId || cloudId));
      if (!local) throw Error("This member is no longer on this computer.");
      if (choice === "cloud" && remote && !remote.deleted) {
        const R = cloudProfile(remote.content);
        const changes = Object.fromEntries(Object.keys(conflict.fields).filter(field => field !== "avatar" || R.avatar).map(field => [field, R[field]]));
        if (Object.keys(changes).length) await apply(local.id, changes, local.revision);
      }
      // The account's current version becomes the agreed base; anything this
      // computer still differs on (the kept values) goes up on the next sync.
      delete state.conflicts[cloudId];
      const R = remote && !remote.deleted ? cloudProfile(remote.content) : null;
      const fresh = (await members()).find(member => member.id === local.id) || local;
      // "local": this computer's values become edits to send; "cloud": what
      // this computer now holds is agreed.
      state.members[cloudId] = { localId: local.id, revision: remote?.revision || 0, base: R, local: choice === "cloud" ? cloudProfile(fresh.profile) : R };
      if (!state.members[cloudId].base) delete state.members[cloudId];
      await save(state); return syncState(state);
    }),
    /** A member kept in the account but not on this computer. */
    add: cloudId => withState(async (state, owner) => {
      if (!effective(state, owner)) throw Error("Turn on profiles in your Autohand account first.");
      const api = await client(state, owner), remote = await api.get(cloudId);
      if (remote.deleted || !remote.content) throw Error("That profile is no longer in your account.");
      const localId = await create(cloudId, cloudProfile(remote.content));
      const local = (await members()).find(member => member.id === localId);
      // The base is what this computer really holds (a skill it lacks is
      // left out), so nothing it could not take is pushed back as a removal.
      state.members[cloudId] = { localId, revision: remote.revision, base: cloudProfile(remote.content), local: local ? cloudProfile(local.profile) : cloudProfile(remote.content) };
      await save(state); return syncState(state);
    }),
    /** Remove a profile kept only in the account. */
    remove: cloudId => withState(async (state, owner) => {
      if (!effective(state, owner)) throw Error("Turn on profiles in your Autohand account first.");
      if (!state.cloudOnly.some(entry => entry.id === cloudId)) throw Error("Only a profile that is not on this computer can be removed from your account here.");
      const api = await client(state, owner), remote = await api.get(cloudId);
      await api.put(cloudId, remote.revision, null);
      delete state.members[cloudId];
      await save(state); return syncState(state);
    }),
    /** A profile was just saved here: send it soon rather than in 30 s. */
    nudge() { clearTimeout(nudged); nudged = setTimeout(() => { void serial(async () => syncState(forOwner(await load(), ownerOf()))).catch(() => {}); }, 1500); nudged.unref?.(); },
    start() { if (!timer) { timer = setInterval(() => { void serial(async () => syncState(forOwner(await load(), ownerOf()))).catch(() => {}); }, interval); timer.unref?.(); } },
    close() { abort?.abort(); clearInterval(timer); clearTimeout(nudged); timer = null; return chain; },
  };
}
