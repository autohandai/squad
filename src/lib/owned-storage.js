// Layout is a device choice like skin and theme (ADR-0233).
const DEVICE_KEYS = new Set(['autohandSquad.v1.theme', 'autohandSquad.v1.skin', 'autohandSquad.v1.layout', 'autohandSquad.v1.locale', 'autohandSquad.v1.avatarStyle']);
let ownership = null;
let closed = false;
const changed = () => Object.assign(new Error('The account or selected Squad changed. Reopen Squad.'), { name: 'AbortError', code: 'context_changed' });

export function activateOwnedStorage(context) {
  if (!context?.storageKey || context.state !== 'ready' || !context.actor || !context.owner) throw changed();
  if (closed || (ownership && (ownership.storageKey !== context.storageKey || ownership.generation !== context.generation))) throw changed();
  ownership = Object.freeze({ ...context });
  return ownership;
}
export function closeOwnedStorage() { closed = true; }
export function currentOwnership() { return ownership; }
export function isDevicePreference(key) { return DEVICE_KEYS.has(key); }
export function physicalStorageKey(key) {
  if (isDevicePreference(key)) return key;
  if (closed || !ownership) throw changed();
  return `autohandSquad.owner.v1.${ownership.storageKey}.${encodeURIComponent(key)}`;
}
export function ownedBroadcastName(name) { return `${name}.${ownership?.storageKey || 'locked'}.${ownership?.generation || 'none'}`; }

// Squad's window storage is a cache of what the bridge keeps (members,
// channels, browser state): WebKit gives it about 5 MB, whatever the disk.
// History caches are the bulk and the first to give way (issue #88).
export const HISTORY_CACHE_KEYS = Object.freeze(['autohandSquad.v1.messages', 'autohandSquad.v1.channelMessages', 'autohandSquad.v1.channelThreads', 'autohandSquad.v1.browserDraftRecovery']);
const isQuota = error => error?.name === 'QuotaExceededError' || error?.code === 22 || error?.code === 1014;
const pressureListeners = new Set();
/** Called with { key, kept } when a write no longer fits; `kept` is 'disk' after making room, 'memory' otherwise. */
export function onStoragePressure(listener) { pressureListeners.add(listener); return () => pressureListeners.delete(listener); }

export function createOwnedStorage(getBacking) {
  // Values that did not fit on disk, by physical key, for this window's life:
  // reads see them, so a full cache never loses what the window is showing.
  const memory = new Map();
  const report = (key, kept) => { for (const listener of pressureListeners) { try { listener({ key, kept }); } catch { /* A listener never breaks a write. */ } } };
  /**
   * A write that hits the quota first moves the history caches (other than
   * this key) off disk into memory, then retries; if it still does not fit,
   * this value lives in memory and its stale disk copy is removed. A full
   * cache never throws: the bridge holds the real copy (ADR-0286).
   */
  function write(physical, value) {
    const backing = getBacking();
    try { backing.setItem(physical, value); memory.delete(physical); return; }
    catch (error) { if (!isQuota(error)) throw error; }
    for (const key of HISTORY_CACHE_KEYS) {
      let other;
      try { other = physicalStorageKey(key); } catch { continue; }
      if (other === physical) continue;
      const saved = backing.getItem(other);
      if (saved === null) continue;
      memory.set(other, saved);
      try { backing.removeItem(other); } catch { memory.delete(other); }
    }
    try { backing.setItem(physical, value); memory.delete(physical); report(physical, 'disk'); return; }
    catch (error) { if (!isQuota(error)) throw error; }
    memory.set(physical, value);
    try { backing.removeItem(physical); } catch { /* A stale copy is shadowed by memory for this window. */ }
    report(physical, 'memory');
  }
  const keys = () => {
    const backing = getBacking();
    const prefix = ownership ? `autohandSquad.owner.v1.${ownership.storageKey}.` : '';
    const result = [];
    for (let index = 0; index < backing.length; index++) {
      const key = backing.key(index);
      if (DEVICE_KEYS.has(key)) result.push(key);
      else if (!closed && prefix && key.startsWith(prefix)) {
        try { result.push(decodeURIComponent(key.slice(prefix.length))); } catch { /* An unknown key is never imported as legacy data. */ }
      }
    }
    for (const physical of memory.keys()) {
      let key = null;
      if (DEVICE_KEYS.has(physical)) key = physical;
      else if (!closed && prefix && physical.startsWith(prefix)) { try { key = decodeURIComponent(physical.slice(prefix.length)); } catch { key = null; } }
      if (key !== null && !result.includes(key)) result.push(key);
    }
    return result;
  };
  const methods = {
    getItem(key) {
      try { const physical = physicalStorageKey(String(key)); return memory.has(physical) ? memory.get(physical) : getBacking().getItem(physical); }
      catch (error) { if (error.code === 'context_changed') return null; throw error; }
    },
    setItem(key, value) { write(physicalStorageKey(String(key)), String(value)); },
    removeItem(key) { const physical = physicalStorageKey(String(key)); memory.delete(physical); getBacking().removeItem(physical); },
    key(index) { return keys()[index] ?? null; },
    clear() { for (const key of keys()) if (!DEVICE_KEYS.has(key)) methods.removeItem(key); },
  };
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'length') return keys().length;
      if (Object.hasOwn(methods, property)) return methods[property];
      if (typeof property === 'string') return methods.getItem(property);
    },
    set(_target, property, value) { if (typeof property !== 'string') return false; methods.setItem(property, value); return true; },
    ownKeys: keys,
    getOwnPropertyDescriptor(_target, property) { return typeof property === 'string' && keys().includes(property) ? { configurable: true, enumerable: true, value: methods.getItem(property) } : undefined; },
  });
}
export const ownedLocalStorage = createOwnedStorage(() => globalThis.localStorage);
export const ownedSessionStorage = createOwnedStorage(() => globalThis.sessionStorage);
