---
id: CreateLiveQueryWindowControllerOptions
title: CreateLiveQueryWindowControllerOptions
---

Defined in: [packages/db/src/live-query-window-controller.ts:507](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L507)

**`Internal`**

This contract is unstable while RFC #1623 is being implemented.

## Properties

### initialPageCount?

```ts
optional initialPageCount: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:513](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L513)

Committed pages to preserve when a framework binding changes page shape.

***

### initialPageParam?

```ts
optional initialPageParam: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:511](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L511)

Value of the first page's `pageParam` (default 0).

***

### pageSize?

```ts
optional pageSize: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:509](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L509)

Rows per page (default 20). Invalid values use the default.
