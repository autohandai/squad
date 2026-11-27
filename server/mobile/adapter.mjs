import { memberVoices, voiceById } from '../../src/lib/member-voice.js';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createBridgeClient, createTools } from '../control-plane/runtime.mjs';
import { harnessLabel } from '../../src/lib/harness.js';
import { birdFromAvatar } from '../../src/lib/bird-cast.js';
import { normalizeModelRouting, primaryRoute, routeKey } from '../../src/lib/model-routing.js';
import { isGroupChat } from '../../src/lib/group-chats.js';
import { PROFILE_LIMITS, personalityFromFile } from '../../src/lib/member-shaping.js';
import { needsResponderPick, resolveMentions, resolveResponderRecipients } from '../../src/lib/channel-responders.js';
import { PERMISSION_DECISIONS, permissionCard, permissionOutcome, scheduleCard, teamCard } from './cards.mjs';
import { createPhoneMarketplace } from './marketplace.mjs';

const AVATAR_BYTES = 512 * 1024;
const PICTURE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;
/** An uploaded picture travels as a key; its bytes only through `avatar`. */
const pictureKey = avatar => `picture:${createHash('sha256').update(avatar).digest('hex').slice(0, 24)}`;
export function phoneAvatar(avatar) {
  const value = String(avatar || '');
  if (birdFromAvatar(value)) return `/avatars/birds/${birdFromAvatar(value)}.webp`;
  return PICTURE.test(value) ? pictureKey(value) : '';
}
const groupID = z.object({ groupID: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/) });
const messageStatus = status => status === 'loading' || status === 'queued' || status === 'running' ? 'loading' : status === 'error' || status === 'failed' ? 'error' : 'complete';
const clip = (text, limit) => { const value = String(text || '').replace(/\s+/g, ' ').trim(); return value.length > limit ? `${value.slice(0, limit - 1)}…` : value; };

const memberID = z.object({ memberID: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/) });
/** What the phone shows and edits of a member's profile (contract 0.10; 0.11
 * adds the avatar, personality and skill ids the phone edits, ADR-0281). */
