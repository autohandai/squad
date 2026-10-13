// Sealing and shaping vault items. Pure: the key is passed in, nothing here
// touches the disk, the OS keychain or the network.
//
// A value is sealed with AES-256-GCM under the vault's data key. The item id
// and kind are bound as associated data, so a ciphertext cut from one item
// and pasted onto another fails to open instead of opening as the wrong
// thing. The browser and every member only ever see `view()` of an item:
// label, kind, site and a masked hint. See ADR-0104.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const VAULT_KINDS = ["login", "card", "identity"];

/** The fields a member could ask to have filled for each kind (L3). */
export const VAULT_FIELDS = Object.freeze({
  login: ["username", "password"],
  card: ["number", "expiry", "expiry_month", "expiry_year", "expiry_year_short", "cvv", "name"],
  identity: ["name", "email", "phone", "address", "address_line1", "address_line2", "city", "state", "postcode", "country"],
});

const MAX_FIELD = 1000;

export class VaultError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "VaultError";
    this.status = status;
  }
}

export class VaultOpenError extends VaultError {
  constructor(label) {
    super(`${label ? `“${label}”` : "This vault item"} could not be opened: it was changed outside Squad or the vault key is not the one it was saved with.`, 409);
    this.name = "VaultOpenError";
  }
}

const text = (value) => (typeof value === "string" ? value : value == null ? "" : String(value)).trim();
const digits = (value) => text(value).replace(/\D/g, "");

function luhn(number) {
  let sum = 0;
  for (let index = 0; index < number.length; index += 1) {
    let digit = Number(number[number.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** "https://www.Example.com/login" → "example.com". */
export function siteOf(input) {
  const value = text(input).toLowerCase();
  if (!value) return "";
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.replace(/^www\./, "");
  } catch {
    return value.replace(/^www\./, "").split("/")[0];
  }
}

export function cardBrand(number) {
  if (/^4/.test(number)) return "Visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]|7[01]|720))/.test(number)) return "Mastercard";
  if (/^3[47]/.test(number)) return "Amex";
  if (/^6(011|4[4-9]|5)/.test(number)) return "Discover";
  return "Card";
}

export function maskHandle(value) {
  const handle = text(value);
  if (!handle) return "";
  if (handle.includes("@")) {
    const [user, domain] = handle.split("@");
    return `${user.slice(0, 1)}•••@${domain}`;
  }
  const numbers = digits(handle);
  if (numbers.length >= 7) return `•••• ${numbers.slice(-4)}`;
  return `${handle.slice(0, 2)}•••`;
}

/**
 * Check and normalise the fields for a kind. Returns only the fields that
 * were given; throws a VaultError naming the first problem.
 */
export function normalizeFields(kind, input) {
  if (!VAULT_KINDS.includes(kind)) throw new VaultError("The vault keeps logins, cards and personal details.");
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  for (const value of Object.values(source)) {
    if (value != null && typeof value !== "string") throw new VaultError("Vault fields must be text.");
    if (typeof value === "string" && value.length > MAX_FIELD) throw new VaultError("A vault field is too long.");
  }
  const fields = {};
  if (kind === "login") {
    const site = siteOf(source.site);
    if (site.length < 3) throw new VaultError("Which site is this login for?");
    const username = text(source.username);
    if (!username) throw new VaultError("Add the email, phone number or username.");
    const password = typeof source.password === "string" ? source.password : "";
    if (!password) throw new VaultError("Add the password.");
    Object.assign(fields, { site, username: username.slice(0, 320), password });
  } else if (kind === "card") {
    const number = digits(source.number);
    if (number.length < 12 || number.length > 19 || !luhn(number)) throw new VaultError("That card number isn't valid.");
    const expiry = text(source.expiry).match(/^(0[1-9]|1[0-2])\s*\/\s*(\d{2}|\d{4})$/);
    if (!expiry) throw new VaultError("Expiry looks like MM/YY.");
    const cvv = text(source.cvv);
    if (cvv && !/^\d{3,4}$/.test(cvv)) throw new VaultError("The security code is 3 or 4 digits.");
    Object.assign(fields, { number, expiry: `${expiry[1]}/${expiry[2].slice(-2)}` });
    if (cvv) fields.cvv = cvv;
    if (text(source.name)) fields.name = text(source.name).slice(0, 200);
  } else {
    for (const key of ["name", "email", "phone", "address_line1", "address_line2", "city", "state", "postcode", "country"]) {
      const value = text(source[key]);
      if (value) fields[key] = value.slice(0, 200);
    }
    if (!Object.keys(fields).length) throw new VaultError("Add at least one personal detail.");
  }
  return fields;
}

/** The masked line a member and the browser see instead of the value. */
export function hintFor(kind, fields) {
  switch (kind) {
    case "card":
      return `${cardBrand(fields.number || "")} ···· ${String(fields.number || "").slice(-4)} · ${fields.expiry || ""}`.trim();
    case "login":
      return `${maskHandle(fields.username)} · ${fields.site}`;
    default:
      return [fields.name, fields.email && maskHandle(fields.email), fields.phone && maskHandle(fields.phone), fields.city].filter(Boolean).join(" · ") || "Personal details";
  }
}

export function defaultLabel(kind, fields) {
  switch (kind) {
    case "card":
      return `${cardBrand(fields.number || "")} ${String(fields.number || "").slice(-4)}`;
    case "login":
      return fields.site || "Login";
    default:
      return fields.name || "Me";
  }
}

/** The value to fill for one field, including derived ones (expiry parts, joined address). */
export function fieldValue(kind, fields, field) {
  if (!VAULT_FIELDS[kind]?.includes(field)) {
    throw new VaultError(`A ${kind} has no "${field}". Fields: ${(VAULT_FIELDS[kind] || []).join(", ")}.`);
  }
  const [month, year] = String(fields.expiry || "").split("/");
  const derived = {
    expiry_month: month || "",
    expiry_year: year ? `20${year}` : "",
    expiry_year_short: year || "",
    address: [fields.address_line1, fields.address_line2, fields.city, fields.state, fields.postcode, fields.country].filter(Boolean).join(", "),
  };
  return fields[field] ?? derived[field] ?? "";
}

/** iv (12) | tag (16) | ciphertext, base64. */
export function seal(key, id, kind, fields) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new VaultError("The vault key is invalid.", 503);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${id}:${kind}`));
  const body = Buffer.concat([cipher.update(JSON.stringify(fields), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function unseal(key, id, kind, secret, label = "") {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new VaultError("The vault key is invalid.", 503);
  try {
    const raw = Buffer.from(String(secret || ""), "base64");
    if (raw.length < 29) throw new Error("short");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${id}:${kind}`));
    decipher.setAuthTag(raw.subarray(12, 28));
    const body = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    const fields = JSON.parse(body.toString("utf8"));
    if (!fields || typeof fields !== "object") throw new Error("shape");
    return fields;
  } catch {
    throw new VaultOpenError(label);
  }
}

/** The shape that leaves the bridge. Never includes `secret`. */
export function view(item) {
  return {
    id: item.id,
    kind: item.kind,
    label: item.label,
    hint: item.hint,
    site: item.site || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt || item.createdAt,
    lastUsedAt: item.lastUsedAt || null,
  };
}
