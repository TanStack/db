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

Collection-valued facades keep the canonical public key and order token as
non-enumerable row metadata. Optimistic Collection updates preserve that
metadata when they clone a row. It is adapter state, not part of the selected
query value: projections need not expose a key field, and equality or change
payloads must not acquire one. An order update that reuses the canonical row
object clones that row before replacing its order metadata, so the ordered map
can remove the old position before it installs the new one.

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
That fallback issues no structural cursor: a lexical predicate is not a locale
boundary. Once the unbounded result proves the needed prefix, widening within
that result performs no more transport work. Bounded locale continuation would
require a future adapter capability with an opaque cursor that preserves the
provider's exact collation and snapshot. Until that contract exists, an
unbounded fetch is the only sound continuation.

The same rule applies when no range index can support ordered continuation.
Core issues one unbounded ordered acquisition, then lets D2 apply joins,
predicates, and top-K to the full readable source. It must not issue a limited
page and then disable continuation: later relational operators may reject that
page and leave the result window short.

For an indexed ordered source above a join or later predicate, the visible
window is the direct relational result: source order, then downstream
operators, then offset and top-K. Core may prove that result with the shortest
ordered source prefix, or with other authoritative active demands that
establish all contributors which can precede the boundary. A forward scan
advances its cursor across source rows that the later relation rejects. A
reverse join demand can instead make a later matching row readable without
claiming reusable ordered-prefix coverage for skipped rows. A second source may
settle after a continuation is already in flight, so safe extra primary rows
may become readable. None of these paths may change the direct result or let an
unsettled source region leave a provable window under-filled. A short result is
valid only when authoritative completeness across every involved source region
proves that no remaining row can contribute before the window boundary.

Test adapters must obey the same boundary contract as production adapters. A
mock that reports exhaustion must have made every matching source row readable
before its result settles. A mock that reports more data must honor later
offset, cursor, and boundary-class refinement requests. Every applied row key
must name a row established by that acquisition. Tests that withhold rows while
claiming exhaustion, or ignore a refinement request, do not model a valid
adapter and cannot establish a runtime defect.
An acquisition may establish a row that is already readable by applying the
same authoritative value again under its own request signal and awaiting that
receipt. Merely observing a row installed by another demand does not transfer
ownership or make it an applied row of the new acquisition.

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

`WindowState` owns current-generation admission and coverage. The subscription
owns the last complete reader-visible publication as one snapshot: its rows,
sent keys, and optional ordered prefix size and total-order boundary. An active
or failed replay retains that snapshot unchanged until a complete replacement
publishes or later source changes reconcile it. After failure, ordered source
changes evolve a candidate set rooted in that public snapshot under the same
predicate, retained size, and `TotalOrder`. A worse-ranked row stays private but
remains available to refill the prefix; rows installed only by the rejected
replacement never enter this set. An empty retained publication is still a
present publication and cannot collapse into absent state after an unrelated
change. Source deltas, retained-window changes, new local snapshots, and demand
release all run this one reducer because each can change the public union. A
single reducer does not erase provenance: it keeps ordered-authorized
candidates separate from rows visible only for another demand. A new local
snapshot may add the latter to the public union, but it cannot promote a row
left by the rejected generation into the ordered prefix, even when that row
matches the ordered predicate. Releasing that demand removes the row again
without changing the ordered boundary. Request-scoped adapter transactions
pass the exact acquisition signal to `commit(signal)`. Core retains that signal
as internal change provenance, so writes for an unordered demand have the same
additional-only provenance as its local snapshot even when they arrive
asynchronously. When a dedupe wrapper replaces logical request signals with a
shared physical lease signal, it records that signal lineage. Provenance tests
follow the lineage through nested wrappers instead of treating physical signal
replacement as new authority. If several same-key transactions collapse into
one visible change, provenance reduces with the row version: value-equal writes
combine their authorities, while a different later version replaces the
earlier authorities. Row metadata writes do not confer row authority because
they do not produce a new row version. The same version rule holds in a failed
publication: an additional-only update or delete of an ordered candidate
revokes that candidate's old-version authority instead of resurrecting it when
the additional demand leaves. An unsettled request does not claim
unrelated transactions merely because their lifetimes overlap. Ordinary live
source changes and ordered acquisitions may evolve the ordered candidate set.
A request-scoped write with no active ordered owner in this subscription stays
additional-only; a peer may keep its shared physical lease alive after the
local logical demand is released, but that cannot grant local ordered
authority. Logical release takes effect before adapter cleanup. If
`unloadSubset` throws, the inactive demand may remain only as cleanup debt; it
cannot filter rows, join replay, accept settlement, or supply authority. The
same rule applies to an aborted replay acquisition retained only so its exact
cleanup can be retried: matching shared-physical signal lineage does not make
that obsolete acquisition current again. A
shared physical owner may keep the row in the core collection, but the ordered
coordinator supplies no public row or continuation boundary after its last
local ordered demand leaves. Retiring that last owner clears the coordinator's
coverage and immediately retracts its exclusive public rows, even while a
truncate replacement remains in flight. Every retained replay baseline is
updated to that same public state, so retired rows cannot suppress a later
same-version insert. With no active ordered owner, ordinary source changes do
not enter the dormant ordered window or create a later cursor. Adapter cleanup
is also a reentrancy boundary: releasing one exact acquisition is idempotent.
`releaseSnapshot(where)` releases the active logical owner; internal demand
controllers also pass the acquisition's stable request signal when they must
retry cleanup for one exact inactive owner among identical predicates. Replay
handoff uses the same guard. If `unloadSubset` reenters release, the old
acquisition retires once and the new acquisition is discarded rather than
installed for the now-inactive demand. Completion removes that demand by object
identity only after its current and pending replay acquisitions have all
settled, so a callback cannot make a stale array position delete a newly-created
owner. A
failed generation also clears its private coverage evidence; a successful
ordered acquisition from that generation cannot suppress the next request when
another demand makes the whole replacement fail. Reader-visible boundaries and
failed-replay offset or cursor restoration derive from this snapshot and ignore
caller offset or cursor hints. A continuation that is still proving the active
replacement instead derives from `WindowState`'s private current-generation
progress and also ignores caller continuation hints; that progress cannot
escape through a public boundary before the replacement publishes. If that
generation has no private progress, its next request starts at offset zero
without a cursor; it must not borrow caller cursor values or the old public key.
This applies both to later continuation requests and to acquisitions rebuilt
from stored demands at truncate start: replay must reconstruct transport state
at the acquisition boundary instead of cloning the retired generation's offset
or cursor. No parallel row-count or last-key fields may approximate either
state.

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

