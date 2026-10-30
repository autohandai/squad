import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readPersistentJson, writePersistentJson } from './persistent-json.mjs';
import { cleanWorkResult, normalizeChecklist } from './work-progress.mjs';
import { harnessAssignmentFromAgent } from './harness/registry.mjs';
import { attachmentReferences } from '../src/lib/attachments.js';

const ACTIVE = new Set(['running']);
const FINISHED = new Set(['completed', 'cancelled']);
const DEFAULT_MAX_TURNS = 24;
const DEFAULT_RUNTIME_MS = 4 * 60 * 60_000;

function privateLaunch(payload) {
  const scrub = (value) => {
    if (Array.isArray(value)) return value.map(scrub);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/(?:api.?key|token|secret|password|authorization|credentials|^env$)/i.test(key)).map(([key, item]) => [key, scrub(item)]));
  };
  const keys = ['agentId', 'agent', 'squadMembers', 'workspace', 'profile', 'model', 'policy', 'transport', 'timeoutMs', 'canvasDir', 'channelId', 'threadId', 'channel'];
  return { ...scrub(Object.fromEntries(keys.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]))), attachments: attachmentReferences(payload.attachments) };
}

export function publicGoal(record) {
  const { launch, ...snapshot } = record;
  return structuredClone(snapshot);
}

function reportFor(result) {
  const report = result.goalReport;
  if (!report || !['continue', 'completed', 'blocked'].includes(report.status)) return null;
  return { status: report.status, summary: String(report.summary || '').trim().slice(0, 1800),
    checklist: normalizeChecklist(report.checklist || report.items || report.plan),
    evidence: (Array.isArray(report.evidence) ? report.evidence : []).map((item) => String(item).trim().slice(0, 2000)).filter(Boolean).slice(0, 30) };
}

export function goalTurnPrompt(goal) {
  const state = goal.turnCount ? `\nCheckpoint after ${goal.turnCount} turn(s):\n${JSON.stringify({ checklist: goal.checklist, summary: goal.summary, evidence: goal.evidence })}\nLatest reply:\n${goal.latestReply.slice(0, 6000)}` : '';
  return `Pursue this explicit goal until it is achieved or you need a human decision:\n${goal.prompt}${state}\n\nWork in the currently assigned harness and workspace. Continue the remaining work, inspect and verify the actual result. Do not stop simply because one answer is complete. Respect the member's permission boundary; if a decision or authorization is needed, report blocked and explain what is needed. Maintain concrete named checklist items; only mark items completed when supported by work you performed or verified. Keep the final human response concise: the outcome and material remaining limits.\n\nAt the end of this turn append exactly one private report (valid JSON) in this format:\n<squad_goal>{"status":"continue","summary":"what changed and what remains","checklist":[{"id":"stable-id","title":"concrete task","status":"pending|in_progress|completed|failed|cancelled"}],"evidence":["observed validation or artifact"]}</squad_goal>\nUse status completed only when the entire goal is achieved, every checklist item is completed, and evidence names the verification. Use blocked when you cannot proceed without human input. If you still have work, use continue. This goal has an explicit safety boundary of ${goal.maxTurns} turns and ${Math.round(goal.maxRuntimeMs / 60000)} minutes per pursuit; reaching it pauses the goal for a person to resume.`;
}

