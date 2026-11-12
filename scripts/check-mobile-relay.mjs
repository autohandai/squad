import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMobileRelay } from '../server/mobile/relay.mjs';

// Exercise the real reconnect callback, while holding the old HTTP response.
// Capturing interval callbacks avoids waiting five minutes for each case.
const originalInterval = globalThis.setInterval, originalClear = globalThis.clearInterval;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'the replacement socket must connect'); await pause(5); }
}
try {
  for (const outcome of ['failure', 'expired-success', 'not-renewed']) {
    const intervals = [], sockets = [];
    globalThis.setInterval = (callback, ms) => { const handle = { callback, ms, unref() {} }; intervals.push(handle); return handle; };
    globalThis.clearInterval = () => {};
    let settle;
    const relay = createMobileRelay({
      service: { computerID: 'fixture', status: () => ({ devices: [] }) },
      identity: () => ({ token: 'fixture-current', actorID: 'alice' }),
      ownerScope: 'c'.repeat(64), baseUrl: 'http://127.0.0.1:9876',
      fetchImpl: async url => {
        if (String(url).endsWith('/lease')) return new Promise(resolve => { settle = resolve; });
        const data = String(url).endsWith('/auth/exchange') ? { token: 'ss_' + 'b'.repeat(64), expiresAt: new Date(Date.now() + 3600_000).toISOString() }
          : String(url).endsWith('/v1/mobile-relays') ? { roomID: 'a'.repeat(64) } : {};
        return Response.json({ success: true, data });
      },
      connect: async () => {
        class Socket extends EventEmitter {
          open = true; closed = 0;
          send() {}
          ping() { this.emit('pong'); }
          close() { if (this.open) { this.open = false; this.closed++; queueMicrotask(() => this.emit('close')); } }
        }
        const socket = new Socket(); sockets.push(socket);
        setImmediate(() => socket.emit('message', JSON.stringify({ type: 'relay.ready', protocolVersion: 1, computerID: 'fixture', leaseUntil: Date.now() + 600_000 })));
        return socket;
      },
    });
    try {
      await relay.start(); assert.equal(relay.status().connected, true);
      intervals.find(handle => handle.ms === 300_000).callback();
      await until(() => settle);
      sockets[0].close();
      await until(() => sockets.length === 2 && relay.status().connected);
      settle(outcome === 'failure' ? Response.json({ success: false, error: { message: 'Earlier lease failed.' } }, { status: 503 })
        : Response.json({ success: true, data: { renewed: outcome !== 'not-renewed', leaseUntil: Date.now() - 1 } }));
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(sockets[1].closed, 0, `${outcome}: old completion cannot close the replacement`);
      assert.equal(relay.status().connected, true, `${outcome}: old completion cannot replace the new lease`);
    } finally { relay.close(); }
  }
  console.log('PASS relay reconnect: late failure, expired success and refused renewal cannot close or expire the replacement connection.');
} finally { globalThis.setInterval = originalInterval; globalThis.clearInterval = originalClear; }
