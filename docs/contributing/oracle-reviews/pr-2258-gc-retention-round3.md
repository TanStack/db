# Collection GC: interaction and receiving-path evidence

This is an append-only third evaluation of PR #2258. The baseline is
`d0618586aa7d033b70de53f6e20598bb39b71147`; the evaluated test sources are bound by
`round3.sha256` in [the source record](pr-2258-gc-retention.sources.json).
The commit that first adds this report is the evaluated revision. Historical
reports retain their own claims and limits.

## Law, authority and experiment

`BaseCollectionConfig.gcTime` retains each Collection while any touching
transaction persists. The transaction-ownership oracle additionally requires
settlement notification to every Collection that admitted a transaction, even
when its mutations later merge away. Cleanup starts by discarding public rows;
its promise and final status wait for adapter settlement, including rejection
with `SyncCleanupError` whose cause is the adapter failure. The glossary,
`Collection.cleanup()` and the cleanup-restart oracle own this split.

The maintainer's earlier decisions remain in force: pending manual rollback
preserves its deadline, pending drafts require a caller subscription for
visibility, restart after GC owes no discarded-draft restoration, and exact
first-usable-idle retirement remains a controlled fixture assumption. Explicit
cleanup overrides retention. Automatic cleanup waits for eligibility first.
This round introduces no new product promise and changes no production source.

All four requested improvements use the existing independent logical-hold
reference. Expected deadlines use logical releases and the absolute startup
handoff deadline, never production timers or classifiers. The mutation driver
adds an independent projection of known source rows and declared update/delete
intent. Actual mutations prove path reach only; they do not compute expectations.

1. **Interaction grammar:** preserves all 15 focused lanes and adds constructive
   6–14-action suffixes, up to seven transactions and three subscribers. A prefix
   removes one of two subscribers before crossing the unheld deadline, then
   combines delayed commit, three persisting siblings, non-FIFO settlement and
   preload between releases. All emitted actions are checked for legality.
2. **Automatic cleanup:** generates both held and rejecting adapter cleanup after
   independent deadline-minus-one/deadline cuts. Zero-budget idle cannot start
   cleanup. Usable delivery must invoke the adapter before the driver joins the
   public cleanup promise. Pending-sibling rollback checks row discard while
   cleanup waits and after it settles. The first draft expected a raw adapter
   error; that expectation contradicted the established cleanup wrapper. The
   corrected oracle checks `SyncCleanupError` and exact cause. This was an oracle
   authoring error, not a production RED.
3. **Mutation admission:** direct update/delete handlers, shared update/delete,
   and a shared insert/delete pair that merges away on one Collection while a
   peer update keeps a genuine persisting transaction. Both orientations,
   completion/failure/rollback, absent/final-unsubscribed owners, gcTime
   1/10/49/50/51/100ms, ages 0–80ms and values −3…3 are generated. A fully empty
   transaction settles synchronously and cannot stand in for persistence.
4. **Real provider siblings:** four original one-write paths plus eight paths
   crossing gcTime 10/100ms, absent/final-unsubscribed owners and both local
   settlement orders. Separate PostgreSQL connections keep assigned transactions
   genuinely open. After one COMMIT and genuine Electric acknowledgement, the
   sibling stays SQL-open, unacknowledged, persisting and caller-pending beyond
   the first-release deadline. PostgreSQL txid allocation order is independent
   of the recorded local optimistic order.

Removing subscriber multiplicity permits premature collection with a surviving
subscriber. Removing cancellation permits ownership to depend on surviving
mutations. Removing a failure outcome permits success-only renewal. Removing
held cleanup loses the intermediate discard/status cut. Removing the second
provider writer admits a first-release implementation. The grammar rejects
settlement of an absent or already-settled slot, unsubscribe without a subscriber,
and commit of a non-pending transaction. Source projection cannot waive cleanup's
empty-row obligation. Fixed checker controls reject missing, extra, stale and
duplicate membership.

## Executed evidence

The six-file focused integration command ran the boundary and mutation
properties, the original two-Collection property, checker calibration,
cleanup-restart and transaction ownership:

```sh
pnpm --dir packages/db exec vitest run tests/collection-gc-retention-oracle.property.test.ts tests/collection-gc-mutation-oracle.property.test.ts tests/collection-gc-transaction-oracle.property.test.ts tests/collection-gc-retention-oracle.test.ts tests/collection-cleanup-restart-oracle.test.ts tests/transaction-ownership-oracle.property.test.ts --coverage.enabled=false
```

GREEN: six files, **70 tests passed**, no type errors. The boundary property runs
250 fixed-seed and 250 random histories with the same generator and checker.
Mutation admission runs 150 fixed-seed and 150 random histories. Both fixed
campaigns use seed `20261026`. The boundary mixture weights are 5:1:1 for focused
lanes, constructive interactions and automatic held/rejected cleanup. All
required states below reached their normal-budget minimum of one.

