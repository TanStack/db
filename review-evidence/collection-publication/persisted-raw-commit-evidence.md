# Persisted raw commit receiving evidence

## Authority and predictions before the driver revision

The maintainer resolved the boundary in this task:

> I think raw collection subscribers seeing raw commits is expected. Live
> queries are a higher level abstraction (and you can subscribe to them if
> you want something coherent at that level).

The revised law exposes every applied source transaction through raw
Collection reads and full-state raw subscriber folds. A load result does not
hold an applied transaction private. Rejection of that load does not retract
an applied transaction. No new adapter API or applied-receipt meaning follows.

Distinguishing history: initial `a=0`; source truncate applies; replacement
`a=1` applies while its load is held; the load later rejects.

| Cut | Earlier snapshot law | Clarified raw commit law |
| --- | --- | --- |
| Applied truncate; provider not yet writing candidate | Reads and fold retain `a=0` | Reads and fold are empty |
| Applied candidate; provider result held | Reads and fold retain `a=0` | Reads and fold show `a=1` |
| Quiet load rejection after the applied candidate | Reads and fold retain `a=0` | Reads and fold still show `a=1`; error reports independently |

This change in authority, rather than current output, authorizes the new
model predictions. The shared model is owned by the core receiving agent.
This agent changes only the persisted production driver and this new report.

Prior evidence remains intact: `persisted-public-snapshot-evidence.md`, all
prior raw logs, frozen design grammar artifacts, and
`persisted-before-raw-commit-law.test.ts.txt`. They document the superseded
snapshot investigation and are not evidence for the clarified prediction.

## Receiving path and applied-prefix evidence

Base is `c351fc04d7f70dc59bf92ecbed310f899b9511cd`, in
`/Users/kyle.mathews/.codex/worktrees/collection-publication/tanstack-db`.
Production remained unchanged for these executions. Only the persisted test
and this new evidence report were revised by this agent.

The receiving test is
`packages/db-sqlite-persistence-core/tests/collection-public-snapshot-persisted-oracle.test.ts`.
It imports the shared model, arbitrary, examples and check; it adds no alternate
expected-result computation. `PublicSnapshotCommit` records fixture-authored
source transaction effects. Actual reads never choose the applied prefix.

The real `persistedCollectionOptions` wraps a source over the existing
`createRecordingAdapter` in-memory host. A provider gate now prevents candidate
submission until after the real truncate receipt fulfills. The driver appends
the authored truncate to the applied prefix and compares the raw empty snapshot.

The candidate transaction writes authored rows plus a metadata hold selector.
In the actual wrapper, without a persisting optimistic transaction,
`applyBufferedSyncTransactionUnsafe` calls `applyToCollection` and waits for core
application before persisting (`persisted.ts:4477–4502`). Thus entry to that
tagged durable operation establishes application of the authored candidate,
even though the wrapping source receipt still waits for durability. This exact
wrapper path is the receiving premise, not an inference from public row output.
The candidate enters the shared model's applied prefix at that boundary.

The source's loader awaits the real wrapped applied receipt before it can
return. The fixture holds the durable operation, queues
`metadata.persistence.scanPersistedRows()` behind the same real apply mutex,
observes raw reads/fold, releases durability, observes receipt and scan progress,
then holds the provider return independently. Rejection is an actual source
load rejection whose exact error reaches `loadSubset:error`. No receipt is
withheld artificially by core, and no adapter API changes.

## First unchanged-production result

`persisted-raw-commit-first-red.{stdout,stderr}.log`: exit 1, two registered
campaigns failed their first shared example; 18 ms tests, 1.90 s total.
The fixed seed is `30102026`; the random seed is `-1113777389`; both shrink
paths are `0`. Normal budgets remain 12 generated histories plus all eight
shared examples per campaign. A first-example RED stops each campaign before
generated rows; no full fixed/random campaign success is claimed.

