#!/usr/bin/env node
// Autohand Squad control plane (ADR-0109): a dependency-free stdio MCP server
// that lets Claude Desktop, Cursor or any MCP client coordinate this Squad
// through the local bridge. JSON-RPC 2.0 over stdin/stdout in either newline
// or Content-Length framing; each reply uses the framing of its request.
//
//   node server/control-plane/mcp-server.mjs [--bridge http://127.0.0.1:19821]
//   AUTOHAND_SQUAD_BRIDGE_URL=http://127.0.0.1:19821 node server/control-plane/mcp-server.mjs
//
// Only a loopback bridge is accepted. Approvals, deletion, credentials and
// computer lifecycle are never exposed; see docs/integration/control-plane.md.

import { randomUUID } from 'node:crypto';
import { createManagementTools } from './management.mjs';
import { createOwnershipTools } from './ownership-tools.mjs';

import {
  DEFAULT_WAIT_MS, MAX_MESSAGES, MAX_WAIT_MS, NOT_AVAILABLE_CODE, POLL_INTERVAL_MS, SERVER_NAME, SERVER_VERSION, TOOLS,
  decodeFrames, encodeFrame, goalOutcome, negotiateProtocol, notAvailable, parseBridgeUrl, redactSecrets, redactedTail, runOutcome, validateArgs,
} from './control-plane.mjs';

const HTTP_TIMEOUT_MS = 30_000;
const REPLY_CHARS = 8000;
const BODY_CHARS = 4000;
const DEFAULT_AUTHOR = 'Control plane';

// ---- bridge client --------------------------------------------------------

