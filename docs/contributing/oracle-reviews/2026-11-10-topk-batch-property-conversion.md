# TopKBatch campaign conversion

This is a test refactor. Production is unchanged. The before revision is
`9a5214f2801c2c7918f6fd21ac5add317559322a`. The converted oracle's Git blob is
`7eb191638edc22b5c8f642ca1291795d42b00db1`.

## Law and authority

Same-key batches cancel equal row values and retract unequal old versions before
adding replacements. The ordered graph retains the exact owed source row with
unit weight. The existing contract also checks bounded getter reads and avoids
hashing unrelated payloads. Authority: the established TopKBatch contract under
[Ordered relations and BTree](../oracle-coverage.md), including the maintainer's
2026-11-02 decision that signed zero distinguishes row values.

The conversion preserves every authored value relation, collision path,
replacement order, direct batch observation, graph-drain observation, and work
count. The model reads authored equivalence flags; it imports no production
identity computation. Source-reference labels retain the old identity checks.

## Histories and run budgets

Every relation history executes the entire original relation/path matrix. It
does not sample one member of a union. The original matrix cells all used the
same numeric/Boolean grammar and seed, with 25 inputs per cell. Each cell still
receives 25 inputs in its fixed-seed campaign. The other four original seeds
remain separate properties, also with 25 runs each. Every property adds a random
campaign with the same grammar and run budget.

| Property suffix under `ivm.` | Preserved fixed seed | Runs per original cell |
| --- | --- | --- |
| `topk-batch-relations` | 409033 | 25 |
| `topk-batch-file-independent` | 409039 | 25 for each File path |
| `topk-batch-shared-subtrees` | 409034 | 25 |
| `topk-batch-unrelated-payloads` | 409035 | 25 |
| `topk-batch-long-cancellation` | 409037 | 25 |

The normal command passed 20 tests, including calibrations, in 4.14 seconds:

```sh
cd packages/db-ivm
../../node_modules/.bin/vitest run tests/operators/topk-batch-contract-oracle.test.ts --maxWorkers=2 --coverage.enabled=false --typecheck.enabled=false
```

Constructed histories retain generated numeric inputs while setting the relevant
order or shape. The reported reach counts were:

| Declared state | Fixed | Random |
| --- | --- | --- |
| Relation: add first | 13 | 14 |
| Relation: retract first | 14 | 13 |
| Relation: equal versions | 27 | 27 |
| Relation: replacement versions | 27 | 27 |
| Relation: transient cancellation | 27 | 27 |
| Relation: ordinary batch | 27 | 27 |
| Relation: forced collision | 27 | 27 |
| File present | 27 | 27 |
| File absent | 27 | 27 |
| File paths: add first | 11 | 13 |
| File paths: retract first | 16 | 14 |
| Shared subtree comparison | 24 | 25 |
| Unrelated payload getters | 26 | 26 |
| Independently allocated cancellation | 26 | 26 |

## BEFORE and AFTER

Both reports used the same complete source scope, owners, mutants, and seed:

```sh
./node_modules/.bin/oracle-gaps --package packages/db-ivm --source src/operators/topKState.ts --env-prefix TANSTACK_DB_ORACLE --seed 42 --contexts 1 --out /tmp/oracle-property-ivm-topk-batch-before --daemon
./node_modules/.bin/oracle-gaps --package packages/db-ivm --source src/operators/topKState.ts --env-prefix TANSTACK_DB_ORACLE --seed 42 --contexts 1 --out /tmp/oracle-property-ivm-topk-batch-after-final --daemon
```

The before report ran on the unchanged oracle. The final after report ran with
the converted file removed from `legacyCampaigns`.

| Outcome | BEFORE | AFTER |
| --- | --- | --- |
| Killed | 35 | 35 |
| Crashed | 10 | 10 |
| Survived | 2 | 2 |

Both finalized `results.json` files contain the same 47 stable mutant keys.
Comparing by `.key`, every before row whose outcome was `killed` is still
`killed`. Every other outcome is unchanged as well. Each report passed its two
clean baselines and recorded zero nondeterministic tests. The old oracle had
398 tests; replacing its many separately registered matrix cells changes that
registration count while retaining their executions.

The final comparison artifact is
`/tmp/oracle-property-ivm-topk-batch-comparison-final.json`.

## Mutants and failure fidelity

Three TopKBatch mutants now fail the named law `same-key contributions`:

- Flip the identity comparison's structural flag (`M9`).
- Reverse the negative-entry yield boundary (`M16`).
- Reverse the positive-entry yield boundary (`M20`).

Their stable keys combine `src/operators/topKState.ts#topKBatch` with the
`bool-flip` or `binary-swap` operator and the corresponding unchanged source
anchor. The report still counts kills from neighboring unconverted owners by
their existing legacy rules; this conversion makes no claim to migrate them.

