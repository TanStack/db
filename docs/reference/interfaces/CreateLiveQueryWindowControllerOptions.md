---
id: CreateLiveQueryWindowControllerOptions
title: CreateLiveQueryWindowControllerOptions
---

Defined in: [packages/db/src/live-query-window-controller.ts:540](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L540)

**`Internal`**

This contract is unstable while RFC #1623 is being implemented.

## Properties

### client?

```ts
optional client: DbClient;
```

Defined in: [packages/db/src/live-query-window-controller.ts:541](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L541)

***

### initialPageCount?

```ts
optional initialPageCount: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:548](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L548)

Committed pages to preserve when a framework binding changes page shape.

***

### initialPageParam?

```ts
optional initialPageParam: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:546](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L546)

Value of the first page's `pageParam` (default 0).

***

### pageSize?

```ts
optional pageSize: number;
```

Defined in: [packages/db/src/live-query-window-controller.ts:544](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L544)

Rows per page (default 20). Invalid values use the default.

***

### queryHash?

```ts
optional queryHash: string;
```

Defined in: [packages/db/src/live-query-window-controller.ts:542](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L542)
