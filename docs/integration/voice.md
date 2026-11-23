# Voice: dictation and read aloud (ADR-0101, ADR-0276)

## Routes (`server/routes/voice.route.mjs`)

| Route | Result |
| --- | --- |
| `GET /voice-engine/<file>` | the vendored kale-tts-1 files from `vendor/kale-tts` (`bun run voice:fetch`, pinned in `kale-tts.lock.json`); served by `server.mjs` before `/api` with no ownership header, never the app fallback |
| `GET /voice-engine/squad-worker.mjs` | `server/voice/kale-worker.mjs`, the page's module worker |
| `GET /api/voice/settings` | `{ engine, model, available, voices: [{ id, name, gender, accent, description }] }` |

Speech is made in the page from the bundled model; no text leaves the computer.
An ElevenLabs key saved by an earlier version (`<squadStateDir>/voice.json`) is
deleted on start. No events are emitted or subscribed to.

## Voices

`src/lib/member-voice.js`: the ten kale-tts-1 voices, `nameGender`,
`defaultVoiceFor(member, taken)` and `memberVoices(members)`. A member's voice is
`agent.voice` (a voice id, in `MEMBER_PROFILE_FIELDS` and the bridge's member
fields); members without one are given one in join order and the app saves it
once. The phone host sends it as `members[].voice` (mobile contract 0.8). MCP:
`create_member` and `update_member_profile` take `voice` (a name or id).

ibed to.

## Components

| Component | Where | Props |
| --- | --- | --- |
| `VoiceInputButton` (`src/components/chat`) | member composer action row, quick-chat `InputGroupAddon` (`control={InputGroupButton}`), `MessageComposer`, `ChannelComposer` | `value`, `onValueChange(nextDraft)`, `disabled`, `copy`, `noticeClassName` |
| `ReadAloudButton` (`src/components/chat`) | reply header in `AgentResponseMessage`; channel hover bar through `ChannelStream`'s `renderActions(message)` prop | `text` (markdown), `message` (`id`, `status`), `memberId` (its voice comes from `MemberVoicesContext`), `auto` (= `agent.readAloud`), `compact`, `copy` |
| `ReadAloudSetting` (`src/components/chat`) | member profile home, after the Harness summary | `agent`, `onChange(checked)` → `{ readAloud }`, `onVoiceChange(id)` → `{ voice }`, `copy` |
| `VoicePicker` (`src/components/members`) | profile Voice section, Edit profile | `value`, `onChange(id)`, `memberName` |
| `VoiceSettings` (`src/components/settings`) | Settings → Voice (section id `voice`, after Notifications) | `api`, `agents`, `navigate`, `copy` |

`src/lib/spoken-text.js`, `src/lib/voice-input.js`, `src/lib/read-aloud.js`,
`src/lib/kale-voice.js` and `src/lib/member-voice.js` are pure and importable from node. `agent.readAloud` is a plain boolean on the
member record; `normalizeAgentCopy` spreads unknown fields, so no migration.

## Scripts and docs

- `package.json`: `check:voice` → `node scripts/check-voice.mjs`, appended to `ci`.
- `DESIGN.md`: mic and speaker placement lines. `CHANGELOG.md`: Added entries.
