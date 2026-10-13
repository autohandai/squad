import LZString from "lz-string";

const PREFIX = "@squad-cache:lz16:v1:";

export function isStorageQuotaError(error) {
  return error?.name === "QuotaExceededError" || error?.code === 22 || error?.code === 1014;
}

export function compactChannelMessagesCache(storage, key) {
  const raw = storage.getItem(key);
  if (!raw || raw.startsWith(PREFIX)) return false;
  parseLocalJson(raw); // Preserve an existing malformed cache for diagnosis.
  const compressed = PREFIX + LZString.compressToUTF16(raw);
  if (compressed.length >= raw.length) return false;
  storage.setItem(key, compressed);
  return true;
}

export function parseLocalJson(raw) {
  const json = raw.startsWith(PREFIX)
    ? LZString.decompressFromUTF16(raw.slice(PREFIX.length))
    : raw;
  if (json === null) throw new SyntaxError("The compressed local cache is damaged.");
  return JSON.parse(json);
}

// Keep existing JSON while it fits. Only the large channel history cache uses
// this fallback: it keeps every field and record, including pending updates.
export function writeChannelMessagesCache(storage, key, value) {
  const json = JSON.stringify(value);
  try { storage.setItem(key, json); }
  catch (error) {
    if (!isStorageQuotaError(error)) throw error;
    const compressed = PREFIX + LZString.compressToUTF16(json);
    if (compressed.length >= json.length) throw error;
    storage.setItem(key, compressed);
  }
}

// A small roster or preference write may be the first operation to hit quota
// while an unchanged legacy history still occupies the space. Keep that write
// as ordinary JSON and reclaim space from the lossless history cache first.
export function writeLocalJson(storage, key, value, channelMessagesKey) {
  if (key === channelMessagesKey) return writeChannelMessagesCache(storage, key, value);
  const json = JSON.stringify(value);
  try { storage.setItem(key, json); }
  catch (error) {
    if (!isStorageQuotaError(error) || !compactChannelMessagesCache(storage, channelMessagesKey)) throw error;
    storage.setItem(key, json);
  }
}
