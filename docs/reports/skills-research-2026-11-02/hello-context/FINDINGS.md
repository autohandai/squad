# Greeting input-context audit

The tools change reduces the native tool envelope. It does not make the initial
system prompt small. The ordinary terminal greeting reaches the regular agent
loop, and the full startup conversation accompanies it.

## Local HTTP and real-PTY capture

Both variants used one `hello` request, a local mock provider, disabled background
calls, a temporary home, copied project AGENTS.md, and discovered user skills.
No paid inference was used and no raw prompts or credentials were persisted.

| Capture | Native tools | Model requests | Message characters | Skill-catalog characters |
| --- | ---: | ---: | ---: | ---: |
| Installed 0.9.9 / ec2372 | 127 | 1 | 81,624 | 47,678 |
| Updated tools source / 7012 plus permission edits | 3 | 1 | 80,880 | 47,678 |

The available-skills catalog accounts for about 59% of the updated request's
message text. It includes descriptions for all discovered skills even for a
greeting. Other large sections include the ReAct policy, workflow instructions,
available agents, and project AGENTS.md.

Counts and section breakdowns are in `request-size-audit.json`. Its token counts
use the repository's character heuristic and are **not provider billing counts**.
The message-character totals exclude native tool schema JSON. This fixture has
empty user memory, so it does not reproduce every byte of the user's session.

## Current source behavior

- `SystemPromptBuilder.ts:445` includes full skill descriptions for terminal
  sessions. The names-only `compactSkillIndex` path currently defaults to ACP.
- Code mode compacts tool definitions; it does not compact the skill catalog,
  system policy, project instructions, active skills, or conversation history.
- `SimpleChatHandler.ts` contains a toolless helper, but the captured normal
  terminal greeting does not take that path. It would still pass the full
  conversation if invoked. Reading this helper alone incorrectly suggested that
  the live greeting sent zero tools; the wire capture corrected that inference.

## Runtime and accounting

Recent local sessions beginning with a three-character greeting have provider-
reported actual input usage around 24k tokens. One single-turn record reports
24,234 prompt tokens; another two-turn record reports 49,270 prompt tokens.
These are evidence of real input usage, not merely a character estimator.

The 9.3% display is consistent with 24.3k divided by 262.1k. Input includes the
whole request context. Cached input still occupies the context window; caching
does not remove that text from the model's input.

Both installed binary locations still report 0.9.9 / ec2372 from October 28,
which defaults code mode off. The active-agent registry matches PID 59789
(`bun src/index.ts`, launched by `bun run dev`) to the recent greeting session
`6a6c5ec8-07c7-4060-a794-3c94d41ddc0e-1793585738306`. The current session uses
updated source. The large skill catalog remains in that build; the older
installed binaries are a separate finding.

## Scope

This turn diagnoses the cost; no product source, configuration, installed binary,
project instructions, or concurrent WIP was modified. A separate prompt-size
change would need to defer irrelevant skill descriptions and measure the
resulting payload while preserving required project instructions.
