const DEVICE_KEYS = new Set(['autohandSquad.v1.theme', 'autohandSquad.v1.skin', 'autohandSquad.v1.locale']);
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

export function createOwnedStorage(getBacking) {
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
    return result;
  };
  const methods = {
    getItem(key) { try { return getBacking().getItem(physicalStorageKey(String(key))); } catch (error) { if (error.code === 'context_changed') return null; throw error; } },
    setItem(key, value) { getBacking().setItem(physicalStorageKey(String(key)), String(value)); },
    removeItem(key) { getBacking().removeItem(physicalStorageKey(String(key))); },
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