Replay settlement bookkeeping precedes observable status and error callbacks.
Acquisition replacement, ordered evidence, attempt completion, and the resulting
publication or restoration all finish before `status:ready` or
`loadSubset:error` listeners run. Reentrant listener work therefore starts in a
stable publication epoch; it cannot enter a private buffer that the same
settlement is about to discard.

That barrier belongs to the whole replay attempt, not to one request. Errors are
retained until every attempt acquisition settles. An acquisition started by a
result callback while replay is active joins the same attempt, including its
sync throw or async rejection. Callback-created replacement work therefore
cannot leave a private epoch open after status returns to ready.
Enrollment precedes the new acquisition's own result callback. A callback may
retire its logical owner and revoke its publication or failure authority, but
the physical settlement remains part of the attempt barrier.
If callback-driven cleanup throws, replay records an attempt failure and still
finishes setup. The exact cleanup debt remains retryable; the cleanup error is
reported only after the last complete publication has been restored.
Replay captures that attempt identity before adapter entry and carries it
through settlement and result callbacks. Reentrant adapter or callback work may
start a newer attempt, but an older acquisition's failure cannot veto that
newer attempt's complete replacement.
A result callback is itself part of the captured attempt barrier. In
particular, synchronous ordered evidence cannot publish a post-setup
continuation until that callback returns; a callback or cleanup failure first
restores the prior complete publication, then reports its error.
If a nested acquisition has already attributed a failure occurrence to its
captured attempt, propagation through the containing callback does not create a
second attribution or error event. Adapter boundaries, not thrown-value
identity, distinguish occurrences: a later cleanup remains a separate failure
even when it throws the same value. An internal propagation token marks a true
rethrow across nested cleanup boundaries; it never replaces the public error
payload. A callback frame retains every boundary occurrence, so `undefined`,
`NaN`, primitives, and objects follow the same law without using payload
equality as boundary identity.
The callback frame finalizes its unique retained occurrences whether the
callback returns or throws. Catching a nested failure cannot make a replay
successful. A later distinct throw adds one callback occurrence after the
nested occurrences, while rethrowing the internal propagation token does not.
Public teardown follows the same rule: it aggregates original failure payloads
at the outermost boundary and carries occurrence records through a containing
cleanup or replay callback. Internal propagation tokens never become public
error payloads or members of a public aggregate.
Nested replay callback frames pass recognized failure groups to their
containing frame. Once a frame attributes an occurrence, containing frames may
recognize its propagation token but must not report the occurrence again.
The same rule crosses recursive acquisition starts. An intermediate
`loadSubset` that lets a nested `requestSnapshot` carrier escape must roll back
its own tentative owner and rethrow that carrier unchanged. It does not create
a failure for its own options; only the innermost adapter boundary originated
the occurrence. Promise adoption follows the same rule: if an asynchronous
intermediate acquisition rejects with that carrier, its settlement observer
does not turn the carrier into a second public failure. This is a general
promise-observer law, not a replay-only exception; cleanup and ordinary demand
paths must consume the private carrier in the same way while still completing
their status bookkeeping.
Ordinary recursive acquisition follows this law even when no cleanup or replay
callback is active. The live acquisition chain itself supplies the causal
authority: a nested failure names its unsuspended containing acquisitions as
adopters. The outermost ordinary synchronous request unwraps the carrier before
returning control to its caller.
Initial demand and replay replacement adapter entry use the same acquisition
frame boundary. Replay attempt ownership changes when the failure may publish;
it does not change which adapter boundary originated the failure.
A cleanup failure raised reentrantly inside the acquisition being started stays
as its raw payload while adapter code can catch it. The active acquisition
frame retains that occurrence, so letting the same failure escape does not
turn cleanup into a second load failure; a newly thrown value remains a new
adapter occurrence.
Carrier authority is acquisition-scoped. It records the exact containing
acquisitions that were active above the originating failure, and only those
acquisitions may consume it as adopted propagation. If adapter code retains a
carrier and later throws or rejects it from an unrelated acquisition, that is
a new boundary occurrence against the later options; the core unwraps the
original payload before reporting or throwing it. Class identity alone is not
causal provenance, and private carriers never cross a public boundary.
The carrier proves only propagation that remains inside the synchronous
callback boundary or is adopted by a promise created there. If adapter code
suspends first and starts another acquisition later, the core observes two
adapter boundaries and reports both failures. Equal payloads cannot prove that
one occurrence caused the other, so the core never deduplicates them by value.
Teardown dispatches `unsubscribed` listeners synchronously and collects their
throws after adapter cleanup failures. Ordinary event delivery keeps its
asynchronous listener-error behavior. A retained replay error batch completes
against its current listener set even if the first listener reenters teardown;
teardown defers only its global listener clear until that batch ends. Explicit
`off` and `once` removal still take effect between events. A once-listener is
indexed by both its wrapper and original callback, so `off(event, original)`
can remove it before invocation. A second unsubscribe request during that
deferred-clear interval cannot redispatch the terminal event; a later explicit
call after the batch may still retry cleanup debt. Cleanup retries never
redispatch `unsubscribed`, including to a listener registered after the first
teardown pass; terminal publication is one lifetime edge.
If teardown is requested inside an adapter-entry, cleanup, or result-callback
frame while replay is active, public acquisition authority closes immediately
and adapter cleanup still runs synchronously. Replay-session discard, the
terminal event, and listener clearing wait until the active frame stack and
already-settled promise adoption have attributed their failures. Those failures
publish once against their exact originating options before the terminal event;
failed cleanup remains retryable. Outside replay, nested teardown keeps its
ordinary synchronous aggregation contract.
If teardown cleanup fails while replay adapter entry remains active, that
acquisition frame retains the exact cleanup occurrence even when adapter code
catches the teardown throw and returns success. A successful adapter return
cannot erase a nested failure which the subscription already observed.
The same retention applies to a throwing acquisition exit. Rethrowing the
private carrier reports only the nested occurrence; throwing a distinct value
or the same public payload without that carrier adds a new outer occurrence
after every earlier nested occurrence.
`onLoadSubsetResult`, `requestSnapshot`, and `releaseSnapshot` are internal
composition APIs. A nested synchronous failure may use the private propagation
token across that callback; internal code must rethrow the caught value
unchanged. Before callback-triggered teardown discards a replay session, the
subscription merges failures already queued by sibling acquisitions with
occurrences retained by every active callback frame. It reports each unique
occurrence in creation order against its exact options before clearing the
session. An occurrence that is both queued and reachable through a callback
frame still reports once. Teardown ignores reentrant `unsubscribe()` calls
while one pass is in progress, but a later call may still retry retained
adapter cleanup debt.
One logical release may cross both a pending replacement acquisition and its
original acquisition. If several cleanup boundaries fail, the callback frame
retains them as one propagated group and reports every occurrence against its
exact acquisition options after restoration. Effect and Live Collection error
classification compares both a monotonic error occurrence and SameValue
payload identity. This distinguishes no reported error from a reported
`undefined`, while a reported `NaN` is not a new graph failure merely because
`NaN !== NaN`.
Automatic replay handoff follows the same boundary law. A failed release of the
old acquisition and a failed discard of its replacement are two reportable
occurrences, each tied to its own exact options object. Reentrant owner release
cannot make replacement cleanup appear to belong to the old acquisition. The
same rule crosses logical demands: if one adapter cleanup reentrantly releases
another demand, an automatic-cleanup frame carries every nested occurrence
through the outer callback without merging them into an aggregate event or
relabeling them as the outer acquisition. This composes recursively. An
intermediate cleanup cannot replace a deeper acquisition's provenance merely
by propagating the same payload, catching it, or throwing another error after
it; each originating cleanup remains one ordered occurrence.
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
Adapter entry is itself pending work. A request-scoped commit can publish rows
before an async `loadSubset` call returns its Promise, so graph callbacks during
that entry cannot start another ordered request. Once entry returns, the normal
in-flight Promise guard owns the request until settlement.

