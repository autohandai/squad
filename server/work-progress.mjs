import { createHash } from 'node:crypto';

const STATUSES = new Set(['pending', 'in_progress', 'completed', 'failed', 'cancelled']);
export function normalizeChecklist(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 50).flatMap((item) => {
    const title = String(item?.title || item?.step || item?.text || item?.content || '').trim().slice(0, 400);
    if (!title) return [];
    const rawStatus = String(item.status || (item.completed === true ? 'completed' : 'pending')).replaceAll('-', '_');
    const status = rawStatus === 'done' ? 'completed' : rawStatus === 'todo' ? 'pending' : STATUSES.has(rawStatus) ? rawStatus : 'pending';
    return [{ id: String(item.id || createHash('sha256').update(title).digest('hex').slice(0, 12)), title, status }];
  });
}

export function planFromTool(event) {
  const tool = event?.tool || event;
  const name = String(tool.name || tool.toolName || '').toLowerCase().replace(/[-_]/g, '');
  if (!['todowrite', 'updateplan', 'planupdate'].includes(name)) return null;
  const args = tool.args || tool.input || {};
  const items = normalizeChecklist(args.todos || args.plan || args.items || args.tasks);
  return items.length ? { items, summary: String(args.explanation || '').slice(0, 1000), outcome: null, source: 'native-tool' } : null;
}

export function extractWorkMarkers(value) {
  let progress = null;
  let goalReport = null;
  const cleanText = String(value || '').replace(/<squad_(progress|goal)>\s*([\s\S]*?)\s*<\/squad_\1>/g, (_, kind, content) => {
    try {
      const report = JSON.parse(content);
      if (!report || typeof report !== 'object' || Array.isArray(report)) return '';
      if (kind === 'goal') goalReport = report;
      const items = normalizeChecklist(report.items || report.checklist || report.plan);
      if (items.length) progress = { items, summary: String(report.summary || '').slice(0, 1000), outcome: kind === 'goal' ? String(report.status || '') : null, source: 'member-report' };
    } catch { /* Invalid private metadata never invents progress. */ }
    return '';
  }).replace(/<squad_(?:progress|goal)>[\s\S]*$/, '').trim();
  return { cleanText, progress, goalReport };
}

export function cleanWorkResult(result) {
  const parsed = extractWorkMarkers(result?.reply);
  const trace = result?.trace ? {
    ...result.trace,
    messages: (result.trace.messages || []).map((item) => ({ ...item, content: extractWorkMarkers(item.content).cleanText })),
    events: (result.trace.events || []).map((item) => item.type === 'assistant_event' ? { ...item, content: extractWorkMarkers(item.content).cleanText } : item),
  } : result?.trace;
  if (trace && parsed.progress) trace.events.push(planEvent(parsed.progress));
  return { ...result, reply: parsed.cleanText, trace, ...(parsed.progress ? { progress: parsed.progress } : {}), ...(parsed.goalReport ? { goalReport: parsed.goalReport } : {}) };
}

function planEvent(progress, timestamp = new Date().toISOString()) {
  return { type: 'plan_update', plan: progress.items.map(({ id, title, status }) => ({ id, step: title, status })), explanation: progress.summary, source: progress.source, timestamp };
}

/** Hide private checklist/outcome protocol while retaining ordinary streaming. */
export function withWorkProgress(stream, onProgress = () => {}) {
  let pending = '';
  let capture = '';
  let activeTag = '';
  const proposedPlans = new Map();
  const tags = ['<squad_progress>', '<squad_goal>'];
  const announce = (progress) => {
    if (!progress) return;
    onProgress(progress);
    stream.send('progress', progress);
    stream.send('sdk', planEvent(progress));
  };
  const filterDelta = (delta) => {
    pending += delta;
    let visible = '';
    while (pending) {
      if (activeTag) {
        const endTag = activeTag.replace('<', '</');
        capture += pending; pending = '';
        const end = capture.indexOf(endTag);
        if (end < 0) break;
        pending = capture.slice(end + endTag.length);
        announce(extractWorkMarkers(capture.slice(0, end + endTag.length)).progress);
        activeTag = ''; capture = '';
        continue;
      }
      const matches = tags.map((tag) => ({ tag, index: pending.indexOf(tag) })).filter(({ index }) => index >= 0).sort((a, b) => a.index - b.index);
      if (matches.length) {
        const { tag, index } = matches[0];
        visible += pending.slice(0, index);
        pending = pending.slice(index);
        activeTag = tag;
        continue;
      }
      let retained = 0;
      for (const tag of tags) for (let size = 1; size < tag.length; size += 1) if (pending.endsWith(tag.slice(0, size))) retained = Math.max(retained, size);
      visible += pending.slice(0, pending.length - retained);
      pending = pending.slice(pending.length - retained);
      break;
    }
    return visible;
  };
  return {
    send(event, data) {
      if (event === 'sdk' && data?.type === 'message_delta') {
        const delta = filterDelta(String(data.delta || ''));
        if (delta || data.thought) stream.send(event, { ...data, delta });
        return;
      }
      if (event === 'sdk' && data?.type === 'message_end') {
        const parsed = extractWorkMarkers(data.content);
        announce(parsed.progress);
        if (pending && !activeTag) stream.send('sdk', { type: 'message_delta', delta: pending, timestamp: data.timestamp });
        pending = ''; capture = ''; activeTag = '';
        stream.send(event, { ...data, content: parsed.cleanText });
        return;
      }
      if (event === 'sdk' && data?.type === 'tool_start') {
        const progress = planFromTool(data);
        if (progress) proposedPlans.set(String(data.tool?.id || data.toolId || ''), progress);
      }
      if (event === 'sdk' && data?.type === 'tool_end') {
        const id = String(data.toolId || '');
        const progress = proposedPlans.get(id);
        proposedPlans.delete(id);
        if (data.success !== false) announce(progress);
      }
      if (event === 'sdk' && data?.type === 'plan_update') {
        const progress = { items: normalizeChecklist(data.plan), summary: String(data.explanation || ''), outcome: null, source: data.source || 'native-plan' };
        onProgress(progress);
        stream.send('progress', progress);
      }
      if (event === 'done') {
        if (pending && !activeTag) stream.send('sdk', { type: 'message_delta', delta: pending });
        pending = ''; capture = ''; activeTag = '';
        const clean = cleanWorkResult(data);
        announce(clean.progress);
        stream.send(event, clean);
        return;
      }
      stream.send(event, data);
    },
    end: () => stream.end?.(),
  };
}