First history: initial empty, candidate `a=1`, load eventually resolves.
The truncate-only comparison agrees. At `durable-held-before-receipt`, the
applied prefix is `[truncate, insert a=1]`; direct values, entries, exposed base,
finite-domain `get` and size all agree with the shared model. The full-state
raw subscriber fold is still empty. The exact first failure is:

```text
held: full-state subscriber fold:
expected [] to deeply equal [ { id: 'a', value: 1 } ]
```

At that cut the real wrapped receipt and replay completion are pending, and the
queued persisted scan has not entered. After durable release, the receipt
fulfills and the scan enters and settles while the provider/replay remain held.
The raw fold still disagrees. After successful load completion, the fold catches
up and the shared comparison agrees. These are notification assertion REDs,
not timeouts or a failure to make receipt/mutex progress.

## Neighboring direct replays

Both use seed `30102026` and run only the random registration; the fixed
registration stands aside. Each executes one shared history with the final raw
commit test names.

| Replay | History and first mismatch | Other measured cuts | Result |
| --- | --- | --- | --- |
| Path `1` | Initial `a=0`, empty candidate. Immediately after applied truncate, direct reads are empty but subscriber fold retains `a=0`. | Real candidate receipt pending/scan blocked; later receipt fulfilled/scan crossed; successful final fold empty. | Assertion RED, exit 1, 16 ms tests / 1.75 s total. |
| Path `4` | Initial empty, candidate `a=1`, load rejects. First candidate cut has direct `a=1` and fold empty. | Same receipt/mutex progress; quiet failed cut still has the wrong empty fold; exact provider error reported. | Assertion RED, exit 1, 16 ms tests / 1.69 s total. |

Raw pairs are `persisted-raw-commit-replay1.{stdout,stderr}.log` and
`persisted-raw-commit-replay4.{stdout,stderr}.log`. No timeout or setup failure
occurred. The first violated assertion stays the AggregateError cause; later
assertions and any separate progress/cleanup diagnostics remain distinct. The
stdout trace records each applied prefix and copied numeric row observation
before cleanup.

## Exact execution commands

From the worktree, the normal runtime command was:

```sh
/Users/kyle.mathews/.n/bin/node /Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-replay-latest-main-v3/node_modules/.pnpm/vitest@4.1.12_@types+node@25.2.2_@vitest+coverage-istanbul@4.1.12_@vitest+ui@4.1.12_jsd_b90327b761ce141e1ae16ba35ba02577/node_modules/vitest/vitest.mjs run collection-public-snapshot-persisted-oracle --config review-evidence/collection-publication/vitest.persisted-public-snapshot.config.mts > review-evidence/collection-publication/persisted-raw-commit-first-red.stdout.log 2> review-evidence/collection-publication/persisted-raw-commit-first-red.stderr.log
```

Direct replays used that same executable/config/file filter with these exact
environment prefixes and corresponding `replay1`/`replay4` log destinations:

```sh
TANSTACK_DB_ORACLE_PROPERTY=persistence.collection-public-snapshot TANSTACK_DB_ORACLE_SEED=30102026 TANSTACK_DB_ORACLE_PATH=1
TANSTACK_DB_ORACLE_PROPERTY=persistence.collection-public-snapshot TANSTACK_DB_ORACLE_SEED=30102026 TANSTACK_DB_ORACLE_PATH=4
```

The private runtime config still merges the ordinary package config and aliases
DB, DB-IVM and persistence to this worktree's source. It replaces concatenated
include arrays, uses its own cache, and separates runtime from typechecking.

Ordinary package typecheck:

```sh
/Users/kyle.mathews/.n/bin/node /Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-replay-latest-main-v3/node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/bin/tsc --noEmit --project packages/db-sqlite-persistence-core/tsconfig.json > review-evidence/collection-publication/persisted-raw-commit-typecheck.stdout.log 2> review-evidence/collection-publication/persisted-raw-commit-typecheck.stderr.log
```

Result: exit 0; both raw logs empty. No diagnostic exclusions or dependency
installs were added.

Required oracle lint:

