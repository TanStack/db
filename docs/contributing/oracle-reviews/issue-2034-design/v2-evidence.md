# Temporal persistence v2: evidence and limits

Base: `e21c280f3c4e56f6c0d05ec0eed87db29c623489`, including #2002.
The implementation is an uncommitted worktree diff; file hashes below identify
the measured sources. Runtime: Node 24.19.0; core reopen uses node:sqlite 3.53.3;
the expression-index and shared adapter contracts use the real better-sqlite3
driver. Temporal fixtures use temporal-polyfill 0.3.0.

## Executed observations

| Check | Result |
| --- | --- |
| Expanded initial reopen oracle against unchanged production | 13 passed, 15 failed: the original eight Temporal failures plus new precision/calendar/constructor cases. |
| Targeted expanded witnesses against original production files (before the final routing and scalar-index additions) | 33 assertion failures, 1 passing control, 432 unselected tests. Two failures observe permanent wire rejection retried four times; twelve observe native action-history loss; seven observe native query/constructor loss; twelve observe index/query/metadata failures. All original production files were temporarily restored from HEAD and the repair was restored in a finally block. |
| Correct reconstruction with deliberately lexical native order keys | 8 assertion failures, 5 passing selected cases. Nanoseconds, supported-range endpoints and calendar order/equality distinguish this wrong design. Native decoding remains intact; both final query results and raw SQL results reject the mutant. The codec was restored byte-for-byte. |
| Intermediate plain-data boundary controls | The uncorrected independent IN key sets lose the native row under NOT IN; whole-record escaping loses a nested-field query. Both fail at their public key checkpoints, then pass with paired membership and marker-field escaping. |
| Late routing admission | Two native leader-to-follower witnesses fail with five coordinator calls each before the final admission repair. After removing the duplicate hydration dispatch and validating newly remote demand, all four native rejections and both valid string controls pass. |
| Membership index compatibility | The first new string-index witness reaches DDL and rejects because SQLite forbids a subquery in an index expression. This is a DDL failure, not an assertion-mutant kill. Equivalent balanced OR clauses pass both the two-value and 1,025-value named-index witnesses. |
| Final affected owner suite | **471 passed, 1 existing TODO, 0 failed** across six test files. Includes both existing fixed and random oracle campaigns, Collection event tests, shared core contract/binding-cap checks through the Node driver, resume snapshots, ordinary transaction work, persisted wrapper histories and expression-index planning. |
| TypeScript | Passed for changed source and the typed-value, transaction, wrapper and expression-index owners, using source/dependency aliases. |
| ESLint | Passed with zero errors; 25 existing require-await warnings in the transaction/wrapper owners remain. |
| Formatting and diff whitespace | Changed TypeScript files formatted; diff whitespace check passed. |

Final suite command (local cached tools):

```sh
/Users/kyle.mathews/programs/tanstack-db/node_modules/.bin/vitest run \
  --config /private/tmp/temporal-owners-vitest.config.mjs \
  --reporter=json --outputFile=/private/tmp/temporal-owners-final.json
```

The configuration aliases DB, db-ivm and persistence to this worktree's source.
Dependencies come from the existing checkout because a clean installation was
blocked by registry failures earlier in the task. No prebuilt TanStack package
supplies the tested implementation. This is not a full monorepo test run or a
verified clean dependency installation.

## Owner mapping and bounded claim

- **Typed-value owner:** actual file close/reopen; direct/nested rows, row and
  collection metadata, replay, rank/text families, equality/range/Boolean/IN,
  901-value IN, field comparison, cursor tie groups and continuation, ordered
  windows, constructor errors, malformed native brands and marker-shaped data.
  Its native observations compare kind and text, not empty enumerable state.
- **Expression-index owner:** the same independent rank/text families drive
  captured SQL before cleanup, final adapter keys and actual named-index use.
  Wrapper-created coalesce indexes additionally observe native metadata literals
  and distinct signatures for adjacent native constants. Native IN retains one
  bound JSON parameter. Existing exact scalar SQL and plan laws remain.
