// Goal claims and resumable preparation use canonical channels and the
// existing member provisioner. Ready hands the first turns to the bridge.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';
import { validateTeamFile } from '../../src/lib/teams.js';
import { normalizeChannelGoal, CHANNEL_GOAL_LIMIT } from '../../src/lib/channel-goals.js';
import { attachmentReferences } from '../../src/lib/attachments.js';
import { resolveAttachments } from '../attachments.mjs';

export const name = 'channel-goals';
const ROUTE = /^\/api\/channels\/([^/]+)\/goal(?:\/(build|progress))?$/;
const problem = (message, status = 400) => Object.assign(new Error(message), { status });
const stamp = () => new Date().toISOString();
let builds = {}, file, bridge, queue = Promise.resolve();

function serialized(operation) {
  const next = queue.then(operation);
  queue = next.catch(() => {});
  return next;
}

function settle(state, channel, delivery, run, interrupted = false) {
  if (!['queued', 'running'].includes(delivery.status) || (!run?.finishedAt && !interrupted)) return;
  const message = state.messages.find(item => item.id === delivery.messageId && item.channelId === channel.id);
  if (!message) return;
  const reply = String(run?.reply || '').trim().slice(0, 16000);
  delivery.status = run?.status === 'completed' ? 'complete' : run?.status === 'stopped' ? 'stopped' : 'error';
  message.status = delivery.status;
  message.noReplyText = delivery.status === 'complete' && !reply;
  message.body = reply || (interrupted
    ? 'Squad restarted while this work was running. Your goal and team are saved; send a follow-up in this thread to continue.'
    : delivery.status === 'complete'
      ? 'Finished without reply text. Open the run in Execution to inspect the work.'
      : delivery.status === 'stopped' ? 'This work was stopped.' : 'This member could not finish. Send a follow-up in this thread to retry.');
  message.completedAt = run?.finishedAt || stamp();
  if (run?.effectiveModel) message.effectiveModel = run.effectiveModel;
  if (run?.routing) message.routing = run.routing;
  message.updatedAt = stamp();
  channel.updatedAt = message.updatedAt;
}

async function refreshRuns(interrupted = false) {
  const snapshot = await bridge.readChannelsState();
  const pending = snapshot.channels.some(channel => channel.goalSetup?.deliveries?.some(delivery =>
    ['queued', 'running'].includes(delivery.status) && (interrupted || bridge.runs.get(delivery.runId)?.finishedAt)));
  if (!pending) return;
  await bridge.mutateChannelsState(state => {
    for (const channel of state.channels) for (const delivery of channel.goalSetup?.deliveries || []) {
      settle(state, channel, delivery, bridge.runs.get(delivery.runId), interrupted);
    }
  });
}

export async function init(ctx) {
  bridge = ctx;
  file = join(ctx.squadStateDir, 'channel-team-builds.json');
  builds = await readPersistentJson(file, {});
  if (!builds || typeof builds !== 'object' || Array.isArray(builds)) throw new Error('Saved channel team builds are invalid; the original file has been kept.');
  await refreshRuns(true);
  ctx.events.on('run.finished', () => {
    void refreshRuns().catch(error => ctx.logEvent(ctx.SEVERITY.ERROR, `Channel goal result could not be saved: ${error.message}`));
  });
}

function claimGoal(state, channel, body) {
  const previous = channel.goalSetup;
  const objective = String(body.objective || previous?.objective || '').trim();
  if (!objective || objective.length > CHANNEL_GOAL_LIMIT) throw problem(`Describe the goal in 1–${CHANNEL_GOAL_LIMIT} characters.`);
  if (previous?.status === 'ready') throw problem('This channel already has a prepared team.', 409);
  const owner = String(body.owner || '').slice(0, 120);
  if (!owner) throw problem('A setup request identity is required.');
  if (['designing', 'preparing'].includes(previous?.status) && !body.resume) return { claimed: false, channel };
  const attachments = body.attachments === undefined ? previous?.attachments || [] : body.attachments;
  const same = previous?.objective === objective && JSON.stringify((previous?.attachments || []).map(file => file.id)) === JSON.stringify(attachments.map(file => file.id));
  const build = same && builds[channel.id]?.goalObjective === objective ? builds[channel.id] : null;
  const threadId = same && previous.threadId ? previous.threadId : `goal-${randomUUID()}`;
  const rootMessageId = same && previous.rootMessageId ? previous.rootMessageId : `${threadId}-root`;
  const now = stamp();
  if (!state.messages.some(message => message.id === rootMessageId)) {
    state.messages.push({ id: rootMessageId, channelId: channel.id, threadId, parentMessageId: '', role: 'user', body: objective, ...(attachments.length ? { attachments } : {}), status: 'complete', createdAt: now, updatedAt: now });
    state.threads.push({ id: threadId, channelId: channel.id, parentMessageId: rootMessageId, title: objective.slice(0, 160), creatorId: 'user', memberIds: [], replyCount: 0, createdAt: now, updatedAt: now });
  }
  channel.goalSetup = normalizeChannelGoal({ status: build ? 'preparing' : 'designing', objective, attachments, buildId: build?.id || '', threadId, rootMessageId, owner });
  channel.purpose = objective;
  channel.updatedAt = now;
  return { claimed: true, channel, build };
}