The calibration that drops replacement retractions exercises the same production
driver and comparison. Each other property's calibration omits a required
observation. Every matrix cell and File path has distinct checkpoint names.
A crash before a later result cannot masquerade as a violation at an earlier
checkpoint with the same name. Product exceptions propagate. In particular,
`M10` remains classified as a crash, as in the before report.

## Replay and other checks

A guarded replay executed the requested property once, with seed 42 and path 0,
while skipping all fixed campaigns and unrelated properties:

```sh
cd packages/db-ivm
TANSTACK_DB_ORACLE_PROPERTY=ivm.topk-batch-relations TANSTACK_DB_ORACLE_SEED=42 TANSTACK_DB_ORACLE_PATH=0 node --import tsx ../db/tests/oracle-replay.ts tests/operators/topk-batch-contract-oracle.test.ts --maxWorkers=2 --coverage.enabled=false --typecheck.enabled=false
```

Four replay-manifest checks passed: registry equality, owner source mapping,
command working directories, and an owner for every registered property. The
changed oracle and its transitive imports typechecked with zero diagnostics.
Full ESLint and the changed-file oracle lint passed.

## Limits

This conversion preserves the original authored value families, direct return,
finite D2 graph drains, and deterministic work observations. It adds no provider
scheduling or value-identity policy. The two survivors and ten crashes in the
wider source report remain the same; the conversion claims preservation of
previous kills, not closure of every gap in that source file. The Murmur and
script migration blockers remain separate work.

## Review repair: unrelated keys retain their own contributions

Independent review of commit `dad05e44eb5fb5423dc06cc94846db2c30068386`
found that the unrelated-payload law named keyed contributions but its recorder
kept only output length and getter reads. The repaired oracle blob is
`408d2b455eecfb07338750b003a160287f8fec86`.

The governing TopKBatch contract applies each keyed batch's retractions before
additions and consolidates only same-key versions. A different source key cannot
supply a missing key's contribution. The old generated class already contained
the minimal distinguishing history: `count=2`, with `rank=0` retracted and
`rank=1` inserted for each key. A wrong result that supplies both replacements
under key 0 and omits key 1 has length 4 and zero unrelated getter reads. The
old model and recorder collapse this wrong result and the correct one to the
same observation, so the old comparison returns `pass`.

This is an in-scope comparison gap, not a lost original mutant kill. The repair
keeps an array of exact key, source-row reference label, and signed weight for
every returned entry. It compares a sorted copy with an independent per-key
contribution bag. Sorting permits unspecified key order. It does not coalesce
weights or discard duplicate, missing, zero, or negative contributions. Output
length and zero getter reads remain checked.

- **Law:** Each generated key supplies its own old-row retraction and new-row
  insertion, with no unrelated getter reads. Authority: the established keyed
  TopKBatch cancellation/replacement contract stated above.
- **Reach:** The original 1..100 key grammar, seed 409035, and 25-run budget
  remain. A constructed history retains the generated count with a minimum of
  two keys. Both fixed and random campaigns entered `multiple unrelated keys`
  26 times. The minimal count-2 trace replays through the same model, production
  driver, and comparison.
- **RED:** Before changing the recorder/model, the added calibration duplicated
  the first source key's actual returned entries, preserving length and getter
  reads. The command below failed because no history made the old comparison
  reject that wrong answer. The source-extraction probe against `dad05e44e`
  independently recorded the false-green count-2 observation described above.
- **GREEN:** After the comparison repair, the same calibration passed. The
  complete normal owner command passed 22 tests. The extraction probe now
  returns law `unread unrelated payloads` at `batch and unrelated reads`.
- **Mutant:** `duplicates one source key and omits another` is an executable
  mutated production observation through the same driver and comparison. It
  retains the first key's actual row references and weights while substituting
  them for every other key's contributions. The repaired oracle rejects it.
- **Limits:** This extension covers one replacement batch over 1..100 sequential
  numeric keys, one old rank-0 row and one new rank-1 row per key, unit signed
  weights, direct TopKBatch output, and unrelated getter reads. Other value
  families remain with the existing matrix. It makes no new key-order promise.

The RED calibration command, from `packages/db-ivm`, was:

```sh
../../node_modules/.bin/vitest run tests/operators/topk-batch-contract-oracle.test.ts --maxWorkers=2 --coverage.enabled=false --typecheck.enabled=false -t 'duplicates one source key and omits another'
```

A complete same-seed report after the repair,
`/tmp/oracle-property-ivm-topk-unrelated-after/results.json`, retains the original
47 stable keys and every outcome: 35 killed, 10 crashed, and 2 survived. No prior
kill was lost. The comparison is
`/tmp/oracle-property-ivm-topk-unrelated-comparison.json`. The complete named
replay-manifest integration group passed 69 tests, and the repaired owner
continued to typecheck with zero diagnostics.