An ordered window with an active limit of zero creates no ordered transport
demand. The subscription freezes the order request so a later window change
can load from the same order, but it does not construct `WindowState` until the
window first becomes positive. Neither the initial offset nor a result deficit
may turn the empty window into a positive request. The zero-width path returns
before predicate or order compilation, source enumeration, sorting, or index
creation. The dedupe helper applies the same law when adapters call it
directly: a zero-width request establishes no coverage and owns no physical
acquisition. This also holds when no usable order index exists: core defers the
full-snapshot fallback until the window first becomes positive. One successful
or pending fallback covers that subscription session. A synchronous throw or
rejected fallback clears only that subscription's guard, so the same live query
can retry. Cleanup creates a new subscription and a late settlement from the
old one cannot clear the new guard. Truncate replay belongs to the
subscription's retained demand; the live coordinator must not add a second
fallback while that replay is in flight. A replay that starts after an earlier
rejection reclaims the same subscription
guard. Success keeps it claimed, so replacement publication cannot schedule a
duplicate full-source fallback; rejection releases it for a later retry.
Cleanup also aborts and settles the subscription-visible acquisition before a
raw adapter promise can affect a replacement session. The live coordinator's
subscription-identity check is a second fence, not a substitute for that lower
abort boundary. Session tests must prove the public loading, readiness, error,
and row history rather than depend on reaching either private fence alone.

The graph loader is part of the same quiescence pass as source processing. If a
window change reaches the pass with no graph work, core calls the loader first.
It then drains every graph step created by a synchronous adapter commit before
publishing. Async settlement schedules another pass under the same rule. A
successful retry therefore cannot commit source rows while leaving the live
result stale until an unrelated later window change. When one pass has several
load callbacks, it attempts all of them and then rethrows the first failure
unchanged, including falsy values such as `undefined`, `false`, `0`, or `NaN`.
This rule applies both to lexical source loaders nested in one graph callback
and to graph callbacks coalesced by the scheduler.

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

### Demand facts

The demand plane keeps these facts separate. One fact may justify creating the
next, but none is an alias for another.

| Fact                 | Meaning                                                                             | What it does not prove                                        |
| -------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Demand snapshot      | Immutable semantic work requested by one caller                                     | That any source work started or any row arrived               |
| Logical lease        | One active owner of that demand                                                     | That it owns a distinct physical request                      |
| Physical acquisition | One exact adapter attempt, signal, options snapshot, and settlement                 | That its requested region was applied or is reusable          |
| Applied outcome      | Extent and row keys established by that acquisition after its writes became visible | Coverage for a different demand or generation                 |
| Coverage fact        | Caller-relative proof that an applied outcome satisfies a demand                    | Row lifetime or consumer publication                          |
| Row ownership        | Acquisition support for applied row keys                                            | Ordered-prefix membership or public visibility                |
| Publication snapshot | The last complete reader-visible rows and ordered boundary                          | Current private progress, request extent, or source ownership |