async function saveBuild(channel, body, owner) {
  const build = body.build, validated = validateTeamFile(build?.document);
  if (!build?.id || build.goalObjective !== channel.goalSetup.objective || !validated.ok
    || !Array.isArray(build.members) || !build.members.length || build.members.length > 8
    || build.members.some(member => !member.id || !member.key || !member.draft)) throw problem('The team preparation snapshot is incomplete.');
  const next = { ...builds, [channel.id]: { ...build, document: validated.document, targetChannelId: channel.id, goalOwner: owner } };
  await writePersistentJson(file, next);
  builds = next;
  channel.goalSetup = { ...channel.goalSetup, status: 'preparing', buildId: build.id };
}

function readyTeam(state, channel, body) {
  const previous = channel.goalSetup;
  const ids = [...new Set(Array.isArray(body.memberIds) ? body.memberIds : [])];
  const members = builds[channel.id]?.members;
  if (!ids.length || ids.length > 8 || !members || members.length !== ids.length
    || members.some(member => member.status !== 'ready' || !ids.includes(member.id))
    || ids.some(id => !channel.memberIds.includes(id) || !state.agentChannelAccess?.[id]?.agent || state.agentChannelAccess[id].removed)) {
    throw problem('Every specialist must be prepared, registered and joined to this channel before starting.', 409);
  }
  if (previous.status === 'ready') {
    if (ids.length !== previous.deliveries.length || previous.deliveries.some(delivery => !ids.includes(delivery.memberId))) throw problem('This goal has already started with its prepared team.', 409);
    return [];
  }
  const now = stamp();
  const deliveries = ids.map(memberId => ({ memberId, messageId: `${previous.threadId}-${memberId}-start`, runId: '', status: 'queued' }));
  channel.goalSetup = normalizeChannelGoal({ ...previous, status: 'ready', error: '', deliveries });
  const thread = state.threads.find(item => item.id === previous.threadId && item.channelId === channel.id);
  if (thread) { thread.memberIds = ids; thread.autoMode = true; thread.selfJudge = true; }
  const root = state.messages.find(item => item.id === previous.rootMessageId && item.channelId === channel.id);
  if (root) root.targetMemberIds = ids;
  for (const delivery of deliveries) {
    const agent = state.agentChannelAccess[delivery.memberId].agent;
    state.messages.push({ id: delivery.messageId, channelId: channel.id, channelName: channel.name, threadId: previous.threadId,
      parentMessageId: previous.rootMessageId, role: 'agent', agentId: delivery.memberId, authorName: agent.name,
      targetMemberIds: ids, targetLabel: 'Goal team', body: '', status: 'loading', createdAt: now, startedAt: now, updatedAt: now });
  }
  return deliveries;
}

