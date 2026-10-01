---
id: CollectionImpl
title: CollectionImpl
---

Defined in: [packages/db/src/collection/index.ts:355](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L355)

## Extended by

- [`Collection`](../interfaces/Collection.md)

## Type Parameters

### TOutput

`TOutput` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TUtils

`TUtils` *extends* [`UtilsRecord`](../type-aliases/UtilsRecord.md) = \{
\}

### TSchema

`TSchema` *extends* `StandardSchemaV1` = `StandardSchemaV1`

### TInput

`TInput` *extends* `object` = `TOutput`

## Constructors

### Constructor

```ts
new CollectionImpl<TOutput, TKey, TUtils, TSchema, TInput>(config): CollectionImpl<TOutput, TKey, TUtils, TSchema, TInput>;
```

Defined in: [packages/db/src/collection/index.ts:401](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L401)

Creates a new Collection instance

#### Parameters

##### config

`CollectionImplConfig`\<`TOutput`, `TKey`, `TUtils`, `TSchema`\>

Configuration object for the collection

#### Returns

`CollectionImpl`\<`TOutput`, `TKey`, `TUtils`, `TSchema`, `TInput`\>

#### Throws

Error if sync config is missing

## Properties

### \_lifecycle

```ts
_lifecycle: CollectionLifecycleManager<TOutput, TKey, TSchema, TInput>;
```

Defined in: [packages/db/src/collection/index.ts:372](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L372)

***

### \_state

```ts
_state: CollectionStateManager<TOutput, TKey, TSchema, TInput>;
```

Defined in: [packages/db/src/collection/index.ts:384](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L384)

***

### \_sync

```ts
_sync: CollectionSyncManager<TOutput, TKey, TSchema, TInput>;
```

Defined in: [packages/db/src/collection/index.ts:373](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L373)

***

### config

```ts
config: CollectionConfig<TOutput, TKey, TSchema, TUtils>;
```

Defined in: [packages/db/src/collection/index.ts:363](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L363)

***

### deferDataRefresh

```ts
deferDataRefresh: Promise<void> | null = null;
```

Defined in: [packages/db/src/collection/index.ts:391](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L391)

When set, collection consumers should defer processing incoming data
refreshes until this promise resolves. This prevents stale data from
overwriting optimistic state while pending writes are being applied.

***

### id

```ts
id: string;
```

Defined in: [packages/db/src/collection/index.ts:362](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L362)

***

### utils

```ts
utils: TUtils;
```

Defined in: [packages/db/src/collection/index.ts:367](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L367)

## Accessors

### \_layoutRevision

#### Get Signature

```ts
get _layoutRevision(): number;
```

Defined in: [packages/db/src/collection/index.ts:536](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L536)

Monotonic revision of explicit layout-only publications.
Internal — used to distinguish them from empty ready events.

##### Returns

`number`

***

### \_stateRevision

#### Get Signature

```ts
get _stateRevision(): number;
```

Defined in: [packages/db/src/collection/index.ts:528](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L528)

Monotonic revision of the collection's visible state; advances once per
committed batch of changes and cleanup, even while nothing is subscribed.
Internal — used by the live-query observer's snapshot cache.

##### Returns

`number`

***

### compareOptions

#### Get Signature

```ts
get compareOptions(): StringCollationConfig;
```

Defined in: [packages/db/src/collection/index.ts:807](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L807)

##### Returns

[`StringCollationConfig`](../type-aliases/StringCollationConfig.md)

***

### indexes

#### Get Signature

```ts
get indexes(): Map<number, BaseIndex<TKey>>;
```

Defined in: [packages/db/src/collection/index.ts:792](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L792)

Get resolved indexes for query optimization

##### Returns

`Map`\<`number`, [`BaseIndex`](BaseIndex.md)\<`TKey`\>\>

***

### isLoadingSubset

#### Get Signature

```ts
get isLoadingSubset(): boolean;
```

Defined in: [packages/db/src/collection/index.ts:594](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L594)

Check if the collection is currently loading more data

##### Returns

`boolean`

true if the collection has pending load more operations, false otherwise

***

### size

#### Get Signature

```ts
get size(): number;
```

