// Folder access requests (ADR-0116): pure helpers, no React, no DOM, so
// scripts/check-chats.mjs can import this from Node.
//
// Claude Code's `--restricted` mode confines the file tools to the working
// directory and the `--add-dir` folders, and refuses anything else with
// "<path> is outside <dirs>; --restricted confines the file tools to the
// working directory." That refusal is the member asking for a folder. The
// person is asked once; a grant lands in the member's folders (projects),
// which the bridge turns into `--add-dir` on every later turn.

const CLAUDE_DENIAL = /(\/[^\n]*?|[A-Za-z]:\\[^\n]*?) is outside [^\n]*?--restricted confines the file tools to the working directory/;
const FILE_LIKE = /\.[A-Za-z0-9]{1,8}$/;

/** The folder a denied path points at: globs trimmed, a file reduced to its folder. */
export function folderFromDeniedPath(raw) {
  let path = String(raw || "").trim().replace(/[/\\]\*\*?$/, "").replace(/[/\\]+$/, "");
  if (!path) return "";
  const slash = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const last = path.split(slash).pop() || "";
  if (FILE_LIKE.test(last) && !last.startsWith(".")) path = path.split(slash).slice(0, -1).join(slash);
  return path;
}

/** Denials found in one tool output. */
export function denialsInText(text) {
  const match = String(text || "").match(CLAUDE_DENIAL);
  if (!match) return [];
  const folder = folderFromDeniedPath(match[1]);
  return folder ? [folder] : [];
}

/**
 * Folders a reply asked for and was refused, from its stream events (live)
 * or its trace events (restored). Unique, in first-seen order.
 */
export function deniedFolders(message) {
  const events = Array.isArray(message?.streamEvents) && message.streamEvents.length ? message.streamEvents : Array.isArray(message?.trace?.events) ? message.trace.events : [];
  const folders = [];
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const text = event.type === "tool_end" || event.type === "tool_update" || event.type === "tool_result" ? event.output || event.content || event.error || "" : "";
    for (const folder of denialsInText(text)) if (!folders.includes(folder)) folders.push(folder);
  }
  return folders;
}

export function folderIsGranted(agent, folder) {
  return (Array.isArray(agent?.projects) ? agent.projects : []).some((project) => String(project?.path || "") === folder);
}

export function folderWasDismissed(message, folder) {
  return (Array.isArray(message?.folderAccessDismissed) ? message.folderAccessDismissed : []).includes(folder);
}

/** The folders a card should still ask about for this reply. */
export function pendingFolderRequests(agent, message) {
  return deniedFolders(message).filter((folder) => !folderIsGranted(agent, folder) && !folderWasDismissed(message, folder));
}

/** The member's folders with one more, as the profile editor would store it. */
export function projectsWithFolder(agent, folder, { now = new Date().toISOString() } = {}) {
  const projects = Array.isArray(agent?.projects) ? agent.projects : [];
  if (projects.some((project) => String(project?.path || "") === folder)) return projects;
  const name = folder.split(/[\\/]/).filter(Boolean).pop() || folder;
  return [...projects, { id: `folder_${Date.now().toString(36)}`, name, label: folder, path: folder, kind: "folder", addedAt: now }];
}

/** The follow-up that lets the member carry on once the folder is allowed. */
export function continuationPrompt(folder) {
  return `You now have access to ${folder}. Continue where you stopped.`;
}
