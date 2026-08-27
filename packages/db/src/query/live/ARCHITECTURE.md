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

The applied-settlement receipt and optional subset source result described
below are its only new public boundary contracts. Optimistic transactions are
another source of weighted input changes; they do not have a separate routing
model.

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

## Concrete implementation map

The relation and identity names in this document describe the graph's logical
model. They are not a second set of runtime objects, nor does every name need a
matching TypeScript type. The implementation maps this model onto existing D2
operators and a few boundary adapters:

| Architectural role                    | Concrete implementation                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Compile relation IDs and demand plans | `packages/db/src/query/compiler/index.ts`, `packages/db/src/query/compiler/joins.ts`                   |
| Reduce public keys and build routes   | `packages/db/src/query/live/materialized-pipeline.ts`                                                  |
| Run the graph and publish root rows   | `packages/db/src/query/live/collection-config-builder.ts`                                              |
| Publish Collection-valued buckets     | `packages/db/src/query/live/bucket-facade-adapter.ts`                                                  |
| Start and release asynchronous demand | `packages/db/src/query/live/subset-demand-controller.ts`, `packages/db/src/collection/subscription.ts` |
| Reconcile ordered source windows      | `packages/db/src/query/total-order.ts`, `packages/db/src/query/live/window-state.ts`                   |

Queries without includes keep the original compiled pipeline and do not pay
for facade state. The one exception is a joined query with a custom public-key
function: its possible duplicate contributors still pass through the keyed
reduction that enforces public-key congruence and multiplicity.

## Identity

Aliases are lexical query-language names rather than source runtime identities.
The query builder requires collection aliases to be unique within each lexical
scope and rejects nested queries that shadow an ancestor alias. Sibling include
scopes may reuse an alias because neither alias is visible to the other.
Compilation then assigns opaque IDs to the accepted plan:

```ts
type SourceId = Brand<string, 'SourceId'>
type RelationNodeId = Brand<string, 'RelationNodeId'>
type MaterializationEdgeId = Brand<string, 'MaterializationEdgeId'>
```

An explicit projection can alpha-normalize aliases because its field names
define the public shape. Without a projection, joined and grouped queries return
a namespaced row whose keys are the lexical aliases. Those observable keys are
part of query identity. Alias text may otherwise remain as debug metadata
without becoming source identity.

A `CanonicalCorrelationKey` is the canonical tuple of every evaluated
parent-dependent value that can affect the child plan. This includes values
used by filters, joins, grouping, aggregates, ordering, projections, limits,
and nullable predicates, not only the obvious foreign-key equality.

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

### Route-context transport

A parent reference is a lexical dependency, even when it appears below the
immediate child query. For every parent reference that the builder can inspect,
the compiler must:

1. discover it across nested includes, `QueryRef` sources, union branches, and
   joined sources;
2. include its evaluated value in the route identity;
3. attach that route context before the first operator that evaluates it; and
4. preserve it through each later recursive source, join, grouping, and
   materialization edge.

The third rule fixes the evaluation order. A parent-dependent filter, join key,
aggregate wrapper, order, or window must run once per parent route. It cannot
run on a shared child relation first and receive a route after the fact.

The route-context grammar crosses these dimensions:

```text
lexical dependency scope
  x recursive source boundary (nested include, QueryRef, union)
  x recursive result shape (record, scalar, nullable scalar)
  x evaluation phase (filter, join, group, aggregate, order, window)
  x join side and correlation attachment point
  x materialization form
  x parent or child update
```

Adding one dimension to the query language requires checking its product with
the others. A passing one-level filter case does not prove a nested aggregate,
joined subquery, or union branch transports the same context.

The executable oracle factors that product into valid compiler sub-grammars:

- parent field projection by whole-row projection;
- unmatched correlation values by null correlation values;
- lexical scope, including nested outer and inner materialization forms;
- grouping mode by aggregate-expression placement;
- recursive source boundary by evaluation phase; and
- join-key side by correlation attachment point;
- union form and public-key identity; and
- derived-result boundary by selection mode and scalar nullability.

Objects carry route metadata as hidden fields while the compiler moves them
through recursive sources. Scalars, including `null`, cannot carry fields, so
the compiler uses an internal envelope at those same edges. Namespacing and
join adapters unwrap the value, keep the route beside it, and never expose the
envelope in the public query result.

