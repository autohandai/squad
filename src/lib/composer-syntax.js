// Composer syntax shared by every harness: `/command`, `$skill`, `!shell`,
// and `@member` / `@file`. The app owns the commands that make sense for a
// squad member regardless of engine; the Autohand CLI additionally accepts
// its own slash commands over RPC, so those pass through when the member
// runs on Autohand Code.

export const APP_COMMANDS = [
  { name: "new", args: "", description: "Start a new conversation (resets the warm session)", scope: "app" },
  { name: "model", args: "<model>", description: "Set the model for the next messages", scope: "app" },
  { name: "harness", args: "autohand|codex|claude", description: "Switch the engine this member runs with", scope: "app" },
  { name: "workspace", args: "<path>", description: "Switch the working folder", scope: "app" },
  { name: "skills", args: "", description: "List the skills installed for this member", scope: "app" },
  { name: "run", args: "<shell command>", description: "Run a shell command in the workspace (same as !)", scope: "app" },
  { name: "help", args: "", description: "Show composer syntax and available commands", scope: "app" },
];

// Autohand Code CLI commands that work through the RPC transport.
export const AUTOHAND_CLI_COMMANDS = [
  { name: "plan", args: "<goal>", description: "Plan before acting (Autohand Code)", scope: "autohand" },
  { name: "review", args: "[scope]", description: "Review the current changes (Autohand Code)", scope: "autohand" },
  { name: "init", args: "", description: "Create or refresh AGENTS.md for this workspace (Autohand Code)", scope: "autohand" },
  { name: "compact", args: "", description: "Compact the CLI conversation context (Autohand Code)", scope: "autohand" },
  { name: "clear", args: "", description: "Clear the CLI conversation (Autohand Code)", scope: "autohand" },
];

export function commandsForHarness(harnessId = "autohand") {
  return harnessId === "autohand" ? [...APP_COMMANDS, ...AUTOHAND_CLI_COMMANDS] : APP_COMMANDS;
}

/**
 * Detect the trigger token under the caret. Returns null when the caret is not
 * inside a `@`, `/`, or `$` token that starts at the beginning of the text or
 * after whitespace (a `/` in the middle of a path does not trigger).
 */
export function composerTrigger(text, caret = String(text || "").length) {
  const value = String(text || "");
  const cursor = Math.max(0, Math.min(Number.isFinite(caret) ? caret : value.length, value.length));
  let start = -1;
  let kind = "";
  for (let index = cursor - 1; index >= 0; index -= 1) {
    const char = value[index];
    if (/\s/.test(char)) break;
    if (char === "@" || char === "$" || (char === "/" && index === 0)) {
      const previous = value[index - 1] || "";
      if (!previous || /\s/.test(previous)) {
        start = index;
        kind = char === "@" ? "mention" : char === "$" ? "skill" : "command";
      }
      break;
    }
  }
  if (start < 0) return null;
  let end = start + 1;
  while (end < value.length && /[A-Za-z0-9._/-]/.test(value[end])) end += 1;
  if (cursor > end) return null;
  const query = value.slice(start + 1, end);
  if (query.length > 120) return null;
  return { kind, query, start, end, prefix: value[start] };
}

export function insertTriggerText(text, prefix, valueToInsert, trigger) {
  const source = String(text || "");
  if (!trigger) {
    const next = `${source}${prefix}${valueToInsert} `;
    return { text: next, caret: next.length };
  }
  const before = source.slice(0, trigger.start);
  const after = source.slice(trigger.end);
  const spacer = after && /^\s/.test(after) ? "" : " ";
  const inserted = `${before}${prefix}${valueToInsert}${spacer}`;
  return { text: `${inserted}${after}`, caret: inserted.length };
}

export function isShellPrompt(text) {
  return /^\s*!/.test(String(text || "")) && String(text || "").trim().length > 1;
}

export function shellCommandFrom(text) {
  const trimmed = String(text || "").trim();
  if (trimmed.startsWith("!")) return trimmed.slice(1).trim();
  if (/^\/run\s+/i.test(trimmed)) return trimmed.replace(/^\/run\s+/i, "").trim();
  return "";
}

/** Parse `/name args` at the start of the prompt. */
export function slashCommandFrom(text) {
  const match = String(text || "").trim().match(/^\/([A-Za-z][A-Za-z0-9-]*)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: (match[2] || "").trim() };
}

/** `$skill` tokens in a prompt, deduplicated, in order. */
export function skillMentions(text) {
  const seen = new Set();
  for (const match of String(text || "").matchAll(/(?:^|\s)\$([A-Za-z0-9][A-Za-z0-9._-]*)/g)) {
    seen.add(match[1]);
  }
  return Array.from(seen);
}

/**
 * Turn `$skill` mentions into an instruction every engine understands and
 * strip the sigils from the prompt text.
 */
export function expandSkillMentions(text, knownSkills = []) {
  const mentioned = skillMentions(text).filter((name) => !knownSkills.length || knownSkills.some((skill) => skill.toLowerCase() === name.toLowerCase()));
  if (!mentioned.length) return String(text || "");
  const cleaned = String(text || "").replace(/(^|\s)\$([A-Za-z0-9][A-Za-z0-9._-]*)/g, (whole, space, name) => `${space}${name}`);
  return `${cleaned.trim()}\n\nUse the installed skill${mentioned.length > 1 ? "s" : ""} ${mentioned.map((name) => `"${name}"`).join(", ")} for this task; read the skill's SKILL.md first.`;
}

export function helpText(harnessId = "autohand") {
  const commands = commandsForHarness(harnessId)
    .map((command) => `- \`/${command.name}${command.args ? ` ${command.args}` : ""}\` — ${command.description}`)
    .join("\n");
  return [
    "**Composer syntax**",
    "- `@name` mentions a squad member (they take a handoff) · `@path` mentions a workspace file",
    "- `$skill` asks the member to use an installed skill",
    "- `!command` runs a shell command in the workspace and shows the output here",
    "- `/command` runs one of the commands below",
    "",
    "**Commands**",
    commands,
  ].join("\n");
}
