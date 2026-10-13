# Custom comparator index selection

An index with a user-supplied `compareFn` cannot advertise the ordinary
Collection `orderBy` comparator merely through `compareOptions`. The
live-query architecture's Identity contract requires advertised comparison
options to describe the comparator the index executes. Exact equality lookup
remains a separate index operation.

The new oracle supplies three numeric rows in source order 20, 30, 10. Its
independent model sorts their supplied ranks numerically, so an ascending
`limit: 1` read must return rank 10. It compares unindexed and indexed public
Collection snapshots after readiness for both BasicIndex and BTreeIndex. A
custom callback orders ranks descending, and an ordinary index is a control.
The driver also checks descending reads, `optimizedOnly` refusal of a custom
index for ordinary order, and optimized exact `eq` on that same custom index.

At frozen head `1265abeb5`, both custom index types claimed default ascending
eligibility and returned rank 30. The new oracle failed twice at the public
first-key comparison, with no type errors. The repair makes public ordered
selection respect the existing `supportsRangeOptimization` capability, which
is false for custom comparators. This leaves exact lookup available and does
not change the custom callback's direct index behavior. The focused 460-test
index/query campaign passed with no type errors after repair.

The oracle covers a ready in-memory Collection, one numeric field, one order
term, limit one, and two built-in index types. It does not establish arbitrary
custom comparator laws, mutation histories, live-query publication, or
provider ordering.

## Oracle guide audit

| Requirement | Evidence and limit |
| --- | --- |
| ORC-001 | The architecture's index metadata law and public ordered-read contract authorize the numeric first-key observation. |
| ORC-002 | Supplied ranks determine expected order without reading the index comparator or its metadata. |
| ORC-003 | The oracle explains law, fixture, production paths, snapshot, and comparison beside its code. |
| ORC-004 | Fixed three-row source order distinguishes insertion order from ascending and descending rank; no generated-history claim is made. |
| ORC-005 | Both public Collection snapshot paths are observed after readiness; optimized-only reads check planner admission. |
| ORC-006 | The original wrong planner fails at both public first-key assertions; an ordinary index and exact lookup are adjacent controls. |
| ORC-007 | Not triggered: this owner is a bounded fixed witness. |
| ORC-008 | Not triggered: the model has no mutable state. |
| ORC-009 | Ranks are model facts; `supportsRangeOptimization` is production capability observed separately from expected row order. |
| ORC-010 | `withOracleCleanup` releases each Collection while preserving the primary assertion. |
| ORC-011 | The unindexed scan and numeric model check the indexed result through different formulations; both production paths still share the Collection API. |
| ORC-012 | This record names RED/GREEN evidence, owner, limits, and pending exact-commit review. |
| ORC-013 | A reverse-number callback makes the wrong index choice visibly return rank 30 instead of rank 10. |
| ORC-014 | Controlled in-memory sync ends at the ready snapshot; no provider handoff is claimed. |

## Exact-commit hostile review and follow-up

At `c4c07da42`, a fresh reviewer reproduced a planner failure with two
indexes on the same field: when the custom index was created first and a
compatible ordinary index second, `optimizedOnly` ordered reads still
returned no result. The original oracle put the indexes in separate
Collections, so first-match selection was never challenged. An eager
Collection also treated the custom index as sufficient and created no
compatible ordinary index. Numeric range predicates had the same first-match
problem. The reviewer reproduced both index types and both read directions.

The extended fixture now puts both indexes in one Collection and checks
ascending and descending public first rows. It also starts with a custom
index under eager mode, requires one compatible index to be created, and
checks a repeated read does not create another. Optimized exact `eq` still
uses the first custom index, verified through its lookup spy. The fixture
also checks optimized single and compound numeric ranges and an eager range
subscriber. Four ordered-selection cases failed before that repair at the
missing first row. Four more cases failed before the range repair: both index
types returned no optimized `gt` result, and both eager subscriptions failed
to create a compatible index. The compound assertion followed the single
range assertion in one test, so no separate pre-fix compound failure was
observed. Selection and eager admission now skip a custom index only when
ordered traversal is required. The new oracle passed 8 cases, and the
six-file related campaign passed 145 tests with no type errors. Lint and
diff checks passed.

