---
id: LoadSubsetOptions
title: LoadSubsetOptions
---

# Type Alias: LoadSubsetOptions

```ts
type LoadSubsetOptions = object;
```

Defined in: [packages/db/src/types.ts:312](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L312)

Immutable request data. From submission onward, callers and adapters must
not mutate these options, their expression trees, comparison options, or
constant payloads (including Dates, byte arrays, and membership arrays).
Create new request data to change a demand; core does not clone or freeze it.
Use stable data properties, not stateful getters, for request data.
Signal and subscription references stay fixed, but their lifecycle remains
live: aborting the signal or releasing the subscription is supported.

## Properties

### cursor?

```ts
optional cursor: CursorExpressions;
```

Defined in: [packages/db/src/types.ts:324](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L324)

Cursor expressions for cursor-based pagination.
These are separate from `where` - the sync layer should combine them if using cursor-based pagination.
Neither expression includes the main `where` clause.

***

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:318](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L318)

The limit of the data to load

***

### offset?

```ts
optional offset: number;
```

Defined in: [packages/db/src/types.ts:329](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L329)

Row offset for offset-based pagination.
The sync layer can use this instead of `cursor` if it prefers offset-based pagination.

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:316](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L316)

The order by clause to sort the data

***

### signal?

```ts
optional signal: AbortSignal;
```

Defined in: [packages/db/src/types.ts:337](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L337)

Aborted when this exact subset request is no longer current. Cancellation
is cooperative: async adapters should stop before installing more
request-scoped rows. If an in-flight baseline cannot be canceled, the
returned load promise must settle after those writes become visible so
core can keep overlapping replay private until then.

***

### subscription?

```ts
optional subscription: Subscription;
```

Defined in: [packages/db/src/types.ts:346](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L346)

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

Defined in: [packages/db/src/types.ts:314](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L314)

The where expression to filter the data (does NOT include cursor expressions)
