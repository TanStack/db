---
id: SubscribeChangesSnapshotOptions
title: SubscribeChangesSnapshotOptions
---

# Interface: SubscribeChangesSnapshotOptions\<T, TKey\>

Defined in: [packages/db/src/types.ts:941](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L941)

## Extends

- `Omit`\<[`SubscribeChangesOptions`](SubscribeChangesOptions.md)\<`T`, `TKey`\>, `"includeInitialState"`\>

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:946](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L946)

**`Internal`**

Optional limit to include in loadSubset for query-specific cache keys.

#### Overrides

[`SubscribeChangesOptions`](SubscribeChangesOptions.md).[`limit`](SubscribeChangesOptions.md#limit)

***

### onLoadSubsetError()?

```ts
optional onLoadSubsetError: (event) => void;
```

Defined in: [packages/db/src/types.ts:938](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L938)

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

Defined in: [packages/db/src/types.ts:936](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L936)

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

Defined in: [packages/db/src/types.ts:920](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L920)

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

Defined in: [packages/db/src/types.ts:945](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L945)

**`Internal`**

Optional orderBy to include in loadSubset for query-specific cache keys.

#### Overrides

[`SubscribeChangesOptions`](SubscribeChangesOptions.md).[`orderBy`](SubscribeChangesOptions.md#orderby)

***

### where()?

```ts
optional where: (row) => any;
```

Defined in: [packages/db/src/types.ts:912](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L912)

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

#### Inherited from

```ts
Omit.where
```

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:914](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L914)

Pre-compiled expression for filtering changes

#### Inherited from

[`SubscribeChangesOptions`](SubscribeChangesOptions.md).[`whereExpression`](SubscribeChangesOptions.md#whereexpression)
