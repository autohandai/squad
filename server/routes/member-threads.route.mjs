// Persisted direct-message reply threads. A thread is an independent work
// lane, never a synthetic member and never the member's main engine session.
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';
import { resolveAttachments } from '../attachments.mjs';
import { ATTACHMENT_COUNT_LIMIT, attachmentReferences } from '../../src/lib/attachments.js';

export const name = 'member-threads';
const ROUTE = /^\/api\/members\/([^/]+)\/threads(?:\/([^/]+)(?:\/(messages|stop))?)?$/;
const stamp = () => new Date().toISOString();
const problem = (message, status = 400) => Object.assign(new Error(message), { status });
let state, file, bridge, queue = Promise.resolve();

async function mutate(change) {
  const next = queue.then(async () => {
    const previous = structuredClone(state);
    try {
      const result = await change(state);
      await writePersistentJson(file, state);
      bridge.emit('member-threads.changed', {});
      return structuredClone(result);
    } catch (error) { state = previous; throw error; }
  });
  queue = next.catch(() => {});
  return next;
}

function threadFor(memberId, id) {
  const thread = state.threads.find(item => item.id === id && item.memberId === memberId);
  if (!thread) throw problem('This reply thread does not exist.', 404);
  return thread;
}

function publicThread(thread) {
  return { ...thread, working: thread.messages.some(message => message.status === 'loading'), replyCount: thread.messages.filter(message => message.role === 'agent' && message.status === 'complete' && !message.empty && message.body.trim()).length };
}

function settle(thread, run, message) {
  if (!run?.finishedAt || message.status !== 'loading') return false;
  message.status = run.status === 'completed' ? 'complete' : run.status === 'stopped' ? 'stopped' : 'error';
  message.body = String(run.reply || '').trim().slice(0, 16000);
  message.empty = !message.body;
  if (!message.body) message.body = run.status === 'completed' ? 'Finished without reply text. Open the run in Execution to inspect the work.' : `This work ${run.status === 'stopped' ? 'was stopped' : 'could not finish'}. You can send a follow-up to retry.`;
  message.completedAt = run.finishedAt;
  if (run.effectiveModel) message.effectiveModel = run.effectiveModel;
  if (run.routing) message.routing = run.routing;
  thread.updatedAt = stamp();
  return true;
}

async function refreshRuns() {
  if (!state.threads.some(thread => thread.messages.some(message => message.status === 'loading' && bridge.runs.get(message.runId)?.finishedAt))) return;
  await mutate(() => {
    for (const thread of state.threads) for (const message of thread.messages) settle(thread, bridge.runs.get(message.runId), message);
  });
}

export async function init(ctx) {
  bridge = ctx; file = join(ctx.squadStateDir, 'member-threads.json');
  state = await readPersistentJson(file, { version: 1, threads: [] });
  if (state?.version !== 1 || !Array.isArray(state.threads)) throw new Error('Saved reply threads are damaged; the original file has been kept.');
  let recovered = false;
  for (const thread of state.threads) for (const message of thread.messages) {
    if (message.status !== 'loading') continue;
    recovered = true;
    if (!settle(thread, ctx.runs.get(message.runId), message)) {
      message.status = 'error'; message.body = 'Squad restarted while this thread was working. Your messages are saved; send a follow-up to continue.'; message.completedAt = stamp();
    }
  }
  if (recovered) await writePersistentJson(file, state);
  ctx.events.on('run.finished', () => { void refreshRuns().catch(error => ctx.logEvent(ctx.SEVERITY.ERROR, `Reply thread result could not be saved: ${error.message}`)); });
}

function threadPrompt(thread) {
  const history = thread.messages.filter(message => message.role === 'user' || message.status === 'complete').slice(-24);
  return `Work in this independent reply thread. The main conversation and other threads may be working in parallel; do not claim their results or change their state. Reply to the latest message and carry its work through to completion. Use your ordinary Squad tools and saved permissions.\n\nOriginal message (${thread.root.role}):\n${thread.root.body}\n\nThread conversation:\n${history.map(message => `${message.role === 'user' ? 'Person' : 'You'}: ${message.body}`).join('\n\n')}`;
}

async function launch(memberId, threadId, replyId, input) {
  try {
    const access = await bridge.agentChannelActions.memberAccess(memberId);
    if (!access?.agent || access.removed) throw problem('This member is no longer available.', 409);
    const thread = structuredClone(threadFor(memberId, threadId));
    const workspace = await bridge.cleanWorkspace(input.workspace || access.agent.workspace);
    const run = await bridge.startRun({
      agentId: memberId, agent: access.agent, profile: access.profile || '', workspace,
      prompt: threadPrompt(thread), title: thread.messages.filter(message => message.role === 'user').at(-1)?.body,
      mode: 'prompt', policy: access.agent.launch?.policy || 'yes',
      ephemeralSession: true, resumeSession: false, memberThreadId: threadId,
      requestId: replyId,
      attachments: attachmentReferences([...new Map([...(thread.root.attachments || []), ...thread.messages.flatMap(message => message.attachments || [])].map(file => [file.id, file])).values()].slice(-ATTACHMENT_COUNT_LIMIT)),
    });
    await mutate(() => {
      const current = threadFor(memberId, threadId);
      const message = current.messages.find(item => item.id === replyId);
      message.runId = run.id;
      settle(current, bridge.runs.get(run.id), message);
    });
  } catch (error) {
    await mutate(() => {
      const thread = threadFor(memberId, threadId);
      const message = thread.messages.find(item => item.id === replyId);
      message.status = 'error'; message.body = error.message || 'This reply could not start.'; message.completedAt = stamp();
    });
  }
}