```sh
/Users/kyle.mathews/.n/bin/node scripts/agent-lint-feedback.mjs --format=text --event=stop packages/db-sqlite-persistence-core/tests/collection-public-snapshot-persisted-oracle.test.ts > review-evidence/collection-publication/persisted-raw-commit-oracle-lint.stdout.log 2> review-evidence/collection-publication/persisted-raw-commit-oracle-lint.stderr.log
```

Result: exit 0; both raw logs empty. All final source edits precede this check;
the ordinary typecheck and two neighboring replays also use the final source.
The normal first-RED run precedes only a test-title correction; its driver,
model and comparison are the final ones.

The inherited ordinary Vite plugin still prints missing Expo tsconfig-base
warnings. Those warnings did not prevent fixture entry, comparisons, progress
or cleanup. They are not credited as product failures.

## Measured reaches

All previous six states remain. The new `raw-truncate-applied` state has its
own cut. Counts below are histories that actually reached each state, not the
configured sampling budget.

| State | Fixed first RED | Random first RED | Replay 1 | Replay 4 |
| --- | ---: | ---: | ---: | ---: |
| Raw truncate applied | 1 | 1 | 1 | 1 |
| Real wrapped candidate receipt pending | 1 | 1 | 1 | 1 |
| Real mutex scan held | 1 | 1 | 1 | 1 |
| Held public observation | 1 | 1 | 1 | 1 |
| Receipt and mutex progressed | 1 | 1 | 1 | 1 |
| Quiet failed public observation | 0 | 0 | 0 | 1 |
| Successful publication observation | 1 | 1 | 1 | 0 |

The state names retained from the earlier draft now label acquisition cuts,
not permission to withhold raw source transactions. Shared model prose states
that mapping. No budget or comparison was narrowed to make a run pass.

## Evidence block and limits

- **Law:** clarified raw commits authority and old/new predictions above.
- **Reach:** measured seven-state table, real wrapper, receipt and mutex cuts.
- **RED:** unchanged production fails notification agreement after applied
  truncate/candidate commits and after quiet load rejection.
- **GREEN:** ordinary package typecheck and required oracle lint only; no
  repaired production GREEN exists or is claimed.
- **Mutant:** no production mutant authored. Current raw callback buffering is
  the plausible wrong rule rejected by the shared comparison. A production
  repair still owes repaired GREEN and a hostile mutant before class closure.
- **Limits:** one retained whole-source raw subscription, one replay, one
  candidate transaction; default coordinator and in-memory persistence host.
  Native SQLite, optimistic overlays, independent scoped peers, cache claims,
  scoped recovery, cleanup/restart and cross-Collection/query coherence are
  outside this receiving witness. No production edits, installs, commits,
  pushes, new adapter APIs or receipt-law changes occurred.

## Oracle rubric status

ORC-001–003: new authority is explicit, the imported shared applied-prefix fold
is independent, and the receiving file explains law, grammar, path and cuts.
ORC-004: shared grammar/examples and budgets are unchanged; execution stops at
first RED, with two direct structural replays. ORC-005: complete public reads
and raw subscriber fold are compared at real application cuts. ORC-006: the
original buffered notification design is rejected at those assertions; no
mutant result is claimed. ORC-007: equal fixed/random campaigns remain
configured; seed/path direct replay works; full campaigns remain RED.

ORC-008: this driver adds no state to the shared model. ORC-009: authored applied
prefixes and acquisition-cut phase labels use the shared mapping. ORC-010:
the first failure, immutable observations, secondary diagnostics and cleanup
are preserved. ORC-011: no newly named shared semantic fault needs a second
formulation; read/fold observations are one law, not independent models.
ORC-012: this bounded report claims no bug-class closure. ORC-013: nonempty
truncate and successful/rejected candidate neighbors distinguish the raw
boundary from replay-success buffering. ORC-014: the actual wrapper receives
the controlled durable delay; native storage claims remain outside this path.
ORC-015: seven declared states have the measured counts above. ORC-016: both
registrations use the shared grammar/driver/check; fixed examples have no
private expected result.
