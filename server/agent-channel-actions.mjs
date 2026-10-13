import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { channelError } from './channels-store.mjs';
import { resolveMentions, resolveResponderRecipients } from '../src/lib/channel-responders.js';

const at = () => new Date().toISOString();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nameKey = value => String(value || '').replace(/^@/, '').trim().toLowerCase();
const mode = agent => ['allow', 'ask', 'block'].includes(agent?.permissions?.builtInPolicies?.squad_create_channel) ? agent.permissions.builtInPolicies.squad_create_channel : 'ask';
const workspaceModes = agent => Object.fromEntries(Object.entries(agent?.channelPoliciesByWorkspace || {}).filter(([, policy]) => ['allow', 'ask', 'block'].includes(policy)));
const paths = agent => [...new Set([...(agent?.projects || []).map(p => p.path), agent?.workspace].filter(Boolean))];
const memberFields = ['id', 'name', 'role', 'description', 'instructions', 'brainCard', 'skills', 'permissions', 'modelAssignment', 'harness', 'projects', 'workspace', 'launch', 'status', 'staffId', 'profileFiles', 'profileDocs', 'skillSource', 'skillInstall'];
const memberCopy = (agent, id) => Object.fromEntries(memberFields.filter(key => key in agent).map(key => [key, key === 'id' ? id : structuredClone(agent[key]) ]));

function parseReply(reply) {
  const actions = [];
  const text = String(reply || '').split('\n').filter(line => {
    if (!/^\s*SQUAD_ACTION\s*:/.test(line)) return true;
    try { actions.push(JSON.parse(line.slice(line.indexOf(':') + 1))); }
    catch { actions.push({ invalid: 'Channel action was not valid JSON.' }); }
    return false;
  }).join('\n').trim();
  return { text, actions };
}

