---
id: SyncConfig
title: SyncConfig
---

Defined in: [packages/db/src/types.ts:446](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L446)

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

Defined in: [packages/db/src/types.ts:532](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L532)

Export adapter-specific metadata that lets hydration/persistence resume sync.
The payload shape is owned by the adapter.

#### Returns

`unknown`

***

### getSyncMetadata()?

```ts
optional getSyncMetadata: () => Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:526](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L526)

Get the sync metadata for insert operations

#### Returns

`Record`\<`string`, `unknown`\>

Record containing relation information

***

### importSyncMeta()?

```ts
optional importSyncMeta: (meta) => void;
```

Defined in: [packages/db/src/types.ts:537](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L537)

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

Defined in: [packages/db/src/types.ts:542](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L542)

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

Defined in: [packages/db/src/types.ts:551](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L551)

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

Defined in: [packages/db/src/types.ts:450](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L450)

#### Parameters

##### params

###### begin

(`options?`) => `void`

Begin a new sync transaction. Its writes apply on the rows the
Collection holds, also during a reload. `snapshot: true` declares that
the transaction carries every row: its commit replaces every synced
row, as `truncate({ markReady: false })` at its start does. A reload's
new run replaces the kept rows only with a snapshot or `truncate()`.

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

###### fail

(`error`) => `void`

The sync adapter stopped. Before the first ready the status becomes
`error` and `preload()` rejects with `error`. After it, the rows stay, the
status stays `ready`, and the node's `error` holds the cause until a
reload. A second `fail()` in the same sync run does nothing.
While the sync adapter retries, call nothing or `reportError()`.

###### invalidateLoadedSubsets

() => `void`

Report that rows this adapter serves for loaded subsets may have shifted
between served pages, after a refetch that the adapter started on its
own has applied. Each ordered live query then re-establishes its window
with a bounded repair from the start of its order. Calls in one turn are
coalesced. Do not call it for results that answer a `loadSubset` call.

###### markReady

() => `void`

Signal that the sync run's initial data is available. During a reload
it completes the reload and keeps the rows unless a snapshot replaced
them. A second call in the run, or one after `fail()`, does nothing.

###### metadata?

[`SyncMetadataApi`](SyncMetadataApi.md)\<`TKey`\>

###### reportError

(`error`) => `void`

Report a problem after the first ready while the sync adapter keeps
trying. It shows as the node's `failureReason` and adds a failure to its
`errors`; the status and rows do not change. One error value is one
failure: reporting a value already listed changes nothing, and that
failure keeps its place and its `at`. Throws before the first ready and
after `fail()`.

###### reportHealthy

(`error?`) => `void`

Sync works again. With no `error`, clears the `failureReason`. With an
`error`, removes only the failure whose cause is that value, for
example one of several requests that recovered; the `failureReason`
then shows the newest failure left, and clears once none is left. With
nothing to clear or remove it does nothing, so it can follow every
commit. Throws before the first ready and after `fail()`.

###### truncate

(`options?`) => `void`

Replace the synced rows. By default the replacement also marks the
Collection ready. Set markReady:false to publish without changing status,
for example when confirming a committed write from a closed source.
The last truncate in a transaction supplies its readiness intent.

###### write

(`message`) => `void`

#### Returns

  \| `void`
  \| [`CleanupFn`](../type-aliases/CleanupFn.md)
  \| [`SyncConfigRes`](../type-aliases/SyncConfigRes.md)