Consumer-local scheduling, loading state, and error state are observations over
these facts. They are not extra coverage or ownership facts.

One request may cover many buckets, and the adapter may coalesce or reuse
requests according to the compiled demand plan. A coalesced request has one
shared abort lease. If one owner releases its lease, the source request remains
active while another owner still needs its coverage. The source signal aborts
only after every attached owner has released it.

A Collection subscription snapshots its predicate when it is constructed. Its
first ordered request also snapshots the total order. Later window requests may
change the requested size, but local reconciliation, boundaries, transport,
replay, and evidence all keep the same predicate and order for that
subscription.

Each logical subset demand then gets a private snapshot before adapter entry.
Each adapter acquisition gets a separate clone derived from it, so neither
caller nor adapter mutation can rewrite the subscription machine, logical
demand, or another acquisition. Values observed by scalar functions use a
closed snapshot-capable grammar. Its identity preserves every observable part
of the clone, including prototype kind, property order, sparse-array holes,
invalid Dates, and symbol identity. Unsupported coercion hooks, opaque
structural objects, built-in subclasses, accessors, and cycles fail before the
demand is retained. Opaque values used by reference-sensitive equality retain
their identity. The caller's original predicate is retained only as a release
handle, because the transport predicate may combine it with the subscription
predicate.

The subscription installs the logical owner before adapter entry. Reentrant
release during `loadSubset` must therefore see and release that exact
acquisition. After adapter return, both ordered and unordered requests recheck
logical ownership before they report results, track loading state, establish
coverage, or scan local state; a demand released during adapter code cannot
publish a later snapshot. A synchronous `loadSubset` throw that did not follow
a failed release rolls the tentative owner back before it emits the error and
without calling `unloadSubset`; a failed release keeps the owner so a later
cleanup can retry the same acquisition identity. Reconciliation reuses the
logical owner's evaluator across source changes and truncate acquisition
replacement. A released owner cannot supply a predicate, and a later logical
demand compiles its own evaluator even when it reuses the same expression
object.

Logical demand state advances even when physical release fails. The failed
acquisition remains retryable cleanup debt in the Collection subscription, but
an aborted segment cannot remain the current demand or suppress a later
incarnation. The demand controller therefore returns the release failure with
the completed logical transition. A live query records that failure and
retires an empty demand without entering a fatal query state; an Effect reports
the same failure through its source-error policy and disposes. Reactivating the
route starts a fresh acquisition. Live-query diagnostics track failure presence
separately from its value so a thrown `undefined` remains observable, and reset
both observations when a new sync session starts. Effect disposal retains
failed unsubscribe callbacks and lets a later `dispose()` retry them instead of
caching a terminal rejected cleanup attempt.

Result callbacks are also arbitrary reentrancy boundaries. After invoking one,
the request checks the same exact owner again before it tracks status, applies
coverage, or scans local rows. A callback may release or unsubscribe; obsolete
promises are then observed only to consume a possible rejection.

A failed publication may retain rows owned only by unordered demands after the
last ordered owner leaves. A later ordered incarnation starts with an empty
ordered candidate set over that retained additional baseline. Its source rows
still enter the ordered admission path, so it publishes only the proven top-K
union the active unordered rows; a nonempty stale baseline cannot route them
through generic delivery.

Unsubscription closes the acquisition boundary before adapter cleanup starts.
An `unloadSubset` callback or unsubscribe listener may reenter public request
methods, but those methods cannot start a new acquisition after teardown has
begun. Teardown attempts every owned acquisition. It rethrows one failure
unchanged, or an `AggregateError` whose ordered `errors` list retains every
failure occurrence when several boundaries fail. Repeated unsubscribe calls
may still retry each retained cleanup debt against the same acquisition
options.

Its semantic contract is:

> Every active, satisfiable bucket must have its current demand load settle
> before initial preload completes.

A request may remain in flight after some buckets it targeted become inactive.
Those buckets no longer participate in readiness and cannot receive rows
through routes that no longer exist. Sharing source work never merges the route
rows themselves.

### Adapter obligations

The source contract stays abstract: a demand request eventually establishes
one coherent baseline and identifies when that baseline is complete. Each
request receives an `AbortSignal`. Cancellation is cooperative at this source
boundary. Core guarantees that an obsolete request cannot settle current
readiness; the source must honor the signal immediately before installing a
baseline or later request-scoped result. Core cannot prevent an arbitrary
adapter from writing after it ignores that signal. Buffering, snapshot tokens,
shape offsets, Collection transactions, and local indexes are source-specific
ways to satisfy that contract; they are not materializer state.

A conforming adapter must:

- treat the received options snapshot and signal as one exact acquisition;
- honor cancellation immediately before publishing request-scoped rows;
- await or return every applied receipt which establishes its result;
- report only row keys established by that acquisition and report source extent
  only when it knows it authoritatively;
