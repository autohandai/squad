# ADR-0260: Autohand Voice: on-device dictation with Parakeet

Status: Accepted
Date: 2026-11-19

## Context

In the desktop app the composer's mic only showed "Use the Mac's dictation
here: press the Dictation key, or Fn twice" (ADR-0101): WKWebView exposes
SpeechRecognition but never starts it without a speech usage description, and
the app had no microphone entitlement. The owner, 19 November 2026: "fix the
voice transcription, autohand voice should be built-in here using parakeet
built-in for transcriptions."

## Decision

- **A native helper, `squad-voice`** (`native/voice-helper`, Swift, FluidAudio
  0.18.3, Apache-2.0): records with AVAudioEngine and transcribes with NVIDIA
  Parakeet TDT 0.6B v3 (multilingual) on the Neural Engine. Nothing leaves
  the computer. It speaks JSON lines: `status`, `prepare` (one-time model
  download with progress), `listen` (until "stop"/"cancel" on stdin),
  `transcribe <file>`.
- **The bridge runs it** (`server/voice/dictation.mjs`, `/api/dictation/*`):
  one recording at a time; microphone denied is a 403 with the System
  Settings path; no helper (Windows, Linux, a build without it) means
  `available: false` and the mic keeps its old behaviour. Recording in the
  helper rather than in the web view means the same mic works in the main
  window, Quick Chat, and a browser on this Mac. Text-to-speech
  (`/api/voice/*`, ElevenLabs, ADR-0101) is unchanged.
- **The mic button** (`VoiceInputButton`) uses Autohand Voice whenever the
  bridge offers it: tap to listen, tap to stop, the words are appended to the
  draft for review (nothing is sent). The first use downloads the model once
  with a progress line.
- **Packaging.** `scripts/stage-voice-helper.mjs` builds the helper, copies it
  to `runtime/vendor/squad-voice/squad-voice` and signs it under the hardened
  runtime with `com.apple.security.device.audio-input` (and JIT for Core ML).
  The app gains the same entitlement and `NSMicrophoneUsageDescription`
  ("Squad records your voice only while you dictate, and turns it into text
  on this Mac.") in `src-tauri/Info.plist`, so macOS asks once.

## Evidence

- `squad-voice transcribe` on speech made with `say` ("Remind me every
  weekday at nine a m to post yesterday's signups in the growth channel."):
  "Remind me every weekday at 9am to post yesterday sign-ups in the growth
  channel." First run 18.6 s (Core ML compiling the model once), the next
  0.26 s, on this Mac (Apple silicon).
- `scripts/check-dictation.mjs` (in `check:server`): status, start/stop with
  text, one recording at a time, cancel, microphone denied as 403, unavailable
  off macOS and without the helper, the model download path. `check-voice`
  (text-to-speech) still passes.

## Consequences

- The model (~0.6B parameters) is downloaded on first use into
  `~/Library/Application Support/FluidAudio/Models` (a one-time download of
  several hundred MB), not shipped in the app.
- Transcription happens after you stop; there are no words while you speak
  (the browser path showed interim text). FluidAudio has a streaming manager
  that could add that later.
- The release build now runs `swift build` for the helper on macOS, which
  fetches FluidAudio and its prebuilt text-normalisation framework.
- Not yet run end to end in the signed app with the microphone prompt; this
  ADR is amended with that run.

## Amendment, 19 November 2026: the helper is Autohand Voice

The owner pointed at the Autohand Voice project (autohandai/voice) as the
dictation engine. The helper now uses its `AutohandVoiceCore` library and
`LocalSpeechRecognizer` (same Parakeet v3 model and cache) rather than
FluidAudio directly; see ADR-0261 for the evidence. The mic now sits beside
the send button.

## Evidence in the signed app (19 Nov 2026)

The helper inside the installed, Developer ID–signed app
(`/Applications/Autohand Squad.app/Contents/Resources/runtime/vendor/squad-voice/squad-voice`,
TeamIdentifier J59GX2DRN2) transcribed a 3.5 s clip spoken by `say -v
Samantha` ("Please summarise the open pull requests and remind me at nine")
as "Please summarize the open pool requests and remind me at 9.".

- The first run took 23.6 s. A second process took 0.52 s, so the compiled
  model is kept by macOS between processes. Only a Mac's first dictation
  pays the cost.
- "pool" for "pull" is the synthetic voice and an ambiguous word, not a
  pipeline fault.
- This exercises `transcribe` on a file. The microphone prompt and `listen`
  still need a person at the Mac.
