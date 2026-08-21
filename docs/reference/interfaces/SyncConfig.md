---
id: SyncConfig
title: SyncConfig
---

# Interface: SyncConfig\<T, TKey\>

Defined in: [packages/db/src/types.ts:333](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L333)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### exportSyncMeta()?

```ts
optional exportSyncMeta: () => unknown;
```

Defined in: [packages/db/src/types.ts:368](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L368)

Export adapter-specific metadata that lets hydration/persistence resume sync.
The payload shape is owned by the adapter.

#### Returns

`unknown`

***

### getSyncMetadata()?

```ts
optional getSyncMetadata: () => Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:362](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L362)

Get the sync metadata for insert operations

#### Returns

`Record`\<`string`, `unknown`\>

Record containing relation information

***

### importSyncMeta()?

```ts
optional importSyncMeta: (meta) => void;
```

Defined in: [packages/db/src/types.ts:373](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L373)

Import adapter-specific metadata produced by exportSyncMeta.

#### Parameters

##### meta

`unknown`

#### Returns

`void`

***

### mergeSyncMeta()?

```ts
optional mergeSyncMeta: (current, incoming) => unknown;
```

Defined in: [packages/db/src/types.ts:378](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L378)

Merge two adapter-specific metadata payloads during hydration.

#### Parameters

##### current

`unknown`

##### incoming

`unknown`

#### Returns

`unknown`

***

### rowUpdateMode?

```ts
optional rowUpdateMode: "full" | "partial";
```

Defined in: [packages/db/src/types.ts:387](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L387)

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

Defined in: [packages/db/src/types.ts:337](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L337)

#### Parameters

##### params

###### begin

(`options?`) => `void`

Begin a new sync transaction.

###### collection

[`Collection`](Collection.md)\<`T`, `TKey`, `any`, `any`, `any`\>

###### commit

() => `void`

###### markError

(`error?`) => `void`

Signal that initial sync failed before producing a usable snapshot.
When supplied, `error` is preserved as the rejection reason from `preload()`.

###### markReady

() => `void`

Signal that a usable initial or recovered snapshot is available.

###### metadata?

[`SyncMetadataApi`](SyncMetadataApi.md)\<`TKey`\>

###### truncate

() => `void`

###### write

(`message`) => `void`

#### Returns

  \| `void`
  \| [`CleanupFn`](../type-aliases/CleanupFn.md)
  \| [`SyncConfigRes`](../type-aliases/SyncConfigRes.md)
