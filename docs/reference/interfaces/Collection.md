---
id: Collection
title: Collection
---

Defined in: [packages/db/src/collection/index.ts:154](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L154)

Enhanced Collection interface that includes both data type T and utilities TUtils

## Extends

- [`CollectionImpl`](../classes/CollectionImpl.md)\<`T`, `TKey`, `TUtils`, `TSchema`, `TInsertInput`\>

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

The type of items in the collection

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

The type of the key for the collection

### TUtils

`TUtils` *extends* [`UtilsRecord`](../type-aliases/UtilsRecord.md) = [`UtilsRecord`](../type-aliases/UtilsRecord.md)

The utilities record type

### TSchema

`TSchema` *extends* `StandardSchemaV1` = `StandardSchemaV1`

### TInsertInput

`TInsertInput` *extends* `object` = `T`

The type for insert operations (can be different from T for schemas with defaults)

## Properties

### \_lifecycle

```ts
_lifecycle: CollectionLifecycleManager<T, TKey, TSchema, TInsertInput>;
```

Defined in: [packages/db/src/collection/index.ts:417](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L417)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_lifecycle`](../classes/CollectionImpl.md#_lifecycle)

***

### \_state

```ts
_state: CollectionStateManager<T, TKey, TSchema, TInsertInput>;
```

Defined in: [packages/db/src/collection/index.ts:429](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L429)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_state`](../classes/CollectionImpl.md#_state)

***

### \_sync

```ts
_sync: CollectionSyncManager<T, TKey, TSchema, TInsertInput>;
```

Defined in: [packages/db/src/collection/index.ts:418](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L418)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_sync`](../classes/CollectionImpl.md#_sync)

***

### config

```ts
config: CollectionConfig<T, TKey, TSchema, TUtils>;
```

Defined in: [packages/db/src/collection/index.ts:408](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L408)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`config`](../classes/CollectionImpl.md#config)

***

### deferDataRefresh

```ts
deferDataRefresh: Promise<void> | null = null;
```

Defined in: [packages/db/src/collection/index.ts:436](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L436)

When set, collection consumers should defer processing incoming data
refreshes until this promise resolves. This prevents stale data from
overwriting optimistic state while pending writes are being applied.

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`deferDataRefresh`](../classes/CollectionImpl.md#deferdatarefresh)

***

### id

```ts
id: string;
```

Defined in: [packages/db/src/collection/index.ts:407](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L407)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`id`](../classes/CollectionImpl.md#id)

***

### singleResult?

```ts
readonly optional singleResult: true;
```

Defined in: [packages/db/src/collection/index.ts:162](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L162)

***

### utils

```ts
readonly utils: TUtils;
```

Defined in: [packages/db/src/collection/index.ts:161](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L161)

#### Overrides

[`CollectionImpl`](../classes/CollectionImpl.md).[`utils`](../classes/CollectionImpl.md#utils)

## Accessors

### \_layoutRevision

#### Get Signature

```ts
get _layoutRevision(): number;
```

Defined in: [packages/db/src/collection/index.ts:599](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L599)

Monotonic revision of explicit layout-only publications.
Internal — used to distinguish them from empty ready events.

##### Returns

`number`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_layoutRevision`](../classes/CollectionImpl.md#_layoutrevision)

***

### \_stateRevision

#### Get Signature

```ts
get _stateRevision(): number;
```

Defined in: [packages/db/src/collection/index.ts:591](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L591)

Monotonic revision of the collection's visible state; advances once per
committed batch of changes and cleanup, even while nothing is subscribed.
Internal — used by the live-query observer's snapshot cache.

##### Returns

`number`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_stateRevision`](../classes/CollectionImpl.md#_staterevision)

***

### base

#### Get Signature

```ts
get base(): CollectionBase<TKey, TOutput>;
```

Defined in: [packages/db/src/collection/index.ts:739](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L739)

The exposed authoritative base rows, before optimistic writes are applied.
Queued sync writes are excluded. Reading does not start sync.
Do not mutate the backing map or its rows: that bypasses publication.

##### Returns

[`CollectionBase`](../type-aliases/CollectionBase.md)\<`TKey`, `TOutput`\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`base`](../classes/CollectionImpl.md#base)

***

### compareOptions

#### Get Signature

```ts
get compareOptions(): StringCollationConfig;
```

Defined in: [packages/db/src/collection/index.ts:939](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L939)

##### Returns

[`StringCollationConfig`](../type-aliases/StringCollationConfig.md)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`compareOptions`](../classes/CollectionImpl.md#compareoptions)

***

### health

#### Get Signature

```ts
get health(): HealthNode;
```

Defined in: [packages/db/src/collection/index.ts:569](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L569)

The health tree for this Collection and every Collection it depends on.
A base Collection's tree is one node. It always has the same shape for a
given query, so apps can parse it. After the first ready, sync problems
appear here and the rows stay.

##### Returns

[`HealthNode`](HealthNode.md)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`health`](../classes/CollectionImpl.md#health)

***

### indexes

#### Get Signature

```ts
get indexes(): Map<number, BaseIndex<TKey>>;
```

Defined in: [packages/db/src/collection/index.ts:924](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L924)

Get resolved indexes for query optimization

##### Returns

`Map`\<`number`, [`BaseIndex`](../classes/BaseIndex.md)\<`TKey`\>\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`indexes`](../classes/CollectionImpl.md#indexes)

***

### isLoadingSubset

#### Get Signature

```ts
get isLoadingSubset(): boolean;
```

Defined in: [packages/db/src/collection/index.ts:657](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L657)

Check if the collection is currently loading more data

##### Returns

`boolean`

true if the collection has pending load more operations, false otherwise

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`isLoadingSubset`](../classes/CollectionImpl.md#isloadingsubset)

***

### size

#### Get Signature

```ts
get size(): number;
```

Defined in: [packages/db/src/collection/index.ts:789](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L789)

Get the current size of the collection (cached)

##### Returns

`number`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`size`](../classes/CollectionImpl.md#size)

***

### state

#### Get Signature

```ts
get state(): Map<TKey, WithVirtualProps<TOutput, TKey>>;
```

Defined in: [packages/db/src/collection/index.ts:1116](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1116)

Gets the current state of the collection as a Map

##### Example

```ts
const itemsMap = collection.state
console.log(`Collection has ${itemsMap.size} items`)

for (const [key, item] of itemsMap) {
  console.log(`${key}: ${item.title}`)
}

// Check if specific item exists
if (itemsMap.has("todo-1")) {
  console.log("Todo 1 exists:", itemsMap.get("todo-1"))
}
```

##### Returns

`Map`\<`TKey`, [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`TOutput`, `TKey`\>\>

Map containing all items in the collection, with keys as identifiers

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`state`](../classes/CollectionImpl.md#state)

***

### status

#### Get Signature

```ts
get status(): CollectionStatus;
```

Defined in: [packages/db/src/collection/index.ts:559](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L559)

Gets the current status of the collection

##### Returns

[`CollectionStatus`](../type-aliases/CollectionStatus.md)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`status`](../classes/CollectionImpl.md#status)

***

### subscriberCount

#### Get Signature

```ts
get subscriberCount(): number;
```

Defined in: [packages/db/src/collection/index.ts:582](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L582)

Get the number of subscribers that ask for this collection's data. A live
query that has no subscriber or preload of its own does not count.

##### Returns

`number`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`subscriberCount`](../classes/CollectionImpl.md#subscribercount)

***

### subscribers

#### Get Signature

```ts
get subscribers(): readonly CollectionDependent[];
```

Defined in: [packages/db/src/collection/index.ts:1324](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1324)

Live queries, Effects, and direct subscriptions that read this
Collection. `cleanup()` refuses while a live query or Effect reads it.

##### Returns

readonly [`CollectionDependent`](CollectionDependent.md)[]

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`subscribers`](../classes/CollectionImpl.md#subscribers)

***

### toArray

#### Get Signature

```ts
get toArray(): WithVirtualProps<TOutput, TKey>[];
```

Defined in: [packages/db/src/collection/index.ts:1140](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1140)

Gets the current state of the collection as an Array

##### Returns

[`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`TOutput`, `TKey`\>[]

An Array containing all items in the collection

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`toArray`](../classes/CollectionImpl.md#toarray)

## Methods

### \_deferPublication()

```ts
_deferPublication(): PublicationDeferral;
```

Defined in: [packages/db/src/collection/index.ts:614](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L614)

Defer subscriber events until a coherent multi-Collection commit ends.

#### Returns

`PublicationDeferral`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_deferPublication`](../classes/CollectionImpl.md#_deferpublication)

***

### \_deferSyncStart()

```ts
_deferSyncStart(): boolean;
```

Defined in: [packages/db/src/collection/index.ts:686](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L686)

**`Internal`**

#### Returns

`boolean`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_deferSyncStart`](../classes/CollectionImpl.md#_defersyncstart)

***

### \_emitHealthChange()

```ts
_emitHealthChange(): void;
```

Defined in: [packages/db/src/collection/index.ts:574](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L574)

**`Internal`**

A Collection this one depends on changed its health tree.

#### Returns

`void`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_emitHealthChange`](../classes/CollectionImpl.md#_emithealthchange)

***

### \_hasHeldSyncTransaction()

```ts
_hasHeldSyncTransaction(): boolean;
```

Defined in: [packages/db/src/collection/index.ts:782](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L782)

Whether an accepted sync transaction is not yet visible.

#### Returns

`boolean`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_hasHeldSyncTransaction`](../classes/CollectionImpl.md#_hasheldsynctransaction)

***

### \_hasHydratedKey()

```ts
_hasHydratedKey(key): boolean;
```

Defined in: [packages/db/src/collection/index.ts:681](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L681)

**`Internal`**

#### Parameters

##### key

`TKey`

#### Returns

`boolean`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_hasHydratedKey`](../classes/CollectionImpl.md#_hashydratedkey)

***

### \_hasOptimisticOverlay()

```ts
_hasOptimisticOverlay(key): boolean;
```

Defined in: [packages/db/src/collection/index.ts:774](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L774)

Whether a local write obscures this key's authoritative source row.

#### Parameters

##### key

`TKey`

#### Returns

`boolean`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_hasOptimisticOverlay`](../classes/CollectionImpl.md#_hasoptimisticoverlay)

***

### \_hasSubscriberOrPreload()

```ts
_hasSubscriberOrPreload(): boolean;
```

Defined in: [packages/db/src/collection/index.ts:725](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L725)

**`Internal`**

Whether this Collection had a subscriber or a preload in this sync run.

#### Returns

`boolean`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_hasSubscriberOrPreload`](../classes/CollectionImpl.md#_hassubscriberorpreload)

***

### \_markLayoutChange()

```ts
_markLayoutChange(): void;
```

Defined in: [packages/db/src/collection/index.ts:609](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L609)

Mark the active sync transaction as layout-changing. Internal.

#### Returns

`void`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_markLayoutChange`](../classes/CollectionImpl.md#_marklayoutchange)

***

### \_markPreload()

```ts
_markPreload(): void;
```

Defined in: [packages/db/src/collection/index.ts:720](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L720)

**`Internal`**

Record a preload without starting one, for a caller whose data
request another promise answers, such as a DbClient stream for the same
query. The request still counts: deferred acquisition may now resume.

#### Returns

`void`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_markPreload`](../classes/CollectionImpl.md#_markpreload)

***

### \_onCleanupStart()

```ts
_onCleanupStart(callback): () => void;
```

Defined in: [packages/db/src/collection/index.ts:671](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L671)

**`Internal`**

Subscribe to the synchronous cleanup-start boundary.

#### Parameters

##### callback

() => `void`

#### Returns

```ts
(): void;
```

##### Returns

`void`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_onCleanupStart`](../classes/CollectionImpl.md#_oncleanupstart)

***

### \_onFirstSubscriberOrPreload()

```ts
_onFirstSubscriberOrPreload(listener): () => void;
```

Defined in: [packages/db/src/collection/index.ts:730](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L730)

**`Internal`**

Listen for the first subscriber or preload in this sync run.

#### Parameters

##### listener

() => `void`

#### Returns

```ts
(): void;
```

##### Returns

`void`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_onFirstSubscriberOrPreload`](../classes/CollectionImpl.md#_onfirstsubscriberorpreload)

***

### \_optimisticOverlaySize()

```ts
_optimisticOverlaySize(): number;
```

Defined in: [packages/db/src/collection/index.ts:767](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L767)

Maximum number of source rows whose visible projection a local write can hide.

#### Returns

`number`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_optimisticOverlaySize`](../classes/CollectionImpl.md#_optimisticoverlaysize)

***

### \_resumeSyncStart()

```ts
_resumeSyncStart(): void;
```

Defined in: [packages/db/src/collection/index.ts:691](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L691)

**`Internal`**

#### Returns

`void`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_resumeSyncStart`](../classes/CollectionImpl.md#_resumesyncstart)

***

### \_setTransactionScope()

```ts
_setTransactionScope(transactionScope): void;
```

Defined in: [packages/db/src/collection/index.ts:676](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L676)

**`Internal`**

#### Parameters

##### transactionScope

[`TransactionScope`](../classes/TransactionScope.md)

#### Returns

`void`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_setTransactionScope`](../classes/CollectionImpl.md#_settransactionscope)

***

### \_subscribeLayoutChanges()

```ts
_subscribeLayoutChanges(listener): () => void;
```

Defined in: [packages/db/src/collection/index.ts:604](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L604)

Subscribe to layout-only publications. Internal observer channel.

#### Parameters

##### listener

() => `void`

#### Returns

```ts
(): void;
```

##### Returns

`void`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_subscribeLayoutChanges`](../classes/CollectionImpl.md#_subscribelayoutchanges)

***

### \_syncedRowMetadataKeysOutsideBase()

```ts
_syncedRowMetadataKeysOutsideBase(): TKey[];
```

Defined in: [packages/db/src/collection/index.ts:744](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L744)

**`Internal`**

Applied metadata keys without a source row.

#### Returns

`TKey`[]

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_syncedRowMetadataKeysOutsideBase`](../classes/CollectionImpl.md#_syncedrowmetadatakeysoutsidebase)

***

### \[iterator\]()

```ts
iterator: IterableIterator<[TKey, WithVirtualProps<T, TKey>]>;
```

Defined in: [packages/db/src/collection/index.ts:827](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L827)

Get all entries (virtual derived state)

#### Returns

`IterableIterator`\<\[`TKey`, [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`T`, `TKey`\>\]\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`[iterator]`](../classes/CollectionImpl.md#iterator)

***

### cleanup()

```ts
cleanup(options?): Promise<void>;
```

Defined in: [packages/db/src/collection/index.ts:1358](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1358)

Clean up the collection by stopping sync and clearing data
This can be called manually or automatically by garbage collection
Cleanup callbacks must not restart this collection or call its preload().
Wait until cleanup completes before starting a new sync run. If adapter
cleanup rejects, this promise rejects after the Collection reaches its
final cleaned-up state.

Rejects with `CollectionHasSubscribersError` while an active live query
(one that still has a subscriber) or an Effect reads this Collection,
because its readers would lose their data. A live query nothing reads
any more ends with this Collection's cleanup start. With
`{ dependents: true }`, it first cleans up each live query (and its own
dependents) and disposes each Effect. A direct subscription survives
cleanup and asks for data again when a new sync run starts.

#### Parameters

##### options?

###### dependents?

`boolean`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`cleanup`](../classes/CollectionImpl.md#cleanup)

***

### createIndex()

```ts
createIndex<TIndexType>(indexCallback, config): BaseIndex<TKey>;
```

Defined in: [packages/db/src/collection/index.ts:893](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L893)

Creates an index on a collection for faster queries.
Indexes significantly improve query performance by allowing constant time lookups
and logarithmic time range queries instead of full scans.

#### Type Parameters

##### TIndexType

`TIndexType` *extends* [`IndexConstructor`](../type-aliases/IndexConstructor.md)\<`TKey`\>

#### Parameters

##### indexCallback

(`row`) => `any`

Function that extracts the indexed value from each item

##### config

[`IndexOptions`](IndexOptions.md)\<`TIndexType`\> = `{}`

Configuration including index type and type-specific options

#### Returns

[`BaseIndex`](../classes/BaseIndex.md)\<`TKey`\>

The created index

#### Example

```ts
import { BasicIndex } from '@tanstack/db'

// Create an index with explicit type
const ageIndex = collection.createIndex((row) => row.age, {
  indexType: BasicIndex
})

// Create an index with collection's default type
const nameIndex = collection.createIndex((row) => row.name)
```

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`createIndex`](../classes/CollectionImpl.md#createindex)

***

### currentStateAsChanges()

```ts
currentStateAsChanges(options): 
  | void
  | ChangeMessage<WithVirtualProps<T, TKey>, TKey>[];
```

Defined in: [packages/db/src/collection/index.ts:1173](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1173)

Returns the current state of the collection as an array of changes

#### Parameters

##### options

[`CurrentStateAsChangesOptions`](CurrentStateAsChangesOptions.md) = `{}`

Options including optional where filter

#### Returns

  \| `void`
  \| [`ChangeMessage`](ChangeMessage.md)\<[`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`T`, `TKey`\>, `TKey`\>[]

An array of changes

#### Example

```ts
// Get all items as changes
const allChanges = collection.currentStateAsChanges()

// Get only items matching a condition
const activeChanges = collection.currentStateAsChanges({
  where: (row) => row.status === 'active'
})

// Get only items using a pre-compiled expression
const activeChanges = collection.currentStateAsChanges({
  whereExpression: eq(row.status, 'active')
})
```

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`currentStateAsChanges`](../classes/CollectionImpl.md#currentstateaschanges)

***

### delete()

```ts
delete(keys, config?): Transaction<any>;
```

Defined in: [packages/db/src/collection/index.ts:1093](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1093)

Deletes one or more items from the collection

#### Parameters

##### keys

Single key or array of keys to delete

`TKey` | `TKey`[]

##### config?

[`OperationConfig`](OperationConfig.md)

Optional configuration including metadata

#### Returns

[`Transaction`](Transaction.md)\<`any`\>

A Transaction object representing the delete operation(s)

#### Examples

```ts
// Delete a single item
const tx = collection.delete("todo-1")
await tx.when('settled')
```

```ts
// Delete multiple items
const tx = collection.delete(["todo-1", "todo-2"])
await tx.when('settled')
```

```ts
// Delete with metadata
const tx = collection.delete("todo-1", { metadata: { reason: "completed" } })
await tx.when('settled')
```

```ts
// Handle errors
try {
  const tx = collection.delete("item-1")
  await tx.when('settled')
  console.log('Delete successful')
} catch (error) {
  console.log('Delete failed:', error)
}
```

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`delete`](../classes/CollectionImpl.md#delete)

***

### entries()

```ts
entries(): IterableIterator<[TKey, WithVirtualProps<T, TKey>]>;
```

Defined in: [packages/db/src/collection/index.ts:815](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L815)

Get all entries (virtual derived state)

#### Returns

`IterableIterator`\<\[`TKey`, [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`T`, `TKey`\>\]\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`entries`](../classes/CollectionImpl.md#entries)

***

### forEach()

```ts
forEach(callbackfn): void;
```

Defined in: [packages/db/src/collection/index.ts:836](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L836)

Execute a callback for each entry in the collection

#### Parameters

##### callbackfn

(`value`, `key`, `index`) => `void`

#### Returns

`void`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`forEach`](../classes/CollectionImpl.md#foreach)

***

### get()

```ts
get(key): 
  | WithVirtualProps<T, TKey>
  | undefined;
```

Defined in: [packages/db/src/collection/index.ts:755](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L755)

Get the current value for a key (virtual derived state)

#### Parameters

##### key

`TKey`

#### Returns

  \| [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`T`, `TKey`\>
  \| `undefined`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`get`](../classes/CollectionImpl.md#get)

***

### getIndexMetadata()

```ts
getIndexMetadata(): CollectionIndexMetadata[];
```

Defined in: [packages/db/src/collection/index.ts:917](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L917)

Returns a snapshot of current index metadata sorted by indexId.
Persistence wrappers can use this to bootstrap index state if indexes were
created before event listeners were attached.

#### Returns

[`CollectionIndexMetadata`](CollectionIndexMetadata.md)[]

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`getIndexMetadata`](../classes/CollectionImpl.md#getindexmetadata)

***

### getKeyFromItem()

```ts
getKeyFromItem(item): TKey;
```

Defined in: [packages/db/src/collection/index.ts:867](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L867)

#### Parameters

##### item

`T`

#### Returns

`TKey`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`getKeyFromItem`](../classes/CollectionImpl.md#getkeyfromitem)

***

### has()

```ts
has(key): boolean;
```

Defined in: [packages/db/src/collection/index.ts:762](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L762)

Check if a key exists in the collection (virtual derived state)

#### Parameters

##### key

`TKey`

#### Returns

`boolean`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`has`](../classes/CollectionImpl.md#has)

***

### insert()

```ts
insert(data, config?): 
  | Transaction<Record<string, unknown>>
| Transaction<T>;
```

Defined in: [packages/db/src/collection/index.ts:980](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L980)

Inserts one or more items into the collection

#### Parameters

##### data

`TInsertInput` | `TInsertInput`[]

##### config?

[`InsertConfig`](InsertConfig.md)

Optional configuration including metadata

#### Returns

  \| [`Transaction`](Transaction.md)\<`Record`\<`string`, `unknown`\>\>
  \| [`Transaction`](Transaction.md)\<`T`\>

A Transaction object representing the insert operation(s)

#### Throws

If the data fails schema validation

#### Examples

```ts
// Insert a single todo (requires onInsert handler)
const tx = collection.insert({ id: "1", text: "Buy milk", completed: false })
await tx.when('settled')
```

```ts
// Insert multiple todos at once
const tx = collection.insert([
  { id: "1", text: "Buy milk", completed: false },
  { id: "2", text: "Walk dog", completed: true }
])
await tx.when('settled')
```

```ts
// Insert with metadata
const tx = collection.insert({ id: "1", text: "Buy groceries" },
  { metadata: { source: "mobile-app" } }
)
await tx.when('settled')
```

```ts
// Handle errors
try {
  const tx = collection.insert({ id: "1", text: "New item" })
  await tx.when('settled')
  console.log('Insert successful')
} catch (error) {
  console.log('Insert failed:', error)
}
```

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`insert`](../classes/CollectionImpl.md#insert)

***

### isReady()

```ts
isReady(): boolean;
```

Defined in: [packages/db/src/collection/index.ts:649](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L649)

Check if the collection is ready for use
Returns true if the collection has been marked as ready by its sync implementation

#### Returns

`boolean`

true if the collection is ready, false otherwise

#### Example

```ts
if (collection.isReady()) {
  console.log('Collection is ready, data is available')
  // Safe to access collection.state
} else {
  console.log('Collection is still loading')
}
```

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`isReady`](../classes/CollectionImpl.md#isready)

***

### keys()

```ts
keys(): IterableIterator<TKey>;
```

Defined in: [packages/db/src/collection/index.ts:796](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L796)

Get all keys (virtual derived state)

#### Returns

`IterableIterator`\<`TKey`\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`keys`](../classes/CollectionImpl.md#keys)

***

### map()

```ts
map<U>(callbackfn): U[];
```

Defined in: [packages/db/src/collection/index.ts:852](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L852)

Create a new array with the results of calling a function for each entry in the collection

#### Type Parameters

##### U

`U`

#### Parameters

##### callbackfn

(`value`, `key`, `index`) => `U`

#### Returns

`U`[]

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`map`](../classes/CollectionImpl.md#map)

***

### off()

```ts
off<T>(event, callback): void;
```

Defined in: [packages/db/src/collection/index.ts:1284](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1284)

Unsubscribe from a collection event

#### Type Parameters

##### T

`T` *extends* 
  \| `"status:error"`
  \| `"status:idle"`
  \| `"status:loading"`
  \| `"status:ready"`
  \| `"status:crashed"`
  \| `"status:cleaned-up"`
  \| `"status:change"`
  \| `"subscribers:change"`
  \| `"loadingSubset:change"`
  \| `"health:change"`
  \| `"truncate"`
  \| `"loadedSubsets:invalidated"`
  \| `"index:added"`
  \| `"index:removed"`

#### Parameters

##### event

`T`

##### callback

`CollectionEventHandler`\<`T`\>

#### Returns

`void`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`off`](../classes/CollectionImpl.md#off)

***

### on()

```ts
on<T>(event, callback): () => void;
```

Defined in: [packages/db/src/collection/index.ts:1264](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1264)

Subscribe to a collection event

#### Type Parameters

##### T

`T` *extends* 
  \| `"status:error"`
  \| `"status:idle"`
  \| `"status:loading"`
  \| `"status:ready"`
  \| `"status:crashed"`
  \| `"status:cleaned-up"`
  \| `"status:change"`
  \| `"subscribers:change"`
  \| `"loadingSubset:change"`
  \| `"health:change"`
  \| `"truncate"`
  \| `"loadedSubsets:invalidated"`
  \| `"index:added"`
  \| `"index:removed"`

#### Parameters

##### event

`T`

##### callback

`CollectionEventHandler`\<`T`\>

#### Returns

```ts
(): void;
```

##### Returns

`void`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`on`](../classes/CollectionImpl.md#on)

***

### once()

```ts
once<T>(event, callback): () => void;
```

Defined in: [packages/db/src/collection/index.ts:1274](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1274)

Subscribe to a collection event once

#### Type Parameters

##### T

`T` *extends* 
  \| `"status:error"`
  \| `"status:idle"`
  \| `"status:loading"`
  \| `"status:ready"`
  \| `"status:crashed"`
  \| `"status:cleaned-up"`
  \| `"status:change"`
  \| `"subscribers:change"`
  \| `"loadingSubset:change"`
  \| `"health:change"`
  \| `"truncate"`
  \| `"loadedSubsets:invalidated"`
  \| `"index:added"`
  \| `"index:removed"`

#### Parameters

##### event

`T`

##### callback

`CollectionEventHandler`\<`T`\>

#### Returns

```ts
(): void;
```

##### Returns

`void`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`once`](../classes/CollectionImpl.md#once)

***

### onFirstReady()

```ts
onFirstReady(callback): () => void;
```

Defined in: [packages/db/src/collection/index.ts:633](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L633)

Register a callback to be executed when the collection first becomes ready
Useful for preloading collections
Every callback queued before the transition runs. Because ready state is
established first, callbacks registered during or after delivery run
immediately. If one throws, the collection remains ready. Direct sync
startup rethrows the first failure; preload resolves from ready state.
Cleanup discards pending callbacks without invoking them.

#### Parameters

##### callback

() => `void`

Function to call when the collection first becomes ready

#### Returns

```ts
(): void;
```

##### Returns

`void`

#### Example

```ts
collection.onFirstReady(() => {
  console.log('Collection is ready for the first time')
  // Safe to access collection.state now
})
```

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`onFirstReady`](../classes/CollectionImpl.md#onfirstready)

***

### preload()

```ts
preload(): Promise<void>;
```

Defined in: [packages/db/src/collection/index.ts:699](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L699)

Preload the collection data by starting sync if not already started
Multiple concurrent calls will share the same promise

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`preload`](../classes/CollectionImpl.md#preload)

***

### reload()

```ts
reload(): Promise<void>;
```

Defined in: [packages/db/src/collection/index.ts:1315](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1315)

Start a new sync run while everything visible stays: the rows, the
status, and the current error, with `reloading` on this Collection's
health node. The new run's first commit replaces the rows at once and
clears the node's problem; a `status` of `error` becomes `ready`. If the
new run fails first, the rows and status stay and the node shows the new
error. On a live query, it reloads each of its sources that has an
`error`, and then the query itself if its own node has an `error`: a
failed first load or a failed request for more data.

Returns the promise of a reload in flight when called again. Rejects on a
`crashed` Collection: a crash is not recovered in place. Clean the
Collection up with its dependents to start it fresh.

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`reload`](../classes/CollectionImpl.md#reload)

***

### removeIndex()

```ts
removeIndex(indexOrId): boolean;
```

Defined in: [packages/db/src/collection/index.ts:908](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L908)

Removes an index created with createIndex.
Returns true when an index existed and was removed.

Best-effort semantics: removing an index guarantees it is detached from
collection query planning. Existing index proxy references should be treated
as invalid after removal.

#### Parameters

##### indexOrId

`number` | [`BaseIndex`](../classes/BaseIndex.md)\<`TKey`\>

#### Returns

`boolean`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`removeIndex`](../classes/CollectionImpl.md#removeindex)

***

### startSyncImmediate()

```ts
startSyncImmediate(): void;
```

Defined in: [packages/db/src/collection/index.ts:666](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L666)

Start sync immediately - internal method for compiled queries
This bypasses lazy loading for special cases like live query results
Throws during active cleanup; restart after cleanup completes instead.

#### Returns

`void`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`startSyncImmediate`](../classes/CollectionImpl.md#startsyncimmediate)

***

### stateWhenReady()

```ts
stateWhenReady(): Promise<Map<TKey, WithVirtualProps<T, TKey>>>;
```

Defined in: [packages/db/src/collection/index.ts:1131](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1131)

Gets the current state of the collection as a Map once the collection is ready
Resolves when `preload()` does. For a live query, that is initial-query
readiness, so visible rows alone do not resolve it.

#### Returns

`Promise`\<`Map`\<`TKey`, [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`T`, `TKey`\>\>\>

Promise that resolves to a Map containing all items in the collection

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`stateWhenReady`](../classes/CollectionImpl.md#statewhenready)

***

### subscribeChanges()

#### Call Signature

```ts
subscribeChanges(callback, options?): CollectionSubscription;
```

Defined in: [packages/db/src/collection/index.ts:1227](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1227)

Subscribe to changes in the collection
Ordinary subscriptions throw during active cleanup. Wait for cleanup()
to settle before subscribing or resuming deferred acquisition.
Changes to the same key retain their causal order within a callback.
Changes to different keys have no promised order within a callback.

##### Parameters

###### callback

(`changes`) => `void`

Function called when items change

###### options?

[`SubscribeChangesOptions`](SubscribeChangesOptions.md)\<`T`, `TKey`\>

Subscription options including includeInitialState and where filter

##### Returns

`CollectionSubscription`

Unsubscribe function - Call this to stop listening for changes

##### Examples

```ts
// Basic subscription
const subscription = collection.subscribeChanges((changes) => {
  changes.forEach(change => {
    console.log(`${change.type}: ${change.key}`, change.value)
  })
})

// Later: subscription.unsubscribe()
```

```ts
// Include current state immediately
const subscription = collection.subscribeChanges((changes) => {
  updateUI(changes)
}, { includeInitialState: true })
```

```ts
// Subscribe only to changes matching a condition using where callback
import { eq } from "@tanstack/db"

const subscription = collection.subscribeChanges((changes) => {
  updateUI(changes)
}, {
  includeInitialState: true,
  where: (row) => eq(row.status, "active")
})
```

```ts
// Using multiple conditions with and()
import { and, eq, gt } from "@tanstack/db"

const subscription = collection.subscribeChanges((changes) => {
  updateUI(changes)
}, {
  where: (row) => and(eq(row.status, "active"), gt(row.priority, 5))
})
```

##### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`subscribeChanges`](../classes/CollectionImpl.md#subscribechanges)

#### Call Signature

```ts
subscribeChanges(callback, options?): CollectionSubscription;
```

Defined in: [packages/db/src/collection/index.ts:1235](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1235)

Subscribe to changes in the collection
Ordinary subscriptions throw during active cleanup. Wait for cleanup()
to settle before subscribing or resuming deferred acquisition.
Changes to the same key retain their causal order within a callback.
Changes to different keys have no promised order within a callback.

##### Parameters

###### callback

Function called when items change

(`changes`) => `void` | (`changes`) => `void`

###### options?

[`SubscribeChangesOptions`](SubscribeChangesOptions.md)\<`T`, `TKey`\>

Subscription options including includeInitialState and where filter

##### Returns

`CollectionSubscription`

Unsubscribe function - Call this to stop listening for changes

##### Examples

```ts
// Basic subscription
const subscription = collection.subscribeChanges((changes) => {
  changes.forEach(change => {
    console.log(`${change.type}: ${change.key}`, change.value)
  })
})

// Later: subscription.unsubscribe()
```

```ts
// Include current state immediately
const subscription = collection.subscribeChanges((changes) => {
  updateUI(changes)
}, { includeInitialState: true })
```

```ts
// Subscribe only to changes matching a condition using where callback
import { eq } from "@tanstack/db"

const subscription = collection.subscribeChanges((changes) => {
  updateUI(changes)
}, {
  includeInitialState: true,
  where: (row) => eq(row.status, "active")
})
```

```ts
// Using multiple conditions with and()
import { and, eq, gt } from "@tanstack/db"

const subscription = collection.subscribeChanges((changes) => {
  updateUI(changes)
}, {
  where: (row) => and(eq(row.status, "active"), gt(row.priority, 5))
})
```

##### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`subscribeChanges`](../classes/CollectionImpl.md#subscribechanges)

***

### toArrayWhenReady()

```ts
toArrayWhenReady(): Promise<WithVirtualProps<T, TKey>[]>;
```

Defined in: [packages/db/src/collection/index.ts:1151](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1151)

Gets the current state of the collection as an Array once the collection is ready
Resolves when `preload()` does. For a live query, that is initial-query
readiness, so visible rows alone do not resolve it.

#### Returns

`Promise`\<[`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`T`, `TKey`\>[]\>

Promise that resolves to an Array containing all items in the collection

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`toArrayWhenReady`](../classes/CollectionImpl.md#toarraywhenready)

***

### update()

#### Call Signature

```ts
update(key, callback): Transaction;
```

Defined in: [packages/db/src/collection/index.ts:1025](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1025)

Updates one or more items in the collection using a callback function

##### Parameters

###### key

`TKey`[]

###### callback

(`drafts`) => `void`

##### Returns

[`Transaction`](Transaction.md)

A Transaction object representing the update operation(s)

##### Throws

If the updated data fails schema validation

##### Examples

```ts
// Update single item by key
const tx = collection.update("todo-1", (draft) => {
  draft.completed = true
})
await tx.when('settled')
```

```ts
// Update multiple items
const tx = collection.update(["todo-1", "todo-2"], (drafts) => {
  drafts.forEach(draft => { draft.completed = true })
})
await tx.when('settled')
```

```ts
// Update with metadata
const tx = collection.update("todo-1",
  { metadata: { reason: "user update" } },
  (draft) => { draft.text = "Updated text" }
)
await tx.when('settled')
```

```ts
// Handle errors
try {
  const tx = collection.update("item-1", draft => { draft.value = "new" })
  await tx.when('settled')
  console.log('Update successful')
} catch (error) {
  console.log('Update failed:', error)
}
```

##### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`update`](../classes/CollectionImpl.md#update)

#### Call Signature

```ts
update(
   keys, 
   config, 
   callback): Transaction;
```

Defined in: [packages/db/src/collection/index.ts:1031](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1031)

Updates one or more items in the collection using a callback function

##### Parameters

###### keys

`TKey`[]

Single key or array of keys to update

###### config

[`OperationConfig`](OperationConfig.md)

###### callback

(`drafts`) => `void`

##### Returns

[`Transaction`](Transaction.md)

A Transaction object representing the update operation(s)

##### Throws

If the updated data fails schema validation

##### Examples

```ts
// Update single item by key
const tx = collection.update("todo-1", (draft) => {
  draft.completed = true
})
await tx.when('settled')
```

```ts
// Update multiple items
const tx = collection.update(["todo-1", "todo-2"], (drafts) => {
  drafts.forEach(draft => { draft.completed = true })
})
await tx.when('settled')
```

```ts
// Update with metadata
const tx = collection.update("todo-1",
  { metadata: { reason: "user update" } },
  (draft) => { draft.text = "Updated text" }
)
await tx.when('settled')
```

```ts
// Handle errors
try {
  const tx = collection.update("item-1", draft => { draft.value = "new" })
  await tx.when('settled')
  console.log('Update successful')
} catch (error) {
  console.log('Update failed:', error)
}
```

##### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`update`](../classes/CollectionImpl.md#update)

#### Call Signature

```ts
update(id, callback): Transaction;
```

Defined in: [packages/db/src/collection/index.ts:1038](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1038)

Updates one or more items in the collection using a callback function

##### Parameters

###### id

`TKey`

###### callback

(`draft`) => `void`

##### Returns

[`Transaction`](Transaction.md)

A Transaction object representing the update operation(s)

##### Throws

If the updated data fails schema validation

##### Examples

```ts
// Update single item by key
const tx = collection.update("todo-1", (draft) => {
  draft.completed = true
})
await tx.when('settled')
```

```ts
// Update multiple items
const tx = collection.update(["todo-1", "todo-2"], (drafts) => {
  drafts.forEach(draft => { draft.completed = true })
})
await tx.when('settled')
```

```ts
// Update with metadata
const tx = collection.update("todo-1",
  { metadata: { reason: "user update" } },
  (draft) => { draft.text = "Updated text" }
)
await tx.when('settled')
```

```ts
// Handle errors
try {
  const tx = collection.update("item-1", draft => { draft.value = "new" })
  await tx.when('settled')
  console.log('Update successful')
} catch (error) {
  console.log('Update failed:', error)
}
```

##### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`update`](../classes/CollectionImpl.md#update)

#### Call Signature

```ts
update(
   id, 
   config, 
   callback): Transaction;
```

Defined in: [packages/db/src/collection/index.ts:1044](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1044)

Updates one or more items in the collection using a callback function

##### Parameters

###### id

`TKey`

###### config

[`OperationConfig`](OperationConfig.md)

###### callback

(`draft`) => `void`

##### Returns

[`Transaction`](Transaction.md)

A Transaction object representing the update operation(s)

##### Throws

If the updated data fails schema validation

##### Examples

```ts
// Update single item by key
const tx = collection.update("todo-1", (draft) => {
  draft.completed = true
})
await tx.when('settled')
```

```ts
// Update multiple items
const tx = collection.update(["todo-1", "todo-2"], (drafts) => {
  drafts.forEach(draft => { draft.completed = true })
})
await tx.when('settled')
```

```ts
// Update with metadata
const tx = collection.update("todo-1",
  { metadata: { reason: "user update" } },
  (draft) => { draft.text = "Updated text" }
)
await tx.when('settled')
```

```ts
// Handle errors
try {
  const tx = collection.update("item-1", draft => { draft.value = "new" })
  await tx.when('settled')
  console.log('Update successful')
} catch (error) {
  console.log('Update failed:', error)
}
```

##### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`update`](../classes/CollectionImpl.md#update)

***

### validateData()

```ts
validateData(
   data, 
   type, 
   key?): T;
```

Defined in: [packages/db/src/collection/index.ts:931](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L931)

Validates the data against the schema

#### Parameters

##### data

`unknown`

##### type

`"insert"` | `"update"`

##### key?

`TKey`

#### Returns

`T`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`validateData`](../classes/CollectionImpl.md#validatedata)

***

### values()

```ts
values(): IterableIterator<WithVirtualProps<T, TKey>>;
```

Defined in: [packages/db/src/collection/index.ts:803](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L803)

Get all values (virtual derived state)

#### Returns

`IterableIterator`\<[`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`T`, `TKey`\>\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`values`](../classes/CollectionImpl.md#values)

***

### waitFor()

```ts
waitFor<T>(event, timeout?): Promise<AllCollectionEvents[T]>;
```

Defined in: [packages/db/src/collection/index.ts:1294](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1294)

Wait for a collection event

#### Type Parameters

##### T

`T` *extends* 
  \| `"status:error"`
  \| `"status:idle"`
  \| `"status:loading"`
  \| `"status:ready"`
  \| `"status:crashed"`
  \| `"status:cleaned-up"`
  \| `"status:change"`
  \| `"subscribers:change"`
  \| `"loadingSubset:change"`
  \| `"health:change"`
  \| `"truncate"`
  \| `"loadedSubsets:invalidated"`
  \| `"index:added"`
  \| `"index:removed"`

#### Parameters

##### event

`T`

##### timeout?

`number`

#### Returns

`Promise`\<`AllCollectionEvents`\[`T`\]\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`waitFor`](../classes/CollectionImpl.md#waitfor)
