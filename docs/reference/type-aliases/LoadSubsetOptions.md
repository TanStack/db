---
id: LoadSubsetOptions
title: LoadSubsetOptions
---

# Type Alias: LoadSubsetOptions

```ts
type LoadSubsetOptions = object;
```

Defined in: [packages/db/src/types.ts:284](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L284)

## Properties

### cursor?

```ts
optional cursor: CursorExpressions;
```

Defined in: [packages/db/src/types.ts:296](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L296)

Cursor expressions for cursor-based pagination.
These are separate from `where` - the sync layer should combine them if using cursor-based pagination.
Neither expression includes the main `where` clause.

***

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:290](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L290)

The limit of the data to load

***

### offset?

```ts
optional offset: number;
```

Defined in: [packages/db/src/types.ts:301](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L301)

Row offset for offset-based pagination.
The sync layer can use this instead of `cursor` if it prefers offset-based pagination.

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:288](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L288)

The order by clause to sort the data

***

### subscription?

```ts
optional subscription: Subscription;
```

Defined in: [packages/db/src/types.ts:310](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L310)

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

Defined in: [packages/db/src/types.ts:286](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L286)

The where expression to filter the data (does NOT include cursor expressions)
