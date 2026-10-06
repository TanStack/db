---
id: SyncConfig
title: SyncConfig
---

Defined in: [packages/db/src/types.ts:422](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L422)

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

Defined in: [packages/db/src/types.ts:470](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L470)

Export adapter-specific metadata that lets hydration/persistence resume sync.
The payload shape is owned by the adapter.

#### Returns

`unknown`

***

### getSyncMetadata()?

```ts
optional getSyncMetadata: () => Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:464](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L464)

Get the sync metadata for insert operations

#### Returns

`Record`\<`string`, `unknown`\>

Record containing relation information

***

### importSyncMeta()?

```ts
optional importSyncMeta: (meta) => void;
```

Defined in: [packages/db/src/types.ts:475](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L475)

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

Defined in: [packages/db/src/types.ts:480](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L480)

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

Defined in: [packages/db/src/types.ts:489](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L489)

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

Defined in: [packages/db/src/types.ts:426](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L426)

#### Parameters

##### params

###### begin

(`options?`) => `void`

Begin a new sync transaction.

###### collection

[`Collection`](Collection.md)\<`T`, `TKey`, `any`, `any`, `any`\>

###### commit

(`signal?`) => [`SyncAppliedReceipt`](../type-aliases/SyncAppliedReceipt.md)

Commit the active sync transaction in FIFO order.
Returns `true` when the writes and events are already visible. Otherwise
returns a receipt that resolves after they become visible. If collection
cleanup or an optional request abort abandons the transaction first, the
receipt rejects with an error named `AbortError`. If cancellation of an
earlier transaction invalidates this transaction's insert admission, the
receipt rejects with `DuplicateKeySyncError`.
If cancellation removes a row required by this transaction's partial
update, its receipt rejects with an error named `AbortError`.
Pass a signal only for request-scoped work that must not publish after
cancellation. Aborting after application has no effect.

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
