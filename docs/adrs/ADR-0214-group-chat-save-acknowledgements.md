# ADR-0214: Wait for the rendered group-save acknowledgement in browser checks

## Context and evidence

Main CI run 43218504406 failed the assertion that a saved group name appeared in
its Direct Messages row. The check polled the bridge database, then immediately
read the browser. A database commit can happen before the request returns and
React renders the new name. It was not evidence that the product lost a rename.

Holding each successful channel PATCH response for 300 ms reproduced the exact
sidebar assertion failure locally without changing the saved data. The delay
also exposed a second race: the check tried a second save while the first still
said “Saving…”. An initial correction waited for an enabled “Save group” button;
that was wrong because the pristine, successfully saved form legitimately
disables that button.

## Decision

Keep a controlled successful-response delay in the browser check. After each
save, wait for the ordinary “Save group” label to return, regardless of its
enabled state. After the rename, also wait for the named Direct Messages row.
Only then check that an intentionally edited conversion name remains unchanged.
Retain the database assertions, conversion, exact history and deletion checks.

## Verification

`bun run check:group-chats:browser` fails at the original immediate assertion
with the controlled delay, then passes with acknowledgement and rendered-row
waits. It exercises the real owned bridge and production bundle, including
renaming, private group creation, public conversion and retained history. No
production group-chat behavior was changed to make this check pass.

## Consequences

The check now measures committed and rendered behavior separately. The extra
response delay costs a fraction of a second per group save and makes this race
repeatable; it is not a simulation of every network fault. The bounded existing
waits still fail when the row never updates or a save never acknowledges.
