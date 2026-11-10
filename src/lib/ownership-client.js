import { activateOwnedStorage, closeOwnedStorage, currentOwnership } from './owned-storage.js';

let active = null;
const streams = new Set();
const contextChanged = () => Object.assign(new Error('The account or selected Squad changed.'), { name: 'AbortError', code: 'context_changed' });
export function activateOwnership(context) {
  const stored = activateOwnedStorage(context);
  if (!active) active = { context: stored, controller: new AbortController() };
  assertOwnership(active);
  return stored;
}
export function invalidateOwnership() {
  active?.controller.abort(contextChanged());
  closeOwnedStorage();
  for (const stream of streams) stream.close();
  streams.clear();
}
function assertOwnership(lease) { if (!lease || lease !== active || lease.controller.signal.aborted) throw contextChanged(); }
function localApi(input) {
  try { const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, globalThis.location?.href || 'http://localhost/'); return url.origin === globalThis.location?.origin && url.pathname.startsWith('/api/'); }
  catch { return false; }
}
function leasedResponse(response, lease) {
  let body;
  const wrapped = new Proxy(response, {
    get(target, property) {
      if (['json', 'text', 'blob', 'arrayBuffer', 'formData', 'bytes'].includes(property) && typeof target[property] === 'function') return async (...args) => { assertOwnership(lease); const result = await target[property](...args); assertOwnership(lease); return result; };
      if (property === 'clone') return () => leasedResponse(target.clone(), lease);
      if (property === 'body' && target.body) {
        body ||= new ReadableStream({
          start(controller) {
            const reader = target.body.getReader();
            const abort = () => { void reader.cancel().catch(() => {}); controller.error(contextChanged()); };
            lease.controller.signal.addEventListener('abort', abort, { once: true });
            this.cleanup = () => lease.controller.signal.removeEventListener('abort', abort);
            this.reader = reader;
          },
          async pull(controller) { try { assertOwnership(lease); const next = await this.reader.read(); assertOwnership(lease); if (next.done) { this.cleanup(); controller.close(); } else controller.enqueue(next.value); } catch (error) { this.cleanup(); controller.error(error); } },
          cancel() { this.cleanup(); return this.reader.cancel(); },
        });
        return body;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return wrapped;
}
export async function ownershipFetch(input, init = {}) {
  if (!localApi(input) || !active) return globalThis.fetch(input, init);
  const lease = active; assertOwnership(lease);
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  headers.set('x-squad-context', lease.context.generation);
  const signals = [lease.controller.signal, init.signal].filter(Boolean);
  const response = await globalThis.fetch(input, { ...init, headers, signal: AbortSignal.any(signals) });
  assertOwnership(lease);
  if ([401, 409].includes(response.status)) {
    const failure = await response.clone().json().catch(() => null);
    if (['context_changed', 'sign_in_required', 'identity_mismatch'].includes(failure?.code)) {
      invalidateOwnership();
      globalThis.dispatchEvent?.(new Event('squad:ownership-invalidated'));
      throw contextChanged();
    }
  }
  return leasedResponse(response, lease);
}
export function ownershipUrl(path) {
  if (!active || !localApi(path)) return path;
  assertOwnership(active);
  const url = new URL(path, globalThis.location.href);
  url.searchParams.set('context', active.context.generation);
  return `${url.pathname}${url.search}${url.hash}`;
}
export class OwnershipEventSource {
  constructor(path, options) {
    assertOwnership(active);
    this.source = new globalThis.EventSource(ownershipUrl(path), options);
    streams.add(this);
  }
  get readyState() { return this.source.readyState; }
  get url() { return this.source.url; }
  get withCredentials() { return this.source.withCredentials; }
  set onmessage(value) { this.source.onmessage = value; }
  get onmessage() { return this.source.onmessage; }
  set onerror(value) { this.source.onerror = value; }
  get onerror() { return this.source.onerror; }
  set onopen(value) { this.source.onopen = value; }
  get onopen() { return this.source.onopen; }
  addEventListener(...args) { this.source.addEventListener(...args); }
  removeEventListener(...args) { this.source.removeEventListener(...args); }
  close() { this.source.close(); streams.delete(this); }
}
export { currentOwnership };