- **Ordinary transaction owner:** twelve bounded native histories cross the
  six value families with success/late rollback, repeated actions, metadata and
  rejection of an invalid native action hidden by a later valid overwrite.
  Its existing Map reducer retains immutable native values; its new observation
  compares kind/text and demonstrates structuredClone would erase the premise.
- **Persisted wrapper owner:** four rejection witnesses plus two string controls prove rejected native
  remote-subset literals cannot enter the retry queue or call the upstream
  loader. Both immediate routing and a leader-to-follower transition during hydration are reached; admissible string requests dispatch exactly once. Existing transient retry, receipt, fail-stop and FIFO laws still run.

This closes the reported silent loss for the two supported kinds through the
reached shared-core and local-wrapper paths and the bounded histories above.
It is not a universal proof. Other Temporal kinds reject. Native-engine
constructors, multiple constructor providers, native mobile/browser receiving
runs, multiprocess row transport, crash recovery and native truncate/delete
histories remain unproved and are assigned in the coverage map. Ordering
requires compatible same-kind operands; arbitrary Temporal arithmetic or
date-extraction expressions are outside this repair. No performance latency
claim follows from index-plan or statement-count observations.

## Oracle guide audit

| Requirement | V2 evidence |
| --- | --- |
| ORC-001 | User-confirmed native reconstruction, existing query/index/transaction laws, and explicit type/route limits in the model and executable prose. |
| ORC-002 | Fixture ordinals and literal kind/text expectations; existing independent Map reducer; no production SQL/comparison helper computes expected results. |
| ORC-003 | Existing owners retain contract/model/grammar/driver/checkpoints; the shared temporal-value-oracle companion owns the rank/text fixtures. |
| ORC-004 | Six named families reconstruct precision, signed years, endpoints and calendar ties. Kind/history/index axes retain the initial sixteen cells; Boolean/IN/coalesce/constructor cases distinguish adjacent wrong designs. No invalid ordering history is silently classified as valid. |
| ORC-005 | Real file SQLite, real better-sqlite3, Collection metadata/wrapper entry points, raw SQL, plans and observed coordinator calls. |
| ORC-006 | Original-production assertion failures, lexical-key mutant, ambiguous-IN and record-path controls; no timeout/setup failure counted as a kill. |
| ORC-007 | New coverage is bounded enumeration, so new random campaigns are not required. Existing generated owners retain and execute their fixed/random campaigns and replay interfaces. |
| ORC-008 | No new state machine. Immutable value retention preserves native kind/text that structuredClone would merge into empty records. |
| ORC-009 | Case ranks and kind/text projections are explicitly model-only; runtime terms remain the repository's terms. |
| ORC-010 | Existing owner cleanup and replay machinery retained; controlled source replacements restore in finally blocks. File harness cleanup remains under afterEach. |
| ORC-011 | Independent rank and canonical-text formulations separate ordering from equality. The lexical mutant proves lossless strings alone cannot satisfy the query law. |
| ORC-012 | This versioned record preserves base, results, limitations and exact source hashes. |
| ORC-013 | Adjacent nanoseconds, calendar-equal order with different equality, supported endpoints, lookalike strings, repeated invalid writes and an actual named-index checkpoint distinguish the claimed boundaries. |
| ORC-014 | Real Node SQLite supplies the storage/plan premise. Native mobile/browser and multiprocess receiving claims are explicitly unresolved. |

## Code weight

Production changes are additive because the existing code has no native codec,
native SQL representation, or type-preserving index metadata path to simplify.
The repair adds no scheduler, queue, retry state, lifecycle or codec registry.
Code weight is reported separately from tests and documentation below.


## Remaining ownership