function phoneProfile(id, profile, context, avatar = '') {
  const skills = (Array.isArray(profile?.skills) ? profile.skills : []).map(skill => typeof skill === 'string' ? skill : skill?.name || skill?.id || '').filter(Boolean).slice(0, 40);
  const skillIDs = (Array.isArray(profile?.skills) ? profile.skills : []).map(skill => typeof skill === 'string' ? skill : skill?.id || '').filter(Boolean).slice(0, 32);
  return {
    avatar: phoneAvatar(avatar), skillIDs, maxSkills: 32,
    memberID: id, revision: Number(profile?.revision) || 0,
    name: String(profile?.name || ''), role: String(profile?.role || ''),
    description: String(profile?.description || ''), instructions: String(profile?.instructions || ''),
    personality: personalityFromFile(profile?.personality).slice(0, PROFILE_LIMITS.personality * 2), skills, workspace: String(profile?.workspace || ''),
    harness: harnessLabel(profile?.harness?.id || 'autohand'), voice: voiceById(profile?.voice)?.id || '',
    limits: { name: PROFILE_LIMITS.name, role: PROFILE_LIMITS.role, description: PROFILE_LIMITS.description, instructions: PROFILE_LIMITS.instructions, personality: PROFILE_LIMITS.personality },
    canEdit: Boolean(context?.canWrite),
  };
}
/** The phone uses the same roster, transcripts and durable queue as MCP/CLI. */
export function createMobileAdapter({ preferences = () => ({ confirmPhoneAdds: true }), origin, computerID, version, computerName = hostname(), assignTask, announcements, rootDir = '', cards = null, emit = () => {} }) {
  const bridge = createBridgeClient(origin), tools = createTools(bridge);
  // The marketplace (contract 0.5, ADR-0256): reads through this computer,
  // an Add the Squad window carries out.
  const marketplace = createPhoneMarketplace({ bridge, cards, emit, confirmOnComputer: () => preferences().confirmPhoneAdds !== false,
    // The member record the desktop's Publish dialog starts from (ADR-0289).
    memberRecord: async id => { await member(id); return (await bridge.get('/api/channels'))?.agentChannelAccess?.[id]?.agent || null; },
    canWrite: async () => { const context = await bridge.get('/api/ownership/context'); return Boolean(context?.canWrite) && context.state === 'ready'; } });
  // The 256 px renders the menu bar reads (scripts/build-bird-cast.mjs);
  // the installed app serves dist/, a checkout also has public/.
  const birdDirs = rootDir ? [join(rootDir, 'dist', 'avatars', 'birds', '256'), join(rootDir, 'public', 'avatars', 'birds', '256')] : [];
  const avatarOf = (channels, status, id) => channels?.agentChannelAccess?.[id]?.agent?.avatar || (status?.members || []).find(row => row?.id === id)?.avatar || '';
  const currentAvatar = async id => avatarOf(await bridge.get('/api/channels').catch(() => null), await bridge.get('/api/status/snapshot').catch(() => null), id);
  const groupsOf = state => (state?.channels || []).filter(isGroupChat);
  function groupMessages(state, id) {
    return (state?.messages || []).filter(message => message?.channelId === id && message.body)
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  }
  async function birdFile(bird) {
    for (const directory of birdDirs) {
      const data = await readFile(join(directory, `${bird}.webp`)).catch(() => null);
      if (data) return data;
    }
    return null;
  }
  async function cardsFor(memberId, memberName, messages) {
    if (!cards) return new Map();
    const [pending, proposals] = await Promise.all([
      bridge.get(`/api/chat/permissions?agentId=${encodeURIComponent(memberId)}`).then(data => data?.pending || []).catch(() => []),
      bridge.get(`/api/routines/proposals?memberId=${encodeURIComponent(memberId)}`).then(data => data?.proposals || []).catch(() => []),
    ]);
    const byTurn = new Map(), add = (turn, card) => byTurn.set(turn, [...(byTurn.get(turn) || []), card]);
    const runToTurn = new Map(messages.filter(message => message.role === 'agent' && message.runId).map(message => [message.runId, message.requestId]));
    const live = new Set();
    for (const request of pending) {
      const turn = runToTurn.get(request.runId);
      if (!turn) continue;
      const id = `permission:${request.requestId}`;
      live.add(id);
      const entry = cards.get(id);
      if (!entry) await cards.set(id, { kind: 'permission', state: 'seen', runId: request.runId, memberId, title: `${memberName} asks to use ${request.tool}`, detail: request.description });
      add(turn, permissionCard(request, entry, memberName));
    }
    // Asked earlier, gone from the live list: answered or the turn ended.
    for (const entry of cards.entries()) {
      if (entry.kind !== 'permission' || entry.memberId !== memberId || live.has(entry.id) || !runToTurn.has(entry.runId)) continue;
      const settled = entry.state === 'seen' ? { ...entry, state: 'expired', result: 'No longer waiting: answered on the computer, or the reply ended.' } : entry;
      add(runToTurn.get(entry.runId), permissionCard({ requestId: entry.id.slice('permission:'.length), tool: '', description: entry.detail }, settled, memberName));
    }
    const turns = new Set(messages.map(message => message.requestId));
    for (const proposal of proposals) if (proposal.requestId && turns.has(proposal.requestId) && proposal.status !== 'failed') add(proposal.requestId, scheduleCard(proposal));
    for (const message of messages) {
      if (message.role !== 'agent' || !message.teamProposal?.id || !message.runId) continue;
      add(message.requestId, teamCard(message.runId, message.teamProposal, cards.teamEntry(message.teamProposal.id), memberName));
    }
    return byTurn;
  }
  // The phone's Inbox (contract 0.6, ADR-0263): decisions waiting on the
  // person across every member, each as the same card the chat shows so it
  // can be answered in place, and replies that stopped in the last two days.
  // Unread replies are worked out on the phone from what it has opened.
  const STOPPED_WINDOW_MS = 48 * 3600_000;
  async function inbox() {
    const [{ members }, pending, proposals, runs] = await Promise.all([
      tools.list_members(),
      bridge.get('/api/chat/permissions').then(data => data?.pending || []).catch(() => []),
      bridge.get('/api/routines/proposals').then(data => data?.proposals || []).catch(() => []),
      bridge.get('/api/runs').catch(() => []),
    ]);
    const names = new Map(members.map(row => [row.id, row.name]));
    const decisions = [];
    for (const request of pending) {
      const memberName = names.get(request.agentId);
      if (!memberName) continue;
      const id = `permission:${request.requestId}`;
      let entry = cards.get(id);
      if (!entry) entry = await cards.set(id, { kind: 'permission', state: 'seen', runId: request.runId, memberId: request.agentId, title: `${memberName} asks to use ${request.tool}`, detail: request.description });
      decisions.push({ memberID: request.agentId, memberName, at: request.createdAt || request.requestedAt || '', card: permissionCard(request, entry, memberName) });
    }
    for (const proposal of proposals) {
      if (proposal.status !== 'proposed' || !names.has(proposal.memberId)) continue;
      decisions.push({ memberID: proposal.memberId, memberName: names.get(proposal.memberId), at: proposal.createdAt || '', card: scheduleCard(proposal) });
    }
    const now = Date.now(), seen = new Set(), stopped = [];
    for (const run of Array.isArray(runs) ? runs : runs?.runs || []) {
      if (!['failed', 'stopped', 'blocked', 'error'].includes(run.status) || !names.has(run.agentId)) continue;
      const at = run.finishedAt || run.updatedAt || run.startedAt || '';
      if (at && now - Date.parse(at) > STOPPED_WINDOW_MS) continue;
      // One row per member and question: asking again after a failure is one thing to look at.
      const key = `${run.agentId}\n${String(run.title || run.prompt || '').slice(0, 120)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stopped.push({ memberID: run.agentId, memberName: names.get(run.agentId), title: String(run.title || 'A reply').slice(0, 160), status: run.status === 'error' ? 'failed' : run.status,
        reason: String(run.error || run.reason || '').slice(0, 300), at });
      if (stopped.length >= 20) break;
    }
    return { decisions: decisions.sort((a, b) => String(b.at).localeCompare(String(a.at))), stopped };
  }
  async function decide(cardID, action) {
    const [kind, ...rest] = String(cardID).split(':');
    if (kind === 'permission') {
      const requestId = rest.join(':'), entry = cards.get(cardID), memberName = entry?.title?.split(' asks to use ')[0] || 'The member';
      if (entry && entry.state !== 'seen') return permissionCard({ requestId }, entry, memberName);
      if (!PERMISSION_DECISIONS.includes(action)) throw Error('Choose Allow once, Allow for this reply or Deny.');
      try { await bridge.post('/api/chat/permission', { requestId, decision: action }); }
      catch (failure) {
        const expired = await cards.set(cardID, { kind: 'permission', ...entry, state: 'expired', result: `No longer waiting: ${failure.message}` });
        return permissionCard({ requestId }, expired, memberName);
      }
      return permissionCard({ requestId }, await cards.set(cardID, { kind: 'permission', ...entry, ...permissionOutcome(action), decidedAt: new Date().toISOString(), source: 'phone' }), memberName);
    }
    if (kind === 'schedule') {
      const id = rest.join(':');
      if (!['confirm', 'decline'].includes(action)) throw Error('Choose Create routine or Not now.');
      const find = async () => ((await bridge.get('/api/routines/proposals')).proposals || []).find(proposal => proposal.id === id);
      const current = await find();
      if (!current) throw Error('This automation proposal is no longer on the computer.');
      if (current.status !== 'proposed') return scheduleCard(current);
      try { return scheduleCard((await bridge.post(`/api/routines/proposals/${encodeURIComponent(id)}/${action}`, {})).proposal); }
      catch (failure) {
        const after = await find();
        if (after && after.status !== 'proposed') return scheduleCard(after);
        return { ...scheduleCard(after || current), state: 'failed', actions: [], result: failure.message };
      }
    }
    if (kind === 'team' && rest.length >= 2) {
      const receiptId = rest.at(-1), runId = rest.slice(0, -1).join(':');
      if (!['create', 'dismiss'].includes(action)) throw Error('Choose Create team or Not now.');
      const run = await bridge.get(`/api/runs/${encodeURIComponent(runId)}`).catch(() => null);
      const receipt = (run?.channelActions || []).find(item => item?.type === 'team' && item.id === receiptId && item.proposal);
      if (!receipt) throw Error('This team proposal is no longer on the computer.');
      const memberName = (await member(run.agentId).catch(() => null))?.name || 'The member';
      const entry = cards.teamEntry(receiptId);
      if (entry?.state) return teamCard(runId, receipt, entry, memberName);
      const next = await cards.set(cardID, { kind: 'team', receiptId, runId, memberId: run.agentId, workspace: receipt.workspace || run.workspace || '', proposal: receipt.proposal,
        action, state: action === 'create' ? 'requested' : 'declined', desktopApplied: false, decidedAt: new Date().toISOString(), source: 'phone' });
      emit('mobile.decisions.changed');
      return teamCard(runId, receipt, next, memberName);
    }
    throw Error('This card is no longer on the computer.');
  }
  async function member(id) {
    const { members } = await tools.list_members(), found = members.find(row => row.id === id);
    if (!found) throw Error('This member is no longer in this Squad.');
    return found;
  }
  async function requireLocalExecution(id) {
    const remotes = await bridge.get('/api/remote/members');
    if ((Array.isArray(remotes) ? remotes : remotes?.members || []).some(row => row.memberId === id)) {
      throw Error('This member runs on another computer. Pair that computer to send work there from your phone.');
    }
  }
  // Which engine answers for a member right now (ADR-0222): the saved primary,
  // and while it cools down after a failure, the first fallback that is not.
  // The same route keys and health the desktop's Fallbacks status line reads.
  async function engineStatus(id, agent) {
    if (!agent?.harness) return undefined;
    const primary = primaryRoute({ agent });
    const status = { primary: harnessLabel(primary.harness.id) };
    const routing = await bridge.get(`/api/members/${encodeURIComponent(id)}/model-routing`).catch(() => null);
    if (!routing) return status;
    const now = Date.now(), cooling = route => { const entry = routing.health?.[routeKey(route)]; return entry && Number(entry.blockedUntil) > now ? entry : null; };
    const down = cooling(primary);
    if (!down) return status;
    const fallback = normalizeModelRouting(routing.configuration).fallbacks.find(route => !cooling(route));
    return { ...status, inUse: fallback ? harnessLabel(fallback.harness.id) : null, reason: String(down.reason || ''), retryAt: new Date(Number(down.blockedUntil)).toISOString() };
  }
  async function execute(command, parameters, { deviceID, requestID }) {
      if (command === 'snapshot') {
        z.object({}).strict().parse(parameters);
        const [{ members }, remotes, context, channels, status, settings] = await Promise.all([tools.list_members(), bridge.get('/api/remote/members'), bridge.get('/api/ownership/context'), bridge.get('/api/channels').catch(() => null), bridge.get('/api/status/snapshot').catch(() => null), bridge.get('/api/system/settings').catch(() => null)]);
        // Each member's reading voice (contract 0.8, ADR-0276): the same voice
        // the desktop reads it with, saved or given by the squad.
        const voices = memberVoices(Object.values(channels?.agentChannelAccess || {}).filter(access => !access.removed && access.agent?.id).map(access => access.agent));
        // The avatar style the phone mirrors (contract 0.7, ADR-0272).
        const avatarStyle = ['flat', '3d', 'clay'].includes(settings?.avatarStyle) ? settings.avatarStyle : '';
        // The member's bird (ADR-0243), as the same /avatars/birds/<bird>.webp
        // the menu bar reads; uploaded pictures stay on the computer.
        // A picture the person uploaded travels as `picture:<hash>` (ADR-0252).
        const avatars = new Map(members.map(row => [row.id, phoneAvatar(avatarOf(channels, status, row.id))]).filter(([, avatar]) => avatar));
        const engines = new Map(await Promise.all(members.map(async row => [row.id, await engineStatus(row.id, channels?.agentChannelAccess?.[row.id]?.agent)])));
        // Recency for Recent chats: the newest direct turn per member, and
        // each group's newest message (contract 0.4).
        const lastTurns = new Map(await Promise.all(members.map(async row => {
          const transcript = await tools.get_conversation({ member_id: row.id, limit: 1 }).catch(() => null);
          const last = (transcript?.messages || []).at(-1);
          return [row.id, last ? last.completedAt || last.startedAt || null : null];
        })));
        const groups = groupsOf(channels).map(group => {
          const last = groupMessages(channels, group.id).at(-1);
          return { id: group.id, name: group.name, memberIDs: [...(group.memberIds || [])], createdAt: group.createdAt || '',
            lastMessageAt: last?.createdAt || null, preview: last ? { author: last.role === 'user' ? 'You' : last.authorName || last.agentId || 'Member', text: clip(last.body, 140) } : null };
        }).sort((a, b) => String(b.lastMessageAt || b.createdAt).localeCompare(String(a.lastMessageAt || a.createdAt))).slice(0, 50);
        return { computer: { id: computerID, name: computerName, version, connectedAt: new Date().toISOString() },
          capabilities: [...(assignTask ? ['tasks', ...(context.canWrite ? ['delegate'] : [])] : []), ...(announcements ? ['announcements'] : []), ...(rootDir ? ['avatars'] : []), ...(channels ? ['groups'] : []), ...(cards ? ['cards', 'inbox'] : []), 'marketplace', 'feedback', 'voices', 'profiles', 'profileEdits', 'publish'],
          ...(context.actor ? { account: { id: context.actor.id, name: context.actor.name || '', email: context.actor.email || '' } } : {}),
          members: members.map(row => {
            const remote = (Array.isArray(remotes) ? remotes : remotes?.members || []).find(remote => remote.memberId === row.id);
            return { id: row.id, name: row.name || row.id, role: row.role || '', presence: row.presence || 'unknown',
              harness: typeof row.harness === 'string' ? row.harness : row.harness?.id || '',
              executionMode: remote ? 'remoteComputer' : 'workspace', computerName: remote?.label || computerName,
              workspace: remote?.workspace || row.lastWorkspace || '', ...(engines.get(row.id) ? { engine: engines.get(row.id) } : {}), ...(avatars.has(row.id) ? { avatar: avatars.get(row.id) } : {}), ...(voices.get(row.id) ? { voice: voices.get(row.id) } : {}), ...(lastTurns.get(row.id) ? { lastMessageAt: lastTurns.get(row.id) } : {}) };
          }), ...(channels ? { groups } : {}), ...(avatarStyle ? { appearance: { avatarStyle } } : {}) };
      }
      if (command === 'conversation') {
        const { memberID: id } = memberID.strict().parse(parameters);
        const recipient = await member(id);
        const transcript = await tools.get_conversation({ member_id: id, limit: 30 });
        const messages = transcript.messages || [];
        const byTurn = await cardsFor(id, recipient.name || id, messages);
        const turns = [];
        for (const message of messages) {
          if (message.role !== 'user') continue;
          const reply = messages.find(row => row.requestId === message.requestId && row.role === 'agent');
          const attached = byTurn.get(message.requestId);
          turns.push({ id: message.requestId, prompt: message.body || '', reply: reply?.body || '', status: reply?.status || 'queued', error: '', ...(attached?.length ? { cards: attached } : {}) });
        }
        return { turns };
      }
      if (command === 'message') {
        const { memberID: id, text } = memberID.extend({ text: z.string().trim().min(1).max(20000) }).strict().parse(parameters);
        const recipient = await member(id);
        await requireLocalExecution(id);
        if (!recipient.lastWorkspace) throw Error('Choose this member’s workspace in Squad on your computer first.');
        const item = await bridge.post(`/api/queues/${encodeURIComponent(id)}/items`, { text, workspace: recipient.lastWorkspace, clientRequestId: `mobile_${deviceID}_${requestID}` });
        return { messageID: item.id, status: item.status };
      }
      if (command === 'delegate' && assignTask) {
        const input = memberID.extend({ title: z.string().trim().min(1).max(160), detail: z.string().max(2000).default('') }).strict().parse(parameters);
        const recipient = await member(input.memberID);
        await requireLocalExecution(recipient.id);
        const context = await bridge.get('/api/ownership/context');
        if (!context.canWrite || context.state !== 'ready') throw Error('This Squad is read-only. Choose an authorized Squad on your computer before assigning work.');
        const receipt = await assignTask({ from: { id: `person:${context.actor.id}`, name: context.actor.name || 'the person' }, to: recipient,
          title: input.title, detail: input.detail, requestId: `mobile_${deviceID}_${requestID}` });
        return { taskID: receipt.taskId, status: receipt.status === 'done' ? 'completed' : receipt.status, assignee: recipient.id };
      }
      if (command === 'tasks' && assignTask) {
        z.object({}).strict().parse(parameters);
        const { tasks } = await bridge.get('/api/work');
        return { tasks: [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50).map(task => ({
          id: task.id, title: task.title, detail: task.detail, assignee: task.memberId, updatedAt: task.updatedAt,
          status: task.status === 'done' ? 'completed' : task.status === 'blocked' ? 'failed' : task.status === 'doing' ? 'running' : 'queued',
        })) };
      }
      if (command === 'announcements' && announcements) {
        const { appVersion } = z.object({ appVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/).max(60).default('0.1.0') }).strict().parse(parameters);
        return announcements.list({ platform: 'ios', version: appVersion });
      }
      if (command === 'announcement.act' && announcements) {
        const { id, action, step } = z.object({ id: z.string().regex(/^[\w-]{1,100}$/), action: z.enum(['seen', 'dismiss']), step: z.number().int().min(0).max(49).default(0) }).strict().parse(parameters);
        return announcements.act(id, action, step);
      }
      if (command === 'avatar' && rootDir) {
        const input = z.union([z.object({ bird: z.string().regex(/^[a-z]{1,40}$/) }).strict(), memberID.strict()]).parse(parameters);
        if ('bird' in input) {
          const data = birdFromAvatar(`/avatars/birds/${input.bird}.webp`) ? await birdFile(input.bird) : null;
          if (!data || data.length > AVATAR_BYTES) throw Error('This bird is not on this computer.');
          return { contentType: 'image/webp', data: data.toString('base64'), key: input.bird };
        }
        await member(input.memberID);
        const [channels, status] = await Promise.all([bridge.get('/api/channels').catch(() => null), bridge.get('/api/status/snapshot').catch(() => null)]);
        const avatar = avatarOf(channels, status, input.memberID), bird = birdFromAvatar(avatar);
        if (bird) return execute('avatar', { bird }, {});
        const match = PICTURE.exec(String(avatar || ''));
        if (!match || Buffer.byteLength(match[2], 'base64') > AVATAR_BYTES) throw Error('This member has no picture to send.');
        return { contentType: match[1], data: match[2], key: pictureKey(avatar) };
      }
      if (command === 'group.conversation') {
        const { groupID: id } = groupID.strict().parse(parameters);
        const state = await bridge.get('/api/channels');
        if (!groupsOf(state).some(group => group.id === id)) throw Error('This group chat is no longer on the computer.');
        return { messages: groupMessages(state, id).slice(-60).map(message => ({ id: message.id, role: message.role === 'user' ? 'person' : 'member',
          ...(message.role === 'user' ? {} : { memberID: message.agentId || '' }), authorName: message.role === 'user' ? 'You' : message.authorName || message.agentId || 'Member',
          body: String(message.body || '').slice(0, 20000), status: messageStatus(message.status), createdAt: message.createdAt || '' })) };
      }
      if (command === 'group.message') {
        const { groupID: id, text } = groupID.extend({ text: z.string().trim().min(1).max(20000) }).strict().parse(parameters);
        const state = await bridge.get('/api/channels');
        const group = groupsOf(state).find(item => item.id === id);
        if (!group) throw Error('This group chat is no longer on the computer.');
        const { members } = await tools.list_members();
        const roster = members.filter(row => group.memberIds.includes(row.id));
        // Who answers, by the desktop's rules (ADR-0108): mentions and @here
        // win, otherwise the group's responder mode; Auto asks the bridge.
        const mentions = resolveMentions(text, roster.map(row => ({ id: row.id, name: row.name || row.id, formerNames: state.agentChannelAccess?.[row.id]?.agent?.formerNames || [] })));
        let pick = null;
        if (needsResponderPick(mentions, group)) {
          const lines = groupMessages(state, id).slice(-6).map(message => `${message.role === 'user' ? 'You' : message.authorName || message.agentId}: ${String(message.body).slice(0, 240)}`);
          pick = await bridge.post(`/api/channels/${encodeURIComponent(id)}/responders/pick`, { message: text, members: roster.map(row => ({ id: row.id, name: row.name || row.id, role: row.role || '', purpose: '' })), lines })
            .then(data => data?.responder ? { ...data.responder, memberIds: data.memberIds } : { reason: data?.reason || 'pick unavailable' }).catch(failure => ({ reason: `pick failed: ${failure.message}` }));
        }
        const recipients = resolveResponderRecipients({ mentions, channel: group, pick }).memberIds.filter(memberId => roster.some(row => row.id === memberId));
        const remotes = await bridge.get('/api/remote/members').catch(() => []);
        const remoteIds = new Set((Array.isArray(remotes) ? remotes : remotes?.members || []).map(row => row.memberId));
        const messageID = `mobile-${randomUUID()}`, threadId = `thread-${randomUUID()}`, at = new Date().toISOString();
        await bridge.put('/api/channels/sync', {
          threads: [{ id: threadId, channelId: id, parentMessageId: messageID, title: text.slice(0, 160), creatorId: 'person', memberIds: recipients, createdAt: at, updatedAt: at }],
          messages: { [id]: [{ id: messageID, role: 'user', body: text, authorName: 'You', threadId, targetMemberIds: recipients, status: 'complete', createdAt: at, updatedAt: at }] },
        });
        const deliveries = await Promise.all(recipients.map(async memberId => {
          if (remoteIds.has(memberId)) return { memberID: memberId, status: 'skipped', reason: 'Runs on another computer.' };
          const row = roster.find(item => item.id === memberId);
          const workspace = (await bridge.get(`/api/control-plane/members/${encodeURIComponent(memberId)}`).catch(() => null))?.workspace || row?.lastWorkspace || '';
          if (!workspace) return { memberID: memberId, status: 'skipped', reason: 'Choose this member’s workspace in Squad on your computer first.' };
          try {
            const run = await bridge.post('/api/runs', { agentId: memberId, prompt: text, workspace, title: text.slice(0, 120), channel: { channelId: id, channelName: group.name, threadId, parentMessageId: messageID, operatorReply: true } });
            return { memberID: memberId, status: run.status === 'running' ? 'running' : 'queued' };
          } catch (failure) { return { memberID: memberId, status: 'failed', reason: String(failure.message || failure) }; }
        }));
        return { messageID, deliveries };
      }
      if (command === 'card.act' && cards) {
        const { cardID, action } = z.object({ cardID: z.string().min(3).max(300), action: z.string().regex(/^[a-z_]{1,40}$/) }).strict().parse(parameters);
        return { card: await decide(cardID, action) };
      }
      if (command === 'inbox' && cards) {
        z.object({}).strict().parse(parameters);
        return inbox();
      }
      // A member's reading voice, changed from the phone (contract 0.9, ADR-0276):
      // the same revision-checked edit the desktop's Voice page makes.
      if (command === 'member.voice') {
        const { memberID: id, voice } = memberID.extend({ voice: z.string().min(2).max(20) }).strict().parse(parameters);
        if (!voiceById(voice)) throw Error('Choose one of Squad\'s ten voices.');
        const context = await bridge.get('/api/ownership/context');
        if (!context?.canWrite) throw Error('This Squad is read-only here; change the voice on the computer.');
        await member(id);
        const profile = await bridge.get(`/api/control-plane/members/${encodeURIComponent(id)}`);
        const saved = await bridge.patch(`/api/control-plane/members/${encodeURIComponent(id)}`, { voice: voiceById(voice).id, expectedRevision: profile.revision });
        return { memberID: id, voice: voiceById(saved.voice)?.id || voiceById(voice).id };
      }
      // A member's profile, read and edited from the phone (contract 0.10,
      // ADR-0279): the same revision-checked profile the desktop's Edit
      // Profile saves, in the signed-in owner's Squad on this computer. A
      // stale revision is refused, so the phone and the desktop never
      // overwrite each other's edit unseen.
      if (command === 'member.profile') {
        const { memberID: id } = memberID.strict().parse(parameters);
        await member(id);
        const [profile, context, avatar] = await Promise.all([bridge.get(`/api/control-plane/members/${encodeURIComponent(id)}`), bridge.get('/api/ownership/context'), currentAvatar(id)]);
        return phoneProfile(id, profile, context, avatar);
      }
      if (command === 'member.skills') {
        const { memberID: id, query, offset } = memberID.extend({ query: z.string().max(200).default(''), offset: z.number().int().min(0).max(100000).default(0) }).strict().parse(parameters);
        await member(id);
        const profile = await bridge.get(`/api/control-plane/members/${encodeURIComponent(id)}`);
        const catalog = await bridge.get(`/api/skills/catalog?${new URLSearchParams({ q: query, workspace: profile.workspace || '', offset: String(offset) })}`);
        return { skills: (catalog.skills || []).filter(skill => !skill.unavailable).map(skill => ({ id: String(skill.id), name: clip(skill.name || skill.id, 80),
          category: clip(skill.category, 60), description: clip(skill.description || skill.manifest?.description, 280), local: skill.local === true })),
          total: Number(catalog.total) || 0, hasMore: catalog.hasMore === true };
      }
      if (command === 'member.avatar.set') {
        const { memberID: id, bird, expectedRevision } = memberID.extend({ bird: z.string().regex(/^[a-z]{1,40}$/), expectedRevision: z.number().int().min(0) }).strict().parse(parameters);
        const context = await bridge.get('/api/ownership/context');
        if (!context?.canWrite) throw Error('This Squad is read-only here; change the avatar on the computer.');
        await member(id);
        const saved = await bridge.put(`/api/control-plane/members/${encodeURIComponent(id)}/avatar`, { bird, expectedRevision });
        return phoneProfile(id, saved, context, saved.avatar);
      }
      if (command === 'member.update') {
        const text = limit => z.string().max(limit * 2);
        const input = memberID.extend({ expectedRevision: z.number().int().min(0), name: text(PROFILE_LIMITS.name).optional(), role: text(PROFILE_LIMITS.role).optional(),
          description: text(PROFILE_LIMITS.description).optional(), instructions: text(PROFILE_LIMITS.instructions).optional(),
          personality: text(PROFILE_LIMITS.personality).optional(), skills: z.array(z.string().trim().min(1).max(500)).max(32).optional() }).strict().parse(parameters);
        const { memberID: id, expectedRevision, ...fields } = input;
        if (!Object.keys(fields).length) throw Error('Change a field before saving.');
        if (fields.name !== undefined && !fields.name.trim()) throw Error('A member needs a name.');
        const context = await bridge.get('/api/ownership/context');
        if (!context?.canWrite) throw Error('This Squad is read-only here; edit the profile on the computer.');
        await member(id);
        const saved = await bridge.patch(`/api/control-plane/members/${encodeURIComponent(id)}`, { ...fields, expectedRevision });
        return phoneProfile(id, saved, context, await currentAvatar(id));
      }
      if (command === 'feedback.send') {
        const input = z.object({ kind: z.enum(['bug', 'feedback']), summary: z.string().min(8).max(200), detail: z.string().max(8000).optional(),
          automatic: z.boolean().optional(), appVersion: z.string().max(40).optional(), device: z.string().max(80).optional() }).strict().parse(parameters);
        const about = [input.appVersion && `Squad for iPhone ${input.appVersion}`, input.device].filter(Boolean).join(' · ');
        return bridge.post('/api/feedback/agent', { kind: input.kind, summary: input.summary,
          detail: [input.detail || '', about ? `(${about})` : ''].filter(Boolean).join('\n\n'),
          reporter: input.automatic ? 'Squad for iPhone, automatically' : 'the person in Squad for iPhone', via: input.automatic ? 'phone-automatic' : 'phone' });
      }
      if (marketplace.commands.includes(command)) return marketplace.execute(command, parameters, { deviceID, requestID });
      throw Error('This action is unavailable from a phone.');
  }
  return {
    /** Marketplace adds a phone decided, for the Squad window (ADR-0256). */
    marketplacePending: () => marketplace.pending(),
    claimMarketplace: requestID => marketplace.claim(requestID),
    settleMarketplace: value => marketplace.settle(value),
    assertCurrent: () => bridge.get('/api/ownership/context'),
    execute,
    /** Team decisions the Squad window has not carried out yet (ADR-0252). */
    teamDecisions: () => (cards ? cards.entries().filter(entry => entry.kind === 'team' && entry.desktopApplied === false) : []).map(({ id, receiptId, runId, memberId, workspace, proposal, action, state }) => ({ cardID: id, receiptId, runId, memberId, workspace, proposal, action, state })),
    /** One window carries a decision out; a second one is refused for two minutes. */
    async claimTeam(receiptId) {
      const entry = cards?.teamEntry(receiptId);
      if (!entry || entry.desktopApplied !== false) return false;
      if (entry.claimedAt && Date.now() - Date.parse(entry.claimedAt) < 120_000) return false;
      const id = cards.entries().find(item => item.kind === 'team' && item.receiptId === receiptId).id;
      await cards.set(id, { claimedAt: new Date().toISOString() });
      return true;
    },
    /** The window carried a decision out, or the person decided on the Mac. */
    async settleTeam({ receiptId, state, result = '', runId = '' }) {
      if (!cards) throw Error('Cards are unavailable.');
      const entry = cards.teamEntry(receiptId);
      const id = entry ? cards.entries().find(item => item.kind === 'team' && item.receiptId === receiptId).id : `team:${runId || 'desktop'}:${receiptId}`;
      const final = entry?.state && entry.state !== 'requested' ? entry.state : state;
      return cards.set(id, { kind: 'team', receiptId, ...(runId && !entry?.runId ? { runId } : {}), state: final, ...(final === state && result ? { result: String(result).slice(0, 300) } : {}), desktopApplied: true, settledAt: new Date().toISOString() });
    },
  };
}