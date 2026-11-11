# ADR-0161: The first-run path reaches the person

Date: 2026-11-02
Status: Accepted

## Context and evidence

A colleague reset Squad 0.1.14 to a clean install and followed the first-run
path on a documentation repository: Start with Chief of Staff, the suggested
first prompt, then the steps Chief of Staff proposed. The first review was
strong; every later step stalled, and nothing landed in the repo. Their
write-up traced each stall to a cause. Reading the bundled Autohand Code 0.9.7
source confirmed each one.

- **Squad team tools denied at every ladder level and in every permission
  mode.** With Built-in tool rules on, Squad wrote `availableTools` from the
  115 built-in kinds of the ladder. The CLI treats a non-empty
  `availableTools` as a strict allowlist, checked before the permission mode
  (`PermissionManager.ts`, `checkPatterns`), and matches the tool kind exactly
  (`toolPatterns.ts`). MCP tools are named `mcp__<server>__<tool>`, and no
  such name was written. The vault and Computer Use servers were in the same
  position. The `squad_create_channel` and `squad_schedule` rows in the UI are
  bare names Squad consults itself; they never reached the engine's check.
- **Permission requests ended declined with nothing to click.** In RPC mode
  the CLI notifies `autohand.permissionRequest`, waits 30 s for an
  acknowledgement and then an hour for a decision, and denies without either
  (`adapter.ts`, `requestPermission`). Squad showed "Waiting for permission…"
  and called neither method, although the Agent SDK exposes both.
- **Questions answered by nobody.** Members launch with `--yes`.
  `executeAgentAskFollowupQuestion` returns `<answer>Yes</answer>` under that
  flag; without it, RPC mode has no follow-up callback and waits on a terminal
  modal. The turn context also carries `yes=true`, which the member quoted.
- **The conversation went with the engine session.** Warm sessions close
  after 15 minutes idle, on Stop, on any launch-option change and on bridge
  restart. The browser already sent the last twelve turns with every message;
  the bridge used them only when an engine fallback took over.
- **Inherited approvals.** A new member's config was seeded from the whole
  `~/.autohand/config.json`, permissions included. The reporter's Chief of
  Staff carried 13 `allowList` grants for other repositories and shell
  commands; this machine's own config carries 232. The save path also merged
  the new permission keys over the old block, so turning Built-in tool rules
  off left the previous lists in place.
- **No route to the team builder.** Asked to create agents, Chief of Staff
  offered the CLI's `create_team`/`add_teammate`, which start processes inside
  its own session. Nothing in its instructions or tools led to Squad's team
  builder (ADR-0142).

## Decision

