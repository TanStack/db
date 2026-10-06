---
id: SyncConfig
title: SyncConfig
---

Defined in: [packages/db/src/types.ts:419](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L419)

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

Defined in: [packages/db/src/types.ts:460](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L460)

Export adapter-specific metadata that lets hydration/persistence resume sync.
The payload shape is owned by the adapter.

#### Returns

`unknown`

***

### getSyncMetadata()?

```ts
optional getSyncMetadata: () => Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:454](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L454)

Get the sync metadata for insert operations

#### Returns

`Record`\<`string`, `unknown`\>

Record containing relation information

***

### importSyncMeta()?

```ts
optional importSyncMeta: (meta) => void;
```

Defined in: [packages/db/src/types.ts:465](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L465)

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

Defined in: [packages/db/src/types.ts:470](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L470)

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

Defined in: [packages/db/src/types.ts:479](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L479)

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

Defined in: [packages/db/src/types.ts:423](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L423)

#### Parameters

##### params

###### begin

() => `void`

Begin a new sync transaction.

###### collection

[`Collection`](Collection.md)\<`T`, `TKey`, `any`, `any`, `any`\>

###### commit

(`signal?`) => [`SyncAppliedReceipt`](../type-aliases/SyncAppliedReceipt.md)

Commit the active sync transaction in FIFO order. Core accepts it at
once, and an accepted transaction always applies. Returns `true` when
its writes are visible, or a receipt that resolves when they become
visible. While an optimistic transaction is persisting, it becomes
visible when that transaction settles, together with the drop of its
optimistic state. A signal that is already aborted abandons the
transaction before acceptance, and the receipt rejects with an error
named `AbortError`. Aborting after acceptance has no effect.

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

`truncate({ markReady: false })` replaces synced rows without changing Collection
status. Omitting the option preserves the default behavior of marking the
Collection ready. The last truncate in one transaction supplies its readiness
intent; the last replacement in one published batch supplies that batch's intent.

(options?: { markReady?: boolean }) => `void`

###### write

(`message`) => `void`

#### Returns

  \| `void`
  \| [`CleanupFn`](../type-aliases/CleanupFn.md)
  \| [`SyncConfigRes`](../type-aliases/SyncConfigRes.md)