export function createBridgeClient(origin, { fetchImpl = fetch } = {}) {
  origin = parseBridgeUrl(origin);
  let binding;
  const changed = () => Object.assign(new Error('The signed-in account or selected Squad changed. Reconnect this MCP client.'), { status: 409, code: 'context_changed' });
  async function raw(path, { method = 'GET', body, rawBody, contentType='application/json',timeoutMs = HTTP_TIMEOUT_MS, signal, context } = {}) {
    const target = new URL(path, origin);
    if (target.origin !== origin || !target.pathname.startsWith('/api/')) throw new Error('Invalid Squad bridge path.');
    let response;
    try {
      response = await fetchImpl(target.href, { method, redirect: 'error',
        headers: { ...(body === undefined&&rawBody===undefined ? {} : { 'content-type': contentType }), ...(context ? { 'x-squad-context': context.generation } : {}) },
        body: rawBody===undefined?(body === undefined ? undefined : JSON.stringify(body)):rawBody,
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)].filter(Boolean)),
      });
    } catch(cause) {
      signal?.throwIfAborted();
      throw new Error(`The Squad bridge did not answer at ${origin}. Open Squad, then reconnect this MCP client.`, {cause});
    }
    let envelope;
    try { envelope = await response.json(); } catch { throw new Error('The Squad bridge returned an unreadable response.'); }
    if (path === '/api/ownership/context' && response.status === 404) throw Error('This bridge lacks account isolation. Update Autohand Squad, then reconnect this MCP client.');
    if (!response.ok || envelope?.success !== true) throw Object.assign(new Error(typeof envelope?.error === 'string' ? envelope.error : envelope?.error?.message || `Squad returned HTTP ${response.status}.`), { status: response.status, code: envelope?.code });
    return envelope.data;
  }
  function lease(context) {
    if (!['ready','awaiting_restart'].includes(context?.state) || !context.actor?.id || !context.owner?.id || !context.generation || !context.storageKey) throw new Error('Sign in and select an authorized Squad, then reconnect this MCP client.');
    return { context: Object.freeze(context), controller: new AbortController() };
  }
  const bound = () => binding ||= raw('/api/ownership/context').then(lease);
  const sameActor = (left, right) => left?.id === right?.id && left?.issuer === right?.issuer;
  const sameOwner=(left,right)=>sameActor(left,right)&&left?.kind===right?.kind;
  async function call(path, options = {}) {
    const active = await bound();
    active.controller.signal.throwIfAborted();
    const signals = [active.controller.signal, options.signal].filter(Boolean);
    const value = await raw(path, { ...options, context: active.context, signal: AbortSignal.any(signals) });
    active.controller.signal.throwIfAborted();
    if (path === '/api/ownership/context' && (value.generation !== active.context.generation || value.state !== active.context.state || !sameActor(value.actor, active.context.actor))) throw changed();
    return value;
  }
  return {
    get: (path, options) => call(path, options),
    post: (path, body = {}) => call(path, { method: 'POST', body }),
    put: (path, body = {}) => call(path, { method: 'PUT', body }),
    patch: (path, body = {}) => call(path, { method: 'PATCH', body }),
    delete: (path, body = {}) => call(path, { method: 'DELETE', body }),
    upload: (path,rawBody,contentType)=>call(path,{method:'POST',rawBody,contentType,timeoutMs:120_000}),
    dataOperation:async input=>{
      const active=await bound();await call('/api/ownership/context');
      const result=await call('/api/ownership/operations',{method:'POST',body:input,timeoutMs:120_000}),next=result.context;
      if(!sameActor(next.actor,active.context.actor)||!sameOwner(next.owner,active.context.owner)||next.datasetId!==result.operation.afterDatasetId) {active.controller.abort(changed());throw changed();}
      binding=Promise.resolve(lease(next));active.controller.abort(changed());return result.operation;
    },
    restartData:async(id,revision)=>{
      const active=await bound();await call('/api/ownership/context');
      const next=await call(`/api/ownership/operations/${encodeURIComponent(id)}/restart`,{method:'POST',body:{revision}});
      if(!sameActor(next.actor,active.context.actor)||!sameOwner(next.owner,active.context.owner)||next.datasetId!==active.context.datasetId){active.controller.abort(changed());throw changed();}
      binding=Promise.resolve(lease(next));active.controller.abort(changed());return {state:next.state,owner:next.owner,datasetId:next.datasetId};
    },
    downloadUrl: async path => {
      const active = await bound(); await call('/api/ownership/context');
      const url = new URL(path, origin);
      if (url.origin !== origin || !/^\/api\/backups\/[a-f0-9-]{36}\/download$/.test(url.pathname)) throw Error('Invalid owned backup download.');
      url.searchParams.set('context', active.context.generation); return url.href;
    },
    selectOwner: async owner => {
      const active = await bound(); await call('/api/ownership/context');
      const context = await call('/api/ownership/select', { method: 'POST', body: { owner, expectedGeneration: active.context.generation } });
      if (!sameActor(context.actor, active.context.actor)) { active.controller.abort(changed()); throw changed(); }
      const next = lease(context); active.controller.abort(changed()); binding = Promise.resolve(next);
      return { owner: context.owner, label: context.ownerLabel, role: context.role, canWrite: context.canWrite, generation: context.generation };
    },
  };
}

// ---- tools ----------------------------------------------------------------

const clip = (text, limit) => { const value = String(text ?? ''); return value.length > limit ? `${value.slice(0, limit)}…` : value; };
const byTime = (key) => (a, b) => String(a[key] || '').localeCompare(String(b[key] || ''));

function latestByMember(runs, goals) {
  const latest = new Map();
  const consider = (memberId, record) => {
    if (!memberId) return;
    const previous = latest.get(memberId);
    if (!previous || String(record.at || '') > String(previous.at || '')) latest.set(memberId, record);
  };
  for (const run of runs) consider(run.agentId, { at: run.startedAt, harness: run.harness || null, workspace: run.workspace || '' });
  for (const goal of goals) consider(goal.agentId, { at: goal.createdAt || goal.updatedAt, harness: goal.harness || null, workspace: goal.workspace || '' });
  return latest;
}