Every valid plan is checked as a Collection, `toArray`, and `materialize`
include at initial load, after a parent-route update, and after a child update.
The grammar declarations generate the cases; individual reported defects do
not get one-off tests outside that product.

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

At the asynchronous source boundary, `TotalOrder` resolves every direction,
null-placement, and string-collation option and appends the collection public
key. `WindowState` uses that order for the retained prefix, admission, refill,
and continuation boundary. Independent join demands may retain extra source
rows, but those rows do not move the ordered boundary. The D2 top-K operator
uses the same query terms and public-key tie-breaker for emitted layout.

An adapter receives only the leading order terms owned by its lexical source.
Later terms that depend on a joined or derived row stay in D2. Since the public
key tie-breaker is local and is not part of the adapter query, a finite source
prefix is only a candidate prefix. Core expands the complete source-order
boundary class, then applies the public-key tie-break locally. Locale and
reference orders that the predicate IR cannot express fetch the full filtered
region and refine it locally.

Every continuation boundary comes from rows established by the same ordered
demand. Rows retained for another query, join, or window cannot move it. During
a failed truncate replay, the last complete publication remains the boundary;
a partial replacement snapshot has no continuation provenance. Exact applied
row keys and source extent advance retained coverage. Public readers also keep
that last complete publication while every overlapping replacement attempt is
pending. A successful current replacement publishes its settled ordered
reconciliation once, but only after applied evidence proves the retained prefix
or authoritative exhaustion. A continuing page stays private while its next
acquisition refines that evidence. Retained window size is grow-only for the
life of the subscription, so a smaller request during replacement cannot undo a
larger prefix already requested. Failure of the current ordered demand or any
still-active demand publishes no replacement batch.
Each active demand in that replacement settles on its own, and the replacement
waits for every acquisition it started. The published reconciliation is the
retained ordered prefix plus rows required by every still-active other demand.
Releasing a demand removes its rows from that union, but does not erase that
settlement barrier or turn its cooperative abort into a replacement failure.
Starting a newer attempt aborts every older acquisition. Those obsolete
acquisitions must still settle, but their abort cannot veto a successful current
attempt. Source deltas that race the current replacement stay private until
reconciliation, then join the retained prefix when their order places them
there. A superseded attempt's rows stay private, and only the current
reconciliation may publish. Teardown discards the whole replacement epoch, so
later source writes and late settlements cannot reach public readers. Here a
publication means a change to reader-visible state; an empty transport callback
does not count as one.
A requested limit, a settled promise, or the number of requests does not.
Applied keys carry two distinct facts. Every applied source key may advance the
continuation cursor, including a row excluded by the subscription predicate.
Only applied rows admitted to that subscription's retained result prefix count
toward its covered size. Thus a short continuing page cannot turn a requested
prefix into achieved coverage, but an excluded row can still move the next
request past source data that core has already inspected.
Predicate-invisible source changes do not invalidate that visible prefix. When
an applied receipt establishes those rows, they still remain exact source
provenance and may move the continuation boundary.

Automatic continuation is monotonic. Its identity is the retained demanded
prefix plus the exact total-order boundary, including the public key. Core may
start another request only when that prefix grows or that boundary moves. If a
continuing page establishes neither fact, core leaves the window uncovered,
does not repeat the same request, and records a nonfatal no-progress diagnostic
in `lastSubsetError`.

Live Collections and Effects keep separate consumer-local continuation state,
but obey the same identity and reset law. A settled request remains the
no-progress guard until its demanded prefix or total-order boundary changes;
settlement alone must not permit a busy loop. Prefix refinement and truncate
revoke an active guard. A rejected Effect source is not retried in place: the
source error disposes that Effect, and teardown clears all of its guard state
before a replacement consumer can start. The consumer-parity oracle runs the
same hidden-boundary history through both implementations so neither can
silently drift from this law.

A truncate replay remains part of the original logical demand. Its replacement
acquisition must therefore notify the same result observer that tracked the
initial acquisition. Ordered consumers treat that replay as their in-flight
load, so they cannot race it with a duplicate refill. If the replay settles
without covering the retained prefix, its observer may start exactly one
continuation after all replacement acquisitions have settled.