- make every supplied release callback idempotent and non-throwing, and return
  the paired `unloadSubset` callback when it keeps dedupe state across
  lifetimes.

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
visible. A quiescent live-query graph output uses the same queue bypass for the
root Collection and regular Collection-valued child-facade changes. A facade
retirement is committed earlier in the same FIFO causal prefix; the immediate
root or containing-facade transaction that removed its final route drains that
retirement too. A direct source change therefore updates the whole derived
publication while an optimistic mutation on either Collection persists. The
normal optimistic overlay still wins for conflicting keys, and the graph
output remains one coherent publication. The overlay replaces the row value,
not the graph-owned key order. A source order move publishes a layout change
only when the complete visible public-key sequence changes after applying the
optimistic overlay. This includes a move beneath an optimistic update. It does
not include a move whose only crossed peers are optimistically deleted. An
optimistic delete hides the key and its order moves. If the synced base is
deleted beneath an optimistic update, the still-visible row moves to the
optimistic-only suffix; that publishes only when the suffix transition changes
the visible sequence. Re-establishing the base applies the inverse rule. A
legal absent-to-present source transition must keep the optimistic value
visible while restoring the graph-owned position in the same publication.
The graph reports a possible layout change before its sync commit. Collection
state captures the visible key sequence immediately before the whole committed
causal prefix applies, then compares it with the final sequence after the sync
writes and active optimistic overlay have both been applied. Queued
transaction-local snapshots are not public boundaries: an overlay may change
before a later immediate transaction drains them. The layout revision advances
only when the exact before/after sequences differ. This final check is shared
by root Collections and child facades; an adapter-local order token is evidence
to check layout, not proof that public layout changed.
Rejected, canceled, and obsolete acquisitions establish no coverage. Sources
must honor cancellation before publishing request-scoped rows.

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
attempt. If logical release reenters while the old lease is being retired, the
handoff must not install the replacement. It releases that replacement exactly
once and collects the inactive demand after all late cleanup succeeds.

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
rows. Core pairs each accepted load with one release of the same options object.
The helper keeps those logical owner reservations across resets so a late
release cannot retire newer-generation work or work still shared by another
owner. Adapter entry is a reentrancy boundary: capture the request generation
before calling adapter code, and do not publish coverage or in-flight work if a
reentrant reset has retired that generation. A dedupe hit cannot outlive the
evidence it claims to reuse.

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

### Conservative fallbacks

When evidence is missing, core chooses less reuse or more source work instead
of guessing:

- an omitted outcome or unknown extent proves no reusable coverage;
- requested limits and current Collection rows never stand in for applied row
  evidence;
- an order that lacks an expressible total boundary, exact collation, or usable
  range index loads the full filtered source region and lets D2 refine it;
- an unsupported demand value fails before retention instead of receiving a
  lossy snapshot or identity;
- a throwing release keeps its lease, acquisition, coverage, and row ownership
  as retryable cleanup debt;
- automatic continuation stops when it makes no semantic progress and resumes
  only after demand or authoritative evidence changes.

These fallbacks may cost work or delay reclamation. They must not change the
query result, invent coverage, or expose a private replacement publication.

This project uses a single graph-run order rather than multi-dimensional
timely-dataflow frontiers. Do not introduce a general timestamp or frontier
framework unless a source contract proves that the generation and up-to-date
protocol cannot express its ordering.

**Initial readiness:** preload is complete when the current load for every
demand reachable from the initial query graph has settled. An outcome-free load
may settle readiness without proving reusable coverage. Demand that is no
longer reachable does not block completion. An empty outer relation has no
child demand, but its root demand must still settle. Later readiness transitions
follow the existing Collection contract until an executable test defines
another public behavior.

The first-ready transition is an attempt-all fan-out. One callback failure
cannot suppress later first-ready callbacks, preload settlement, or the empty
ready event that wakes dependent Collections. Core completes every effect, then
rethrows the first failure unchanged, including a falsy value. Status is ready
before these effects run; first-ready callbacks keep registration order, and
the dependent-ready event runs after them. That event snapshots the dependents
present at delivery and attempts every one even if an earlier listener fails.
Removing or adding a dependent during delivery does not change that frozen
batch; an added dependent starts with the next publication.
Because the ready snapshot is already public, a listener failure also cannot
discard graph work queued by an earlier listener. Core flushes that work before
it rethrows the first listener failure. If readiness is nested inside an
existing publication, core retains the exact listener failure on that shared
context and the outer boundary rethrows it only after the queued graph work
drains. When both the listener and that queued graph work fail, the first ready
listener failure remains the reported error.

When `markReady()` runs during the synchronous adapter-entry call, core retains
any ready-effect failure until the adapter finishes its own setup. It then
propagates the exact failure without reclassifying it as a sync failure or
moving the Collection to `error`. A later asynchronous `markReady()` call keeps
the ordinary synchronous throw boundary. A preload already pending across this
entry waits for the adapter's final synchronous outcome: a ready-effect failure
alone leaves it resolved, while a later adapter failure rejects it and leaves
the Collection in `error`.

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
4. install regular child-facade changes through queue-bypassing Collection
   transactions while deferring their subscriber delivery; put route
   retirement before the queue-bypassing ancestor that drains its FIFO causal
   prefix;
