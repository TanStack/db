# Query collection select row extraction semantics

## Context

Issue [#345](https://github.com/TanStack/db/issues/345) requested a `select` option for `@tanstack/query-db-collection` so APIs can return wrapped responses such as `{ data: Todo[], total, page }` while TanStack DB materializes only the row array.

Current main already includes `select` support. RFC [#1643](https://github.com/TanStack/db/issues/1643) clarifies the remaining semantic distinction: query-db-collection's `select` is row extraction for DB materialization. It is not exactly the same semantic surface as TanStack Query's `select`.

This PR should close the documentation/test gap for #345 without introducing a new projection or lens API.

## Goals

- Clarify that `select` extracts rows for TanStack DB materialization from a TanStack Query result.
- Clarify that the TanStack Query cache keeps the original query response shape.
- Preserve existing broadly useful direct-write cache patching behavior for wrapped responses.
- Add or sharpen focused tests for wrapped response materialization and metadata preservation.

## Non-goals

- Do not rename `select`.
- Do not add a new `rows.read` / `rows.write` API.
- Do not remove existing direct-write wrapper patching fallbacks unless a focused test exposes clear corruption.
- Do not redesign invalidation or refetch behavior for unpatchable derived projections.

## Public semantics

`select` should be described as a row extraction function:

```ts
select: (response) => response.items
```

It tells query-db-collection which array of rows TanStack DB should materialize from the Query result.

The original Query cache value remains the wrapped response:

```ts
// Query cache value
{
  items: Todo[],
  nextCursor: string,
  total: number,
}

// DB materialized rows
Todo[]
```

Docs should avoid implying that adapter-level `select` is exactly TanStack Query's observer-level `select`. The adapter uses it to bridge Query's document-cache shape into DB's normalized row store.

## Direct-write cache patching semantics

Direct write utilities such as `writeInsert`, `writeUpdate`, and `writeDelete` update TanStack DB's synced row state and make a best-effort attempt to keep matching Query cache entries in sync.

For wrapped responses, the existing implementation should remain broadly compatible:

1. Use `select(oldData)` and patch the direct wrapper property whose value is the selected array by reference equality.
2. Fall back to common wrapper fields such as `data`, `items`, and `results`.
3. Fall back to the first array property.
4. If no array property can be found, leave the cached wrapper unchanged.

This behavior should be documented as best effort. It is reliable for simple wrappers like `{ data: [...] }`, `{ items: [...] }`, and `{ results: [...] }`. It is not a general bidirectional projection system.

Derived projections such as GraphQL edge flattening are read-side row extraction only:

```ts
select: (response) => response.edges.map((edge) => edge.node)
```

query-db-collection cannot generally reconstruct the original response envelope from updated rows. Users who need exact wrapped cache updates for derived projections should refetch/invalidate or wait for a future explicit read/write projection API.

## Test plan

Audit existing tests first and avoid duplicating coverage. Add or adjust tests only where coverage is incomplete.

Recommended focused coverage:

1. Wrapped response materialization:
   - `queryFn` returns `{ items: rows, meta: { page: 1 } }`.
   - `select` returns `response.items`.
   - Collection materializes rows.
   - `queryClient.getQueryData(queryKey)` still returns the wrapped response including metadata.

2. Direct writes with a common wrapper:
   - Start from a wrapped response with row array plus metadata.
   - Exercise `writeInsert`, `writeUpdate`, and/or `writeDelete` as appropriate.
   - Assert the collection updates.
   - Assert the Query cache preserves wrapper metadata and updates the row array.

3. Existing error behavior:
   - Keep coverage that non-array `select` results are rejected and do not materialize rows.

Avoid adding a brittle derived-projection behavior test unless current behavior clearly corrupts the cache in a way this PR intentionally fixes.

## Documentation plan

Update `docs/collections/query-collection.md` around the `select` option with:

- a concise definition of `select` as DB row extraction;
- an example showing a wrapped response and preserved Query cache metadata;
- a note that direct-write cache patching for wrapped responses is best effort;
- examples of simple wrappers that work automatically;
- a limitation note for derived projections.

Generated reference docs may need to be updated only if the source comments change and the repository expects generated docs in the PR.

## Implementation constraints

- Follow `AGENTS.md` quality guidance.
- Prefer tests/docs clarification over behavior changes.
- Keep any behavior change small and directly justified by a failing focused test.
- Do not broaden the PR into invalidation semantics or future API design.
