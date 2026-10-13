// The member menu's state rules: pinning, hiding, marking unread, and
// duplicating a member into the New member screen.
//
// Pinned and hidden are two booleans on the member record, so they persist
// where member state already persists (the stored roster) and travel to
// other windows with every other member patch. Unread is not a flag: the
// app counts replies newer than the last read time, so "mark unread" moves
// that time back to just before the latest reply and a real new reply would
// have produced the same count. Nothing here knows about React or storage.
//
// Pure, so scripts/check-teams.mjs can prove the rules from Node.
// See docs/adrs/ADR-0106-team-sharing-presets-and-member-menus.md.

export const MEMBER_ID_PREFIX = "asq_";

/** The patch that pins or unpins a member. Pinned members keep their order by when they were pinned. */
export function pinPatch(agent, pinned, now = new Date().toISOString()) {
  return pinned ? { pinned: true, pinnedAt: now, updatedAt: now } : { pinned: false, pinnedAt: "", updatedAt: now };
}

/** The patch that hides or shows a member. Hiding also unpins: a hidden pin is a contradiction. */
export function hidePatch(agent, hidden, now = new Date().toISOString()) {
  return hidden ? { hidden: true, hiddenAt: now, pinned: false, pinnedAt: "", updatedAt: now } : { hidden: false, hiddenAt: "", updatedAt: now };
}

export function isPinned(agent) {
  return agent?.pinned === true;
}

export function isHidden(agent) {
  return agent?.hidden === true;
}

/**
 * Members in the order the directory and sidebar show them: pinned first (in
 * the order they were pinned), then everyone else in their existing order.
 * Hidden members are left out; `hiddenMembers` lists them.
 */
export function orderMembers(agents = []) {
  const list = Array.isArray(agents) ? agents.filter((agent) => agent && !isHidden(agent)) : [];
  const pinned = list.filter(isPinned).sort((a, b) => String(a.pinnedAt || "").localeCompare(String(b.pinnedAt || "")));
  const rest = list.filter((agent) => !isPinned(agent));
  return [...pinned, ...rest];
}

export function hiddenMembers(agents = []) {
  return Array.isArray(agents) ? agents.filter((agent) => agent && isHidden(agent)) : [];
}

function timestampOf(message) {
  const value = message?.completedAt || message?.createdAt || message?.updatedAt || message?.startedAt || "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The read time that makes the latest reply count as unread again: one
 * millisecond before it. Empty when there is no finished reply to mark,
 * because then no new reply could have produced a count either.
 */
export function markUnreadReadAt(messages = []) {
  const replies = (Array.isArray(messages) ? messages : []).filter((message) => message?.role === "agent" && message.status !== "loading");
  const latest = replies.reduce((max, message) => Math.max(max, timestampOf(message)), 0);
  if (!latest) return "";
  return new Date(latest - 1).toISOString();
}

/** How many replies count as unread for a member, by the app's own rule. */
export function unreadCount(messages = [], readAt = "") {
  const last = Date.parse(readAt || "") || 0;
  return (Array.isArray(messages) ? messages : []).filter((message) => message?.role === "agent" && message.status !== "loading" && timestampOf(message) > last).length;
}

export function createMemberId(now = Date.now(), random = Math.random) {
  return `${MEMBER_ID_PREFIX}${now.toString(36)}${Math.floor(random() * 36 ** 4).toString(36).padStart(4, "0")}`;
}

/**
 * What the New member screen restores when it opens: the same shape it
 * saves for an unfinished draft (ADR-0077), carrying this member's role,
 * personality files, brain card, skills and harness as a custom role. The
 * copy then goes through the same confirmed creation as any member, so it
 * is provisioned like one.
 */
export function duplicateCreationStash(agent, { memberId = createMemberId(), now = Date.now() } = {}) {
  const source = agent && typeof agent === "object" ? agent : {};
  const templateId = `custom-role-${now.toString(36)}-copy`;
  // Authored text is kept whole: the create form's own limits apply when
  // the person saves, and a duplicate must not arrive shorter than its source.
  const brainCardSource = source.brainCard && typeof source.brainCard === "object" ? source.brainCard : {};
  const base = {
    name: `${String(source.name || "Member").trim()} copy`.slice(0, 60),
    role: String(source.role || source.title || "Squad member").trim().slice(0, 80),
    description: String(source.description || "").trim(),
    instructions: String(source.instructions || "").trim(),
    skills: Array.from(new Set((Array.isArray(source.skills) ? source.skills : []).map((skill) => String(typeof skill === "string" ? skill : skill?.name || "").trim()).filter(Boolean))),
    brainCard: Object.fromEntries(Object.entries(brainCardSource).filter(([, value]) => typeof value === "string").map(([key, value]) => [key, value.trim()])),
  };
  const profileFiles = (Array.isArray(source.profileFiles) ? source.profileFiles : [])
    .filter((file) => file && typeof file === "object" && String(file.content || "").trim())
    .map((file) => ({ section: file.section, fileName: file.fileName, originalFileName: file.originalFileName || "", content: String(file.content), source: file.source || "manual" }));
  const template = {
    id: templateId,
    title: base.role,
    label: "Custom",
    accent: "green",
    description: base.description,
    starter: base.instructions,
    skills: base.skills,
    skillSource: source.skillSource || "",
    avatar: source.avatar || "",
    brainCard: base.brainCard,
    profileFiles,
    duplicateOf: source.id || "",
  };
  const draft = {
    employeeType: templateId,
    name: base.name,
    role: base.role,
    workspace: String(source.workspace || ""),
    description: base.description,
    instructions: base.instructions,
    skills: base.skills,
    skillSource: source.skillSource || "",
    avatar: source.avatar || "",
    profileFiles,
    brainCard: template.brainCard,
    harness: source.harness && typeof source.harness === "object" ? { ...source.harness } : null,
  };
  return {
    version: 1,
    memberId,
    templateId,
    customTemplates: [template],
    namesByTemplate: { [templateId]: base.name },
    roleWish: "",
    draft,
    preparing: false,
  };
}