5. apply direct root insert, update, and delete writes through one
   queue-bypassing Collection transaction;
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
may defer public revision clocks and event delivery across its Collection
transactions, but it must not defer state or index installation. A successful
coherent publication uses a two-phase release: first advance the clocks of the
root and every changed facade, then deliver any callback. This lets a callback
read another participating Collection without seeing new rows behind an old
revision. If a later root or containing-facade application fails before that
release, rollback restores the installed state and discards both the held
events and their revision advances. Routing and identity remain inside D2.
The root and facade adapters retain the graph deltas consumed by that failed
attempt. A later graph turn retries the whole uncommitted relation even when
the source emits only an unrelated root delta; D2 does not replay a delta that
an adapter has already consumed.
Facade rollback restores the Collection's internal publication snapshot. It
must not use a public sync transaction or emit change, layout, readiness, or
truncate lifecycle events for state that never committed.
Fresh-facade readiness joins the prepared publication release only after every
facade and root install has succeeded, and it precedes root callbacks. A
recovery failure attempts every remaining restore and publication discard,
preserves the original graph-install error, and marks the affected root or
facade as errored so a later successful publication can recover it and restore
readiness.
An index-rebuild failure remains explicit recovery debt. The next graph turn
must attempt every root and facade restore as one recovery preflight, then
finish them all before applying retained deltas or marking any Collection
ready; an ordinary row update cannot repair an unknown partial index rebuild.
Error status is published only after every root and facade recovery attempt and
after each held publication has closed, so a synchronous status observer cannot
see avoidable stale sibling state from a skipped restore.
Once release begins, one subscriber callback failure cannot suppress another
prepared root or facade publication. Release attempts every participant, then
rethrows the first callback failure unchanged, including `null` or `undefined`.
If a callback cleans up another participant after preparation but before its
release, cleanup cancels that participant's held delivery. No callback may run
later against its cleaned-up state.
Nested deferral handles may join one open Collection publication cycle. Once
that cycle is prepared, no independent cycle may begin until it is published,
or canceled by cleanup. An open cycle may instead be discarded. The Collection
rejects prepared-cycle overlap before the newer cycle can install state;
otherwise an older event could be delivered against a newer visible snapshot.

Every graph-turn origin that can publish rows owns a scheduler publication
context through the complete coherent release. This includes direct window
changes as well as source transactions. Work created by a publication callback
joins that context and runs only after the current root and facade callbacks
finish; it cannot start a second graph turn inside the first one or disappear
through the graph's reentrancy guard.

Each ordinary Collection publication freezes its layout listeners and public
subscribers, then attempts every callback in registration order. Adding or
removing a listener during delivery does not change that batch. The first exact
callback failure stays on the shared publication context, including when it
came from a nested readiness transition. Later callback failures cannot replace
it. Core runs the dependent graph work queued by the batch before rethrowing the
retained failure.

Window metadata follows the same causal order as the published rows. If a
publication callback starts a newer window operation, that newer generation
owns the final public window and the older caller cannot overwrite it when it
resumes. Restoring a rejected window is itself a graph-turn origin: its
callbacks remain inside one publication context, and restoration cannot roll
back a newer nested window generation. A rejected nested operation restores
its immediate parent's effective window, not an older public snapshot; rows
and window metadata therefore describe the same surviving generation. It also
restores the parent's imperative load-operation ownership before rollback
publication. Loads started by rollback or by the parent callback after it
catches the nested error must delay and contribute outcomes to the parent.
If teardown clears the runtime while an accepted window call is unwinding,
that generation remains the desired window for the next sync session. A call
that fails synchronously instead restores its previous effective window.

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
10. **Initial demand:** preload completes when the current load for every
    initially reachable demand settles; obsolete demand does not block it.
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
- **Demand snapshot:** an immutable description of work requested by one
  logical caller.
- **Logical lease:** one active owner of a demand.
- **Physical acquisition:** one exact adapter attempt and its settlement.
- **Applied outcome:** the source extent and row keys established by one
  acquisition after its writes become visible.
- **Coverage fact:** caller-relative proof that applied evidence satisfies a
  demand.
- **Row ownership:** the acquisition support that keeps applied row keys alive.
- **Publication snapshot:** the last complete reader-visible rows and ordered
  boundary.
- **Source extent:** an authoritative source fact that more rows continue past
  an exact demand, that the source is exhausted there, or that neither is known.
- **Collection facade:** a stable public Collection view shared by the parents
  routed to one active bucket.
- **Coherent commit:** one publication in which state, events, and consumers see
  the same fully materialized result.

## Executable contracts

| Contract                                                                     | Test suite                                                                 |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| State equivalence, route lifecycle, transition history, and batch partition  | `packages/db/tests/query/includes-oracle.property.test.ts`                 |
| Joined multiplicity, alias identity, and null-key normalization              | `packages/db/tests/query/includes-query-shape-oracle.test.ts`              |
| Demand, cancellation, and progressive timing                                 | `packages/db/tests/query/includes-temporal-oracle.test.ts`                 |
| Optimistic confirmation, rollback, and later reactivity                      | `packages/db/tests/query/includes-optimistic-oracle.property.test.ts`      |
| Coherent layered publication                                                 | `packages/db/tests/query/includes-publication-oracle.test.ts`              |
| Collection facades, event coherence, and route activation                    | `packages/db/tests/query/includes-collection-oracle.property.test.ts`      |
| Correlated physical work                                                     | `packages/db/tests/query/includes-work-counter-oracle.test.ts`             |
| Route-context discovery and transport across recursive and join boundaries   | `packages/db/tests/query/includes-context-transport-oracle.test.ts`        |
| Ordered source coverage, total boundaries, and window transitions            | `packages/db/tests/query/pagination-oracle.property.test.ts`               |
| Truncate replacement, retained publication, and boundary provenance          | `packages/db/tests/collection-subscription-replay-oracle.property.test.ts` |
| Coverage leases, acquisitions, fact compaction, and row provenance           | `packages/db/tests/query/coverage-registry-oracle.property.test.ts`        |
| Applied coverage publication through the Collection sync boundary            | `packages/db/tests/load-subset-outcome.test.ts`                            |
| Scheduled acquisition, release retry, and stale settlement                   | `packages/db/tests/query/load-subset-lifecycle-oracle.property.test.ts`    |
| End-to-end demand, multi-source ordered continuation, and outcome boundaries | `packages/db/tests/query/load-subset-full-flow-oracle.property.test.ts`    |
| Shared subset acquisition, readiness, receipt, and replay interpreter        | `packages/db/tests/query/load-subset-refinement-model.property.test.ts`    |
| Production-boundary refinement drivers                                       | `packages/db/tests/query/load-subset-*-refinement-oracle.test.ts`          |
| Adapter final-owner release and remount transport                            | Electric `electric-live-query.test.ts`; PowerSync `on-demand-sync.test.ts` |
| Query-db ownership                                                           | `packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts`    |
| Reachable nested shape                                                       | `packages/query-db-collection/tests/includes-work-counter-oracle.test.ts`  |

