// Issues #86 and #87 reproduced against a real bridge: a channel holding the
// reporter's shape of history (197 messages, ~18 MB, almost all of it agent
// trace and stream events). Before the fix, the window sent the whole history
// to PUT /api/channels/sync on every change, which the bridge refuses over
// 16 MiB ("request body too large"), and re-serialised it on every streamed
// update. This check records every sync the window makes, the error banner,
// and how long keystrokes take to appear in the composer.
import assert from 'node:assert/strict';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { prepareModelRoutingFixture } from './lib/model-routing-fixtures.mjs';
import { seedOwnedBrowserFixture } from './lib/owned-bridge-fixture.mjs';

const REPORT = process.env.CHANNEL_HISTORY_REPORT === '1';
const bridge = await startBridge({ prepare: prepareModelRoutingFixture });
let browser;
const filler = (n) => 'x'.repeat(n);
try {
  const member = { id: 'asq_trace_1', name: 'Trace Heavy', role: 'Reviewer', instructions: 'Review.', workspace: process.cwd(), projects: [{ path: process.cwd() }], harness: { id: 'autohand' }, modelAssignment: { mode: 'override', provider: 'autohandai', model: 'fixture-moa' }, permissions: {} };
  browser = await startBrowser();
  await seedOwnedBrowserFixture(bridge, browser, { members: [member] });
  const created = await bridge.api('/api/channels', 'POST', { id: 'cst', name: 'cst', memberIds: [member.id] });
  assert.equal(created.success, true, created.error);
  // 197 messages; the agent replies carry the traces (two of them ~1.6 MB, as reported).
  const base = Date.parse('2026-11-17T00:00:00.000Z');
  const messages = Array.from({ length: 197 }, (_, i) => {
    const at = new Date(base + i * 60_000).toISOString();
    const agent = i % 2 === 1;
    const heavy = i === 193 || i === 195;
    return { id: `cst-m-${i}`, channelId: 'cst', role: agent ? 'assistant' : 'user', agentId: agent ? member.id : undefined, authorName: agent ? member.name : 'You',
      body: `Message ${i} ${filler(800)}`, status: 'complete', createdAt: at, updatedAt: at,
      ...(agent ? { trace: { toolCalls: [{ name: 'read_file', input: filler(200) }], events: Array.from({ length: heavy ? 1100 : 130 }, (_, k) => ({ type: 'tool_result', id: `e${k}`, output: filler(1000) })) },
        streamEvents: Array.from({ length: heavy ? 300 : 30 }, (_, k) => ({ type: 'message_delta', text: filler(1000), k })) } : {}) };
  });
  const total = Buffer.byteLength(JSON.stringify(messages));
  assert.ok(total > 16 * 1024 * 1024, `the fixture history (${total} bytes) is over the bridge's 16 MiB request limit`);
  for (let i = 0; i < messages.length; i += 30) {
    const saved = await bridge.api('/api/channels/sync', 'PUT', { messages: messages.slice(i, i + 30) });
    assert.equal(saved.status, 200, saved.error);
  }

  // Record every sync body and every long main-thread task from the first script.
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__syncs = []; window.__longTasks = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const url = String(input && input.url || input);
      if (url.includes('/api/channels/sync')) window.__syncs.push({ at: performance.now(), bytes: (init.body || '').length });
      return realFetch(input, init);
    };
    try { new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__longTasks.push({ at: e.startTime, ms: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch {}
  ` });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await browser.navigate(bridge.origin + '/channels/cst');
  const composer = 'textarea';
  await until(() => browser.evaluate(`!!document.querySelector(${JSON.stringify(composer)}) && document.body.innerText.includes('Message 196')`), 'the channel history renders', 90000);
  // Let the boot-time sync (and any retry) happen.
  await new Promise((resolve) => setTimeout(resolve, 4000));

  // Keystroke latency: from dispatching a key to the character being in the composer at the next frame.
  await browser.evaluate(`document.querySelector(${JSON.stringify(composer)}).focus()`);
  if (process.env.CHANNEL_HISTORY_PROFILE) { await browser.send('Profiler.enable'); await browser.send('Profiler.setSamplingInterval', { interval: 200 }); await browser.send('Profiler.start'); }
  const latencies = [];
  for (const ch of 'quick latency probe') {
    const before = await browser.evaluate(`document.querySelector(${JSON.stringify(composer)}).value.length`);
    const t0 = Date.now();
    await browser.send('Input.dispatchKeyEvent', { type: 'char', text: ch });
    await browser.evaluate(`new Promise((resolve) => { const tick = () => document.querySelector(${JSON.stringify(composer)}).value.length > ${before} ? requestAnimationFrame(() => resolve(true)) : requestAnimationFrame(tick); tick(); })`);
    latencies.push(Date.now() - t0);
  }
  if (process.env.CHANNEL_HISTORY_PROFILE) {
    const { profile } = await browser.send('Profiler.stop');
    const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const dt = profile.timeDeltas; const samples = profile.samples;
    for (let i = 0; i < samples.length; i++) { const n = byId.get(samples[i]); const f = n.callFrame; const key = `${f.functionName || '(anon)'} ${String(f.url).split('/').pop()}:${f.lineNumber + 1}`; self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000); }
    const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, ms]) => `${ms.toFixed(0).padStart(6)} ms  ${k}`);
    (await import('node:fs')).writeFileSync(process.env.CHANNEL_HISTORY_PROFILE, top.join('\n') + '\n');
  }
  latencies.sort((a, b) => a - b);
  const median = latencies[Math.floor(latencies.length / 2)], worst = latencies.at(-1);

  // A channel change after load (a rename made elsewhere reloads the channel state).
  await bridge.api('/api/channels/cst', 'PATCH', { topic: 'Renamed topic' });
  await new Promise((resolve) => setTimeout(resolve, 4000));

  const syncs = JSON.parse(await browser.evaluate('JSON.stringify(window.__syncs)'));
  const longTasks = JSON.parse(await browser.evaluate('JSON.stringify(window.__longTasks)'));
  const text = await browser.evaluate('document.body.innerText');
  const result = {
    historyBytes: total, syncs: syncs.length, largestSyncBytes: Math.max(0, ...syncs.map((s) => s.bytes)), totalSyncBytes: syncs.reduce((n, s) => n + s.bytes, 0),
    banner: /Channel changes could not be saved/.test(text), keystrokeMedianMs: median, keystrokeWorstMs: worst,
    longTasks: longTasks.length, longTaskMs: Math.round(longTasks.reduce((n, t) => n + t.ms, 0)),
  };
  console.log(JSON.stringify(result));
  if (!REPORT) {
    assert.equal(result.banner, false, 'no "Channel changes could not be saved" banner with a large history');
    assert.ok(result.largestSyncBytes < 2 * 1024 * 1024, `a sync sends what changed, not the history (largest ${result.largestSyncBytes} bytes)`);
    assert.ok(result.keystrokeMedianMs < 120, `typing stays responsive (median ${median} ms)`);
    const saved = (await bridge.api('/api/channels')).data.messages.find((message) => message.id === 'cst-m-195');
    assert.equal(saved.trace.events.length, 1100, 'stored traces are untouched by the smaller syncs');
    console.log('Channel history browser check passed: an 18 MB channel loads, syncs only what changed with no "request body too large" banner, keeps its stored traces, and typing stays responsive.');
  }
} finally {
  await browser?.close();
  await bridge.close?.();
}
process.exit(0);