export async function handle(req, res, url, ctx) {
  const match = url.pathname.match(ROUTE);
  if (!match) return false;
  try {
    const memberId = decodeURIComponent(match[1]), id = match[2] && decodeURIComponent(match[2]), action = match[3];
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(memberId)) throw problem('Invalid member identity.');
    await refreshRuns();
    let data, status = 200;
    if (!id && req.method === 'GET') data = { threads: state.threads.filter(thread => thread.memberId === memberId).map(thread => { const { messages: _messages, ...summary } = publicThread(thread); return { ...summary, root: { ...summary.root, body: summary.root.body.slice(0, 200) } }; }) };
    else if (!id && req.method === 'POST') {
      const { root } = await ctx.readBody(req);
      if (!root?.id || String(root.id).length > 200 || !['user', 'agent'].includes(root.role) || !String(root.body || '').trim() || String(root.body).length > 16000) throw problem('Choose a message with 1–16000 characters to reply to.');
      const threadId = `dm-${createHash('sha256').update(JSON.stringify([memberId, root.id])).digest('hex').slice(0, 32)}`;
      const attachments = attachmentReferences(await resolveAttachments(ctx.squadStateDir, root.attachments || []));
      data = await mutate(() => {
        const previous = state.threads.find(thread => thread.id === threadId && thread.memberId === memberId);
        if (previous) return publicThread(previous);
        if (state.threads.filter(thread => thread.memberId === memberId).length >= 200) throw problem('This member has reached the limit of 200 reply threads.', 409);
        const now = stamp();
        const thread = { id: threadId, memberId, parentMessageId: String(root.id), root: { id: String(root.id), role: root.role, body: String(root.body).trim(), authorName: String(root.authorName || '').slice(0, 120), attachments }, messages: [], createdAt: now, updatedAt: now };
        state.threads.push(thread); return publicThread(thread);
      }); status = 201;
    } else if (id && !action && req.method === 'GET') data = publicThread(threadFor(memberId, id));
    else if (id && action === 'messages' && req.method === 'POST') {
      const body = await ctx.readBody(req), text = String(body.text || '').trim();
      if (!text || text.length > 8000) throw problem('A reply must contain 1–8000 characters.');
      const requestId = String(body.requestId || randomUUID()).slice(0, 120);
      const attachments = attachmentReferences(await resolveAttachments(ctx.squadStateDir, body.attachments || []));
      const replyId = `reply-${createHash('sha256').update(JSON.stringify([id, requestId])).digest('hex').slice(0, 32)}`;
      let start = false;
      data = await mutate(() => {
        const thread = threadFor(memberId, id);
        const previous = thread.messages.find(message => message.id === replyId);
        if (previous) {
          if (thread.messages.find(message => message.id === `${replyId}-user`)?.body !== text) throw problem('This request was already used for a different reply.', 409);
          if (JSON.stringify(thread.messages.find(message => message.id === `${replyId}-user`)?.attachments || []) !== JSON.stringify(attachments)) throw problem('This request was already used with different attachments.', 409);
          return publicThread(thread);
        }
        if (thread.messages.some(message => message.status === 'loading')) throw problem('This thread is working. Other threads can work independently.', 409);
        if (thread.messages.length >= 200) throw problem('This thread has reached 200 messages; start another reply thread.', 409);
        const now = stamp();
        thread.messages.push({ id: `${replyId}-user`, role: 'user', body: text, attachments, status: 'complete', createdAt: now }, { id: replyId, role: 'agent', body: '', status: 'loading', runId: '', createdAt: now });
        thread.updatedAt = now; start = true; return publicThread(thread);
      });
      if (start) void launch(memberId, id, replyId, body).catch(error => ctx.logEvent(ctx.SEVERITY.ERROR, `Reply thread failed: ${error.message}`));
      status = 202;
    } else if (id && action === 'stop' && req.method === 'POST') {
      const thread = threadFor(memberId, id);
      const loading = thread.messages.filter(message => message.status === 'loading');
      if (loading.some(message => !message.runId)) throw problem('This reply is still starting; try Stop again in a moment.', 409);
      await Promise.all(loading.map(message => ctx.stopRun(message.runId, 'stopped this reply thread')));
      await refreshRuns(); data = publicThread(threadFor(memberId, id));
    } else throw problem('This reply thread operation is unavailable.', 405);
    ctx.json(res, status, { success: true, data });
  } catch (error) { ctx.json(res, error.status || 500, { success: false, error: error.message }); }
  return true;
}