Defined in: [packages/db/src/collection/index.ts:657](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L657)

Get the current size of the collection (cached)

##### Returns

`number`

***

### state

#### Get Signature

```ts
get state(): Map<TKey, WithVirtualProps<TOutput, TKey>>;
```

Defined in: [packages/db/src/collection/index.ts:984](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L984)

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

***

### status

#### Get Signature

```ts
get status(): CollectionStatus;
```

Defined in: [packages/db/src/collection/index.ts:512](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L512)

Gets the current status of the collection

##### Returns

[`CollectionStatus`](../type-aliases/CollectionStatus.md)

***

### subscriberCount

#### Get Signature

```ts
get subscriberCount(): number;
```

Defined in: [packages/db/src/collection/index.ts:519](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L519)

Get the number of subscribers to the collection

##### Returns

`number`

***

### toArray

#### Get Signature

```ts
get toArray(): WithVirtualProps<TOutput, TKey>[];
```

Defined in: [packages/db/src/collection/index.ts:1013](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1013)

Gets the current state of the collection as an Array

##### Returns

[`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`TOutput`, `TKey`\>[]

An Array containing all items in the collection

## Methods

### \_deferPublication()

```ts
_deferPublication(): PublicationDeferral;
```

Defined in: [packages/db/src/collection/index.ts:551](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L551)

Defer subscriber events until a coherent multi-Collection commit ends.

#### Returns

`PublicationDeferral`

***

### \_deferSyncStart()

```ts
_deferSyncStart(): boolean;
```

Defined in: [packages/db/src/collection/index.ts:623](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L623)

**`Internal`**

#### Returns

`boolean`

***

### \_hasHydratedKey()

```ts
_hasHydratedKey(key): boolean;
```

Defined in: [packages/db/src/collection/index.ts:618](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L618)

**`Internal`**

#### Parameters

##### key

`TKey`

#### Returns

`boolean`

***

### \_markLayoutChange()

```ts
_markLayoutChange(): void;
```

Defined in: [packages/db/src/collection/index.ts:546](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L546)

Mark the active sync transaction as layout-changing. Internal.

#### Returns

`void`

***

### \_onCleanupStart()

```ts
_onCleanupStart(callback): () => void;
```

Defined in: [packages/db/src/collection/index.ts:608](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L608)

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

***

### \_resumeSyncStart()

```ts
_resumeSyncStart(): void;
```

Defined in: [packages/db/src/collection/index.ts:628](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L628)

**`Internal`**

#### Returns

`void`

***

### \_setTransactionScope()

```ts
_setTransactionScope(transactionScope): void;
```

Defined in: [packages/db/src/collection/index.ts:613](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L613)

**`Internal`**

#### Parameters

##### transactionScope

[`TransactionScope`](TransactionScope.md)

#### Returns

`void`

***

### \_subscribeLayoutChanges()

```ts
_subscribeLayoutChanges(listener): () => void;
```

Defined in: [packages/db/src/collection/index.ts:541](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L541)

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

***

### \[iterator\]()

```ts
iterator: IterableIterator<[TKey, WithVirtualProps<TOutput, TKey>]>;
```

Defined in: [packages/db/src/collection/index.ts:695](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L695)

Get all entries (virtual derived state)

#### Returns

`IterableIterator`\<\[`TKey`, [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`TOutput`, `TKey`\>\]\>

***

### cleanup()

```ts
cleanup(): Promise<void>;
```

Defined in: [packages/db/src/collection/index.ts:1183](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1183)

Clean up the collection by stopping sync and clearing data
This can be called manually or automatically by garbage collection
Cleanup callbacks must not restart this collection or call its preload().
Wait until cleanup completes before starting a new sync run. If adapter
cleanup rejects, this promise rejects after the Collection reaches its
final cleaned-up state.

#### Returns

`Promise`\<`void`\>

***

### createIndex()

```ts
createIndex<TIndexType>(indexCallback, config): BaseIndex<TKey>;
```

Defined in: [packages/db/src/collection/index.ts:761](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L761)

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

[`IndexOptions`](../interfaces/IndexOptions.md)\<`TIndexType`\> = `{}`

Configuration including index type and type-specific options

#### Returns

[`BaseIndex`](BaseIndex.md)\<`TKey`\>

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

***

### currentStateAsChanges()

```ts
currentStateAsChanges(options): 
  | void
  | ChangeMessage<WithVirtualProps<TOutput, TKey>, TKey>[];
```

Defined in: [packages/db/src/collection/index.ts:1051](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1051)

Returns the current state of the collection as an array of changes

#### Parameters

##### options

[`CurrentStateAsChangesOptions`](../interfaces/CurrentStateAsChangesOptions.md) = `{}`

Options including optional where filter

#### Returns

  \| `void`
  \| [`ChangeMessage`](../interfaces/ChangeMessage.md)\<[`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`TOutput`, `TKey`\>, `TKey`\>[]

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

***

### delete()

```ts
delete(keys, config?): Transaction<any>;
```

Defined in: [packages/db/src/collection/index.ts:961](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L961)

Deletes one or more items from the collection

#### Parameters

##### keys

Single key or array of keys to delete

`TKey` | `TKey`[]

##### config?

[`OperationConfig`](../interfaces/OperationConfig.md)

Optional configuration including metadata

#### Returns

[`Transaction`](../interfaces/Transaction.md)\<`any`\>

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

***

### entries()

```ts
entries(): IterableIterator<[TKey, WithVirtualProps<TOutput, TKey>]>;
```

Defined in: [packages/db/src/collection/index.ts:683](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L683)

Get all entries (virtual derived state)

#### Returns

`IterableIterator`\<\[`TKey`, [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`TOutput`, `TKey`\>\]\>

***

### forEach()

```ts
forEach(callbackfn): void;
```

Defined in: [packages/db/src/collection/index.ts:704](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L704)

Execute a callback for each entry in the collection

#### Parameters

##### callbackfn

(`value`, `key`, `index`) => `void`

#### Returns

`void`

***

### get()

```ts
get(key): 
  | WithVirtualProps<TOutput, TKey>
  | undefined;
```

Defined in: [packages/db/src/collection/index.ts:643](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L643)

Get the current value for a key (virtual derived state)

#### Parameters

##### key

`TKey`

#### Returns

  \| [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`TOutput`, `TKey`\>
  \| `undefined`

***

### getIndexMetadata()

```ts
getIndexMetadata(): CollectionIndexMetadata[];
```

Defined in: [packages/db/src/collection/index.ts:785](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L785)

Returns a snapshot of current index metadata sorted by indexId.
Persistence wrappers can use this to bootstrap index state if indexes were
created before event listeners were attached.

#### Returns

[`CollectionIndexMetadata`](../interfaces/CollectionIndexMetadata.md)[]

***

### getKeyFromItem()

```ts
getKeyFromItem(item): TKey;
```

Defined in: [packages/db/src/collection/index.ts:735](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L735)

#### Parameters

##### item

`TOutput`

#### Returns

`TKey`

***

### has()

```ts
has(key): boolean;
```

Defined in: [packages/db/src/collection/index.ts:650](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L650)

Check if a key exists in the collection (virtual derived state)

#### Parameters

##### key

`TKey`

#### Returns

`boolean`

***

### insert()

```ts
insert(data, config?): Transaction<Record<string, unknown>>;
```

Defined in: [packages/db/src/collection/index.ts:848](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L848)

Inserts one or more items into the collection

#### Parameters

##### data

`TInput` | `TInput`[]

##### config?

[`InsertConfig`](../interfaces/InsertConfig.md)

Optional configuration including metadata

#### Returns

[`Transaction`](../interfaces/Transaction.md)\<`Record`\<`string`, `unknown`\>\>

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

***

### isReady()

```ts
isReady(): boolean;
```

Defined in: [packages/db/src/collection/index.ts:586](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L586)

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

***

### keys()

```ts
keys(): IterableIterator<TKey>;
```

Defined in: [packages/db/src/collection/index.ts:664](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L664)

Get all keys (virtual derived state)

#### Returns

`IterableIterator`\<`TKey`\>

***

### map()

```ts
map<U>(callbackfn): U[];
```

Defined in: [packages/db/src/collection/index.ts:720](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L720)

Create a new array with the results of calling a function for each entry in the collection

#### Type Parameters

##### U

`U`

#### Parameters

##### callbackfn

(`value`, `key`, `index`) => `U`

#### Returns

`U`[]

***

### off()

```ts
off<T>(event, callback): void;
```

Defined in: [packages/db/src/collection/index.ts:1158](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1158)

Unsubscribe from a collection event

#### Type Parameters

##### T

`T` *extends* 
  \| `"status:error"`
  \| `"status:idle"`
  \| `"status:loading"`
  \| `"status:ready"`
  \| `"status:cleaned-up"`
  \| `"status:change"`
  \| `"subscribers:change"`
  \| `"loadingSubset:change"`
  \| `"truncate"`
  \| `"index:added"`
  \| `"index:removed"`

#### Parameters

##### event

`T`

##### callback

`CollectionEventHandler`\<`T`\>

#### Returns

`void`

***

### on()

```ts
on<T>(event, callback): () => void;
```

Defined in: [packages/db/src/collection/index.ts:1138](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1138)

Subscribe to a collection event

#### Type Parameters

##### T

`T` *extends* 
  \| `"status:error"`
  \| `"status:idle"`
  \| `"status:loading"`
  \| `"status:ready"`
  \| `"status:cleaned-up"`
  \| `"status:change"`
  \| `"subscribers:change"`
  \| `"loadingSubset:change"`
  \| `"truncate"`
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

***

### once()

```ts
once<T>(event, callback): () => void;
```

Defined in: [packages/db/src/collection/index.ts:1148](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1148)

Subscribe to a collection event once

#### Type Parameters

##### T

`T` *extends* 
  \| `"status:error"`
  \| `"status:idle"`
  \| `"status:loading"`
  \| `"status:ready"`
  \| `"status:cleaned-up"`
  \| `"status:change"`
  \| `"subscribers:change"`
  \| `"loadingSubset:change"`
  \| `"truncate"`
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

***

### onFirstReady()

```ts
onFirstReady(callback): () => void;
```

Defined in: [packages/db/src/collection/index.ts:570](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L570)

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

***

### preload()

```ts
preload(): Promise<void>;
```

Defined in: [packages/db/src/collection/index.ts:636](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L636)

Preload the collection data by starting sync if not already started
Multiple concurrent calls will share the same promise

#### Returns

`Promise`\<`void`\>

***

### removeIndex()

```ts
removeIndex(indexOrId): boolean;
```

Defined in: [packages/db/src/collection/index.ts:776](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L776)

Removes an index created with createIndex.
Returns true when an index existed and was removed.

Best-effort semantics: removing an index guarantees it is detached from
collection query planning. Existing index proxy references should be treated
as invalid after removal.

#### Parameters

##### indexOrId

`number` | [`BaseIndex`](BaseIndex.md)\<`TKey`\>

#### Returns

`boolean`

***

### startSyncImmediate()

```ts
startSyncImmediate(): void;
```

Defined in: [packages/db/src/collection/index.ts:603](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L603)

Start sync immediately - internal method for compiled queries
This bypasses lazy loading for special cases like live query results
Throws during active cleanup; restart after cleanup completes instead.

#### Returns

`void`

***

### stateWhenReady()

```ts
stateWhenReady(): Promise<Map<TKey, WithVirtualProps<TOutput, TKey>>>;
```

Defined in: [packages/db/src/collection/index.ts:998](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L998)

Gets the current state of the collection as a Map, but only resolves when data is available
Waits for the first sync commit to complete before resolving

#### Returns

`Promise`\<`Map`\<`TKey`, [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`TOutput`, `TKey`\>\>\>

Promise that resolves to a Map containing all items in the collection

***

### subscribeChanges()

#### Call Signature

```ts
subscribeChanges(callback, options?): CollectionSubscription;
```

Defined in: [packages/db/src/collection/index.ts:1101](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1101)

Subscribe to changes in the collection
Changes to the same key retain their causal order within a callback.
Changes to different keys have no promised order within a callback.

##### Parameters

###### callback

(`changes`) => `void`

Function called when items change

###### options?

[`SubscribeChangesOptions`](../interfaces/SubscribeChangesOptions.md)\<`TOutput`, `TKey`\>

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

#### Call Signature

```ts
subscribeChanges(callback, options?): CollectionSubscription;
```

Defined in: [packages/db/src/collection/index.ts:1109](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1109)

Subscribe to changes in the collection
Changes to the same key retain their causal order within a callback.
Changes to different keys have no promised order within a callback.

##### Parameters

###### callback

Function called when items change

(`changes`) => `void` | (`changes`) => `void`

###### options?

[`SubscribeChangesOptions`](../interfaces/SubscribeChangesOptions.md)\<`TOutput`, `TKey`\>

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

***

### toArrayWhenReady()

```ts
toArrayWhenReady(): Promise<WithVirtualProps<TOutput, TKey>[]>;
```

Defined in: [packages/db/src/collection/index.ts:1023](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1023)

Gets the current state of the collection as an Array, but only resolves when data is available
Waits for the first sync commit to complete before resolving

#### Returns

`Promise`\<[`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`TOutput`, `TKey`\>[]\>

Promise that resolves to an Array containing all items in the collection

***

### update()

#### Call Signature

```ts
update(key, callback): Transaction;
```

Defined in: [packages/db/src/collection/index.ts:893](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L893)

Updates one or more items in the collection using a callback function

##### Parameters

###### key

`TKey`[]

###### callback

(`drafts`) => `void`

##### Returns

[`Transaction`](../interfaces/Transaction.md)

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

#### Call Signature

```ts
update(
   keys, 
   config, 
   callback): Transaction;
```

Defined in: [packages/db/src/collection/index.ts:899](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L899)

Updates one or more items in the collection using a callback function

##### Parameters

###### keys

`TKey`[]

Single key or array of keys to update

###### config

[`OperationConfig`](../interfaces/OperationConfig.md)

###### callback

(`drafts`) => `void`

##### Returns

[`Transaction`](../interfaces/Transaction.md)

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

#### Call Signature

```ts
update(id, callback): Transaction;
```

Defined in: [packages/db/src/collection/index.ts:906](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L906)

Updates one or more items in the collection using a callback function

##### Parameters

###### id

`TKey`

###### callback

(`draft`) => `void`

##### Returns

[`Transaction`](../interfaces/Transaction.md)

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

#### Call Signature

```ts
update(
   id, 
   config, 
   callback): Transaction;
```

Defined in: [packages/db/src/collection/index.ts:912](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L912)

Updates one or more items in the collection using a callback function

##### Parameters

###### id

`TKey`

###### config

[`OperationConfig`](../interfaces/OperationConfig.md)

###### callback

(`draft`) => `void`

##### Returns

[`Transaction`](../interfaces/Transaction.md)

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

***

### validateData()

```ts
validateData(
   data, 
   type, 
   key?): TOutput;
```

Defined in: [packages/db/src/collection/index.ts:799](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L799)

Validates the data against the schema

#### Parameters

##### data

`unknown`

##### type

`"insert"` | `"update"`

##### key?

`TKey`

#### Returns

`TOutput`

***

### values()

```ts
values(): IterableIterator<WithVirtualProps<TOutput, TKey>>;
```

Defined in: [packages/db/src/collection/index.ts:671](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L671)

Get all values (virtual derived state)

#### Returns

`IterableIterator`\<[`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`TOutput`, `TKey`\>\>

***

### waitFor()

```ts
waitFor<T>(event, timeout?): Promise<AllCollectionEvents[T]>;
```

Defined in: [packages/db/src/collection/index.ts:1168](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1168)

Wait for a collection event

#### Type Parameters

##### T

`T` *extends* 
  \| `"status:error"`
  \| `"status:idle"`
  \| `"status:loading"`
  \| `"status:ready"`
  \| `"status:cleaned-up"`
  \| `"status:change"`
  \| `"subscribers:change"`
  \| `"loadingSubset:change"`
  \| `"truncate"`
  \| `"index:added"`
  \| `"index:removed"`

#### Parameters

##### event

`T`

##### timeout?

`number`

#### Returns

`Promise`\<`AllCollectionEvents`\[`T`\]\>
