---
id: LoadSubsetOptions
title: LoadSubsetOptions
---

# Type Alias: LoadSubsetOptions

```ts
type LoadSubsetOptions = object;
```

Defined in: [packages/db/src/types.ts:256](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L256)

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:262](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L262)

The limit of the data to load

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:260](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L260)

The order by clause to sort the data

***

### subscription?

```ts
optional subscription: Subscription;
```

Defined in: [packages/db/src/types.ts:271](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L271)

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

Defined in: [packages/db/src/types.ts:258](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L258)

The where expression to filter the data
