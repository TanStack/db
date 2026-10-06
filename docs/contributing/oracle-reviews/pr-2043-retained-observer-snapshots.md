# PR #2043 retained observer snapshot oracle review

Reviewed source head: the commit that adds this record on
`perf-lazy-observer-snapshot`. The production change is unchanged from
`069633263`. This record adds the fixed-seed campaign and this audit.

## Contract and evidence

`LiveQueryObserver.getSnapshot()` returns one object for each revision. A
consumer can keep that object and read `data` or `state` for the first time
after the Collection changes and after the observer builds newer snapshots.
The first read, in either order, must show the rows that were visible when the
observer built the snapshot. `data` must list the rows of `state.values()` in
the same order. A single-result query keeps only the first such row.

The authority is the snapshot contract in
`packages/db/src/live-query-observer.ts`: "Each snapshot owns a captured view
of `state`/`data`, so reading an older snapshot cannot expose rows from a later
revision." #1542 broke this law with a getter that read the live Collection on
first access. The external review of #1542 reproduced that failure.

The oracle is
`packages/db/tests/live-query-observer-snapshot-oracle.property.test.ts`. Its
model is a sorted map from key to version. The model records its rows at each
`capture` step, next to the unread production snapshot. At the end, the driver
reads each retained snapshot in a generated order and compares both properties
with the recorded rows.

## Mutant results

All mutant runs used the reviewed test file. The production source was
restored after each run.

| Mutant | Outcome |
| --- | --- |
| The `state` getter reads `collection.entries()` on first access (the #1542 design) | Assertion failure in all four generated cases at fixed seed 2043, path `0:2:1:1:1`, and in the pinned history. The calibration test passed. |
| The `state` and `data` getters read the observer's latest entries | Assertion failure in 5 of 6 tests (recorded by the implementation run before this record). |

Direct replay of the first mutant with `TANSTACK_DB_ORACLE_SEED=2043`,
`TANSTACK_DB_ORACLE_PATH=0:2:1:1:1` and
`TANSTACK_DB_ORACLE_PROPERTY=live-query-observer.retained-snapshot` reproduced
the same counterexample: snapshot 0 captured no rows, but its `state` showed
row `a`.

## ORC-012 requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. The law and its authority are above. The claim is limited to the shared observer over a local-only Collection behind an ordered live query. Hydration seeds, persisted status and framework wiring have other owners, which the oracle prose names. |
| ORC-002 | Applicable. The expected rows come from the model's sorted map. The model does not import the observer, its entry collection or its ordering. |
| ORC-003 | Applicable. The opening prose states the law, the model, the history grammar, the production path, the checkpoint and the limits. The ownership table maps each contract row to its observation. |
| ORC-004 | Applicable. The grammar has upsert, delete and capture over keys `a`..`d` and versions `0`..`9`, with a generated read order and a generated choice of `data` or `state` first. The pinned history reconstructs the case of a snapshot read after several newer snapshots. No ablation check is executable. An ablation of the read-order axis would remove the `state`-first case, which the live-read mutant needs. That gap is accepted for this bounded grammar. |
| ORC-005 | Applicable. The driver calls the production `getSnapshot()` with and without a subscriber. It reads the public `data` and `state` properties at the end of the history. |
| ORC-006 | Applicable. The calibration test gives the checker a snapshot whose properties read the live Collection, and the checker rejects it. The two production mutants above fail at the intended checkpoint. Each outcome is an assertion failure. |
| ORC-007 | Applicable. Each generated case runs the same property and budget twice: once with fixed seed 2043 and once with an unseeded or replay seed through `oraclePropertyOptions`. The replay interface accepts the seed, the path and the property name. The direct replay above reproduced the reported failure. The property does not use `fc.commands`. |
| ORC-008 | Applicable. The model keeps only the visible key-to-version map. The order of keys is derived from the map, so the model keeps no separate order state. |
| ORC-009 | Applicable. "Capture" is a model-only step. It means one call to `getSnapshot()` whose result is kept unread. "Recorded rows" are the model rows at that step. |
| ORC-010 | Applicable, with a gap. The harness cleans up the observer, the query and the source in a `finally` block after the comparison. If cleanup throws after an assertion failure, the cleanup error replaces the assertion error. The cleanup calls are local-only Collection cleanups, and no run showed a cleanup failure. Shrinking reduced the mutant counterexample to one upsert and one capture, and the replay reproduced it. |
| ORC-011 | Inapplicable. No reviewer named a fault that the model and production could share. |
| ORC-013 | Inapplicable. The oracle protects no threshold or range law. |
| ORC-014 | Inapplicable. No controlled provider supplies a premise. |

## Unresolved

- No per-adapter test proves that an adapter never reads `state` for a
  `data`-only consumer. The allocation counts in the PR were taken with scratch
  tests. A permanent check needs a test seam in production, which this PR does
  not add.
