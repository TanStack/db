---
id: SubscribeChangesOptions
title: SubscribeChangesOptions
---

# Interface: SubscribeChangesOptions\<T\>

Defined in: [packages/db/src/types.ts:779](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L779)

Options for subscribing to collection changes

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

## Properties

### includeInitialState?

```ts
optional includeInitialState: boolean;
```

Defined in: [packages/db/src/types.ts:783](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L783)

Whether to include the current state as initial changes

***

### onStatusChange()?

```ts
optional onStatusChange: (event) => void;
```

Defined in: [packages/db/src/types.ts:806](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L806)

**`Internal`**

Listener for subscription status changes.
Registered BEFORE any snapshot is requested, ensuring no status transitions are missed.

#### Parameters

##### event

[`SubscriptionStatusChangeEvent`](SubscriptionStatusChangeEvent.md)

#### Returns

`void`

***

### where()?

```ts
optional where: (row) => any;
```

Defined in: [packages/db/src/types.ts:798](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L798)

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

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:800](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L800)

Pre-compiled expression for filtering changes
