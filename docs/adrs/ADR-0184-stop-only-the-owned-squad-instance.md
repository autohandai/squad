# ADR-0184: Stop only the owned Squad instance

Date: 2026-11-06

## Context and evidence

During Quick Chat native verification, the preview was closed and its CLI was
called with the preview's explicit `AUTOHAND_SQUAD_HOME`, `AUTOHAND_HOME` and
user-config path. Its web, analytics and daemon services stopped as expected.
The final cleanup also stopped the installed app's background runtime. Both
health endpoints then refused connections. The installed runtime was restored
with its installed binaries and existing state; its data was not reset.
That restoration proves service availability, not that an interrupted agent
turn automatically resumed.

The mistaken assumption was that `squad stop` was entirely state-root scoped.
It first used owned service records and the selected bridge's shutdown API,
but then ran two global process sweeps. Those sweeps accepted Squad-looking
runtime basenames, member-profile text, global agent directories, or a matching
`server.mjs` command from any process. They received no state paths. Earlier
classifier tests checked which names matched, not whether a sibling survived.

The first source-binary regression passed, but later preview cleanup repeated
the interruption. Staging ran Cargo with `CARGO_TARGET_DIR` and then copied
sidecars from the hardcoded `daemon/target/release` directory. That older CLI
was copied into the shared debug directory by the Tauri bundle build, replacing
the executable that had passed the regression. Its new mtime did not identify
its code. The installed service was restored again with the same state. This
corrects the earlier assumption that a fresh timestamp proved the CLI was safe.

## Decision

Remove both global sweeps and their obsolete private classifiers. Keep the
existing root-owned bridge, analytics and daemon stop paths. The selected
bridge's shutdown endpoint closes its own tracked runs, SDK sessions and
active chats. Basenames, shared projects, agent IDs and prompt text cannot
establish instance ownership.

Do not replace the sweeps with another argv heuristic. State roots are passed
through process environments, and source-mode instances can even share an
app-state directory unless explicitly configured otherwise. Unattributed
orphan processes are left alone rather than risking another live instance.
A future orphan reaper needs a durable ownership registry and identity checks.

Resolve staging and memory-check source directories with `cargo metadata`,
honoring both `CARGO_TARGET_DIR` and Cargo's local target-dir configuration.
Memory checks use the same resolver for debug/release binaries; a scoped build
exposed their independent hardcoded directory as an unavailable index.
Before an
isolation test invokes `stop`, probe `squad stop --help` for the instance-scoped
command contract. Probe and execute the same private temporary copy, so a
concurrent bundle build cannot replace the candidate between those operations.
Clap exits before service dispatch for this read-only probe;
an old copied binary is refused before any fixture or service is started.

## Validation

`check-stop-isolation.mjs` starts two real isolated bridges and a member-looking
child owned by the test. It calls the freshly built CLI to stop only the second
bridge, then verifies that the first bridge retains its PID and the unrelated
member-like child remains alive. Test cleanup addresses only the test's own
child handles. The script refuses a CLI binary without the instance-scoped
stop contract, even when it has a fresh copied timestamp. CI runs it after
building the runtime binary on Linux. The local run passed: the selected
bridge exited while its sibling retained the same PID and the member-looking
child stayed alive. A separate health read confirmed the restored installed
service retained its PID through this regression check.

The staging regression first failed when an absolute `CARGO_TARGET_DIR` still
selected `daemon/target/release`. It now checks default, absolute and relative
directories against real Cargo metadata on each native CI target. A separate
read-only probe rejects the stale local CLI without running its stop path.
The release sidecar produced by corrected staging also passed the real CLI
isolation check; the installed runtime retained its PID through that check.

## Consequences

Stop/restart can no longer indiscriminately remove a sibling Squad instance.
Already-detached processes whose owner cannot be proven may remain after a
crash; this is a deliberate tradeoff. Existing ownership checks and graceful
per-bridge shutdown remain responsible for ordinary managed work. This change
does not claim to recover a provider turn interrupted before the fix.