export function createTools(bridge) {
  async function channelsState() {
    return bridge.get('/api/channels');
  }

  async function runsFor(memberId = '') {
    const runs = await bridge.get('/api/runs');
    return (Array.isArray(runs) ? runs : []).filter((run) => !memberId || run.agentId === memberId);
  }

  async function goalsFor(memberId = '') {
    const goals = await bridge.get(`/api/goals${memberId ? `?agentId=${encodeURIComponent(memberId)}` : ''}`);
    return Array.isArray(goals) ? goals : [];
  }

  async function postChannelRecords(channelId, { messages = [], threads = [] }) {
    await bridge.put('/api/channels/sync', {
      ...(threads.length ? { threads } : {}),
      ...(messages.length ? { messages: { [channelId]: messages } } : {}),
    });
  }

  async function lastWorkspace(memberId) {
    const [runs, goals, state, queue] = await Promise.all([runsFor(memberId), goalsFor(memberId), channelsState(), bridge.get(`/api/queues/${encodeURIComponent(memberId)}`)]);
    const agent = state?.agentChannelAccess?.[memberId]?.agent || {};
    const latestQueue = [...(queue?.items || [])].reverse().find(item => item.workspace);
    const last = latestByMember(runs, goals).get(memberId);
    return (latestQueue && (!last || latestQueue.createdAt > last.at) ? latestQueue.workspace : last?.workspace)
      || agent.workspace || agent.projects?.[0]?.path || '';
  }

  async function startWork({ memberId, text, workspace, mode, channel }) {
    const folder = String(workspace || '').trim() || await lastWorkspace(memberId);
    if (!folder) {
      throw new Error(`workspace is required: pass the absolute project folder ${memberId} should work in. The bridge has no earlier run or goal for this member to reuse one from.`);
    }
    const title = clip(text.replace(/\s+/g, ' ').trim(), 120);
    if (mode === 'goal') {
      if (channel) throw new Error('mode "goal" is only available for a direct message to a member, not inside a channel.');
      const data = await bridge.post('/api/chat', { agentId: memberId, prompt: text, workspace: folder, mode: 'goal', title });
      const goal = data?.goal || {};
      return { kind: 'goal', goal_id: goal.id || data?.goalId || '', status: goal.status || 'running', workspace: folder };
    }
    const run = await bridge.post('/api/runs', {
      agentId: memberId,
      prompt: text,
      title,
      workspace: folder,
      ...(channel ? { channelId: channel.channelId, threadId: channel.threadId, parentMessageId: channel.parentMessageId, channelName: channel.channelName } : {}),
    });
    return { kind: 'run', run_id: run?.id || '', status: run?.status || 'running', workspace: folder, transport: run?.transport || '', harness: run?.harness || '' };
  }

  async function mirrorChannelReply(run, outcome, reply) {
    const channel = run?.channel;
    if (!channel?.channelId || !channel.threadId) return false;
    const text = reply || (outcome.outcome === 'failed' ? `Run ${outcome.reason}` : '');
    if (!text) return false;
    const at = run.finishedAt || new Date().toISOString();
    try {
      await postChannelRecords(channel.channelId, {
        messages: [{
          id: `${run.id}-reply`,
          channelId: channel.channelId,
          role: 'agent',
          agentId: run.agentId,
          authorName: run.agentId,
          body: text,
          status: outcome.outcome === 'failed' ? 'error' : 'complete',
          threadId: channel.threadId,
          parentMessageId: channel.parentMessageId || '',
          workspace: run.workspace || '',
          transport: run.transport || '',
          runId: run.id,
          createdAt: at,
          updatedAt: at,
        }],
      });
      return true;
    } catch {
      return false;
    }
  }

  const tools = {
    async list_members() {
      const canonical = await bridge.get('/api/owned/members');
      const [presence, runs, goals, state] = await Promise.all([
        bridge.get('/api/members/presence').catch(() => ({ presence: {} })),
        runsFor().catch(() => []), goalsFor().catch(() => []), channelsState(),
      ]);
      const latest = latestByMember(runs, goals);
      const rows = new Map(canonical.members.map(member => [member.id, { ...member, status: 'unknown', lastActivityAt: null }]));
      const members = [...rows.values()].map((row) => {
        const current = presence?.presence?.[row.id] || {};
        const agent = state?.agentChannelAccess?.[row.id]?.agent || {};
        const last = latest.get(row.id) || {};
        return { ...row, presence: current.state || 'unknown', since: current.since || null, activeRuns: current.activeRuns || 0, harness: last.harness || agent.harness?.id || null, lastWorkspace: last.workspace || agent.workspace || agent.projects?.[0]?.path || null };
      });
      return {
        members,
        snapshotAt: null,
        source: {
          roster: 'canonical selected-owner registry; mirrors never create members',
          harness: 'the member\'s latest bridge-owned work, falling back to its registered profile',
        },
      };
    },

    async list_channels() {
      const state = await channelsState();
      const channels = (state?.channels || []).map((channel) => ({
        id: channel.id,
        name: channel.name,
        kind: channel.kind || 'channel',
        visibility: channel.visibility,
        memberIds: channel.memberIds || [],
        projects: (channel.projects || []).map((project) => project.name || project.path),
        section: channel.section || '',
        threads: (state.threads || []).filter((thread) => thread.channelId === channel.id).length,
        messages: (state.messages || []).filter((message) => message.channelId === channel.id).length,
        createdAt: channel.createdAt,
        updatedAt: channel.updatedAt,
      }));
      return { channels, revision: state?.revision ?? null };
    },

    async get_messages({ channel_id, thread_id, member_id, limit, before } = {}) {
      const take = Math.min(Math.max(Number(limit) || 50, 1), MAX_MESSAGES);
      const cutoff = before ? String(before) : '';
      if (channel_id && member_id) throw new Error('pass channel_id or member_id, not both');
      if (channel_id) {
        const state = await channelsState();
        const channel = (state?.channels || []).find((item) => item.id === channel_id);
        if (!channel) throw Object.assign(new Error(`channel ${channel_id} was not found`), { status: 404 });
        const threads = (state.threads || []).filter((thread) => thread.channelId === channel_id && (!thread_id || thread.id === thread_id))
          .map((thread) => ({ id: thread.id, title: thread.title, creatorId: thread.creatorId, memberIds: thread.memberIds || [], replyCount: thread.replyCount || 0, createdAt: thread.createdAt, updatedAt: thread.updatedAt }));
        const all = (state.messages || [])
          .filter((message) => message.channelId === channel_id && (!thread_id || message.threadId === thread_id) && (!cutoff || String(message.createdAt) < cutoff))
          .sort(byTime('createdAt'));
        const messages = all.slice(-take).map((message) => ({
          id: message.id, threadId: message.threadId || '', parentMessageId: message.parentMessageId || '', role: message.role, agentId: message.agentId || '',
          authorName: message.authorName || '', body: clip(message.body, BODY_CHARS), status: message.status, createdAt: message.createdAt, updatedAt: message.updatedAt,
        }));
        return { channel: { id: channel.id, name: channel.name }, threads, messages, total: all.length, truncated: all.length > messages.length };
      }
      if (member_id) {
        const [runs, goals] = await Promise.all([runsFor(member_id), goalsFor(member_id)]);
        const items = [
          ...runs.map((run) => ({
            kind: 'run', id: run.id, title: run.title, status: run.status, harness: run.harness, workspace: run.workspace, channel: run.channel || null,
            reply: clip(redactSecrets(run.reply || ''), REPLY_CHARS), tail: redactedTail(run.logs, 10), createdAt: run.startedAt, finishedAt: run.finishedAt || null,
          })),
          ...goals.map((goal) => ({
            kind: 'goal', id: goal.id, title: goal.title || goal.prompt || '', status: goal.status, harness: goal.harness, workspace: goal.workspace,
            summary: clip(redactSecrets(goal.summary || ''), REPLY_CHARS), latestReply: clip(redactSecrets(goal.latestReply || ''), REPLY_CHARS), turnCount: goal.turnCount || 0,
            createdAt: goal.createdAt, updatedAt: goal.updatedAt, finishedAt: goal.finishedAt || null,
          })),
        ].filter((item) => !cutoff || String(item.createdAt) < cutoff).sort(byTime('createdAt'));
        const page = items.slice(-take);
        return {
          member_id,
          items: page,
          total: items.length,
          truncated: items.length > page.length,
          note: 'These are run and goal summaries. Use get_conversation for the actual direct-message transcript.',
        };
      }
      throw new Error('channel_id or member_id is required');
    },

    async search({ query, types, limit } = {}) {
      const params = new URLSearchParams({ q: String(query || '') });
      if (types) params.set('types', String(types));
      if (limit) params.set('limit', String(Math.min(Number(limit) || 40, 100)));
      const data = await bridge.get(`/api/search?${params}`);
      return { query: data?.query ?? query, mode: data?.mode || '', results: (data?.results || []).slice(0, 100), tookMs: data?.tookMs ?? null };
    },

    async create_channel({ name, visibility, member_ids, section } = {}) {
      const channel = await bridge.post('/api/channels', {
        name,
        ...(visibility ? { visibility } : {}),
        ...(Array.isArray(member_ids) ? { memberIds: member_ids } : {}),
        ...(section ? { section } : {}),
        creatorId: '',
      });
      return { channel: { id: channel.id, name: channel.name, visibility: channel.visibility, memberIds: channel.memberIds || [], createdAt: channel.createdAt } };
    },

    async send_message({ text, channel_id, thread_id, member_id, workspace, mode, author } = {}) {
      const body = String(text || '').trim();
      if (!channel_id && !member_id) throw new Error('channel_id or member_id is required');
      if (!channel_id && thread_id) throw new Error('thread_id needs a channel_id');
      if (!channel_id) {
        const work = await startWork({ memberId: member_id, text: body, workspace, mode: mode || 'run' });
        return { ...work, note: `The ${work.kind} is bridge-owned: it appears in the app's Mission Control${work.kind === 'goal' ? ' and the member\'s goals' : ''}, not as a direct-chat message. Use wait_for_reply with its id.` };
      }
      const state = await channelsState();
      const channel = (state?.channels || []).find((item) => item.id === channel_id);
      if (!channel) throw Object.assign(new Error(`channel ${channel_id} was not found`), { status: 404 });
      const parentThread = thread_id ? (state.threads || []).find((thread) => thread.id === thread_id && thread.channelId === channel_id) : null;
      if (thread_id && !parentThread) throw Object.assign(new Error(`thread ${thread_id} was not found in channel ${channel_id}`), { status: 404 });
      const at = new Date().toISOString();
      const messageId = `cp-${randomUUID()}`;
      const threadId = thread_id || messageId;
      const message = {
        id: messageId, channelId: channel_id, role: 'user', agentId: '', authorName: String(author || '').trim() || DEFAULT_AUTHOR, body,
        status: 'complete', threadId, parentMessageId: parentThread ? parentThread.parentMessageId || parentThread.id : '', createdAt: at, updatedAt: at,
      };
      const threads = thread_id ? [] : [{ id: threadId, channelId: channel_id, title: body, creatorId: '', memberIds: member_id ? [member_id] : [], createdAt: at, updatedAt: at }];
      await postChannelRecords(channel_id, { messages: [message], threads });
      let dispatched = null;
      if (member_id) {
        dispatched = await startWork({ memberId: member_id, text: body, workspace, mode: mode || 'run', channel: { channelId: channel_id, threadId, parentMessageId: messageId, channelName: channel.name } });
      }
      return {
        message: { id: messageId, channel_id, thread_id: threadId },
        ...(dispatched ? { run_id: dispatched.run_id, status: dispatched.status, workspace: dispatched.workspace, harness: dispatched.harness } : {}),
        dispatched: Boolean(dispatched),
        note: dispatched
          ? 'A bridge-owned run was started for the member in this thread; wait_for_reply posts its reply into the thread when it settles.'
          : 'The message was posted. Nobody was dispatched: the bridge has no automatic channel responder; pass member_id to start a run for a member.',
      };
    },

    async wait_for_reply({ run_id, goal_id, timeout_ms, tail_lines } = {}, { signal } = {}) {
      if (!run_id && !goal_id) throw new Error('run_id or goal_id is required');
      if (run_id && goal_id) throw new Error('pass run_id or goal_id, not both');
      const budget = Math.min(Math.max(Number(timeout_ms) || DEFAULT_WAIT_MS, 1000), MAX_WAIT_MS);
      const started = Date.now();
      for (;;) {
        if (signal?.aborted) throw new Error('wait_for_reply was cancelled');
        if (run_id) {
          const run = await bridge.get(`/api/runs/${encodeURIComponent(run_id)}`);
          const outcome = runOutcome(run);
          if (outcome) {
            const reply = clip(redactSecrets(run.reply || ''), REPLY_CHARS);
            const mirrored = outcome.outcome === 'settled' || outcome.outcome === 'failed' ? await mirrorChannelReply(run, outcome, reply) : false;
            return { kind: 'run', id: run.id, ...outcome, status: run.status, reply, tail: redactedTail(run.logs, tail_lines), finishedAt: run.finishedAt || null, waitedMs: Date.now() - started, ...(run.channel ? { channel: run.channel, replyPostedToThread: mirrored } : {}) };
          }
          if (Date.now() - started >= budget) {
            return { kind: 'run', id: run.id, outcome: 'timed-out', reason: `Still ${run.status} after ${budget} ms.`, status: run.status, reply: '', tail: redactedTail(run.logs, tail_lines), finishedAt: null, waitedMs: Date.now() - started };
          }
        } else {
          const goal = await bridge.get(`/api/goals/${encodeURIComponent(goal_id)}`);
          const outcome = goalOutcome(goal);
          const reply = clip(redactSecrets(goal.summary || goal.latestReply || ''), REPLY_CHARS);
          const tail = (Array.isArray(goal.evidence) ? goal.evidence : []).slice(-(Number(tail_lines) || 20)).map((line) => clip(redactSecrets(typeof line === 'string' ? line : JSON.stringify(line)), 500));
          if (outcome) return { kind: 'goal', id: goal.id, ...outcome, status: goal.status, reply, tail, turnCount: goal.turnCount || 0, finishedAt: goal.finishedAt || null, waitedMs: Date.now() - started };
          if (Date.now() - started >= budget) return { kind: 'goal', id: goal.id, outcome: 'timed-out', reason: `Still running after ${budget} ms.`, status: goal.status, reply, tail, turnCount: goal.turnCount || 0, finishedAt: null, waitedMs: Date.now() - started };
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },

    async interrupt({ run_id, goal_id, member_id } = {}) {
      const given = [run_id, goal_id, member_id].filter(Boolean).length;
      if (given !== 1) throw new Error('pass exactly one of run_id, goal_id or member_id');
      if (run_id) {
        const run = await bridge.post(`/api/runs/${encodeURIComponent(run_id)}/stop`, {});
        return { kind: 'run', id: run_id, stopped: run?.stopped === true, status: run?.status || '' };
      }
      if (goal_id) {
        const goal = await bridge.post(`/api/goals/${encodeURIComponent(goal_id)}/pause`, {});
        return { kind: 'goal', id: goal_id, status: goal?.status || '', note: 'The goal is paused, not cancelled; resume it in the app.' };
      }
      const result = await bridge.post(`/api/members/${encodeURIComponent(member_id)}/stop`, {});
      return { kind: 'member', id: member_id, stoppedRuns: result?.stoppedRuns || 0, closedSessions: result?.closedSessions || 0, pausedGoals: Array.isArray(result?.pausedGoals) ? result.pausedGoals.length : 0 };
    },

    async set_model() {
      throw notAvailable('set_model', 'a member\'s harness and model are chosen in the app and sent with each turn; the bridge only holds the global provider settings.', 'Change the model in the member\'s settings in the app.');
    },

    async message_member({ member_id, text, workspace } = {}) {
      const roster = await tools.list_members();
      if (!roster.members.some(member => member.id === member_id)) throw Object.assign(new Error(`Member ${member_id} was not found. Use list_members to choose a recipient.`), { status: 404 });
      if (!text.trim()) throw new Error('Message text is required.');
      const folder = workspace || await lastWorkspace(member_id);
      if (!folder) throw new Error(`Choose a workspace for ${member_id} in Squad, or pass workspace explicitly.`);
      const item = await bridge.post(`/api/queues/${encodeURIComponent(member_id)}/items`, { text, workspace: folder });
      const queue = await bridge.get(`/api/queues/${encodeURIComponent(member_id)}`);
      return { member_id, message_id: item.id, status: item.status, workspace: folder, paused: queue.paused === true, pauseReason: queue.pauseReason || '' };
    },

    async get_conversation({ member_id, limit = 30, since = '' } = {}) {
      const query = new URLSearchParams({ limit: String(limit), ...(since ? { since } : {}) });
      return bridge.get(`/api/members/${encodeURIComponent(member_id)}/transcript?${query}`);
    },

    async get_member_queue({ member_id, limit = 50 } = {}) {
      const queue = await bridge.get(`/api/queues/${encodeURIComponent(member_id)}`);
      return { ...queue, items: (queue.items || []).slice(-limit) };
    },

    async wait_for_message({ member_id, message_id, timeout_ms = 20000 } = {}, { signal } = {}) {
      const deadline = Date.now() + Math.min(timeout_ms, 25000);
      let previousQueue;
      while (true) {
        if (signal?.aborted) throw new Error('Wait cancelled; the message remains queued.');
        const remaining = deadline - Date.now();
        let queue = previousQueue;
        if (remaining > 0 || !queue) {
          try {
            queue = await bridge.get(`/api/queues/${encodeURIComponent(member_id)}`, { signal, timeoutMs: Math.max(1, Math.min(HTTP_TIMEOUT_MS, remaining)) });
          } catch (error) {
            if (signal?.aborted) throw new Error('Wait cancelled; the message remains queued.');
            if (!previousQueue || Date.now() < deadline) throw error;
            // The receipt was known before the last poll used up the wait
            // budget. Report its last state; never resend or cancel delivery.
            queue = previousQueue;
          }
        }
        if (signal?.aborted) throw new Error('Wait cancelled; the message remains queued.');
        previousQueue = queue;
        const item = (queue.items || []).find(item => item.id === message_id);
        if (!item) throw Object.assign(new Error('Message receipt not found for this member.'), { status: 404 });
        const outcome = item.status === 'done' ? 'settled' : ['failed', 'cancelled'].includes(item.status) ? 'failed' : queue.paused ? 'needs-you' : Date.now() >= deadline ? 'timed-out' : '';
        if (outcome) return { member_id, message_id, outcome, status: item.status, reply: clip(item.reply, REPLY_CHARS), reason: item.error || queue.pauseReason || '', finishedAt: item.finishedAt };
        await new Promise(resolve => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - Date.now()))));
      }
    },

    async list_artifacts({ member_id, query = '', limit = 50 } = {}) {
      const data = await bridge.get(`/api/artifacts?${new URLSearchParams({ owner: member_id || '', query })}`);
      return { artifacts: (data.artifacts || []).slice(0, limit) };
    },

    async get_artifact({ artifact_id } = {}) { return bridge.get(`/api/artifacts/${encodeURIComponent(artifact_id)}`); },

    async list_memories({ member_id, query = '', limit = 50, offset = 0 } = {}) {
      return bridge.get(`/api/memory?${new URLSearchParams({ owner: member_id || '', query, limit: String(limit), offset: String(offset) })}`);
    },

    async read_memory({ memory_id } = {}) { return bridge.get(`/api/memory/${encodeURIComponent(memory_id)}`); },
  };
  return { ...tools, ...createManagementTools(bridge, tools), ...createOwnershipTools(bridge) };
}

