#!/usr/bin/env node
// Lifecycle hook forwarder (ADR-0127). Claude Code and Codex run this for
// SessionStart, UserPromptSubmit, PostToolUse, Stop and SessionEnd with the
// event as JSON on stdin; it posts a trimmed copy to the local Squad bridge
// so sessions started outside Squad appear in the Runs tab.
//
//   forward.mjs <claude|codex> <broker-port> <actor.owner.dataset storage key>
//
// Rules: never print (Claude adds UserPromptSubmit output to the model's
// context), always exit 0 within about two seconds whatever happens, and
// skip turns Squad itself started (those are recorded already and carry
// AUTOHAND_SQUAD_MEMBER in their environment).
const [engine = "claude", port = "19821", scope = ""] = process.argv.slice(2);
const done = () => process.exit(0);
setTimeout(done, 2500).unref();
if (process.env.AUTOHAND_SQUAD_MEMBER) done();
const bound=/^[a-f0-9]{64}\.[a-f0-9]{64}\.[a-f0-9-]{36}$/.test(scope);

const clip = (value, max) => (typeof value === "string" ? value.slice(0, max) : value == null ? undefined : JSON.stringify(value).slice(0, max));

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { if (input.length < 2_000_000) input += chunk; });
process.stdin.on("error", done);
process.stdin.on("end", async () => {
  if(!bound)done();
  let event = {};
  try { event = JSON.parse(input || "{}"); } catch { done(); }
  const body = {
    event: String(event.hook_event_name || event.hookEventName || ""),
    sessionId: String(event.session_id || event.sessionId || event["thread-id"] || ""),
    turnId: String(event.turn_id || event["turn-id"] || ""),
    cwd: String(event.cwd || ""),
    transcriptPath: String(event.transcript_path || ""),
    prompt: clip(event.prompt, 8000),
    toolName: clip(event.tool_name, 120),
    toolInput: clip(event.tool_input, 600),
    toolError: clip(event.tool_response?.error || event.error, 600),
    lastAssistantMessage: clip(event.last_assistant_message || event["last-assistant-message"], 16000),
    source: clip(event.source, 40),
    reason: clip(event.reason, 120),
    at: new Date().toISOString(),
  };
  try {
    const origin=`http://127.0.0.1:${Number(port) || 19821}`;
    const response=await fetch(`${origin}/api/ownership/context`,{signal:AbortSignal.timeout(700)});
    const context=(await response.json()).data;
    if(!response.ok||context?.state!=='ready'||!context.canWrite||context.storageKey!==scope)done();
    await fetch(`http://127.0.0.1:${Number(port) || 19821}/api/hooks/${engine === "codex" ? "codex" : "claude"}`, {
      method: "POST",
      headers: { "content-type": "application/json",'x-squad-context':context.generation },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1200),
    });
  } catch {
    // Squad is not running: the session goes on unrecorded.
  }
  done();
});
