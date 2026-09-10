---
id: LoadSubsetOptions
title: LoadSubsetOptions
---

# Type Alias: LoadSubsetOptions

```ts
type LoadSubsetOptions = object;
```

Defined in: [packages/db/src/types.ts:304](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L304)

Request data is immutable from submission onward. Callers and adapters must not
mutate options, expression trees, comparison options, or constant payloads such
as Dates, byte arrays, and membership arrays. Create new request data to change
a demand. Core does not clone or freeze it. Use stable data properties, not
stateful getters. Signal and subscription references stay fixed, but aborting
the signal or releasing the subscription remains supported.

## Properties

### cursor?

```ts
optional cursor: CursorExpressions;
```

Defined in: [packages/db/src/types.ts:316](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L316)

Cursor expressions for cursor-based pagination.
These are separate from `where` - the sync layer should combine them if using cursor-based pagination.
Neither expression includes the main `where` clause.

***

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:310](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L310)

The limit of the data to load

***

### offset?

```ts
optional offset: number;
```

Defined in: [packages/db/src/types.ts:321](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L321)

Row offset for offset-based pagination.
The sync layer can use this instead of `cursor` if it prefers offset-based pagination.

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:308](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L308)

The order by clause to sort the data

***

### signal?

```ts
optional signal: AbortSignal;
```

Defined in: [packages/db/src/types.ts:327](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L327)

Aborted when this exact subset request is no longer current. Cancellation
is cooperative: async sync adapters must check the signal immediately
before installing a baseline or later request-scoped rows.

***

### subscription?

```ts
optional subscription: Subscription;
```

Defined in: [packages/db/src/types.ts:336](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L336)

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

Defined in: [packages/db/src/types.ts:306](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L306)

The where expression to filter the data (does NOT include cursor expressions)
