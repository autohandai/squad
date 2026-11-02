# Adaptive skills: evaluation and release contract

Status: **Proposed; no experiment run** · 2 November 2026

This contract evaluates the [design](2026-11-02-adaptive-skills-design.md). It separates context reduction, selection correctness, task success, learned transfer, and recovery. Passing one does not establish the others. Published benchmark numbers are background evidence, not Autohand results.

## Freeze before measuring

Record repository commits, package manifests and complete resource digests, catalog sizes, scope/ACL fixtures, main and decision model versions, provider route, sampling settings, tool schemas, harness version, budgets, tokenizer, machine, and network conditions. Preserve exact request captures with fixture data or explicit redaction. Credentials and real private conversations must not enter evaluation artifacts.

Split by workflow, repository, and time **before** generating learned candidates. Keep a calibration/pilot partition separate from the scored hold-out partition. Determine sample size from pilot variance and the agreed quality margin; do not choose the margin after seeing scored results. Randomize paired condition order and repeat stochastic cases. Judge observable task acceptance independently of the learner, and blind human adjudication to the condition where practical.

For each scored case retain the prompt, expected applicable skills or explicit no-skill outcome, allowed scope, task checks, artifact references, exact package revisions, request/receipt trace, and all model/tool costs. Mark unsupported adapter attestations unknown rather than failed cognition or proven loading.

## Conditions

| Arm | What it isolates |
| --- | --- |
| A: current eager roster | Frozen current implementation, including current tools and prompt behavior. |
| B: local retrieval | Proposed discovery and canonical loader; no decision model or learned additions. |
| C: assisted retrieval | Same as B, adding only the eligible decision model. Report Weka and each alternative separately. |
| D: oracle selection | Human-labeled applicable skill supplied through the same loader. Diagnoses retrieval misses versus an unhelpful skill. It is not a deployable result. |
| E: verified reuse | B or C with a frozen learned revision library, applied to fresh held-out tasks in new sessions. |
| F: reset control | Same new-session tasks and budgets as E, with learned additions absent and task-specific transcript/memory hints cleared. |

Where useful, add a supplied-but-irrelevant skill control to measure distraction. Do not conflate E's gain over its training retries with transfer over F. Compare B with A before deciding whether C is worth its latency, money, and privacy tradeoffs.

## Corpus

- **Opening interaction:** greetings, ordinary conversation, ambiguous requests, explicit skill invocation/exclusion, and a task with no relevant skill. Test empty and populated memory separately.
- **Discovery:** built-ins, registry/local derivatives, synonyms, multilingual phrasing, misleading metadata, same-name packages, incompatible skills, and authorized versus unauthorized copies. Use catalogs of 0, 14, 100, 1,000, and 10,000 entries; exact invocation must remain independent of top-K.
- **Completed work:** debugging, research, browser operation, data transformation, and repository workflows across multiple repositories/environments. Include tasks where the correct action is to abstain from skill use.
- **Learning:** repeated workflow families with different inputs, counterexamples, skill corrections, an over-specific source task, no-op actions, misleading clean exits, and negative-transfer tasks outside the learned scope.
- **Recovery:** process death at every publication/checkpoint boundary, provider changes while decisions are queued/in flight, workspace relocation, unavailable pinned revisions, user edits racing learning, stale ACLs, and live goals owned by another worker.

Use a small deterministic contract suite on every change. Run costly end-to-end comparisons only after it passes, within separately approved inference budgets. Start with a pilot, then lock the powered scored set. Do not claim a statistically supported quality result from a handful of demo tasks.

## Measurements

| Dimension | Required observation |
| --- | --- |
| Startup context | Provider input tokens when available; pinned-tokenizer estimate otherwise, labeled as estimated. Record skill text, rest of messages, and native tool schemas separately. Character counts remain a separate metric. |
| Prompt caching | Stable prefix/schema hashes, provider-reported cache reads/writes, uncached tokens, and cache locality across `/goal`, `/goals`, `/deep-research`, `/autoresearch`, and ordinary turns. Cache savings do not erase context occupancy. |
| Selection | Recall@K, wrong-load and needless-load rates, explicit-invocation success, abstention accuracy, conflicts, and missed relevant skills. Report denominators and scope-specific slices. |
| Task quality | Independent acceptance pass rate, regressions, wrong actions, and human intervention. Report paired differences with confidence intervals, not only an average score. |
| Learning | Draft yield, verification false positives, fresh-task benefit, negative transfer, unused-skill rate, revision churn, rollback, and evidence completeness. |
| Latency | Opening response, local lookup p50/p95, preview update, submit-to-dispatch, total task time, and all background work. Enter must not await preview completion. |
| Resource cost | Main, selector, learner, verifier and retry tokens/cost; local CPU/storage/indexing; all failed/stale work. Report per successful task as well as per attempt. |
| Continuity | Correct paused state, intent/checkpoint fidelity, pin resolution, duplicate ownership/actions, lost work, and cleanup of canceled jobs. |
| Receipt truth | Requested versus prepared versus actually submitted content; adapter attestation strength; current versus historical manifest; duplicate or fabricated receipts. |