export class GoalManager {
  constructor({ squadStateDir, executeTurn, assertCanWork, emit = () => {}, now = () => Date.now() }) {
    this.filename = join(squadStateDir, 'goals.json');
    this.executeTurn = executeTurn; this.assertCanWork = assertCanWork; this.emit = emit; this.now = now;
    this.records = new Map(); this.workers = new Map(); this.events = new EventEmitter(); this.events.setMaxListeners(100);
    this.writing = Promise.resolve();
    this.ready = this.load();
  }
  async load() {
    const saved = await readPersistentJson(this.filename, { goals: [] });
    let changed = false;
    for (const record of saved.goals || []) {
      if (!record?.id || !record.agentId) continue;
      if (ACTIVE.has(record.status)) {
        record.status = 'paused'; record.pausedAt = new Date(this.now()).toISOString();
        record.pauseReason = 'The bridge restarted. Resume when you are ready to continue.'; changed = true;
      }
      this.records.set(record.id, record);
    }
    if (changed) await this.save();
  }
  save() {
    const snapshot = { version: 1, goals: structuredClone([...this.records.values()]) };
    this.writing = this.writing.catch(() => {}).then(() => writePersistentJson(this.filename, snapshot));
    return this.writing;
  }
  notify(goal, event = 'goal', payload = publicGoal(goal)) {
    this.events.emit(goal.id, { event, data: payload });
    if (event === 'goal') this.emit('goal.updated', { memberId: goal.agentId, goal: payload });
  }
  async list(agentId = '') { await this.ready; return [...this.records.values()].filter((goal) => !agentId || goal.agentId === agentId).map(publicGoal).reverse(); }
  async get(id) { await this.ready; const goal = this.records.get(id); if (!goal) throw Object.assign(new Error('goal not found'), { status: 404 }); return publicGoal(goal); }
  async start(payload) {
    await this.ready;
    await this.assertCanWork?.(payload);
    const agentId = String(payload.agentId || payload.agent?.id || '').trim();
    const prompt = String(payload.prompt || '').replace(/^\/goal\s+/i, '').trim();
    if (!agentId || !prompt) throw Object.assign(new Error('member and goal objective are required'), { status: 400 });
    if ([...this.records.values()].some((goal) => goal.agentId === agentId && ACTIVE.has(goal.status))) throw Object.assign(new Error('This member already has a running goal. Pause it before starting another.'), { status: 409 });
    const at = new Date(this.now()).toISOString();
    const goal = { id: randomUUID(), agentId, workspace: String(payload.workspace || ''), prompt,
      harness: harnessAssignmentFromAgent(payload.agent).id, status: 'running', checklist: [], summary: '', latestReply: '', evidence: [],
      turnCount: 0, maxTurns: Math.trunc(Math.min(Math.max(Number(payload.goalMaxTurns) || DEFAULT_MAX_TURNS, 1), 100)),
      maxRuntimeMs: Math.min(Math.max(Number(payload.goalMaxRuntimeMs) || DEFAULT_RUNTIME_MS, 60_000), 24 * 60 * 60_000),
      startedAt: at, updatedAt: at, finishedAt: null, pausedAt: null, pauseReason: '', error: null,
      launch: privateLaunch(payload) };
    this.records.set(goal.id, goal);
    try { await this.save(); } catch (error) { this.records.delete(goal.id); throw error; }
    // Let the stream attach before the first harness event arrives.
    setImmediate(() => this.run(goal));
    return publicGoal(goal);
  }
  subscribe(id, callback) { this.events.on(id, callback); return () => this.events.off(id, callback); }
  async transition(goal, patch) {
    Object.assign(goal, patch, { updatedAt: new Date(this.now()).toISOString() });
    await this.save(); this.notify(goal);
  }
  async control(id, action) {
    await this.ready;
    const goal = this.records.get(id); if (!goal) throw Object.assign(new Error('goal not found'), { status: 404 });
    if (!['pause', 'resume', 'cancel'].includes(action)) throw Object.assign(new Error('unknown goal action'), { status: 400 });
    if (FINISHED.has(goal.status)) return publicGoal(goal);
    if (action === 'resume') {
      if (goal.status === 'running') return publicGoal(goal);
      await this.assertCanWork?.(goal.launch);
      if ([...this.records.values()].some((other) => other.id !== id && other.agentId === goal.agentId && ACTIVE.has(other.status))) throw Object.assign(new Error('This member already has another running goal.'), { status: 409 });
      const previous = this.workers.get(id);
      if (previous) {
        let timer;
        const stopped = await Promise.race([previous.done.then(() => true), new Promise((resolve) => { timer = setTimeout(() => resolve(false), 3500); })]).finally(() => clearTimeout(timer));
        if (!stopped) throw Object.assign(new Error('The previous goal turn is still stopping. Retry resume after it exits.'), { status: 409 });
      }
      await this.transition(goal, { status: 'running', pausedAt: null, pauseReason: '', error: null, finishedAt: null });
      setImmediate(() => this.run(goal));
    } else {
      const status = action === 'cancel' ? 'cancelled' : 'paused';
      try {
        await this.transition(goal, { status, pausedAt: status === 'paused' ? new Date(this.now()).toISOString() : null,
          pauseReason: status === 'paused' ? 'Paused by you.' : '', finishedAt: status === 'cancelled' ? new Date(this.now()).toISOString() : null });
      } finally { this.workers.get(id)?.controller.abort(); }
      if (!this.workers.has(id)) this.notify(goal, 'done', { reply: action === 'cancel' ? 'Goal cancelled.' : goal.pauseReason, goal: publicGoal(goal), goalId: goal.id });
    }
    return publicGoal(goal);
  }
  async pauseForMember(agentId, reason = 'Member stopped.') {
    await this.ready;
    const paused = [];
    for (const goal of this.records.values()) if (goal.agentId === agentId && goal.status === 'running') {
      try { await this.transition(goal, { status: 'paused', pausedAt: new Date(this.now()).toISOString(), pauseReason: reason }); }
      finally { this.workers.get(goal.id)?.controller.abort(); }
      paused.push(goal.id);
      if (!this.workers.has(goal.id)) this.notify(goal, 'done', { reply: reason, goal: publicGoal(goal), goalId: goal.id });
    }
    return paused;
  }
  async run(goal) {
    if (this.workers.has(goal.id) || goal.status !== 'running') return;
    const controller = new AbortController();
    let finish;
    const done = new Promise((resolve) => { finish = resolve; });
    this.workers.set(goal.id, { controller, done });
    const pursuitStartedAt = this.now(); const initialTurnCount = goal.turnCount;
    let lastProgress = JSON.stringify({ checklist: goal.checklist, evidence: goal.evidence }); let unchanged = 0;
    const boundary = setTimeout(() => controller.abort(new Error('Goal runtime boundary reached.')), goal.maxRuntimeMs); boundary.unref?.();
    try {
      this.notify(goal);
      while (goal.status === 'running' && !controller.signal.aborted) {
        await this.assertCanWork?.(goal.launch);
        if (goal.turnCount - initialTurnCount >= goal.maxTurns || this.now() - pursuitStartedAt >= goal.maxRuntimeMs) {
          await this.transition(goal, { status: 'paused', pausedAt: new Date(this.now()).toISOString(), pauseReason: 'The visible pursuit limit was reached. Review progress and resume to continue.' }); break;
        }
        const result = cleanWorkResult(await this.executeTurn({ ...goal.launch, requestId: `goal-${goal.id}-turn-${goal.turnCount}`, mode: 'prompt', prompt: goalTurnPrompt(goal), resumeSession: true }, {
          signal: controller.signal,
          onEvent: (event, data) => {
            if (goal.status !== 'running') return;
            if (event === 'progress' && data?.items?.length) {
              goal.checklist = normalizeChecklist(data.items); goal.summary = String(data.summary || goal.summary);
              goal.updatedAt = new Date(this.now()).toISOString();
              this.save().catch(() => controller.abort(new Error('Could not persist goal progress.')));
              this.notify(goal);
            }
            if (event !== 'done') this.notify(goal, event, data);
          },
        }));
        if (goal.status !== 'running' || controller.signal.aborted) break;
        const report = reportFor(result);
        const patch = { turnCount: goal.turnCount + 1, latestReply: String(result.reply || '').slice(0, 16000),
          lastResult: { ...result, reply: String(result.reply || '').slice(0, 16000), goalReport: undefined } };
        if (report) Object.assign(patch, { checklist: report.checklist.length ? report.checklist : goal.checklist, summary: report.summary, evidence: report.evidence });
        await this.transition(goal, patch);
        if (report?.status === 'blocked') { await this.transition(goal, { status: 'blocked', finishedAt: new Date(this.now()).toISOString() }); break; }
        if (report?.status === 'completed' && report.evidence.length && goal.checklist.length && goal.checklist.every((item) => item.status === 'completed')) {
          await this.transition(goal, { status: 'completed', finishedAt: new Date(this.now()).toISOString() }); break;
        }
        const progress = JSON.stringify({ checklist: goal.checklist, evidence: goal.evidence });
        unchanged = progress === lastProgress ? unchanged + 1 : 0; lastProgress = progress;
        if (unchanged >= 3) { await this.transition(goal, { status: 'paused', pausedAt: new Date(this.now()).toISOString(), pauseReason: 'Three turns reported no new checklist or evidence. Review the result before resuming.' }); break; }
      }
      if (goal.status === 'running' && controller.signal.aborted) await this.transition(goal, { status: 'paused', pausedAt: new Date(this.now()).toISOString(), pauseReason: 'The goal runtime boundary was reached. Resume to continue.' });
    } catch (error) {
      if (goal.status === 'running') await this.transition(goal, error?.reason === 'break' ? { status: 'paused', pausedAt: new Date(this.now()).toISOString(), pauseReason: 'Member is on a break.' }
        : controller.signal.aborted ? { status: 'paused', pausedAt: new Date(this.now()).toISOString(), pauseReason: 'The goal runtime boundary was reached. Resume to continue.' }
          : { status: 'failed', error: error?.message || String(error), finishedAt: new Date(this.now()).toISOString() });
    } finally {
      clearTimeout(boundary); this.workers.delete(goal.id);
      const reply = goal.status === 'failed' ? goal.error : goal.status === 'paused' ? goal.pauseReason : goal.status === 'cancelled' ? 'Goal cancelled.' : goal.summary || goal.latestReply;
      this.notify(goal, 'done', { ...(goal.lastResult || {}), reply: reply || 'Goal stopped.', goal: publicGoal(goal), goalId: goal.id });
      this.emit('goal.finished', { memberId: goal.agentId, goal: publicGoal(goal) }); finish();
    }
  }
}
