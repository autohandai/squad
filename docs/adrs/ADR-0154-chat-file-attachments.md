# ADR-0154: Carry uploaded files through the conversation and engine boundary

Date: 2026-10-29
Status: Accepted

## Context and evidence

The attachment store from ADR-0024 accepted binary uploads, but its composer
integration was limited to channels. A direct-message composer had no file
picker, drop handler or paste handler. `node scripts/check-chat-attachments-browser.mjs`
reproduced a PNG drop in the actual chat component: zero upload requests and
no pending preview. A second reproduction, `node scripts/check-chat-attachment-delivery.mjs`,
uploaded a PNG and sent its reference through the real bridge. The recording
SDK received text alone; the assertion expecting one image received `undefined`.

There were additional breaks after the composer. Direct messages did not
persist attachment references or put them in the request. Queues stored a
few file identifiers but the dispatcher did not forward them. Reply threads,
retry paths and compacted archives also needed the same references. The old
channel integration put file paths into a profile string; that was not a
native multimodal input and could be truncated with the profile.

The wider tests found two additional boundaries. Channel sends reached the
engine but the user message disappeared from the bridge snapshot. Initially
this looked like delayed synchronization; waiting did not repair it. The
common append helper omitted `channelId`, and flattening the channel buckets
before synchronization discarded that identity. Stamp it when appending.
An actual two-bridge request then returned `no remote route for POST
/api/attachments`: binary forwarding also needed an explicit authenticated
upload route. The grant is limited to POST uploads and PNG previews; it does
not expose listing, download or deletion to a served token.

