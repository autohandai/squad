import { join } from 'node:path';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';

export const BREAK_REPLY = "I'm on my break, so I'm not accepting new work or handoffs. Use /break off when you want me back.";
export class MemberBreakError extends Error {
  constructor(memberId) { super(BREAK_REPLY); this.status = 409; this.reason = 'break'; this.memberId = memberId; this.reply = BREAK_REPLY; }
}

export class MemberAvailability {
  constructor(squadStateDir) {
    this.filename = join(squadStateDir, 'member-availability.json');
    this.snapshotFilename = join(squadStateDir, 'web-status.json');
    this.records = {};
    this.writing = Promise.resolve();
    this.ready = readPersistentJson(this.filename, { members: {} }).then((store) => { this.records = store.members || {}; });
  }
  async list() {
    await this.ready;
    const snapshot = await readPersistentJson(this.snapshotFilename, { members: [] });
    const members = Object.fromEntries(await Promise.all((snapshot.members || []).map(async (member) => [member.id, await this.get(member.id, member)])));
    return { ...members, ...structuredClone(this.records) };
  }
  async get(memberId, member = {}) {
    await this.ready;
    if (this.records[memberId]) return { ...this.records[memberId], reply: this.records[memberId].onBreak ? BREAK_REPLY : '' };
    const snapshot = await readPersistentJson(this.snapshotFilename, { members: [] });
    const saved = (snapshot.members || []).find((item) => item.id === memberId);
    const onBreak = (saved?.status || member.status) === 'paused';
    return { memberId, onBreak, breakStartedAt: saved?.breakStartedAt || member.breakStartedAt || null, endedAt: null, reply: onBreak ? BREAK_REPLY : '' };
  }
  async set(memberId, active) {
    await this.ready;
    if (!memberId || typeof active !== 'boolean') throw Object.assign(new Error('member id and active boolean are required'), { status: 400 });
    const at = new Date().toISOString();
    const record = { memberId, onBreak: active, breakStartedAt: active ? at : null, endedAt: active ? null : at, reply: active ? BREAK_REPLY : '' };
    this.records[memberId] = record;
    const snapshot = { version: 1, members: structuredClone(this.records) };
    this.writing = this.writing.catch(() => {}).then(() => writePersistentJson(this.filename, snapshot));
    await this.writing;
    return record;
  }
  async assertCanWork(payload) {
    const memberId = String(payload?.agentId || payload?.agent?.id || '').trim();
    if (memberId && (await this.get(memberId, payload.agent)).onBreak) throw new MemberBreakError(memberId);
  }
}
