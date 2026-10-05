---
id: CursorPager
title: CursorPager
---

Defined in: [packages/query-db-collection/src/cursor-pagination.ts:24](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/cursor-pagination.ts#L24)

## Type Parameters

### T

`T`

## Properties

### read()

```ts
read: (window, signal?) => Promise<T[]>;
```

Defined in: [packages/query-db-collection/src/cursor-pagination.ts:25](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/cursor-pagination.ts#L25)

#### Parameters

##### window

###### limit?

`number`

###### offset?

`number`

##### signal?

`AbortSignal`

#### Returns

`Promise`\<`T`[]\>

***

### reset()

```ts
reset: () => void;
```

Defined in: [packages/query-db-collection/src/cursor-pagination.ts:30](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/cursor-pagination.ts#L30)

Remove this key's cached pages and invalidate this pager's queued reads.

#### Returns

`void`
