---
id: SubscribeChangesOptions
title: SubscribeChangesOptions
---

Defined in: [packages/db/src/types.ts:1067](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1067)

Options for subscribing to collection changes

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### includeInitialState?

```ts
optional includeInitialState: boolean;
```

Defined in: [packages/db/src/types.ts:1072](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1072)

Whether to include the current state as initial changes

***

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:1105](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1105)

**`Internal`**

Optional limit to include in loadSubset for query-specific cache keys.

***

### onLoadSubsetError()?

```ts
optional onLoadSubsetError: (event) => void;
```

Defined in: [packages/db/src/types.ts:1113](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1113)

**`Internal`**

Receives subset-load failures scoped to this subscription.

#### Parameters

##### event

[`SubscriptionLoadSubsetErrorEvent`](SubscriptionLoadSubsetErrorEvent.md)

#### Returns

`void`

***

### onLoadSubsetResult()?

```ts
optional onLoadSubsetResult: (result) => void;
```

Defined in: [packages/db/src/types.ts:1111](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1111)

**`Internal`**

Callback that receives the loadSubset result (Promise or true) from requestSnapshot.
Allows the caller to directly track the loading promise for isReady status.

#### Parameters

##### result

[`LoadSubsetRequestResult`](../type-aliases/LoadSubsetRequestResult.md)

#### Returns

`void`

***

### onStatusChange()?

```ts
optional onStatusChange: (event) => void;
```

Defined in: [packages/db/src/types.ts:1095](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1095)

**`Internal`**

Listener for subscription status changes.
Registered BEFORE any snapshot is requested, ensuring no status transitions are missed.

#### Parameters

##### event

[`SubscriptionStatusChangeEvent`](SubscriptionStatusChangeEvent.md)

#### Returns

`void`

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:1100](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1100)

**`Internal`**

Optional orderBy to include in loadSubset for query-specific cache keys.

***

### truncateReplayPublication?

```ts
optional truncateReplayPublication: object;
```

Defined in: [packages/db/src/types.ts:1115](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1115)

**`Internal`**

Lets a live-query graph retain its last publication during replay.

#### start()

```ts
readonly start: () => void;
```

##### Returns

`void`

#### succeed()

```ts
readonly succeed: () => void;
```

##### Returns

`void`

***

### where()?

```ts
optional where: (row) => any;
```

Defined in: [packages/db/src/types.ts:1087](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1087)

Callback function for filtering changes using a row proxy.
The callback receives a proxy object that records property access,
allowing you to use query builder functions like `eq`, `gt`, etc.

#### Parameters

##### row

`SingleRowRefProxy`\<[`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`T`, `TKey`\>, `TKey`, `true`\>

#### Returns

`any`

#### Example

```ts
import { eq } from "@tanstack/db"

collection.subscribeChanges(callback, {
  where: (row) => eq(row.status, "active")
})
```

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:1089](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1089)

Pre-compiled expression for filtering changes
