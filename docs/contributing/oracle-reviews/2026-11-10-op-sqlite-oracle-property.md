# OP-SQLite campaigns converted to oracleProperty

Implementation commit: `366be721dc4d4910234f19f7805c42afadcff16b`.
Base commit: `9a5214f2801c2c7918f6fd21ac5add317559322a`.
No production source changed.

The three properties keep their IDs, documented fixed campaign seed 165903,
50-history base run budgets, independent scalar-to-row model, exact row values,
row count, row order, key order, and query execution count. The shared model
and comparison live in `op-sqlite-alias-oracle.ts`. The driver retains all eight
injected result carriers, real better-sqlite3 columnar SELECTs, and the retained
real direct-row-array SELECT. Frozen provider receipts and actual mobile host
execution retain their previous scope.

## Evidence

- **Law and authority:** `SQLiteDriver.query` preserves complete ordered alias
  rows across documented OP-SQLite result envelopes. The existing query contract
  and published result carrier shapes authorize the expectation.
- **Reach:** write-marker aliases declare four alias states. Carrier equivalence
  declares twelve alias states and eight carrier states. SQL alias queries declare
  twelve alias states and two SQL receiving paths. Constructed histories force an
  alias while keeping the remaining generated alias sequence, or preserve the
  generated sequence while driving all receiving paths. Actual successful query
  calls record reach. All declared states were reached in both normal campaigns;
  every carrier and SQL path was reached in 63 histories per campaign at seed
  165903. The focused run log preserves every alias count.
- **RED / pre-conversion sensitivity:** the unchanged owner rejected 29 mutants
  among 361 stable keys using legacy assertion kills. This is a conversion's
  before report, not a production-defect RED claim.
- **GREEN:** all 156 focused oracle and ordinary tests pass. The complete React
  Native package TypeScript check and targeted ESLint pass. Each guarded replay
  with seed 165903 and path 0 records exactly one nonzero passing execution for
  its requested property.
- **Mutant preservation:** the final report contains the same 361-key universe.
  All 29 previously killed keys remain killed: 17 by `exact-alias-rows` and 12 by
  `query-execution`. The companion JSON preserves every retained killed key and
  hashes of the full before/after reports. No owning tests or mutants were removed
  to obtain these results.
- **Limits:** this test refactor does not close the full source's existing mutation
  gaps or establish device, JSI, browser-worker, or platform delivery. Ordinary
  malformed-envelope and transaction tests remain supplemental. Full gap reports
  preserve survivors, crashes, timeouts and unreached code separately from kills.

The first converted report lost eight kills because the recorder called `.map`
on malformed null/undefined row results. The final recorder accepts unknown
results and retains the malformed value and absent key list as observations.
The same named row comparison now rejects those returned values. This was an
observation repair, with no production or expected-result change.

The final type correction adds erased annotations for forwarding the native
`prepare` generic; it does not alter the tested runtime behavior.

## Commands and retained artifacts

From the persistence worktree root:

```sh
pnpm gap-report --package packages/react-native-db-sqlite-persistence --source src/op-sqlite-driver.ts --seed 165903 --contexts 2 --out /tmp/oracle-persistence-op-sqlite-before
pnpm gap-report --package packages/react-native-db-sqlite-persistence --source src/op-sqlite-driver.ts --seed 165903 --contexts 2 --out /tmp/oracle-persistence-op-sqlite-after-final
pnpm --filter @tanstack/react-native-db-sqlite-persistence exec vitest run --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2 tests/op-sqlite-driver-oracle.test.ts tests/op-sqlite-driver.test.ts
pnpm exec tsc --noEmit --pretty false -p packages/react-native-db-sqlite-persistence/tsconfig.json
```

The two gap directories contain complete `results.json`, `results.jsonl`,
`summary.md`, and state metadata. Focused test, replay, lint and type logs use
`/tmp/oracle-persistence-op-sqlite-*`.

From the React Native package directory, repeat this guarded replay with each
property ID (`op-sqlite.write-marker-aliases`,
`op-sqlite.result-carrier-equivalence`, and `op-sqlite.columnar-sql-aliases`):

