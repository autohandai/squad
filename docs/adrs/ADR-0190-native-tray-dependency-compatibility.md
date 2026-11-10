# ADR-0190: Keep native dependency upgrades compatible with both packages

Date: 2026-11-10

## Context and evidence

Dependency PR #58 upgrades tray-icon from 0.24 to 0.26.1. Its published crate
and muda 0.21.2 require Rust 1.90, while the daemon declared 1.89 and the Tauri
desktop package declared 1.80. Existing stable-toolchain CI passes do not
establish either advertised minimum. The desktop package depends on the
daemon by path and has a separate lockfile; updating only daemon/Cargo.lock
does not keep the desktop dependency graph reproducible.

PR #59 also upgrades tao from 0.35 to 0.37.2. Its published minimum is Rust
1.85, below the new tray/menu floor, and the event-loop and activation-policy
APIs Squad uses remain available. This upgrade also needs the desktop lock
refreshed; its locked check reproduced the same stale-graph failure.

Upstream keeps the menu-event and native-user-icon APIs Squad uses. Linux's
default remains GTK/AppIndicator. The newer menu library also fixes Objective-C
class-name collisions when incompatible menu-library versions share a process,
which matters because Tauri and the daemon resolve different tray/menu versions.

Sources: [tray-icon manifest](https://docs.rs/crate/tray-icon/0.26.1/source/Cargo.toml),
[tray-icon changes](https://raw.githubusercontent.com/tauri-apps/tray-icon/tray-icon-v0.26.1/CHANGELOG.md),
[muda changes](https://raw.githubusercontent.com/tauri-apps/muda/muda-v0.21.2/CHANGELOG.md).
The [tao changes](https://raw.githubusercontent.com/tauri-apps/tao/tao-v0.37.2/CHANGELOG.md)
record the platform fixes behind the accompanying windowing update.

## Decision

Accept the tray and windowing upgrades, declare Rust 1.90 in both native packages and update
the contributor prerequisites. Refresh the separate desktop lockfile. Keep
existing menu/avatar behavior and the default Linux backend.

Run the desktop CI checks on the declared minimum compiler, and require locked
resolution for its build and native unit checks. Other runtime and packaging
jobs continue using current stable Rust. This checks the minimum without
giving up current-toolchain coverage. Preserve ADR-0156's historical evidence
about TurboVec's own Rust 1.89 requirement; the effective application minimum
is now higher because of the tray/menu dependencies.

## Consequences

Contributors on older compilers must update. The desktop graph intentionally
contains parallel Tauri and daemon menu-library versions rather than forcing
an unsupported Tauri dependency override. The desktop also keeps Tauri's older
tao alongside the daemon's newer version instead of overriding Tauri's graph.
Future updates may need another
minimum-compiler change; locked CI should fail instead of silently rewriting
the committed desktop graph. Compilation and fixture tests do not establish
native menu clicking, avatar rendering or an installed/notarized release.
The compatible template setter remains deprecated; adopting the replacement
macOS-only API is deferred rather than changing cross-platform icon behavior
in a dependency maintenance update.

## Validation

Before refreshing the desktop lockfile, Rust 1.90's locked desktop check failed
because the committed graph needed updating. Cargo then added the new tray/menu
dependencies to that separate graph. On macOS ARM, Rust 1.90 passes the locked
daemon all-target check and all eight native tray unit tests. The sidecar-output
regression also passes with the isolated toolchain. CI's Ubuntu desktop job
checks the default GTK3 graph on that minimum compiler; optional GTK4, which
is not selected in these locks, has a newer compiler requirement.
With tao 0.37.2 and tray-icon 0.26.1 combined, the same locked daemon
all-target check also passes on Rust 1.90/macOS ARM. The desktop graph keeps
both tao versions where required by the two native packages.
