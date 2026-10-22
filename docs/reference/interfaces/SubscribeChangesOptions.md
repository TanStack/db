---
id: SubscribeChangesOptions
title: SubscribeChangesOptions
---

Defined in: [packages/db/src/types.ts:1116](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1116)

Options for subscribing to collection changes

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### deferAcquisition?

```ts
optional deferAcquisition: boolean;
```

Defined in: [packages/db/src/types.ts:1147](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1147)

**`Internal`**

Whether this subscription defers provider work. It keeps the Collection
alive and reads its local rows, but starts no idle source sync run and no
acquisition attempt until `subscription.resumeDeferredAcquisition()`. A
live-query Collection defers its source subscriptions until it has a
subscriber or a preload in its current sync run.

***

### includeInitialState?

```ts
optional includeInitialState: boolean;
```

Defined in: [packages/db/src/types.ts:1121](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1121)

Whether to include the current state as initial changes

***

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:1163](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1163)

**`Internal`**

Optional limit to include in loadSubset for query-specific cache keys.

***

### onLoadSubsetError()?

```ts
optional onLoadSubsetError: (event) => void;
```

Defined in: [packages/db/src/types.ts:1171](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1171)

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

Defined in: [packages/db/src/types.ts:1169](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1169)

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

Defined in: [packages/db/src/types.ts:1153](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1153)

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

Defined in: [packages/db/src/types.ts:1158](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1158)

**`Internal`**

Optional orderBy to include in loadSubset for query-specific cache keys.

***

### truncateReplayPublication?

```ts
optional truncateReplayPublication: object;
```

Defined in: [packages/db/src/types.ts:1173](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1173)

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

Defined in: [packages/db/src/types.ts:1136](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1136)

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

Defined in: [packages/db/src/types.ts:1138](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1138)

Pre-compiled expression for filtering changes
