---
id: SyncConfig
title: SyncConfig
---

# Interface: SyncConfig\<T, TKey\>

Defined in: [packages/db/src/types.ts:263](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L263)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### getSyncMetadata()?

```ts
optional getSyncMetadata: () => Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:280](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L280)

Get the sync metadata for insert operations

#### Returns

`Record`\<`string`, `unknown`\>

Record containing relation information

***

### rowUpdateMode?

```ts
optional rowUpdateMode: "full" | "partial";
```

Defined in: [packages/db/src/types.ts:289](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L289)

The row update mode used to sync to the collection.

#### Default

`partial`

#### Description

- `partial`: Updates contain only the changes to the row.
- `full`: Updates contain the entire row.

***

### sync()

```ts
sync: (params) => 
  | void
  | CleanupFn
  | SyncConfigRes;
```

Defined in: [packages/db/src/types.ts:267](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L267)

#### Parameters

##### params

###### begin

() => `void`

###### collection

[`Collection`](../Collection.md)\<`T`, `TKey`, `any`, `any`, `any`\>

###### commit

() => `void`

###### markReady

() => `void`

###### truncate

() => `void`

###### write

(`message`) => `void`

#### Returns

  \| `void`
  \| [`CleanupFn`](../../type-aliases/CleanupFn.md)
  \| [`SyncConfigRes`](../../type-aliases/SyncConfigRes.md)
