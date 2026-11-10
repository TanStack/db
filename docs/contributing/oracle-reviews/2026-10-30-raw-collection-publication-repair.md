# Raw Collection publication repair

Base: `c351fc04d7f70dc59bf92ecbed310f899b9511cd`.
This record describes the validated working tree, before commit or PR preparation.
Exact runtime source hashes and mutant restoration checks are in
`review-evidence/collection-publication/final-mutant-results.json`.
`final-working-tree-hashes.json` also binds all changed source, oracle, and
contract files. Final changed-file oracle lint, ordinary ESLint, Prettier, and
`git diff --check` passed. No commit, push, or PR operation was performed.

## Law and repair

The [maintainer decision](2026-10-30-raw-collection-publication-decision.md)
requires raw subscribers to observe applied Collection transactions. Pending or
failed replay acquisition cannot hide or retract those transactions. Live-query
Collections and Effects retain their complete-result publication barriers.

The repair removes the raw subscription's private replay rows and final diff.
Replay still owns acquisition, readiness, errors, and consumer completion.
Snapshot selection still reserves keys before callbacks can reenter.
An applied source transaction also reconciles rows retained across cleanup,
including when the transaction has no row changes. An optimistic publication
does not supply that source verdict. Eager readiness keeps its established
complete-source reconciliation. Empty layout notifications remain observable.
No adapter API or applied-receipt semantics changed.

## Evidence block

- **Law:** applied source transactions advance raw reads and full-state raw
  subscriber folds. Load failure does not retract accepted writes. Authority is
  the maintainer decision; cleanup and optimistic settlement retain their
  documented, separate boundaries.
- **Reach:** the final raw core lanes each ran 60 generated histories. Fixed
  counts were 90 held/restart continuations, 58 equal follow-ups, 60 quiet
  failures, and 30 each for failed retirement, retry, and success. Random counts
  were 89 held/restart continuations, 63 equal follow-ups, 58 quiet failures,
  29 retirement/retry, and 31 success. Continuations are distinguished from
  original histories in the output. The cleanup/optimistic extension reached
  each of its four cuts in all 60 fixed and 60 random histories. Query raw and
  compiled-live lanes each ran 60 fixed and 60 random histories; the latest
  minimum reach was 21. Persisted lanes each ran 20 histories, including eight
  shared examples, and reached every held cut 20 times.
- **RED:** before production edits, the revised law failed at subscriber-fold
  assertions on unchanged core, actual Query, and the persisted wrapper. Core
  and Query saved coordinates include seed `20261030`, path `0:0:0:0:1:1`;
  persisted paths `1` and `4` preserve truncate and quiet-failure witnesses.
  These are distinct from the superseded stronger-law investigation. During
  repair, the cleanup/optimistic extension first failed on premature deletion
  of a retained row, seed `20261030`, path `0:0:0`. Existing include comparisons
  also detected lost empty layout callbacks before that follow-up correction.
- **GREEN:** final publication/include run: 244/244 tests. Broader final core
  run: 1,383/1,383 across 19 files, including lifecycle, replay, ordered queries,
  Effects, and optimistic publication. Actual Query raw/live receiving:
  32/32. Persisted receiving: both campaigns, 40 histories. Core test TypeScript,
  ordinary Query typecheck, and persistence package TypeScript passed. Direct
  replays of all four mutant coordinates passed after restoration.
- **Mutant:** withholding raw notifications during replay failed the intended
  full-state fold comparison in core, actual Query, and persistence. Treating
  optimistic publication as source-applied failed the new same-turn exact-batch
  comparison. Suppressing empty source/layout publication failed both relevant
  include callback comparisons. All five executions failed by assertion at the
  intended checkpoint. Source hashes matched before and after restoration;
  restored replay and include checks passed.
- **Limits:** bounded histories are not a universal refinement or liveness
  proof. The persisted receiver uses the actual wrapper over an in-memory
  recording adapter, not native SQLite/OPFS. The Query receiver controls real
  QueryClient acquisitions with revision keys; it does not establish arbitrary
  provider ordering or static-key background-fetch behavior. The new optimistic
  cleanup extension uses one disjoint optimistic row, not overlapping retained
  keys or multiple concurrent mutations. Cleanup intentionally retains the raw
  subscriber fold without a delete callback, so direct/fold equality is not
  claimed during that interval. Complex graph, framework, provider, and native
  host laws remain with their existing coverage owners.

## Evidence locations and execution details

All paths below are under `review-evidence/collection-publication/`:

