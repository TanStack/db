---
id: CursorPage
title: CursorPage
---

Defined in: [packages/query-db-collection/src/cursor-pagination.ts:5](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/cursor-pagination.ts#L5)

One backend page. Only null means the ordered result is exhausted.

## Type Parameters

### T

`T`

## Properties

### nextCursor

```ts
nextCursor: string | null;
```

Defined in: [packages/query-db-collection/src/cursor-pagination.ts:7](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/cursor-pagination.ts#L7)

***

### rows

```ts
rows: readonly T[];
```

Defined in: [packages/query-db-collection/src/cursor-pagination.ts:6](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/cursor-pagination.ts#L6)
