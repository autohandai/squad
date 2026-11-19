// What a member may do with an email, by the urgency it gives it (ADR-0267).
// Pure, shared by the bridge (prompt, reply tool) and the app (Communications).

export const URGENCY_LEVELS = Object.freeze([
  { id: "urgent", label: "Urgent", hint: "Needs an answer today: a customer blocked, a deadline, money at stake." },
  { id: "normal", label: "Normal", hint: "A real request that can wait a day." },
  { id: "low", label: "Low", hint: "Newsletters, notifications, cold outreach, receipts." },
]);

export const EMAIL_ACTIONS = Object.freeze([
  { id: "reply", label: "Reply on its own", short: "Replies on its own" },
  { id: "approve", label: "Ask me first", short: "Drafts a reply for you to send" },
  { id: "tell", label: "Just tell me", short: "Only tells you" },
]);

/** Safe until the person chooses otherwise: nothing goes out without them. */
export const DEFAULT_EMAIL_POLICY = Object.freeze({ urgent: "approve", normal: "tell", low: "tell" });

export function normalizeEmailPolicy(value) {
  const source = value && typeof value === "object" ? value : {};
  const ids = new Set(EMAIL_ACTIONS.map((action) => action.id));
  return Object.fromEntries(URGENCY_LEVELS.map(({ id }) => [id, ids.has(source[id]) ? source[id] : DEFAULT_EMAIL_POLICY[id]]));
}

export function normalizeUrgency(value) {
  const id = String(value || "").trim().toLowerCase();
  return URGENCY_LEVELS.some((level) => level.id === id) ? id : "normal";
}

/** The lines the member reads about urgency and what each level allows. */
export function emailPolicyLines(policy, { memberName = "you" } = {}) {
  const rules = normalizeEmailPolicy(policy);
  const what = { reply: "reply to the sender yourself with squad_reply_email", approve: "draft a reply and send it with squad_reply_email: the person approves it before it goes", tell: "do not reply; only tell the person" };
  return [
    "First decide how urgent it is, and start your message to the person with one line: `Urgency: urgent|normal|low — <one-line reason>`.",
    ...URGENCY_LEVELS.map(({ id, hint }) => `- ${id} (${hint}): ${what[rules[id]]}.`),
    "A reply goes only to the person who wrote, from your own address, once per email. Write it as yourself, short and specific; never promise what you cannot do, never share files or anything private from the person's work, and never reply to automated or no-reply senders.",
  ];
}