### Boundary reach

| Declared state | Fixed | Random |
| --- | ---: | ---: |
| `queued-idle-renewal` | 17 | 18 |
| `startup-release-before-floor` | 70 | 45 |
| `last-unsubscribe-short` | 43 | 36 |
| `pending-rollback` | 83 | 82 |
| `pending-does-not-hold` | 57 | 62 |
| `sibling-persisting` | 108 | 87 |
| `preload-last-release` | 14 | 13 |
| `disabled-gc` | 11 | 13 |
| `delayed-commit` | 54 | 42 |
| `write-started-sync` | 5 | 5 |
| `late-release-short` | 64 | 61 |
| `warm-preload-persisting` | 59 | 34 |
| `warm-preload-queued-idle` | 14 | 9 |
| `warm-preload-repeated` | 46 | 25 |
| `preload-failure-held` | 6 | 9 |
| `preload-failure-last` | 15 | 10 |
| `sibling-oldest-first` | 45 | 38 |
| `sibling-newest-first` | 78 | 57 |
| `async-cleanup-settlement` | 19 | 34 |
| `async-cleanup-pending-idle` | 51 | 71 |
| `retired-settlement` | 11 | 7 |
| `retired-sibling-held` | 11 | 7 |
| `pending-subscription-held` | 14 | 12 |
| `pending-last-unsubscribe` | 31 | 33 |
| `concurrent-preload` | 22 | 20 |
| `interaction-subscriber-multiplicity` | 47 | 25 |
| `interaction-delayed-commit` | 47 | 25 |
| `interaction-three-persisting` | 47 | 25 |
| `interaction-preload-between-settlements` | 47 | 25 |
| `interaction-nonfifo-settlement` | 47 | 25 |
| `automatic-cleanup-held` | 32 | 37 |
| `automatic-cleanup-pending-rollback` | 32 | 37 |
| `automatic-cleanup-rejected` | 13 | 21 |

### Mutation reach

| Declared state | Fixed | Random |
| --- | ---: | ---: |
| `direct-update` | 34 | 27 |
| `direct-delete` | 49 | 49 |
| `shared-update-delete` | 37 | 41 |
| `shared-cancel` | 30 | 33 |
| `cancelled-a-retained` | 14 | 22 |
| `cancelled-b-retained` | 16 | 11 |
| `no-subscriber` | 75 | 75 |
| `last-unsubscribe` | 75 | 75 |
| `retired-after-complete` | 59 | 54 |
| `retired-after-fail` | 46 | 49 |
| `retired-after-rollback` | 45 | 47 |

The original two-Collection property's seven required states also passed.
The independent read-only challenger reran the changed properties: 13 tests,
500 boundary histories and 300 mutation histories, all 33 and 11 states reached.
It inspected authority, model independence, legal histories, expected-key
projection, cleanup promise joining and provider premises. It found no supported
additional defect. Its fresh-key cross-product limit is retained below.

### RED calibration

No new production failure was found on the unchanged baseline. These deliberate
wrong implementations all failed intended assertions, rather than setup or
unrelated runtime errors:

| Mutant | Intended distinguishing failure |
| --- | --- |
| Retain only Collections with surviving mutations | Cancelled Collection retires while its shared transaction persists. |
| Retain only non-delete mutations | Direct delete loses its persisting hold. |
| Notify only surviving mutation Collections | Cancelled Collection retains a settled tracking entry. |
| Remove cleanup's optimistic-overlay fence | Pending-sibling rollback resurrects discarded rows during automatic cleanup. |
| Collapse subscriber count to one | Interaction prefix retires while a second subscriber remains. |
| Publish cleaned-up at automatic cleanup start | Held adapter cleanup exposes final status before settlement. |
| Real-provider retention only while more than one transaction persists | All eight real sibling paths retire after the first acknowledgement despite a genuine open survivor. |

Source-mutant commands ran the appropriate boundary or mutation test file with
`--coverage.enabled=false --typecheck.enabled=false`. Production edits were
serial and restored byte-for-byte in `finally` before GREEN verification.
The provider runtime mutant was a scratch driver, removed before final GREEN.
The first six are additional source calibrations; earlier reports retain their
11 source-mutant results. The provider partial-hold experiment is additional to
the earlier no-hold receiving mutant.

Guarded replay reproduced the automatic-status failure exactly, then passed the
same history after restoring production:

```sh
TANSTACK_DB_ORACLE_SEED=20261026 TANSTACK_DB_ORACLE_PATH=10:0:0:0:0:0 TANSTACK_DB_ORACLE_PROPERTY=collection-lifecycle.gc-retention-boundaries pnpm --dir packages/db exec node --import tsx tests/oracle-replay.ts tests/collection-gc-retention-oracle.property.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
```

Both runs execute one history through the guarded named property. The mutation
property also passed a guarded one-history replay. An initial invocation through
the `tsx` CLI failed on a sandbox IPC socket; that setup failure supplied no RED
evidence. The successful command above uses Node's `--import tsx` entry point.
The complete replay-guard suite passed **38 tests**, no type errors.

