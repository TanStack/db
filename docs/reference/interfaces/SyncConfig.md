---
id: SyncConfig
title: SyncConfig
---

# Interface: SyncConfig\<T, TKey\>

Defined in: [packages/db/src/types.ts:325](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L325)

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

Defined in: [packages/db/src/types.ts:342](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L342)

Get the sync metadata for insert operations

#### Returns

`Record`\<`string`, `unknown`\>

Record containing relation information

***

### rowUpdateMode?

```ts
optional rowUpdateMode: "full" | "partial";
```

Defined in: [packages/db/src/types.ts:351](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L351)

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

Defined in: [packages/db/src/types.ts:329](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L329)

#### Parameters

##### params

###### begin

() => `void`

###### collection

[`Collection`](Collection.md)\<`T`, `TKey`, `any`, `any`, `any`\>

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
  \| [`CleanupFn`](../type-aliases/CleanupFn.md)
  \| [`SyncConfigRes`](../type-aliases/SyncConfigRes.md)
