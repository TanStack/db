# Oracle-first investigation of survey clusters

Status: trialed in investigate mode on five prioritized investigations. See the
[pilot results](misfits-investigations/pilot-2026-10-29/summary.md). This document
does not itself authorize investigations or repairs. `workflow-used.md` in the
pilot directory preserves the original dispatch instructions.

The objective is to discover which accepted promises are violated, missing from
executable models, or incompletely enforced. It also identifies proposed promises
that need a product decision. Investigations produce executable evidence and
bounded repair plans. They do not assume that an issue label, a survey grouping,
or a failed oracle establishes a production bug.

This workflow adapts [evaluate-review][evaluate] to a portfolio of issue/PR
claims. It retains lossless accounting, separate judgments, whole-scope oracle
planning, and evidence before production repair. Reviewer hiring assessments do
not apply. PR readiness is assessed separately if a repair PR is later requested.

## 1. Dispatch and authorization

The coordinator freezes one freshly fetched `origin/main` commit for each wave.
Every worker records that commit, its dependency versions, and its environment.
A report's original commit is a separate replay target when needed. An unmerged
PR supplies a proposal or candidate implementation; it does not establish the
accepted contract.

Each dispatch declares one mode:

| Mode          | Authorized work                                                                                                                                                            | Result                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `investigate` | Read sources and code; run probes; extend or repair accepted-law oracles, grammars, drivers, observations, and calibration. Use isolated temporary mutants as experiments. | Classified claims, law audit, executable evidence, oracle changes, remaining questions, and a repair plan. Product defects remain open. |
| `repair`      | Investigation work followed by production repairs for confirmed violations of accepted laws, after the pre-edit evidence gate.                                             | Repair, GREEN, hostile-mutant evidence, receiving witnesses, and bounded closure assessment.                                            |

Start the fan-out in `investigate` mode. Enter `repair` mode when implementation
is authorized. Within authorized repair work, routine enforcement fixes need no
additional approval. A new or revised product promise needs a maintainer decision.
Continue independent enforcement work while that decision is unresolved.

Use a separate worktree for each writing investigator. All worktrees in a wave
start from the same recorded baseline. Give each worker an immutable input packet
or absolute paths plus content hashes: survey entries, complete cited reports,
retained extraction, historical context, and any newer issue/PR discussion.
Record additions and changed claims rather than silently replacing the survey.
The initial inventory contains 135 captured artifacts; it is not a current census.

## 2. Lossless claims and the bug/feature distinction

Before experiments or edits, each worker reads every assigned issue/PR in full,
including supplied comments, scope qualifications, proposed remedies, and relevant
linked evidence. Acquire missing linked evidence only where it affects a claim.
Record unavailable sources and avoid treating historical fixes as current proof.

Create an append-only claim ledger with stable source IDs, for example
`2296/C01`. Preserve separate claims and proposed remedies. Cross-reference
related or duplicate claims without erasing their distinct histories or limits.
Record newly discovered sibling violations separately from source claims.

Agree on canonical category, disposition and evidence fields before fan-out,
then validate them when each worker first writes a ledger. Keep descriptive
labels in separate fields. Preserve context records with a record kind; source
accounting totals are not independent bug counts. A partial improvement does not
close the uncompleted portion of the original claim.

A cluster can contain bugs, feature requests, coverage gaps, and contract
questions. Classify individual claims. In particular, split an accepted-law
violation from a suggested new API that might address it.

| Claim category            | Required distinction                                                                                                                                                                | Queue                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Product bug               | An accepted promise applies to the stated path and checkpoint, and executable evidence shows production violates it.                                                                | Bug investigation/repair.                                                           |
| Accepted-law coverage gap | A promise already has authority, but its model rule, legal histories, production path, observation, or assertion is missing or incomplete. A product violation may remain unproved. | Oracle investigation before feature work.                                           |
| Oracle or harness defect  | The model, grammar, driver, recorder, comparison, replay, or reach mechanism makes an incorrect claim about the accepted contract.                                                  | Test repair; assess product consequences separately.                                |
| Feature request           | The requested capability or stronger behavior needs a new promise beyond the accepted contract.                                                                                     | Preserve a candidate law and acceptance evidence; implementation waits behind bugs. |
| Contract decision         | Authority is missing, contradictory, or does not select between materially different observations.                                                                                  | Present the precise decision; continue unaffected work.                             |
| Non-behavioral work       | Documentation, packaging, maintenance, or measurement with no claimed behavioral violation.                                                                                         | Use direct source/build/declaration evidence appropriate to the claim.              |

