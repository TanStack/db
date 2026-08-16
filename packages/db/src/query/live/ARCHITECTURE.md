# Live-query materialization architecture

This document defines the architecture for correlated live-query
materialization in `@tanstack/db`. It follows
[RFC #1658](https://github.com/TanStack/db/issues/1658).

The central rule is simple:

> Keep relation contents, routes, nested materialization, and propagation in
> one D2 graph. Use custom state only at asynchronous source and public
> Collection boundaries.

The correlated-materialization oracle suites listed below are green behavioral
contracts for this design. Suites for adjacent planner and query-db ownership
boundaries may also contain exact classifiers for defects outside this graph.

## Scope

This architecture covers:

- compiled identities for sources, relations, and materialization edges;
- weighted contributions and public-key reduction;
- correlated routes and ordered bucket contents;
- nested inline and Collection-valued materialization;
- lazy and progressive source demand;
- coherent publication to public Collections;
- the boundaries with query-db ownership and physical query planning.

It does not define new public APIs. Optimistic transactions are another source
of weighted input changes; they do not have a separate routing model.

## One relational graph

Correlated materialization is part of the compiled D2 graph, not a second
incremental engine around its output.

```text
raw weighted query rows
        |
        v
public-key reduction
        |
        v
CanonicalRow(base row, order, outgoing parameters)
        |
        +------------------------------+
        |                              |
        v                              |
Route(bucket, cell)                    |
        |                              |
        +--> distinct --> ActiveBucket-+--> async demand adapter
        |                      |       |
        |                      v       |
        |      child rows --> BucketValue
        |                              |
        +------------------------------+
                       |
                       v
                CellValue(cell, value)
                       |
                       v
       CanonicalRow + outgoing CellValues
                       |
                       v
               MaterializedRow
                       |
                       v
       one normal root Collection transaction
```

Canonical base rows flow down to derive correlation routes and source demand.
Fully materialized child rows flow up into their parents. Because the include
graph is acyclic, these streams form one acyclic D2 graph even though demand
and results move in opposite conceptual directions.

The graph owns the data plane. A small adapter owns asynchronous demand. The
normal Collection transaction boundary owns public publication.

## Identity

Aliases are lexical query-language names. They are not runtime identities.
Compilation assigns opaque IDs to the plan:

```ts
type SourceId = Brand<string, 'SourceId'>
type RelationNodeId = Brand<string, 'RelationNodeId'>
type MaterializationEdgeId = Brand<string, 'MaterializationEdgeId'>
```

Alias text may remain as debug metadata. Alpha-renaming an alias cannot change
the compiled graph or its result.

A `CanonicalCorrelationKey` is the canonical tuple of every evaluated
parent-dependent value that can affect the child plan. This includes values
used by filters, joins, ordering, limits, and nullable predicates, not only the
obvious foreign-key equality.

A bucket key identifies one such correlated partition at one relation node:

```ts
type BucketKey = readonly [
  relationNodeId: RelationNodeId,
  correlationKey: CanonicalCorrelationKey,
]
```

Correlation equality must use the same value semantics as query predicates.
Implementations use canonical values, interned handles, or nested maps; they do
not reconstruct array or object keys and expect JavaScript `Map` identity to
match.

A materialization cell identifies one include field on one parent-row
occurrence:

```ts
type MaterializationCellId = readonly [
  containingBucket: BucketKey | 'root',
  parentPublicKey: PublicKey,
  edgeId: MaterializationEdgeId,
]
```

The containing bucket prevents equal child keys in separate correlated
contexts from colliding.

Only work that crosses an asynchronous boundary needs a generation token. A
live-query graph generation invalidates work from an old graph. A demand
generation invalidates an old load for the same bucket. Synchronous route rows
inside D2 do not need their own lifecycle objects or generations.

## Weighted relations and public keys

D2 multisets are the source of truth. A row with positive weight contributes;
a row with negative weight retracts the same contribution.

Internal contribution identity is independent of the user-visible Collection
key. When several internal rows collapse to one public key, a keyed D2
reduction retains all contributors and derives at most one canonical row:

```ts
type CanonicalRow<Row> = {
  publicKey: PublicKey
  value: Row
  order: OrderKey | undefined
  outgoingParameters: ReadonlyMap<
    MaterializationEdgeId,
    CanonicalCorrelationKey
  >
}
```

```text
raw weighted rows
    -> reduce by [containing bucket, public key]
    -> CanonicalRow
        +-> derive route rows
        +-> compose with materialized include values
```

For every affected public key, the reduction compares its complete before and
after state and emits no change, one replacement, or one removal. It does not
infer the previous state from `collection.has()`.

Routes derive only from canonical rows. Raw contributors never create routes
that must later be reconciled. The same boundary applies recursively: roots
reduce by root public key, while child rows reduce by their containing bucket
and child public key.

All positive contributors collapsed under one public key must be congruent on:

- the visible value;
- the total order key;
- every outgoing correlation input.

Query aggregation occurs upstream in the query graph. This reduction only
preserves multiplicity while collapsing congruent contributors under the
public Collection key. Incongruent contributors are a duplicate-key invariant
error; flush order never chooses a winner. A zero aggregate removes the public
row. A negative aggregate is an invariant violation.

This is a specialized use of the existing D2 keyed reduction. It is not a
separate contribution-ledger subsystem.

## Routes and buckets are relations

For each materialization edge, the compiler produces these keyed relations:

```ts
type RouteRow = readonly [bucketKey: BucketKey, cellId: MaterializationCellId]

type ActiveBucket = readonly [bucketKey: BucketKey]

type BucketRow<Row> = readonly [
  bucketKey: BucketKey,
  child: readonly [publicKey: PublicKey, row: Row, order: OrderKey | undefined],
]

type BucketValue<Value> = readonly [bucketKey: BucketKey, value: Value]

type CellValue<Value> = readonly [cellId: MaterializationCellId, value: Value]
```

A route move is an ordinary weighted batch:

```text
-1 [old bucket, cell]
+1 [new bucket, cell]
```

Distinct route keys produce `ActiveBucket`. For inline modes, child rows are
ordered and reduced once per active bucket into exactly one `BucketValue`.
Routes then join with bucket values to fan the same immutable logical value out
as a `CellValue`:

```text
Route(bucket, cell) -> distinct -> ActiveBucket(bucket)
                                         |
ActiveBucket + BucketRow -> reduce ------+-> BucketValue(bucket, value)
                                                   |
Route(bucket, cell) -------------------------------+
                                                   v
                                           CellValue(cell, value)
```

The bucket-value reduction belongs to the materialization edge because two
edges may apply different materialization modes to the same child relation.
Computing it before fan-out means ordering and materialization happen once per
unique bucket rather than once per parent.

`ActiveBucket` also seeds the empty value. Every active inline bucket therefore
has exactly one value even when it has no child rows:

- `array`: `[]`;
- `singleton`: `undefined`;
- `concat`: `""`.

A null or otherwise unsatisfiable correlation may route to an active empty
bucket without creating source demand. This preserves the materialization
mode's empty value instead of relying on a placeholder or a missing join path.

D2's retained join indexes provide the required lifecycle behavior:

- adding a route joins it with the bucket's existing value;
- removing a route retracts only that cell's value;
- moving a route retracts the old rows and adds the new rows in one graph run;
- several cells may consume one bucket without recomputing its value;
- changing a bucket value reaches every current route;
- a departed route receives no later value changes.

Root rows and nested rows use the same relation shape and operators. There is
no special root routing path.

The implementation must not recreate these semantics with route registries,
reverse indexes, drained buffers, or per-depth snapshots outside D2. Existing
retained operator state is the first implementation choice. Add a reusable
arrangement only if counters show that the compiler duplicates indexes or
state; arrangements are a physical optimization, not part of correctness.

The total-materialization law is:

> Every active inline materialization cell has exactly one canonical value,
> including when its bucket contains no rows.

## Nested materialization

The compiler builds each include from the materialized output relation of its
child:

```text
child base rows
      + child include values
      -> child materialized rows
      -> rows in the parent's bucket relation
      -> parent include value
```

A descendant update therefore becomes an ordinary change to the child's
materialized row and propagates through the same joins and reductions at every
depth. There are no depth-specific flush passes, dirty-cell registries, or
manual relation revisions.

Inline modes are reductions over the rows in one active bucket:

- `array`: total-order the rows and return their values;
- `singleton`: choose the first row under the total order;
- `concat`: total-order the rows and concatenate their scalar values.

A total order is the query's order keys followed by a deterministic stable
tie-breaker, normally the child public key. An order-only change is a
bucket-value change for arrays, singletons, concatenation, and Collection
layout.

A bare child query is a Collection-valued include. It exposes one stable public
Collection facade per active bucket in that edge:

```text
BucketRow -> BucketFacade(bucket, Collection)
Route + BucketFacade -> CellValue(cell, Collection)
```

Parents sharing a bucket share its facade. Child changes update that Collection
without re-emitting every parent, and moving a route changes the parent field to
the destination bucket's facade. A facade is never retargeted to another
bucket. The adapter retains a facade only while at least one parent route uses
its bucket. When the last route leaves, it retracts the facade's rows and drops
its strong reference. An external holder may keep that empty Collection alive,
but a later active interval gets a new facade. Inline modes do not create child
Collections.

Composition is pure. It constructs a new result along changed paths and does
not mutate a previously published row or use public routing metadata:

```ts
compose(
  baseRow: BaseRow,
  includeValues: ReadonlyMap<MaterializationEdgeId, unknown>,
): MaterializedRow
```

## Demand plane

Demand is derived from data, but it performs asynchronous side effects outside
D2:

```text
ActiveBucket(bucket, demand parameters)
    -> group by [source, parameterized child plan]
    -> current demanded parameter set
    -> demand adapter
    -> source loadSubset / release
    -> source deltas return to D2 inputs
```

The adapter treats demand as coverage, not as one request per bucket:

```ts
type DemandPlanId = Brand<string, 'DemandPlanId'>

type DemandSet = readonly [
  planId: DemandPlanId,
  parameters: CanonicalSet<CanonicalCorrelationKey>,
]
```

One request may cover many buckets, and the adapter may coalesce or reuse
requests according to the compiled demand plan. Its semantic contract is:

> Every active, satisfiable bucket must be covered by a settled current demand
> request before initial preload completes.

A request may remain in flight after some covered buckets become inactive.
Those buckets no longer participate in readiness and cannot receive rows
through routes that no longer exist. Sharing source work never merges the route
rows themselves.

The source contract stays abstract: a demand request eventually establishes
one coherent baseline and identifies when that baseline is complete. Each
request receives an `AbortSignal`. Replacing or releasing its demand aborts
that signal, and the source must check it before installing fetched rows. An
aborted request cannot install or settle after its graph or request generation
becomes obsolete. Buffering, snapshot tokens, shape offsets, Collection
transactions, and local indexes are source-specific ways to satisfy that
contract; they are not materializer state.

This project uses a single graph-run order rather than multi-dimensional
timely-dataflow frontiers. Do not introduce a general timestamp or frontier
framework unless a source contract proves that the generation and up-to-date
protocol cannot express its ordering.

**Initial readiness:** preload is complete when every demand currently
reachable from the initial query graph is covered by a settled request. Demand
that is no longer reachable does not block completion. An empty outer relation
has no child demand, but its root demand must still settle. Later readiness
transitions follow the existing Collection contract until an executable test
defines another public behavior.

Pending demand does not hide the parent row. An active empty bucket gives it
the current canonical bucket value, and available partial source rows produce
the current partial materialization when the source supports progressive
delivery. Later source rows enter D2 as ordinary deltas and recompute the
parent. “Fully composed” means that every include field has its canonical value
for the graph's current input state; it does not mean that asynchronous demand
has settled.

## Coherent publication

D2 runs until the whole materialization graph has no pending synchronous work
for its currently available inputs. Only fully materialized canonical root
deltas cross into the public Collection.

For each scheduled graph turn:

1. enqueue all currently committed input deltas into their D2 inputs;
2. run D2 until it has no pending synchronous work;
3. consolidate the already canonical final-output deltas;
4. install child-facade state through normal Collection transactions while
   deferring their subscriber delivery;
5. apply direct root insert, update, and delete writes through one normal
   Collection transaction;
6. release the deferred child-facade events after every synchronous read can
   see the complete root and facade state;
7. allow dependent live-query graphs to run through the existing
   transaction-scoped scheduler.

The Collection boundary performs no identity reconciliation, routing,
materialization, or multiplicity interpretation. The canonical root relation
has already done that work.

The public Collection is an output, never scratch state. Placeholder rows,
in-place include repair, and forced secondary events are forbidden.

Installed state, synchronous reads, change-event payloads, and downstream
queries must all observe the same fully materialized commit. The facade adapter
may defer event delivery across its Collection transactions, but it must not
defer state or index installation. Routing and identity remain inside D2.

## External boundaries

### Query-db ownership

Row ownership in `@tanstack/query-db-collection` is separate. Eager retention,
active query acquisition, and persisted retention are distinct owner tokens.
The live-query graph publishes coherent rows but does not own query-db cache or
listener lifetime.

### Physical planning and work

Correct relation state does not prove efficient work. When an applicable index
exists, irrelevant correlated rows must not cause scans of unrelated rows or
activate unrelated downstream routes. Relation rows, indexed keys, active
demands, materialization cells, and public facades are the relevant space
units. Inline materialization must not create recursive Collection machinery.

## Normative laws

1. **Alpha-renaming:** lexical alias names cannot change results.
2. **Contribution conservation:** a public row exists exactly when its reduced
   supporting weight and collision policy produce one.
3. **Batch partition:** equivalent valid split and atomic deliveries converge.
4. **Route relation:** current route rows joined with current bucket values
   equal current materialization-cell values.
5. **Total materialization:** every active inline cell has exactly one value,
   including its mode's empty value when its bucket has no rows.
6. **Stale demand:** an obsolete graph or demand generation can neither publish
   rows nor settle current readiness.
7. **Nested propagation:** every materialized relation consumes the fully
   materialized output relation of its children.
8. **Publication:** reads, events, and downstream queries observe the same
   complete graph result.
9. **Initial demand:** preload completes when every initially reachable demand
   is covered; obsolete demand does not block it.
10. **Ownership:** a query-db row exists exactly while an explicit owner
    remains.
11. **Work:** irrelevant rows do not cause unrelated scans or activate unrelated
    routes when an applicable index exists.
12. **Space:** state scales with retained D2 relation/index rows, active demands,
    materialization cells, visible rows, and required Collection facades.

## Glossary

- **Relation:** an internal weighted multiset maintained by D2, not a public
  TanStack Collection.
- **Weighted delta:** a positive or negative change to a relation row.
- **Data plane:** the D2 graph that joins, reduces, orders, and materializes
  relations.
- **Demand plane:** the async adapter that starts and releases source loads.
- **Bucket key:** the canonical identity of one correlated child partition.
- **Bucket relation:** child rows partitioned by bucket key.
- **Active bucket:** a bucket referenced by at least one current route; it seeds
  empty materialization values and contributes to source demand.
- **Bucket value:** the one inline value reduced from an active bucket's rows.
- **Route relation:** weighted links from bucket keys to materialization cells.
- **Materialization cell:** one include field on one parent-row occurrence.
- **Arrangement:** retained relation state indexed for efficient keyed access
  and reuse.
- **Reduction:** deriving one visible value from weighted rows sharing a key.
- **Hydration:** establishing an initial snapshot before forwarding later
  changes.
- **Generation:** a token that rejects obsolete asynchronous work.
- **Collection facade:** a stable public Collection view shared by the parents
  routed to one active bucket.
- **Coherent commit:** one publication in which state, events, and consumers see
  the same fully materialized result.

## Executable contracts

| Contract                                                                    | Test suite                                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| State equivalence, route lifecycle, transition history, and batch partition | `packages/db/tests/query/includes-oracle.property.test.ts`                |
| Joined multiplicity, alias identity, and null-key normalization             | `packages/db/tests/query/includes-query-shape-oracle.test.ts`             |
| Demand, cancellation, and progressive timing                                | `packages/db/tests/query/includes-temporal-oracle.test.ts`                |
| Optimistic confirmation, rollback, and later reactivity                     | `packages/db/tests/query/includes-optimistic-oracle.property.test.ts`     |
| Coherent layered publication                                                | `packages/db/tests/query/includes-publication-oracle.test.ts`             |
| Correlated physical work                                                    | `packages/db/tests/query/includes-work-counter-oracle.test.ts`            |
| Query-db ownership                                                          | `packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts`   |
| Reachable nested shape                                                      | `packages/query-db-collection/tests/includes-work-counter-oracle.test.ts` |

Each oracle identifies the first divergent checkpoint and compares either the
whole result or one exact structural difference. Correlated-materialization
scenarios use direct assertions. A boundary suite may retain an exact
expected-failure guard for a planner or ownership defect that this graph does
not own.

## Implementation discipline

- Express relation state with existing D2 inputs, joins, reductions, grouping,
  ordering, and consolidation before adding custom state.
- Keep route and bucket rows in the same graph as parent and child query rows.
- Add a reusable indexed D2 primitive only when existing operators cannot share
  or expose required retained state.
- Keep asynchronous demand state outside D2 and make its generation boundary
  explicit.
- Never use a public Collection, emitted event, or materialized row as internal
  routing or contribution state.
- Add a reduced oracle trace before adding any special lifecycle branch.
- Measure retained relation rows, active demands, and public facades so the
  simpler architecture remains a space improvement as well as a correctness
  improvement.
