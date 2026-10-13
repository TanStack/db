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
custom comparator laws, mutation histories, live-query publication, provider
ordering, or a performance guarantee that another eligible index is created.

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

## Exact-commit hostile review

Pending fresh review of the final committed oracle and production path.
