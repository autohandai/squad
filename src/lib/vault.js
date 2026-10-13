// Pure vault helpers shared by the settings section, the chat cards and the
// Node check: what each kind's form asks for, and how a pending request
// reads in Needs you. No React, no DOM. See ADR-0104.

export const VAULT_KINDS = [
  { id: "login", label: "Login", detail: "A site, a username and a password." },
  { id: "card", label: "Card", detail: "Number, expiry, security code and the name on it." },
  { id: "identity", label: "Personal details", detail: "Name, email, phone and address for forms." },
];

/** Form fields per kind. `secret` fields render as password inputs. */
export const VAULT_FORM_FIELDS = Object.freeze({
  login: [
    { key: "site", label: "Site", placeholder: "github.com", autoComplete: "url" },
    { key: "username", label: "Username or email", placeholder: "you@example.com", autoComplete: "username" },
    { key: "password", label: "Password", secret: true, autoComplete: "current-password" },
  ],
  card: [
    { key: "number", label: "Card number", secret: true, autoComplete: "cc-number", inputMode: "numeric" },
    { key: "expiry", label: "Expiry", placeholder: "MM/YY", autoComplete: "cc-exp" },
    { key: "cvv", label: "Security code", secret: true, autoComplete: "cc-csc", inputMode: "numeric", optional: true },
    { key: "name", label: "Name on card", autoComplete: "cc-name", optional: true },
  ],
  identity: [
    { key: "name", label: "Full name", autoComplete: "name", optional: true },
    { key: "email", label: "Email", autoComplete: "email", optional: true },
    { key: "phone", label: "Phone", autoComplete: "tel", optional: true },
    { key: "address_line1", label: "Address", autoComplete: "address-line1", optional: true },
    { key: "address_line2", label: "Address line 2", autoComplete: "address-line2", optional: true },
    { key: "city", label: "City", autoComplete: "address-level2", optional: true },
    { key: "state", label: "State or region", autoComplete: "address-level1", optional: true },
    { key: "postcode", label: "Postcode", autoComplete: "postal-code", optional: true },
    { key: "country", label: "Country", autoComplete: "country-name", optional: true },
  ],
});

export function vaultKindLabel(kind) {
  return VAULT_KINDS.find((item) => item.id === kind)?.label || "Item";
}

/** Human line for where the key is held. */
export function vaultKeySourceLabel(source) {
  switch (source) {
    case "keychain":
      return "Held by the macOS Keychain";
    case "dpapi":
      return "Held by Windows (DPAPI)";
    case "secret-service":
      return "Held by the Linux Secret Service";
    case "file":
      return "Held in a private key file outside the data folder";
    default:
      return "Created when the first item is saved";
  }
}

export function paymentLine(request) {
  const details = request?.request || {};
  return `${details.amount || ""} ${details.currency || ""} to ${details.merchant || "a merchant"}`.replace(/\s+/g, " ").trim();
}

/** Needs you rows for pending vault requests. */
export function vaultNeedsYouRows(requests = [], members = []) {
  const nameOf = (id) => members.find((member) => member.id === id)?.name || "A member";
  return requests
    .filter((item) => item?.status === "pending")
    .map((item) => ({
      id: `vault-${item.id}`,
      request: item,
      memberId: item.memberId,
      title: item.type === "payment" ? `${nameOf(item.memberId)} wants to pay ${paymentLine(item)}` : `${nameOf(item.memberId)} needs ${item.request?.label || "a secret"}`,
      detail: item.request?.reason || (item.type === "payment" ? item.request?.site || "" : `${vaultKindLabel(item.request?.kind)} · goes straight to your vault`),
      at: item.createdAt || "",
    }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
