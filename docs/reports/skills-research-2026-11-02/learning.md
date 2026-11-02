# Learning reusable skills from experience

Research snapshot: 2 November 2026. Research only; no implementation or paid inference. Papers and author-owned source were inspected; published experiments were not reproduced. Recommendations below are design proposals, not demonstrated Autohand results.

The strongest practical design is a small discovery interface backed by a persistent skill catalog, immutable versions, and an evidence ledger. Extract candidates from completed work, prefer adapting an existing skill, and require fresh-task evidence before treating a learned skill as an improvement. A successful activation, successful execution, successful user outcome, and useful causal contribution are four different observations.

## Ten primary research sources

### 1. Voyager — executable skills and transfer to a fresh environment

First submitted 25 May 2023; inspected arXiv v2, 19 October 2023. Treat as an arXiv research paper here; the primary OpenReview venue page was inaccessible during this review, so no main-conference status is claimed. [Paper and history](https://arxiv.org/abs/2305.16291).

Voyager stores successful Minecraft programs, indexes descriptions, retrieves a small set, and composes existing programs into new behavior. Its transfer experiment clears inventory and creates a new world; the four unseen objectives receive three trials each. This is useful transfer evidence within Minecraft, not evidence of broad CLI competence. [Method and evaluation, §§2.2–3.3](https://arxiv.org/html/2305.16291v2).

The implementation adds a skill only after its success flag is true, persists the catalog/vector index, and keeps numbered code revisions when a function name recurs. However, automatic success comes from an LLM critic reading environment observations; it is not an independent oracle. [Execution gate](https://github.com/MineDojo/Voyager/blob/main/voyager/voyager.py), [critic](https://github.com/MineDojo/Voyager/blob/main/voyager/agents/critic.py), [persistence and revisions](https://github.com/MineDojo/Voyager/blob/main/voyager/agents/skill.py).

### 2. Reflexion — failure feedback helps retries, but evaluator errors matter

First submitted 20 March 2023; published at NeurIPS 2023. Reflexion converts task feedback into textual reflections carried into subsequent attempts, without updating the underlying LLM. Its primary value here is the distinction between improving another attempt at the same task and learning a reusable skill for unrelated future tasks. [Conference paper](https://papers.nips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html).

The coding study explicitly measures incorrect internal tests: false positives can prematurely accept wrong programs, and false negatives can cause harmful edits. A self-reflection ablation without test generation underperformed the baseline on its hardest-50 HumanEval Rust subset. Thus, reflection needs grounded feedback; a fluent retrospective is not a verification method. The memory studied is bounded, and retries are part of the evaluation procedure. [Paper, §4 and limitations](https://papers.nips.cc/paper_files/paper/2023/file/1b44b878bb782e6954cd888628510e90-Paper-Conference.pdf), [author code and logs](https://github.com/noahshinn/reflexion).

### 3. ExpeL — extract cross-task rules from successful and failed experiences

First submitted 20 August 2023; AAAI 2024; inspected arXiv v3, 20 December 2024. ExpeL gathers training trajectories using retries, contrasts failed/successful attempts, and extracts natural-language insights. At evaluation, unseen tasks receive retrieved successful examples and learned insights with one attempt. The tested families include HotpotQA, ALFWorld and WebShop, with a separate transfer study; this is stronger evidence for inter-task learning than retry-only improvement. [Paper, §§4–5](https://arxiv.org/html/2308.10144), [AAAI proceedings](https://ojs.aaai.org/index.php/AAAI/article/view/29936).

Its author implementation has ADD, EDIT, AGREE and REMOVE operations, rule counters, and duplicate filtering. Those counters reflect extraction/curation operations, not independently measured causal utility. Reuse the idea of controlled edits and contrasting outcomes, not the assumption that repeated model agreement establishes truth. [Rule updates](https://github.com/LeapLabTHU/ExpeL/blob/main/agent/expel.py), [separate training folds](https://github.com/LeapLabTHU/ExpeL/blob/main/insight_extraction.py).

### 4. A-MEM — organize related memories without proving procedural learning

First submitted 17 February 2025; NeurIPS 2025; inspected arXiv v11, 8 October 2025. A-MEM turns experiences into structured notes with contextual descriptions, keywords, tags and links, and can update related notes as new memories arrive. Its primary evaluations are long-conversation question answering on LoCoMo and DialSim, including cross-session factual retrieval. This supports structured memory organization, not automatic verification of executable procedures. [Conference status](https://papers.nips.cc/paper_files/paper/2025/hash/19909c36f51abc4856b4560aff3d36d6-Abstract-Conference.html), [paper, §§3–4](https://arxiv.org/html/2502.12110v11).

The paper acknowledges dependence on the underlying model’s descriptions and links. For Autohand, explicit provenance and a few related-skill links are useful; an autonomous mutable graph is not a prerequisite for learning a shell or repository workflow. [Limitations, §6](https://arxiv.org/html/2502.12110v11#S6), [author system](https://github.com/agiresearch/A-mem).

### 5. Memento — retain labeled cases and separate retrieval-policy training

First submitted 22 August 2025; inspected v2, 25 August 2025; arXiv preprint status verified, no conference acceptance established here. Version 1 used the title AgentFly; cite Memento v2 to avoid name/version confusion. [History](https://arxiv.org/abs/2508.16153).

The planner retrieves prior task/plan/reward cases. The non-parametric variant appends successes and failures and retrieves by similarity; the parametric variant additionally trains a small case-selection Q-function. Therefore, “no LLM fine-tuning” does not mean no trained component. Evaluations include GAIA, DeepResearcher and out-of-distribution tasks, using a planner/executor/tool stack. Such system results do not isolate the value of skill-file creation alone. [Paper, §§4.1–5.5](https://arxiv.org/html/2508.16153v2), [author repository](https://github.com/Memento-Teams/Memento).

Useful lesson: preserve the outcome and environment along with the recipe; negative cases can be retrieval constraints instead of prescriptive instructions.

### 6. ACE — itemized deltas preserve knowledge better than whole-file rewrites

First submitted 6 October 2025; accepted at ICLR 2026; inspected v3, 29 March 2026. ACE separates generation, reflection and curation; stable bullet IDs receive localized updates instead of replacing the whole accumulated context. The paper evaluates offline train/test adaptation and sequential online adaptation, including execution-feedback variants, and studies noisy/harmful feedback. Those protocols must remain distinct when reporting learning gains. [Current paper and protocols](https://arxiv.org/html/2510.04618v3), [authors’ acceptance announcement](https://ace-agent.github.io/blogs/2026-01-30-iclr-acceptance/).

Helpful/harmful counters are model tags. The inspected base mutation function implements ADD and lists several other operations as future work; the repository separately exposes an optional deduplication analyzer. Do not equate conceptual grow-and-refine with every operation being universally implemented. [Mutation code](https://github.com/ace-agent/ace/blob/main/playbook_utils.py), [configuration](https://github.com/ace-agent/ace).

Adopt localized, reviewable changes while keeping full details outside startup context; ACE does not establish that every agent should load an entire playbook.

### 7. SkillWeaver — practice reusable APIs, but “no exception” is insufficient

Submitted 9 April 2025; verified arXiv preprint, no conference status established here. SkillWeaver explores websites, synthesizes APIs from successful trajectories, and practices/debugs them. APIs document prerequisite state and execution history. Experiments cover WebArena and four live websites; libraries are built separately per environment, so transfer claims should retain that scope. [Paper, §§2–3](https://arxiv.org/html/2504.07079v1).

Its own failure analysis is particularly valuable: APIs could become “verified” merely by avoiding exceptions, including by skipping the intended actions. Generated test inputs also failed when real website data was required. [Appendix D.2](https://arxiv.org/html/2504.07079v1#A4.SS2).

The code resets a function’s test count when its implementation changes and records test references/version events; its success checker separately asks an LLM to judge a trace and screenshot. Preserve version-specific evidence, but require observable postconditions rather than adopting exception-free execution as correctness. [Version/test metadata](https://github.com/OSU-NLP-Group/SkillWeaver/blob/main/skillweaver/knowledge_base/knowledge_base.py), [success checker](https://github.com/OSU-NLP-Group/SkillWeaver/blob/main/skillweaver/knowledge_base/check_success.py).

### 8. Memento-Skills — direct skill-file evolution with important transfer limits

Submitted 19 March 2026; inspected v1; arXiv preprint. It combines structured Markdown skills, retrieval, execution, targeted rewriting and test gates. The reported GAIA study splits its 165 validation questions into 100 training and 65 held-out questions; HLE uses 788 training and 342 held-out questions. All experiments use Gemini-3.1-Flash. Iterative training gains are separate from held-out scores; the authors explicitly report that many GAIA skills never trigger on held-out questions. [Paper, §3.1](https://arxiv.org/pdf/2603.18743).

The current public runtime stages copies, checks structure/unit tests, optionally runs a synthetic execution judged by an LLM, then deploys with a backup. Missing local tests are recorded as skipped/passed. These are useful transaction mechanics, not independent proof of generality or absence of regressions. Paper and current runtime configurations differ and should not be conflated. [Evolution engine](https://github.com/Memento-Teams/Memento-Skills/blob/main/core/skill/evolution/engine.py), [rewrite/judge prompts](https://github.com/Memento-Teams/Memento-Skills/blob/main/core/skill/evolution/prompts.py).

### 9. SkillsBench — measure benefit, not the number of skills written

First submitted 13 February 2026; inspected v4, 14 June 2026; arXiv preprint. The current paper inventory is 87 tasks across eight domains with deterministic verifiers and matched skill/no-skill runs. Older summaries describe the different v1 inventory; do not combine their figures. [Current paper, §§3–5](https://arxiv.org/html/2602.12670v4), [release explanation](https://www.skillsbench.ai/blogs/skillsbench-1-1).

The self-generated condition uses a creator session followed by a fresh solver session. On three evaluated dedicated-harness configurations it underperforms the no-skill baseline, but the authors identify confounds including non-discovery, creator/solver interference and task-state leakage. This is not a test of learning only from verified prior successes. It does establish that creating a convincing skill pack is not itself evidence of useful learning. [Protocol and trajectory audit, Appendix D.6](https://arxiv.org/html/2602.12670v4#A4.SS6), [author benchmark](https://github.com/benchflow-ai/skillsbench).

### 10. Skill-Usage — realistic retrieval and adaptation erode idealized gains

Submitted 6 April 2026; inspected v1; arXiv preprint. The study collects 34,198 skills after license/format filtering and content deduplication. It evaluates forced curated loading, autonomous selection, distractors, retrieval with curated skills, and retrieval without curated skills on 84 SkillsBench tasks, three runs each, across three model/harness pairs. Gains weaken as selection, retrieval and compatibility become harder. Query-specific refinement helps when initial skill quality/relevance is reasonable. [Paper, §§3–4](https://arxiv.org/html/2604.04323v1), [author code](https://github.com/UCSB-NLP-Chang/Skill-Usage).

Its curated-skill Recall@k is not a complete utility metric: a different skill can still work, and a retrieved skill can still be harmful. The study evaluates retrieval/refinement rather than verified experiential learning, and uses an older SkillsBench subset. Use it to stress-test discovery and scope matching, not as proof of cross-session learning.

## Minimal architecture proposal

This is an engineering synthesis, not a claim that the papers prove this exact architecture.

Use three existing-runtime responsibilities rather than a new autonomous agent hierarchy:

1. A catalog searches installed project and personal skills, then allowed registries. Startup includes only the discovery contract and small metadata required for the current task. On selection, a canonical loader reads the complete relevant instructions and referenced resources as needed; a generated summary must not silently replace their constraints. Rank only after filtering scope, platform, tool versions and permissions; allow an explicit “no suitable skill” result.
2. An outcome recorder appends immutable evidence events for the current task and the exact skill revisions involved. A rebuildable index provides search and statistics; files and evidence remain authoritative.
3. A bounded post-task learner proposes one useful change from the completed evidence bundle: add an example/counterexample, revise an existing local skill, derive a scoped variant, or create a new skill when there is a capability gap. The proposal is staged and checked before it can replace an active revision. A learning failure must not change the already completed task’s result.

Do not begin with a trained router, automatic global memory graph, or several always-running reflective agents. Add them only after simple retrieval and controlled revision show measurable bottlenecks.

### Record activation, application, outcome and benefit separately

The parent’s repository audit identified activation events currently labeled succeeded and later counted as successful learned capabilities. This research did not independently re-read that seam; the parent owns the code citation. Correcting that meaning is necessary before building promotion on those counts.

| Observation | What it can establish | What it cannot establish |
|---|---|---|
| Activated | A named, versioned skill loaded successfully | The agent followed it or solved the task |
| Used | A trace/action cites or executes part of the skill | Its advice was correct or necessary |
| Task outcome | The user’s acceptance checks passed/failed/are unknown | Every loaded skill helped |
| Benefit | Paired or held-out comparisons improve success/cost | Universal usefulness in another environment |

Keep all four as separate event types, not one success counter. A model may propose attribution with trace pointers and uncertainty. Promotion must use the verifier’s outcome; causal credit remains unknown without a comparison. Do not penalize every loaded skill for an unrelated provider failure or reward every skill because a strong model solved the task anyway.

An evidence bundle should hold task family, source run/session, exact skill digest, applicability context, baseline/revision identity, observable checks and their outputs/artifact hashes, failures/corrections, costs, and verification scope. Distinguish static checks, local execution, integration, rendered terminal behavior, and live-provider evidence. Do not store credentials or a transcript as the reusable procedure.

### Keep learning states meaningful

| State | Entry requirement | Default treatment |
|---|---|---|
| Draft | A reusable candidate with provenance, a trigger, preconditions, procedure, stop conditions and a concrete validation plan | Discoverable as a draft; no automatic preference |
| Verified for scope | The exact revision passes relevant observable checks in the declared environment, including a fresh input that was not the extraction example | Eligible for routine retrieval within that scope |
| Preferred for scope | Held-out task evidence shows a repeatable benefit over the previous/no-skill baseline, with acceptable regressions and cost | Ranking preference within that evidence scope |
| Quarantined/superseded | Invalidated assumptions, contradictory evidence, or a replacement revision | Excluded from automatic selection; provenance retained |

These gates are proposed product semantics, not research-derived magic thresholds. A successful source task can justify a draft, not broad verification. A small canary may justify verified-for-scope without supporting a statistical improvement claim. Where success cannot be checked automatically, retain an explicit human-attested or judge-only evidence level and keep its uncertainty visible.

Candidate-generated checks can supplement stable checks, but the learner cannot weaken/delete the independent checks used to approve itself. Always include relevant regression cases. Record skipped checks as skipped. Re-verify behavior-changing revisions; evidence does not silently transfer from a parent version.

### Prefer adaptation and preserve provenance

Before writing, compare canonical identity/content hashes and related intent/preconditions. Choose deliberately:

- Same behavior and environment: add evidence or a better example; do not create another skill.
- Same procedure with a local constraint: make a project-scoped derivative linked to its parent.
- Existing local procedure with a demonstrated defect: stage a new revision and run its regressions.
- Materially different preconditions or workflow: create a separate skill with an explicit boundary.
- One-off task facts: leave them in task/session memory.

Semantic similarity is a candidate generator, not permission to merge conflicting procedures. Preserve source URI, original author/license, immutable upstream revision/digest, parent derivation, local authoring model/version, source run IDs, verification method and visibility. Never overwrite registry/vendor originals during local learning. Project details remain project-scoped; personal reuse requires sanitization and cross-project applicability evidence. Personal promotion does not imply public publication.

A negative case should say when a procedure does not apply and what evidence exposed the mismatch. Avoid a universal rule distilled from one accidental workaround. Bound candidates and evidence-index growth, archive redundant revisions, retain counterexamples, and exclude stale/incompatible skills before ranking.

### Persistence and safe goal/queue restoration

Persist the catalog and skill revisions independently from conversations. New sessions rebuild/search the same catalog without loading the whole transcript. Persist a goal/queue checkpoint as task identity, user intent, current state, pending actions, exact selected revisions, completed checks and durable external-operation receipts.

On restart, recheck workspace/environment and authorization scope, resolve the pinned revision or report its absence, and inspect unknown/in-flight side effects before retrying. An interrupted action stays unknown until observed; it does not become a successful learning event. Deduplicate learner jobs by source task/run plus candidate digest so replaying a completion cannot create duplicate skills or inflate evidence. Store explicit completion outcomes before scheduling extraction; crash recovery should resume pending extraction without replaying the task’s external actions.

## Benchmark plan

Freeze task families, repository commits, model/harness/tool versions and budgets. Split by workflow/repository and time before extraction so nearly identical tasks and their answer-bearing traces do not cross the boundary. Include same-project new tasks, new-project tasks, changed tool versions, and tasks where no skill should load.

Run separate conditions with matched budgets and repeat trials:

| Condition | What it isolates |
|---|---|
| No skills | Base model/harness capability |
| Fixed curated library | The value of existing procedural expertise |
| Discovery over a fixed library | Retrieval/selection quality, with realistic distractors |
| Naive self-authored skills | Whether writing plausible procedures alone helps |
| Experience-derived candidates, frozen before held-out evaluation | Learning from prior verified work |
| The same learner with memory wiped between tasks | Whether persistence causes cross-task benefit |
| Existing skills with local adaptation vs new-skill creation | Whether derivatives improve fit without proliferation |

Measure verifier pass rate first, then regressions/negative transfer, cost and steps per success, startup and loaded-context tokens, retrieval precision/recall, abstention, trigger precision, unused skills, unique skills per task family, duplicate rate, stale-skill rejection, and evidence completeness. Keep retrieval success separate from task success and task success separate from paired utility. Use paired task deltas and confidence intervals clustered by task; show harmful cases and per-family results, not only the average.

Force a fresh process/session between learning and held-out use. Test that the skill works without access to its source conversation. Separately inject crashes before/after completion recording, candidate persistence and promotion; verify no duplicate side effects, phantom successes, duplicate promotions or silent revision substitution. Persisted goals/queues should resume with the same evidence and constraints.

Include adversarial validity cases: empty/no-op command returns zero; scripts suppress errors; tests only mirror implementation; task-specific answer leakage; a malicious registry instruction; incompatible package versions; stale paths; unrelated transient failures; conflicting personal/project guidance; a successful task that never used the loaded skill. The expected behavior is often to decline promotion.

Claim genuine improvement only when experience acquired earlier raises later unseen-task performance or reduces matched cost without unacceptable quality loss, with the model and harness held fixed and the effect surviving a new session. More files, more activations, longer memories, model praise, successful retries, or higher source-task scores establish different things.

## Highest-value next decisions

1. Fix the meaning of successful capability use before adding ranking or promotion.
2. Ship exact-version provenance and evidence-scoped states alongside lazy discovery.
3. Learn one small, validated derivative from useful completed work; prefer controlled edits over library growth.
4. Require observable postconditions and protect independent regression checks.
5. Prove held-out cross-session benefit before adding complex reflective machinery or calling the system self-improving.

The main unresolved risks are evaluator error, task-answer leakage, credit misassignment, scope/version mismatch, library proliferation and unsafe replay after a crash. The selected research supports useful mechanisms and targeted experimental gains; none establishes universal safe, autonomous procedural learning for a production CLI.