"Missing law" needs a second distinction. An accepted promise absent from the
oracle is an enforcement gap. A consequence entailed by an accepted promise may
also be a gap; show that derivation. A desired promise without authority is a
proposal. Failure to find authority initially is unresolved evidence, not an
automatic feature classification. An established requirement can still be
unsuitable; propose its revision separately from enforcing it today.

Keep these judgments separate for each claim:

- Technical validity on the report commit and on the wave baseline.
- Product category and current action.
- Durable value: law, witness, test gap, documentation, or decision to preserve.
- Evidence strength, affected users, severity, and investigation priority.

Use the evaluate-review dispositions where applicable: `confirmed-open`,
`already-fixed`, `stale`, `refuted`, `accepted-design`, `design-decision`,
`duplicate`, and, after authorized complete repairs, `fixed-now`. Add an explicit
`unverified` evidence status for allegations without a decisive experiment; do
not describe them as confirmed. A feature classification is not a refutation.

A passing campaign does not refute a report. Check the commit, production path,
preconditions, and checkpoint. If those cannot be established, preserve the claim
with the missing experiment or clarification. Cite the decision for
`accepted-design`. Preserve useful tests even for stale or refuted claims.

## 3. Audit the laws across the whole cluster

Before handling reports one by one, inventory all observable guarantees in the
cluster's bounded subsystem, including relevant neighboring guarantees. Start
from accepted contracts as well as existing oracle prose. This finds obligations
that no test currently claims. A cluster is a lead; several independent laws may
be needed, and several clusters may share one primary owner.

Workers read applicable [AGENTS.md](../AGENTS.md), the
[glossary](contributing/glossary.md), the full
[oracle guide](contributing/oracle-rubric.md), and the relevant
[coverage-map entries](contributing/oracle-coverage.md). They load
[oracle-authoring](../.agents/skills/oracle-authoring/SKILL.md) before oracle edits
and [oracle-review](../.agents/skills/oracle-review/SKILL.md) before oracle review.
They read the stable subsystem entry points required by AGENTS.md. Correlated
live-query work requires the full
[architecture](../packages/db/src/query/live/ARCHITECTURE.md) before code or
related includes tests. Every delegated worker does its own applicable reading.

For each law, write:

> Given these legal inputs and histories, under these preconditions, this
> participant must observe this allowed result at this checkpoint. These parts
> may still be pending or unspecified. Authority: exact source and section.

Then audit the complete chain:

`authority → model → legal histories → production driver → recorder → comparison`

Use a compact matrix with one row per law and path/checkpoint combination:

| Field          | Required evidence                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Authority      | Accepted source/decision, status, boundary, and limits; observed production behavior alone supplies no authority.      |
| Model          | Independent rule and relevant state distinctions. Explain any abstraction against the glossary.                        |
| Histories      | Legal actions, schedules, value/provider dimensions, known-witness reconstruction, nearby cases, and valid exclusions. |
| Path and reach | Actual entry point, fixture premises, required receiving paths, and measured reach for each path.                      |
| Observation    | Public fact, recorder fidelity, and exact promised comparison checkpoint; include intermediate cuts when required.     |
| Sensitivity    | Wrong observation or implementation that reaches and is rejected by the intended comparison.                           |
| Neighbors      | Laws sharing state or timing, distinguishing cases, and any conflict or missing source information.                    |
| Status         | Encoded, reached, asserted, calibrated; evidence and omissions for each, rather than one aggregate "covered" flag.     |

Identify the precise gap: absent law/model rule; wrong reference semantics;
missing value, history, overlap, or timing; unreached path; invalid fixture
premise; missing or normalized-away observation; false-green assertion; or an
unsupported scope claim. An existing oracle may already encode and detect the
production violation correctly. Record that result without inventing a missing
law or a false-green test gap. If an oracle correctly protects a narrower contract,
credit that result and identify the broader ownership gap separately.

Challenge the law itself with a plausible rival and a nearby legal alternative
implementation. Use [law discovery](contributing/instruments/law-discovery.md)
when authority is unclear and
[adversarial review](contributing/instruments/adversarial-review.md) when a
concrete challenge is useful. Do not require every instrument for every law.

If a proposed result needs information that the production path lacks at the
promised checkpoint, demonstrate the missing distinction. Name the provider,
protocol, architecture, or contract decision required. Narrowing an accepted
promise or moving its checkpoint requires authority.

## 4. Reconcile oracle plans before competing edits