// The execution wrapper supplies identity and scope. Model output supplies only
// channel name, named teammates and purpose. Permissions, proposals, channels
// and purpose receipts share the existing channel mutation queue and document.
export function createAgentChannelActions({ store, availability, sanitizeId, run, reportError = console.error }) {
  let draining = false;
  const schedule = () => setImmediate(() => drain().catch(reportError));
  const register = (state, agent, profile = '') => {
    if (!agent?.id) return;
    const id = sanitizeId(agent.id);
    if (!state.agentChannelAccess[id]) state.agentChannelAccess[id] = { agent: memberCopy(agent, id), profile: String(profile || agent.squadProfile || '').slice(0, 64000), mode: mode(agent), workspaceModes: workspaceModes(agent), removed: false, updatedAt: at() };
  };
  async function begin(payload) {
    const actorId = sanitizeId(payload.agent?.id || payload.agentId);
    const identityValid = !payload.agent?.id || !payload.agentId || sanitizeId(payload.agent.id) === sanitizeId(payload.agentId);
    await store.mutate(state => {
      register(state, payload.agent, payload.profile);
      for (const member of (Array.isArray(payload.squadMembers) ? payload.squadMembers : []).slice(0, 200)) register(state, member);
    });
    return { actorId, identityValid, requestId: String(payload.requestId || randomUUID()).slice(0, 200), workspace: String(payload.workspace || ''), depth: Number(payload._channelActionDepth) || 0 };
  }
  async function setAccess(id, input) {
    id = sanitizeId(id);
    return store.mutate(state => {
      const previous = state.agentChannelAccess[id];
      if (input.removed === true) {
        state.agentChannelAccess[id] = { ...previous, removed: true, mode: 'block', updatedAt: at() };
      } else {
        if (!input.agent || sanitizeId(input.agent.id) !== id) throw channelError('Matching member configuration is required.');
        state.agentChannelAccess[id] = { agent: memberCopy(input.agent, id), profile: String(input.profile || previous?.profile || '').slice(0, 64000), mode: mode(input.agent), workspaceModes: workspaceModes(input.agent), removed: false, updatedAt: at() };
      }
      return { memberId: id, mode: state.agentChannelAccess[id].mode, removed: state.agentChannelAccess[id].removed, updatedAt: state.agentChannelAccess[id].updatedAt };
    });
  }
  async function assertActor(state, context, approved = false) {
    if (!context.identityValid) throw channelError('The action identity does not match the executing member.', 409);
    const actor = state.agentChannelAccess[context.actorId];
    if (!actor || actor.removed) throw channelError('This member is no longer available.', 409);
    if (!paths(actor.agent).includes(context.workspace)) throw channelError('The channel workspace is outside this member’s assigned projects.', 409);
    await availability.assertCanWork({ agentId: context.actorId, agent: actor.agent });
    const policy = actor.workspaceModes?.[context.workspace] || actor.mode;
    if (policy === 'block') throw channelError('Channel creation is blocked by this member’s current permissions.', 403);
    if (context.depth >= 2) throw channelError('Automatic channel creation reached its handoff limit. Ask the user to open another channel.', 409);
    if (!approved && policy === 'ask') return 'ask';
    return 'allow';
  }
  function validateAction(state, context, action) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) throw channelError('Channel action must be an object.');
    if (action.invalid) throw channelError(action.invalid);
    if (Object.keys(action).some(key => !['type', 'name', 'members', 'purpose'].includes(key))) throw channelError('Channel actions may only contain type, name, members and purpose.');
    if (action.type !== 'create_channel') throw channelError('This channel action is not supported.');
    const name = String(action.name || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    if (!name) throw channelError('Give the proposed channel a name.');
    if (action.members !== undefined && (!Array.isArray(action.members) || action.members.length > 50 || action.members.some(m => typeof m !== 'string'))) throw channelError('Channel members must be a list of teammate names.');
    const memberIds = new Set([context.actorId]);
    for (const wanted of action.members || []) {
      const matches = Object.entries(state.agentChannelAccess).filter(([, access]) => !access.removed && [access.agent?.name, access.agent?.id, String(access.agent?.name || '').replace(/[^a-zA-Z0-9]/g, '')].some(value => nameKey(value) === nameKey(wanted)));
      if (matches.length !== 1) throw channelError(`Teammate ${wanted} is missing or ambiguous. Choose an existing teammate by name.`);
      if (!paths(matches[0][1].agent).includes(context.workspace)) throw channelError(`Teammate ${wanted} is not assigned to this workspace.`);
      memberIds.add(matches[0][0]);
    }
    const purpose = String(action.purpose || '').trim();
    if (purpose.length > 12000) throw channelError('Channel purpose is too long.');
    return { type: 'create_channel', name, memberIds: [...memberIds], purpose };
  }
  function commitChannel(state, receipt) {
    const action = receipt.action;
    const existing = state.channels.find(c => nameKey(c.name) === nameKey(action.name));
    if (existing) {
      if (!existing.memberIds.includes(receipt.actorId)) throw channelError('A channel with this name already exists. Ask the user to add you to it.', 409);
      receipt.status = 'existing'; receipt.channelId = existing.id;
      receipt.message = `Using existing #${existing.name}; its membership and purpose are unchanged.`;
      return;
    }
    const channelId = `channel-${randomUUID()}`;
    const timestamp = at();
    const channel = { id: channelId, name: action.name, visibility: 'public', memberIds: action.memberIds, creatorId: receipt.actorId, projects: [{ name: basename(receipt.workspace), path: receipt.workspace }], autoModeDefault: false, responder: { mode: 'everyone', leadMemberId: '' }, createdAt: timestamp, updatedAt: timestamp };
    state.channels.push(channel);
    receipt.status = 'created'; receipt.channelId = channelId;
    receipt.message = `Created #${channel.name} and invited you. Open the channel to see its purpose and replies.`;
    receipt.deliveries = [];
    if (!action.purpose) return;
    const rootId = `${receipt.id}-purpose`;
    const threadId = `${receipt.id}-thread`;
    const actor = state.agentChannelAccess[receipt.actorId].agent;
    const body = `${actor.name} opened this channel: ${action.purpose}`;
    // Same responder rule as the browser (ADR-0108): members the purpose
    // @mentions answer it; otherwise the channel's mode decides. A channel
    // created here starts on Everyone, so the mode never asks the model.
    const roster = action.memberIds.map(memberId => ({ id: memberId, name: state.agentChannelAccess[memberId]?.agent?.name || memberId }));
    const recipients = resolveResponderRecipients({ mentions: resolveMentions(action.purpose, roster), channel, pick: null });
    const memberIds = recipients.memberIds.length ? recipients.memberIds : action.memberIds;
    state.messages.push({ id: rootId, channelId, role: 'user', agentId: actor.id, authorName: actor.name, body, status: 'complete', threadId, workspace: receipt.workspace, targetMemberIds: memberIds, ...(recipients.responder ? { responder: recipients.responder } : {}), createdAt: timestamp, updatedAt: timestamp });
    state.threads.push({ id: threadId, channelId, parentMessageId: rootId, title: action.purpose, creatorId: receipt.actorId, memberIds, replyCount: 0, createdAt: timestamp, updatedAt: timestamp });
    receipt.threadId = threadId; receipt.parentMessageId = rootId; receipt.recipientRule = recipients.rule;
    for (const memberId of memberIds) receipt.deliveries.push({ id: `${receipt.id}-${memberId}`, memberId, status: 'queued', updatedAt: timestamp });
  }
  async function finish(context, result, signal) {
    const { text, actions } = parseReply(result.reply);
    if (!actions.length) return result;
    const receipts = [];
    for (const [index, raw] of actions.slice(0, 5).entries()) {
      const id = `channel-action-${digest([context.actorId, context.requestId, index]).slice(0, 32)}`;
      const receipt = await store.mutate(async state => {
        const previous = state.agentChannelActions.find(item => item.id === id);
        if (previous) {
          if (previous.digest !== digest(raw)) return { id, actorId: context.actorId, status: 'failed', message: 'This request ID was already used for a different channel action.' };
          if (previous.channelId && !state.channels.some(channel => channel.id === previous.channelId)) return { ...structuredClone(previous), status: 'failed', message: 'The channel from this request was deleted. It was not recreated; use a new request to propose another channel.' };
          return structuredClone(previous);
        }
        const record = { id, actorId: context.actorId, requestId: context.requestId, workspace: context.workspace, depth: context.depth, identityValid: context.identityValid, digest: digest(raw), createdAt: at(), updatedAt: at(), expiresAt: new Date(Date.now() + 86400000).toISOString() };
        try {
          if (signal?.aborted || result.declined) throw channelError('This turn was stopped before its channel action could run.', 409);
          record.action = validateAction(state, context, raw);
          const permission = await assertActor(state, context);
          if (signal?.aborted) throw channelError('This turn was stopped before its channel action could run.', 409);
          if (permission === 'ask') { record.status = 'proposed'; record.message = `Approve creation of #${record.action.name} with ${record.action.memberIds.length} teammate${record.action.memberIds.length === 1 ? '' : 's'}?`; }
          else commitChannel(state, record);
        } catch (error) { record.status = error.status === 403 ? 'blocked' : 'failed'; record.message = error.message; }
        state.agentChannelActions.push(record);
        return structuredClone(record);
      });
      receipts.push(receipt);
    }
    if (actions.length > 5) receipts.push({ status: 'failed', message: 'Only five channel actions are accepted per turn. Remaining actions were not run.' });
    schedule();
    return { ...result, reply: [text, ...receipts.map(r => r.message)].filter(Boolean).join('\n\n'), channelActions: receipts };
  }
  async function decide(id, approve) {
    const receipt = await store.mutate(async state => {
      const record = state.agentChannelActions.find(item => item.id === id);
      if (!record) throw channelError('Channel proposal was not found.', 404);
      if (approve && ['created', 'existing'].includes(record.status)) return structuredClone(record);
      if (!approve && record.status === 'rejected') return structuredClone(record);
      if (record.status !== 'proposed') throw channelError('This channel proposal is already resolved.', 409);
      if (approve) {
        if (record.expiresAt < at()) throw channelError('This proposal expired. Ask the teammate to propose it again.', 409);
        await assertActor(state, record, true);
        // Re-resolve membership against current records before approval.
        if (record.action.memberIds.some(memberId => state.agentChannelAccess[memberId]?.removed || !paths(state.agentChannelAccess[memberId]?.agent).includes(record.workspace))) throw channelError('The proposed membership or workspace is no longer available.', 409);
        commitChannel(state, record);
      } else { record.status = 'rejected'; record.message = 'You declined this channel proposal.'; }
      record.updatedAt = at();
      return structuredClone(record);
    });
    schedule(); return receipt;
  }
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        const job = await store.mutate(async state => {
          const record = state.agentChannelActions.find(r => r.status === 'created' && r.deliveries?.some(d => d.status === 'queued'));
          if (!record) return null;
          const delivery = record.deliveries.find(d => d.status === 'queued');
          delivery.status = 'running'; delivery.updatedAt = at();
          const channel = state.channels.find(c => c.id === record.channelId);
          const access = state.agentChannelAccess[delivery.memberId];
          try {
            await assertActor(state, record, true);
            if (!channel?.memberIds.includes(delivery.memberId) || !access || access.removed) throw channelError('The channel or receiving teammate is no longer available.', 409);
            await availability.assertCanWork({ agentId: delivery.memberId, agent: access.agent });
          } catch (error) { delivery.status = 'error'; delivery.error = error.message; }
          const root = state.messages.find(m => m.id === record.parentMessageId);
          return { record: structuredClone(record), delivery: structuredClone(delivery), channel, access, prompt: root?.body || '' };
        });
        if (!job) break;
        let result;
        let error = job.delivery.error;
        if (!error) {
          try {
            result = await run({ agentId: job.delivery.memberId, agent: job.access.agent, requestId: job.delivery.id, workspace: job.record.workspace, prompt: job.prompt, profile: [job.access.profile, `You are ${job.access.agent.name}, ${job.access.agent.role || 'a Squad teammate'}. Work in #${job.channel.name} with the channel members. Reply to its purpose within your assigned tools and permissions.`, job.access.agent.instructions].filter(Boolean).join('\n\n'), channel: { ...job.channel, threadId: job.record.threadId, parentMessageId: job.record.parentMessageId }, _channelActionDepth: job.record.depth + 1 });
            if (result.declined) error = result.reply || 'Receiving member declined this purpose.';
          } catch (failure) { error = failure.message; }
        }
        await store.mutate(state => {
          const record = state.agentChannelActions.find(r => r.id === job.record.id);
          const delivery = record?.deliveries?.find(d => d.id === job.delivery.id);
          if (!delivery) return;
          const timestamp = at();
          delivery.status = error ? 'error' : 'completed'; delivery.error = error || ''; delivery.updatedAt = timestamp;
          if (!state.channels.some(c => c.id === record.channelId)) return;
          state.messages.push({ id: delivery.id, channelId: record.channelId, role: 'agent', agentId: delivery.memberId, authorName: job.access?.agent.name || delivery.memberId, body: error ? `Purpose could not run: ${error}` : result.reply, status: error ? 'error' : 'complete', threadId: record.threadId, parentMessageId: record.parentMessageId, workspace: record.workspace, trace: result?.trace, createdAt: timestamp, updatedAt: timestamp });
          const thread = state.threads.find(t => t.id === record.threadId);
          if (thread) { thread.replyCount++; thread.updatedAt = timestamp; }
        });
      }
    } finally { draining = false; }
  }
  async function recover() {
    await store.mutate(state => {
      // Older purpose roots used the prompt role without its member identity.
      // Only bridge-owned receipts can repair attribution; arbitrary human
      // messages and their contents remain untouched.
      for (const record of state.agentChannelActions) {
        const root = state.messages.find(message => message.id === record.parentMessageId && message.channelId === record.channelId);
        if (root && !root.agentId && record.actorId) root.agentId = record.actorId;
      }
      for (const record of state.agentChannelActions) for (const delivery of record.deliveries || []) {
        if (delivery.status === 'running') {
          delivery.status = 'interrupted'; delivery.error = 'The bridge restarted during this purpose. Send a new channel prompt to continue; it was not automatically replayed.'; delivery.updatedAt = at();
          if (state.channels.some(channel => channel.id === record.channelId) && !state.messages.some(message => message.id === delivery.id)) {
            state.messages.push({ id: delivery.id, channelId: record.channelId, role: 'system', authorName: 'Squad', body: delivery.error, status: 'error', threadId: record.threadId, parentMessageId: record.parentMessageId, workspace: record.workspace, createdAt: delivery.updatedAt, updatedAt: delivery.updatedAt });
          }
        }
      }
    });
    schedule();
  }
  return { begin, finish, setAccess, decide, recover, list: async () => (await store.read()).agentChannelActions };
}
