# Autohand skills: small context, reliable discovery, evidence-backed learning

Research snapshot: **2 November 2026**. This is a design and research report, not an implementation plan approved for execution. No product code, installed binary, configuration, or user skill was changed. No paid inference was used, and the cited experiments were not reproduced.

## Recommendation

Keep the portable skill packages and the existing code-mode bridge. Add a small, host-managed discovery interface over the local library, load selected instructions through one authoritative loader, and distinguish successful loading from useful task outcomes. Persist reusable knowledge separately from unfinished goals.

The most valuable enhancement to our earlier discussion is **evidence-scoped learning**. A successful task can produce a candidate skill. That candidate becomes verified only for the environment and checks actually exercised, and earns a ranking preference only after useful results on later tasks. Creating files or repeatedly activating a skill is not proof that the agent learned something helpful.

Use Weka only as an optional selector under the user's strict provider boundary. Build and benchmark local retrieval first; a remote decision model is an enhancement, not a dependency for discovery, local learning, or session continuity.

## What we already have

The source review used local `main` at `6d973c5012541d54773562070615b1374090c643`. Existing resume and fullscreen UI work remains outside this research and was left untouched.

| Existing capability | Verified seam | Design implication |
| --- | --- | --- |
| 14 packaged skills, including `brainstorm`, `deep-research`, `systematic-debugging`, `root-cause-analysis`, and `workflow-discovery` | `src/skills/builtin/` | Improve discovery and use of existing built-ins before adding replacements. |
| Native `/deep-research` activates the bundled skill and queues its established research workflow | `src/commands/deep-research.ts:114` | Keep one executor, with command and skill entry points. |
| Terminal prompts eagerly include all skill descriptions; ACP can use a names-only index | `src/core/agent/SystemPromptBuilder.ts:445` | Remove catalog growth from the opening prompt while retaining full local discoverability. |
| Local name/description matching uses Jaccard similarity | `src/skills/SkillsRegistry.ts:855` | A reusable baseline exists; test improved retrieval rather than assuming semantic search is necessary. |
| Registry installation and local authoring already exist | `src/skills/skillTooling.ts`, `src/skills/SkillsRegistry.ts:918`, `src/skills/autoSkill.ts` | Preserve these paths and put consistent identity, loading, and evidence around them. |
| Skill activation immediately records `outcome: 'succeeded'` | `src/skills/SkillsRegistry.ts:749` | This means activation succeeded, not that the user's task succeeded. |
| Learned-capability scoring increments `successfulUses` from those events | `src/memory/MemoryManager.ts:355` | Do not use the present counter as proof of skill quality or a promotion signal. |
| Weka decisions are used internally for session compaction | `src/core/context/sessionCompaction.ts:94` | Audit every decision caller against the requested active-provider rule; the endpoint client alone does not establish that rule. |

The earlier local HTTP/PTY greeting audit captured **3 tools, one request, and 80,880 message characters** in the updated build. **47,678 characters—about 59%—were skill descriptions**. These character counts exclude native tool-schema JSON and used an empty fixture memory store. They explain a large startup cost; they are not a provider-token benchmark or a measured result of the proposed design. See [the prior audit](hello-context/FINDINGS.md).

### The screenshot's three reads

The inspected `research` packages came from `~/.agents/skills/research` and `~/.codex/skills/research`; `research-deep` came from `~/.codex/skills/research-deep`. Those reads were in this Codex session. They are distinct from Autohand's packaged `deep-research` skill and `/deep-research` command.

This is a useful regression case: equal-looking names can have different sources and instructions. Deduplicate identical packages by identity/content, preserve distinct packages with the same display name, and show enough provenance to choose deliberately. An alias to a native workflow should not start a second orchestration implementation.

## What the primary research changes about the idea

### 1. Progressive disclosure is established; zero-catalog startup is an extra host capability