1. **Write the engine's names.** `managedToolPolicies` (src/lib/permission-
   policy.js) maps the bare rows to `mcp__<server>__<tool>` for the team,
   vault, Computer Use and built-in web research servers, and the bridge adds
   them to `availableTools`, `allowPatterns`, `rules` and `excludedTools`. A new
   "Squad team tools" group lists every team tool (allow at every rung;
   `squad_create_channel` stays ask on Squad's side). A person's explicit
   block still blocks. A saved profile from before the group existed gets the
   group's defaults. Choosing a ladder level still applies the level's preset,
   Built-in tool rules on and full lists included (§1.5); the ladder now says
   so in its one sentence, and team-tool access no longer depends on the
   level.
2. **Answer permission requests from the chat.** `server/permission-
   approvals.mjs` acknowledges each request at once, keeps it while the turn is
   live, forwards the person's decision over the SDK, and denies whatever is
   still open when the turn ends. The chat shows one divider row per request
   with Allow once, Allow for this reply and Deny; `POST /api/chat/permission`
   carries the answer. Only once/session scopes are offered, so no decision
   writes the member's `allowList`. Work details shows the outcome.
3. **Exclude what can never reach a window, and give members a question
   that can.** `ask_followup_question`, `create_team`, `add_teammate`,
   `team_status` and `send_team_message` are blocked at every rung and
   excluded whether or not rules are on. In their place the team server
   offers `squad_ask` (§2.1): the member calls it when it cannot continue
   without an answer, the bridge sends a `question_request` event down the
   reply's own stream, the chat shows the question with its options and an
   answer field, and `POST /api/chat/question` returns the answer as the
   tool's result (`server/questions.mjs`). A turn nobody watches, a goal, a
   queued follow-up or a channel thread, is refused at once with the
   instruction to end the reply with the question; an unanswered question
   times out after ten minutes or when the reply ends, and the member hears
   "no answer". Members are told to use it only when they cannot continue,
   and to write a draft to a file or memory before asking where it should
   go. `check-questions` covers the registry and the card's helper;
   `check-team` drives the tool on an unwatched turn and on a live stream.
   Live, the first run of the question step showed the card, took the
   person's option in four seconds and handed it to the member; the reply
   then ended with the CLI's own guard, "The model kept announcing steps
   instead of executing them through 2 tool-free recoveries", because the
   prompt said "continue with my answer" and the model narrated what it
   would do next. A question's follow-up is a statement, and the
   walkthrough asks for one.
4. **Replay on a fresh session.** The first prompt a session receives carries
   the recent conversation (12 turns, 12 000 characters) in a marked block,
   and the chat says "The engine session restarted; replaying…". Sessions
   warmed before the window opened count as fresh.
5. **Seed members without permissions**; replace, do not merge, the rule
   lists and `allowList`/`denyList` on every save.
6. **A team tool that builds a team.** `squad_propose_team` records a
   proposal receipt; the chat shows the roster with Create team / Not now;
   Create team runs the same import as New team (`teamDocumentFromProposal`).
   The members start at the default ladder level (Edit files), not at the
   Suggest commands level an imported file gets: at that level the Frontend
   Developer the demo created could not read one file and answered that
   "every tool is being denied". The person's Create team is the trust step.

7. **What the live walkthrough showed.** Driving the path on a fresh
   bridge with the real account (`scripts/lib/live-driver.mjs`): the first
   review opened on the engine's own `.autohand/` folder, the only untracked
   thing in a new repository, before the project. The bridge now adds
   `.autohand/` to the workspace's `.git/info/exclude` when a member is
   prepared and tells the member what the folder is. On a phone the chat
   header's controls pushed the member's name and status under the New chat
   button; the controls are icons below the `sm` breakpoint and Canvas, Tasks,
   Threads and Runs leave the header there. Unknown engine notifications keep
   their method name in the run log, because a stalled turn had nothing else
   to read.

8. **The engine's automatic specialists are off for members.** The live
   walkthrough's second message stalled for 29 minutes and then failed with
   "no activity for 3 minutes", a message that was wrong: the engine had sent
   a keep-alive every few seconds. With notification methods logged, the
   second attempt showed `autohand.hook.subagentStart` half a second after
   the prompt, before any model output: the CLI's `automatic_specialists`
   experiment (`features.automaticSpecialists`, default on) matches the
   prompt against orchestration verbs, "team/specialists/agents" and a role
   alias, and runs its own planner and implementer sub-agents first. Squad's
   turn context and a replayed conversation contain those words, so the
   feature fired on a two-sentence confirmation. Every member config now sets
   `features.automaticSpecialists: false`; Squad's team is the one a person
   can see. Sub-agent notifications now read as "Planner (engine sub-agent)
   thinking…" in the chat, and a turn that produces only keep-alive pings for
   ten minutes stops with that reason instead of waiting for the inactivity
   window.

9. **Ask rules ask in a direct conversation.** The third live run wrote
   `docs/plan.md` without any prompt: every member chat launched with the
   CLI's `--yes` policy (ADR-0114, full access by default), which answers the
   ladder's "Ask first" rules silently, so the Permissions page promised a
   prompt that could never happen. With the card in place, a direct
   conversation with an Interactive member whose built-in rules contain an
   Ask runs without `--yes` (`promptsReachPerson`), and so does its warm-up
   session, so the two share one session key. Goals, automations, channel
   threads and queued follow-ups keep `--yes`: nobody is there to answer.
   Unrestricted never asks; Restricted never writes. This revises ADR-0114's
   default for that one path: full access remains the default for everything
   that runs unattended.

10. **Staged file changes are applied.** With the card answered Allow, the
    engine reported "Added 27 lines" and no file existed. In RPC mode the CLI
    keeps preview mode on: tool writes are staged, announced as
    `autohand.changesBatchUpdate`, and at turn end `autohand.changesBatchEnd`
    waits for the client's `autohand.changesDecision`; nothing is written
    without it, and the SDK exposes it as `client.decideChanges`. Squad never
    sent one, so no Autohand member's edit had been reaching disk through the
    SDK path, whatever the reply said. `server/change-batches.mjs` records
    each batch and, when the turn ends, accepts it (the permission card or the
    allow rules were the gate) or rejects it when the turn was stopped. The
    chat gets one line, "Applied 1 file change (docs/plan.md)", and the
    reply is only reported after that decision.

11. **What the demo build taught.** Driving the created team to build the
    pie shop site on the workbench: the Agent SDK's acknowledge method is
    `acknowledgePermission`, not `permissionAcknowledged`; a card left
    unanswered for 30 s was being denied until that name was fixed. "Allow
    for this reply" sent the CLI `allow_session`, which remembers the exact
    target, so six new files raised seventeen cards; Squad now keeps that
    choice per run and tool and answers the rest of the reply itself,
    reporting each as resolved "for this reply". The CLI handed
    `squad_propose_team` members over as JSON strings on two of three calls;
    the tool accepts strings and "Role: purpose" lines. With those in place
    the Frontend Developer wrote six files in one reply, the QA Engineer
    reported severity-tagged findings, Chief of Staff relayed them with
    `squad_message` and the Frontend Developer's fix landed in `app.js`; two
    members answered a channel mention in twenty seconds. Screenshots of the
    chat and of the site at 1440px and 390px are in
    `.codex-artifacts/first-run-live/`.

    The second demo run on the packaged runtime stopped at the QA step
    with "QA report timed out" while the QA Engineer's chat showed a
    complete test report. The Frontend Developer's build reply had
    @mentioned the QA Engineer, the window started that handoff turn at
    once, and the QA prompt the walkthrough typed two seconds later was
    queued behind it (ADR-0111: the stream answers `queued`, the dispatcher
    runs the item when the member is free). The walkthrough only waited
    for a `done` event. Reproduced against the bridge alone: a turn whose
    client goes away is stopped, the next message is queued and runs
    within three seconds, so the bridge was right and the script was not.
    It now waits for the member to be idle before typing, as a person
    seeing "Working" would, and follows a queued message through the
    queue. The handoff itself is the demo working as intended: the team
    tests its own build without being asked.

12. **The rest of the report.** `squad_read_chat` reads a saved chat in
    full by the id the recall list now carries (§2.4). Channel thread
    history names the tools each reply used (§2.5). The chat menu has
    Export conversation, Markdown and JSON with tools, permission decisions
    and written files (§3.2). Settings › System has Reset Squad: the bridge
    moves its state, the members' homes and working folders aside with a
    date, keeps `~/.autohand` sign-in, exits for its supervisor to restart
    it, and the window returns to first run (§3.1); Keychain, `~/Library`
    and privacy grants stay a hand step in SETUP_GUIDE. The reset stops every
    engine process before the folders move: on the installed app a warm
    session that outlived the bridge wrote its session files under the
    original path and the restarted bridge saw an existing install, so the
    bridge now stops managed runs first and exits as soon as its answer is
    on the wire. The config preview
    shows the saved `config.json` beside the form and says when they differ
    (§1.6). `check:cli-pin` fails a release check while the pinned CLI is
    behind the latest release (side note). The pin moved to 0.9.9 once the
    live walkthrough passed against it; 0.9.9 also hides tools the
    permissions can never allow from the model's menu, so the retry loop the
    reporter saw cannot recur on it.

13. **An engine that goes silent ends the turn in minutes, not twenty.**
    Two demo runs on the installed runtime stalled in the Frontend
    Developer's build turn: thirteen and twenty-two tools in, right after a
    `run_command` completed, the engine stopped sending anything at all,
    keep-alive pings included (the CLI sends `autohand.ping` every fifteen
    seconds for the whole turn, so silence means the process is wedged or
    gone), and the chat read "Working…" for twenty minutes. The bridge's
    inactivity window had fired after three to five minutes; what followed
    was Squad's own cleanup. Each Agent SDK request waits five minutes by
    default, and the cleanup sent three in a row to an engine that would
    never answer: `interrupt`, the change-batch decision, then `interrupt`
    again from the pool before `close`, which kills the process in two
    seconds. `server/deadline.mjs` bounds those calls to three seconds; a
    turn that timed out skips them and discards its staged batches locally
    (`ChangeBatches.discard`), and the pool's `close` is bounded at ten
    seconds and reports `session_close_timeout`. `check-sdk-sessions`
    covers a session whose interrupt and close never settle. The engine's
    silence after a shell command is the CLI's to explain
    (`.codex-artifacts/first-run-live-packaged-demo/failure-bridge.json`
    holds the run); the rehearsal's build prompt now asks for file tools
    only, since the site needs no shell and the demo should not ride on
    that path. Reading that run's Work details showed a second fault: the
    twenty-two commands appeared as 169 approval rows, each "answered" by
    the next, because a request's description is logged one line per
    line and every line opened a row. A continuation line now joins the
    open request, so one request is one row, pending until the engine
    moves on. Reproducing the stall on the workbench with the same QA
    prompt found a third fault instead: the member added "Read index.html"
    to its work plan, marked it done with the outcome "Reading index.html
    now.", added the next step, and repeated that thirty-six times in four
    minutes without reading a file. `squad_task` now refuses the ninth edit
    in one reply and says to do the task itself; `check-team` covers it.
    The next reproduction, with the guard in place and a fuller profile,
    ended in eighty seconds with the engine's own message: "The provider
    truncated 3 consecutive responses. I stopped without marking the task
    complete… retry with a narrower requested output or a model with a
    larger output limit", after four identical "status doing" plan updates.
    The default engine model (Autohand AI, fantail) was repeating itself
    until it hit its output limit; a model that repeats into a huge
    tool-call argument also explains a CLI that falls silent, pings
    included, while it swallows that output. That is the model's, not
    Squad's; the demo should run its members on a model that holds up
    under a long tool-using turn, which is a choice for the person.

14. **A channel thread keeps its engine session warm (§2.5).** Each
    channel turn started a fresh engine session with the thread's earlier
    messages as text, so a reply's tool state and anything a member had
    read were gone by the next turn. The thread history now names the
    tools each reply used, and a thread's turns reuse one warm session:
    the team and vault servers are scoped per thread instead of per turn
    (`thread:<channel>/<thread>`, a stable config copy, a token that
    outlives the turn), the pool keeps a healthy thread session, and the
    member's direct-message session is never touched. The thread history
    still rides on every prompt, because teammates may have posted between
    the member's turns; the cost is repeated context, the gain is nothing
    missed. `check-thread-warmth` drives two turns in one thread (one SDK
    start, the token valid on both), a second thread and a direct message
    (sessions of their own) and a third turn back on the first thread
    (still warm). Autohand engine only; Codex and Claude Code members run
    one process per turn as before.

15. **Staged writes reach the disk as they happen.** §10 accepted the
    engine's change batch at the end of the reply. On the 0.1.16 demo run
    that was not enough: in RPC mode the engine stages every write, so a
    member that checked its own work with `ls` and `cat` mid-reply saw no
    files, concluded write_file was broken, wrote two probe files, asked
    through the new question card whether it could use the shell, and
    rewrote the site with heredocs. Then the batch applied at the end, in
    order, and the 11-line probe `index.html` replaced the real page. The
    engine has no switch for preview mode (`previewModeEnabled` is fixed on
    in `adapter.ts`), so `server/change-batches.mjs` now writes each staged
    change into the turn's folders (the workspace and its extra folders,
    symlinks resolved) the moment it is announced, in order. At the end it
    drops the engine's staged copy of what was written (`reject_all`, which
    only clears the staging area) and accepts only what could not be written
    (`accept_selected`), so a staged change can never replay over later
    shell work. A stopped reply keeps what already landed, as Codex and
    Claude Code members do. `check-change-batches` covers order, deletes,
    the folder boundary, symlink escape, later shell writes and the stopped
    case.

