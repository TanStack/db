---
id: CreateLiveQueryWindowControllerOptions
title: CreateLiveQueryWindowControllerOptions
---

# Interface: CreateLiveQueryWindowControllerOptions

Defined in: [packages/db/src/live-query-window-controller.ts:504](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L504)

**`Internal`**

This contract is unstable while RFC #1623 is being implemented.

## Properties

### initialPageCount?

```ts
optional initialPageCount: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:510](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L510)

Committed pages to preserve when a framework binding changes page shape.

***

### initialPageParam?

```ts
optional initialPageParam: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:508](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L508)

Value of the first page's `pageParam` (default 0).

***

### pageSize?

```ts
optional pageSize: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:506](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L506)

Rows per page (default 20). Invalid values use the default.
