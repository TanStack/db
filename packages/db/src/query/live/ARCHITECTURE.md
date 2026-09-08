# Live-query materialization architecture

This document defines the architecture for correlated live-query
materialization in `@tanstack/db`. It follows
[RFC #1658](https://github.com/TanStack/db/issues/1658).

The central rule is simple:

> Keep relation contents, routes, nested materialization, and propagation in
> one D2 graph. Use custom state only at asynchronous source and public
> Collection boundaries.

The correlated-materialization oracle suites listed below are behavioral
contracts for this design. Functional projections accept inline include values,
not compiled Collection-valued inputs. Suites for
adjacent planner and query-db ownership boundaries may also contain exact
classifiers for defects outside this graph.

## Scope

This architecture covers:

- compiled identities for sources, relations, and materialization edges;
- weighted contributions and public-key reduction;
- correlated routes and ordered bucket contents;
- nested inline and Collection-valued materialization;
- lazy and progressive source demand;
- coherent publication to public Collections;
- the boundaries with query-db ownership and physical query planning.

The applied-settlement receipt described below is its only new public boundary
contract. Optimistic transactions are another source of weighted input changes;
they do not have a separate routing model.

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

| Architectural role                        | Concrete implementation                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Compile relation IDs and demand plans     | `packages/db/src/query/compiler/index.ts`, `packages/db/src/query/compiler/joins.ts`                   |
| Reduce public keys and build routes       | `packages/db/src/query/live/materialized-pipeline.ts`                                                  |
| Run the graph and publish root rows       | `packages/db/src/query/live/collection-config-builder.ts`                                              |
| Publish Collection-valued buckets         | `packages/db/src/query/live/bucket-facade-adapter.ts`                                                  |
| Start and release asynchronous demand     | `packages/db/src/query/live/subset-demand-controller.ts`, `packages/db/src/collection/subscription.ts` |
| Ordered provider loading and continuation | `packages/db/src/query/live/ordered-source-loader.ts`                                                  |

Queries without includes keep the original compiled pipeline and do not pay
for facade state. The one exception is a joined query with a custom public-key
function: its possible duplicate contributors still pass through the keyed
reduction that enforces public-key congruence and multiplicity.

### Loading handoffs

These owners cooperate; they are not phases of one exclusive state machine.
The detailed loading and publication laws below still apply.

| Owner                             | Accepts / retires                                                                                                                                     | Does not establish                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Subscription acquisition          | Tentatively installs the candidate before adapter callbacks; `acceptAcquisitionTransfer` hands off the old lease; each lease gets one cleanup attempt | Replay completion or permission to publish                |
| OrderedSourceLoader               | Tracks request settlement, safe continuation and repair debt; reset discards the cursor, disposal ignores late settlement                             | Provider exhaustion or acceptance of an imperative window |
| Subscription replay               | Counts setup and logical acquisition participants; checks completion after reentrant release callbacks; success releases the source replacement hold  | Success of a previously failed window operation           |
| Query builder                     | Tracks ordered publication participants in one sync session and accepts a window only for its operation generation                                    | Physical adapter ownership or cancellation                |
| D2 and public Collection boundary | D2 accumulates private result changes; the builder flushes root and child changes when the existing gates allow it                                    | Source completeness merely because graph work drained     |

Session and participant checks precede changes to the builder's ordered failure
state, not just scheduling. An obsolete rejection cannot close a replacement
session's publication gate. Loader-local stale-result guards are separate.

`hasPendingTruncateReplacement` means publication is still withheld, including
after replay failure. `pendingTruncateReplacement` exposes only an unsettled
completion promise. Neither is a general readiness flag. A direct subscriber
buffers and diffs its own replacement rows; a query subscription delegates
publication to the builder while the graph keeps its private contributions.

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
match. Equality tokens collapse `-0` with `0`, compare Date, Temporal, and
binary values by the same normalized value as `eq`/`in`, and retain runtime
reference identity for other objects, functions, and symbols. These tokens are
valid only for equality-keyed routing, grouping, and demand. Output values and
arbitrary function arguments keep their exact runtime identity and value.
Tree indexes give symbols a stable runtime-local order because JavaScript
relational comparison throws for them; comparator equality still holds only
for the same symbol. That order is a physical index detail: symbol range
predicates fall back to the evaluator instead of treating it as query
semantics. Range predicates also fall back when the live indexed values do not
share the bound's relational domain. An index's advertised comparison options
also define its executable comparator; metadata cannot claim an order that the
index does not use. Explicit `undefined` range and cursor bounds denote the
indexed nullish comparator group, while an absent bound denotes the start or
end of the index. An ordered index groups exact value
buckets that compare at the same position and keeps a live representative for
each group, so range traversal and ordered limits cannot drop rows whose
distinct values are comparator-equal.
Compiler tokens belong to one compiled graph. This keeps every operator in the
graph on the same identity relation. Objects, functions, and local symbols are
weakly keyed where the runtime supports weak symbol keys. Older runtimes retain
local symbols strongly within the scope rather than collapse distinct symbols
and corrupt equality. Registered symbols use their registry key because the
runtime registry already retains them. A demand controller owns a separate
scope and discards it when the controller is cleared. Process-wide query
identity and opaque public group keys keep their own runtime scope because
equivalent query plans and retained public keys must survive graph replacement.
For grouping, the equality token is the D2 group key. The group retains a raw
value from a currently positive contributor only as the projected
representative. The representative is chosen by stable source-row identity, so
restoring the same source state restores the same value regardless of update
history. D2 sees only safe exact-value identity for that representative, not
the raw value itself. A separate public group key preserves primitive keys and
serializes opaque equality identity; graph-local identity tokens never cross
the Collection boundary. Compiler group fields use a query-local namespace
disjoint from every selected alias. Direct correlated joins canonicalize both
sides before the first D2 join; normalizing only the later group key is too
late.

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
- derived-result boundary by selection mode and scalar nullability; and
- user namespace collision by parent alias and selected child field, crossed
  with direct, `QueryRef`, join, and group boundaries; and
- public-surface shape across opaque atomic values, opaque wrappers, nested
  reference identity, user symbol keys, adversarial property keys, functional
  spreads, and implicit joins.

Plain record results carry route metadata under a private symbol while the
compiler moves them through recursive sources. Primitives and opaque objects,
such as `Date`, use an internal envelope at those same edges. Namespacing and
join adapters unwrap the value and keep its route beside it. Every functional
callback whose source can carry route state receives a clean copy of only the
paths that contain private state; this includes recursive and union sources,
not only directly correlated child queries. The callback boundary removes all
compiler-owned fields before invoking user code. The publication boundary
applies the same copy-on-write walk while resolving facade references. Both
paths preserve property descriptors, clean nested references, cycles,
adversarial keys, and user-owned symbols. Discovery reads data descriptors
directly and never invokes an accessor merely to find private state.

This walker also strips metadata from a correlated subquery's output before
its parent query consumes it. Clean object and array references at that internal
boundary are equality operands, not just render identities. Eagerly cloning
them can make a later `eq(projected.key, parent.key)` lose a matching row.
Relaxing cross-publication reference stability does not permit changing these
internal matches. The public-container copy matrix crosses reference-key type,
ordered and unordered subqueries, materialization form, and parent/child updates.

D2 hashes enumerable symbol keys and uses exact local-symbol identity plus
registry keys for registered symbols. D2 rejects structural cycles with a clear
error, including cycles through arrays, Maps, Sets, and enumerable symbol keys.
Shared acyclic subtrees remain supported and are hashed once per traversal. Structural hashing
limits recursion depth and value visits; it rejects values that exceed these
limits instead of expanding a shared graph or overflowing the JavaScript stack.
This does not bound the cost of arbitrary user getters or key sorting.
A failed hash does not publish partial
structural cache entries, so retrying the same value cannot bypass a guard.
A graph-run failure marks the current live query as errored and preserves the
thrown error. It must not continue publishing from a partly advanced graph;
recovery requires a fresh query session.
Opaque reference-hashed leaves are resolved before structural recursion; their
own properties, including self-references, are not traversed. Hash inputs must
remain immutable once successfully cached, as with other retained D2 values.
Collections register as opaque handles at construction using the existing hash
cache. Their identity, not their mutable internal state, is visible to hashing
operators in a downstream query. This does not add child-row dependencies to a
functional projection that reads a Collection-valued field.
The descriptor-preserving boundary walkers may still encounter cycles, but that
does not make cyclic structural results valid input to a hashing operator.
Symbol-only changes cannot disappear before publication, and unsupported cycles
fail rather than silently merge. Neither
boundary mutates values retained by D2. Compiler-created
parent contexts use a separate internal
envelope that keeps projected user aliases apart from the equality identity
derived from their leaves. The whole parent-context envelope is structural D2
state. This avoids reserving user aliases or selected field names while keeping
the context stable across D2 operators without collapsing two
reference-sensitive leaf values that happen to have the same object shape.

A functional projection consumes fully materialized inline input before
downstream operators run. Compiled Collection-valued includes are not supported
as `fn.select()` inputs, including nested descendants. The compiler rejects
the plan before invoking the callback, even if the callback would ignore or
pass through the Collection. This keeps callbacks inside the ordinary D2
pipeline without temporary Collection views or graph continuations.

Use `toArray()` or `materialize()` in the upstream expression `select()` to
make child values available to a functional callback. Child changes then
update the inline value and rerun the projection. To keep live child
Collections, use expression projections, or do parent-only functional work
before adding the Collection-valued include. This restriction concerns compiled
include inputs; it does not inspect arbitrary source-row fields or captured
Collections. Reading an already published Collection from a callback does not
add a child-row dependency.

Include paths describe a functional projection's input, not its arbitrary
output. A callback may drop or rename a field, or return a scalar. Its input
paths must not be attached to that output by a downstream QueryRef consumer.
The compiler consumes those descriptors through the existing D2 materializer;
downstream keys, distinct, ordering, and QueryRef consumers see the callback's
actual output. Queries without includes keep their original pipeline.

The projection matrices keep Collection-input cases as rejection checks and
exercise supported inline forms across route changes, child updates, recursive
sources, unions, and chained callbacks. Expression controls retain ordinary
Collection reads, indexes, subscriptions, rollback, pending loads, and
cleanup/restart coverage. Work counters check repeated reads on public facades.
A manual forced-GC probe checks retained public handles and captured methods
after cleanup, with live facades as a positive retention control; it is not a
whole-application heap or throughput measurement.

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

When a parent result changes, unchanged inline include arrays may receive new
object identities. Cross-publication `===` equality for those arrays is not a
contract. Their values and prior snapshots must remain correct; a downstream
query whose selected result is unchanged must not emit a spurious update. This
does not guarantee that a UI component using shallow prop comparison skips a
render, nor does it relax the stable public Collection facade contract above.

## Demand plane

### Demand grouping and ownership

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

The adapter groups demand into shared source work, not one request per bucket:

```ts
type DemandPlanId = Brand<string, 'DemandPlanId'>

type DemandSet = readonly [
  planId: DemandPlanId,
  parameters: CanonicalSet<CanonicalCorrelationKey>,
]
```

One request may serve many buckets according to the compiled demand plan.
This does not imply transport sharing between independent subscriptions.
The exact-request deduper reuses completed requests and shares in-flight work
only when callers supply no abort signal. Independently cancelable requests
use separate transports, trading duplicate concurrent fetches for simpler
ownership. An adapter may share its own resources, but releasing one owner
must not cancel work or remove rows still owned by another.

Request data is immutable from submission onward, including the options,
expression trees, comparison options, and constant payloads such as Dates,
byte arrays, and membership arrays. Core and adapters retain that data without
cloning or freezing it. Changed demand needs new request data, not edits to an
old constant, even after its first load settles: deduplication and query state
may retain its identity. Request data uses stable data properties, not stateful
getters. The signal and subscription references do not change, but their
lifecycle remains live. Cancellation and release are not data mutations.
The immutable-demand boundary matrix checks direct and deferred sync startup,
adapter return and asynchronous settlement, cancellation, and release identity.

A Collection subscription installs each logical subset owner before it calls
the source adapter. Reentrant release during `loadSubset` therefore retires the
logical owner at once, but physical release waits until the adapter returns and
proves that it established an acquisition. A synchronous `loadSubset` throw
rolls the tentative owner back without calling `unloadSubset`. Logical demand
retires even when `unloadSubset` fails. Each physical acquisition gets one release
attempt, marked before calling adapter or error-listener code. Reentrant and
repeated teardown cannot repeat it. Other acquisitions still receive cleanup,
and a cleanup failure cannot replace an earlier request failure. Core reports
the error but retains no retry debt: a broken adapter can leak external resources
if it throws before freeing them. Adapters must make their own cleanup reliable.
If releasing the old lease fails after replacement startup, the replacement
remains owned, its work is aborted, and replay fails. Ownership cannot roll back
to an old lease whose cleanup may already have taken effect.

Request predicates describe acquisition, not row ownership. Releasing a demand
does not delete matching rows from either the public snapshot or an unfinished
replacement. The source controls retention through actual row writes; a
successful authoritative replacement reconciles the retained public snapshot.
This rule also applies when another demand overlaps the released predicate or
an independent source write happens to match it. Source deletions during replay
stay private until successful publication; failure preserves the last complete
snapshot. Query filters and routes, not request release, decide which retained
source rows belong in a query result.

### Cleanup, restart, and detached waiters

Collection cleanup detaches surviving logical demand from the discarded sync
session. It aborts that session's physical work and rejects its replay barrier,
and rejects an unfinished initial preload with `AbortError`. Cleanup never
invokes first-ready callbacks; those callbacks belong to the discarded run.
Physical acquisitions belong to the sync session that created them; cleanup
retires them instead of sending an old release to a replacement adapter.
Unlike individual subset releases, a failed sync adapter cleanup callback
remains retryable only while that
retirement is current; it cannot replace a newer session's cleanup callback.
Demand requested while the Collection is cleaned up remains detached
rather than pretending that a physical acquisition succeeded. When the
Collection starts a new sync session, the subscription enters `loadingSubset`
before it queues reacquisition, then reacquires all detached demand through a
fresh private publication barrier. Settlements from the old session cannot
publish rows, report errors, or change readiness in the new session.

This is the direct subscription's restart contract, not automatic recovery of
a dependent live query. Manually cleaning up a source puts its live queries in
a terminal error state. Restarting that source alone does not revive their
graphs or publish replacement results; callers must restart or recreate the
live query itself. This differs from a source truncate, which keeps the live
query active behind its replay publication barrier.

An initial sync error also leaves newly requested demand detached, even when
the adapter has installed a loader. Same-session `markReady()` resumes that
demand; releasing it before recovery creates no physical acquisition or unload.
Queued reacquisition must not retry a failed attempt merely because both
loading and ready notifications scheduled it.

Requests waiting for a loader report one pending promise synchronously through
`onLoadSubsetResult`, including requests made during initial error or after
cleanup. The callback is not delayed until acquisition: query callers capture
its result before the snapshot request returns. This promise waits for the
recovery's publication barrier, not just adapter return. Failure rejects it with
the replay error; release, external abort, unsubscribe, or another cleanup
rejects it with `AbortError`. Later transport settlement cannot change that
outcome. Cleanup may retain logical demand for the next session, but it does
not retain the old caller's unfinished wait.

Eager collections have no subset reacquisition barrier. After cleanup, their
next public batch reconciles retained subscriber rows against the installed
state, including deletions for keys that do not return. An empty ready batch
also reconciles an empty replacement. On-demand sources cannot infer absence
from their partial installed state; their replay barrier owns replacement.

### Source cancellation and applied settlement

The initial-demand contract is:

> Every active, satisfiable bucket must be served by a settled current demand
> request before initial preload completes.

A request may remain in flight after some served buckets become inactive.
Those buckets no longer participate in readiness and cannot receive rows
through routes that no longer exist. Sharing source work never merges the route
rows themselves.

The source contract stays abstract: a demand request eventually establishes
one coherent baseline and identifies when that baseline is complete. Each
request receives an `AbortSignal`. Cancellation is cooperative at this source
boundary. An obsolete request cannot satisfy current demand. Its settlement
may release a replay wait, but never substitutes for completion of the current
acquisition. A source that can cancel request-scoped work must honor the signal
before installing more rows. A source that cannot cancel an in-flight baseline
must settle that work; core keeps overlapping replay private until then. Core
cannot prevent an arbitrary adapter from writing after it ignores both parts
of that contract. Buffering, snapshot tokens, shape offsets, Collection
transactions, and local indexes are source-specific ways to satisfy it; they
are not materializer state.

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
visible. Rejected acquisitions establish no result. Canceled or obsolete
acquisitions either stop before publishing more request-scoped rows or settle
behind the active replay barrier.

### Ordered requests, continuation, and recovery

Core constructs cursors only for one order column. A direct
`requestLimitedSnapshot()` call with a nonempty `minValues` must supply one
value and one order term; composite or partial-composite inputs throw before
local delivery or source acquisition. Multi-column queries remain supported
through the ordered loader's prefix-and-tie fallback. Its first-column equality
request closes a tie group; it is not a composite continuation cursor.

Successful settlement proves only that the exact request finished and that its
writes were applied. It does not prove source exhaustion or broader coverage.
Ordered loading reaches a fixed point from public rows and exact request
identity; it must not invent source extent from a requested limit. A local row
seen before the first ordered source request proves neither a continuation
boundary nor a remote offset. This matters when a zero-sized window admits live
source changes before it opens: the first nonzero window must still request its
prefix from the start. Starting that request proves nothing until it succeeds;
if it rejects, an explicit retry must also start at offset zero without a
cursor. The same holds after any later ordered request fails or is canceled:
the adapter may already have written only part of its response, so those rows
cannot establish a continuation boundary. The next explicit retry starts from
the source as one authoritative filtered full-source request. Core cannot know
which rows a failed request wrote, and a successful limited request proves
neither how many authoritative rows it applied nor source exhaustion. Recovery
therefore does not infer a safe finite prefix from local row count or boundary
values. This rare error path trades bandwidth for a small, sound rule and keeps
the last settled public snapshot visible until recovery succeeds. It also lets
multi-column windows revalidate after a non-boundary row leaves. If the provider
predicate cannot express the local order relation, such as locale string order,
ordinary refinement likewise loads the full source instead of treating boundary
equality as an ordered continuation. An asynchronous failure of that
full-source acquisition does not start duplicate recovery work. It keeps the
logical demand so a later truncate replay can retry one authoritative
replacement, and clears the loader's completion marker so an explicit retry
of the window can issue the request again. That explicit retry retires and
releases the earlier failed acquisition before installing its replacement, so
a later truncate replays one logical demand rather than both attempts. A
successful authoritative replay clears its source-recovery gate, but it does
not clear an unrelated failed window operation. A later explicit window move
revalidates that physical window before publishing it.

An ordered request cannot start another ordered request through its own
synchronous writes. If the adapter then throws, graph callbacks scheduled by
those writes still belong to the failed window operation and cannot retry it.
A public `setWindow()` call made from inside that synchronous operation throws
`SetWindowReentrancyError`; it must not claim that a nested window settled after
the loader suppressed its work.
The guard reads the loader's existing synchronous request state for initial
and later refinement requests, including requests after an asynchronous page.
It also rejects window changes during graph publication, before mutating top-K.
A synchronous result callback is provisional until the whole snapshot request
returns: a later local read or publication throw fails and retires that
acquisition instead of letting its queued success erase the failure.
A later explicit window operation has a new generation and may retry from the
safe source boundary.

The ordered loader retains one settled loading boundary, independently of
live rows sent to D2. It derives invalidation from the existing contribution
rows rather than tracking a second largest-row cursor. New keys may reopen
refinement, while duplicate delivery and order-equal updates do not. After a
successful finite acquisition, it reads at
most the requested limit within that request's filtered, ordered range. That
range's last available row can advance the boundary; an unrelated live outlier
cannot advance it merely by entering D2. This relies on the adapter fulfilling
the exact ordered request, not just resolving after an arbitrary partial write.
An empty range does not invent a boundary or prove source exhaustion.

An explicit window move counts current rows at or before that boundary in the
requested prefix. It acquires only the missing portion, with both cursor and
offset derived from that confirmed range, not from all observed rows. These
reads reuse the Collection's indexed snapshot code; they retain no page list
or second row index. Transfer checks and local-read work are separate costs:
counting a long prefix can still revisit its rows. Boundary-read failures use
the same authoritative recovery path as failed acquisitions. Deletes and
source-order changes invalidate finite coverage as described below. Cleanup
and truncate discard the boundary; replay establishes an authoritative source
replacement instead of reviving a stale cursor.

### Atomic window publication

An initial ordered load or imperative window move includes every page,
tie-boundary request, and forward refill needed to reach its fixed point. Its
preload or window promise cannot settle before that chain, and a failure in any
required step belongs to the same operation. Rows may enter the private D2
result while the chain runs, but the public Collection publishes the completed
window once. If refinement fails, the operation rejects and leaves the last
settled public snapshot visible. The private source and D2 state may already
have advanced, so core does not try to reconstruct the old window over that
new state. A later successful retry publishes the coherent replacement. A
superseding window also waits for older source work that still gates
publication; it does not report success until its own chosen window is visible.
Window controllers treat `getWindow()` as settled state, not the current lease
request. An overlapping preload joins its lease's pending window promise rather
than replacing it with the smaller committed page count. Lease release may also
settle asynchronously; completion, not the release call, establishes its window.
Partial window options inherit omitted fields from the active requested window,
or from the last settled window when no move is active. Collection cleanup
rejects a pending window operation with `AbortError`; it cannot report success
after discarding the graph and requested window.
That error belongs to the operation even if cleanup precedes registration of
its waiter. Cleanup does not retroactively cancel an already completed operation.
Window-operation generations stay monotonic across cleanup and restart, so a
late rejection from an abandoned session cannot reset the replacement
session's requested window.
A window move started during an active source replay waits for that replay and
applies only after its replacement is complete. A failed replay rejects the
move without advancing the reported window. Replay completion callbacks carry
their sync-session identity and become no-ops after cleanup or restart.
Cleanup rejects the replay barrier, and therefore every window move waiting on
it, with `AbortError`; no waiter may outlive the discarded subscription.
Subscription-owned Promise observers carry the Collection's load-session
generation. Cleanup invalidates that generation before adapter teardown, so an
obsolete replay cannot publish its private rows, report a late error, or emit a
late `ready` transition even when the transport ignores cancellation.
Ordinary source mutations stay synchronous except while an initial ordered
load, imperative window move, or asynchronous repair of invalid finite source
coverage owns this publication barrier. A visible delete or a change to a
visible row's source-order value can invalidate a provider prefix because a
hidden row may now belong in the window. That repair loads the authoritative
source and keeps the last complete public snapshot until it settles; an update
that compares equal under the source order does not broaden demand. Mutations
that arrive during a barrier join the private state and publish with the
completed replacement; a failed operation keeps them private until retry or
restart. Queued ordered-repair startup joins this barrier before invoking the
adapter, so a synchronous throw cannot publish a partial replacement merely
because it returned no acquisition promise. The queued task belongs to the
loader that scheduled it, not a replacement created after cleanup.
The loader tracks each sequential request as a bounded participant,
not every recursive suffix of a long refinement chain.

### Replay participants and failure

A truncate replay is one publication barrier. Every acquisition started while
that replay is active, including ordered full-source recovery, belongs to the
barrier. Success publishes only after all current acquisitions settle. A
released demand stops participating even if its canceled transport promise
never settles. A newer truncate aborts prior acquisitions, but publication
still waits for overlapping work that had already started because some sources
cannot cancel an in-flight snapshot. Such work must settle and must not install
rows after observing cancellation. Settled historical attempts are discarded.
Replacing an acquisition does not release its logical owner. A delayed
cancellation therefore remains pending; prompt cancellation settles that wait.
Releasing the owner removes both its current and older work from readiness.
An ordinary acquisition started before replay may still hold subscription
readiness after its replacement publishes. It is not a replay publication
participant: its canceled writes must stop at the source boundary. Work started
inside replay, including an older overlapping replay, does hold publication.
Core installs each tentative acquisition and binds it to the current replay
attempt before calling adapter code. A reentrant release or newer truncate can
therefore see and retire the exact work it supersedes; work returned after that
reentrancy cannot attach itself to a newer attempt. Once reentrancy supersedes
an attempt, core starts none of that attempt's remaining demands. A demand that
releases itself during adapter or status callbacks cannot join readiness or
poison the replay with a later synchronous failure. Successful replacement
publication happens before the subscription emits `ready`. Cleanup runs every
ownership step even when replacement publication throws. Subscriber errors
raised by an asynchronous replacement do not turn source success into replay
failure: core finishes its internal state and surfaces the exact callback error
in a host microtask. Status callbacks may synchronously change demand. Generic
and specific status delivery capture the transition revision and stop before a
later listener when reentry supersedes it, including an ABA transition back to
the same status label. Subscription teardown is a one-shot logical transition:
it stops the listener set already being walked, emits no later status, and
removes subscriber ownership once. A later `unsubscribe()` is a no-op, including
after a physical subset release failed.
Failure keeps the last complete result visible and partly replayed source state
private for both direct subscribers and query graphs. Ordinary source deltas or
snapshot requests do not reopen that gate because they cannot prove the source
complete; only a later successful truncate replay provides the authoritative
replacement. Replay failure is scoped to the logical demand that failed. If
that demand retires, its failure cannot poison a successful replacement for the
remaining demand. If the last logical demand retires, the now-unreachable source
replay rejects its completion with `AbortError` and stops gating the shared
graph; unrelated parent or sibling changes may then publish. If release
publication or adapter unload synchronously acquires new demand, core checks
completion after that callback: the new demand joins the private replacement,
while the retired transport can no longer gate it. A genuine replay failure is
normalized once by the subscription.
The `loadSubset:error` event, `lastSubsetError`, and any window move waiting on
that replay expose the same `Error` object.

### Mutation boundaries and initial readiness

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
6. **Stale demand:** an obsolete graph cannot settle current readiness, and an
   obsolete acquisition cannot satisfy current demand. A conforming source
   cannot publish its request-scoped rows after cancellation.
7. **Applied settlement:** a successful subset load settles only after its
   establishing sync transactions are visible; a source must not add queue
   priority merely to force the load to settle. Settlement proves no broader
   source extent than the exact request.
8. **Nested propagation:** every materialized relation consumes the fully
   materialized output relation of its children.
9. **Publication:** reads, events, and downstream queries observe the same
   complete graph result. A truncate replacement stays private until all work
   started by its active replay demands settles; failure keeps the prior public
   result and later partial source changes private until an authoritative replay
   succeeds. A failed replay with no remaining logical demand cannot gate other
   graph work.
10. **Initial demand:** preload completes when every initially reachable demand
    is covered; obsolete demand does not block it.
11. **Ownership:** a query-db row exists exactly while an explicit owner
    remains.
12. **Work:** irrelevant rows do not cause unrelated scans or activate unrelated
    routes when an applicable index exists.
13. **Space:** state scales with retained D2 relation/index rows, active demands,
    materialization cells, visible rows, the current private replay state, and
    required Collection facades—not with settled historical replay attempts or
    raw delta history.

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

| Contract                                                                    | Test suite                                                                   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| State equivalence, route lifecycle, transition history, and batch partition | `packages/db/tests/query/includes-oracle.property.test.ts`                   |
| Joined multiplicity, alias identity, and null-key normalization             | `packages/db/tests/query/includes-query-shape-oracle.test.ts`                |
| Demand, cancellation, and progressive timing                                | `packages/db/tests/query/includes-temporal-oracle.test.ts`                   |
| Optimistic confirmation, rollback, and later reactivity                     | `packages/db/tests/query/includes-optimistic-oracle.property.test.ts`        |
| Coherent layered publication                                                | `packages/db/tests/query/includes-publication-oracle.test.ts`                |
| Collection facades, event coherence, and route activation                   | `packages/db/tests/query/includes-collection-oracle.property.test.ts`        |
| Correlated physical work                                                    | `packages/db/tests/query/includes-work-counter-oracle.test.ts`               |
| Route-context discovery and transport across recursive and join boundaries  | `packages/db/tests/query/includes-context-transport-oracle.test.ts`          |
| Functional projection input boundaries, timing, and output preservation     | `packages/db/tests/query/includes-functional-projection-oracle.test.ts`      |
| Functional input rejection and inline alternatives                          | `packages/db/tests/query/includes-functional-input-boundary.test.ts`         |
| Public-container descriptors and reference-key matches across internal query stages | `packages/db/tests/query/public-container-copy.test.ts` |
| Cross-formulation equivalence and reference-sensitive route identity        | `packages/db/tests/query/includes-cross-formulation-oracle.property.test.ts` |
| Query-db ownership                                                          | `packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts`      |
| Reachable nested shape                                                      | `packages/query-db-collection/tests/includes-work-counter-oracle.test.ts`    |

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