## Channel proposal regression, 2026-11-11

Issue55 reported successful managed `squad_propose_team` calls without a
Create team control. `node scripts/check-channel-replies.mjs`, given a valid
finished proposal, reproduced the missing control in the actual channel
renderer. This did not require a provider, feature flags or guessed reply text.
The live channel completion handler discarded proposal receipts, and the
channel renderer had no proposal control. Direct messages already had both.
Recovery also handled only unfinished replies, leaving older completed replies
with no way to recover their saved run's roster.

Channel replies and nested threads now use the same divider-list proposal and
existing team builder as direct messages. Recover the original proposal only
from a completed run with the exact saved reply request ID, channel and thread. Preserve an existing
decision and never create members during recovery. The first rendered fix
exposed a second bug in the integration check: adding recovered metadata with
an unchanged timestamp did not pass the channel store's newer-write rule.
Recovery and explicit decisions therefore advance their message's write time.

`check-team-proposals-browser.mjs` uses a controlled engine that calls the
real managed MCP endpoint. It checks saved-run recovery, live channel replies,
the threaded view, persisted dismissal across service/browser restart, and
explicit creation through the ordinary team importer. This is local browser,
MCP and persistence evidence; it does not replace live-provider or installed-app
verification. Older proposals can be recovered only while their correlated run
is retained. The existing one-proposal-per-reply display limit remains; no roster
is inferred from prose and no unrelated run is attached.