| Boundary | Evidence |
| --- | --- |
| Pre-edit core authority, model revision, RED and exact replay | `core-raw-commit-evidence-v1.md`, `primary-raw-commit-plan-v1.md` |
| Actual Query raw and compiled live-query path | `query-revised-law-report.md`, `query-source-flags-final-normal.log`, `query-source-flags-final-hashes.json` |
| Actual persisted wrapper, receipt and mutex progress | `persisted-raw-commit-evidence.md`, `persisted-raw-commit-final-evidence.md` |
| Lifecycle ownership, readiness and controlled completion handoff | `lifecycle-raw-commit-evidence-v1.md`, `lifecycle-raw-commit-reaches.json` |
| Cleanup/optimistic rival predictions, RED, GREEN and authority | `cleanup-optimistic-plan-v1.md`, `cleanup-optimistic-evidence-v1.md` |
| Final full core results and measured reaches | `core-followup-green.stdout.log`, `core-final-regressions.stdout.log` |
| Mutant commands, coordinates and source restoration | `final-mutant-results.json`, `empty-layout-mutant-results.json` |
| Restored exact replay results | `restored-replays-green.json`, `restored-empty-layout.stdout.log` |

Commands use installed Node/Vitest and saved private configurations. The records
preserve exact commands, seeds, paths, receipts, and first mismatching cuts.
Unrelated missing Expo example configuration warnings remain visible in logs;
they supplied no asserted RED. No dependency installation workaround was added.

The eager readiness regression discovered during repair passed on pristine
production. Its cause was a replay created solely for retained raw rows, despite
having no acquisitions. Removing that unnecessary replay restored all 27 focused
cases without weakening readiness assertions. Its baseline and repaired logs
are `eager-readiness-pristine-baseline.*` and `eager-readiness-repaired.*`.
The pristine run's separate on-demand empty/no-transaction row mismatch concerns
the clarified retained-row law, not those eager status assertions.

Supplemental ordinary tests formerly expected raw replay retention. Their row
and callback timing predictions were reconciled against the maintainer decision;
acquisition, cancellation, readiness, exact errors, reentry, and cleanup fencing
remain checked. Reports are `ordinary-subscription-reconciliation.md`,
`replay-ordinary-reconciliation.md`, and the lifecycle evidence record. Original
failure output remains in `core-subscription-regressions.*`.

The historical cleanup/restart mismatch at seed `-1439698414`, path `1:22` is
preserved. Its old retention prediction is superseded; the revised-law guarded
replay passes. This does not establish closure of issue #2310 as a whole.

## Oracle guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Maintainer authority, rival predictions, observation cuts and limits are explicit. |
| ORC-002 | Authored applied prefixes feed a plain keyed fold; production reads and replay classifiers do not select expected rows. The existing graph model was mechanically shared, not rewritten. |
| ORC-003 | Executable owners and named companions explain contract, model, grammar, production driver and comparison. |
| ORC-004 | Grammar reconstruction, ablation, bounded domains and exclusions are recorded in the core, Query and cleanup/optimistic reports. |
| ORC-005 | Comparisons observe actual raw reads/folds, exact callbacks, receipt progress, and compiled graph results at named cuts. |
| ORC-006 | Original defects, wrong-answer controls and three production mutants reject the relevant wrong designs by assertion. |
| ORC-007 | Fixed/random lanes retain the same grammar, judgment and budgets. Saved seed/path replays execute directly; repaired and restored runs pass. |
| ORC-008 | Raw row visibility no longer needs acquisition-verdict state. Cleanup retention and snapshot selection remain distinguishable model facts; lifecycle completion retains its separate model. |
| ORC-009 | Glossary terms and model projections are declared beside the executable owners. |
| ORC-010 | First law failures survive later observations and cleanup. Receiver reports preserve secondary diagnostics separately. |
| ORC-011 | No additional concrete shared semantic-fault hypothesis requiring another formulation was identified. This is not an exhaustive independence proof. |
| ORC-012 | This record binds the bounded claim to exact commands/results and source hashes; receiving reports supply detailed audits and limits. |
| ORC-013 | Held, failed and complete acquisition cuts distinguish raw transaction visibility from the superseded retention rule; empty/nonempty source follow-ups distinguish source origin from batch nonemptiness. |
| ORC-014 | Real Query and persisted-wrapper drivers share the raw judgment. The compiled Query receiver shares the existing graph model. Host and provider limits remain explicit. |
| ORC-015 | Changed campaigns declare and measure required reach. Generated and shrink counts are separate; lifecycle reaches exclude pinned histories. |
| ORC-016 | Fixed histories and checker faults use shared declared judgments. Ordinary supplemental examples remain in ordinary test files. |

Original lifecycle RED logs reported in the compressed handoff could not be
recovered; its report states that provenance limit. The independently preserved
pre-production core, Query and persisted assertion REDs supply the repair's
receiving gate. No missing log is represented as a newly executed result.
