# ADR-0192: Keep standalone tray dependencies out of the desktop shell

## Context

The November 10 canary release failed in both macOS desktop jobs. The ARM64 job reported `Linking globals named '__CLASS_TaoTrayTarget': symbol multiply defined!` followed by a release LTO bitcode error. The Tauri shell linked its own `tray-icon` 0.24 dependency and the runtime library's standalone `tray-icon` 0.26 dependency into one executable. Those versions declare the same native class. Upgrading Rust or retrying the build cannot make both definitions coexist.

## Decision

Gate the runtime library's standalone tray module and its `tao`/`tray-icon` dependencies behind a default `native-tray` feature. Require that feature for the standalone tray binary. The Tauri shell consumes the runtime library with default features disabled and continues to use Tauri's own tray API.

## Consequences and verification

Normal runtime builds retain the standalone tray and its existing dependency versions. The desktop shell only links its own tray implementation. A consumer building the standalone tray with default features disabled must explicitly enable `native-tray`; Cargo reports the missing required feature instead of compiling a broken binary. Validate both the normal runtime tests/build and the desktop release build. The installed MCP handshake check must pass against the resulting installer before release publication. This does not change the menu-bar design or replace any dependency with an older version.