| Unproved boundary | Owner and required witness |
| --- | --- |
| Engine-native or alternate registered provider | Typed-value owner: the same reopen/brand/precision fixtures in those runtimes. |
| Mobile/browser native SQLite reception | Each adapter's receiving contract: native row/metadata/replay roundtrip after a real host reopen. |
| Multiprocess native row transport | Browser/Electron coordinator receiving owners: native values through actual wire/structuredClone and both producer/receiver observations. No support is claimed here. |
| Native truncate/delete and crash histories | Typed-value plus ordinary-work/resume owners: native tombstones, rollback, baseline/replay and real restart checkpoints. |
| Format generations and old marker-shaped records | Typed-value/resume owners: frozen old bytes and explicit rebuild paths; an old record exactly imitating a newly reserved native tag is not a proved compatibility case. |
| Wider lifecycle schedules | Existing persisted owner: native demands across release/abort, ownership change and reset. The current new routing witnesses cover immediate routing and one controlled leader-to-follower cut. |

## Measured change weight

The following counts include all untracked task artifacts and the frozen v1
records, measured against the base. Added/deleted lines are distinct from net
weight; formatting changes are included.

| Category | Added | Deleted | Net |
| --- | ---: | ---: | ---: |
| Production | 265 | 37 | +228 |
| Tests and fixtures | 1313 | 53 | +1260 |
| Documentation, including design/evidence | 1563 | 0 | +1563 |
| Dependency manifest/lock | 5 | 1 | +4 |

## Tested source hashes

SHA-256 identifies the uncommitted source that produced the final green report.
The test reports/configuration under `/private/tmp` are local execution receipts,
not portable checked-in tooling. All six test-file counts are recorded below.

| Test file | Cases |
| --- | ---: |
| persisted-oracle.test.ts | 269 |
| sqlite-resume-snapshot-oracle.test.ts (includes ordinary transaction work) | 49 |
| sqlite-temporal-value-oracle.test.ts | 29 |
| expression-index-oracle.test.ts | 66 |
| node-sqlite-core-adapter-contract.test.ts | 33 |
| collection-events.test.ts | 26 |

- `packages/db-sqlite-persistence-core/src/persisted.ts`: `95a205e968087775da9dd9ad895192f6b8d437f105dd9863d85d851e6f06319a`
- `packages/db-sqlite-persistence-core/src/sqlite-core-adapter.ts`: `046cd875bb0f457072979de2f31a0e5ea2c7136007ce8a60b2a58dcda3fa3495`
- `packages/db-sqlite-persistence-core/src/sqlite-value.ts`: `3a6f1a281bd67c5585740bce289ec42c9803cff1e3c1c0a51aa05dec0972eaff`
- `packages/db-sqlite-persistence-core/tests/ordinary-transaction-work-oracle.ts`: `e3a7fc817abdeff689271e21751ecca359230598618138ba23d16c4a4d14107e`
- `packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts`: `96575030d69bce4668c1d91e7cc8cc943656888c40d44b7d0f907e907a70f9e1`
- `packages/db/src/collection/indexes.ts`: `f88d72741341a4973d3ee74088333821bee80fb6701d006df2d025fc9f153550`
- `packages/db/src/index.ts`: `1a9fe7be53366621c71899793397c3615c990023412106f746756e4e1ed53252`
- `packages/node-db-sqlite-persistence/tests/expression-index-oracle.test.ts`: `eb5804034b2becc1bb535cfb75a18a1bb5c32d7f6fba653a60d659a530844235`
- `packages/db-sqlite-persistence-core/tests/sqlite-temporal-value-oracle.test.ts`: `1721f687513c663361de844e26cb01df8792289ba6e34d5afdfa28e22e8be0e0`
- `packages/db-sqlite-persistence-core/tests/temporal-value-oracle.ts`: `08760fd1f28cf7d72b107bec4daf2aa07cc043f81b05e1f23708ace36fbcbf14`

## Review repair receipt on current main — 2026-10-05

