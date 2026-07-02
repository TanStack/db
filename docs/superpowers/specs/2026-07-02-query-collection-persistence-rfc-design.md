# Query Collection Persistence Safety and Roadmap RFC Design

## Context

This work starts the query-db-collection / TanStack Query integration issue cluster with a small, non-breaking PR and a separate roadmap-style RFC issue.

The first PR targets the persistence safety concern behind issue #901: an on-demand query collection must not place non-cloneable adapter runtime state into TanStack Query's persisted/dehydrated cache payload.

The RFC issue will frame the broader cluster as an integration-boundary problem and propose a staged sequence of small PRs rather than a single rewrite.

## Goals

### First PR

- Add regression coverage for `syncMode: "on-demand"` query collections and TanStack Query persistence/dehydration cloneability.
- Verify that dehydrated QueryClient state can pass through `structuredClone` after loading an on-demand subset.
- Assert that Query metadata does not contain functions, subscriptions, collection instances, or other runtime-only adapter state.
- If the test fails, make the smallest non-breaking production change needed to keep adapter-provided metadata clone-safe.
- Preserve existing public behavior, especially `ctx.meta.loadSubsetOptions`.

### RFC issue

- Open a maintainer-facing roadmap issue for the larger query-db-collection integration boundary.
- Explain the distinction between TanStack Query ownership, TanStack DB ownership, and adapter ownership.
- Propose a staged PR sequence that can be discussed independently of the first bug-fix PR.

## Non-goals

- Do not introduce breaking API changes.
- Do not remove `ctx.meta.loadSubsetOptions`.
- Do not rename or remove the existing `select` option.
- Do not introduce `defineQueryCollection().bind(...)` in the first PR.
- Do not replace lifecycle maps with a lease manager in the first PR.
- Do not implement Query option pass-through in the first PR.
- Do not create a separate invalidation system competing with TanStack Query.

## First PR Design

The first PR should add a focused regression test around the persistence boundary:

1. Create a `QueryClient`.
2. Create a query collection using `queryCollectionOptions` with `syncMode: "on-demand"`.
3. Load a realistic subset using `collection._sync.loadSubset(...)`.
4. Dehydrate the QueryClient with TanStack Query's `dehydrate`.
5. Pass the dehydrated payload through `structuredClone`.
6. Assert the clone succeeds.
7. Inspect dehydrated query metadata and assert it contains no functions or obvious adapter runtime objects.

The preferred test failure mode is close to the reported #901 symptom: `structuredClone` or an IndexedDB-style persister should not throw `DataCloneError` because of metadata owned by query-db-collection.

If current main already passes this test, the PR remains useful as a regression-test PR. Its PR body should say that the issue appears fixed or narrowed in current main, and that the test locks the persistence contract going forward.

If current main fails, the production fix should be minimal and local. The preferred fix is to sanitize only the adapter-created metadata copy sent to TanStack Query so that runtime-only values are not stored in Query metadata. Public inputs and user-facing behavior should remain unchanged.

## Compatibility Constraints

The PR must preserve:

- the existing `queryCollectionOptions(...)` API;
- the requirement to pass `queryClient` today;
- `syncMode: "on-demand"` behavior;
- `ctx.meta.loadSubsetOptions` availability inside `queryFn`;
- user-supplied `meta` forwarding;
- QueryFunctionContext typing behavior;
- existing select/defaultOptions/gcTime behavior.

The only new contract is that adapter-owned metadata must be persistence-safe plain data once it enters the Query cache/dehydrated state.

## RFC Issue Design

The RFC issue should be roadmap-style rather than a full API specification. It must not assume readers already know the issue cluster. It should open by explaining that we analyzed the repository's open issues and related closed PRs/issues, and that query-db-collection's TanStack Query integration emerged as one coherent cluster.

Suggested title:

> RFC: roadmap for query-db-collection / TanStack Query integration

Suggested structure:

1. Background: why this RFC exists
   - State that this RFC comes from an analysis of open issues and related historical fixes across the repository.
   - Explain that one identified cluster concerns the boundary between query-db-collection, TanStack Query, and TanStack DB row materialization.
   - Say the goal is to summarize the cluster and propose a sequence of small, non-breaking PRs.

