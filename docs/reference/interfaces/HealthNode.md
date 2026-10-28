---
id: HealthNode
title: HealthNode
---

Defined in: [packages/db/src/types.ts:813](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L813)

One node of a health tree. A Collection's tree is one node; a live query's
has one node for itself and one for each source alias in query order. The
shape is fixed by the query, and nodes without a problem are present too.

A node shows at most one problem. `failureReason`: something went wrong and
the sync adapter is still trying, so the problem clears by itself.
`error`: the first load failed, the sync adapter stopped, the Collection
crashed, or, on a live query's own node, a request for more data failed.

## Properties

### alias

```ts
readonly alias: string;
```

Defined in: [packages/db/src/types.ts:815](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L815)

The query alias, or `root` for the Collection the tree was read from.

***

### collectionId

```ts
readonly collectionId: string;
```

Defined in: [packages/db/src/types.ts:816](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L816)

***

### error

```ts
readonly error: CollectionErrorInfo | null;
```

Defined in: [packages/db/src/types.ts:823](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L823)

***

### failureReason

```ts
readonly failureReason: CollectionErrorInfo | null;
```

Defined in: [packages/db/src/types.ts:822](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L822)

***

### hasErrors

```ts
readonly hasErrors: boolean;
```

Defined in: [packages/db/src/types.ts:821](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L821)

This node or any node below it has a `failureReason` or an `error`.

***

### kind

```ts
readonly kind: "source" | "include" | "live-query";
```

Defined in: [packages/db/src/types.ts:818](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L818)

`include` is an include's source; its rows feed per-row child Collections.

***

### reloading

```ts
readonly reloading: boolean;
```

Defined in: [packages/db/src/types.ts:828](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L828)

A reload's new sync run is in flight: the rows, status, and problem shown
are the previous run's until it commits or fails.

***

### sources

```ts
readonly sources: readonly HealthNode[];
```

Defined in: [packages/db/src/types.ts:829](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L829)

***

### status

```ts
readonly status: CollectionStatus;
```

Defined in: [packages/db/src/types.ts:819](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L819)
