# Skill standards, progressive retrieval, and durable identity

Research snapshot: 2026-11-02, Pacific/Auckland. Research only; no production changes or runtime claims. Primary sources only. Findings below distinguish format requirements, implementation guidance, documented product behavior, source-code experiments, and proposed Autohand design.

## Main conclusion

Keep the portable `SKILL.md` package, but put discovery, identity, activation, receipts, and restoration in the host. The documented baseline still exposes skill metadata at startup; a near-zero prompt catalog requires an additional retrieval layer. MCP provides useful identity and integrity rules, but it is a transport extension rather than a complete local library or goal-resumption design. [Agent Skills loading model](https://agentskills.io/specification#progressive-disclosure), [MCP extension overview](https://skills.extensions.modelcontextprotocol.io/)

**Current maturity matters:** SEP-2640 is a Final accepted design, created 2026-04-23 and merged 2026-09-13. The Skills extension itself was classified **Beta** under the newer extension lifecycle on 2026-10-29; breaking revisions remain possible. The old `specification/stable/` URL now fails because the source moved to `specification/beta/`. Search-result snippets still report the old path. [Final SEP](https://modelcontextprotocol.io/seps/2640-skills-extension), [official migration PR, merged October 29](https://github.com/modelcontextprotocol/ext-skills/pull/161)

## Eight high-value primary source groups

| Source | Date/status verified | Role in this report |
| --- | --- | --- |
| [Agent Skills specification](https://agentskills.io/specification) | Undated living specification; retrieved 2026-11-02 | Portable package format |
| [Agent Skills client integration guide](https://agentskills.io/client-implementation/adding-skills-support) | Undated implementation guidance; retrieved 2026-11-02 | Discovery and context lifecycle |
| [Anthropic: equipping agents with skills](https://www.anthropic.com/research/equipping-agents-for-the-real-world-with-agent-skills) | Published 2025-10-16; open-standard update 2025-12-18 | Original architecture and rationale |
| [Claude Code skills documentation](https://code.claude.com/docs/en/skills) | Undated product documentation; retrieved 2026-11-02 | Invocation and loaded-content lifecycle |
| [Claude skill-authoring guidance](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | Undated product guidance; retrieved 2026-11-02 | Reference routing and disclosure pitfalls |
| [OpenAI: build skills](https://learn.chatgpt.com/docs/build-skills) | Undated official documentation; retrieved through OpenAI Docs MCP on 2026-11-02 | Local discovery and invocation policy |
| [OpenAI Codex source](https://github.com/openai/codex/tree/main/codex-rs/ext/skills/src) | Relevant commits 2026-07-16 through 2026-10-27; exact snapshots below | Concrete authority, budgeting, and retrieval implementations |
| [MCP Skills extension specification](https://skills.extensions.modelcontextprotocol.io/specification/beta/skills), [SEP-2640](https://modelcontextprotocol.io/seps/2640-skills-extension), [stage change](https://github.com/modelcontextprotocol/ext-skills/pull/161) | Final accepted SEP; Beta extension as of 2026-10-29 | Transport, provenance, integrity, and maturity |

## What is standardized and what is not

The format requires a skill directory with `SKILL.md`, YAML frontmatter containing `name` and `description`, and optional supporting files. `metadata` is an extensible string map; the example `metadata.version` is not a mandatory versioning protocol. `allowed-tools` remains experimental. Relative links resolve from the skill root. The specification recommends a main file below 500 lines, approximately 100 metadata tokens per installed skill at startup, full instructions on activation, and other resources as needed. It recommends shallow reference chains. These are distinct from a global registry, canonical identity, derivative lineage, or execution-state schema, none of which the listed format fields define. [Specification](https://agentskills.io/specification)

The client guide treats `.agents/skills/` as an interoperability convention, not a mandated storage path. It suggests retaining metadata and a source location, filtering unavailable skills out of model discovery, delivering instructions through either file reads or an activation tool, optionally listing resources without reading them, protecting loaded guidance through compaction, and deduplicating activations. A dedicated loader can supply the base directory at activation, removing the need to put absolute paths in every startup entry. This is implementation advice, not a requirement to copy foreign skill directories. [Client integration guide](https://agentskills.io/client-implementation/adding-skills-support)

Anthropic's original 2025 design explicitly preloads every skill's name and description, then lets the model read the full entrypoint and follow supporting files. It explains why moving specialized branches into references reduces context usage; it does not establish a near-zero metadata search mechanism. [Original architecture, October 16, 2025](https://www.anthropic.com/research/equipping-agents-for-the-real-world-with-agent-skills)

## Product behavior exposes lifecycle tradeoffs

Claude Code's docs distinguish automatic invocation from explicit-only invocation, and describe these controls as extensions to the common format. Loaded instructions remain in conversation across turns, while `allowed-tools` grants expire at the next user message. Identical rendered reinvocations produce a short already-loaded note. Changed rendering appends content again. Compaction restores at most the first 5,000 tokens per invoked skill within a shared 25,000-token budget, preferring recent invocations; older skills may disappear. Its skill listing currently budgets 1% of the model context and can remove descriptions. Therefore installed, listed, invoked, still present, and permission-bearing are different states. [Claude Code lifecycle, invocation, and listing budgets](https://code.claude.com/docs/en/skills)

Claude's authoring guidance identifies a concrete failure mode: deeply nested links can lead the model to preview only part of a referenced file and miss the final instructions. It recommends linking required references directly from `SKILL.md`, and adding a table of contents to references exceeding 100 lines. This supports selecting the relevant complete instruction files, rather than interpreting progressive disclosure as arbitrary truncation of a selected procedure. [Authoring guidance: nested references](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices#avoid-deeply-nested-references)

OpenAI currently documents a startup list capped by default at 2% of context, or 8,000 characters if context size is unknown. It shortens descriptions and may omit entries with a warning; the override caps at 10,000 tokens. Local Codex discovery includes repository `.agents/skills` directories from the working directory to repository root, plus user/admin/system scopes; same-named skills are not merged. `agents/openai.yaml` can disable implicit invocation while preserving explicit invocation. Directories serve local authoring; plugins are the documented distribution unit. These are Codex product conventions rather than new portable frontmatter requirements. [Official OpenAI documentation](https://learn.chatgpt.com/docs/build-skills)

**Implication for Autohand, inferred:** expiration of an activation flag must not imply that old instructions have left the provider's context. A task-scoped design needs prompt assembly and compaction to agree with its UI. Otherwise the TUI can claim a skill is unloaded while its instructions still influence later requests.

## First-party implementation mechanisms worth borrowing

### Separate authority, package identity, and presentation

Codex's `SkillCatalogEntry` separates source authority, opaque package identity, resource identity, display path, optional canonical skill ID, plugin IDs, and alternate source locations. Its comments explicitly prohibit parsing local paths out of opaque package IDs. Resource binding validates package-relative segments and retains the originating environment. Deduplication considers authority, package, and environment rather than the display name. This is a concrete implementation pattern for resolving the same capability from several sources while retaining the correct read route. [Pinned `catalog.rs`, October 26 snapshot](https://github.com/openai/codex/blob/3cacafa0b7c668b5378f83a1b0988da77ee8e7a9/codex-rs/ext/skills/src/catalog.rs)

Codex's model instructions distinguish host files from executor/cloud packages and custom sources. Required references must use the same source mechanism; remote identifiers must not be treated as local paths. It also tells the main agent to read complete selected instruction files and avoid unrelated references. This is evidence that transport-aware locators can remain compact without losing source semantics. [Pinned `catalog_prompt.rs`, October 27 snapshot](https://github.com/openai/codex/blob/2edc8dcb0c55dd66c866948437b5725241169615/codex-rs/ext/skills/src/catalog_prompt.rs)

### Bound catalog costs without overstating retrieval maturity

Codex includes cheap deterministic selectors over skill names, short descriptions, descriptions, and dependencies. Their interface explicitly says **shadow mode without changing the model-visible catalog**. Thus their presence is not evidence that production Codex already replaces catalog prompting with automatic retrieval. [Pinned selector interface, August 17 snapshot](https://github.com/openai/codex/blob/ea10ae7d0fe6a2fb0614a32adb5e095853319355/codex-rs/ext/skills/src/dynamic_skill_selector.rs)

One implementation uses fielded BM25 with weights 8:4:1 for name, short description, and description, deterministic tie-breaking, bounded query/document sizes, a 1,000-document candidate cap, and 50-result cap. That is a useful low-cost prototype, but naively truncating the library to its first 1,000 documents can exclude the correct skill before ranking. [Pinned BM25 implementation, July 16 snapshot](https://github.com/openai/codex/blob/a47c661ea9e226fe65e46cf9dbc5c5ed75c2c762/codex-rs/ext/skills/src/dynamic_skill_selector/fielded_bm25.rs)

An October 26 Codex change adds incremental catalogs behind a **disabled-by-default** `skill_catalog_deltas` flag. It appends additions/edits without repeating unchanged entries, shares cumulative metadata budget across sources and resumed turns, and rebuilds/reset budgets after compaction. Removals do not refund budget or emit updates. This offers a cache-friendly alternative to resending metadata, with stale-context and cumulative-budget tradeoffs; it remains feature-gated source evidence. [Exact change and tests](https://github.com/openai/codex/commit/3cacafa0b7c668b5378f83a1b0988da77ee8e7a9)

## MCP: useful protocol rules, with a Beta integration boundary

The extension negotiates `io.modelcontextprotocol/skills`, requires `skills/list` and `skills/get`, and optionally supports `resources/directory/read`; content travels through `resources/read`. A generic `SKILL.md` resource read does **not** activate a skill: activation belongs to the host's dedicated loading path. Its overview separates byte transport from verified, approved activation. [Current official overview](https://skills.extensions.modelcontextprotocol.io/)

The accepted SEP permits empty or partial listings for huge/generated catalogs, while `skills/get` retrieves metadata for a known skill URI even if it was not enumerated. Direct URI pointers can come from server instructions. Archive distribution was deferred; this is not a ZIP install protocol, a universal public registry, or a standardized relevance-search API. These remain historical accepted-design statements; consult the current revision for requirements. [Final SEP, abstract and deferred features](https://modelcontextprotocol.io/seps/2640-skills-extension)

Current Beta requirements define identity as **host-assigned originating-server identity plus skill URI**, never name or URI alone. Each entry supplies verbatim frontmatter and either a complete per-file `{uri,digest,size}` manifest or `resources: "dynamic"`. Reads verify raw-byte SHA-256, byte length, and entrypoint frontmatter; supporting files load lazily. The host holds the manifest while acting on the skill, at least until its instructions leave context. Persisted approvals bind to the resource/digest set and are revoked when it changes. Remote-origin caches must remain outside filesystem skill discovery and retain origin after restart. Digests prove consistency, not publisher trust. Downloading remote content does not grant local execution or `allowed-tools` permissions. Nested skills require their own consent; reading a nested `SKILL.md` as supporting material does not activate its frontmatter. [Current Beta specification](https://skills.extensions.modelcontextprotocol.io/specification/beta/skills)

Do not infer broad host support from Final SEP status. Extensions are opt-in, and the official client matrix is community-maintained. A server and host must negotiate the extension rather than assuming every MCP connection supports it. [Official extension support matrix](https://modelcontextprotocol.io/extensions/client-matrix)

## Proposed Autohand design

These are design recommendations inferred from the evidence, not claims of standards compliance or existing implementation.

### One reusable capability, several entry points

Represent a workflow once in the capability registry. A native `/deep-research` command can execute its established runtime; the reusable `deep-research` skill supplies when-to-use guidance and points to that capability. Imported `research` or `research-deep` packages remain separate origins until their relationship is explicitly established. An alias may route to the native capability; it should not silently replace an unrelated same-named package or launch a second orchestration layer. The source rationale is the separation between opaque identity, display path, and source routes in [Codex's catalog](https://github.com/openai/codex/blob/3cacafa0b7c668b5378f83a1b0988da77ee8e7a9/codex-rs/ext/skills/src/catalog.rs).

### Identity model that survives moves and adaptations

Keep three concepts separate:

| Concept | Proposed representation | Purpose |
| --- | --- | --- |
| Logical identity | Stable locally assigned skill ID plus origin namespace | Names can collide or change |
| Content revision | Hash of a canonical, sorted manifest of package-relative paths, sizes, and per-file digests | A reference/script edit changes the revision even if `SKILL.md` does not |
| Locator | Current filesystem root or source-owned remote resource locator | Moves update resolution without rewriting goals |

For a registry install, retain registry/publisher identity, source repository and immutable revision when available, installed manifest digest, license, and local locator. For an adaptation, allocate a new logical ID and record `derivedFrom` containing the exact upstream identity and revision; preserve the original package, document local changes, and avoid automatic overwrite. A self-declared `metadata.version` or a mutable repository branch cannot substitute for content identity. This proposed distinction extends the standard's [optional metadata surface](https://agentskills.io/specification), rather than inventing a new required portable field.

Persist references as `{skillId, revision, resourceRelativePath}` and resolve them through the current locator map. Store absolute paths as repair hints only. Keep user/repository scope and workspace identity separately; do not infer either from an old absolute path. If a move is detected and the manifest still matches, update the locator atomically. If the ID resolves to changed bytes, show revision drift and resolve it explicitly instead of silently restoring a different skill.

### Discovery that is cheap in both tokens and operations

Maintain a local metadata index outside the prompt. Bootstrap the model with a constant-size discovery contract, then retrieve a bounded shortlist for the current task. Explicit skill references bypass fuzzy ranking. Search local compatible packages first, then query a remote registry when local retrieval is insufficient; keep search results, downloads, and activation separate. Cache metadata and invalidate on root/config changes or file changes. Expose partial/stale/unavailable states so a registry outage cannot be mistaken for an empty library.

Start with deterministic lexical ranking and exact-name/path/domain signals over the complete indexed library, with a bounded output and a user-visible search escape hatch. Use recent usage as a tie-breaker, not as proof of relevance. The [Codex selector experiment](https://github.com/openai/codex/blob/ea10ae7d0fe6a2fb0614a32adb5e095853319355/codex-rs/ext/skills/src/dynamic_skill_selector.rs) establishes that this family of mechanisms is implementable cheaply; it does not establish recall quality or a universal ranking choice. Measure retrieval misses separately from instruction-following failures.

### Activation and receipts must follow the actual context

Use explicit states: `discovered`, `selected`, `read`, `injected`, `in-context`, and `expired/removed`. Only emit a loaded receipt after the complete selected instruction content has been attached to the outgoing request; metadata matching, file inspection, or announcing an intention to use a skill is insufficient. Record origin, logical ID, content revision, trigger, task/run ID, loaded resources, and whether the activation reused identical content. A receipt should never imply the agent followed the instructions or executed a script.

Keep activation ownership tied to the current task. Retain an exact context manifest across compaction; restore only the files that still apply. Mark a reference as read only after all pages arrive. A selected instruction file should be complete, while unrelated references remain unloaded. The evidence for distinguishing retained instructions from temporary permissions is [Claude Code's lifecycle](https://code.claude.com/docs/en/skills); actual Autohand context lifetime must be verified independently.

### Reusable library and unfinished runs are separate persistence domains

New sessions should rediscover reusable installed/local skills from durable library state; they should not depend on old transcript text. Store unfinished goal/run state separately, including owner identity, workspace/repository identity, continuation status, and the activation manifest. Restore only when the owner and workspace match, referenced revisions resolve, and the goal remains eligible for continuation. Use an atomic claim/lease if two sessions may resume the same run. A missing skill or revision mismatch should produce a resumable blocker with a repair path, not a replacement selected by name.

No inspected skill format or MCP transport document standardizes that goal ownership/resumption contract. It is an Autohand runtime responsibility, informed by the sources' separation of reusable package, source identity, and active context.

## Five concise recommendations

1. Keep `SKILL.md` portable; add a host-owned metadata index and bounded task retrieval to achieve a near-zero startup catalog.
2. Give every installed/adapted capability a stable identity, immutable content revision, durable provenance, and relocatable resource references.
3. Route native commands and skill aliases through one canonical capability; avoid duplicate research orchestration layers.
4. Generate loaded-skill receipts from actual context injection, preserve complete required instructions through compaction, and show partial or expired state accurately.
5. Persist the reusable library separately from unfinished goals; resume with owner/workspace/revision checks and single-run claiming.

## Limits and uncertainties

- Living documentation is undated unless explicitly noted above. Retrieval date is evidence of the page inspected, not its publication date.
- Codex source snapshots show mechanisms and feature flags; no installed binary or user entitlement was exercised. Shadow selectors and disabled catalog deltas must not be described as generally active product behavior.
- MCP Skills is Beta despite its Final founding SEP. Pin an extension revision and retain a fallback rather than assuming permanent wire compatibility.
- No global standard identity, derivative-update policy, registry-ranking algorithm, or ownership-safe goal restoration was established by these sources. Those recommendations need Autohand contracts and tests.
- This report does not audit this checkout's skill mapping, assess learning/evaluation systems, use paid inference, or prove interactive TUI behavior.
