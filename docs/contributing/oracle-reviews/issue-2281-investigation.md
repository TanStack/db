# Electric/SQLite source-progress recovery: issue #2281

This record summarizes the repair in [PR #2298](https://github.com/TanStack/db/pull/2298),
verified through implementation commit `0ec58057de52162da0eb4598616c2fc2eed2129b`.
The original investigation used production commit `82c5f999b32c9db827dd74e3f172604dfda28013`.
The [full investigation chronology](https://github.com/TanStack/db/blob/0ec58057de52162da0eb4598616c2fc2eed2129b/docs/contributing/oracle-reviews/issue-2281-investigation.md)
retains superseded results, intermediate manifests, and review corrections.
This summary changes no production code, model, history grammar, comparison,
exclusion, or run budget.

## Law and failure

After successful source recovery and complete delivery, durable rows and every
open eager Collection must equal the source head. Authority: Law 2 in the
[Browser multi-tab owner](../../../packages/browser-db-sqlite-persistence/tests/multi-tab-electric-oracle.test.ts),
the [coverage map](../oracle-coverage.md), and [#2209](https://github.com/TanStack/db/issues/2209).
Temporary arrival-order regressions remain allowed. The
[Electric recovery contract](../../collections/electric-collection.md#cleanup-and-resume-safety)
requires a fresh baseline after reset. Under the maintainer decision on #2265,
a reset-abandoned commit fails its source; successful catch-up requires restart.

The row-loss and resurrection traces share this mechanism:

1. Tab A commits two source changes to one key, reaching position 2.
2. Lagging tab B commits only the first change, restoring an older row state.
3. A advances shared resume metadata to position 2 with an empty batch or a
   batch affecting another key. The affected row stays stale.
4. Both tabs restart beyond the missing corrective change, so catch-up cannot
   repair the row.

Atomic rows and metadata within each commit do not establish that commits from
separate streams describe one source history. Keeping the maximum offset still
permits stale row writes. Suppressing empty commits misses disjoint-key batches.
Physical key integrity also cannot certify source progress.

The two reset traces exposed a separate oracle checkpoint defect. Final delivery
could first fail a reset-abandoned transaction after the initial restart sweep.
The driver now compares that failed state, restarts the newly failed source,
and completes delivery before judging convergence. This preserves the failure
contract; it does not weaken the source-head comparison.

All four reported traces pass through the shared model, driver, and comparison:

| Trace | Seed | Shrink path |
| --- | --- | --- |
| Original reset/deploy | `-1115798760` | `1:4:3:3:3:3:3:3:3:3:3` |
| Missing row | `-1660880085` | `55:0:1:4:4:4:1:1:1:1:3:4:4:4:4` |
| Resurrected row | `-699129038` | `78:2:0:3:9:12:12:13:12:13:13:13:13:14:14:14` |
| Reset without deploy | `-1371495859` | `75:0:0:0:0:0:0:1:1:0:0` |

## Repair

Each eager Electric commit supplies an opaque source progress token and its
expected predecessor through an optional persistence capability. The token
contains shape identity, handle, and offset. SQLite compares the predecessor
under its existing writer lock, atomically with rows and resume metadata.
A discontinuity makes source progress evidence incompatible until an
authoritative full replacement. A repeated complete endpoint preserves existing
evidence: it neither invents nor clears a gap. Provider handles need no ordering.

Startup uses existing full-snapshot recovery when progress is missing, foreign,
or incompatible. This recovery overrides explicit caller positions because an
offset cannot supply missing baseline rows. An interrupted eager replacement's
durable reset requires the same recovery on the next start. Both recovery
admission and effective source position honor that obligation. Other sync modes
retain their explicit-position behavior.

Source progress evidence has its own SQLite column and remains separate from
physical key integrity. A cached-row counterexample rejected combining them:
cached rows must remain visible during recovery. The additive migration also
covers existing databases. Arrival-order writes and their receipts remain.
Custom adapters advertise the optional capability only with an atomic check.

## Evidence

Each behavioral extension ran against unchanged production before its repair.
Setup failures and surviving mutants are excluded from the RED evidence.

| Experiment | RED before its corresponding repair | Repaired GREEN / calibration |
| --- | --- | --- |
| Source continuity | Browser seed `2281`, path `0:0:0:0`, loses row 1 on `82c5f999b`; SQLite accepts missing gap evidence. Real receiver: four wrong-row failures and four passing draining controls. | Full SQLite owner: 61 passes. Browser restart and tab reopen converge. Ignoring durable gaps fails SQLite, Browser, and real disjoint-advancement comparisons. |
| Startup provenance | Missing/foreign tokens cannot justify the cached baseline. | Bypassing validation fails Browser and both real legacy-token cells. Rejecting duplicate endpoints separately fails SQLite at seed `2281`, path `0:7:1:2:2:2:2:2:2`. |
| Explicit caller positions | Extended Node campaigns fail; eight real numeric/`now` cells fail while initial-offset and handle-only controls pass. | Requesting recovery while preserving the raw caller position still fails the shared final comparison. Correcting both decisions passes. |
| Interrupted replacement | Paired Node campaigns fail at seed `2281`, path `1:0:0`, and random seed `-636405297`, path `14:0:0:0:0`. Four real numeric/`now` cells fail; six none/initial/handle controls pass. | All 30 real receiving cells pass. Keeping reset admission but removing its effective-position override fails the same Node replay; exact restoration passes. |
| Final reset checkpoint | Original production and driver reproduce both reported reset mismatches. | Corrected checkpoint passes on original production. Removing only the final restart/delivery block fails both reset replays. |
| Stop/peer coverage | CI reached SDK-give-up followed by peer commit zero times. | Constructed stop blocks establish every required stop boundary. Removing SDK-give-up abandonment fails a public-row assertion at seed `952051961`, path `1:0:0:0:0:0:0:0:1:1:0:0`. |

Final implementation verification: complete Browser owner, **312 passes and two
tracked expected failures**; all **30 real receiving cells** pass. Electric
checks report 336 and 97 passes across two commands, without type errors.
Browser TypeScript, capability validation, Electron IPC, replay selection,
`pnpm lint:changed`, and whitespace checks pass. Documentation checking reports
zero new failures across 806 examples. Every temporary mutant was restored;
the final Electric source SHA-256 is
`46a417f2d65ccc21adcc72f56d80388d6f2f9fc32a172ab6e3fa1e4702508047`.

### Independent judgments and exercised paths

| Owner / driver | Independent judgment | Production path and observation cut |
| --- | --- | --- |
| Browser multi-tab oracle | Server snapshot log, shared source-head comparison | Real Collections, Browser coordinator with Node BroadcastChannel/Web Locks, native SQLite, controlled Electric stream; durable/public rows and health after each step and complete recovery/delivery. |
| SQLite resume-snapshot oracle | Path of opaque predecessor edges since the last authoritative replacement | Runtime capability, SQLite writer transaction, migration and resume snapshot; compatibility evidence after every durable transaction. |
| Real receiver for the Browser law | PostgreSQL source head, same shared comparison | PostgreSQL → Electric HTTP → installed SDK → Chromium Collections → OPFS SQLite; actual earlier responses held before delivery and reopened rows compared after catch-up. |

The real matrix retains ten original/legacy, ten explicit-position, and ten
interrupted-recovery cells. Every cell requires held earlier response, stale
commit, later advancement, and reopened comparison. Interrupted cells observe
an actual durable reset before stopping replacement. No fabricated SDK messages
or offsets enter this driver. These are finite receiving witnesses.

The source-prefix property uses 80 fixed-seed inputs and 80 random inputs. Each
input runs uninterrupted and interrupted neighbors: 160 histories per campaign.
Axes include membership, 1–3 toggle pairs, swapped source roles, empty/disjoint
advancement, draining, restart/reopen, token provenance, and five caller forms.
Numeric noninitial offsets without handles are SDK-invalid and excluded.
SQLite uses 80/80 inputs, 3–16 actions plus replacement, with stale/matching/empty
commits, duplicate endpoints, replacements, and old-schema migration.

Final measured source-prefix and SQLite reaches:

| Declared state | Fixed / random histories |
| --- | ---: |
| Present row / empty advancement | 28 / 26 |
| Present row / disjoint advancement | 22 / 14 |
| Absent row / empty advancement | 12 / 34 |
| Absent row / disjoint advancement | 14 / 18 |
| Drained before recovery | 84 / 68 |
| Missing progress token | 52 / 64 |
| Foreign progress token | 42 / 56 |
| Divergent same-Collection restart | 50 / 52 |
| Divergent tab reopen | 26 / 40 |
| Divergent explicit numeric resume | 20 / 12 |
| Divergent explicit `now` | 14 / 16 |
| Explicit initial offset | 34 / 42 |
| Explicit handle | 42 / 32 |
| Interrupted reset before numeric resume | 10 / 6 |
| Interrupted reset before `now` | 7 / 8 |
| SQLite discontinuity | 61 / 53 |
| SQLite matching commit after discontinuity | 37 / 42 |
| SQLite replacement after discontinuity | 44 / 36 |
| SQLite duplicate endpoint | 64 / 61 |
| SQLite legacy migration | 34 / 39 |

The broader lifecycle property retains 80 accepted inputs per campaign. Four
constructed stop blocks precede 8–24 arbitrary actions, for 32–48 actions.
All four stop kinds cross a distinct peer commit and recovery. Final fixed/random
stop-boundary reaches are 81/80, including one fixed history later discarded
under the existing #2267 gap. Final-catch-up reset recovery reaches 4/2.
All other declared reaches pass. No comparison, exclusion, minimum reach, or
run budget was relaxed.

### Review corrections

Four independent reviewers found an unreachable focused restart branch and
replay registrations that ran unrelated campaigns. Actual-path instrumentation
first measured restart 0/reopen 38 and failed. Adding a stop made restart
reachable; gap and provenance mutants then failed that path. The original
row-loss trace already supplied a pre-production same-Collection restart RED;
the focused campaign's restart repair occurred later. Replay probes in both
Browser directions, unrelated-property selection, and SQLite selection verify
that only the requested campaign runs.

Later CodeRabbit reviews identified the explicit-position and interrupted-reset
gaps above. The latest completed external review covers `124ce667c`; automatic
review is paused. Subsequent eager reset semantics have independent local
source review plus the generated, real receiving, and mutant evidence above.
The lossless task-local audit retains 30 items: 12 fixed, five refuted, one
accepted design, and 12 duplicates. No known in-scope source-progress finding
remains open. CodeRabbit supplied useful defect and maintenance findings;
its one-clause recovery suggestion was incomplete, as the mutant demonstrates.

The rubric evidence is concentrated in the contract/model/path distinctions,
measured legal histories, calibrated comparisons, isolated replay, and retained
failure diagnostics. Cleanup attempts every release and preserves the primary
violation alongside cleanup failures; injected combined failures verify this.
Fixed examples use the shared oracle without separate expected answers.

## Cost and limits

The production delta is 153 net source lines across five files. Against
merge-base `672684846`, independently compressed package bundles grow by
DB +37, SQLite core +368, and Electric +168 gzip bytes: **573 bytes total**.
The standard application fixture adds 45 bytes but does not use Electric or
SQLite, so it does not measure their application cost. The repair adds one
metadata read per qualifying incremental source-progress transaction, stored
continuity evidence, and token processing. Runtime overhead was not benchmarked.
Incompatible progress can require a full source snapshot.

The evidence covers bounded, same-version eager sources sharing SQLite. It
does not establish arbitrary schedules, mixed versions, monotonic intermediate
writes, on-demand subsets, optimism, native/Electron receiving, individual
receipt fulfillment, or clean teardown. Explicit changed-shape/malformed/tagged
resumes, arbitrary cursor selection over certified rows, other modes' reset
policy, changing caller forms within one history, and real foreign-token
receiving remain outside the claim. The coverage map names remaining witnesses.

The permanently closed lagging-source history in #2209 remains a tracked
expected failure. The #2267 partial-update guard preserves the safety contract;
its no-error composition expectation remains a separate contract question.
The first #2281 comment's seed-row-metadata defect, #2272 metadata receiving,
and the pilot's replay/reset scheduling and teardown gaps retain separate owners.
The independent cluster report confirmed this repair's mechanism and led to a
separate reach for reset recovery first discovered during final catch-up.
It did not combine those other boundaries with source-progress recovery.

CI on implementation `0ec58057d` passed 25 checks after one failed-job rerun.
Its original observer cleanup/restart defect also reproduces on clean current
main `bea84cd45`; the aggregate ordering reach gap is tracked in #2289. The
maintainer chose to keep #2298 focused. Observer evidence was sent to the
“Survey open issues and PRs” chat; both issues remain open. A passing retry
closes neither. CodeRabbit's skipped check reflects its paused review.

## Reproduction

Run from the repository root with two workers:

```sh
pnpm --filter @tanstack/browser-db-sqlite-persistence exec vitest --run \
  tests/multi-tab-electric-oracle.test.ts --maxWorkers=2 --coverage.enabled=false
pnpm --filter @tanstack/db-sqlite-persistence-core exec vitest --run \
  tests/sqlite-resume-snapshot-oracle.test.ts --maxWorkers=2 --coverage.enabled=false
pnpm --filter @tanstack/browser-db-sqlite-persistence exec playwright test \
  --config playwright.opfs-electric.config.ts \
  electric-source-prefix-oracle.opfs.spec.ts electric-resume-two-tab.opfs.spec.ts \
  --workers=2
```

For a reported trace, set `TANSTACK_DB_ORACLE_PROPERTY=browser.multi-tab-reserved-history`
and its seed/path from the first table; select `-t 'random or replayed'`.
For the final source-prefix replay, use property `browser.electric-source-prefix`,
seed `2281`, and path `1:0:0` with the same selector. Fixed campaigns stand aside
during path replay. Normal campaigns require no replay variables.

Final local runs used `pnpm_config_verify_deps_before_run=false` after upstream
release-specifier changes triggered automatic reinstall. Installed external
dependencies were unchanged. No override or lockfile workaround accompanies
this PR. Raw logs and the complete review ledger remain task-local under
`notes/issue-2281/`; essential evidence is summarized here and preserved in the
linked historical record.
