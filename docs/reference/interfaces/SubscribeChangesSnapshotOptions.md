---
id: SubscribeChangesSnapshotOptions
title: SubscribeChangesSnapshotOptions
---

Defined in: [packages/db/src/types.ts:1273](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1273)

## Extends

- `Omit`\<[`SubscribeChangesOptions`](SubscribeChangesOptions.md)\<`T`, `TKey`\>, `"includeInitialState"`\>

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

Defined in: [packages/db/src/types.ts:1233](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1233)

**`Internal`**

Whether this subscription defers provider work. It keeps the Collection
alive and reads its local rows, but starts no idle source sync run and no
acquisition attempt until `subscription.resumeDeferredAcquisition()`. A
live-query Collection defers its source subscriptions until it has a
subscriber or a preload in its current sync run.

#### Inherited from

[`SubscribeChangesOptions`](SubscribeChangesOptions.md).[`deferAcquisition`](SubscribeChangesOptions.md#deferacquisition)

***

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:1278](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1278)

**`Internal`**

Optional limit to include in loadSubset for query-specific cache keys.

#### Overrides

[`SubscribeChangesOptions`](SubscribeChangesOptions.md).[`limit`](SubscribeChangesOptions.md#limit)

***

### onLoadSubsetError()?

```ts
optional onLoadSubsetError: (event) => void;
```

Defined in: [packages/db/src/types.ts:1263](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1263)

**`Internal`**

Receives subset-load failures scoped to this subscription.

#### Parameters

##### event

[`SubscriptionLoadSubsetErrorEvent`](SubscriptionLoadSubsetErrorEvent.md)

#### Returns

`void`

#### Inherited from

```ts
Omit.onLoadSubsetError
```

***

### onLoadSubsetResult()?

```ts
optional onLoadSubsetResult: (result) => void;
```

Defined in: [packages/db/src/types.ts:1261](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1261)

**`Internal`**

Callback that receives the loadSubset result (Promise or true) from requestSnapshot.
Allows the caller to directly track the loading promise for isReady status.

#### Parameters

##### result

[`LoadSubsetRequestResult`](../type-aliases/LoadSubsetRequestResult.md)

#### Returns

`void`

#### Inherited from

```ts
Omit.onLoadSubsetResult
```

***

### onStatusChange()?

```ts
optional onStatusChange: (event) => void;
```

Defined in: [packages/db/src/types.ts:1245](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1245)

**`Internal`**

Listener for subscription status changes.
Registered BEFORE any snapshot is requested, ensuring no status transitions are missed.

#### Parameters

##### event

[`SubscriptionStatusChangeEvent`](SubscriptionStatusChangeEvent.md)

#### Returns

`void`

#### Inherited from

```ts
Omit.onStatusChange
```

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:1277](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1277)

**`Internal`**

Optional orderBy to include in loadSubset for query-specific cache keys.

#### Overrides

[`SubscribeChangesOptions`](SubscribeChangesOptions.md).[`orderBy`](SubscribeChangesOptions.md#orderby)

***

### owner?

```ts
optional owner: CollectionDependent;
```

Defined in: [packages/db/src/types.ts:1239](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1239)

**`Internal`**

The live query or Effect this subscription reads for, so
`collection.subscribers` can name it.

#### Inherited from

[`SubscribeChangesOptions`](SubscribeChangesOptions.md).[`owner`](SubscribeChangesOptions.md#owner)

***

### truncateReplayPublication?

```ts
optional truncateReplayPublication: object;
```

Defined in: [packages/db/src/types.ts:1265](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1265)

**`Internal`**

Lets a live-query graph retain its last publication during replay.

#### fail()?

```ts
readonly optional fail: (error) => void;
```

The replay could not load every active demand again.

##### Parameters

###### error

`Error`

##### Returns

`void`

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

#### Inherited from

```ts
Omit.truncateReplayPublication
```

***

### where()?

```ts
optional where: (row) => any;
```

Defined in: [packages/db/src/types.ts:1222](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1222)

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

#### Inherited from

```ts
Omit.where
```

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:1224](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1224)

Pre-compiled expression for filtering changes

#### Inherited from

[`SubscribeChangesOptions`](SubscribeChangesOptions.md).[`whereExpression`](SubscribeChangesOptions.md#whereexpression)
