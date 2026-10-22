---
id: CreateLiveQueryWindowControllerOptions
title: CreateLiveQueryWindowControllerOptions
---

Defined in: [packages/db/src/live-query-window-controller.ts:536](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L536)

**`Internal`**

This contract is unstable while RFC #1623 is being implemented.

## Properties

### initialPageCount?

```ts
optional initialPageCount: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:542](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L542)

Committed pages to preserve when a framework binding changes page shape.

***

### initialPageParam?

```ts
optional initialPageParam: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:540](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L540)

Value of the first page's `pageParam` (default 0).

***

### pageSize?

```ts
optional pageSize: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:538](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L538)

Rows per page (default 20). Invalid values use the default.
