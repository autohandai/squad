// Pending secret requests and payment approvals, owned by the bridge in
// <stateDir>/vault-requests.json so they survive a restart and so a member
// can never resolve its own request. A request is created by a member tool,
// resolved by a person (browser route), and its outcome is handed to the
// member's next turn as text carrying only the item id and hint. See
// ADR-0104 and ADR-0075 for the proposal pattern this follows.

import { randomUUID } from "node:crypto";

import { readPersistentJson, writePersistentJson } from "../persistent-json.mjs";
import { VAULT_KINDS, VaultError } from "./crypto.mjs";

const FILE_VERSION = 1;
const MAX_REQUESTS = 500;
const PAYMENT_DECISIONS = ["approve", "self", "decline"];
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clip = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function memberId(value) {
  const id = clip(value, 200);
  if (!id || ["__proto__", "constructor", "prototype"].includes(id)) throw new VaultError("A member identity is required.");
  return id;
}

/** What leaves the bridge: never a submitted value, never the raw outcome text. */
export function publicRequest(request) {
  return {
    id: request.id,
    type: request.type,
    status: request.status,
    memberId: request.memberId,
    runId: request.runId || "",
    channelId: request.channelId || "",
    createdAt: request.createdAt,
    resolvedAt: request.resolvedAt || null,
    request: { ...request.request },
    outcome: request.outcome ? { action: request.outcome.action, itemId: request.outcome.itemId || null, hint: request.outcome.hint || "", label: request.outcome.label || "" } : null,
  };
}