### Oracle family boundary

The shared load-subset refinement model begins after relational evaluation. Its
closed event grammar varies opaque source topology, demand relationships,
already-evaluated result contributions, public window state, settlement,
release, and teardown. It owns asynchronous demand, applied evidence, row
support, coverage, publication, source progress, and resource work. It must not
interpret query IR, weighted deltas, predicates, joins, grouping, query-level
ordering, or nested materialization. It may project already-evaluated total-order
coordinates and public window state. A new regression must reduce to this
grammar or justify a grammar change; it must not add a one-off event named after
the bug.

The grammar composes these independent axes:

| Axis            | Values owned by this oracle family                                                                                                                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source shape    | One or many opaque sources; zero, one, or many already-evaluated result contributions                                                                                                                                                                                                               |
| Row key domain  | String or number identity; unordered membership for ownership plus shared `compareKeys` order for removal publication                                                                                                                                                                               |
| Demand relation | Exact, shared, covered, uncovered, ordered, additional, release-pending, durably released or disposed                                                                                                                                                                                               |
| Operation       | Current or superseded imperative caller; open, waiting, settled, canceled, or cleaned; zero, one, or many attached physical requests                                                                                                                                                                |
| Identity        | Owner, operation, session, window revision, continuation task, demand, attempt, acquisition, source, transaction, row version, publication, boundary frame, failure occurrence, runtime reference slot                                                                                              |
| Boundary phase  | Before adapter entry, inside adapter or callback entry, returned/in flight, settled, terminal listener delivery, cleanup                                                                                                                                                                            |
| Capability      | Indexed or unindexed order; expressible or opaque boundary and collation; authoritative or unknown extent                                                                                                                                                                                           |
| Evidence        | Applied row keys plus `unknown`, `continues`, or `exhausted` extent; rejection or abort establishes none                                                                                                                                                                                            |
| Publication     | Last complete snapshot, private replacement, failed or superseded generation, cleaned session                                                                                                                                                                                                       |
| Origin          | Ordinary source work or the exact ordered/additional acquisition signal lineage that authorized a row version                                                                                                                                                                                       |
| Observation     | Final rows, ordered change/adapter/release/lifecycle traces, callback-time reads, readiness, boundary, canonical removals, exact errors, operation outcomes, receipts, ownership, physical starts, evidence work, ordered-path work, transient retained space, and lifetime symbol-identity entries |

An executable history chooses values on these axes, then combines them through
the demand facts above. A logical request installs its owner before adapter
entry. It either attaches to an acquisition or starts one. Request-scoped sync
transactions make row versions visible and settle their receipts before the
acquisition can publish an outcome. Applied evidence may then establish
caller-relative coverage and row ownership. Ordered evidence may update private
window progress; only a complete publication snapshot reaches readers.
Release, truncate, replacement, restart, and cleanup change the relevant
identity or generation without changing this sequence.

Cleanup also ends the current publication history. It must discard both the
pre-sync visible snapshot and the recently-synced suppression set before a new
sync session starts. Otherwise stale rows can classify a fresh insert as an
update, or stale keys can suppress the new session's first event.

An imperative load operation is a separate caller boundary around this flow.
It owns the future requests caused while it is current, retains the promises it
already acquired after a newer operation supersedes it, and settles only after
synchronous follow-up requests have had a chance to join. Its outcome includes
caller-relative retained evidence even when coverage reuse starts no transport.
Physical acquisition count, readiness, and an operation's pending set or result
are therefore different projections.

Logical release and durable physical release are separate transitions. A
throwing cleanup leaves a release-pending acquisition, its coverage, and row
support as retryable debt. Only accepted cleanup retires those physical facts.
Resource observations therefore count leases, acquisitions, coverage claims,
unsettled claims, retained demands, outcomes, and row-key slots separately from
transport starts. Algorithmic work is another independent observation: count
row-key copies, demand snapshots, and demand-key derivations rather than using
transport starts or retained space as a proxy for evidence computation. Ordered
source work is separate again: preserve the exact scan and cursor sequence, and
count source reads or snapshots, sorts or total-order refinements, and predicate
compilations independently. A stable result and request trace can still hide
repeated local work.

`WindowState` takes at most one ordered source snapshot per collection state
revision. Boundary, coverage, publication, and reconciliation reads share that
snapshot; the next committed source batch invalidates it. The query predicate
is compiled once with the window and is evaluated over the shared ordered
snapshot, so another view of the same revision does not rescan, resort, or
recompile it.

A compatible single-column built-in index walks indexed-value buckets in query
order, whether the matching view is direct or reversed. It evaluates complete
buckets until the requested filtered prefix is known, orders public keys
ascending within each bucket, and stops after the sufficient boundary bucket.
The public-key suffix does not depend on index insertion order or query
direction. Rows in worse buckets cannot add source reads or total-order
refinement work. An all-tied source is the deliberate worst case: the one
boundary bucket is the whole source and must be inspected before the public-key
suffix can choose top-K.

An ordered bucket is a comparator-equivalence class, not an exact Map-key
bucket. Distinct values such as `null` and `undefined`, or values equated by a
custom comparator, contribute all of their public keys to the same tie class.
Reversing an index also reverses its null placement. The optimizer may reuse a
reverse index only when the requested direction and null placement describe
that reversed order; otherwise it creates a matching index or falls back to a
full `TotalOrder` refinement. A built-in index configured with a custom
comparator also keeps the full-refinement fallback: comparison metadata cannot
prove that an opaque comparator has the query's order. Public custom indexes
without lazy bucket iteration keep the same fallback.

