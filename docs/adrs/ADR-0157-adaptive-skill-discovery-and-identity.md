# ADR-0157: Bounded skill discovery with stable package identity

Status: Accepted · 3 November 2026

## Context and evidence

The CLI greeting audit found 47,678 characters of skill descriptions in 80,880 message characters. Its native tools were already reduced to three. The remaining catalog growth requires a discovery/loading change, not more tool-schema churn. Agent Skills supports portable packages and progressive loading; removing the startup roster additionally requires host retrieval. See the [research](../reports/skills-research-2026-11-02/README.md).

ADR-0039 defines nearest-root local discovery and member snapshots. Equal names can represent different packages, and workspace relocation makes absolute paths unreliable as identity.

## Decision

Use a bounded startup discovery contract over the complete authorized local catalog. Retain existing aliases and nearest-root precedence, while exposing qualified references containing origin authority and stable package identity. Pin an immutable complete-package revision separately from its current locator. Keep member snapshots immutable for a run.

One canonical loader rechecks authorization, enablement, compatibility, manifest, and budget. Supply required instructions intact; load optional resources when needed. Use existing code-mode tools and context builders. Record attachment evidence at the actual engine boundary; external engines that cannot attest attachment report supplied/unknown.

## Tradeoffs and deliberate limits

Local retrieval can miss relevant skills, so explicit lookup remains available and recall must be benchmarked. A whole roster avoids retrieval misses but makes every opening prompt grow. Summarizing arbitrary instructions could erase constraints, so oversize required content receives an explicit decision rather than silent truncation.

No trained router, new native catalog tool, duplicate research executor, or required remote protocol is introduced. The implementation extends ADR-0039's identity model while preserving existing unqualified alias precedence. The CLI discovery change is default-off behind `features.adaptiveSkills`; exact lookup remains independent of ranking.

Details: [design](../superpowers/specs/2026-11-02-adaptive-skills-design.md), [evaluation](../superpowers/specs/2026-11-02-adaptive-skills-evaluation.md).

## Squad implementation evidence (3 November 2026)

The local adapter now keeps nearest-root aliases while exposing every qualified origin, including nested Codex packages. Project origins use the shared `.autohand/workspace-identity.json` UUID contract; a read-only source without an enrolled identity reports locator-only metadata. Member snapshots preserve origin and the SHA-256 of the JSON array of lexically sorted `{path,sha256,bytes}` resources. Scripts, executable bits and binary assets survive copying. Symbolic links, unsafe paths, partial packages and file/byte overruns fail instead of silently omitting content. Failed copies stage outside the engine's active discovery directory, and rejected snapshots are retained outside it. Disabled snapshots retain their pins and cannot silently adopt a changed upstream revision.

Selection is local lexical matching over the member's explicitly configured snapshots, after the existing memory scope rule and member-home containment filter. Explicit references bypass the shortlist; exclusions apply before ranking. Only selected full instructions travel in current-turn context. No model preview, Weka dispatch, automatic installation from search, learning, sync or teammate teaching was added.

All handoffs recheck current saved scope/permissions and complete snapshot revisions. The built-in SDK accepts a native `skill_attachment` event only when it carries `submitted` plus `provider-request` capability and exact known revision/resource digests. A bridge SDK call alone, and every Codex/Claude/ACP handoff, reports supplied with engine confirmation unavailable. External context retention, later resource reads and compliance are unobservable. Work details reuse divider rows, preserve past/current task semantics and do not count instruction supply as tool execution.

`node scripts/check-adaptive-skills.mjs` exercises origin collisions, relocation, unavailable roots, executable/binary copying, limits, symbolic links, script mutation, scope-before-ranking, exclusions, a 10,000-entry greeting fixture, receipt strength and duplicate/historical projections. Its startup bound is a character-level invariant, not a tokenizer benchmark. Existing local-skills, activity, SDK, harness, prompt-stability and staged-import checks pass. `bun run build` passes. The seeded headless-Chrome execution-panel check passed in light and dark and rendered confirmed, supplied, historical and coalesced receipts. These are local deterministic and rendered fixture checks; there were no live model calls, deployments or task-quality benchmark runs.

Known boundary: the existing member-config bridge check uses its current directory as a workspace and refuses `/private/tmp` under the existing user-home workspace policy. It needs a permitted checkout to run; this implementation does not relax that policy. Optional semantic selection and independent benefit evaluation remain deferred. The source package and rejected bytes remain inspectable; the adapter does not claim a general immutable remote revision archive.

### Native receipt transport audit

Reading the installed `@autohandai/agent-sdk` 1.0.5 runtime showed that unknown JSON-RPC methods survive as `{type:'unknown_notification',method,params}`. It does not directly produce `skill_attachment`. Both CLI output adapter switches previously dropped the native event. The CLI RPC adapter now emits `autohand.skillAttachment` with the exact receipt; ACP uses the supported `_autohand/skillAttachment` extension notification and creates no fabricated message or tool call. Squad decodes only the dedicated RPC method and validates the receipt against its enrolled exact snapshot resources. An external ACP engine still has supply-only attestation in Squad.

`node scripts/check-skill-receipt-transport.mjs` uses the installed SDK and a real local child process over stdio. Its native receipt survives serialization intact; response-text claims, malformed resources, unrelated methods and rejected requests cannot become loading evidence. CLI adapter tests exercise the actual RPC/ACP switches. This is protocol-fixture evidence, without a live provider. A currently installed CLI that predates the notification continues to show supplied; forwarding support in the SDK does not imply that an older CLI can emit request evidence. No SDK dependency was patched or published.

The member native launch carries `AUTOHAND_SKILL_SNAPSHOT_MANAGED=1`. The canonical CLI reader restricts managed discovery to valid host-enrolled snapshots, preserving the source reference/scope and rehashing the entire package. A missing or invalid managed manifest never implicitly authorizes unrelated host personal skill directories. Canonical revisions are `sha256:<hex>` over the sorted complete resource manifest; individual resource SHA-256 values remain raw hex.