2. Cluster summary with links
   - Active issues:
     - [#183 Deepen the integration with Query](https://github.com/TanStack/db/issues/183): broad request to evaluate TanStack Query behaviors such as refresh on mount/window focus.
     - [#344 Add Query Invalidation Support to query-db-collection](https://github.com/TanStack/db/issues/344): clarify how collection invalidation should relate to `queryClient.invalidateQueries`.
     - [#345 Add select Option to query-db-collection](https://github.com/TanStack/db/issues/345): wrapped API responses and row extraction; appears largely implemented on current main, but raises projection semantics for future work.
     - [#346 Add Initial Data and Query Options Support to query-db-collection](https://github.com/TanStack/db/issues/346): pressure to expose more of TanStack Query's option surface.
     - [#350 Expose QueryFunctionContext properties (signal, meta) in query-db-collection](https://github.com/TanStack/db/issues/350): context typing/meta is partly addressed, while cancellation/lifecycle behavior remains relevant.
     - [#436 Error `[QueryCollection] queryClient must be provided` on TanStack Start's beforeLoad](https://github.com/TanStack/db/issues/436): runtime QueryClient scoping and SSR/request-local binding.
     - [#652 Ability to create collections with parameterized query functions](https://github.com/TanStack/db/issues/652): business scope parameters such as tenant/project/account should be distinct from query-driven subset predicates.
     - [#901 Using a syncMode: "on-demand" collection breaks the TanStack Query persist-client persister](https://github.com/TanStack/db/issues/901): persistence/structured-clone safety for on-demand metadata.
   - Related historical fixes that show recurring symptoms:
     - [#1568 fix(query-db-collection): forward gcTime from queryCollectionOptions to the underlying query](https://github.com/TanStack/db/pull/1568): an exposed Query option did not reach the underlying observer.
     - [#707 fix(query-db-collection): respect QueryClient defaultOptions when not overridden](https://github.com/TanStack/db/pull/707): explicitly passing undefined suppressed QueryClient defaults.
     - [#870 fix(query-db-collection): implement reference counting for QueryObserver lifecycle](https://github.com/TanStack/db/pull/870): observer lifecycle required adapter-managed reference counting.
     - [#712 feat(query-db-collection): expose query state from QueryObserver](https://github.com/TanStack/db/pull/712): users need visibility into Query state through the collection adapter.
     - [#381 feat(query-db-collection): support automatic refetch on query invalidation](https://github.com/TanStack/db/pull/381): invalidation behavior has already needed special handling.
     - [#1287 fix(query-db-collection): align queryOptions interop types](https://github.com/TanStack/db/pull/1287): Query option interop has needed type-level correction.
     - [#998 staleTime is ignored for syncMode: "on-demand" collections](https://github.com/TanStack/db/issues/998): on-demand Query staleness semantics have been a correctness concern.

3. Problem statement
   - The cluster is not just a list of missing flags. It points to an integration-boundary question: query-db-collection bridges TanStack Query's document cache semantics and TanStack DB's normalized row semantics.
   - Option pass-through, invalidation, persistence, QueryClient scoping, parameterized query functions, lifecycle/cancellation, and row projection all become difficult when the adapter shadows Query behavior rather than clearly delegating to it.

4. Ownership boundary
   - TanStack Query owns fetching, retries, staleness, invalidation, focus/reconnect behavior, cancellation, hydration, persistence, and remote-response caching.
   - TanStack DB owns row identity, materialization, local queries, optimistic transactions, and normalized row state.
   - The adapter owns projection between Query results and DB rows, plus leases that track which query/subset currently owns which rows.

5. Proposed PR sequence
   - PR 1: persistence/metadata cloneability contract for on-demand collections ([#901](https://github.com/TanStack/db/issues/901)).
   - PR 2: invalidation behavior matrix for active, inactive, prefix, exact, and on-demand subset queries ([#344](https://github.com/TanStack/db/issues/344)).
   - PR 3: Query option pass-through and compatibility table ([#183](https://github.com/TanStack/db/issues/183), [#346](https://github.com/TanStack/db/issues/346)).
   - PR 4: clarify row projection semantics; evolve `select` toward `rows.read` and optional `rows.write` without breaking existing users ([#345](https://github.com/TanStack/db/issues/345) follow-up).
   - PR 5: runtime binding / request-local QueryClient scope for SSR and TanStack Start ([#436](https://github.com/TanStack/db/issues/436)).
   - PR 6: collection-family / business scope versus relational subset parameterization ([#652](https://github.com/TanStack/db/issues/652)).
   - PR 7: internal query lease manager for lifecycle, cancellation, retention, and query-specific status correctness ([#350](https://github.com/TanStack/db/issues/350) lifecycle portion and related historical bugs).

6. Non-goals
   - no immediate breaking changes;
   - no one-shot rewrite;
   - no separate invalidation system;
   - no removal of existing `select` or `meta` behavior without migration.

7. Maintainer questions
   - Is this the right integration boundary?
   - Does the cluster summary miss any issues or PRs maintainers consider part of this theme?
   - Which P0 items should be prioritized?
   - Should API evolution be additive first, with deprecations later?
   - Are there SSR or persistence constraints missing from the roadmap?

## Testing Strategy

The first PR should add targeted tests in the query-db-collection test suite. The tests should prefer `structuredClone(dehydrate(queryClient))` over a real IndexedDB dependency, because structured clone failure is the core persistence failure mode.

A real persister test can be added only if the repository already has a lightweight test utility for it. Otherwise, avoid adding unnecessary dependencies.

## Issue and PR Workflow

1. Implement or add the first PR test in the worktree.
2. If the test fails, add the smallest non-breaking fix.
3. Run focused tests for query-db-collection.
4. Draft the RFC issue body and review it with the user before posting.
5. Post the RFC issue with `gh issue create` only after user approval.
6. Open the first PR after the test/fix is ready and reference both #901 and the RFC issue if available.

## Open Decisions

- Exact test location depends on nearby query-db-collection persistence/on-demand tests.
- Whether the first PR is test-only or includes production code depends on the regression result.
- The RFC issue number will be known only after posting to GitHub.
