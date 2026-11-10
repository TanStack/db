# Oracle-first cluster pilot

The workflow worked well enough to keep as an optional investigation mode. All
five prioritized investigations produced executable evidence and passed fresh
independent review within their stated limits. It distinguished current defects,
already-fixed behavior, incorrect oracle accounts, accepted limitations, and
new product promises. No production repair or bug-class closure is claimed.

The optional mode is now in
[misfits-survey](</Users/kyle.mathews/programs/linux-config/skills/misfits-survey/SKILL.md>),
with its detailed
[investigation reference](</Users/kyle.mathews/programs/linux-config/skills/misfits-survey/reference/cluster-investigation.md>).
The default survey remains a bounded inventory. The extension incorporates
observed pilot failures and its own independent routing/source review.

## Results and next repair order

| Investigation | Evidence and next action |
| --- | --- |
| [SQLite / Electric peers](c-sqlite-electric-peers/report.md) | Prioritize durable/public row loss and resurrection in no-reset #2281 and #2283. Failures begin at lagging source commits before stops; later restarts request head positions and cannot restore the correct rows. Rotated-follower #2139 and seed-metadata failures are separate boundaries. Two reset traces instead exposed a final-driver recovery omission; the test-only correction passes, and its ablation fails. #2085's bounded leader-close repair passes real Chromium/OPFS and live Electric checks. |
| [Ordered loading lifetimes](c-ordered-loading-lifetimes/report.md) | #2214 still misses source-prefix coverage after optimistic release. #2222 loses a new invalidation during acquisition retirement at the core progress boundary; public wrong rows remain unproved. #2296 is a repaired oracle continuation-classifier defect, without evidence of a production leak. #2268's exact traces are already fixed and reject reconstructed old prefix fallback. #2223's obsolete later-page receiving history stays open. |
| [Ordered refetch variants](c-ordered-refetch-variants/report.md) | #2182 offset-only preload and #2183 capped repair remain semantic REDs. Generated provider axes expose additional source-coverage counterexamples through the existing model. A conditional acquisition/refetch overlap also fails; an actual second live loader's origin remains unproved. Real Electric default-partial update leaves the ordered window stale while full replica passes, but #2138 remains a contract-boundary decision. |
| [Query subset errors](c-query-subset-errors/report.md) | No current product violation established. Current source health exposes later failures; an initially failed live query recovers through its own reload. Per-subset passive attribution and automatic same-run recovery are policy requests. The investigation repaired an Error-identity checker false green and reran 5,184 histories through the stronger judgment. Overlapping failure/recovery and generated initial-load receiving histories remain coverage work. |
| [Standalone #2294](s-2294-replay-retention/report.md) | Prioritize the shared-source publication barrier independently of #2296. Both failed-demand and pending-replacement traces publish against the retained complete snapshot at their distinct original cuts. Both exact REDs coexist with 600 fixed + 600 random GREEN histories. Exact generated key-overlap replacement reach remains open. |

The first production repair wave should cover persisted row/resume coherence,
Query DB window/source-prefix coverage, and #2294 publication retention, with
writers reconciled by actual production owner. Investigate #2222's real
receiving consequence alongside that work. These are priorities among the
pilot's bounded evidence, not a numerical severity formula or an authorization
to start production edits.

Keep the following product decisions separate from those repairs:

- #2138: maintained ordered windows under default partial updates versus the
  documented ignored-unknown-row policy. Real server evidence now exists, but it
  does not choose full-row fetch, subset repair, or a full-replica requirement.
- #2267: unknown-partial safety rejection versus a stronger multi-stream
  composition/recovery promise. Preserve the safety guard while deciding.
- #2209: permanent lagging-source closure and monotonic intermediate ordering
  exceed the current convergence premise.
- #2260: bounded work before first source settlement revises the current
  authoritative full-recovery policy.
- #2270/#2271: subset-local passive health, healthy-peer isolation, and automatic
  same-run recovery are distinct from the current shared-source/reload laws.

## Evidence and accounting

Frozen production baseline: `07bfc0eb2584fd83a3efc14ec1fb452954a829ea`. The survey
worktree retains its older inventory baseline; no oracle patch was applied to
that checkout. Each investigator used its own worktree at the frozen production
baseline. The worktree helper published the initial empty branches during
setup; no investigation/test changes were committed or pushed. GitHub sources
were read without comments, edits or closure.

All 24 captured issue files retain their source hashes. The master ledger has
223 IDs: 219 source-accounting records and four pilot siblings. These include
context, composite parents, remedies and atomic splits; they are not 223 bugs.
No ID is lost when several records describe the same defect.

| Category | Records |
| --- | ---: |
| Product-bug category, including historical/unverified claims | 29 |
| Accepted-law coverage gap | 51 |
| Oracle/harness defect | 7 |
| Feature request | 14 |
| Contract decision | 13 |
| Non-behavioral/context | 109 |

Latest dispositions: 55 confirmed-open, 51 unverified, 36 accepted-design,
26 design-decision, 18 stale, 14 already-fixed, nine duplicate, nine fixed-now,
and five refuted. Fixed-now records describe bounded instrument work; none is
a production repair. A category is separate from validity and action.

[audit.json](audit.json) records all five unchanged production HEADs, empty
production-source diffs, complete artifacts and canonical latest fields.
[master-claim-events.jsonl](master-claim-events.jsonl) retains imported worker
events; [effective-claims.json](effective-claims.json) projects the latest state.
The separate [bug](bug-queue.json), [oracle](oracle-queue.json),
[feature](feature-queue.json) and [decision](decision-queue.json) queues preserve
IDs, source text, validity, action and evidence. Queue membership is not proof
of a confirmed current defect.

Three fresh reviewers covered all five results:
[multi-tab](review-pilot-multitab.md), [ordered/replay](review-pilot-ordered.md),
and [Query](review-pilot-query.md). They read complete fresh sources before
investigator conclusions. Relevant independent reruns and raw receipts are
retained. All supported review findings were reconciled; substantive evidence
limits remain open. Source accounting is complete, scoped investigation is
complete, and production repair/closure is incomplete.

## Workflow evaluation

The run met the [pre-recorded criteria](pilot-evaluation-criteria.md) after
corrections. Its useful output was the distinction between accepted-law bugs,
test defects and new promises, supported by actual observations rather than
issue labels or agent agreement.

The pilot found three instrument weaknesses: final recovery missing from the
multi-tab driver, continuation provenance lost by the loader oracle, and Error
identity weakened to deep equality. Independent challenge also caught a replay
selector for a newly introduced property, stale authority interpretation,
missing lawful calibration control, absent diagnostic observations, stale
signals in a proposed history, and narrow readings of broad source claims.

The optional skill mode now includes these supported amendments:

1. Freeze authority and production together; follow dated decisions when notes
   conflict. Missing repository-specific documents are evidence gaps, not an
   automatic block on other repositories.
2. Use canonical event fields before fan-out and validate them early. The pilot
   needed metadata-only normalization late in the run; original wording and
   events remain preserved.
3. Check selected/executed test counts and property-specific replay registration.
   Preserve exact argv/cwd and successful random seeds when available.
4. Retain physical premises, distinguish shrink reach from completed campaigns,
   and name counters precisely. A temporal neighbor does not prove key overlap.
5. Calibrate wrong and lawful observations through the same judgment. Rerun
   affected production histories after strengthening comparisons.
6. Finish mutants and freeze artifact hashes before executing independent review.
   One reviewer initially ran while an author was ablating the driver; fresh
   frozen reruns resolved that ambiguity.
7. Preserve partial claims, cleanup diagnostics, known REDs and unrun receiving
   paths. Release heavy slots during reporting. Do not require a defect in every
   cluster or make deep investigation the default inventory behavior.

The detailed artifacts are intentionally more expensive than a signal survey.
Use this pass for prioritized clusters, with coherent primary-owner planning;
do not blindly launch one production rewrite per issue. Several remaining
provider, Electron, later-cursor, delayed-acceptance and framework witnesses
still need work. A random refetch campaign timed out; some successful random
runs did not emit seeds. Whole-package typechecking was not established, and
the refetch package's blocked full check is recorded separately from its
passing scoped check. Multi-tab teardown emitted a closed-database diagnostic
that remains uninvestigated. None is converted into closure evidence.

## Integration and skill validation

Five test-only patches are retained in their task directories. Some intentionally
expose ordinary REDs, so they are investigation evidence rather than merge-ready
branches. Shared coverage-map amendments and tests need reconciliation at a
future combined repair head; no affected evidence is claimed for that unbuilt
integration.

The two-file skill extension passed
[independent routing/source review](review-skill-extension.md), assembled and
installed `quick_validate.py`, local-link checks, and Git whitespace checks.
The default Python lacked PyYAML and temporary package installation did not find
a distribution; validation ultimately used the existing Ansible PyYAML path,
without changing host packages. No pnpm403 override was needed by the pilot.
The [installation receipt](skill-extension/installation.json) records original
and new hashes. Only the skill entry point and its new reference changed; all
existing inventory phases and resources remain intact. Skill changes are
uncommitted in linux-config; the main TanStack checkout was preserved.
