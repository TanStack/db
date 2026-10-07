# Initial full-source ordered load readiness review

Reviewed source head: `a73a35bac` on `fix-full-source-sync-readiness`.
The oracle commit is `bc2c9438b`; the production fix is `a73a35bac`.
Re-reviewed after merging `main` with #2055 (merge `5d4802052`); the merged
results are in "After merging #2055" below.

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

## After merging #2055

**Main check.** Before the merge, this branch's witnesses ran on `main` at
`25201da6c` (which includes #2027 and #2055). All 8 synchronous full-source
cells and the React first-commit witness still failed, for example
`Expected {"rows":[1,2],"status":"ready"}, received {"rows":[],"status":"loading"}`
and `expected { ids: [], status: 'loading' } to deeply equal { ids: [ '1', '2' ],
status: 'ready' }`. #2027 changed the infinite-query hooks' `startSync`, not this
gate, so the gap remained.

**Combined gate.** An initial load of any kind, and an eager bounded
ordered-prefix repair (#2055), settle synchronously on literal `true`:

```ts
(!isAuthoritativeRepair ||
  isInitialFullSource ||
  (this.readsBoundedPrefix && !isFullSource))
```

**Changed expectation.** #2055 added `keeps an eager full-source ordered window
loading until its load settles`, pinning `main`'s asynchronous timing while its
own scope stayed narrow. Recorded predictions before the edit: `main` and #2055
predict `{loading, 0 rows}` at creation; this branch's law predicts
`{ready, [4, 3]}`. The authority is #1896's rule and the user's decision to close
this gap. The test is now `publishes an eager full-source ordered window at
creation`.

**Joined-filter interaction.** `keeps the first eligible joined rows after a
synchronous full-source load` combines a function filter with #2055's
LEFT-joined filter history: a label-only update to distant row 10, then a delete
of visible row 2. The window moves from `[2]` to `[4]`. A function filter makes
the plan read its whole source, so the graph holds every row and the top-K can
always reach the next eligible row. A mutant that sends this plan through the
bounded prefix path (and ignores the joined filter) survives: it is equivalent
within this domain, because #2055's hazard needs a bounded read that left an
eligible row out. `main`'s gate fails the witness at creation.

**Mutants on the merged code** (ordered-lifecycle, loader, ordered-work and
pagination oracles, 724 tests):

| Mutant | Outcome |
| --- | --- |
| Every `full-source` request settles synchronously | Assertion failure, 1 test: warm readiness, `expected 'ready' to be 'loading'` |
| No settled-request check | Assertion failure, 1 test: warm readiness |
| Promise results settle synchronously | Assertion failures, 275 tests |
| Initial full-source excluded (`main`) | Assertion failures, 9 tests |
| Bounded prefix repair disjunct dropped (pre-#2055) | Assertion failures, 2 tests (#2055's loader and NaN pagination cases) |
| Full-source repair on a bounded-prefix plan settles synchronously | Survival, permitted by the contract. #1896's cut "does not apply to repair", which scopes the promise rather than requiring asynchronous timing. The narrow gate keeps `main`'s timing by choice. |

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
- No law fixes the timing of a full-source repair on an eager source. The gate
  keeps `main`'s asynchronous timing; making it synchronous would be a separate
  decision with its own publication evidence.
