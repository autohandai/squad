# ADR-0101: Voice dictation into the composer and replies read aloud

Date: 2026-10-13

## Context

The parity lanes spec (`docs/superpowers/specs/2026-10-13-parity-lanes-design.md`,
L1) asks for a mic in the member, channel and quick-chat composers, replies
read aloud with built-in voices or a cloud voice, and a per-member switch.
xiryn's `dictation.ts` and OpenMausBot's `server/tts/speech-text.ts` were
read for behaviour: both rewrite markdown before a voice sees it, and both
keep the cloud key on the server.

Three facts shaped the shape of this change.

**WKWebView and the Web Speech API.** The spec assumed the desktop shell
would need a Tauri command over the macOS Speech framework because WKWebView
does not expose the Web Speech API. The real situation is worse for feature
detection: WebKit bug 239816 ("Web Speech API doesn't work in WKWebView, but
webkitSpeechRecognition is still exposed", resolved WORKSFORME on 2022-08-02)
records that the constructor is present on `window` inside a WKWebView while
recognition never starts. A WebKit engineer explained that WebKit uses the
Speech framework, so the embedding app needs `NSSpeechRecognitionUsageDescription`
in its Info.plist; the reporter confirmed the API then returned
`service-not-allowed`. This repository's Tauri bundle declares no
`NSSpeechRecognitionUsageDescription` and no `NSMicrophoneUsageDescription`
(`grep -rn UsageDescription src-tauri` finds nothing; `src-tauri/tauri.conf.json`
has no `infoPlist` block). So inside the shell the mic can neither rely on
`typeof webkitSpeechRecognition` nor on the error path, and `processLocally`
is not available there either. A Speech-framework command would need the
`objc2-speech` crate plus a cargo and tauri build to take effect; the lane
ran with about 1.5 GiB of free disk and a rule of no cargo or tauri builds.

**The spoken register is most of the feature.** A reply read verbatim spells
out `src/lib/foo.js`, reads a diff as minutes of punctuation and reads a table
as a wall of pipes. The rewrite is the part most likely to need tuning against
real replies, so it had to be a pure module checked in node.

**The cloud key must not reach the browser.** The app already keeps the relay
token on the bridge in a 0600 file and reports a four-character hint
(`server/routes/relay.route.mjs`). The same rule applies to an ElevenLabs key.

## Decision

- **Dictation is a pure state machine** (`src/lib/voice-input.js`,
  `createDictation`) that takes the recogniser class and reports
  `idle → starting → listening → idle`, the recognised text as final plus
  interim, and one-sentence problems. It asks for on-device recognition
  through `SpeechRecognition.available({ processLocally: true })` when the
  browser offers it and starts the download when the pack is only
  downloadable. Text is rebuilt from the whole result list on every event, so
  a repeated final result is never appended twice. The draft is
  `composeDictation(typedBefore, final, interim)`: what was typed stays, what
  is heard follows, and nothing sends.
- **`dictationSupport()` has three answers**, not two: `browser`, `desktop`
  and `none`. The desktop case is decided from the shell's user agent
  (`AutohandSquadDesktop/…` or `AutohandSquadQuickChat/…` on macOS), the same
  test native notifications use, because feature detection lies there. In the
  shell the mic button explains the Mac's own dictation (press the Dictation
  key, or Fn twice), which types into the focused field. A browser with no
  recogniser renders no mic at all rather than a dead button.
- **The mic lives in all four composers**: the member chat action row, the
  quick-chat `InputGroupAddon`, `MessageComposer` (the mounted channel
  composer) and `ChannelComposer`. Listening is a filled accent stop square,
  a pulsing dot and "Listening…" beside it; problems are one sentence in the
  same place.
- **Spoken register** (`src/lib/spoken-text.js`): fences become "(a
  JavaScript code block)", paths become their last segment, URLs become their
  last meaningful segment ("pull 12", "example.com"), link syntax drops to its
  label, tables become one "header: value, header: value." line per row,
  list items and headings become sentences, emphasis, images, quotes and
  emoji go. `spokenUtterances` splits on sentences and glues tiny fragments,
  because built-in voices cut long utterances short in some browsers.