## Consequences and validation

- `check-permission-policy`, `check-permission-approvals`,
  `check-team-proposals`, `check-permissions`, `check-team` and
  `check-activity` pass. `check-first-run-live` drives the whole path with
  the real account and bundled CLI and saves evidence under
  `.codex-artifacts/first-run-live*/`. `--phone` runs it at 390px,
  `--runtime=<dir>` runs a packaged app's own runtime, and `--demo` is the
  release rehearsal the report asked for: the created team builds the pie
  shop site through the approval cards, QA tests it, Chief of Staff relays
  findings with `squad_message`, two members answer a channel mention, the
  config preview is checked against the saved file, one member on each other
  ready engine answers a message, the warm session is left idle for sixteen
  minutes before the continuation, and the run ends with Reset Squad.
- A dev-server rehearsal on 3 November stopped the Frontend Developer two
  files into the build, with "Interrupted" in the chat. The engine had not
  failed: the run log ended with `index.html` written and then
  "autohand reply stopped", with no stop reason, and the page's own turn
  record was empty because the page had been reloaded. Without `--repo` the
  demo repository lives under `.codex-artifacts/` inside this checkout, and
  the dev bridge runs Vite over the whole checkout, so a member writing an
  HTML file there set off a full page reload. The reload closed the chat
  stream, and a closed stream stops the reply on purpose. `vite.config.js`
  now leaves `.codex-artifacts/` out of the watcher. The packaged app has no
  dev server and was never affected. A member working on this checkout's
  own `src/` in dev mode still reloads the page, as any Vite edit does.
- `check-agent-channel-actions` fails one assertion (a blocked channel
  proposal reports `failed` rather than `blocked`) on HEAD before this change
  as well; left as found.
- Left undone: permission requests raised by goals and runs outside chat
  still time out; a reopened window does not fetch requests pending in
  another window (`GET /api/chat/permissions` exists for it); user-added
  connector tools are not enumerated into `availableTools`; the CLI's own
  `ask_followup_question` stays blocked, so a member that forgets
  `squad_ask` asks at the end of its reply; a thread's warm session closes
  after the pool's fifteen idle minutes like any other, and Codex and
  Claude Code members still run one process per channel turn;
  the bundled CLI is pinned by hand with `check:cli-pin` as the reminder,
  not released automatically when Autohand Code ships; Keychain,
  `~/Library` and privacy grants stay a hand step after Reset Squad.
- Blocking the CLI's in-process teams removes a capability some members used
  under "ask". Squad's team is the replacement; `delegate_task` remains.