Base: `cfb03f201bb21d82b7f537a9fbe59d3623f395d6`. This includes #1997 and the
later persistence revert #2038. Earlier results above remain historical.

The review preserved 30 raw items: eight confirmed repairs, ten refutations,
five deferred investigations and seven duplicates. No design choice remains
unresolved. Deferred owners and required witnesses are in the coverage map.
The complete raw review and append-only evaluation ledger are task-local; they
are not product files. The independent review recommendation is hire, with
calibration feedback on rarity versus technical confidence and static evidence.

New receiving tests first produced 12 failures and one valid string control.
They cover ordinary NUL equality, persisted native numeric expressions, late
ownership recovery and combined semantic/cleanup failure. Repairs preserve
ordinary bound strings, both native representations through path alternatives,
current-main safe candidate semantics and the existing retry/error boundaries.
The review also restored hostile-control reach and exact replay isolation.
Scalar membership DDL tests now state #1997's existing full-read fallback.

Final affected campaign: **517 passed, 0 failed, 1 existing TODO**. The previous
main run passed 521; upstream #2038 removed four tests. This is not a test waiver.
Exact seed/path replay: **1 passed, 107 skipped**, with no unrelated native cases.
TypeScript succeeds. ESLint reports **0 errors and 25 existing require-await
warnings**. Changed TypeScript formatting and whitespace checks succeed.

Hostile current-base controls:

- Remove numeric-path identity: six native families fail semantic assertions.
- Remove NULL retention from native NOT leaves: six mixed-domain families fail.
- Admit negated native coalesce as exact: six families lose the NaN match.
- Remove recovery queue wire validation: both native kinds fail, while the string
  control passes. Restored code passes all receiving checks.

These controls retain the intended checkpoints. Setup failures do not count as
kills. Existing overbroad equality, inverted equality and parameterized-path
controls also reach their semantic/index checks again. Public row correctness,
raw SQL candidates, persisted expression values and plan use remain separate.

Verification uses cached dependencies with aliases to all task source packages,
not old build output. Vitest runs at most two workers. The affected files are the
core typed-value, resume/ordinary-work, Boolean-arity and wrapper owners, Node
expression-index and adapter-contract owners, and Collection events. Commands:

```sh
vitest run --config /private/tmp/temporal-owners-vitest.config.mjs --maxWorkers=2 --minWorkers=1 --pool-options.threads.maxThreads=2
TANSTACK_DB_WS5A_SEED=1659005 TANSTACK_DB_WS5A_PATH=0 vitest run --config /private/tmp/temporal-owners-vitest.config.mjs packages/node-db-sqlite-persistence/tests/expression-index-oracle.test.ts --maxWorkers=2 --minWorkers=1
tsc --noEmit --project /private/tmp/temporal-owners-tsconfig.json
```

The source snapshot is `/private/tmp/temporal-review-final-snapshot.json`.
Sorted changed-TypeScript path/hash map SHA-256: `7b64b1c65485a64494d2d47f77a71c056eea4fa3508ddb61d6bdf7d23e85cbc8`.
Receipts are `/private/tmp/temporal-review-current-main.json`,
`/private/tmp/temporal-review-replay.json` and
`/private/tmp/temporal-mutant-{numeric-identity,not-null,not-coalesce,late-wire}.json`.

Weight before this evidence addendum: production +350/-39 (net +311), tests
+1755/-77, and documentation +1627/-0. Native reconstruction requires the codec
and query representations absent from the old implementation. The review uses
existing admission, cleanup and residual filtering instead of another lifecycle.
Most documentary weight is the explicitly requested grammar and historical
hostile/fracture/tension evidence. These counts include untracked task artifacts.

This closes the reached native preservation/query and admission traces only.
Engine-native/mobile receiving behavior, wider ownership histories and old-byte
migration remain bounded by the explicit owner limits. Rebuild is the selected
policy for ambiguous old marker records and already-erased values.
