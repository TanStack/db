# PR #1997 SQLite prefilter oracle review

Reviewed source head: `8dd372c2575cec594b7add5df2f61bede5165346`.
The published source before this repair was `5c45eaf1d74481aeb62a135236ffba3d363d5915`.
This record is added in a documentation-only follow-up to the reviewed source.

## Contract and evidence

At `SQLiteCorePersistenceAdapter.loadSubset` return, the SQL candidate set must
contain every row that the JavaScript predicate can return. The adapter may read
extra rows. Where an expression index is claimed, the receiving SQLite plan
must use that named index. The independent expected result comes from explicit
JavaScript comparisons and object/array fixtures, not the SQL compiler.

The reported source failed three real-adapter witnesses at the SQL candidate
checkpoint: a large persisted Number compared with a nearby BigInt bound,
`{ part: { '0': 'match' } }` queried through `part.0`, and a Kelvin sign after
NUL in a lowercase equality. Each had one JavaScript match and zero SQL
candidates. The old nested boolean compiler read `args` 3,321 times at depth
80. Those are assertion failures at the intended checkpoints, not setup or
cleanup failures.

The repaired Node receiving oracle checks candidate and public keys for four
inequalities, both operand orders, unary AND/OR, numeric object and array
carriers, coalesce, membership, prefix LIKE, lowercase equality, and NUL
placement. It checks named-index use for numeric paths through three digit
segments. A four-segment path checks the full-read fallback. The core oracle
checks that an 80-level nested AND reads arguments at most 800 times. On the
reviewed source, the Node expression-index file passed 116 tests and typecheck;
the full Node package passed 185 tests and typecheck. The full SQLite-core package passed 679 tests
with two TODOs and typecheck. The core package build, changed-file lint, and
format check passed. Coverage was disabled for local Vitest runs because the
worktree lacks its optional Istanbul package.

The safe BigInt bound is kept selective. An unsafe positive BigInt bound adds
a candidate range over the indexed expression from `Number.MAX_SAFE_INTEGER`
upward; an unsafe negative bound adds the corresponding negative range. This admits Numbers
whose serialized decimal and binary value straddle the bound while JavaScript
still decides the public result. The real SQLite plan uses the named index for
the selective range orientation in either operand order. Its opposite
orientation can scan because the candidate union also admits text and rounded
Numbers. Numeric path compilation uses the same
array/object alternatives for index DDL and runtime predicates. More than
three numeric segments fall back to an unbounded candidate read.

## ORC-012 requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. The candidate-superset and indexed-plan laws above have their authority in the existing `loadSubset` evaluator and RFC #1659 invariant 8. Claims are bounded to the tested SQLite paths and values. |
| ORC-002 | Applicable. Fixed expected keys follow JavaScript comparison and independently constructed values; the direct SQL candidate keys are observed separately. The existing generated expression-index model uses its own path walker and scalar equality. |
| ORC-003 | Applicable. Both oracle file headers state the contract, fixture/model, grammar, real adapter driver, checkpoint, and comparison. |
| ORC-004 | Applicable to the existing generated expression-index campaign. Its file reconstructs the seven declared axes, checks ablations, bounds path/value domains, and rejects duplicate or missing axes. The new review witnesses are finite matrices, so no new random grammar is claimed. |
| ORC-005 | Applicable. The Node oracle uses the public core adapter with the real Better SQLite driver, captures the exact receiving SELECT, and compares raw candidates, public keys, and `EXPLAIN QUERY PLAN`. The BigInt range matrix checks named-index use on the selective orientation and records the broad orientation's scan limit. The core oracle records SQL and compiler argument reads at `loadSubset` return. |
| ORC-006 | Applicable. The prior code lost all three reported matches after SQL filtering; the old nested compiler exceeded the fixed work bound. The existing generated oracle also retains SQL and grammar mutants. |
| ORC-007 | Applicable to the existing generated property. Its fixed-seed and seedless campaigns run the same matrix with direct seed/path replay. The new finite matrices are executed by both ordinary and oracle package runs but do not claim random coverage. |
| ORC-008 | Inapplicable. Neither repair changes a stateful reference model. |
| ORC-009 | Applicable. “SQL candidate” means a row returned by the receiving SELECT before JavaScript filtering; “carrier” in the fixture means the object or array containing a digit path segment. Neither is a new production state. |
| ORC-010 | Applicable to the generated Node campaign. Its existing helper retains the primary semantic mismatch if SQLite cleanup fails, and replay preserves seed/path. The new fixed cases have no shrinking step. |
| ORC-011 | Inapplicable to this repair: no specific fault shared by the explicit JavaScript expectations and the SQL compiler was identified. The existing equality witness also compares a full adapter scan and a separate path walker. |
| ORC-013 | Applicable. The three-segment matrix reaches all eight array/object carrier combinations and checks indexed results; a four-segment object path distinguishes the bounded fallback. The large Number/BigInt and NUL cases distinguish the reported candidate boundary from the former narrow filter. |
| ORC-014 | Applicable to the core compiler-work observation only. Its `node:sqlite` driver reaches the real core adapter; the Node expression-index oracle separately receives the compiled predicates through the Better SQLite driver. No native-host claim is made. |

## Scope left open

These checks establish the reported regressions and nearby legal histories at
the named receiving paths. They do not prove every persisted scalar type,
arbitrary numeric-path depth, every LIKE pattern, native-host planning,
limit/offset after filtering, index use for broad unsafe BigInt range
candidates, or elapsed performance. The SQLite boolean and
Node expression-index entries in `docs/contributing/oracle-coverage.md` own
those remaining cells. A reachable in-scope counterexample would reopen the
candidate-superset claim.
