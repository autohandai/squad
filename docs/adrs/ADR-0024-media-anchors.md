# ADR-0024: Media attachments with frame-anchored comments

Date: 2026-09-26 · Status: accepted

## Context

Attachments in channels were text: small files were inlined as fenced
blocks, anything else was referenced by name. There was no way to show a
screenshot or a screen recording inline, and no way to say "this button, at
0:12". Members therefore received "the video" and had to guess the moment.
Buzz-style review anchors a comment to a frame and a region; the member
prompt should carry the same precision without turning the bridge into a
media server or the composer into an annotation tool.

## Decision

- **Storage** (`server/routes/attachments.route.mjs`, a route plug-in): the
  client sends the raw bytes as the request body with `x-file-name` and
  `content-type`; no multipart parser and no new dependency. Files are capped
  at 25 MB (413 with a plain sentence, the rest of the upload drained so the
  message is delivered) and stored under `<squadStateDir>/attachments/<id>.<ext>`
  next to a sidecar `<id>.json` (`id, kind, name, mime, size, width, height,
  durationMs, createdAt`). `ffprobe` fills dimensions and duration when it is
  on PATH; otherwise those fields are `null` and everything else still works.
  `GET` serves bytes with `Range` support so `<video>` can seek; `DELETE`
  removes the file, the sidecar and any cached frames.
- **Frames**: `GET /api/attachments/:id/frame?t=` extracts one JPEG through
  `ffmpeg` and caches it under `attachments/frames/<id>-<ms>.jpg`. Without
  ffmpeg it answers 404 `{ error: "ffmpeg not available" }` and the anchor
  falls back to the timestamp alone. Transcoding is out of scope; the
  browser plays what it can play.
- **Model**: a message carries `attachments` (the upload records, with the
  absolute `path`) and `anchors: [{ attachmentId, t, box }]`, `box` in 0–1
  fractions of width and height with a top-left origin so it survives any
  display size. Anchors may reference attachments from earlier messages.
- **Composer token**: a pending anchor is text in the draft,
  `[[anchor:<id>:t=12.4:box=x,y,w,h]]`, rendered as a chip and stripped on
  send (`src/lib/anchors.js`). Keeping it in the draft means no parallel
  composer state, queueing and reply-to keep working, and a chip's remove is a
  string operation.
- **Member context**: `messageMediaContext` turns anchors into
  `<anchor attachment="…">` blocks with the file, its path, the timestamp,
  the region (fractions and pixels when the size is known) and the extracted
  frame path; unanchored attachments are one `<attachment … />` line each. It
  is appended to the reply's `profile`, matching how channel context already
  reaches members, so every harness sees it.
- **UI** (`MediaAttachment`, `AnchorChip`): inline media on the page surface,
  a slim scrubber under videos, anchor mode as a thin accent ring with
  drag-to-outline and click-to-pick, inline Cancel / Use anchor text buttons,
  and small outlined badges for existing anchors that seek and outline on
  hover. No cards, no pins, no drawing tools beyond one rectangle.

## Consequences

- Media lives in app state, not in the workspace; members reach it by the
  absolute path in the prompt and, for a timestamp, by the extracted frame.
  Cleanup is `DELETE`; nothing garbage-collects yet.
- ffmpeg is optional. With it, "the button at 0:12" arrives with a JPEG the
  member can open; without it, the timestamp and box still arrive as text.
- Normalized boxes make anchors independent of layout but require the member
  to map them onto pixels; `region_px` is included when dimensions are known.
- The route is independent of `server.mjs`; the composer and stream wiring is
  the integrator's (docs/integration/media.md).