Runtime reference identity has a different lifetime again. Objects use weak
identity, but JavaScript symbols cannot be weak keys. Stable equality for the
same live symbol therefore retains one strong entry per distinct symbol for the
runtime identity factory's lifetime. This monotonic, usage-proportional cost is
not part of the live-demand resource bound. Eviction is not valid unless the
platform supplies weak symbol identity or another scheme proves that one live
symbol can never receive a different identity.

Adapter entry and every result, cleanup, and listener callback are reentrancy
boundaries. Any otherwise legal event may occur before that boundary returns.
Work which has entered an adapter but has not yet returned a promise is already
pending work. A production-boundary driver must include this synchronous phase;
promise-only overlap does not reconstruct the source.

Failures also carry boundary identity. One occurrence names its originating
options, creation order, and containing callback or acquisition frames. A
private propagation token may carry that occurrence through an authorized
nested frame, but payload equality never merges two boundaries. `undefined`,
`NaN`, primitives, and the same `Error` object can each be the payload of a
distinct occurrence.

Publication is an ordered observation, not only a final state. Transaction and
replay laws preserve each emitted change batch, adapter invocation and release,
and the rows synchronously visible inside its callback. Terminal teardown first
reports retained failures, then emits `unsubscribed` exactly once, then clears
listeners. Reentrant teardown and cleanup retries must not duplicate or reorder
that lifecycle edge.

Each projection may erase axes it does not own. It must preserve the identity
and cardinality of the fact it claims to check. In particular:

- receipt laws compare each acquisition with its own applied keys;
- operation laws keep caller identity, acquired promises, first error, and
  per-source/collection/generation outcomes separate from acquisition state;
- coverage laws keep caller demand separate from acquisition outcome;
- ownership laws keep logical leases separate from physical row support;
- publication laws keep demand origin, row version, and generation separate;
- work laws count physical starts separately from logical owners;
- evidence-work laws count row-key copies, demand snapshots, and demand-key
  derivations separately and bound them independently of candidate count;
- ordered-work laws preserve the exact source-read and cursor sequence and
  count source snapshots, sorts or total-order refinements, and predicate
  compilations separately from transport and coverage-evidence work;
- space laws count each retained resource category separately;
- identity-space laws count process-lifetime symbol entries separately from
  transient demand resources and preserve stable same-symbol identity;
- release laws distinguish requested, retryable, accepted, and disposed work;
- removal laws preserve the shared `compareKeys` sequence across mixed string,
  number, ASCII, and non-ASCII keys rather than comparing only a set;
- trace laws preserve adapter calls, releases, emitted change batches,
  callback-time reads, and terminal lifecycle events in order rather than
  comparing only final state;
- error laws preserve occurrence, originating options, and report order rather
  than deduplicating by payload;
- renaming laws erase names only after every allowed next-command observation
  remains equal.

Set unions, final-state equality, and settled promises are therefore supporting
views, not universal oracles. Each can hide a wrong acquisition, transient
publication, duplicate start, stale generation, or lost owner.

The reconstruction control for a new finding is:

1. express its source topology as already-evaluated contributions;
2. name every logical, imperative-operation, and physical identity involved;
3. state the adapter capability which makes each transport transition legal;
4. place each action at its exact boundary phase and source origin;
5. derive operation settlement, evidence, ownership, coverage, publication,
   ordered observation traces, failure occurrences, canonical removal order,
   evidence-path work, ordered-path work, transient retained resources, and
   lifetime identity entries independently;
6. compare the first public, algorithmic-work, or retained-resource observation
   that can differ; and
7. verify the same grammar admits the nearest marginal case but rejects a raw
   relational or materialization problem.

Zero-sized windows, empty sources, unknown extent, synchronous adapter results,
coverage-reused operations with no transport, superseded overlapping
operations, reentrant terminal cleanup, zero-contribution source steps,
all-tied boundaries, and mixed string/number or non-ASCII row keys are marginal
cases of this grammar, not separate families. Predicate evaluation, join
multiplicity, aggregate deltas, and nested materialization are outside it and
remain negative controls. Reclaiming live symbol-identity entries is also
outside the current platform contract; their accepted factory-lifetime cost
must remain visible.

DBSP operator suites own incremental relational laws. The includes suites own
compiled routes and materialized nested results. A load-subset production
harness may use an eager query from those paths as its relational control, then
compare lazy demand and source progress with a small refinement projection. It
must not copy those paths into a second relational engine inside the shared
model.

Each model law has its own projection instead of one monolithic expected-state
reducer. Each oracle identifies the first divergent checkpoint and compares
either the whole result or one exact structural difference.
Correlated-materialization scenarios use direct assertions. A boundary suite
may retain an exact expected-failure guard for a planner or ownership defect
that this graph does not own.

Run the DB oracle set with `pnpm test:oracles` from `packages/db`. Broad
properties use FastCheck's random seed, while structural matrices keep fixed
seeds so each run covers the same named cells. Increase both corpora with
`TANSTACK_DB_ORACLE_RUNS_MULTIPLIER=10 pnpm test:oracles`. Preserve the oracle
property key beside FastCheck's reported seed and shrink path while reducing a
failure. Replay one exact property with:

```sh
TANSTACK_DB_ORACLE_PROPERTY=<property> \
TANSTACK_DB_ORACLE_SEED=<seed> \
TANSTACK_DB_ORACLE_PATH=<path> \
pnpm test:oracles
```

The replay registry rejects partial or unknown coordinates and duplicate
registered names. Its static inventory must stay equal to the property helper
call sites; a missing registration fails at the helper boundary. A seed without
a property and path still runs the broad campaign. After shrinking, add the
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
