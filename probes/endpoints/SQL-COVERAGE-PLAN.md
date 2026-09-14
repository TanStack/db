# PostgreSQL and on-demand coverage for the Endpoints oracle

The first schema-first implementation now generates 2–3 tables, 1–3 extra scalar
columns per table, nullability, optional foreign keys, predicates and mutation
histories. It runs sequential and concurrent sequences through the full Endpoints
stack and independent reference PostgreSQL. The original Todo campaigns remain.
See [implemented coverage and loading measurements](SQL-COVERAGE-RESULTS.md).

The next pass adds six server-trigger families and an external-write signal
boundary to the full-stack oracle. A separate DB/PGlite experiment tests joined
optimism with complete inputs; it does not yet enable compiled endpoint joins.
See the [mutation-effects catalog](MUTATION-EFFECTS-CATALOG.md) for transitive,
deferred, remote and context-dependent effects, and the registry requirements.
Build-wide query discovery and retained scalar-parameter instances are now
[implemented and tested](QUERY-REGISTRY-RESULTS.md). The [revision-tracking experiment](REFRESH-PRUNING.md) was rejected because
Endpoints must not modify the user's PostgreSQL database. Full refresh remains the default.
Combined SQL reads remain an experiment until real
database-network measurements justify their added encoding cost.

This remains a bounded slice: required base row fields, fixed string keys,
trusted fixture imports/types, and a small scalar query grammar. The inventory
below describes the wider target, not a claim of PostgreSQL-wide support.

The pinned PGlite 0.3.14 reports PostgreSQL **17.5**, `server_version_num=170005`.
PostgreSQL's current documentation describes **18**. Record engine versions and
capabilities in each campaign; a missing embedded-engine feature is not evidence
that PostgreSQL rejects it or that Endpoints handles it safely.

## Generate the schema before the endpoint program

Continue expanding the initial typed, shrinkable program:

```text
engine capabilities
  → schema (tables, columns, keys, constraints, relationships)
  → valid initial rows
  → typed query and mutation ASTs
  → endpoint declarations and client collection demands
  → operation / I/O / lifecycle history
```

The SUT renderer creates real schema definitions, Drizzle declarations, endpoint
handlers and client code. The reference renderer independently produces DDL and
SQL from the specification. Neither reads compiler output to decide expected
types, affected queries, loaded extents or permissible updates. Keep the same
full-stack driver and PostgreSQL authority; don't replace them with SQL-only tests.

Shrink dependencies together: removing a column must repair or remove expressions
that use it; removing a parent table must repair foreign keys and joins; shrinking
rows must preserve valid fixtures unless a constraint failure is the intended
command. Invalid programs form a separate rejection generator.

## Inventory the whole language surface; label evidence precisely

Use versioned PostgreSQL documentation as the inventory, not the current compiler's
grammar. Each feature needs a status and a test witness. A large random run count
cannot substitute for an unvisited feature family or combination.

| Axis                | Required families / boundary values                                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema              | Multiple tables; primary/composite/unique keys; nullable fields; foreign keys and cascades; defaults and generated columns; checks; views/materialized views; partitions; schema-qualified and quoted names                                                                              |
| Types and transport | Integers/big integers; exact numeric; floating point including special values; character/collation; boolean/NULL; binary; date/time/time zone/interval; UUID; JSON/JSONB; arrays; enums; composites; domains; ranges/multiranges; remaining built-in families and extension/custom types |
| Expressions         | Three-valued predicates; casts/coercions; arithmetic; CASE/COALESCE; text/pattern operations; JSON/array operations; stable and volatile functions; subqueries and correlated expressions                                                                                                |
| Queries             | Projection and aliases; joins including outer/lateral; grouping/HAVING/grouping sets; DISTINCT; set operations; window functions; CTEs and recursive CTEs; ordering/null placement/ties; LIMIT/OFFSET/FETCH; row locks                                                                   |
| Mutations           | INSERT/UPDATE/DELETE; UPSERT; MERGE; RETURNING; insert-from-query; multiple statements; data-modifying CTEs; trigger/cascade/generated effects; constraint failures before/after earlier committed statements                                                                            |
| Authority           | Transactions and isolation; rollback/partial commit; other writers; trigger dependencies; schema changes; privileges/RLS; sequences and non-table effects; connection/version/extension capabilities                                                                                     |