Fresh review of the final committed head remains pending.

At `5df06de2e`, another reviewer found that eager admission recognized
`gt(rank, 10)` but not its equivalent value-left form `lt(10, rank)` after a
custom index. Initial subscription rows were correct, but the value-left
history failed its optimized-only snapshot because no compatible index was
created. The author added single and paired value-left RED witnesses for
BasicIndex and BTreeIndex before extending eager expression extraction to
identify the field on either side. The repaired tests compare initial rows,
optimized rows, and index count against independent numeric row filters. A
custom-only optimized range refusal is an adjacent control. The focused
oracle passed eight tests and the neighboring index campaign passed 547.
This establishes neither arbitrary value domains nor mutation histories.
The live-query compiler has a separate index-admission path; simple public
probes were correct, but the comparable coexisting-index schedule remains
unproved there.

## Live-query receiving path after `ae0b67fd2`

A fresh hostile review found a public counterexample to the compiler's ordered
index admission. An on-demand source had rank-20 and rank-40 rows cached.
It held four authoritative rows at ranks 10, 20, 30, and 40. With a reverse
custom index declared before an ordinary index, an ascending live query
preloaded its first row correctly. Moving to offset one and limit two then
published ranks 30 and 40, instead of 20 and 30. The provider fulfilled its
exact ordered request for ranks 10, 20, and 30. It did not rewrite cached
rank 20, which the wrong local index traversal had failed to send into the
graph. Ordinary-first, ordinary-only, and no-index controls returned the
correct rows. The reviewer reproduced both index types and found 16 public
mismatches in a separate 64-scenario cache/window sweep.

The new [window oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/custom-index-window-selection-oracle.test.ts)
assigns numeric ranks in its source model and sorts and slices those four
facts independently of index selection. Its controlled adapter evaluates
each request's predicate and cursor against the source facts, records the
selected provider rows, and writes only uncached rows. It checks the live
query's rows after preload and after `setWindow()` settles, plus the sole
publication batch. A reply `[1,2,3]` with writes `[1,3]` proves that row 2
was already cached and still belonged to the requested result. The fixed
history crosses custom-first, ordinary-first, no-index, and eager-custom-only
layouts with BasicIndex and BTreeIndex. On the original compiler, four cases
failed at the moved public window: `[3,4]` instead of `[2,3]`. Controls
passed. All eight cases passed after the repair; 677 related tests and the
explicit test TypeScript check passed.

The compiler now requires an ordinary ordered-traversal index when it creates
or selects the first order term's source index. Eager creation lets BaseIndex
derive the comparator from `compareOptions`; passing an explicit `compareFn`
would mark that index custom and make it ineligible. This changes only source
index admission. Direct custom callbacks still order each row according to
the maintainer's decision. The production edit removes two net lines.

The oracle states the ordered window law and its source limits beside its
model, request grammar, driver, and two public cuts (ORC-001–005). The
original compiler fails at the promised post-window comparison, while
ordinary-first and no-index controls reach the same public boundary
(ORC-006, -011, -013). This is a fixed finite matrix, so generated replay
does not apply (ORC-004, -007). The provider is controlled and awaits applied
receipts; the claim does not extend to remote hosts (ORC-014). Ties, nullish
or nonnumeric orders, mutations, replay, multiple order terms, arbitrary
callbacks, and other window schedules remain open. Fresh hostile review of
the final committed oracle is pending.

At committed head `be5b7a3c4`, a fresh hostile reviewer found no additional
numeric window mismatch in 128 controlled cache/layout scenarios. A read-only
wrong-index admission fault changed the settled public rows, confirming the
comparison rejects that error. The reviewer found that readiness and live
query construction happened before cleanup protection; the driver now enters
`withOracleCleanup` before those steps and releases any handles created before
a setup failure. The `eager-custom-only` layout means eager *auto-indexing on
an on-demand source*. The eight-case oracle proves the public result and the
provider's cached-row interaction. It does not measure ordinary-index use or
an eager source path. The architecture's index work law needs a separate
index-use witness before this owner claims that property.