An outcome-free completion (`true` or `Promise<void>`) supplies no reusable row
provenance, source extent, or CoverageFact. Its exact request has still settled,
so the owning subscription may admit only the current local prefix. A short
page remains uncovered and triggers another pass. The admitted local boundary
may distinguish those immediate passes, but it is scheduling state, not a
transport cursor. If the window later grows, core refreshes the required prefix
from the start instead of continuing from those rows as a cursor boundary.

A bare child query is a Collection-valued include. It exposes one stable public
Collection facade per active bucket in that edge:

```text
ActiveBucket + BucketRow -> ActiveBucketRow -> BucketFacade(bucket, Collection)
Route + BucketFacade -> CellValue(cell, Collection)
```

Parents sharing a bucket share its facade. Child changes update that Collection
without re-emitting every parent, and moving a route changes the parent field to
the destination bucket's facade. A facade is never retargeted to another
bucket. The D2 join retains inactive bucket rows and emits their current
snapshot when the bucket becomes active; the facade adapter does not buffer
discarded deltas. The adapter retains a facade only while at least one parent
route uses its bucket. When the last route leaves, it retracts the facade's rows
and drops its strong reference. An external holder may keep that empty
Collection alive, but a later active interval gets a new facade. Inline modes
do not create child Collections.

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
requests according to the compiled demand plan. A coalesced request has one
shared abort lease. If one owner releases its lease, the source request remains
active while another owner still needs its coverage. The source signal aborts
only after every attached owner has released it.

A Collection subscription installs each logical subset owner before it calls
the source adapter. Reentrant release during `loadSubset` must therefore see and
release that exact acquisition. A synchronous `loadSubset` throw that did not
follow a failed release rolls the tentative owner back without calling
`unloadSubset`; a failed release keeps the owner so a later cleanup can retry the
same acquisition identity.

Its semantic contract is:

> Every active, satisfiable bucket must be covered by a settled current demand
> request before initial preload completes.

A request may remain in flight after some covered buckets become inactive.
Those buckets no longer participate in readiness and cannot receive rows
through routes that no longer exist. Sharing source work never merges the route
rows themselves.

The source contract stays abstract: a demand request eventually establishes
one coherent baseline and identifies when that baseline is complete. Each
request receives an `AbortSignal`. Cancellation is cooperative at this source
boundary. Core guarantees that an obsolete request cannot settle current
readiness; the source must honor the signal immediately before installing a
baseline or later request-scoped result. Core cannot prevent an arbitrary
adapter from writing after it ignores that signal. Buffering, snapshot tokens,
shape offsets, Collection transactions, and local indexes are source-specific
ways to satisfy that contract; they are not materializer state.

Every sync `commit()` returns an applied receipt: `true` when that
transaction's writes and events are already visible, or a promise when the
transaction is parked in the causal queue. The promise resolves only after the
writes and events become visible. It rejects with `AbortError` if request
cancellation or collection cleanup abandons the transaction first. An abort
after application has no effect. Application becomes irrevocable before change
events are emitted, so an abort raised by a publication observer is already
late. A successful `loadSubset` implementation must await or return every
receipt for the transactions that establish its result. A source must not add
priority merely to make a subset load settle.
Existing immediate bootstrap and persistence-hydration paths, plus truncate,
retain their queue-bypass contract; if one applies a parked subset transaction
as part of that prefix, the subset receipt settles only after the writes are
visible. Rejected, canceled, and obsolete acquisitions establish no coverage.
Sources must honor cancellation before publishing request-scoped rows.

After those writes are applied, `loadSubset` may resolve with
`{ hasMore: boolean | undefined, appliedRowKeys?: readonly Key[] }`. Core
normalizes the extent to `continues`, `exhausted`, or `unknown` and binds it to
the exact collection demand and attempt generation. The optional keys are the
rows established by that same applied acquisition, not a later scan of the
Collection. An omitted result remains `unknown`. A request reused for a narrower demand may
settle that demand, but its raw extent does not become a fact about the narrower
demand. Live-query plumbing preserves these outcomes through lazy demand and
window coordination. Only the root paginated source may use them to replace a
peek-based pagination decision.