Each investigator maps every behavioral claim to the existing oracle evidence
or the oracle change that would generate and detect it. Plan the smallest
coherent set of changes for the whole cluster. Prefer a missing history dimension or observation that
reaches multiple claims and their neighbors over one pinned example per issue.

The coordinator reconciles these plans across clusters before shared files are
edited. Maintain a registry of law IDs, primary oracle owners, receiving paths,
claimed files, and dependent investigations. Assign one writer to a shared oracle
or production area. Other investigators contribute read-only evidence and
witness inputs, or wait for the shared change. They do not create competing
reference models merely to avoid a file conflict.

Keep report IDs and per-cluster results even when execution is combined under
one owner. Add a separate oracle owner only when a boundary needs a different
independent judgment. Add another driver for the same law when a real framework,
host, or provider must supply a controlled premise.

If no owner applies to an accepted law, create the smallest independent oracle
that judges it and register that ownership in the coverage map. A missing
history, path, or observation in an existing owner remains that owner's gap.

Reconciliation is local to the affected owners. An urgent investigation can
start experiments once its own claims and shared-owner dependencies are clear;
it need not wait for unrelated clusters to finish classification.

## 5. Establish executable evidence on unchanged production

For each accepted-law claim:

1. Replay the report at its recorded commit where practical, then check the wave
   baseline. Retain the original trace, exact command, environment, and outcome.
   Distinguish fixed-since-report behavior from changed grammar or missing setup.
   Record selected and executed test counts. Zero selected tests is invalid
   replay evidence. Each new property needs its own campaign/replay selection
   and any required registration. Read authority from the frozen worktree and
   follow dated decisions when contract prose conflicts.
2. Inspect the primary oracle's independent model, history grammar, driver,
   recorder, and comparison. Extend the specific missing part, or create an
   owner when none applies. Keep prose aligned with the accepted law. Preserve
   a focused regression as input to that shared judgment. Investigation may
   conclude that the existing oracle already detects the defect: demonstrate
   reconstruction, generated reach, neighboring histories, observation fidelity,
   and calibration before claiming that scope is adequate. An investigation
   need not change adequate oracle machinery. Authorized production repairs
   still follow AGENTS.md's coverage-extension requirements, including retention
   of the failure through the shared model, driver, and comparison.
3. Declare the relevant states with `createOracleReach`. Measure them separately
   for required receiving paths. Count actual actions and comparisons.
4. Run the extended oracle against unchanged production. Record which original
   claims it exposes, which remain unreached, and any sibling counterexamples.
   Revise an incomplete experiment before considering production repairs.
5. Run neighboring guarantees at the applicable cuts. Exercise required real
   receiving paths before production edits when they are part of the claim.
6. Calibrate the judgment against a plausible wrong result or implementation.
   Test the original defect and a plausible one-trace fix where relevant. Include
   a lawful nearby alternative so an over-strong rule is also detectable.

Use the evidence appropriate to the claim. A product bug needs the wrong public
observation on unchanged production. An oracle false green needs an adversarial
subject the old check accepts and the repaired check rejects. A false red needs
an allowed case and authoritative expected semantics. A coverage-only change may
leave production GREEN while newly rejecting a relevant hostile mutant. Do not
manufacture a production RED to classify that work as a bug fix.

Record mutation outcomes precisely: intended assertion failure, timeout, setup
failure, runtime failure outside the comparison, unreached path, survival, or
scoped equivalence. Only reaching and rejecting the relevant wrong behavior
establishes the intended sensitivity. A timeout can motivate a separate progress
investigation; it is not automatically a successful row-correctness check.

Retain physical premise observations even when diagnostic tests pass. Report
completed-history reach separately from failing histories and shrink attempts.
Successful random seeds should be retained when the runner supplies them; say
when they are absent. Calibrate a wrong observation alongside a lawful control
through the same fixture and comparison, including identity when identity is
promised. Rerun affected production histories after strengthening a comparison.

Use controlled events rather than sleeps where a semantic boundary exists.
Use deterministic work counts when the accepted law bounds work. Preserve the
violated law and checkpoint through shrinking, and retain cleanup diagnostics
without replacing the primary mismatch.

Important generated properties retain fixed-seed and random campaigns with the
same property, grammar, recorder, comparison, and budget, plus direct seed/path
replay. Preserve command `replayPath` where applicable. Do not lower existing
budgets, relax comparisons, add quiet exclusions, or replace generated coverage
with named examples to obtain GREEN. Apply every triggered ORC requirement.

