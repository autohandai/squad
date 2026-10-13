# Voice: dictation and read aloud (ADR-0101)

## Routes (`server/routes/voice.route.mjs`, auto-loaded)

| Route | Body → Result |
| --- | --- |
| `GET /api/voice/settings` | `{ provider, configured, ready, keyHint, voiceId, voiceName }` |
| `PUT /api/voice/settings` | `{ key?, voiceId?, voiceName? }` → the same shape, plus `voices` when a new key was verified. A missing `key` keeps the stored one; `null` clears it. A new key is checked against ElevenLabs `/voices` before it is stored. |
| `DELETE /api/voice/settings` | forgets the key and the voice |
| `GET /api/voice/voices` | `{ voices: [{ id, name, description }] }` with the stored key (409 when none) |
| `POST /api/voice/speak` | `{ text }` (≤ 5000 chars) → `audio/mpeg` bytes; 409 when no key or no voice |

The key lives in `<squadStateDir>/voice.json` (mode 0600) and never appears in
a response. No events are emitted or subscribed to.

## Components

| Component | Where | Props |
| --- | --- | --- |
| `VoiceInputButton` (`src/components/chat`) | member composer action row, quick-chat `InputGroupAddon` (`control={InputGroupButton}`), `MessageComposer`, `ChannelComposer` | `value`, `onValueChange(nextDraft)`, `disabled`, `copy`, `noticeClassName` |
| `ReadAloudButton` (`src/components/chat`) | reply header in `AgentResponseMessage`; channel hover bar through `ChannelStream`'s new `renderActions(message)` prop | `text` (markdown), `message` (`id`, `status`), `api`, `auto` (= `agent.readAloud`), `compact`, `copy` |
| `ReadAloudSetting` (`src/components/chat`) | member profile home, after the Harness summary | `agent`, `onChange(checked)` → `updateAgent(agent.id, { readAloud })`, `copy` |
| `VoiceSettings` (`src/components/settings`) | Settings → Voice (section id `voice`, after Notifications) | `api`, `copy` |

`src/lib/spoken-text.js`, `src/lib/voice-input.js` and `src/lib/read-aloud.js`
are pure and importable from node. `agent.readAloud` is a plain boolean on the
member record; `normalizeAgentCopy` spreads unknown fields, so no migration.

## Scripts and docs

- `package.json`: `check:voice` → `node scripts/check-voice.mjs`, appended to `ci`.
- `DESIGN.md`: mic and speaker placement lines. `CHANGELOG.md`: Added entries.
