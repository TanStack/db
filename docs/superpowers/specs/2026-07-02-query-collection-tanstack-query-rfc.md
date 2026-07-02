# RFC: roadmap for query-db-collection / TanStack Query integration

## Background

We recently reviewed the open issues and related historical fixes in this repository to identify clusters of related work. One cluster that stood out is the integration boundary between `@tanstack/query-db-collection`, TanStack Query, and TanStack DB's normalized row store.

This RFC summarizes that cluster and proposes a staged sequence of small, non-breaking PRs. The goal is not to approve a large rewrite. The goal is to agree on the direction so each PR can improve one part of the boundary without making the adapter more complicated or duplicating more TanStack Query behavior.

## Cluster summary

### Active issues

- [#183 Deepen the integration with Query](https://github.com/TanStack/db/issues/183) asks how much of TanStack Query's behavior should be supported, including refresh on mount/window focus and related options.
- [#344 Add Query Invalidation Support to query-db-collection](https://github.com/TanStack/db/issues/344) asks how collection refresh should relate to `queryClient.invalidateQueries` and Query's matching semantics.
- [#345 Add select Option to query-db-collection](https://github.com/TanStack/db/issues/345) covers wrapped API responses and extracting rows from response envelopes. Current main appears to support this, but it also exposes a larger projection question: this `select` extracts rows for DB materialization rather than behaving exactly like TanStack Query's `select`.
- [#346 Add Initial Data and Query Options Support to query-db-collection](https://github.com/TanStack/db/issues/346) asks for more of TanStack Query's option surface, including initialization and transformation behavior.
- [#350 Expose QueryFunctionContext properties (signal, meta) in query-db-collection](https://github.com/TanStack/db/issues/350) asks for QueryFunctionContext properties. Context typing and `meta` appear partly addressed on current main, while cancellation and lifecycle behavior remain relevant.
- [#436 Error `[QueryCollection] queryClient must be provided` on TanStack Start's beforeLoad](https://github.com/TanStack/db/issues/436) points to runtime `QueryClient` scoping, especially for SSR and TanStack Start request lifetimes.
- [#652 Ability to create collections with parameterized query functions](https://github.com/TanStack/db/issues/652) asks for parameterized query functions. This seems related to separating business scope, such as tenant/project/account, from query-driven subset predicates.
- [#901 Using a syncMode: "on-demand" collection breaks the TanStack Query persist-client persister](https://github.com/TanStack/db/issues/901) reports persistence failure for on-demand collections, which suggests the adapter needs an explicit persistence/structured-clone contract for Query metadata and dehydrated state.

### Related historical fixes

These closed items are not evidence that current main is broken. They are useful context because they show the kinds of integration problems that have recurred around this boundary:

- [#1568 fix(query-db-collection): forward gcTime from queryCollectionOptions to the underlying query](https://github.com/TanStack/db/pull/1568) fixed an exposed Query option that did not reach the underlying observer.
- [#707 fix(query-db-collection): respect QueryClient defaultOptions when not overridden](https://github.com/TanStack/db/pull/707) fixed explicitly passed `undefined` values suppressing `QueryClient.defaultOptions`.
- [#870 fix(query-db-collection): implement reference counting for QueryObserver lifecycle](https://github.com/TanStack/db/pull/870) added reference counting for QueryObserver lifecycle.
- [#712 feat(query-db-collection): expose query state from QueryObserver](https://github.com/TanStack/db/pull/712) exposed Query state through the collection adapter.
- [#381 feat(query-db-collection): support automatic refetch on query invalidation](https://github.com/TanStack/db/pull/381) addressed automatic refetch behavior after Query invalidation.
- [#1287 fix(query-db-collection): align queryOptions interop types](https://github.com/TanStack/db/pull/1287) fixed Query option interop types.
- [#998 staleTime is ignored for syncMode: "on-demand" collections](https://github.com/TanStack/db/issues/998) tracked on-demand staleness semantics.

## Diagnosis

The cluster is not just a list of missing flags. It points to one integration-boundary problem:

`query-db-collection` bridges TanStack Query's document-cache model and TanStack DB's normalized row-store model.

That bridge is valuable, but it becomes hard to maintain when the adapter manually shadows TanStack Query behavior. Option forwarding, invalidation, persistence, QueryClient scoping, parameterization, row projection, cancellation, and lifecycle management all become adapter responsibilities unless the ownership boundary is explicit.

A useful target boundary is:

- **TanStack Query owns** fetching, retries, staleness, invalidation, focus/reconnect behavior, cancellation, hydration, persistence, and remote-response caching.
- **TanStack DB owns** row identity, materialization, local queries, optimistic transactions, and normalized row state.
- **The adapter owns** projection between Query results and DB rows, plus the lease that tracks which query/subset currently owns which materialized rows.

This boundary keeps Query semantics in Query and DB semantics in DB. The adapter should connect the two, not become a partial reimplementation of TanStack Query.

## Proposed PR sequence

### PR 1: persistence regression coverage for on-demand collections

Related issue: [#901](https://github.com/TanStack/db/issues/901)

Issue #901 is specifically about Query persistence: an on-demand collection caused `@tanstack/react-query-persist-client` with an IndexedDB persister to fail with a `DataCloneError` because a function-bearing `subscription` object reached Query metadata.

The first PR should add regression coverage for that persistence path. The test should create an on-demand query collection, load a subset, dehydrate the QueryClient, and verify that the persisted/dehydrated payload is structured-clone safe. If the repository already has a lightweight IndexedDB persister test utility, use it. Otherwise, `structuredClone(dehydrate(queryClient))` is the right focused unit-level guard because IndexedDB persistence fails at the structured clone step.

The test should also assert that adapter-owned Query metadata does not contain functions, subscriptions, collection instances, or other runtime-only values.

If current main already passes, this PR still locks in the persistence contract and narrows #901. If it fails, the fix should be minimal and non-breaking: keep `ctx.meta.loadSubsetOptions` working, but ensure the metadata copy stored in Query is persistence-safe plain data.

### PR 2: invalidation behavior matrix

Related issue: [#344](https://github.com/TanStack/db/issues/344)

Before adding a collection-specific invalidation API, document and test the behavior matrix:

- active query + exact invalidation;
- active query + prefix invalidation;
- inactive cached query;
- on-demand subset query;
- overlapping subset queries;
- failed refetch after invalidation;
- removed query;
- persisted or retained query.

The likely public API can remain a thin convenience wrapper over `queryClient.invalidateQueries`, if one is needed at all. TanStack Query should remain the invalidation authority.

### PR 3: Query option pass-through and compatibility table

Related issues: [#183](https://github.com/TanStack/db/issues/183), [#346](https://github.com/TanStack/db/issues/346)

Move away from adding individual Query-like flags to a flat adapter config one by one. Instead, introduce or design toward a Query options object/factory whose type is derived from TanStack Query's option types, excluding only fields the adapter must own.

The documentation should classify options as:

- inherited unchanged from TanStack Query;
- adapter-owned or reinterpreted;
- unsupported, with rationale.

This should reduce bugs where an exposed Query option is forgotten, forwarded incorrectly, or accidentally overrides `QueryClient.defaultOptions`.

### PR 4: clarify row projection semantics

Related issue: [#345](https://github.com/TanStack/db/issues/345)

Current `select` support appears to solve row extraction from wrapped responses. The follow-up design question is naming and semantics: this adapter-level `select` is a row projection for DB materialization, not exactly TanStack Query's `select`.

A future additive API could make this more explicit, for example:

```ts
rows: {
  read: (response) => response.items,
  write: (response, rows) => ({ ...response, items: rows }),
}
```

The optional reverse projection matters for direct writes and Query cache patching. Without a lawful reverse projection and subset-membership information, invalidating affected queries is safer than fabricating a wrapped cache response.

This PR should be additive and should not remove the existing `select` option.

### PR 5: runtime binding / request-local QueryClient scope

Related issue: [#436](https://github.com/TanStack/db/issues/436)

A collection definition should be separable from runtime state. `QueryClient` is runtime state and is often request-scoped on the server.

A future additive direction could look like:

```ts
const todosDefinition = defineQueryCollection({
  // schema, query factory, projection, mutations
})

const todos = todosDefinition.bind({
  queryClient,
  scope: { projectId, userId },
})
```

This would avoid process-global QueryClient assumptions and support TanStack Start loaders, SSR isolation, tests with multiple QueryClients, auth/account switching, and deterministic disposal.

### PR 6: collection families and business scope

Related issue: [#652](https://github.com/TanStack/db/issues/652)

Separate two kinds of parameterization:

- **business scope:** tenant, project, account, workspace, API endpoint, auth context;
- **relational subset scope:** predicates, sorting, limits, offsets pushed down from a live query.

A collection-family API could make business scope first-class while keeping query-driven subset state explicit. This avoids forcing users to encode unrelated concepts into one anonymous `meta` bag or into ad hoc closures.

### PR 7: internal query lease manager

Related issue: [#350](https://github.com/TanStack/db/issues/350), lifecycle portion

The adapter currently has to coordinate observers, unsubscribers, query-to-row ownership, row-to-query ownership, reference counts, retained query state, and retention timers. Those responsibilities would be easier to reason about if centered around a query/subset lease object.

A lease model should distinguish three lifetimes:

- Query observer lifetime;
- materialized row ownership lifetime;
- Query cache lifetime.

It should also make cancellation and late network results generation-safe, so a stale result cannot mutate rows after cancellation, disposal, or recreation.

## Non-goals

- No immediate breaking changes.
- No one-shot rewrite.
- No competing invalidation system outside TanStack Query.
- No removal of existing `select` behavior without migration.
- No removal of existing `meta` behavior without migration.
- No process-global QueryClient workaround for SSR/request-lifetime issues.

## Questions for maintainers

1. Does this describe the right integration boundary between TanStack Query, TanStack DB, and query-db-collection?
2. Are there issues or PRs missing from this cluster summary?
3. Is the proposed PR sequence the right order?
4. Should the API work be strictly additive first, with deprecations considered later?
5. Are there SSR, hydration, persistence, or Start-specific constraints this roadmap should account for before implementation begins?
