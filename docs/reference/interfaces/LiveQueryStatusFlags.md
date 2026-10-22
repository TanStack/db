---
id: LiveQueryStatusFlags
title: LiveQueryStatusFlags
---

Defined in: [packages/db/src/live-query-adapter.ts:58](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L58)

The derived boolean status flags every adapter exposes for a query.

## Properties

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [packages/db/src/live-query-adapter.ts:66](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L66)

***

### isCrashed

```ts
isCrashed: boolean;
```

Defined in: [packages/db/src/live-query-adapter.ts:65](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L65)

Local storage or an invariant broke. `status` is `crashed`.

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [packages/db/src/live-query-adapter.ts:61](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L61)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/db/src/live-query-adapter.ts:59](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L59)

***

### isLoadingError

```ts
isLoadingError: boolean;
```

Defined in: [packages/db/src/live-query-adapter.ts:63](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L63)

The first load failed: there is nothing to show. `status` is `error`.

***

### isReady

```ts
isReady: boolean;
```

Defined in: [packages/db/src/live-query-adapter.ts:60](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L60)