Tauri's default drop handler was enabled in both native windows, although
there was no consumer for its events. The pinned Tauri/Wry source confirms
that this consumes the ordinary file drop; [Tauri's builder documentation](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html#method.disable_drag_drop_handler)
explicitly requires disabling it for HTML5 drops on Windows. A browser-only
fix would leave a distinct native boundary unverified.

## Decision

Use the existing local attachment store as the source of truth. Upload the
original bytes for every file type, infer useful MIME types from known
extensions when the desktop supplies none, and keep bounded references in
messages, queues, threads, goals and archives. Do not inline text files into
the draft or put base64/File/blob objects into history. Resolve identifiers
against the bridge's own sidecars and regular files before execution; caller
paths, MIME values and internal-looking fields cannot choose bytes to read.

One shared composer flow owns drop, picker, image paste, upload state and
preview rendering. Uploading or failed files block Send, preserve the text,
and offer Remove/Retry. A files-only message gets a short ordinary request.
Image thumbnails use the stored image; documents, spreadsheets and fonts use
a file-type preview with their real name and size. Main and Quick Chat use
the browser's File drop path by disabling Tauri's unused native drop handler.

Adapt at each engine boundary rather than inventing a universal provider
file schema:

- Autohand's pinned SDK receives `images` with original raster bytes and
  `context.files` for documents, spreadsheets, fonts and other files. These
  are turn inputs, not launch options, so changing files does not invalidate
  the warmed process.
- Codex receives native `--image` paths on new and resumed turns. Other
  files retain their actual local paths in the current turn's context.
- Claude's SDK receives an asynchronous structured user message with image
  blocks and PDF document blocks. Its older CLI compatibility path receives
  the same message over `--input-format stream-json` stdin; binary content
  never goes in command arguments. See [Claude's structured-input contract](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode).
- ACP negotiates image and embedded-resource support. It receives image
  blocks and embedded resources where supported, otherwise its required
  resource links. Explicitly attached paths can be read through the client
  file method even outside the workspace; this grants no access to sibling
  files and no extra write permission. See [ACP content](https://agentclientprotocol.com/protocol/v1/content)
  and [capability negotiation](https://agentclientprotocol.com/protocol/v1/initialization).

SVG originals remain intact. The browser prepares a bounded PNG derivative
for raster-only native inputs, saved beside the original through the preview
route. Serving files uses no-sniff and a sandboxed content policy. SDK/CLI
echoes of binary message blocks are redacted from trace output.

Queues forward the stored references on dispatch and show them when a queued
question becomes history. Retries reuse the original question's files.
Independent reply threads and channel follow-ups retain recent files from
their own thread, never another conversation. Channel setup preserves its
uploaded inputs for the designer and each specialist's first work. A remote
member gets copies of the selected files and their preview on its own
authenticated bridge, with destination identifiers; local paths alone cannot
work across machines.

## Consequences and validation

- Limits remain 25 MB per file, with up to 20 files per message. Independent
  reply threads and channel follow-ups carry the most recent 20 distinct file
  references. File removal from a draft does not delete a potentially shared stored file. Automatic
  garbage collection and cloud attachment sync are left undone; files stay
  local except when explicitly sent to a configured remote member.
- File-type previews are not Office/PDF first-page rendering or font
  installation. The original files remain downloadable and available to the
  engine. Office/font interpretation depends on that engine's file tools;
  image interpretation also depends on the selected model. Capability
  negotiation is preserved rather than claiming every model accepts every
  binary format directly.
- Raster previews are at most 1600 pixels on their longest side. The original
  vector remains available for precision work. An invalid image is an
  actionable upload error, not a silently omitted attachment.
- `check-chat-attachment-delivery.mjs` verifies ten formats (PNG, JPEG, SVG,
  PDF, DOC, DOCX, XLS, XLSX, TTF, CSV), exact stored bytes and MIME inference,
  Autohand native image/file inputs, Codex image arguments, rejected forged
  and missing references, queues across restart, reply-thread inputs and
  actual authenticated two-bridge delivery to destination-owned files.
- `check-attachment-inputs.mjs` exercises Claude's structured SDK input and
  legacy CLI stdin, the real ACP stdio handshake/content blocks, narrow
  attachment read access, archive compaction and authenticated binary
  forwarding. It also verifies binary echoes do not enter traces.
- `check-chat-attachments-browser.mjs` uses the actual rendered components
  and real upload/bridge routes with a fixture engine. It covers image
  decoding, file previews, sending without text, native request inputs,
  reload/reopen, failed uploads and retry, the size limit, ordinary text
  paste, corrupt-image errors, image paste into a portaled reply sheet,
  queued file delivery, Quick Chat and channel follow-up inputs and history.
  These fixture checks prove transport and UI behavior, not model reasoning.
- `check-channel-goals.mjs --browser` verifies the rendered team setup and
  saved reply thread. The designer and four specialists each receive the
  original native image, including after setup resumes across a restart.
- `cargo check --manifest-path src-tauri/Cargo.toml --locked` passes for the
  native drop configuration. A separately identified, ad-hoc signed macOS
  verification build was opened with isolated state and a recording SDK.
  Its actual file picker uploaded a generated PNG, displayed its thumbnail,
  sent one native image and retained the preview with the completed answer.
  This verifies WebKit upload/rendering, not a Finder drag gesture or native
  Windows/Linux behavior. It is not an installed or published release.
  An earlier inspection opened the stripped verification bundle before its
  isolated runtime environment was supplied, producing the reported missing
  daemon/analytics/web-files dialog. That was a verification-launch error;
  the preview bundle's runtime files were present. Launch the fixture with
  its private runtime paths before selecting it through GUI automation.
- An isolated live Autohand AI / Moa request read `SQ7-4K29` from a generated
  PNG in 19,515 ms with all tools blocked and zero tool calls. The prompt
  did not contain the code. The receipt is retained under
  `.codex-artifacts/chat-attachments-20261029/live-vision-receipt.json`.
  Other engines use recording fixtures; their live model interpretation
  was not tested. The TTF fixture checks transport, not font validity.
- The affected harness, SDK recovery/session, queue admission/dispatch,
  thread, archive, remote and channel checks pass, as do warm-session reuse,
  quiet rendered progress, the production build and release packaging
  checks. `check:attachments` runs the new transport and browser checks in
  CI and release validation. The complete aggregate CI suite was not run.
