// Actionable cards for the phone (host contract 0.4, ADR-0252).
//
// The Mac renders a member's decisions as structured cards under the reply:
// a permission question, a proposed automation, a proposed team. The phone
// receives the same decisions shaped as one generic card (title, detail,
// items, actions, state) with the desktop's words, and answers through
// `card.act`. Every decision goes through the route the desktop uses:
//
//   permission  POST /api/chat/permission                     (bridge, live turn)
//   schedule    POST /api/routines/proposals/:id/confirm|decline
//   team        recorded here; the Squad window creates the team through its
//               confirmed member-creation path (ADR-0077) and reports back
//
// This store remembers what the phone decided (a permission leaves the
// bridge's list once answered) and the team decisions waiting for the
// window. It holds no secret and no message text.
import { join } from 'node:path';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';

const MAX_ENTRIES = 2000;
const PERMISSION_ACTIONS = [
  { id: 'allow_once', label: 'Allow once', role: 'primary' },
  { id: 'allow_session', label: 'Allow for this reply', role: 'secondary' },
  { id: 'deny_once', label: 'Deny', role: 'destructive' },
];
const PERMISSION_RESULT = { allow_once: 'Allowed once', allow_session: 'Allowed for this reply', deny_once: 'Denied' };

export async function createCardStore({ directory, now = () => new Date().toISOString() }) {
  const file = join(directory, 'mobile-cards.json');
  let state = await readPersistentJson(file, { version: 1, cards: {} }).catch(() => ({ version: 1, cards: {} }));
  if (state?.version !== 1 || !state.cards || typeof state.cards !== 'object') state = { version: 1, cards: {} };
  let chain = Promise.resolve();
  const serial = fn => { const result = chain.then(fn); chain = result.catch(() => {}); return result; };
  return {
    get: id => state.cards[id] || null,
    teamEntry: receiptId => Object.values(state.cards).find(entry => entry.kind === 'team' && entry.receiptId === receiptId) || null,
    entries: () => Object.entries(state.cards).map(([id, entry]) => ({ id, ...entry })),
    set: (id, entry) => serial(async () => {
      const next = { version: 1, cards: { ...state.cards, [id]: { ...state.cards[id], ...entry, updatedAt: now() } } };
      const ids = Object.keys(next.cards);
      if (ids.length > MAX_ENTRIES) {
        ids.sort((a, b) => String(next.cards[a].updatedAt).localeCompare(String(next.cards[b].updatedAt)));
        for (const old of ids.slice(0, ids.length - MAX_ENTRIES)) delete next.cards[old];
      }
      await writePersistentJson(file, next);
      state = next;
      return next.cards[id];
    }),
  };
}

const card = ({ id, kind, state, title, detail = '', items = [], result = null, actions = [] }) =>
  ({ id, kind, state, title: String(title).slice(0, 200), detail: String(detail || '').slice(0, 600), items, result, actions: state === 'pending' ? actions : [] });

/** A pending request from GET /api/chat/permissions, or what the phone decided. */
export function permissionCard({ requestId, tool = 'tool', description = '' } = {}, entry = null, memberName = 'The member') {
  const id = `permission:${requestId}`;
  const title = `${memberName} asks to use ${tool}`;
  if (entry?.state && entry.state !== 'seen') return card({ id, kind: 'permission', state: entry.state, title: entry.title || title, detail: entry.detail || description, result: entry.result || null });
  return card({ id, kind: 'permission', state: 'pending', title, detail: description, actions: PERMISSION_ACTIONS });
}
export const permissionOutcome = action => ({ state: action === 'deny_once' ? 'declined' : 'done', result: PERMISSION_RESULT[action] });
export const PERMISSION_DECISIONS = PERMISSION_ACTIONS.map(action => action.id);

/** A routine proposal (publicProposal shape from the routines route). */
export function scheduleCard(proposal) {
  const id = `schedule:${proposal.id}`;
  const detail = [proposal.description, proposal.timeZone ? `(${proposal.timeZone})` : ''].filter(Boolean).join(' ');
  const title = `Proposed automation · ${proposal.title || 'Routine'}`;
  const next = Array.isArray(proposal.next) ? proposal.next.slice(0, 3).map(at => ({ title: 'Next run', detail: at })) : [];
  if (proposal.status === 'confirmed') return card({ id, kind: 'schedule', state: 'done', title, detail, result: 'Routine created. Change or pause it in Automations.' });
  if (proposal.status === 'declined') return card({ id, kind: 'schedule', state: 'declined', title, detail, result: 'Not created.' });
  if (proposal.status === 'failed') return card({ id, kind: 'schedule', state: 'failed', title, detail, result: proposal.message || 'The proposal was not recorded.' });
  if (proposal.expired) return card({ id, kind: 'schedule', state: 'expired', title, detail, result: 'This proposal expired; ask the member to propose it again.' });
  return card({ id, kind: 'schedule', state: 'pending', title, detail, items: next, actions: [
    { id: 'confirm', label: 'Create routine', role: 'primary' },
    { id: 'decline', label: 'Not now', role: 'secondary' },
  ] });
}

/** A `team` receipt (status "proposed") from a run's channelActions. */
export function teamCard(runId, receipt, entry = null, memberName = 'The member') {
  const proposal = receipt.proposal || {};
  const members = Array.isArray(proposal.members) ? proposal.members : [];
  const id = `team:${runId}:${receipt.id}`;
  const title = `${memberName} proposes the ${proposal.name || 'new'} team`;
  const items = members.map(member => ({ title: String(member.name || member.role || 'Member'),
    detail: [member.role && member.role.trim().toLowerCase() !== String(member.name || '').trim().toLowerCase() ? member.role : '', member.key && member.key === proposal.leadKey ? 'leads' : ''].filter(Boolean).join(' · ') }));
  const base = { id, kind: 'team', title, detail: proposal.objective || '', items };
  switch (entry?.state) {
    case 'requested': return card({ ...base, state: 'requested', result: 'Waiting for Squad on the computer to create it. Keep Squad open there.' });
    case 'done': return card({ ...base, state: 'done', result: entry.result || 'Members are being prepared; they appear in Squad as they get ready.' });
    case 'failed': return card({ ...base, state: 'failed', result: entry.result || 'The team could not be created.' });
    case 'declined': return card({ ...base, state: 'declined', result: 'Not created.' });
    default: return card({ ...base, state: 'pending', actions: [
      { id: 'create', label: `Create team · ${members.length} ${members.length === 1 ? 'member' : 'members'}`, role: 'primary' },
      { id: 'dismiss', label: 'Not now', role: 'secondary' },
    ] });
  }
}