- **One reader per page** (`src/lib/read-aloud.js`, `createReader`): starting
  a reply stops the one playing; it prefers a local voice for the page
  language; it asks the bridge for an ElevenLabs clip when the bridge says it
  is ready and falls back to the built-in voice with the reason in one
  sentence when that fails. `ReadAloudButton` sits at the end of a reply's
  meta line in member and quick chat and in the channel hover bar. The
  per-member switch is `agent.readAloud`; a reply is read automatically only
  when this page saw it arrive (loading → finished), so reopening a
  conversation never reads old replies.
- **ElevenLabs on the bridge** (`server/routes/voice.route.mjs`,
  `server/voice/elevenlabs.mjs`): the key is verified against `/voices`
  before it is stored in `<squadStateDir>/voice.json` (0600); responses carry
  `configured`, `ready` and a `…1234` hint only; `POST /api/voice/speak`
  returns `audio/mpeg` and refuses with 409 until a key and a voice exist.
  Settings → Voice holds the key row, the voice choice and "Hear a sample".

## Evidence

- `bun run check:voice` (`scripts/check-voice.mjs`): 28 checks, exit 0. They
  cover the rewrite (fences, paths, URLs, tables, lists, emphasis, empty
  input, utterance splitting), the state machine with a fake recogniser
  (support detection, transitions, final/interim text, on-device request,
  downloadable pack, error sentences, a recogniser that throws, draft
  composition), the reader with a fake synthesiser and audio element (voice
  choice, queueing, cancel on switch, interrupted is not an error, bridge
  clip, fallback with reason, settings cache) and the route with an injected
  fetch in a temp state dir (unconfigured, rejected key not stored, 0600 mode,
  masked hint, 409 without a voice, audio bytes with the stored key and voice,
  text bounds, key swap drops a stale voice, clear and delete).
- Two of those checks failed first and changed the code: the recogniser fake
  showed xiryn's `final += transcript` loop duplicating a final result when
  `resultIndex` is 0, so the text is now rebuilt from index 0; and a reply
  that is only a code block came back as ". (a code block)", so leading
  punctuation is stripped.
- `bun run check:jsx`: "JSX import check passed for 130 files", exit 0.
- `bun run build`: "✓ built in 3.09s", exit 0. The bundle
  (`dist/assets/index-C0Ii1w4P.js`, 1,966.12 kB) was built and then the
  committed `dist/` was restored so the lane does not carry a bundle rebuild.

## Consequences

- **Desktop recognition is left undone.** In the macOS shell the mic does
  not listen; it points at the Mac's dictation. Making it listen needs
  `NSSpeechRecognitionUsageDescription` and `NSMicrophoneUsageDescription`
  in the bundle's Info.plist (which would make WKWebView's own
  `webkitSpeechRecognition` work with Apple's recogniser) or a Tauri command
  over the Speech framework; either needs a tauri build, so it belongs to a
  release lane with disk to spare.
- **ElevenLabs was not exercised against the live service.** The route, the
  key handling and the clip playback are proven with an injected fetch and a
  fake audio element only. The endpoint shape (`/v1/voices`,
  `/v1/text-to-speech/{voice}?output_format=mp3_44100_64`, `xi-api-key`,
  `eleven_flash_v2_5`) follows ElevenLabs' public API as OpenMausBot uses it,
  but no key was available in this lane, so the first live call is the first
  test. A failure there falls back to the built-in voice with the reason.
- **Auto read-aloud covers member and quick chat only.** Channel replies have
  the speaker in the hover bar but are not read as they land, because the
  hover bar mounts only after a reply finishes and so cannot see the arrival.
- **Browser dictation sends audio off the machine when on-device
  recognition is unavailable** (Chrome's and Edge's speech services). The
  on-device preference is asked for every time; the UI does not yet say which
  path a session used, though `dictation.local` records it.
- **Dictation language is the page language** (`navigator.language`); there
  is no per-member or per-composer language choice.
- Firefox and other browsers without `SpeechRecognition` get no mic. The
  speaker needs `speechSynthesis` or a configured bridge voice; without both it
  renders nothing.
- No calls, no voice personas, no spend meter for ElevenLabs characters.
