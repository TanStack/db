---
id: UseLiveInfiniteQueryConfig
title: UseLiveInfiniteQueryConfig
---

```ts
type UseLiveInfiniteQueryConfig<_TContext> = object;
```

Defined in: [useLiveInfiniteQuery.ts:26](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveInfiniteQuery.ts#L26)

## Type Parameters

### _TContext

`_TContext` *extends* `Context`

## Properties

### initialPageParam?

```ts
optional initialPageParam: number;
```

Defined in: [useLiveInfiniteQuery.ts:34](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveInfiniteQuery.ts#L34)

First result-page label, not a server cursor or remote offset.

***

### pageSize?

```ts
optional pageSize: number;
```

Defined in: [useLiveInfiniteQuery.ts:32](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveInfiniteQuery.ts#L32)

***

### queryKey?

```ts
optional queryKey: LiveQueryKey;
```

Defined in: [useLiveInfiniteQuery.ts:31](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveInfiniteQuery.ts#L31)

Explicit identity for a query whose IR cannot derive one, such as a query
with functional variants. Structured queries should omit it.