### Receiving paths and verification

Native Chromium: **3/3 histories passed** with the unchanged native receiver and
updated shared model/checker. Genuine Electric/Postgres: **12/12 paths passed**,
each reaching provider-confirmations-held, all-provider-writes-confirmed,
renewed-zero-budget and renewed-usable-idle once. Each of the eight sibling paths
also reached its settlement order and surviving-provider-hold-crosses-deadline
once. Each local settlement order occurred four times.

```sh
pnpm --dir packages/db test:collection-gc:browser
NO_PROXY=127.0.0.1,localhost ELECTRIC_URL=http://127.0.0.1:3000 pnpm --dir packages/electric-db-collection exec vitest run --config vitest.e2e.config.ts e2e/collection-gc.e2e.test.ts --reporter=verbose --maxWorkers=1
```

DB main/test and Electric TypeScript, changed-file oracle lint, focused ESLint,
Prettier and whitespace checks pass. The initial DB test-project command used
`tsconfig.tests.json`, which does not exist; the corrected `tsconfig.test.json`
passed. No install override or lockfile workaround was needed.

Production shipped bytes do not change in this round. The whole-PR size result
versus the merge-base on origin/main remains DB +85B gzip/+114B brotli and typical
app +84B gzip/+60B brotli. Test source and evidence growth are recorded separately
in the closing weight note. Local logs remain under `/private/tmp/pr-2258-round3`
and the provider/mutation round3 evidence paths; the source-bound observations
and commands above are the durable evidence.

## Rubric audit and limits

| Requirement | Outcome for this expansion |
| --- | --- |
| ORC-001 | Existing public retention, ownership and cleanup laws, plus explicit maintainer decisions; no new product rule. |
| ORC-002 | Shared logical-hold reference and independent source/intent row projection; actual rows never predict expected keys. |
| ORC-003 | Opening contract, model mapping, legal histories, driver and checkpoint prose remain beside executable code. |
| ORC-004 | Domains, reconstruction, ablation and invalid continuations are described above; original focused lanes remain. |
| ORC-005 | Direct handlers, manual shared transactions and genuine provider commits reach exact rows/status/phases/receipts at admission, held deadlines, settlement and renewed deadlines. |
| ORC-006 | Six source mutants and eight rejecting provider sibling cases at intended comparisons; projection checker controls preserve exact emptiness. |
| ORC-007 | Equal fixed/random budgets per property, guarded mutation replay and exact boundary mutant RED/restored GREEN replay. |
| ORC-008 | Existing cleaningUp state distinguishes a next cleanup-settle action; mutate aliases admission without another lifetime state. |
| ORC-009 | Model prose maps mutate/insert and idle cleanupPending to production admission and split cleanup boundaries. |
| ORC-010 | Primary comparison and secondary teardown failures remain separate; source/SQL fixtures are restored. |
| ORC-011 | No remaining concrete shared semantic-fault hypothesis requires another formulation; source intent independently projects mutation rows. |
| ORC-012 | This report binds the reviewed sources and reports finite claims, not universal closure. |
| ORC-013 | gcTime 1/10/49/50/51/100, deadline-minus-one/deadline, zero/usable idle, one/two subscriber and first/final release distinguish boundary mistakes. |
| ORC-014 | Shared native receiver and genuine provider sibling driver establish their premises separately. Combined native/provider scheduling remains unproved. |
| ORC-015 | All 33 boundary and 11 mutation states reach the required normal-budget minimum; provider reach is per path. |

All numbered requirements apply to some part of this expansion. ORC-011's
conditional second-formulation obligation has no remaining named hypothesis,
so no second lifetime model was added. The independent challenger is a strong
hire on this sample: it verified actual comparisons and provider premises,
reran normal budgets, and distinguished a missing cross-product from a defect.
There were no new review findings to discard or defer.

The bounded claim is retention and cleanup refinement across these generated
histories, core admission paths, native idle paths and real provider
acknowledgements. It does not establish every possible future behavior. Fresh
optimistic keys still exclude same-key rollback cascades and confirming-sync
queue interactions with GC. The Collection lifecycle GC owner in the coverage
map needs a combined generated witness before extending its claim there;
neighboring optimistic-history and transaction-ownership owners protect their
semantic parts independently. Other limits are three-or-more real provider
writers, provider failures/recovery, combined native browser/provider schedules,
persistence-wrapper combinations, paced/offline restoration, cleanup during
pending preload and arbitrary legal permutations. No concrete reachable
counterexample under the declared contract remains known from this round.

Round3 uncompressed source growth versus the baseline: tests/receiving drivers
31,235 bytes; documentation and registration 20,164 bytes
(before this closing note). Production growth: zero bytes. These source counts
are separate from the whole-PR shipped bundle measurement.
