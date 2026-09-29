# ADR-0053: A workflow step can call a URL

Date: 2026-09-29
Status: Accepted

## Context

The owner: "if I respond to a message to a specific emoji i can setup a workflow
or routine to a prompt or call an api rest, or invoke another team member too."

Two of those three already existed. A step was `{ memberId, prompt, when,
workspace, approval }` — always a member, always a prompt. "Run a prompt" and
"invoke another member" are the same step with a different `memberId`. Calling a
URL had nothing.

## Decision

**A step has a kind.** `member`, which is everything that existed, or `http`.
A stored step with no `kind` is a member, which is what it was, so nothing
already saved changes meaning.

An `http` step carries `url`, `method`, up to eight `headers` and a `body`.
`{{message}}`, `{{previous}}` and `{{workflow}}` expand in all of them, not just
in prompts — `renderStepPrompt` is now one caller of `renderStepTemplate`.

**The bridge makes the call, not the app.** A URL step needs no member and no
workspace, and it should work while the app is closed, so `afterTransition`
performs it before deciding what the transition has to announce. Approval and
terminal handling then see the state the call left behind, and a chain of URL
steps runs in one pass, bounded by `MAX_STEPS`.

**What comes back is the step's result.** A 2xx completes the step and the
status line and first 400 characters become `{{previous}}` for the next step. A
non-2xx fails it, which is a real outcome a later step can branch on with
`when: previous_failed`, not an error swallowed as success.

**Only http and https.** `httpUrl` parses the URL and rejects anything else, and
`validateWorkflow` rejects it at save time, so `file:///etc/passwd` is refused
when the workflow is written rather than when it is run. The call is bounded at
20 seconds, the body at 8000 characters and the preview at 400.

## Consequences

- `check-workflows.mjs` drives a real `node:http` server: the templated URL
  arrives as `/notify?from=Ping%20the%20API`, the header arrives, a body with no
  content type is sent as JSON, the templated body arrives as
  `{"said":"ship it"}`, the run advances to the member step by itself, and no
  member run is started for the URL step. A 500 marks the step failed with a
  `500` preview, a GET sends no body, and `file://` is a 400 at save time with
  no request made.
- A URL step is outbound network access on a reaction, so it is deliberately
  something the user writes into their own channel, and the existing approval
  gate applies to it like any other step.
- The reaction picker that makes these easy to create is the other half of this
  work and lands separately.

## Addendum, same day: the picker

The other half of the ask — "I want to add more icons for reactions" — is
`src/lib/reactions.js`: 581 emoji in nine groups, each with a one-word lowercase
name so it can be searched and so a screen reader has something to say. The
hover row keeps its five, because a sixth is already a menu; everything else is
behind one `SmilePlus` button that opens a searchable grid.

Names are stored as one string per group (`"🐛 bug|🧪 test|…"`) rather than a
few hundred two-element arrays, which is a page of punctuation nobody keeps
tidy.

`check-reactions.mjs` asserts what data cannot be allowed to get wrong: no emoji
in two groups (a duplicate makes `reactionName` depend on group order), every
name one lowercase word, and every emoji on the hover row also present in the
picker. That last one failed the first time it ran — ❤️ was on the row and in no
group, so it could be clicked but never found.

Measured in a headless browser: the picker opens from the reaction row with 581
buttons across nine labelled groups, each carrying its name as the accessible
label, and typing "bug" narrows it to 🐛. No console errors.

## Addendum: the lazy way

The entry point is a footer row in the emoji picker — "Make a reaction do
something…" — so the whole path is hover a message, open the picker, one click.
Channel settings is still there and still does more; it is no longer the only
way in.

The dialog offers the three things that were asked for: run a prompt, ask a
named member, call a URL. The first two are the same step with a different
member, so only the URL choice changes the fields. It saves through
`reactionFlowDraft` into the same `onSaveWorkflow` the settings sheet uses, and
shows `validateWorkflow`'s problems in the dialog rather than saving something
broken.

Measured in a browser, from a seeded message: the picker's last control reads
"Make a reaction do something…", clicking it opens the dialog pre-filled with 🚀
and "Run a prompt", saving with an empty prompt keeps the dialog open and says
"Say what you want done.", and saving with a prompt closes it and leaves the
bridge holding one workflow — name "ship runs a prompt", trigger `reaction:🚀`,
one member step. No console errors.