async function launch(channelId, delivery) {
  try {
    const state = await bridge.readChannelsState();
    const channel = state.channels.find(item => item.id === channelId);
    const access = state.agentChannelAccess?.[delivery.memberId];
    if (!channel?.memberIds.includes(delivery.memberId) || !access?.agent || access.removed) throw problem('This member is no longer available in this channel.', 409);
    const workspace = await bridge.cleanWorkspace(channel.projects?.[0]?.path || access.agent.workspace);
    const roster = channel.memberIds.map(id => state.agentChannelAccess?.[id]?.agent).filter(Boolean);
    const run = await bridge.startRun({ agentId: delivery.memberId, agent: access.agent, profile: access.profile || '', workspace,
      prompt: `Our channel goal: ${channel.goalSetup.objective}\n\nYou are ${access.agent.name}, ${access.agent.role}. Start the concrete work your role owns now. Coordinate through Squad with these teammates: ${roster.map(member => `${member.name} (${member.role})`).join(', ')}. Produce useful work and verify it before reporting. Do not ask whether to start.`,
      title: `Start ${access.agent.role || access.agent.name} work in #${channel.name}`,
      mode: 'prompt', policy: access.agent.launch?.policy || 'yes', requestId: delivery.messageId,
      attachments: channel.goalSetup.attachments || [],
      channelId, channel: { id: channelId, name: channel.name, visibility: channel.visibility, memberIds: channel.memberIds },
      threadId: channel.goalSetup.threadId, parentMessageId: channel.goalSetup.rootMessageId, memberIds: channel.memberIds,
      autoModeDefault: true, selfJudge: true, ephemeralSession: true, resumeSession: false });
    await bridge.mutateChannelsState(current => {
      const saved = current.channels.find(item => item.id === channelId);
      const record = saved?.goalSetup?.deliveries.find(item => item.messageId === delivery.messageId);
      if (!record) return;
      record.runId = run.id; record.status = 'running';
      const message = current.messages.find(item => item.id === delivery.messageId && item.channelId === channelId);
      if (message) { message.runId = run.id; message.workspace = workspace; message.updatedAt = stamp(); }
      settle(current, saved, record, bridge.runs.get(run.id));
    });
  } catch (error) {
    await bridge.mutateChannelsState(state => {
      const channel = state.channels.find(item => item.id === channelId);
      const record = channel?.goalSetup?.deliveries.find(item => item.messageId === delivery.messageId);
      const message = state.messages.find(item => item.id === delivery.messageId && item.channelId === channelId);
      if (record) record.status = 'error';
      if (message) { message.status = 'error'; message.body = error.message || 'This work could not start.'; message.updatedAt = stamp(); message.completedAt = message.updatedAt; }
    });
  }
}

export async function handle(req, res, url, ctx) {
  const match = url.pathname.match(ROUTE);
  if (!match) return false;
  try {
    const channelId = decodeURIComponent(match[1]), action = match[2];
    const body = req.method === 'GET' ? {} : await ctx.readBody(req, 2 * 1024 * 1024);
    if (!action && req.method === 'POST' && body.attachments !== undefined) body.attachments = attachmentReferences(await resolveAttachments(ctx.squadStateDir, body.attachments));
    const deliveries = [];
    const data = await serialized(async () => {
      if (action === 'build' && req.method === 'GET') return { build: builds[channelId] || null };
      return ctx.mutateChannelsState(async state => {
        const channel = state.channels.find(item => item.id === channelId);
        if (!channel) throw problem('Channel not found.', 404);
        if (!action && req.method === 'POST') return claimGoal(state, channel, body);
        const previous = channel.goalSetup, owner = String(body.owner || '').slice(0, 120);
        if (!previous || !owner || owner !== previous.owner) throw problem('This setup is now owned by a newer request. Reload the channel.', 409);
        if (previous.status === 'ready' && !(action === 'progress' && req.method === 'POST' && body.status === 'ready')) throw problem('This goal has already started. Send further work in its thread.', 409);
        if (action === 'build' && req.method === 'PUT') await saveBuild(channel, body, owner);
        else if (action === 'progress' && req.method === 'POST') {
          if (!['preparing', 'ready', 'failed'].includes(body.status)) throw problem('Invalid team setup state.');
          if (body.status === 'ready') deliveries.push(...readyTeam(state, channel, body));
          else channel.goalSetup = normalizeChannelGoal({ ...previous, status: body.status, error: String(body.error || '') });
        } else throw problem('This channel goal operation is unavailable.', 405);
        channel.updatedAt = stamp();
        return { channel, build: builds[channelId] || null };
      });
    });
    // Queue records are committed before any model runs. Launches and result
    // persistence belong to the bridge, independent of this HTTP connection.
    for (const delivery of deliveries) void launch(channelId, delivery).catch(error => ctx.logEvent(ctx.SEVERITY.ERROR, `Channel goal work could not be saved: ${error.message}`));
    ctx.json(res, 200, { success: true, data });
  } catch (error) { ctx.json(res, error.status || 500, { success: false, error: error.message }); }
  return true;
}