Agent Skills defines the package and a loading pattern: metadata, selected instructions, then supporting resources. Its baseline still puts metadata into startup context. A near-zero startup catalog therefore needs host retrieval beyond that baseline. Keep the interoperable files; optimize how Autohand finds and supplies them. [Agent Skills specification](https://agentskills.io/specification), [client integration guidance](https://agentskills.io/client-implementation/adding-skills-support).

Selected procedures should remain complete. Make built-in entrypoints concise and move optional branches into directly linked references. Do not replace an unfamiliar community skill's constraints with an automatically generated summary merely to meet a token budget. [Official authoring guidance](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices#avoid-deeply-nested-references).

### 2. Routing evidence supports experimentation, not universal benefit

TypeSafe's current skill-suggestion experiment reports wrong loads falling from **15.7% to 7.9%**, and needless loads from **14.0% to 5.2%**, in a particular Jev/Haiku setup. Its main-agent prompt retains the roster, so those results do not demonstrate savings from removing the roster. Neither the selection accuracy nor its latency transfers automatically to Weka. [Current experiment and methodology](https://docs.typesafe.ai/cookbooks/skill_suggestion).

Curated skills improve average task pass rate in SkillsBench v4. SWE-Skills-Bench v2 finds no statistically significant effect for 92 of 98 evaluated public coding skills. These are different workloads and protocols, not contradictory universal laws. Selection quality and completed-task quality need separate measurements. [SkillsBench v4](https://arxiv.org/abs/2602.12670v4), [SWE-Skills-Bench v2](https://arxiv.org/abs/2603.15401v2).

### 3. Learned procedures need stronger verification than a successful-looking trace

SkillWeaver documents APIs that passed an exception-free verification criterion without performing the intended action. Memento-Skills explicitly reports that many optimized training skills did not trigger on held-out questions. These are reasons to require observable postconditions and fresh-task transfer, rather than equating a clean exit, a judge's praise, or retry improvement with a reusable skill. [SkillWeaver failure analysis](https://arxiv.org/html/2504.07079v1#A4.SS2), [Memento-Skills, section 3.1](https://arxiv.org/pdf/2603.18743).

### 4. Preserve package identity separately from location and display name

The first-party Codex catalog separates source authority, package identity, resource identity, and presentation paths. This is a useful implementation pattern for imported skills, same-named packages, and relocated projects. Its deterministic selectors are explicitly shadow experiments, so their source is not proof that production Codex already provides zero-catalog routing. [Pinned catalog implementation](https://github.com/openai/codex/blob/3cacafa0b7c668b5378f83a1b0988da77ee8e7a9/codex-rs/ext/skills/src/catalog.rs), [selector interface](https://github.com/openai/codex/blob/ea10ae7d0fe6a2fb0614a32adb5e095853319355/codex-rs/ext/skills/src/dynamic_skill_selector.rs).

### 5. MCP can be an adapter, without becoming the core dependency

The accepted MCP Skills SEP is Final, but the extension moved to **Beta on 29 October 2026**. Keep that maturity distinction explicit. Its origin/integrity rules are useful for remote skills, while a local index and current registry installer can deliver the initial Autohand improvement without waiting for universal MCP support. [Accepted SEP](https://modelcontextprotocol.io/seps/2640-skills-extension), [official Beta migration](https://github.com/modelcontextprotocol/ext-skills/pull/161), [current specification](https://skills.extensions.modelcontextprotocol.io/specification/beta/skills).

## The proposed architecture

Use three durable kinds of state, with routing and prompt assembly as bounded operations over them:

| State | Contents | Existing responsibility to extend |
| --- | --- | --- |
| Skill library | Portable packages, local metadata index, origins, immutable revisions, current locators | SkillsRegistry and existing registry/install paths |
| Experience ledger | Load/use events, verified task outcomes, corrections, costs, and revision-specific evidence | MemoryManager's event history and skill telemetry |
| Run state | Approved goals, queue, ownership, checkpoint, pending actions, and selected skill references | Existing goal/session runtime |

The library answers **what can help**. Experience answers **what happened when it was used**. Run state answers **what this user-approved task still needs**. Avoid making one large prompt or autonomous memory graph serve all three purposes.

### Runtime path

1. Resolve explicit user skill references and exclusions first.
2. Search the complete enabled local metadata inventory. Start with exact-name and lexical ranking; add local semantic retrieval only if it improves held-out recall enough to justify its cost.
3. Retrieve a small shortlist. If no match applies, continue without a skill; the main model can still request discovery when it encounters a new need.
4. Optionally rerank ambiguous candidates through a permitted decision model. Ask both which candidate is best and whether that candidate actually fits. A relative winner is not evidence that any option is suitable.
5. Resolve and load through one canonical path. Check the current scope, enablement, revision, and existing permission policy. Read complete required instruction files; load optional references on demand.
6. Attach a single versioned skill packet to the working context. Preserve the compact native tool interface and stable leading policy; serve changing skill material through the established task-context path.
7. Emit an actual loaded receipt only after attachment succeeds. When context is compacted or rebuilt, update the manifest of what remains present.

This is a hybrid: proactive local hints make skills discoverable for new users; explicit discovery remains the escape hatch for retrieval misses. It avoids requiring the main model to guess that an invisible skill exists.

### Context lifetime and user-visible receipts

Keep `suggested`, `selected`, `loaded`, `used`, and `outcome verified` distinct. A preview is advisory. A loader result confirms attachment. Neither proves compliance or benefit.

Suggested UI wording:

- Before submission: **Suggested: systematic-debugging · built-in**.
- After real attachment: **Loaded systematic-debugging · built-in · this task**.
- After saving an unverified procedure: **Saved draft skill: csv-validation · project**.
- After a new-session check: **Verified csv-validation for this project**.

Persist receipts with task/session identity, skill ID and revision, origin, selection reason, context attachment identity, and evidence scope. Store compact references in normal history; keep full content in the library. A historical receipt should say "loaded previously" when the current context does not contain that content.

Default draft previews can be local. If users enable model previews, make draft transmission clear, debounce requests, and keep Enter responsive. Bind any answer to the exact draft, candidate-index revision, skill revision, and provider/account policy state. A changed draft or provider invalidates an old answer. [First-party typeahead implementation to learn from](https://github.com/davila7/claude-code-templates/tree/bb03764ed7374da0ea3917615b0fbdb53aabbb8f/cli-tool/components/mods/productivity/jev-skill-typeahead).

### Stable local references and adaptations

Use a logical skill ID plus origin namespace; use a package-manifest digest as the content revision. Resolve a current local root or remote locator at runtime. A supporting script or reference change must change the package revision even if `SKILL.md` is unchanged.

Goal and session references should carry the skill ID, revision, and resource-relative path. Absolute paths can be repair hints. This directly addresses the Documents-path move: repairing a locator should not require rewriting every historical goal or silently substituting another same-named skill.

For an adaptation, retain the upstream original and record an explicit parent identity/revision. Prefer adding evidence or a useful example to an existing local skill, then a scoped derivative, and only then a new package when the workflow is distinct. Keep project knowledge project-scoped; personal reuse and public publication are separate choices.

## Learning from successful work

The learner should propose one small, useful change from a bounded evidence bundle after the task outcome is recorded. It can improve an example, add a non-applicability case, revise a local procedure, derive a project variant, or create a new skill for a real gap.

| Observation | Meaning | Ranking/promotion consequence |
| --- | --- | --- |
| Loaded | Exact instructions reached the current request | No success credit |
| Used | Trace/action shows application | Attribution remains uncertain |
| Task verified | Observable acceptance checks passed in a stated environment | Supports a candidate and scoped evidence |
| Benefit on later tasks | Matched or held-out results improve quality/cost | Can justify preference within that scope |

Proposed states are **draft**, **verified for scope**, **preferred for scope**, and **superseded/quarantined**. A source-task success justifies a draft. A fresh input and appropriate checks can verify that exact revision for a scope. Repeated held-out benefit can justify preferring it. These are product semantics to test, not universal statistical thresholds.

Do not let the learner weaken the independent checks used to approve itself. Preserve skipped/failed/unknown outcomes, environment assumptions, artifact references, exact revisions, and counterexamples. A completed task whose skill was never applied must not automatically credit that skill. A transient provider failure must not automatically condemn every skill in context.

Voyager and ExpeL show useful mechanisms for retaining procedures and contrasting experiences; ACE supports small, identifiable updates instead of whole-history rewrites. Their environments and evaluators differ from Autohand, so adopt the mechanisms with local validation. [Voyager](https://arxiv.org/abs/2305.16291), [ExpeL](https://ojs.aaai.org/index.php/AAAI/article/view/29936), [ACE v3](https://arxiv.org/html/2510.04618v3).

## New sessions and unfinished goals

Persist the skill library independently from the conversation. Restore a small goal brief containing approved intent, status, next step, checkpoint, selected revisions, and completed-check references. Retrieve details when the user continues that work.

Use owner/lease checks before another session takes over a goal, and recheck current workspace and authorization. An interrupted external action remains unknown until observed; replaying a checkpoint must not repeat its side effect or manufacture a successful learning event. Deduplicate post-task extraction by source run and candidate revision.

This separation resembles the distinction between thread checkpoints and cross-thread stores in LangGraph; it is a design pattern to reuse, not a recommendation to adopt that framework. Anthropic's long-running-agent work likewise emphasizes durable progress artifacts and actual end-to-end checks rather than relying on compaction alone. [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence), [long-running harnesses](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents).

## Weka: an enforceable provider boundary

The user's requirement is a runtime rule below every decision caller:

| Active configuration | Allowed decision route |
| --- | --- |
| Explicit Autohand AI Cloud, valid eligible account, optional background calls enabled | Local routing or optional bounded Weka request |
| Any other active provider, even with an Autohand login | Local routing or an explicitly configured model supported by the chosen provider; **zero Weka calls** |
| Other provider plus `AUTOHAND_TYPE_AHEAD_MODEL=weka` | Override cannot bypass eligibility; **zero Weka calls** |
| Signed out, invalid account, offline, or background calls disabled | Local route; **zero Weka calls** |

Apply this to typeahead, skill selection, learning decisions, and compaction. Recheck immediately before dispatch; cancel queued work and discard late answers when provider/account/consent state changes. Failed decisions must not silently switch to another cloud.

Use a shared decision-provider/model concept with feature-specific overrides. The proposed typeahead environment variable is a requested model choice, not an authorization mechanism. Weka should rank or classify bounded candidates; it does not need the whole registry or full conversation. Validate its structured answer before using it. [Public Weka API contract](https://docs.autohand.ai/models/weka/).

Public Weka documentation says it is not a CLI model, while this checkout uses its API internally for compaction. Preserve the distinction between internal decisions and a selectable main coding model; resolve documentation/implementation wording before release. This research did not test account entitlement or measure live Weka quality, speed, or cost.

## The benchmark that would demonstrate improvement

### Freeze the comparison

Pin skill-package manifests, main model, tools, repository snapshots, budgets, prompt cases, and decision settings. Split cases by workflow/repository/time before learning; prevent near-duplicate prompts or answer-bearing source traces from leaking into the held-out set.

Run matched conditions:

| Arm | Purpose |
| --- | --- |
| Current eager catalog | Existing behavior and startup baseline |
| Local retrieval, no remote reranking | Value/cost of the simplest proposed design |
| Local retrieval plus permitted model reranking | Additional value and total cost of decisions |
| Known relevant skill or none | Retrieval/routing headroom |
| Verified experience retained, fresh session | Learning and persistence value |

Use a matched memory-wiped condition for the last arm. Hold the main model and task budget constant. Optional embeddings and generated-skill creation can be separate ablations instead of silently changing several variables at once.

### Cover more than one coding example

Include greetings, unfamiliar rough ideas, research, data cleaning with new columns, test failures, repository migrations, documentation, and tasks needing no skill. Add explicit references, paraphrases, multilingual prompts, confusing neighbors, conflicting instructions, and legitimate multi-skill tasks.

Exercise registry discovery/download followed by offline local reuse; local derivatives; a successful task that did not use its loaded skill; failed/canceled/unknown outcomes; new sessions without the source transcript; moved paths and changed package revisions; goal restoration with two live sessions; and a provider switch while a decision is in flight.

### Measure different claims separately

- **Retrieval:** recall at bounded shortlist sizes, ranking quality, explicit-name recall, and misses by language/task family.
- **Routing:** correct loads, unnecessary loads, missed relevant skills, calibrated abstention, and user overrides.
- **Task utility:** acceptance-check pass rate, paired improvements/regressions, negative transfer, and cost per successful task.
- **Context/cost:** main plus decision tokens, startup and loaded-body size, cached reads/writes, duplicate/aborted requests, and unsent-draft traffic.
- **Interaction:** local preview and model-decision p50/p95, Enter latency, stale suggestions, and stale attachments.
- **Learning:** fresh-session transfer, duplicate-skill growth, evidence completeness, version invalidation, and performance against the memory-wiped control.
- **Policy:** Weka dispatch counts for every provider/account/setting combination, including queued retries and compaction.

Initial skill-related context should have a constant budget independent of library size; this is not a promise that the entire system/project prompt becomes a few hundred tokens. Quality thresholds and latency deadlines should follow the measured baseline. Wrong-provider Weka calls, false loaded receipts, and silent revision substitution should have a zero-tolerance target.

Report cold and warm runs, sample counts, paired regressions, and uncertainty. File creation, high source-task retry scores, a router's confidence, or one passing new-session example do not establish broad self-improvement.

## Elegant delivery order

1. **Bound startup context:** reuse built-ins and code mode; add local discovery, explicit IDs, one loader, and actual-load receipts.
2. **Make evidence meaningful:** separate activation/application/outcome, retain exact revisions, and test load/compaction/resume behavior.
3. **Add bounded learning:** stage one useful local change from verified work, preserve provenance, and prove later-task benefit.
4. **Add optional decisions where they help:** benchmark Weka only within the strict provider boundary and compare it with the local route.
5. **Add remote protocol adapters when needed:** pin the Beta MCP skills revision; keep local/library behavior usable without it.

## Open questions and limits

- How much startup policy outside the catalog can be reduced without losing required behavior? The earlier greeting audit leaves that separate from skill retrieval.
- Which natural task families and user corrections should define Autohand's evaluation set? Published task mixes cannot substitute for them.
- Should model-based previews be opt-in while typing, or used only after submission? Sending unsubmitted drafts is a distinct product choice.
- Which evidence scopes are useful for non-code skills where deterministic tests are incomplete? Human-attested and judge-only results should remain labeled.
- How should an unavailable pinned revision be repaired during goal restoration? The design should preserve continuity without silently changing procedure.
- No proposed implementation was run, no before/after improvement was measured, and no public claim here establishes Weka's performance in Autohand.

## Detailed research notes

- [Standards, source authority, identity, lifecycle, and MCP maturity](standards.md).
- [Ten primary learning papers, author-code checks, verification limits, and transfer design](learning.md).
- [Routing/typeahead source, Weka policy, benchmark versions, and evaluation contract](routing-evaluation.md).

The detailed notes include source dates/status and pinned implementation references. Recommendations in this report are an engineering synthesis, clearly separate from published results and current local behavior.
