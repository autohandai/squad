# Media with frame-anchored comments (issue #32)

Images and videos render inline in channels; a comment can anchor to a
timestamp and/or a rectangle on one of them; members receive the anchor as
structured context (path, timestamp, box, extracted frame). ADR-0024.

## Files this module owns

| Path | Role |
| --- | --- |
| `server/routes/attachments.route.mjs` | Upload (25 MB cap), Range serving, `ffprobe` metadata, `ffmpeg` frames. |
| `src/lib/anchors.js` | Pure: normalizers, `anchorLabel`, `anchorContextText`, `messageMediaContext`, composer token helpers. |
| `src/components/channels/MediaAttachment.jsx` | Inline image/video row, scrubber, anchor mode, anchor badges. |
| `src/components/channels/AnchorChip.jsx` | Pending anchor chip above the composer. |
| `scripts/check-attachments.mjs` | Route + pure checks. Add `"check:attachments": "node scripts/check-attachments.mjs"` to `package.json` scripts and to `ci`. |

## Routes (auto-loaded plug-in, no `server.mjs` change)

| Route | Notes |
| --- | --- |
| `POST /api/attachments` | Raw binary body; headers `x-file-name`, `content-type`. 413 over 25 MB ("Attachment is larger than 25 MB…"). Returns `{ id, kind, name, mime, size, width, height, durationMs, createdAt, path, url }`. Stored at `<squadStateDir>/attachments/<id>.<ext>` + `<id>.json`. |
| `GET /api/attachments/:id` | Bytes with `accept-ranges` / 206 / 416 so `<video>` seeks. `HEAD` supported. |
| `GET /api/attachments/:id/meta` | The sidecar plus `path` and `url`. |
| `GET /api/attachments/:id/frame?t=12.4` | JPEG at `t` via `ffmpeg`, cached under `attachments/frames/<id>-<ms>.jpg`. `&as=json` → `{ id, t, path, url, cached }`. 404 `{ error: "ffmpeg not available" }` without ffmpeg; 400 on an image. |
| `DELETE /api/attachments/:id` | Removes file, sidecar and frames. |

`AUTOHAND_FFMPEG=off` disables both tools (checks only). No events emitted.

## Message model

```js
message.attachments = [{ id, kind: "image"|"video"|"file", name, mime, size, path, url, width, height, durationMs }]
message.anchors     = [{ attachmentId, t: 12.4 | null, box: [x, y, w, h] | null }]   // box in 0–1 fractions, top-left origin
```

Anchors may point at attachments from earlier messages, so lookups are by id
across the channel, not within one message.

## Composer flow (ChannelPage in `src/App.jsx`)

1. **Attach → upload.** In the `MessageComposer` `onAttach` prop, split files:
   image/video (or anything not text-like) go through the bridge, text-like
   files keep the existing `attachFilesToDraft` inlining.

   ```js
   const uploaded = await api("/api/attachments", {
     method: "POST",
     headers: { "x-file-name": encodeURIComponent(file.name), "content-type": file.type || "application/octet-stream" },
     body: file,
   });
   setPendingAttachments((current) => [...current, uploaded]);
   ```

   A 413 surfaces as the thrown `error.message` from `api`; show it as the
   composer `hint` (copy key `attachmentTooLarge` is a fallback if the bridge
   message is missing). State: `const [pendingAttachments, setPendingAttachments] = useState([])`.

2. **Anchor → chip.** Pending anchors live inside the draft as tokens
   `[[anchor:<attachmentId>:t=12.4:box=x,y,w,h]]`. `MediaAttachment`'s
   `onAnchor` calls `setDraft((d) => appendAnchorToken(d, anchor))`. Above the
   composer (next to the "Replying to" row) render
   `parseAnchorTokens(draft).map((a) => <AnchorChip anchor={a} attachment={attachmentsById[a.attachmentId]} onRemove={() => setDraft((d) => removeAnchorToken(d, a.raw))} copy={copy} />)`
   plus one plain chip per pending attachment name. The textarea still shows
   the token text; that is acceptable for v1 (it is what the chip removes).

3. **Send → message.** In `submitDraft`, `const { prompt, anchors } = anchorsFromDraft(text)`;
   pass `{ prompt, attachments: pendingAttachments, anchors }` to `onDispatch`
   / `onFollowUp`, then clear `pendingAttachments`. `sendChannelPrompt` stores
   `attachments` and `anchors` on the root user message (`appendChannelMessage`),
   and `dispatchChannelMemberReply` receives them (add both to its options).

4. **Member context.** In `dispatchChannelMemberReply`, before building
   `profile`, resolve frames (best effort, in parallel):

   ```js
   const framePaths = {};
   await Promise.all(anchors.filter((a) => a.t !== null && attachmentsById[a.attachmentId]?.kind === "video").map(async (a) => {
     try { framePaths[frameKey(a)] = (await api(frameUrl(a, { asJson: true }))).path; } catch { /* no ffmpeg: timestamp only */ }
   }));
   const media = messageMediaContext(attachments, anchors, { framePaths });
   ```

   Append `media` as the last block of `profile` (after
   `buildChannelProfileContext`). Each anchor becomes an `<anchor attachment="…">`
   block with `file`, `path`, `timestamp`, `region` (fractions and pixels) and
   `frame` (when extracted); unanchored attachments are one `<attachment … />`
   line each. Members can open `path`/`frame` from the workspace like any file.

## Rendering in `ChannelStream`

Inside the `renderBody` prop the page already passes
(`renderBody={(message) => <MarkdownBlocks text={message.body || ""} />}`),
append one `MediaAttachment` per `message.attachments` entry:

```jsx
renderBody={(message) => (
  <>
    <MarkdownBlocks text={message.body || ""} />
    {(message.attachments || []).map((attachment) => (
      <MediaAttachment
        key={attachment.id}
        attachment={attachment}
        anchors={channelAnchors}            // every message's anchors, flattened; the row keeps those with its id
        onAnchor={(anchor) => setDraft((d) => appendAnchorToken(d, anchor))}
        copy={copy}
      />
    ))}
  </>
)}
```

`channelAnchors = useMemo(() => messages.flatMap((m) => m.anchors || []), [messages])` and
`attachmentsById = useMemo(() => new Map(messages.flatMap((m) => m.attachments || []).map((a) => [a.id, a])), [messages])`.

Behaviour: image click or the "Anchor a region / Anchor a moment" text
action enters anchor mode (drag draws a normalized rectangle; on video the
slim scrubber picks the moment, native controls are hidden meanwhile);
Cancel / **Use anchor** are inline text buttons. Existing anchors are small
outlined badges ("0:12 · region") that seek the video and outline the
region on hover. Non-media attachments render as a quiet link with the size.

## Copy keys (`src/locales.js`, `en`; components carry fallbacks)

`anchorStart` ("Anchor a moment" / "Anchor a region"), `anchorUse` ("Use anchor"),
`anchorHint` ("Drag to outline a region; use the timeline to pick the moment."),
`anchorPickHint` ("Pick a moment or a region"), `anchorRegion` ("region"),
`anchorRemove` ("Remove anchor"), `attachmentTooLarge` ("That file is larger than 25 MB."),
`attachmentUploadFailed` ("Could not upload {name}."). `cancel` already exists.

## DESIGN.md addition (Squad Channels)

- Media in a channel message is inline: images at most 320px tall, videos
  with native controls and a slim one-line scrubber underneath; anchors are
  small outlined text badges ("0:12 · region"), never pins or cards. Anchor
  mode is a thin accent ring on the media plus inline Cancel / Use anchor
  text buttons; a pending anchor is one outlined chip above the composer.