export function createVaultRequests({ stateDir, emit = () => {}, now = () => new Date().toISOString() }) {
  const file = `${stateDir}/vault-requests.json`;
  let queue = Promise.resolve();
  const serial = (operation) => {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  };
  async function read() {
    const state = await readPersistentJson(file, { version: FILE_VERSION, requests: [] });
    if (!record(state) || !Array.isArray(state.requests)) throw new VaultError(`The vault request file at ${file} has an unexpected shape.`, 503);
    return { version: FILE_VERSION, requests: state.requests.filter((item) => record(item) && typeof item.id === "string") };
  }
  async function save(state) {
    if (state.requests.length > MAX_REQUESTS) {
      // Keep every pending request; trim the oldest resolved ones.
      const pending = state.requests.filter((item) => item.status === "pending");
      const resolved = state.requests.filter((item) => item.status !== "pending").slice(-(MAX_REQUESTS - pending.length));
      state.requests = [...pending, ...resolved].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    }
    await writePersistentJson(file, state);
  }
  function create(type, member, context, request) {
    return serial(async () => {
      const state = await read();
      const item = {
        id: `vrq_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        type,
        status: "pending",
        memberId: member,
        runId: clip(context.runId, 200),
        channelId: clip(context.channelId, 200),
        createdAt: now(),
        request,
      };
      state.requests.push(item);
      await save(state);
      emit("vault.request.pending", { requestId: item.id, memberId: member, runId: item.runId, channelId: item.channelId, type, title: type === "payment" ? `${request.amount} ${request.currency} to ${request.merchant}` : request.label });
      return publicRequest(item);
    });
  }
  async function resolve(id, outcome) {
    const state = await read();
    const item = state.requests.find((entry) => entry.id === id);
    if (!item) throw new VaultError("That request no longer exists.", 404);
    if (item.status !== "pending") throw new VaultError("That request was already answered.", 409);
    item.status = "resolved";
    item.resolvedAt = now();
    item.outcome = outcome;
    await save(state);
    emit("vault.request.resolved", { requestId: item.id, memberId: item.memberId, runId: item.runId, type: item.type, action: outcome.action });
    return publicRequest(item);
  }

  return {
    file,
    createSecret(member, context, input) {
      const owner = memberId(member);
      const kind = clip(input?.kind, 20);
      if (!VAULT_KINDS.includes(kind)) throw new VaultError("kind must be login, card or identity.");
      const label = clip(input?.label, 60);
      if (!label) throw new VaultError("Say what the secret is for (label).");
      return create("secret", owner, context || {}, { kind, label, reason: clip(input?.reason, 300), saveToVault: input?.saveToVault !== false });
    },
    createPayment(member, context, input) {
      const owner = memberId(member);
      const merchant = clip(input?.merchant, 120);
      const amount = clip(input?.amount, 40);
      const currency = clip(input?.currency, 8).toUpperCase();
      if (!merchant) throw new VaultError("Say who is being paid (merchant).");
      if (!amount || !/^[0-9][0-9.,]*$/.test(amount)) throw new VaultError("amount must be a number, like 19.99.");
      if (!/^[A-Z]{3}$/.test(currency)) throw new VaultError("currency must be a three-letter code, like USD.");
      return create("payment", owner, context || {}, { merchant, amount, currency, site: clip(input?.site, 200).toLowerCase(), reason: clip(input?.reason, 300) });
    },
    async list({ status = "", memberId: member = "" } = {}) {
      const state = await read();
      return state.requests.filter((item) => (!status || item.status === status) && (!member || item.memberId === member)).map(publicRequest);
    },
    async get(id) {
      const item = (await read()).requests.find((entry) => entry.id === id);
      return item ? publicRequest(item) : null;
    },
    /**
     * A person answered a secret request: the values go to the store, the
     * member later sees only the new item's id and hint.
     */
    completeSecret(id, { fields, label }, store) {
      return serial(async () => {
        const current = (await read()).requests.find((entry) => entry.id === id);
        if (!current) throw new VaultError("That request no longer exists.", 404);
        if (current.type !== "secret") throw new VaultError("That request is not a secret request.");
        if (current.status !== "pending") throw new VaultError("That request was already answered.", 409);
        const item = await store.add(current.request.kind, fields, { label: label || current.request.label });
        return resolve(id, { action: "provided", itemId: item.id, hint: item.hint, label: item.label, saved: current.request.saveToVault });
      });
    },
    dismissSecret(id) {
      return serial(async () => {
        const current = (await read()).requests.find((entry) => entry.id === id);
        if (!current || current.type !== "secret") throw new VaultError("That request no longer exists.", 404);
        return resolve(id, { action: "declined" });
      });
    },
    decidePayment(id, { decision, itemId = "" }, store) {
      return serial(async () => {
        if (!PAYMENT_DECISIONS.includes(decision)) throw new VaultError("decision must be approve, self or decline.");
        const current = (await read()).requests.find((entry) => entry.id === id);
        if (!current) throw new VaultError("That request no longer exists.", 404);
        if (current.type !== "payment") throw new VaultError("That request is not a payment request.");
        if (current.status !== "pending") throw new VaultError("That payment was already decided.", 409);
        if (decision === "approve") {
          const item = itemId ? await store.get(String(itemId)) : null;
          if (!item || item.kind !== "card") throw new VaultError("Choose a saved card to pay with.");
          return resolve(id, { action: "approved", itemId: item.id, hint: item.hint, label: item.label });
        }
        return resolve(id, { action: decision === "self" ? "self" : "declined" });
      });
    },
    /**
     * Outcomes the member has not been told about yet, as the text its next
     * turn receives. Marks them delivered.
     */
    takeOutcomes(member) {
      return serial(async () => {
        const state = await read();
        const due = state.requests.filter((item) => item.memberId === member && item.status === "resolved" && !item.deliveredAt);
        if (!due.length) return [];
        const at = now();
        for (const item of due) item.deliveredAt = at;
        await save(state);
        return due.map((item) => ({ id: item.id, type: item.type, text: outcomeText(item) }));
      });
    },
  };
}

export function outcomeText(item) {
  const outcome = item.outcome || {};
  if (item.type === "secret") {
    if (outcome.action === "provided") return `The person answered your request for “${item.request.label}”: it is in the vault as item ${outcome.itemId} (${outcome.hint})${outcome.saved === false ? ", for this task only" : ""}. You never receive the value; filling it needs a member workstation.`;
    return `The person declined your request for “${item.request.label}”. Do not ask again this turn; continue without it or explain what you cannot do.`;
  }
  const payment = `${item.request.amount} ${item.request.currency} to ${item.request.merchant}`;
  if (outcome.action === "approved") return `Approved: pay ${payment} with vault item ${outcome.itemId} (${outcome.hint}). Filling the card needs a member workstation; on this Mac, report that the payment is approved and waiting for a workstation.`;
  if (outcome.action === "self") return `The person will pay ${payment} themselves. Do not attempt the payment; continue with what comes after it.`;
  return `The person declined the payment of ${payment}. Do not pay. Say what you would suggest instead.`;
}
