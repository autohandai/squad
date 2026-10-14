# ADR-0129: Continue a Claude turn after a model-specific limit

Date: 2026-10-14

## Context

The screenshot showed “You've reached your Fable limit. Switch to another
model” ending the turn. A controlled real-bridge replay reproduced that
terminal failure before the change. Squad had no model-limit recovery policy.

The first live SDK check corrected the initial diagnosis: Claude's structured
event used `seven_day_overage_included`, not a Fable-named bucket. It also
reported general five-hour utilization 0.03 and weekly utilization 0.73 while
the refusal explicitly named Fable and recommended another model. Treating
that bucket as account-wide incorrectly prevented recovery. The observed
payload is retained in the local evidence and in the policy regression test.

The failed CLI also exited with code 1 after emitting its result. That can
throw from the SDK iterator; model inventory already obtained during
initialization must survive that exit instead of being discarded.

## Decision

Recover only a named model refusal or a rejected model-specific window. Full
general account windows, authentication/billing failures, timeouts and Stop
do not cause model hopping. The observed overage-included bucket alone is not
proof of account exhaustion; combine its explicit refusal with the reported
general windows. Never enable overage or switch provider/authentication.

Use SDK-listed models, falling back to the detected CLI's own catalog if that
inventory is unavailable. Aliases, canonical IDs and model families share an
exhaustion record. A listed model is only a candidate; success proves access.
Allow at most three model switches within the original turn deadline.

Resume the same session with a continuation instruction that preserves
completed work rather than repeating the original request. If no session
exists after tools or answer output, stop instead of replaying side effects.
Keep folders, permissions and member instructions. Drop unsupported effort
overrides for a fallback model instead of sending an invalid setting.

Persist a private, bounded per-member/account/executable/workspace cooldown
record. Use the engine's reset receipt, or a five-minute recheck when it omits
one. Remember the working candidate separately from the engine default. Show
one progress sentence, retain it in work details, and attribute the delivered
reply and usage to the model that actually answered.

## Evidence

`bun run check:claude-sdk` covers the captured live bucket, exhausted account
windows, authentication/billing refusals, equivalent aliases, reset expiry,
bounded exhaustion, the default-model cooldown, same-session continuation and
Stop. `bun run check:claude-recovery` uses a real bridge and SDK protocol,
recovers Fable to Opus, then restarts the bridge and verifies that it continues
using the working model without retrying Fable. The browser variant verifies
the completed answer, actual-model metadata and reload persistence.

The live probe encountered the actual Fable refusal and completed on
`claude-opus-5-5` with `SDK_OK`, one model switch and no tool calls. Artifacts
are in `.codex-artifacts/claude-sdk-review/`.
The same request through the installed app's packaged SDK and harness modules
also passed. Its progress named “Opus (engine default)” using the SDK's resolved
model, instead of the ambiguous catalog label “Default (recommended)”.

## Consequences

- A model-specific quota can recover without a person resending the work, while
  an exhausted account still fails honestly.
- Known exhausted models are avoided across bridge restarts until their reset;
  explicit selection of a different unblocked model still takes effect.
- Availability is not promised by the catalog, nor is quota predicted. Four
  attempts can still fail even if some later catalog entry could work.
- Session continuation reduces repeated work but cannot guarantee the vendor
  model never repeats an action. The missing-session guard avoids a blind
  replay after side effects.
- Usage-query APIs marked experimental by the SDK are not used as an access
  guarantee. Unknown reset times get a finite cooldown rather than a guessed
  subscription window. There is no cross-provider fallback.
