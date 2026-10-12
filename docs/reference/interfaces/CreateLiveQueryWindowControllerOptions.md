---
id: CreateLiveQueryWindowControllerOptions
title: CreateLiveQueryWindowControllerOptions
---

Defined in: [packages/db/src/live-query-window-controller.ts:543](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L543)

**`Internal`**

This contract is unstable while RFC #1623 is being implemented.

## Properties

### initialPageCount?

```ts
optional initialPageCount: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:549](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L549)

Committed pages to preserve when a framework binding changes page shape.

***

### initialPageParam?

```ts
optional initialPageParam: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:547](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L547)

Value of the first page's `pageParam` (default 0).

***

### pageSize?

```ts
optional pageSize: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:545](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L545)

Rows per page (default 20). Invalid values use the default.
