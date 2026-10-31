---
id: HealthNode
title: HealthNode
---

Defined in: [packages/db/src/types.ts:856](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L856)

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

Defined in: [packages/db/src/types.ts:858](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L858)

The query alias, or `root` for the Collection the tree was read from.

***

### collectionId

```ts
readonly collectionId: string;
```

Defined in: [packages/db/src/types.ts:859](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L859)

***

### error

```ts
readonly error: HealthProblem | null;
```

Defined in: [packages/db/src/types.ts:866](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L866)

***

### failureReason

```ts
readonly failureReason: HealthProblem | null;
```

Defined in: [packages/db/src/types.ts:865](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L865)

***

### hasErrors

```ts
readonly hasErrors: boolean;
```

Defined in: [packages/db/src/types.ts:864](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L864)

This node or any node below it has a `failureReason` or an `error`.

***

### kind

```ts
readonly kind: "source" | "include" | "live-query";
```

Defined in: [packages/db/src/types.ts:861](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L861)

`include` is an include's source; its rows feed per-row child Collections.

***

### reloading

```ts
readonly reloading: boolean;
```

Defined in: [packages/db/src/types.ts:871](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L871)

A reload's new sync run is in flight: the rows, status, and problem shown
are the previous run's until it commits or fails.

***

### sources

```ts
readonly sources: readonly HealthNode[];
```

Defined in: [packages/db/src/types.ts:872](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L872)

***

### status

```ts
readonly status: CollectionStatus;
```

Defined in: [packages/db/src/types.ts:862](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L862)