Sources for the inventory: PostgreSQL 18 [queries](https://www.postgresql.org/docs/18/queries.html),
[SELECT grammar](https://www.postgresql.org/docs/18/sql-select.html),
[data types](https://www.postgresql.org/docs/18/datatype.html), and
[data manipulation](https://www.postgresql.org/docs/18/dml.html).
These are inventory anchors, not proof that a generated test or optimization exists.

Record separate capabilities for each query/mutation combination:

1. Can it execute and round-trip its values through Endpoints?
2. Can optimistic effects be interpreted soundly?
3. Can the complete potentially affected relation/query set be proved?
4. Can an authoritative result patch be proved complete?
5. Can a loaded subset/window be maintained without refill?

Statuses must distinguish **tested optimized**, **tested full-result fallback**,
**explicitly rejected**, **not tested**, and **unavailable on this engine**. Today,
most rows in the table are not tested by Endpoints, and the compiler rejects many
shapes outside its checked Todo grammar. Do not label those as working fallback.
An unrecognized expression or hidden write dependency must never be silently
classified as safe for a patch or skipped refresh.

For extensible functions/types/operators, test the unknown boundary explicitly.
Then add configured extension profiles with versioned witnesses. Arbitrary user
code is an open set; recognizing that it is opaque is part of complete surface
classification, not proof of its semantics.

## On-demand queries remain deferred

The agreed contract is that an endpoint defines its complete logical result set;
DB filters, limits and pagination will eventually drive automatic subset loading
within it. Deferring this transport does not turn endpoints into page definitions.

Existing DB/Query adapter tests cover subset acquisition and ownership, and were
included in the coordinator checks. Endpoints itself currently eagerly loads
whole query results. It has no generated subset request transport or oracle.

For on-demand mode the reference tracks **requested extents and completeness**,
independently of what the SUT says it loaded. For a collection, run each retained
subset query separately in reference PostgreSQL; derive resident membership from
their result-key union and declared retention policy. Keep visible window results
separate from underlying resident rows. Limits, offsets and ordering prevent a
simple union of WHERE predicates from representing those results.

The reference still has complete server data even when the client doesn't. This
lets it detect a row entering from outside the loaded extent. Unknown/unloaded is
distinct from absent, and an empty response is distinct from proved exhaustion.

| Dimension   | Commands / assertions                                                                                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demand      | Acquire predicate subset; acquire overlapping/disjoint subset; release one owner; retain an idle collection; cleanup/restart; change demand while a response is held                                      |
| Windows     | Limits 0/1/N; offset boundaries; cursor and tie rows; advance/replace window; explicit exhaustion; stable key tie-breakers                                                                                |
| Mutations   | Edit inside/outside loaded rows; move across a predicate or sort boundary; delete the last/first visible row; insert ahead of a window; affect several tables and query collections                       |
| Repair      | Server correction differs from optimism; refill from unseen rows; stale partial response after full replacement; full result followed by obsolete subset; failed/cancelled subset and successful retry    |
| Ownership   | Shared row remains until its last applicable owner retires; one subset's absence is not a collection-wide delete; old lifetime cannot establish new readiness                                             |
| Optimism    | Owned whole-row guesses over loaded rows; incomplete local knowledge; initial load during pending actions; transaction error and local rollback; no invented guess for unseen rows without a defined rule |
| Observation | Every publication and receipt; event-history replay; loaded coverage and readiness; downstream DB query windows; no successful receipt before required replacement is installed                           |

The fallback must state its extent. Recomputing and sending the exact requested
subset is different from promoting the collection to a full-table load. Measure
both requests and bytes; don't call the latter an on-demand optimization.

## Implementation order

1. Add an executable capability manifest and make every campaign report visited
   schema/query/mutation/demand cells, rejected cells and unmeasured cells.
2. Generate small related schemas and typed scalar queries first; retain hand-checked
   controls for nulls, exact numbers, timestamps, collation and key identity.
3. Generalize the full-result transport and collection identity beyond Todo. Prove
   opaque-query fallback before extending patch or invalidation analysis.
4. Add demand/extent state and actual `loadSubset` transport. Begin with predicates,
   then ordered finite windows and refill, crossed with the concurrent schedules.
5. Expand query and mutation families against the versioned inventory. Use PGlite
   for the fast loop and PostgreSQL-version/extension profiles where needed.

The capability manifest and first scalar schema generator are implemented. Broader
query/type families, opaque-query fallback and on-demand contracts remain planned.
LSN-based coverage manifests remain a potential optimization recorded in the Field Log.

The first revision-tracking adapter was removed. Future optimizations must use
query/mutation analysis and existing database capabilities without installing
triggers, counters, functions, extensions or migrations. Keep unknown cases on
full refresh and evaluate transport savings under realistic network conditions.
