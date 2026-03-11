---
id: SubscribeChangesSnapshotOptions
title: SubscribeChangesSnapshotOptions
---

# Interface: SubscribeChangesSnapshotOptions\<T\>

Defined in: [packages/db/src/types.ts:830](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L830)

## Extends

- `Omit`\<[`SubscribeChangesOptions`](SubscribeChangesOptions.md)\<`T`\>, `"includeInitialState"`\>

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:834](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L834)

**`Internal`**

Optional limit to include in loadSubset for query-specific cache keys.

#### Overrides

```ts
Omit.limit
```

***

### onLoadSubsetResult()?

```ts
optional onLoadSubsetResult: (result) => void;
```

Defined in: [packages/db/src/types.ts:827](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L827)

**`Internal`**

Callback that receives the loadSubset result (Promise or true) from requestSnapshot.
Allows the caller to directly track the loading promise for isReady status.

#### Parameters

##### result

`true` | `Promise`\<`void`\>

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

Defined in: [packages/db/src/types.ts:811](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L811)

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

Defined in: [packages/db/src/types.ts:833](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L833)

**`Internal`**

Optional orderBy to include in loadSubset for query-specific cache keys.

#### Overrides

```ts
Omit.orderBy
```

***

### where()?

```ts
optional where: (row) => any;
```

Defined in: [packages/db/src/types.ts:803](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L803)

Callback function for filtering changes using a row proxy.
The callback receives a proxy object that records property access,
allowing you to use query builder functions like `eq`, `gt`, etc.

#### Parameters

##### row

`SingleRowRefProxy`\<`T`\>

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

Defined in: [packages/db/src/types.ts:805](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L805)

Pre-compiled expression for filtering changes

#### Inherited from

```ts
Omit.whereExpression
```