// ---- JSON-RPC -------------------------------------------------------------

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

export function createRpcHandler(tools, { bridgeUrl } = {}) {
  const inflight = new Map();
  async function callTool(params, id) {
    const name = String(params?.name || '');
    const tool = TOOL_BY_NAME.get(name);
    if (!tool) throw Object.assign(new Error(`unknown tool ${name || '(empty)'}`), { rpc: -32602 });
    const args = params?.arguments ?? {};
    const problems = validateArgs(tool.inputSchema, args);
    if (problems.length) throw Object.assign(new Error(`invalid arguments: ${problems.join('; ')}`), { rpc: -32602 });
    if (inflight.size >= 64) throw Object.assign(new Error('Too many active tool requests; wait for an existing request to finish.'), { rpc: -32000 });
    const controller = new AbortController();
    if (id !== undefined && id !== null) inflight.set(id, controller);
    try {
      const redact = value => typeof value === 'string' ? redactSecrets(value) : Array.isArray(value) ? value.map(redact) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redact(entry)])) : value;
      const result = redact(await tools[name](args, { signal: controller.signal }));
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false };
    } catch (error) {
      const message = redactSecrets(error?.code === NOT_AVAILABLE_CODE ? error.message : `${name} failed: ${error?.message || error}`);
      const payload = { error: message, ...(error?.code ? { code: error.code } : {}), ...(error?.status ? { status: error.status } : {}) };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload, isError: true };
    } finally {
      if (id !== undefined && id !== null) inflight.delete(id);
    }
  }

  return async function handle(request) {
    if (!request || typeof request !== 'object' || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return { jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32600, message: 'invalid request' } };
    }
    const { id, method, params } = request;
    const notification = id === undefined;
    if (method === 'notifications/cancelled') {
      inflight.get(params?.requestId)?.abort();
      return null;
    }
    if (method.startsWith('notifications/')) return null;
    try {
      let result;
      if (method === 'initialize') {
        result = {
          protocolVersion: negotiateProtocol(params?.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions: `Coordinates the Autohand Squad bridge at ${bridgeUrl}. Use list_members to select an agent, message_member for a queued direct conversation, get_conversation for history and wait_for_message for its reply. Use get_member_profile before revision-checked profile, ability, folder or skill edits. Channels support private groups and explicit recipient dispatch; routines support timezone previews, saved schedules and manual runs. Also reads Library artifacts and memories and independent runs/goals. Approvals, deletion, credentials and computer lifecycle stay in the app.`,
        };
      } else if (method === 'ping') {
        result = {};
      } else if (method === 'tools/list') {
        result = { tools: TOOLS };
      } else if (method === 'tools/call') {
        result = await callTool(params, id);
      } else {
        throw Object.assign(new Error(`method not found: ${method}`), { rpc: -32601 });
      }
      return notification ? null : { jsonrpc: '2.0', id, result };
    } catch (error) {
      if (notification) return null;
      return { jsonrpc: '2.0', id, error: { code: error?.rpc || -32000, message: String(error?.message || error) } };
    }
  };
}

