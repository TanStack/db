---
id: SubscribeChangesOptions
title: SubscribeChangesOptions
---

# Interface: SubscribeChangesOptions\<T, TKey\>

Defined in: [packages/db/src/types.ts:822](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L822)

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

Defined in: [packages/db/src/types.ts:827](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L827)

Whether to include the current state as initial changes

***

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:860](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L860)

**`Internal`**

Optional limit to include in loadSubset for query-specific cache keys.

***

### onLoadSubsetResult()?

```ts
optional onLoadSubsetResult: (result) => void;
```

Defined in: [packages/db/src/types.ts:866](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L866)

**`Internal`**

Callback that receives the loadSubset result (Promise or true) from requestSnapshot.
Allows the caller to directly track the loading promise for isReady status.

#### Parameters

##### result

`true` | `Promise`\<`void`\>

#### Returns

`void`

***

### onStatusChange()?

```ts
optional onStatusChange: (event) => void;
```

Defined in: [packages/db/src/types.ts:850](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L850)

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

Defined in: [packages/db/src/types.ts:855](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L855)

**`Internal`**

Optional orderBy to include in loadSubset for query-specific cache keys.

***

### where()?

```ts
optional where: (row) => any;
```

Defined in: [packages/db/src/types.ts:842](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L842)

Callback function for filtering changes using a row proxy.
The callback receives a proxy object that records property access,
allowing you to use query builder functions like `eq`, `gt`, etc.

#### Parameters

##### row

`SingleRowRefProxy`\<[`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`T`, `TKey`\>\>

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

Defined in: [packages/db/src/types.ts:844](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L844)

Pre-compiled expression for filtering changes
