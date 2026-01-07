---
id: SubscribeChangesSnapshotOptions
title: SubscribeChangesSnapshotOptions
---

# Interface: SubscribeChangesSnapshotOptions\<T\>

Defined in: [packages/db/src/types.ts:803](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L803)

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

Defined in: [packages/db/src/types.ts:807](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L807)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:806](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L806)

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

#### Inherited from

```ts
Omit.where
```

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:800](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L800)

Pre-compiled expression for filtering changes

#### Inherited from

[`SubscribeChangesOptions`](SubscribeChangesOptions.md).[`whereExpression`](SubscribeChangesOptions.md#whereexpression)