The Collection sync boundary gives each logical owner a demand lease and each
physical attempt an acquisition token. Logical peers waiting on the same
physical promise attach their leases to that one acquisition even when their
canonical demands differ. Each lease keeps its own demand, generation, and
coverage claim, while the physical acquisition owns one applied row set until
its final lease releases. A released lease stops contributing active coverage
at once, but its immutable publication identity remains dormant until the
physical acquisition settles or retires. This lets an exact physical result
attach its applied rows when that exact caller released before settlement but a
peer still owns the physical work. A synchronous `true` result creates no
physical resource. It attaches the new logical lease to an active acquisition
whose published coverage proves the demand. Exact-scope reuse may also attach
ownership-only to a live applied acquisition whose extent remains unknown.
Non-exact applied evidence attaches only when its rows locally prove
caller-relative continuation. An exact or locally proven continuing projection
may become caller-relative evidence, but only the continuing projection becomes
a new coverage fact. Unknown evidence still owns the physical acquisition and
rows; it does not enter the coverage antichain or satisfy a later demand.
Starting a newer attempt does not supersede
viable coverage; the current generation advances only when that attempt
publishes authoritative coverage.

The coverage registry accepts an exact applied outcome and its row keys as one
publication. It rejects stale or mismatched tokens for the same physical
collection, optional source, and canonical demand. An `unknown` extent records
the acquisition's applied row ownership but proves no coverage. A finite prefix
of `N` is established only by at least `N` applied authoritative rows, or fewer
rows plus exact source exhaustion. Callers cannot derive achieved coverage from
the requested limit or publish rows and coverage in separate steps. Failed,
canceled, and stale work publishes neither rows nor coverage. Public reads
return defensive snapshots; fact compaction never mutates or retires the
underlying leases, acquisitions, or row ownership.

A truncate replay publishes replacement applied rows and their acquisition
ownership before it releases the prior lease. This handoff is one ownership
transition from the Collection's point of view: replacing a row with the same
key cannot let old-owner garbage collection delete the new value. A failed or
obsolete replacement leaves the old lease in place and retires only the new
attempt.

An imperative load operation reports caller-relative evidence, not merely the
promises started while it was active. If a successful operation starts no new
physical request because exact active coverage already proves its demand, it
retains that applied outcome in the operation result instead of publishing an
empty outcome set.

Adapter release and `unloadSubset` callbacks must be idempotent and
non-throwing. Core still treats a thrown callback defensively: it surfaces the
original error but preserves the acquisition, lease, coverage, and row owners.
A later cleanup retries callbacks that have not yet settled. Logical ownership
retires only after every callback required by that release step succeeds. Rows
whose final acquisition owner retires are deleted once through the normal
Collection sync boundary; shared rows remain until their final owner retires.
An adapter that uses `DeduplicatedLoadSubset` across live-query lifetimes must
also return the helper's paired `unloadSubset` callback. That callback
invalidates remembered request coverage when core may delete its establishing
rows. A dedupe hit cannot outlive the evidence it claims to reuse.

An eager Query DB collection owns its base query for the Collection lifetime.
If TanStack Query removes that cache entry while the Collection has no public
listeners, the adapter must replace the detached observer without retiring the
base query's rows. Later cache updates and refetches must still flow through
that lifetime observer.

A transaction `mutationFn` must not start or await collection or live-query
preloads. User persistence owns the causal queue while that function runs, so a
preload that waits for a queued sync commit can wait on the mutation that is
waiting on the preload. Use an adapter's documented mutation acknowledgement
helper instead; it must confirm the optimistic write without starting new
collection demand.

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
units. Queries without includes retain their original pipeline unless a joined
custom-key query needs contributor reduction. Inline materialization must not
create recursive Collection machinery.

## Normative laws

1. **Alpha-renaming:** changing any accepted alias to another unused name cannot
   change an explicitly projected result. An implicit namespaced result keeps
   its aliases as public field names. Aliases must be unique within one lexical
   scope and cannot shadow an ancestor alias. Sibling scopes may reuse aliases.
2. **Contribution conservation:** a public row exists exactly when its reduced
   supporting weight and collision policy produce one.
3. **Batch partition:** equivalent valid split and atomic deliveries converge.
4. **Route relation:** current route rows joined with current bucket values
   equal current materialization-cell values.
5. **Total materialization:** every active inline cell has exactly one value,
   including its mode's empty value when its bucket has no rows.
6. **Stale demand:** an obsolete graph or demand generation cannot settle
   current readiness, and a conforming source cannot publish its request-scoped
   rows after cancellation.
