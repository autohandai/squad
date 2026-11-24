# ADR-0276: Read aloud with kale-tts-1, a voice per member, and a start screen that belongs

Status: accepted, 2026-11-24

## Context

The owner, 23 Nov 2026: "the readout loud function in desktop and mobile
sucks", pointing at kale-tts-1
(huggingface.co/spaces/KaleComputer/kale-tts-1). Every member should have its
own voice in the profile. Voices should be set automatically from the name
("a female name then we set a female voice"), from personality, and through
MCP when a member is created. Remove the ElevenLabs integration "because I
want to make sure the [voice] is unique per agent". And the start-up page
"feels really out of place. It's not part of the preloading one."

What existed:
- **Desktop read aloud (ADR-0101).** The browser's `speechSynthesis` (one
  system voice for everyone). With an ElevenLabs key saved in Settings → Voice,
  the bridge proxied ElevenLabs instead, with one voice for every member.
- **iPhone.** No read aloud at all.
- **The model.** kale-tts-1 (Kale, Apache-2.0; dataset CC BY 4.0) is ONNX with
  a JavaScript API (`js/kale-tts.mjs`) on onnxruntime-web 1.31.1, and 10
  synthetic voices: Kenzie, Simone, Amy, Frankie, Darlene, Owen, Toby, Jack,
  Earl and Magnus. Two models: nano (7.5M parameters, 14.8 MB int8) and tiny
  (45.7M, 79.9 MB int8; 183 MB float32 for WebGPU). The sizes come from the
  Space's file tree.
- **The native start screen (`src-tauri/loading/index.html`).** A pure-black
  page with a three-row checklist. The React boot screen that follows is
  #0a0a0a, with the mark, the name and three birds on a perch (ADR-0245), so
  the handover jumped.

## Decision

- **kale-tts-1 reads every reply, on the device.**
  - `scripts/fetch-kale-tts.mjs` vendors 77 files into `vendor/kale-tts` from
    the Space pinned at commit `15b2622e…`. Every file must match its sha256
    in `kale-tts.lock.json`, so a changed upstream file fails the build.
  - The bridge serves them at `/voice-engine/`, before `/api`, with no
    ownership header (a Worker cannot send one) and never the index.html
    fallback.
  - A module worker (`server/voice/kale-worker.mjs`) loads **tiny** on the
    CPU with one thread and streams sentence PCM. `src/lib/kale-voice.js`
    plays each sentence on an AudioContext as it arrives, with a short pause
    between sentences.
  - The browser's built-in voice remains only as the fallback when the
    engine cannot start, and the reader says so.
- **Each member has a voice.**
  - `agent.voice` is a kale voice id. It is in `MEMBER_PROFILE_FIELDS` and in
    the bridge's member fields, so it syncs app ↔ bridge by profile revision
    and reaches MCP and the phone.
  - `src/lib/member-voice.js` gives a default. The gender comes from a gender
    stated in the personality ("she", "a man"), else from the first name: US
    Social Security names 1880–2008, where at least 85% of uses are one sex
    (public domain), plus a curated list of common international names, then
    name endings. Among voices of that gender it scores role, description and
    personality against each voice's traits, and avoids voices other members
    hold while any are free.
  - Defaults are assigned in join order, so a new member never changes an
    earlier member's voice. The app saves each default once.
  - The bridge's `create_member` gives a new member its voice at creation.
    MCP `create_member` and `update_member_profile` take `voice` (a name or
    id); an unknown one is refused with the list of ten.
- **Where you choose it.**
  - The profile's Voice section and Edit profile both show a picker: two
    plain columns, Women and Men, each voice with a sample read in it.
  - Settings → Voice lists the squad with each member's voice, a sample and
    Change. There is no key and no account.
- **ElevenLabs is removed.** The routes, `server/voice/elevenlabs.mjs` and the
  key field are gone. A saved key file is deleted on start.
- **The phone** gets `members[].voice` in the snapshot (contract 0.8) and runs
  the same engine itself (Squad for iPhone ADR-0015).
