# ADR-0198: Bind outside-session recording to its enabling actor and dataset

Status: Implemented; part of account-owned Squad data.

## Context and evidence

Full CI reached the outside-session hook integration check after the initial
SDK checks. The old fixture was unowned, but migrating that fixture exposed a
functional problem too: hook installation used `req.socket.localPort`, which
is now the private worker's port. The old forwarder carried neither its
broker's capability nor an ownership context, so installed hooks could not
reach the new bridge. Pointing them at whichever account happens to be signed
in would also import someone else's terminal conversation into that account.

## Decision

An explicit installation records the public loopback broker port and the
immutable `actorKey.ownerKey.datasetId` storage key in the hook command. It
contains no identity token, native grant or worker capability. Before posting
an event, the forwarder checks that the current ready/writable broker has that
exact storage key, captures its generation, and sends that generation with the
event. A context transition between lookup and ingest is rejected normally.

This binding survives a service restart for the same actor, owner and dataset,
without inheriting whichever account is later selected. A restore/reset or a
different actor requires explicit hook setup for its new destination. Legacy
commands without a binding stay inert. Settings reports a mismatched binding
and offers explicit installation; it does not rewrite machine configuration
automatically on sign-in. Other hook entries and backups keep their prior
contract.

## Consequences and verification

Switching owners can intentionally stop outside recording. Returning to the
original bound actor/dataset can use its previously enabled hooks. Only one
Squad installation can own a given engine's installed hook entries at a time;
simultaneous multi-owner capture is not implemented. Forwarding remains silent,
bounded and best-effort; a stopped/unavailable Squad does not block the engine.

`node scripts/check-hooks.mjs` uses isolated engine configs, a real broker and
the exact installed command. It exercises both engine protocols, transcript
replies, owned-scope command construction, wrong-owner and legacy command
refusal, stale-binding status and explicit reinstall, and exact uninstall of
only Squad's entries. No real engine config or installed app is changed.
