---
id: LoadSubsetOptions
title: LoadSubsetOptions
---

# Type Alias: LoadSubsetOptions

```ts
type LoadSubsetOptions = object;
```

Defined in: [packages/db/src/types.ts:257](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L257)

## Properties

### cursor?

```ts
optional cursor: CursorExpressions;
```

Defined in: [packages/db/src/types.ts:297](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L297)

Cursor expressions for cursor-based pagination.
These are separate from `where` - the sync layer should combine them if using cursor-based pagination.
Neither expression includes the main `where` clause.

***

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:263](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L263)

The limit of the data to load

***

### offset?

```ts
optional offset: number;
```

Defined in: [packages/db/src/types.ts:302](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L302)

Row offset for offset-based pagination.
The sync layer can use this instead of `cursor` if it prefers offset-based pagination.

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:261](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L261)

The order by clause to sort the data

***

### subscription?

```ts
optional subscription: Subscription;
```

Defined in: [packages/db/src/types.ts:272](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L272)

The subscription that triggered the load.
Advanced sync implementations can use this for:
- LRU caching keyed by subscription
- Reference counting to track active subscriptions
- Subscribing to subscription events (e.g., finalization/unsubscribe)

#### Optional

Available when called from CollectionSubscription, may be undefined for direct calls

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:259](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L259)

The where expression to filter the data (does NOT include cursor expressions)
