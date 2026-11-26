// A Squad from before account ownership, brought back on update (ADR-0283).
//
// Before 0.1.22 the app kept its squad unowned: channels, chats and team
// memory in the service root (~/.autohand/squad) and members under
// web-state/agents. From 0.1.22 each account has its own dataset
// (owners/<key>/datasets/<id>), and the first sign-in got an empty one, so an
// updated Mac showed setup with no members while the old squad sat on disk.
//
// These helpers only decide; the copy itself is the verified legacy recovery
// (ADR-0196) and the restore transaction. Nothing here writes to the old files.
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';

const MEMBER_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const JSON_LIMIT = 64 * 1024 * 1024;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

/** Where an older install kept its squad, relative to the service root. */
export function legacyRoots(serviceRoot) {
  return { stateRoot: serviceRoot, appRoot: join(serviceRoot, 'web-state') };
}
export const markerPath = serviceRoot => join(serviceRoot, 'legacy-import.json');
export const readMarker = serviceRoot => readPersistentJson(markerPath(serviceRoot), null).catch(() => null);
export const writeMarker = (serviceRoot, value) => writePersistentJson(markerPath(serviceRoot), { version: 1, ...value, updatedAt: new Date().toISOString() });

async function readJson(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const info = await file.stat();
    if (!info.isFile() || info.size > JSON_LIMIT) return null;
    return JSON.parse(await file.readFile('utf8'));
  } catch { return null; } finally { await file?.close(); }
}

/** Members a channels.json keeps, without the built-in designer or removed ones. */
function channelMembers(channels) {
  const access = object(channels?.agentChannelAccess);
  return Object.entries(access).filter(([id, entry]) => MEMBER_ID.test(id) && id !== 'squad-designer' && entry?.agent && !entry.removed)
    .map(([id, entry]) => ({ id, name: String(entry.agent.name || id).slice(0, 80) }));
}

/** The old squad on this computer: its members (by id and name) and channels. */
export async function scanLegacy(serviceRoot) {
  const { stateRoot, appRoot } = legacyRoots(serviceRoot);
  const channels = await readJson(join(stateRoot, 'channels.json'));
  const removed = new Set(Object.entries(object(channels?.agentChannelAccess)).filter(([, entry]) => entry?.removed).map(([id]) => id));
  const members = new Map(channelMembers(channels).map(member => [member.id, member]));
  try {
    const root = await lstat(join(appRoot, 'agents'));
    if (root.isDirectory() && !root.isSymbolicLink()) {
      for (const entry of await readdir(join(appRoot, 'agents'), { withFileTypes: true })) {
        if (!entry.isDirectory() || !MEMBER_ID.test(entry.name) || entry.name === 'squad-designer' || removed.has(entry.name) || members.has(entry.name)) continue;
        const profile = await readJson(join(appRoot, 'agents', entry.name, 'profile.json'));
        if (profile) members.set(entry.name, { id: entry.name, name: String(profile.name || entry.name).slice(0, 80) });
      }
    }
  } catch { /* No old agent folder. */ }
  return { stateRoot, appRoot, members: [...members.values()], channelCount: Array.isArray(channels?.channels) ? channels.channels.length : 0 };
}

/** What a dataset already holds: member ids, and whether setup ever ran.
 * "Never set up" means no onboarding receipt, no channels and no members, the
 * same test setup uses to tell a new installation from an existing one. */
export async function datasetState(dataset) {
  const [channels, onboarding] = await Promise.all([readJson(join(dataset.dataRoot, 'channels.json')), lstat(join(dataset.dataRoot, 'onboarding.json')).then(() => true, () => false)]);
  const members = channelMembers(channels).map(member => member.id);
  const channelCount = Array.isArray(channels?.channels) ? channels.channels.length : 0;
  return { memberIds: members, blank: !onboarding && !members.length && !channelCount };
}

/** The decision, given the facts. Returned values:
 *  - `import`: bring it back now (personal owner, blank dataset, old members, never done on this computer)
 *  - `offer`: show "Bring back your earlier squad" (old members missing from this dataset)
 *  - `none`: nothing to do */
export function decide({ actor, ownerKind, canWrite, marker, legacy, dataset }) {
  const missing = legacy.members.filter(member => !dataset.memberIds.includes(member.id));
  if (!missing.length || !canWrite) return { action: 'none', missing };
  if (!marker && ownerKind === 'user' && dataset.blank) return { action: 'import', missing };
  // Whoever dismissed the offer, or undid the import, isn't asked again.
  if ((marker?.dismissedBy || []).includes(actor) || (marker?.status === 'undone' && marker.actor === actor)) return { action: 'none', missing };
  return { action: 'offer', missing };
}
