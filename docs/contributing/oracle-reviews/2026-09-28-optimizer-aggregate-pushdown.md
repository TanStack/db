# Optimizer aggregate pushdown oracle review

Reviewed implementation: `37350e5b58b6006f24d9e7c68b894bac7b45ec46`.
Baseline with the original optimizer: `33a194941c8d51f8f98babb999fef2987dd6ff8b`.
The review record and changeset follow the reviewed implementation. They do not
change the oracle or production code.

## Claim and evidence

An outer predicate on an aggregate subquery must run after aggregation. The
optimizer may move it below the aggregate only when that move preserves the
result. The original `selectHasAggregates` missed `add(sum(v), 0)` and
aggregates inside `caseWhen`. The optimizer moved `isUndefined(s.k)` to the
source row's `k` field. The global aggregate omits `k` from its public row.
The moved predicate rejected both source rows and removed the public result.

The oracle uses source rows `{k:1,v:10}` and `{k:2,v:20}`. Independent
recomputation gives total `30`. A materialized aggregate Collection and a
nested aggregate under a left join must both expose the same post-filter row.
The direct aggregate and grouped query are nearby controls. A left join keeps
the aggregate row when no matching joined row exists. An earlier inner-join
probe returned no row even without a WHERE clause for both direct and wrapped
aggregates, so it could not isolate optimizer pushdown.

On baseline, the direct and grouped controls passed. The arithmetic wrapper,
the `caseWhen` condition-only aggregate, and the `caseWhen` default-only
aggregate failed the public `toArray` assertion. Each returned `[]` instead
of the modeled row. These are assertion kills at the intended checkpoint.
After the fix, all five oracle cases passed. The surrounding query directory
passed 87 files and 3,440 tests before the two final conditional cases were
added. The final focused optimizer and oracle run passed 51 tests. TypeScript,
ESLint, and Prettier checks passed.

## ORC-001 through ORC-011

| Requirement | Outcome |
| --- | --- |
| ORC-001 Contract authority and limits | SQL aggregate semantics and the optimizer's documented safety rule require post-aggregate filtering. The owner checks the listed expressions and public snapshot under a left join. The coverage map names the omitted predicates, wrappers, join types, and incremental histories. |
| ORC-002 Independent judgment | The expected sum comes from `Array.reduce` over source rows. The expected outer result follows from applying the predicate after projection. Neither computation imports the optimizer's aggregate detector. |
| ORC-003 Distinguishable responsibilities | The oracle file states the law, stateless sum model, bounded expression grammar, public Collection driver, and `toArray` refinement check at synchronous publication. |
| ORC-004 Generated-history controls | Not applicable. The file enumerates fixed cases and does not claim generated-history coverage. |
| ORC-005 Production path and observation | `createLiveQueryCollection` compiles nested aggregate and outer join queries. The test compares exact public rows after `startSync: true`. Direct and materialized controls show the public path reaches the aggregate and predicate. |
| ORC-006 Checker calibration | The original optimizer is the wrong-design control. Its wrapped and conditional cases fail by value assertion at the named checkpoint. The direct and grouped controls pass on the same baseline. |
| ORC-007 Fixed/random replay | Not applicable. The owner has no important generated property. |
| ORC-008 Stateful-model minimality | Not applicable. The model recomputes one sum and retains no transition state. |
| ORC-009 Vocabulary mapping | No model-only lifecycle or state term is introduced. “Source rows,” “public row,” and “public snapshot” follow the glossary. |
| ORC-010 Failure fidelity and cleanup | Not applicable. The fixed cases do not shrink, capture mutable traces, or run cleanup that can replace the assertion failure. |
| ORC-011 Second formulation | The materialized aggregate Collection and the nested subquery have the same public projection and predicate. The former prevents cross-boundary pushdown and catches the plausible shared-fault risk in the sum model. Each expected result has one row, so order and multiplicity do not need normalization. |

The bounded repair covers the contract × fixed source rows × nested left-join
path × first public snapshot cells above. It does not prove all optimizer
rewrites safe. The coverage map owns the remaining cells and the separate
global-aggregate inner-join observation.
