# Skill routing, typeahead, and evaluation research

Research snapshot: 2026-11-02. Research only; no application changes or paid inference calls. Recommendations and suggested budgets below are proposals, not Autohand measurements.

## Recommendation

Build a local metadata index and a bounded candidate shortlist first. Make model reranking an optional decision step, preserve an explicit “none applies” result, and load the selected skill through the existing canonical loader. Keep typeahead suggestions separate from durable records of instructions actually attached to a turn. Evaluate successful task completion alongside routing accuracy: a relevant-looking skill can still make the agent worse.

The provider boundary is a hard runtime invariant supplied by the user: **Weka may run only when the active provider is explicit first-party Autohand AI Cloud, the account is valid, and background calls are enabled.** An Autohand login, an API key, a model environment variable, or a mutable provider display label never makes another active provider eligible. This applies equally to typeahead, submit-time selection, learning, and compaction. Otherwise use local ranking, or a non-Weka decision model explicitly configured on the user's chosen provider. `AUTOHAND_TYPE_AHEAD_MODEL=weka` is a proposed setting, not evidence of an existing wired feature.

## Eight primary sources and their limits

| Source | Date/status checked | Useful evidence and limit |
| --- | --- | --- |
| [Daniel Avila's Jev skill-suggestion source](https://github.com/davila7/claude-code-templates/tree/55457cfcc76eebeb9f8ad7018573be1f89c1fef0/cli-tool/components/mods/productivity/jev-skill-suggestion) | Path last changed 2026-10-04; source and README inspected | Submit-time ranking, a second shortlist check, injection, repeat-load handling, and logs. Its README cites an older 182-skill evaluation; do not combine it with the current cookbook run. |
| [Avila's Jev typeahead source](https://github.com/davila7/claude-code-templates/tree/bb03764ed7374da0ea3917615b0fbdb53aabbb8f/cli-tool/components/mods/productivity/jev-skill-typeahead) | Path last changed 2026-10-08; source inspected | Local IDF-weighted matching, a default 600 ms pause, one optional decision request, and draft sequence checks. This is a preview implementation, not evidence that its selected skill will be loaded. |
| [TypeSafe skill-suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion) | Published run rendered 2026-10-30 | Reproducible cached experiment using Jev 1.14.0 and Haiku 4.5; current roster is 194 skills. Full roster stays in the agent's prompt during this experiment. It does **not** measure removal of that roster. |
| [TypeSafe confidence documentation](https://docs.typesafe.ai/confidence) | Undated live documentation, accessed 2026-11-02 | Choice confidence is derived from the option distribution; Noul has no separate confidence field. Thresholds require application-specific validation. This does not establish Weka calibration. |
| [Weka 1.0 public documentation](https://docs.autohand.ai/models/weka/) | Public Preview; undated, accessed 2026-11-02 | `POST /v1/decisions`, model `weka`, JSON state and typed questions/answers; Pro and above; shared account allowance. Its statement that CLI cannot run Weka differs from the locally observed compaction integration reported by the parent investigation. |
| [SkillsBench, arXiv v4](https://arxiv.org/abs/2602.12670v4) | Revised 2026-06-14 | 87 tasks, 8 domains, 18 model/harness configurations, paired deterministic verification. Measures the effect of supplied curated skills, not open-world skill retrieval or Weka routing. |
| [SWE-Skills-Bench, arXiv v2](https://arxiv.org/abs/2603.15401v2) | Revised 2026-10-27 | 98 public SWE skills and 3,920 paired evaluations. Especially relevant to requiring outcome evidence before treating a previously selected skill as useful. Earlier search snippets describe its obsolete v1. |
| [Anthropic prompt-caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) | Undated live documentation, accessed 2026-11-02 | Cache prefixes follow tools → system → messages; stable-prefix placement and actual read/write usage are measurable. This is one provider's contract, not a universal cache guarantee. |

The two author writeups identify the intended design and dates: [skill suggestion, 2026-09-22](https://medium.com/@dan.avila7/jev-skill-suggestion-keeps-your-claude-code-skills-out-of-context-until-one-is-needed-9b6be5bb9141) and [typeahead, 2026-10-09](https://medium.com/@dan.avila7/jev-skill-typeahead-shows-which-skill-claude-code-will-call-before-you-hit-enter-ca43feb0fe36). Their public pages are partially paywalled; the author's public source above supplies the implementation evidence. No claim depends on the inaccessible X post.

## What is measured

TypeSafe's current experiment has 452 single-turn prompts: 280 have one covering skill and 172 have none. The covered prompts were generated from skill text, so they are easier than natural user traffic. Wrong loads fall from **15.7% to 7.9%**, and needless loads from **14.0% to 5.2%**; 29 covered cases improve and 7 regress. A missing load counts as a wrong load on covered prompts. These are first-load selection results for a particular Jev/Haiku/Hermes configuration, not task completion or Autohand token savings. [Current cookbook and cached-run methodology](https://docs.typesafe.ai/cookbooks/skill_suggestion).

SkillsBench v4 reports average pass rate **33.9% → 50.5%**, with configuration gains from 4.1 to 25.7 percentage points. In contrast, SWE-Skills-Bench v2 finds **92/98 skills have no statistically significant effect**, with average pass ratio **76.6% → 76.9%**; harmful skills can override explicit requirements. These studies differ in tasks, skills, and harnesses, so their aggregates should not be combined. They justify paired local evaluation, not an expected Autohand uplift. [SkillsBench v4](https://arxiv.org/abs/2602.12670v4), [SWE-Skills-Bench v2](https://arxiv.org/abs/2603.15401v2).

No Weka routing accuracy, latency distribution, cost per routing decision, or end-to-end Autohand benefit was measured here. A Jev blog latency, a cookbook example timing, or a Weka general-decision leaderboard score cannot establish those values.

## Proposed routing contract

1. **Index metadata locally.** Store stable skill identity, origin/scope, name, full description, triggers, explicit exclusions, supported formats, enablement, body hash, and index version. Do not put every body into the main prompt. Build candidates from the complete enabled inventory: a skill omitted from the model's prompt must remain locally discoverable. Explicitly named skills and user exclusions take precedence over ranking.
2. **Retrieve cheaply, then bound.** Start with exact-name and lexical matching; test semantic retrieval as an additional local channel only if it improves held-out paraphrase and multilingual recall. Merge ranked channels, deduplicate stable identities, and cap metadata candidates, initially testing `k ∈ {5, 10, 20}`. Do not compare unrelated raw lexical and embedding scores as if they were probabilities. Treat optional embeddings as an ablation, not a prerequisite or a new network call on each edit.
3. **Decide only when useful and permitted.** For ambiguous candidates, optionally rerank the top 3–5 using full descriptions and small excerpts. Ask separately which candidate fits and whether the selected candidate covers the actual request; allow none. A relative winner exists even when every option is wrong. Validate the winner's own absolute fit, not merely the largest fit belonging to any candidate. The cookbook's structure is evidence for this decomposition; its numeric thresholds are not Autohand defaults. [TypeSafe selection and independent-fit checks](https://docs.typesafe.ai/cookbooks/skill_suggestion).
4. **Load through one authoritative path.** Revalidate enablement, scope, version, permissions, and body identity at load time. Emit “loaded” only after the content was successfully read and attached. Preserve the loader's policy semantics: Avila's direct-injection README explicitly notes that this bypass does not apply the original Skill tool's `allowed-tools`. Use that as a compatibility test case, not a behavior to copy. [Avila's loader and limitations](https://github.com/davila7/claude-code-templates/blob/55457cfcc76eebeb9f8ad7018573be1f89c1fef0/cli-tool/components/mods/productivity/jev-skill-suggestion/README.md).

Normally select one task skill, but keep explicit multi-skill requests and mandatory project instructions intact. Do not turn a top-one optimization into a hard prohibition on legitimate task composition.

Choice confidence describes concentration relative to the offered set; it is not itself the empirically observed probability of a correct skill load. Changing shortlist size changes its interpretation. Calibrate binary relevance and no-skill decisions on held-out Autohand cases, examine reliability buckets/Brier score, and report the risk-versus-coverage curve before choosing operating thresholds. [TypeSafe's distribution-derived confidence definition](https://docs.typesafe.ai/confidence).

## Deterministic provider enforcement

Place the provider policy at the shared decision dispatch boundary, below every caller. Determine eligibility from canonical provider identity and current session/account settings, then recheck immediately before dispatch. Weka request construction, retries, and any queued/debounced callbacks must use this boundary. A denied route returns a typed local fallback reason; it must not silently select another cloud.

Use a policy epoch in the request identity. Changing provider, account, background-call consent, workspace, or relevant privacy controls cancels pending work and invalidates completed previews. A late response cannot update UI, become a learning example, or attach instructions after an epoch change. An environment override changes a requested model only within the allowed policy; it cannot override provider eligibility.

| Current state | Permitted Weka requests |
| --- | --- |
| Explicit Autohand AI Cloud + valid eligible account + background enabled | Optional bounded decision, within budget |
| Another active provider + Autohand account still signed in | **Zero**, including compaction and learning |
| Another provider + `AUTOHAND_TYPE_AHEAD_MODEL=weka` | **Zero**; local/configured chosen-provider fallback |
| Cloud provider + signed out, invalid account, or background disabled | **Zero** |
| Provider/account/consent changes while a request is queued | Cancel; recheck before any dispatch |

Weka's public API returns typed objects and usage, and instructs clients to reject missing questions, unknown answer types, and unoffered choices. Add finite-range checks for probabilities/confidence, validate returned model identity, and avoid retrying a quota denial on every keystroke. These client policies supplement server authorization; they do not replace it. [Weka contract and operational guidance](https://docs.autohand.ai/models/weka/).

## Typeahead, receipts, and reuse

Display clear states such as `local match`, `checking`, `model suggestion`, and `decision unavailable`. Avoid “will load” before a real load. In Avila's source, each edit increments a sequence, clears the decision, and late completions check that sequence; submission additionally compares the exact draft. It sends up to 250 candidates, so it is not already the proposed bounded-shortlist design. [Draft and completion checks](https://github.com/davila7/claude-code-templates/blob/bb03764ed7374da0ea3917615b0fbdb53aabbb8f/cli-tool/components/mods/productivity/jev-skill-typeahead/hooks/register.tsx#L250).

For Autohand, bind a preview to draft revision, expanded submitted content, candidate/index version, provider policy epoch, and skill hash. Invalidate on every change, including paste expansion, selection replacement, Ctrl+C, submit, clear, resume, and compaction. Cancel the underlying request where supported; ignoring a stale result alone does not stop its cost. Enter must remain responsive without waiting for a preview.

Proposed user controls: preview off/local/model; background-call consent and spend limits; per-turn pin/dismiss; per-skill never-auto-load; separate learning enable/delete controls. Explain the backend and what leaves the machine before enabling draft transmission. Manual skill invocation remains available. Preferences affect ranking and dispatch policy, not the truth of loaded receipts.

A durable receipt should distinguish `suggested`, `selected`, `loaded`, `load failed`, and `outcome verified`. Record session/turn, stable skill ID and hash, selection origin (explicit/local/model/reused), policy/model version, load time, attachment identifier, and verification evidence. Keep raw drafts out of routine receipt logs. After resume or compaction, display historical loads accurately; “loaded previously” is not proof that the current model context contains the body.

Reuse successful experience in new sessions as a bounded ranking hint, scoped to the user's chosen project/account boundary and current skill version. Promote only from verified outcomes, preserve provenance and negative outcomes, and let users disable learning or remove a learned association. Never label a suggestion successful merely because the model selected it. Test held-out new sessions; retain an unlearned control arm. Reuse must not trigger Weka under another active provider.

## Before/after evaluation contract

Freeze skill manifests, hashes, prompts, provider/model, question schema, harness, and random seeds. Split by intent/repository/time so near-duplicate prompts and learned associations cannot cross into the test set. Include natural prompts, paraphrases, non-English requests, explicit names, no-skill cases, misleading neighbors, and multi-skill requests. Use synthetic prompts only as a labeled supplement.

Compare five arms on the same tasks: current behavior; local shortlist only; local shortlist plus permitted model reranking; oracle relevant skill/none; and reranking plus verified reuse in a fresh session. Optional semantic retrieval is a separate local-retrieval ablation. Keep the main execution model fixed across arms. Use deterministic task verifiers where possible and report paired regressions with confidence intervals.

| Dimension | Required measurements |
| --- | --- |
| Retrieval | Recall@5/10/20, MRR; explicit-name recall; recall by language and confusing skill pair |
| Routing | Correct first load; relevant-skill misses; unnecessary load rate on no-skill prompts; load precision; multi-skill coverage; risk/coverage and calibration |
| End outcome | Acceptance-test pass rate, paired improvement/regression counts, tool steps, verified user corrections; success per dollar |
| Preview | Exact final-draft suggestion accuracy; stale UI/attachment rate; local edit-to-render p50/p95; pause-to-decision p50/p95; Enter latency |
| Cost | Decisions per edit/pause/submit, aborted and duplicate calls, all router/main-model tokens, cached reads/writes, quota use, cost per completed successful task |
| Transfer | Fresh-session success/precision; changed-repository and changed-version failures; negative-transfer rate versus unlearned control |
| Runtime policy | Weka transport invocation count under every provider/account/consent combination; late-response drops; timer/listener counts after disposal |

Suggested initial engineering budgets, explicitly **unmeasured**: local preview p95 ≤100 ms on 1,000 skills; zero added submit wait for preview; test 600 ms debounce with one in-flight background decision; evaluate a 900 ms decision deadline rather than assuming Weka meets it. Publish cold and warm runs separately. Set quality/cost release thresholds after measuring the baseline; provider-policy and stale-attachment violations must remain zero.

Keep tools and stable system instructions byte-stable, with changing routing advice/loaded bodies after the stable prefix where the provider's request contract permits. Report actual usage, not a `/context` estimate. For Anthropic, total input is `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`; cost weights those classes differently. Use each provider's real usage fields and prices, and include typeahead traffic even when no draft is submitted. [Prompt structure and token accounting](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

## Required adversarial scenarios

- Cloud decision queued, then switch to another provider before debounce fires: no Weka dispatch. Switch after dispatch: cancel and discard; no attachment or learned success.
- Another provider remains active with a valid Autohand login and a Weka environment override: zero Weka calls in typeahead, selection, learning, and compaction.
- A slow old answer arrives after a newer draft, paste expansion, workspace change, or Ctrl+C: no stale mark or attachment; no leaked request timer/listener.
- Skill descriptions overlap, but only one supports editing an existing artifact; no installed skill supports the requested service; prose asks about a domain without requesting its workflow: separate recall, disambiguation, and abstention failures.
- Skill file changes/disappears or is disabled between preview and load: invalidate the decision and report the real load result.
- A malicious skill description asks the router to ignore policy or select itself: descriptions remain untrusted data; responses can only select validated eligible IDs.
- The main model disregards a correct suggestion, or a wrong suggestion pulls it away from a correct baseline: receipts and evaluation distinguish recommendation from load and task outcome.
- A previously useful skill changes version or conflicts with new repository requirements: stale learned hints cannot force a load; negative transfer is visible.

No public benchmark above establishes Autohand routing quality or Weka speed. The next useful evidence is a pinned local replay with fake decision clients, followed by a separately authorized live experiment under the required active-provider policy.