7. **Applied settlement:** a successful subset load settles only after its
   establishing sync transactions are visible; a source must not add queue
   priority merely to force the load to settle. Any reported source extent is
   scoped to that exact demand and attempt.
8. **Nested propagation:** every materialized relation consumes the fully
   materialized output relation of its children.
9. **Publication:** reads, events, and downstream queries observe the same
   complete graph result.
10. **Initial demand:** preload completes when every initially reachable demand
    is covered; obsolete demand does not block it.
11. **Ownership:** a query-db row exists exactly while an explicit owner
    remains.
12. **Work:** irrelevant rows do not cause unrelated scans or activate unrelated
    routes when an applicable index exists.
13. **Space:** state scales with retained D2 relation/index rows, active demands,
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
- **Source extent:** an authoritative source fact that more rows continue past
  an exact demand, that the source is exhausted there, or that neither is known.
- **Collection facade:** a stable public Collection view shared by the parents
  routed to one active bucket.
- **Coherent commit:** one publication in which state, events, and consumers see
  the same fully materialized result.

## Executable contracts

| Contract                                                                    | Test suite                                                                 |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| State equivalence, route lifecycle, transition history, and batch partition | `packages/db/tests/query/includes-oracle.property.test.ts`                 |
| Joined multiplicity, alias identity, and null-key normalization             | `packages/db/tests/query/includes-query-shape-oracle.test.ts`              |
| Demand, cancellation, and progressive timing                                | `packages/db/tests/query/includes-temporal-oracle.test.ts`                 |
| Optimistic confirmation, rollback, and later reactivity                     | `packages/db/tests/query/includes-optimistic-oracle.property.test.ts`      |
| Coherent layered publication                                                | `packages/db/tests/query/includes-publication-oracle.test.ts`              |
| Collection facades, event coherence, and route activation                   | `packages/db/tests/query/includes-collection-oracle.property.test.ts`      |
| Correlated physical work                                                    | `packages/db/tests/query/includes-work-counter-oracle.test.ts`             |
| Route-context discovery and transport across recursive and join boundaries  | `packages/db/tests/query/includes-context-transport-oracle.test.ts`        |
| Ordered source coverage, total boundaries, and window transitions           | `packages/db/tests/query/pagination-oracle.property.test.ts`               |
| Truncate replacement, retained publication, and boundary provenance         | `packages/db/tests/collection-subscription-replay-oracle.property.test.ts` |
| Coverage leases, acquisitions, fact compaction, and row provenance          | `packages/db/tests/query/coverage-registry-oracle.property.test.ts`        |
| Applied coverage publication through the Collection sync boundary           | `packages/db/tests/load-subset-outcome.test.ts`                            |
| Query-db ownership                                                          | `packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts`    |
| Reachable nested shape                                                      | `packages/query-db-collection/tests/includes-work-counter-oracle.test.ts`  |

Each oracle identifies the first divergent checkpoint and compares either the
whole result or one exact structural difference. Correlated-materialization
scenarios use direct assertions. A boundary suite may retain an exact
expected-failure guard for a planner or ownership defect that this graph does
not own.

Run the DB oracle set with `pnpm test:oracles` from `packages/db`. Broad
properties use FastCheck's random seed, while structural matrices keep fixed
seeds so each run covers the same named cells. Increase both corpora with
`TANSTACK_DB_ORACLE_RUNS_MULTIPLIER=10 pnpm test:oracles`. Preserve FastCheck's
reported seed and shrink path while reducing a failure. Replay a broad
campaign with `TANSTACK_DB_ORACLE_SEED=<seed> pnpm test:oracles`, then add the
smallest case as a deterministic regression trace.

The broad relationship history changes correlation keys rather than freezing
them. Set `TANSTACK_DB_ORACLE_STATISTICS=1` to print its generated depth,
relationship-change, optimistic, and delete distribution. Collection-valued,
array, and materialized includes are checked together for every Collection
scenario instead of relying on a random mode sample. A separate metamorphic
oracle compares nested includes with a flat join, fresh per-parent queries, and
three-valued predicate partitioning.

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
- Measure retained relation rows, active demands, and public facades. Preserve
  the no-includes fast path and verify any claimed space improvement with those
  counters.