Temporary production mutants are isolated experiments, recorded separately from
repairs and reverted afterward. Before a repair begins, preserve a test-only
revision or patch and the unchanged production revision. This makes the ordering
of the RED result and production edits reviewable.

The `investigate` mode ends here after independent challenge and reconciliation.
A report can be complete while its product defect remains `confirmed-open`.
Do not call a failing investigation branch merge-ready.

## 6. Independent challenge and authorized repair

A fresh reviewer receives the sources, claimed law/domain, oracle diff, and raw
evidence without an instruction to endorse the investigator's verdict. It checks:

- Whether the claim is an accepted-law defect, a model/harness defect, a feature,
  or an unresolved contract choice.
- Whether expected results come from an independent account of the promise.
- Whether the history reaches the intended path and checkpoint without the
  fixture supplying the missing production behavior.
- Whether the comparison rejects a relevant wrong result and permits legal
  implementation freedom.
- Whether an interacting law, real receiving path, source qualification, or
  original claim was lost.

Finish temporary mutants and freeze code/model/driver/support hashes before an
executing review. Use a separate matching checkout or verify hashes before and
after the run. Do not execute against files the author is mutating. Metadata-only
corrections remain append-only, identify that no new execution occurred, and
refresh output hashes without pretending that code evidence changed.

Material disagreements get a distinguishing witness or an explicit decision
question. Two agents agreeing is not experimental evidence. A shared semantic
fault may require an independently formulated check under ORC-011.

In authorized `repair` mode, first verify the pre-edit gate: accepted law;
measured reach; defect RED and neighboring results on unchanged production;
required receiving witnesses; and an independent, sensitive comparison. Missing
setup or required receiving evidence blocks production edits, not unrelated work.

Then make the smallest production repair, run the same oracles for GREEN, and
reject the original defect or a plausible hostile mutant at the intended cut.
Preserve neighboring guarantees. Run appropriate package checks and
`pnpm lint:changed`; update the primary owner and coverage map as needed.
Recheck after integration against the new combined head. Evidence affected by
branch movement must be rerun or explicitly marked stale.

A law change goes to the maintainer with the candidate law, rival, authority gap
or conflict, distinguishing history, user consequences, and recommendation.
Scratch models can explore alternatives; unresolved proposals do not become
passing CI requirements or silent changes to expectations.

## 7. Outputs and completion criteria

Use a task-local `<run-dir>` for working evidence. Each investigation returns:

```text
<run-dir>/<cluster-or-standalone-id>/
  brief.md             # baseline, mode, sources, owners, paths, and prerequisites
  claims.jsonl         # append-only source and sibling claims with three judgments
  laws.md              # authority and enforcement matrix, rival predictions
  experiments.jsonl    # commands, revisions, reach, seed/path, checkpoints, outcomes
  report.md            # law, experiment, inference, remaining work, then item ledger
  oracle.patch         # or a referenced test-only commit; optional if no edits apply
```

The coordinator owns the master claim ledger, shared-owner registry, decision
queue, bug/oracle queue, feature queue, and integration record. Workers write
only their assigned files and worktrees. Keep large source corpora on disk;
agent replies contain paths, counts, decisions, and decisive evidence summaries.
Working ledgers remain uncommitted unless requested. Oracle/repair claims used
in a PR need the repository's versioned evidence tied to the exact reviewed head.

A worker's report answers:

1. What accepted law is violated, absent from the oracle, or inadequately enforced?
2. What did the existing oracle actually establish, and why was the suite green
   or the recorded failure misleading?
3. What experiment distinguishes production, model, grammar, driver, observation,
   and contract explanations? What actually ran?
4. What remains a feature request or unresolved promise, and what decision would
   settle it?
5. What is the smallest next repair and its class-wide oracle obligation?

For source claims, the loss audit is:

`all claim IDs = unverified + confirmed-open + already-fixed/stale + refuted + accepted-design + design-decision + duplicate + fixed-now + explicitly approved deferrals`

Category and action remain separate fields. Feature claims stay accounted for
while queued. Sibling findings have their own IDs and remain visible. A worker
limit changes scheduling, never finding counts, law scope, or test budgets.
Unfinished work stays open; it is not silently deferred or closed.

Completion is reported at separate levels: source accounting complete; law audit
complete within a declared scope; executable evidence complete; and repair/closure
complete. A missing witness prevents the corresponding claim, not an honest
report of completed work. A reachable in-scope counterexample keeps the bug
class open. Random GREEN and a complete item ledger do not prove universal
correctness or whole-PR readiness.

