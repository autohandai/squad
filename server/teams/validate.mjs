// What the bridge accepts from a team file upload: a bounded body, a
// document rebuilt through the allowlist in src/lib/teams.js, and one
// sentence when it will not do. Pure apart from the Error it throws.
// See docs/adrs/ADR-0106-team-sharing-presets-and-member-menus.md.

import { TEAM_LIMITS, validateTeamFile } from "../../src/lib/teams.js";

export class TeamFileError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * The validated document from a request body of `{ document }` (an object)
 * or `{ text }` (the file's bytes as a string). Throws a `TeamFileError`
 * carrying the HTTP status: 413 when the file is too large, 400 otherwise.
 */
export function parseTeamUpload(body) {
  const source = body && typeof body === "object" ? body : {};
  const input = typeof source.text === "string" ? source.text : source.document;
  if (input === undefined || input === null) throw new TeamFileError("Send the team file as { document } or { text }.");
  const bytes = typeof input === "string" ? new TextEncoder().encode(input).length : safeBytes(input);
  if (bytes > TEAM_LIMITS.fileBytes) throw new TeamFileError(`This file is ${Math.round(bytes / 1024 / 1024)} MB; a team file holds at most ${Math.round(TEAM_LIMITS.fileBytes / 1024 / 1024)} MB.`, 413);
  const result = validateTeamFile(input);
  if (!result.ok) throw new TeamFileError(result.error, 400);
  return result;
}

function safeBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    throw new TeamFileError("This file could not be read.");
  }
}
