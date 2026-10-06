# Initial full-source ordered load readiness review

Reviewed source head: `a73a35bac` on `fix-full-source-sync-readiness`.
The oracle commit is `bc2c9438b`; the production fix is `a73a35bac`.

## Contract and evidence

#1896 made an ordered, limited live query ready in the call that creates it
when every acquisition for its initial window returns literal `true` after
its establishing receipts apply. Its stated exceptions are explicit window
moves, repair, truncate replay, and framework render timing.

A plan that requires the full source (an inner or right join, a functional or
residual predicate, grouping, `having`, `distinct`, an indirect order, or a
custom string comparator) loads its ordered source with one filtered
full-source request from `OrderedSourceLoader.start()`. The loader classified
every `full-source` request as an authoritative repair, so this initial load
was excluded from the synchronous cut. On `main`, such a query over an eager
source, or over an on-demand source whose `loadSubset` returns `true`, reported
`loading` with no rows at creation.

The authority for the law is the #1896 cut in
`packages/db/src/query/live/ARCHITECTURE.md` (initial readiness section) and
the #1896 pull request description, which states the rule for every ordered
and limited query whose required source work finishes synchronously. This
change revises that section to name the initial full-source load and a later
full-source fallback explicitly.

The fix classifies by purpose. The first full-source request of a loader that
has not settled a source request and owes no ordering repair is an initial
load and may settle synchronously. A later full-source request keeps the
asynchronous path.

## Observations

| Cell | `main` | Fix |
| --- | --- | --- |
| On-demand, synchronous, 4 features (inner join, `fn.where`, `distinct`, custom collation) | `{"rows":[],"status":"loading"}` | `{"rows":[1,2],"status":"ready"}` |
| On-demand, Promise, 4 features | loading | loading |
| Eager source, 4 features | `{"rows":[],"status":"loading"}` | `{"rows":[1,2],"status":"ready"}` |
| Truncate replay, 4 features | prior window at the replay call, replacement a task later | same |
| Warm readiness: full-source fallback after a settled ordered request (existing case) | loading | loading |
| React first layout commit, `fn.where` + `orderBy` + `limit` | see review head | `{ ids: ['1','2'], status: 'ready' }` |

## Mutant results

Each mutant ran against `tests/query/ordered-lifecycle-oracle.property.test.ts`.

| Mutant | Outcome |
| --- | --- |
| Gate keyed on request kind: every `full-source` request settles synchronously | Assertion failure: warm readiness case, `expected 'ready' to be 'loading'` |
| Promise results may settle synchronously | Assertion failures in 145 tests |
| Initial full-source load still excluded (the `main` behavior) | Assertion failures in the 4 synchronous on-demand cells |
| Initial-load test without the settled-request condition | Assertion failure: warm readiness case |

The truncate replay cells do not distinguish the kind-based mutant: replay
publishes through the subscription's replay barrier, not this loader gate. The
warm readiness case is the distinguishing neighbour for that design.

## ORC-012 requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. The law and its authority are above. The claim is limited to the initial full-source load; later full-source fallback, repair, replay, explicit window moves, and framework render timing are unchanged. |
| ORC-002 | Applicable. The expected observation is the same two-valued finite reference as the #1896 cells: ready with ids [1, 2] for literal `true`, loading with no rows for a Promise. The ids come from a three-row source ordered by rank, not from the production comparator. |
| ORC-003 | Applicable. The new section opens with the law, the model, the driver's request-shape check, and the excluded neighbouring cases. The file's opening prose states the revised cut. |
| ORC-004 | Applicable. A finite matrix: 4 features × 2 settlements on an on-demand source, 4 eager cells, and 4 replay cells. Each cell is enumerated; the full-source request shape is asserted, so a plan that silently took the ordered path fails. The residual-predicate feature is not user-constructible and is outside this grammar. |
| ORC-005 | Applicable. The driver calls `preload()` on a real live query and observes `toArray` and `status` at the same call, before awaiting. |
| ORC-006 | Applicable. The `main` behavior and three hostile mutants fail at the intended checkpoint (table above). |
| ORC-007 | Not applicable. The new cells are a finite matrix, not a generated property. |
| ORC-008 | Not applicable. No stateful reference model changes. |
| ORC-009 | Applicable. "Initial full-source load" means the first `full-source` request from `start()` before any source request settles. It is not a production type; the loader derives it from `hasSettledSourceRequest` and `needsOrderingRepair`. |
| ORC-010 | Applicable. The drivers use the file's `finishOracleCleanup`, which keeps the primary failure and every cleanup error in an `AggregateError`. |
| ORC-011 | Not applicable. No shared-fault hypothesis was named. |
| ORC-013 | Not applicable. No threshold or range law. |
| ORC-014 | Applicable, limited. The on-demand cells use a controlled provider. The eager cells and the React cell use real eager Collections. No adapter package (Query Collection, Electric) is exercised here. |

## Unresolved

- A full-source fallback inside the initial ordered chain, such as the warm
  readiness case's inexpressible null boundary, stays asynchronous. #1896's
  oracle pins that timing; making it synchronous would be a separate decision.
- `groupBy` and `having` set `requiresFullSource` but were not added as cells.
