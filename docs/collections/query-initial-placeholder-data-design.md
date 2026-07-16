# Query Collection initial and placeholder data semantics

## Status and scope

This document proposes the semantics for TanStack Query `initialData` and
`placeholderData` at the `@tanstack/query-db-collection` boundary. It is the
design follow-up for [RFC #1643](https://github.com/TanStack/db/issues/1643)
and [issue #346](https://github.com/TanStack/db/issues/346). It does not change
runtime behavior or the persistence format.

The adapter connects two different models:

- TanStack Query owns a document cache and remote-query lifecycle.
- TanStack DB owns normalized rows, local queries, and optimistic writes.
- Query Collection projects a Query response into rows and records which Query
  key owns each materialized row.

`initialData` and `placeholderData` must not be treated as equivalent ways to
provide an array. In Query Core 5.90.20, `initialData` initializes Query cache
state with `status: "success"` and a `dataUpdatedAt` timestamp. By contrast,
`placeholderData` is computed per observer only while Query state is pending;
it produces an observer result with `isPlaceholderData: true` but is not stored
in Query state.

## Decision

Support Query-owned `initialData` as an additive, eager-mode option. Materialize
it immediately through the existing row extraction and ownership pipeline.
Do not expose or materialize `placeholderData` in the first implementation.

Query Collection can already materialize data that was seeded or hydrated into
the QueryClient before the observer is created, and QueryClient defaults can
already provide `initialData` indirectly. That is useful existing behavior, but
it does not close the configuration gap. Applications commonly share one
QueryClient across many Query Collections: a client-wide default is too broad,
while imperative `setQueryData` requires coordinating collection construction,
exact Query keys, and initialization elsewhere. The additive field supplies a
collection-local declaration while leaving Query as the cache authority.

The minimal additive API is:

```ts
initialData?: TQueryData | (() => TQueryData)
initialDataUpdatedAt?: number | (() => number | undefined)
```

These remain flat top-level fields. Their types describe the original Query
response, not the extracted row array. Consequently, wrapped responses use the
same adapter `select` as network responses:

```ts
queryCollectionOptions({
  queryKey: ["todos"],
  queryFn: fetchTodos,
  initialData: { items: serverTodos, nextCursor: null },
  select: (response) => response.items,
  // ...
})
```

Query keys still define cache identity. If two Query Collections on the same
QueryClient use the same exact key, they observe one shared Query document;
`initialData` initializes that document only when it does not already exist.
Collection-local configuration does not create collection-local cache data, and
later observers must not replace an existing document with their initializer.
Collections that require independent initial documents must use distinct keys.

This initial API is limited to `syncMode: "eager"`. A single configuration-level
value cannot lawfully initialize an open-ended family of on-demand subset keys,
and Query's `initialData` function receives no query key or subset context.
Applications that already know data for an exact on-demand key should seed or
hydrate that Query cache entry instead. A future subset-aware initializer would
need an explicit key/subset argument and a separate design.

`placeholderData` remains Query UI vocabulary. A DB collection has no
observer-local result surface: materializing a placeholder would make it visible
to every DB query and mutation, assign it row ownership, and potentially persist
it. Callers should render placeholders in the consuming UI. A future opt-in
temporary-row feature, if needed, should be a DB feature with explicit provenance
and lifecycle rather than Query's `placeholderData` option.

## Authority model

"Authoritative" has two dimensions here. Query owns the authoritative document
for a Query key, while DB owns the current normalized row state. A server result
is the newest remote snapshot, but local optimistic transactions can temporarily
overlay its rows.

| Phase | Query document authority | Materialized row authority | Consequence |
| --- | --- | --- | --- |
| No cached data | None | Existing DB/persisted rows, if any | The collection waits for Query; absence is not an empty result. |
| Initial data | Query cache `initialData` | Its projected rows, subject to normal local overlays | It is a real cached snapshot, not temporary presentation data. |
| Fetch/refetch in flight | Existing Query document | Existing rows | Loading does not clear rows or ownership. |
| Server success | Returned response replaces the Query document | Projected server rows reconcile the owning Query key | Missing rows lose this Query owner's lease; shared rows remain. |
| Fetch/refetch error | Last successful Query document | Existing rows | An error does not retract initial or previously fetched rows. |
| Placeholder presentation | No Query document | No rows | Placeholder data is never passed to DB. |

`initialDataUpdatedAt` and `staleTime` remain Query-owned. They decide whether a
fetch starts; the adapter does not reproduce their freshness calculation. An
initial value is therefore a seed snapshot with ordinary Query authority, not a
weaker class of row waiting to be promoted. The first successful server result
reconciles it through the same path as any later refetch.

## Behavior matrix

| Concern | `initialData` | `placeholderData` |
| --- | --- | --- |
| Query cache | Stored as successful Query data | Not stored; observer-only |
| Existing cache entry | Existing cached/hydrated data wins; `initialData` is not reapplied | Not applicable |
| DB materialization | Immediate in eager mode | Never |
| Wrapped response | Adapter `select(initialData)` extracts rows; original envelope stays cached | Unsupported |
| Function value | Evaluated by Query once when the Query is created | Not forwarded or evaluated by the adapter |
| Ownership | The Query key owns projected rows exactly like a server success | No ownership |
| Overlapping subsets | Not applicable to the initial eager-only API | Not applicable |
| Ready state | Initial successful result can make the collection ready synchronously | Cannot make the collection ready |
| Refetch success | Reconciles additions, updates, and removals normally | N/A |
| Refetch error | Initial rows and ownership remain; error state is reported | N/A |
| Cancellation/cleanup | Existing ownership cleanup rules apply; a cancelled fetch does not retract the cached seed | No rows to clean up |
| Query cache GC/unload | Existing Query-to-row ownership and persisted-retention rules apply | No effect |
| Query dehydration | Query owns persistence of the initial response | Never persisted |
| DB persistence/hydration | Rows and owner metadata use the existing format; no provenance tag is added | Never persisted or hydrated |
| Direct writes before server success | Allowed under the existing write rules below | No target rows exist |
| QueryClient defaults | Supported for eager `initialData`; see compatibility guard below | Must be suppressed at this adapter boundary |

## Select and writes

Adapter `select` remains a one-way row extractor. It is applied identically to
initial and network responses, and TanStack Query retains the original response
shape. Query observer-level `select` remains unsupported.

Direct writes before the first server result follow the current authority rule:
they update DB immediately and may patch Query cache only when the reverse update
is lawful. A raw array can be replaced. For a wrapped response, the existing
best-effort patch is lawful only when `select` returns an array property of the
cached object by reference, allowing the wrapper to be preserved. A derived
projection such as `response.edges.map(...)` has no general reverse projection;
the adapter must leave that Query document unchanged and rely on invalidate or
refetch. It must never fabricate an envelope around rows.

The next successful remote response remains authoritative for that Query key and
may overwrite a direct cache patch or normalized row value. Mutation handlers and
optimistic transaction barriers retain their existing semantics.

## Ownership, persistence, and transitions

Initial rows use the existing `queryToRows` and `rowToQueries` relationship. No
`seed`, `temporary`, or `placeholder` bit is added to a row. This keeps these
invariants intact:

1. A successful result, whether initial or fetched, is a complete snapshot for
   its Query key.
2. A row is deleted when a snapshot omits it only if no other Query key owns it.
3. Unload, cache GC, and collection cleanup remove only the relevant ownership.
4. A failed or cancelled fetch cannot turn the last successful snapshot into an
   empty snapshot.
5. Persistence records only Query data and the existing row ownership metadata;
   observer-only presentation state is never persisted.

The expected transitions are:

- **Initial, fresh:** materialize and become ready; do not fetch until Query's
  normal freshness triggers say to do so.
- **Initial, stale:** materialize and become ready while Query fetches; success
  reconciles the same ownership, and error retains the seed.
- **Loading without data:** keep the collection's prior independently owned or
  hydrated rows; do not infer an empty result.
- **Placeholder to loading/success/error:** the placeholder is UI-only. DB sees
  no transition until success; error leaves DB unchanged.
- **Cleanup before network completion:** existing cancellation and readiness
  listener cleanup apply. A late result must not mutate a cleaned-up collection.

## Defaults and compatibility guard

Query Collection currently constructs a `QueryObserver`, so QueryClient defaults
can contain semantic fields even when Query Collection does not expose them.
Implementation must explicitly enforce this design after Query defaults are
resolved:

- reject an explicitly configured `initialData` in on-demand mode;
- prevent default `initialData` from initializing on-demand subset observers;
- prevent explicit or default `placeholderData` from reaching all Query
  Collection observers;
- continue to let omitted eager `initialData` and `initialDataUpdatedAt` inherit
  QueryClient defaults;
- never copy a function-valued initializer into adapter metadata or persisted
  ownership metadata. Query Core may own it as an option and stores only its
  evaluated data in Query state.

Silently materializing default placeholder data would violate the public
compatibility table even before a top-level field is added. The guard is therefore
a correctness fix, not support for placeholder semantics.

Other Query-owned options keep their current classification. Query key creation,
adapter `select`, subscriptions, `notifyOnChangeProps`, and structural sharing
remain adapter-owned or reinterpreted. No nested `queryOptions`, runtime binding
API, subset deduplication, or lease manager is introduced by this design.

## Rejected designs

- **Forward both options mechanically.** `result.isSuccess` is true for a
  placeholder observer result, so the current success handler would normalize
  presentation-only data and give it durable-looking ownership.
- **Tag placeholder rows and later promote or delete them.** Tags would have to
  survive collisions with real rows, overlapping observers, local writes,
  unload, GC, persistence, and hydration. Query's observer-local placeholder has
  no collection-wide lifetime that can drive those transitions safely.
- **Treat initial rows as unowned temporary rows.** Query considers initial data
  real cached data. Bypassing normal ownership would leak rows or allow cleanup
  of one Query to remove rows still represented by another.
- **Seed every on-demand key from one value.** A collection-level initializer
  cannot prove membership in arbitrary predicate/order/limit subsets.
- **Create a wrapped response from selected rows.** A read projection is not an
  inverse. Fabricating metadata, cursors, or edges corrupts Query cache meaning.
- **Persist initializer functions.** Functions are not structured-clone safe and
  are runtime configuration, not data.

## Implementation and test sequence

Each behavior PR should begin with the named failing or characterization tests.

1. **Guard the existing boundary.** Add focused tests proving that explicit and
   QueryClient-default `placeholderData` never materialize, never mark the
   collection ready, and never survive dehydration as data. Characterize current
   default `initialData` behavior in eager and on-demand modes. Then suppress
   placeholder and on-demand initialization when constructing observers.
2. **Add eager initial data.** Add the two flat typed fields and forward only
   defined values so QueryClient defaults remain intact. Test static and function
   values, fresh versus stale timestamps, synchronous readiness, fetch error,
   cancellation, cleanup, an explicit on-demand configuration error, multiple
   collections on one QueryClient, and same-key first-initializer-wins behavior.
3. **Lock projection and writes.** Test raw arrays, direct-property wrapped
   responses, and derived projections. Verify the full initial envelope remains
   in Query cache, lawful direct writes preserve it, unlawful reverse projection
   does not fabricate one, and server success reconciles rows.
4. **Lock ownership.** Test initial-to-server row removal, overlapping ownership
   with externally hydrated/persisted rows, GC/unload, remount within `gcTime`,
   and late notification after cleanup. Reuse the existing ownership machinery;
   do not add a second seed ownership map.
5. **Lock persistence.** Dehydrate and `structuredClone` initial raw and wrapped
   data; hydrate Query and DB state; verify ownership reconciliation and that no
   function appears in Query metadata or adapter persistence metadata.
6. **Document the shipped API.** Move the settled behavior into the Query Options,
   row extraction, direct writes, on-demand, and persistence sections of the user
   guide. Update RFC #1643 and close or narrow #346 only after these contracts ship.

Placeholder materialization, subset-aware initialization, and a lawful general
reverse projection are separate future proposals. None is a prerequisite for the
minimal eager `initialData` API.