## Hard gates and provisional performance targets

The following safety/correctness gates are mandatory in every scored configuration:

1. **Zero wrong-provider Weka calls**, including typeahead, selection, learning, compaction, retries, stale member settings, environment overrides, and fallback execution engines. Observe the dispatch transport, not just a mocked selector.
2. **Zero unauthorized discovery/attachment**, and no private content in public/team derivatives. Apply ACL filtering before ranking and recheck at attachment.
3. **Zero false confirmed-loading receipts** in the instrumented suite. External engines that cannot attest report supplied/unknown.
4. **Zero duplicated publication or external side effects** under crash/race injections; unknown effects require observation before retry.
5. **Zero goal ownership theft or automatic post-crash execution**. Recovered goals remain paused under existing semantics.
6. Explicit compatible skill invocation succeeds for every catalog-size fixture; full required content and referenced revision are preserved. No hidden truncation to meet the prompt budget.
7. All preexisting learning, sharing, background-call and permission preferences survive migration. No new cloud enrollment or inference opt-in is inferred from login.

Proposed initial targets, to be frozen or revised from the unscored pilot before the main experiment:

- At most **512 skill-related startup tokens**, independent of catalog size; greetings load no skill and initiate no learning/model-preview job under defaults.
- Local lookup **p95 at most 200 ms** on the recorded reference machine with 10,000 entries. Report cold indexing separately from warm lookup.
- Paired task-success non-inferiority margin **2 percentage points**, evaluated with a predeclared one-sided 95% confidence interval. A larger loss in any critical workflow blocks release even if the aggregate passes.
- Assisted selection must improve a predeclared selection or task-quality endpoint without breaching the approved latency/cost envelope. Lower selector error alone does not establish higher task success.
- A learned revision becomes preferred only with positive held-out evidence within its declared scope and no unacceptable negative transfer. Define the minimum evidence and effect threshold before scoring that candidate family.

If affordable sample sizes cannot establish the quality margin, report the result as inconclusive and retain a narrower rollout or manual mode. Do not call an absence of significance proof of equivalence.

## Traceability

| Design requirement | Minimum proof |
| --- | --- |
| S1/S4: startup and schema stability | Paired request captures across catalog sizes and workflow commands; tokenizer and schema/prefix hashes. |
| S2/S3: discovery and complete loading | Exact/ambiguous/no-match corpus; same-name origins; digest/resource mutation; oversize instructions and dependency cycles. |
| S5: honest evidence | Read-only file access without dispatch, dispatch rejection, supported/unsupported engine acknowledgment, compaction removal, and replayed history. |
| S6: provider boundary | Intercepted Weka transport matrix with provider/account/consent/epoch changes before every retry and dispatch. |
| S7: library continuity | Fresh process/new session with retained library; moved directory; offline registry; missing revision; immutable member snapshot. |
| S8: goal continuity | Kill/restart at checkpoints, competing owner, changed permissions, unknown external action, and explicit resume. |
| S9: privacy | Authorization changes during search/attachment, member isolation, derivative scope checks, deletion/tombstones, and no implicit teaching. |
| S10: evidence-scoped learning | No-op rejection, immutable independent checks, candidate edit invalidation, held-out reuse/reset pairs, CAS conflict and publication crash recovery. |

## Release evidence

Each phase reports implementation commit, exact feature settings, focused/unit/PTY/browser/native coverage as applicable, benchmark sample sizes and uncertainty, costs, failures/skips, adapter limitations, and rollback proof. Keep local fixtures, live-provider proof, and deployed behavior distinct.

No benchmark runs, paid calls, product changes, or release claims are part of this design package. The existing greeting capture is a baseline diagnostic only.
