---
id: SubscribeChangesOptions
title: SubscribeChangesOptions
---

Defined in: [packages/db/src/types.ts:1073](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1073)

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

Defined in: [packages/db/src/types.ts:1104](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1104)

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

Defined in: [packages/db/src/types.ts:1078](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1078)

Whether to include the current state as initial changes

***

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:1120](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1120)

**`Internal`**

Optional limit to include in loadSubset for query-specific cache keys.

***

### onLoadSubsetError()?

```ts
optional onLoadSubsetError: (event) => void;
```

Defined in: [packages/db/src/types.ts:1128](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1128)

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

Defined in: [packages/db/src/types.ts:1126](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1126)

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

Defined in: [packages/db/src/types.ts:1110](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1110)

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

Defined in: [packages/db/src/types.ts:1115](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1115)

**`Internal`**

Optional orderBy to include in loadSubset for query-specific cache keys.

***

### truncateReplayPublication?

```ts
optional truncateReplayPublication: object;
```

Defined in: [packages/db/src/types.ts:1130](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1130)

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

Defined in: [packages/db/src/types.ts:1093](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1093)

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

Defined in: [packages/db/src/types.ts:1095](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1095)

Pre-compiled expression for filtering changes