```sh
TANSTACK_DB_ORACLE_SEED=165903 TANSTACK_DB_ORACLE_PATH=0 TANSTACK_DB_ORACLE_PROPERTY=op-sqlite.write-marker-aliases node --import tsx ../db/tests/oracle-replay.ts tests/op-sqlite-driver-oracle.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2
```

## Campaign and host details

The former two 50-history alias-grammar checks now execute inside their
corresponding 50-history product campaigns. Singleton, complete and reversed
alias sequences remain fixed histories that drive production. The shared grammar
check proves their reconstructibility and rejects empty, repeated, and unknown
aliases. No fixed history discharges required constructed reach.

The pre-existing 20-run checker shrinking and direct replay calibration moved
unchanged to `op-sqlite-driver.test.ts`. Its normal package execution retains
all twenty attempts. `pnpm lint:changed` exits nonzero only to report the moved
budget as removed from the oracle owner; the coverage map and implementation
commit explain the move. No lint rule is disabled. The normal pre-commit hook
runs the required staged oracle rules and ESLint.

The existing run-count reader can return the unscaled base count, so
`oracleProperty` applies the shared multiplier once. Its default API retains
its previous behavior for ordinary configuration tests. An explicit package
run-count override supplies the new framework's base run budget and therefore
also respects the shared multiplier.

Node 24.19.0 / better-sqlite3 12.11.1 aborted in native Statement weak finalizers
with `RemoveEnvironmentCleanupHook: env != nullptr` under Vitest's VM context.
The production driver keeps closed Statement JavaScript wrappers alive through
worker exit. The existing fixture cleanup still closes every database handle;
this retention changes neither provider results nor query comparisons. One pair
of read-only SQLite connections per registered test avoids creating native
connections for each history or calibration candidate.

Local-only dependency recovery selected fake-indexeddb 6.2.7 instead of blocked
6.2.8, and @tanstack/query-core 5.106.1 instead of blocked 5.107.1 (5.107.0 was
not published in the proxy metadata). Their pnpm overrides and lockfile changes
remain uncommitted.

## Rubric checks for this conversion

| Requirement | Evidence or applicability |
| --- | --- |
| ORC-001–003 | Existing contract authority and controlled-boundary scope remain in the owner; the shared module keeps the independent model, grammar and comparison visible, and the owner names the production paths and settlement cuts. |
| ORC-004 | Shared grammar checks reconstruct all singleton/full/reversed witnesses, retain their production execution as fixed histories, and reject empty, repeated and unknown aliases. Removing a field-name axis loses that alias's declared state. |
| ORC-005 | Actual query completions and columnar execution-count deltas supply the reach witnesses; exact rows and separately captured key arrays reach the named settlement checks. Invalid returned rows remain recordable. |
| ORC-006 | The shared checks reject empty, missing-key, swapped-value, duplicated-row and reversed-row observations; all 29 prior production mutant kills are preserved by stable key. |
| ORC-007 | All three properties retain seed 165903 and 50-history fixed/random parity; all three guarded seed/path replays execute exactly once. The named replay-manifest integration group also passes. |
| ORC-008 | Not applicable: the independent model remains stateless scalar-to-row computation. |
| ORC-009 | Alias, row, query and receiving-path terms keep their existing meanings. The key array explicitly records object-key order that data equality alone ignores. |
| ORC-010 | The framework snapshots observations and preserves named law/checkpoint failures; existing cleanup reports errors separately and closes handles. The recorder repair preserves null/undefined mismatches through shrinking. |
| ORC-011 | No new shared semantic-fault hypothesis or second formulation is claimed; the existing independently derived row law is preserved. |
| ORC-012 | This append-only record identifies the exact implementation commit and retains its commands, scope and key-preservation evidence. |
| ORC-013 | Fixed singleton aliases and randomized inclusion constructions distinguish reserved field names used as data; full and reversed sequences retain range and order witnesses. |
| ORC-014 | No new real-device claim: frozen published provider receipts and controlled SQLite shim paths keep their previous boundaries. |
| ORC-015 | All declared states have randomized constructions and measured actual receiving-path reach; fixed histories do not discharge reach. |
| ORC-016 | Fixed product histories use the same model, driver and named comparison. Ordinary checker machinery, including its 20-run shrink/replay test, lives in the ordinary test file. |
