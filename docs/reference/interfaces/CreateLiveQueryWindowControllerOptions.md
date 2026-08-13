---
id: CreateLiveQueryWindowControllerOptions
title: CreateLiveQueryWindowControllerOptions
---

# Interface: CreateLiveQueryWindowControllerOptions

Defined in: [packages/db/src/live-query-window-controller.ts:263](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L263)

**`Internal`**

This contract is unstable while RFC #1623 is being implemented.

## Properties

### initialPageCount?

```ts
optional initialPageCount: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:269](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L269)

Committed pages to preserve when a framework binding changes page shape.

***

### initialPageParam?

```ts
optional initialPageParam: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:267](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L267)

Value of the first page's `pageParam` (default 0).

***

### pageSize?

```ts
optional pageSize: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:265](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L265)

Rows per page (default 20). Non-positive values use the default.