// ---- stdio loop -----------------------------------------------------------

export async function serveStdio({ input = process.stdin, output = process.stdout, handle }) {
  let buffer = Buffer.alloc(0);
  const pending = new Set();
  const write = (message, framing) => { if (message) output.write(encodeFrame(message, framing)); };
  const receive = async (body, framing) => {
    let parsed;
    try { parsed = JSON.parse(body.toString()); }
    catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }, framing); return; }
    if (Array.isArray(parsed)) {
      const responses = (await Promise.all(parsed.map((item) => handle(item)))).filter(Boolean);
      if (responses.length) write(responses, framing);
      return;
    }
    write(await handle(parsed), framing);
  };
  await new Promise((resolve) => {
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const { frames, rest } = decodeFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        const task = receive(frame.body, frame.framing).catch(error => write({ jsonrpc: '2.0', id: null, error: { code: -32000, message: redactSecrets(String(error?.message || error)) } }, frame.framing));
        pending.add(task);
        task.finally(() => pending.delete(task));
      }
    };
    const finish = () => {
      input.off('data', onData); input.off('end', finish); input.off('error', finish);
      Promise.allSettled([...pending]).then(resolve);
    };
    input.on('data', onData);
    input.once('end', finish);
    input.once('error', finish);
  });
}

