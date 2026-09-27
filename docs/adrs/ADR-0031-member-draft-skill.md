# ADR-0031: Designing a squad member is a skill, not form logic

Date: 2026-09-27
Status: Accepted

## Context

Adding a member meant picking from a fixed grid of role templates, or opening
the custom-role dialog and filling in a title, a description, five brain-card
fields, a skills list and an instructions document by hand. There was no way
to say what you needed and have the rest follow.

The request was explicit about the shape: not more logic cooked into the
create page, but a skill the app invokes, which returns a member with
everything already in it.

## Decision

**The rules live in one pure module.** `src/lib/member-draft.js` owns what a
member draft is: which fields exist, how long each may be, how skills are
deduped, and how a model's answer is merged onto a base. Nothing downstream
has to guard, because nothing gets out of the module unnormalised.

**There is always an answer without a model.** `draftFromDescription` matches
the description against an ordered list of role hints and produces a complete
draft on its own. This is not a placeholder: it is what ships when the bridge
cannot reach a model, and it is the base the model's answer is laid over. A
model that returns nothing usable, half a field, or prose instead of JSON
leaves a member the person can still edit and save.

**The route only adds the model.** `POST /api/members/draft` asks through the
bridge's own chat route, so it uses whatever harness and account the app
already has rather than opening a second path to a model. It calls back on
the request's own Host header; guessing a port would break any bridge not on
the default one. It gives up after 20 seconds, because a model slower than
that is slower than filling the form in by hand and nobody waits for a
spinner that long.

**The answer is reported honestly.** The response says whether it came from
the model or the fallback, and the form says so too: "Filled in" against
"Filled in from the description. No model was reachable, so this is a
starting point." A person should know whether a machine designed their member
or a lookup table did.

**A designed member goes through the existing custom-role path.** It
registers as a custom template, selects it, and syncs the draft, exactly as a
hand-written custom role does. Setting the fields directly left the form half
populated, because the template is what the rest of the page reads from.

## Consequences

- Describing a role in a sentence now produces a named member with a role
  title, a description, instructions, skills and a full brain card, and every
  field stays editable. Nothing is created until the person presses the button
  they already pressed.
- The fallback's role hints are a short ordered list, not a classifier. It
  will call a Kubernetes cost reviewer a DevOps Engineer and stop there. That
  is the honest limit of a lookup, and the reason the model path exists.
- The route is a plug-in under `server/routes/`, so it needed no change to
  `server.mjs` and can be removed by deleting one file.
- `scripts/check-member-draft.mjs` covers the fallback, normalising, merging,
  and hostile input from a model, including that an empty string from a model
  is not an answer.
- Not done: the designed member gets no avatar of its own, so it takes the
  generic one. Generating an avatar from the role is a separate decision about
  image generation.
