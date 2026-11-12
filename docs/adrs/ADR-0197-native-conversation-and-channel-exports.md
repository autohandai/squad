# ADR-0197: Save desktop text exports through a narrow native command

Date: 2026-11-11
Status: Accepted

## Context and evidence

Issue [57](https://github.com/autohandai/squad/issues/57) reports that Export
conversation and Export markdown do nothing in the desktop app. Both called
`downloadMarkdownLog`: create a blob URL, click a hidden download anchor,
remove it and immediately revoke the URL. The desktop shell registered no
download handler or file-save command. JSON also used a Markdown MIME type.
The existing channel browser check intercepted the blob instead of proving a
file was saved by the desktop shell.

Extracting that unchanged helper and invoking it with a desktop caller in
`check-text-exports.mjs` reproduced the missing native boundary: **zero native
save calls instead of one**. A browser click alone cannot attest desktop disk
success. The bundled Tauri version offers a download callback, but relying on
webview blob downloads still requires asynchronous URL lifetime management and
completion bookkeeping. An explicit command can return a precise file receipt
without exposing general filesystem access or adding a dialog/filesystem plugin.

## Decision

Use `squad_save_text_export` from desktop callers. Accept only a basename
ending in `.md` or `.json` and at most 32 MiB of UTF-8 text. Require the current
main window and configured loopback bridge origin through the existing trusted
bridge check, and refuse saves during reset. The renderer cannot supply a
destination directory. Resolve the operating system's Downloads directory in
Rust, create each file exclusively and append a number before its extension on
collision. Write and sync its exact bytes before acknowledging its actual name
and byte count. New Unix files have mode 0600; failed writes attempt to remove
only their new partial file.

Use the same helper for conversation Markdown/JSON and channel Markdown.
Validate native acknowledgement and never silently fall back after a native
failure. Preserve partial results: if JSON fails after Markdown was saved,
name both outcomes. Show one quiet, dismissible status line; an account/Squad
change clears it and prevents an old callback from displaying a receipt there.

Ordinary browsers keep download anchors with the correct MIME type and a
one-minute blob lifetime, and say the download was requested. They cannot claim
native disk success. Existing transcript construction and export formats remain
unchanged. This native command is a user-facing save operation, not an MCP tool
for writing arbitrary desktop paths.

## Validation

The extracted regression now reaches native IPC without creating a browser
anchor. Focused checks cover explicit acknowledgement, returned byte/name
validation, native errors without fallback, partial results, actual browser
Blob bytes/MIME, delayed cleanup, path rejection and the size limit. IPC is
mocked in those JavaScript checks.

The native desktop suite passes **34 tests**, including real temporary-file
saves with Unicode, existing-file preservation and numbered names, mode 0600,
invalid paths and oversized text creating nothing, and a real directory
failure that preserves its existing file. Test configuration excludes package
resources; this is native filesystem/command compilation evidence, not an
installed or notarized build.

The rendered browser check clicks the actual DM and channel menu actions,
reads the downloaded Markdown/JSON from a temporary directory and verifies the
Unicode message bodies. It also checks desktop receipt/partial-error rendering
with simulated IPC and a 390px layout. No live provider prompt or personal
profile is used. Production build and JSX checks pass.

An isolated, locally ad-hoc signed macOS fixture then exercised the production
command registration, capability file, main-window/bridge-origin guard and
writer through a real WKWebView. A Cua click saved Markdown (26 bytes), JSON
(30 bytes) and a numbered second Markdown file (17 bytes); each was read back
from Downloads and compared byte-for-byte, and `../` was refused. Evidence
copies and hashes are retained in the task's native proof artifacts; only the
exact verified test files were removed from Downloads. The fixture had its own
app identifier and temporary service state, plus a test-only automatic exit
hook. The installed Squad app, account data and personal documents were not
changed. This is native IPC/filesystem proof, not a published installer.

The first native fixture was refused by the existing port-ownership guard.
Its HTTP proxy used chunked framing and its reused service binaries were
stale; the native health reader expects the usual length-delimited JSON.
Rebuilding the fixture services and forwarding Content-Length produced a
verified bridge. No product ownership check was weakened to admit the fixture.

## Consequences and limits

Desktop exports have a defined destination, preserve existing files and report
actual save results. The tradeoff is no Save As directory chooser in this
change. Two conversation files are saved independently; a partial success
remains on disk and retrying produces a numbered copy. A successful export is
an intentional copy outside account-owned storage and is not removed on sign
out or reset. The size limit can require exporting a smaller conversation.

This does not replace artifact/backup HTTP downloads, export unloaded history,
add a generic filesystem plugin, or attest live-provider behavior. Browser
downloads still depend on browser policy and can require its usual multiple
download consent. Native filesystem tests and simulated browser IPC must be
reported separately from a real native webview save or a public release.

## Review follow-up: collision receipts and browser synchronization

The UTF-8 filename boundary must hold for the final native receipt as well as the requested name. A real Rust filesystem regression reproduced a 180-byte request returning a 184-byte collision name, which the renderer correctly rejected after the file was already saved. Collision suffixes now reserve their byte budget before truncating the stem at a UTF-8 character boundary. Tests cover ASCII, three-byte and four-byte characters, Markdown/JSON extensions, multiple collisions and unchanged original content. No path, overwrite or origin authority is widened.

The Linux CI failure was the existing memory-graph drag check: it measured a node immediately after Fit started a camera transition, then dispatched pointer-down at a moving coordinate. The check now waits for that actual animation to finish, verifies that the pointer target is the expected visible node and waits for the resulting transform. Product graph motion remains unchanged. Native unit tests prove disk writes; Chromium export checks use simulated native receipts and do not establish packaged webview IPC behavior.