- **The start screen is the boot screen drawn first.** It has the same
  background, the mark with a slow SVG liquid ripple (also added to the React
  boot mark), the name, the same three birds (evening grosbeak, kiwi, silver
  gull) landing and hopping on their perch, and one muted line that counts
  seconds only after 1.2 s. Painted birds on the React perch are now cut to
  circles; they were white squares since ADR-0271.

## Evidence

- **Speed, measured in Chrome on this Mac under a load average above 400.**
  `vendor/kale-tts` served locally, a 9.8 s paragraph:

  | Model | Threads | First sound | Speed |
  |---|---|---|---|
  | nano | 1 | 85 ms | 32× real time |
  | nano | 4 | 39 ms | 69× real time |
  | tiny | 1 | 180 ms | 15× real time |
  | tiny | 4 | 65 ms | 42× real time |

  Tiny on one thread is far above real time, so the WebGPU runtime (43 MB)
  and the float32 graphs are left out, and no cross-origin isolation is
  needed.
- **`scripts/check-read-aloud-browser.mjs`**, against a real isolated bridge
  and real Chrome:
  - the worker served by the bridge speaks two sentences (110,400 samples).
    The first sound takes 1.6 s, including the model's first load;
  - Eva (research analyst) is saved as Amy and Thiago (growth marketer) as
    Owen;
  - a profile sample is scheduled through the page's reader;
  - choosing Simone saves `voice: "f06"` on the bridge;
  - Settings → Voice lists both members, with no "ElevenLabs" anywhere;
  - Edit profile shows the voice.
- **The first run of that check failed:** `/voice-engine/*` came back as
  `text/html`. `server.mjs` sends every non-`/api` path to the single-page
  fallback before any route plug-in runs. That is why the engine has its own
  branch before `/api`.
- **`scripts/check-voice.mjs`:** 28 checks, among them:
  - kale streaming, cancel and the built-in fallback, with a fake worker and
    fake audio;
  - names → gender (Tatiana, Thiago, João, Igor, Aroha);
  - unique voices for five women, and a sixth joining keeps the first five;
  - the route's path guard, and the old ElevenLabs key being deleted.
- **`check-mobile-host`:** every member in the snapshot carries a voice id.
- **`check-app-info`** passes with the Kale, onnxruntime-web and dizione
  notices.

### Addendum, 24 Nov 2026: finding the voice

The owner asked "where is the voice I asked for?" after it shipped. The reply
speaker only appeared on hover, and the member card (click the avatar in the
chat header) did not mention the voice. The speaker is now always visible,
muted, and the card has a Voice row with a sample. `check-read-aloud-browser`
opens the card, plays the sample and checks the card's pen and eye icons; it
now runs in CI.

### Addendum, 24 Nov 2026: a Voice page for each member

"per agent i want a voice control where i can change the voice … i asked this
before and i didn't get it." The picker sat in the middle of the member's Home
page, under the harness summary, where it was not found. Each member now has a
**Voice** page in its sidebar, right after Permissions (Home, Communications,
Permissions stays as ADR-0266 set it), with the picker, samples and the
read-aloud switch; Home keeps one line naming the voice with "Change voice",
and Settings → Voice links to the page. `check-read-aloud-browser` goes
Home → Change voice → the Voice page; `check-member-controls-browser` pins the
sidebar order.

## Consequences

- The app grows by about 117 MB:
  - tiny 80 MB and nano 15 MB of models (nano is kept for the phone);
  - 15 MB of onnxruntime wasm;
  - 9 MB of text front end, including en-gb files the engine does not use
    yet;
  - 5 MB of voices per model.
- The first sentence after launch waits for the model to load, about 1.5 s
  here. A member with "Read replies aloud" on warms the model while its reply
  is written. Each window that reads aloud (main, Quick Chat) loads its own
  copy.
- English only. Replies in other languages are read with English
  pronunciation; the browser fallback is no longer used for them.
- Ten voices: past five women or five men, voices repeat.
- Gender from a first name is a guess, and it is only a default. Names used
  for both sexes, and names on neither list, fall back to role alone.
- ElevenLabs users lose their key without being asked; the release notes say
  why.
- The start screen no longer lists start-up steps. They were never reported
  as progress, so nothing true is lost, but the steps are no longer spelled
  out.