For a repaired behavior, require the AGENTS.md evidence block: law and authority;
measured reach; original RED; repaired GREEN; hostile mutant; limits. Bound the
result by law × legal histories × production paths × observations/checkpoints.
Each remaining in-scope cell needs its owner and next witness. Use the full
rare-exception requirements from evaluate-review for any proposed deferral;
ordinary effort or a reporting cap is insufficient.

## 8. Fan-out plan

Queue contract/classification investigations across all 26 clusters. Include
the standalone signals in the source registry, with #2294 in the urgent queue.
Preserve the other survey buckets; an urgent claim found there can enter the bug
queue. Classification is an evidence result, not a demand to find a defect in
every cluster.

Results stream into the coordinator's registry. Start urgent executable work
as soon as the relevant cluster and shared-owner plans are reconciled. There is
no global barrier requiring all 26 classifications before the first experiment.

Schedule deep executable work for accepted-law bugs and oracle gaps before
feature implementation. Rank severity, reach of the user consequence, and
recovery separately from confidence in the evidence. A high-risk allegation may
justify early verification even before it becomes a confirmed bug. Reactions
and the number of related issues are supporting signals, not a severity formula.

Start with at most four heavy experiments in parallel. Contract reading and fresh
reviews can run independently within the available worker and host limits.
Serialize writers for shared owners and browser/provider resources. This initial
queue reflects the survey and must be revised against the fresh baseline:

| Investigation                                            | Initial evidence to examine                         | Coordination concern                                                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite persistence / Electric multi-tab coordination     | #2281, #2283, #2085 and the cluster's other claims. | Preserve distinctions among durable state, source ordering, public rows, and leader/follower paths.                                                |
| Ordered loading / refetch, repair, and request lifecycle | #2296, #2214, #2223, #2260 and neighboring reports. | Coordinate the request-authority owner with the failed-request/recovery cluster; ledger evidence does not itself establish a public resource leak. |
| Standalone ordered replay / retained publication         | #2294.                                              | Retain its independent publication obligation and checkpoint; do not merge it into #2296 by release timing.                                        |
| Ordered refetch / provider variants and peer windows     | #2155, #2183 and the remaining provider/peer cases. | Coordinate shared loader and Query DB owners before oracle edits.                                                                                  |
| Query Collection / subset error visibility and recovery  | #2270, #2271.                                       | Recheck current status/health and restart/reload contracts before selecting expected recovery behavior.                                            |

All remaining clusters still receive a law/contract classification and retain
routes to deeper work. Mixed clusters may produce both bug and feature packets.
After the first wave, reconcile shared laws and surprising counterexamples,
then dispatch the next wave. Do not launch 26 independent production rewrites.

## Dispatch template

```text
Investigate <cluster ID / standalone ID> in mode <investigate|repair>.
Baseline: <exact commit>. Worktree: <absolute path>. Run directory: <absolute path>.
Input packet and hashes: <paths>. Primary source IDs: <IDs>.
Primary oracle owner / shared-owner constraints: <known paths or discover>.

Read applicable AGENTS.md, the glossary, full oracle guide, relevant coverage-map
entries, required subsystem documents, and the oracle-authoring/review skills.
Read every assigned source claim and preserve its qualifications and proposed fix.
Create the claim ledger before experiments or edits.

Classify each claim independently as a product bug, accepted-law coverage gap,
oracle/harness defect, feature request, contract decision, or non-behavioral work.
Keep technical validity, action, durable value, and evidence strength separate.

Audit all claims and neighboring guarantees together. Derive law and authority,
rival predictions, and the smallest distinguishing legal histories. Trace the
model, grammar, production driver, observations, and comparison. Coordinate your
whole-cluster oracle plan with the primary owner before shared edits.

Establish measured reach and decisive evidence on unchanged production. Include
required receiving paths and hostile calibration. Preserve original and sibling
counterexamples. Only authorized repair mode permits production fixes, and only
after the pre-edit gate. Bring new or changed promises to the maintainer.

Return file paths, claim totals by category/disposition, decisive experiments,
shared-owner dependencies, unresolved decisions, and missing witnesses. Lead the
report with laws, experiments, inferences, and remaining enforcement work. State
whether production/oracle changes were actually made. Do not infer closure from
an item count, a pinned reproduction, or a green campaign.
```

[evaluate]: /Users/kyle.mathews/programs/linux-config/skills/evaluate-review/SKILL.md
