---
id: LiveQueryStatusFlags
title: LiveQueryStatusFlags
---

Defined in: [packages/db/src/live-query-primitives.ts:59](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-primitives.ts#L59)

The derived flags and health every adapter exposes for a query, besides
`status`, which each adapter reports as its own field.

## Properties

### health

```ts
health: HealthNode | undefined;
```

Defined in: [packages/db/src/live-query-primitives.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-primitives.ts#L78)

The health tree for the query and every Collection it depends on, or
`undefined` for a disabled query.

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [packages/db/src/live-query-primitives.ts:67](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-primitives.ts#L67)

***

### isCrashed

```ts
isCrashed: boolean;
```

Defined in: [packages/db/src/live-query-primitives.ts:66](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-primitives.ts#L66)

Local storage or an invariant broke. `status` is `crashed`.

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [packages/db/src/live-query-primitives.ts:62](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-primitives.ts#L62)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/db/src/live-query-primitives.ts:60](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-primitives.ts#L60)

***

### isLoadingError

```ts
isLoadingError: boolean;
```

Defined in: [packages/db/src/live-query-primitives.ts:64](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-primitives.ts#L64)

The first load failed: there is nothing to show. `status` is `error`.

***

### isReady

```ts
isReady: boolean;
```

Defined in: [packages/db/src/live-query-primitives.ts:61](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-primitives.ts#L61)

***

### isSyncError

```ts
isSyncError: boolean;
```

Defined in: [packages/db/src/live-query-primitives.ts:73](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-primitives.ts#L73)

The data is shown, and something keeps it from staying current: a sync
problem or failed request somewhere in `health`. Set only while `status` is
`ready`; a disabled query is never in a sync error.
