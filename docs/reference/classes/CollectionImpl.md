---
id: CollectionImpl
title: CollectionImpl
---

# Class: CollectionImpl\<TOutput, TKey, TUtils, TSchema, TInput\>

Defined in: [packages/db/src/collection/index.ts:275](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L275)

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

Defined in: [packages/db/src/collection/index.ts:321](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L321)

Creates a new Collection instance

#### Parameters

##### config

[`CollectionConfig`](../interfaces/CollectionConfig.md)\<`TOutput`, `TKey`, `TSchema`\>

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

Defined in: [packages/db/src/collection/index.ts:292](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L292)

***

### \_state

```ts
_state: CollectionStateManager<TOutput, TKey, TSchema, TInput>;
```

Defined in: [packages/db/src/collection/index.ts:304](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L304)

***

### \_sync

```ts
_sync: CollectionSyncManager<TOutput, TKey, TSchema, TInput>;
```

Defined in: [packages/db/src/collection/index.ts:293](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L293)

***

### config

```ts
config: CollectionConfig<TOutput, TKey, TSchema>;
```

Defined in: [packages/db/src/collection/index.ts:283](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L283)

***

### deferDataRefresh

```ts
deferDataRefresh: Promise<void> | null = null;
```

Defined in: [packages/db/src/collection/index.ts:311](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L311)

When set, collection consumers should defer processing incoming data
refreshes until this promise resolves. This prevents stale data from
overwriting optimistic state while pending writes are being applied.

***

### id

```ts
id: string;
```

Defined in: [packages/db/src/collection/index.ts:282](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L282)

***

### utils

```ts
utils: Record<string, Fn> = {};
```

Defined in: [packages/db/src/collection/index.ts:287](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L287)

## Accessors

### \_layoutRevision

#### Get Signature

```ts
get _layoutRevision(): number;
```

Defined in: [packages/db/src/collection/index.ts:438](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L438)

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

Defined in: [packages/db/src/collection/index.ts:430](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L430)

Monotonic revision of the collection's visible state; advances once per
committed batch of changes, even while nothing is subscribed.
Internal — used by the live-query observer's snapshot cache.

##### Returns

`number`

***

### compareOptions

#### Get Signature

```ts
get compareOptions(): StringCollationConfig;
```

Defined in: [packages/db/src/collection/index.ts:698](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L698)

##### Returns

[`StringCollationConfig`](../type-aliases/StringCollationConfig.md)

***

### indexes

#### Get Signature

```ts
get indexes(): Map<number, BaseIndex<TKey>>;
```

Defined in: [packages/db/src/collection/index.ts:683](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L683)

Get resolved indexes for query optimization

##### Returns

`Map`\<`number`, [`BaseIndex`](BaseIndex.md)\<`TKey`\>\>

***

### isLoadingSubset

#### Get Signature

```ts
get isLoadingSubset(): boolean;
```

Defined in: [packages/db/src/collection/index.ts:491](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L491)

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

Defined in: [packages/db/src/collection/index.ts:548](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L548)

Get the current size of the collection (cached)

##### Returns

`number`

***

### state

#### Get Signature

```ts
get state(): Map<TKey, WithVirtualProps<TOutput, TKey>>;
```

Defined in: [packages/db/src/collection/index.ts:875](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L875)

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

Defined in: [packages/db/src/collection/index.ts:414](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L414)

Gets the current status of the collection

##### Returns

[`CollectionStatus`](../type-aliases/CollectionStatus.md)

***

### subscriberCount

#### Get Signature

```ts
get subscriberCount(): number;
```

Defined in: [packages/db/src/collection/index.ts:421](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L421)

Get the number of subscribers to the collection

##### Returns

`number`

***

### toArray

#### Get Signature

```ts
get toArray(): WithVirtualProps<TOutput, TKey>[];
```

Defined in: [packages/db/src/collection/index.ts:904](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L904)

Gets the current state of the collection as an Array

##### Returns

[`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`TOutput`, `TKey`\>[]

An Array containing all items in the collection

## Methods

### \_deferPublication()

```ts
_deferPublication(): PublicationDeferral;
```

Defined in: [packages/db/src/collection/index.ts:453](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L453)

Defer subscriber events until a coherent multi-Collection commit ends.

#### Returns

`PublicationDeferral`

***

### \_deferSyncStart()

```ts
_deferSyncStart(): boolean;
```

Defined in: [packages/db/src/collection/index.ts:514](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L514)

**`Internal`**

#### Returns

`boolean`

***

### \_hasHydratedKey()

```ts
_hasHydratedKey(key): boolean;
```

Defined in: [packages/db/src/collection/index.ts:509](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L509)

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

Defined in: [packages/db/src/collection/index.ts:448](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L448)

Mark the active sync transaction as layout-changing. Internal.

#### Returns

`void`

***

### \_resumeSyncStart()

```ts
_resumeSyncStart(): void;
```

Defined in: [packages/db/src/collection/index.ts:519](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L519)

**`Internal`**

#### Returns

`void`

***

### \_setTransactionScope()

```ts
_setTransactionScope(transactionScope): void;
```

Defined in: [packages/db/src/collection/index.ts:504](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L504)

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

Defined in: [packages/db/src/collection/index.ts:443](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L443)

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

Defined in: [packages/db/src/collection/index.ts:586](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L586)

Get all entries (virtual derived state)

#### Returns

`IterableIterator`\<\[`TKey`, [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`TOutput`, `TKey`\>\]\>

***

### cleanup()

```ts
cleanup(): Promise<void>;
```

Defined in: [packages/db/src/collection/index.ts:1043](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1043)

Clean up the collection by stopping sync and clearing data
This can be called manually or automatically by garbage collection

#### Returns

`Promise`\<`void`\>

***

### createIndex()

```ts
createIndex<TIndexType>(indexCallback, config): BaseIndex<TKey>;
```

Defined in: [packages/db/src/collection/index.ts:652](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L652)

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
  | ChangeMessage<WithVirtualProps<TOutput, TKey>, string | number>[];
```

Defined in: [packages/db/src/collection/index.ts:942](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L942)

Returns the current state of the collection as an array of changes

#### Parameters

##### options

[`CurrentStateAsChangesOptions`](../interfaces/CurrentStateAsChangesOptions.md) = `{}`

Options including optional where filter

#### Returns

  \| `void`
  \| [`ChangeMessage`](../interfaces/ChangeMessage.md)\<[`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`TOutput`, `TKey`\>, `string` \| `number`\>[]

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

Defined in: [packages/db/src/collection/index.ts:852](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L852)

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
await tx.isPersisted.promise
```

```ts
// Delete multiple items
const tx = collection.delete(["todo-1", "todo-2"])
await tx.isPersisted.promise
```

```ts
// Delete with metadata
const tx = collection.delete("todo-1", { metadata: { reason: "completed" } })
await tx.isPersisted.promise
```

```ts
// Handle errors
try {
  const tx = collection.delete("item-1")
  await tx.isPersisted.promise
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

Defined in: [packages/db/src/collection/index.ts:574](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L574)

Get all entries (virtual derived state)

#### Returns

`IterableIterator`\<\[`TKey`, [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`TOutput`, `TKey`\>\]\>

***

### forEach()

```ts
forEach(callbackfn): void;
```

Defined in: [packages/db/src/collection/index.ts:595](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L595)

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

Defined in: [packages/db/src/collection/index.ts:534](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L534)

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

Defined in: [packages/db/src/collection/index.ts:676](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L676)

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

Defined in: [packages/db/src/collection/index.ts:626](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L626)

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

Defined in: [packages/db/src/collection/index.ts:541](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L541)

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

Defined in: [packages/db/src/collection/index.ts:739](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L739)

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
await tx.isPersisted.promise
```

```ts
// Insert multiple todos at once
const tx = collection.insert([
  { id: "1", text: "Buy milk", completed: false },
  { id: "2", text: "Walk dog", completed: true }
])
await tx.isPersisted.promise
```

```ts
// Insert with metadata
const tx = collection.insert({ id: "1", text: "Buy groceries" },
  { metadata: { source: "mobile-app" } }
)
await tx.isPersisted.promise
```

```ts
// Handle errors
try {
  const tx = collection.insert({ id: "1", text: "New item" })
  await tx.isPersisted.promise
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

Defined in: [packages/db/src/collection/index.ts:483](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L483)

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

Defined in: [packages/db/src/collection/index.ts:555](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L555)

Get all keys (virtual derived state)

#### Returns

`IterableIterator`\<`TKey`\>

***

### map()

```ts
map<U>(callbackfn): U[];
```

Defined in: [packages/db/src/collection/index.ts:611](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L611)

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

Defined in: [packages/db/src/collection/index.ts:1022](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1022)

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

Defined in: [packages/db/src/collection/index.ts:1002](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1002)

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

Defined in: [packages/db/src/collection/index.ts:1012](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1012)

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
onFirstReady(callback): void;
```

Defined in: [packages/db/src/collection/index.ts:467](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L467)

Register a callback to be executed when the collection first becomes ready
Useful for preloading collections

#### Parameters

##### callback

() => `void`

Function to call when the collection first becomes ready

#### Returns

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

Defined in: [packages/db/src/collection/index.ts:527](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L527)

Preload the collection data by starting sync if not already started
Multiple concurrent calls will share the same promise

#### Returns

`Promise`\<`void`\>

***

### removeIndex()

```ts
removeIndex(indexOrId): boolean;
```

Defined in: [packages/db/src/collection/index.ts:667](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L667)

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

Defined in: [packages/db/src/collection/index.ts:499](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L499)

Start sync immediately - internal method for compiled queries
This bypasses lazy loading for special cases like live query results

#### Returns

`void`

***

### stateWhenReady()

```ts
stateWhenReady(): Promise<Map<TKey, WithVirtualProps<TOutput, TKey>>>;
```

Defined in: [packages/db/src/collection/index.ts:889](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L889)

Gets the current state of the collection as a Map, but only resolves when data is available
Waits for the first sync commit to complete before resolving

#### Returns

`Promise`\<`Map`\<`TKey`, [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`TOutput`, `TKey`\>\>\>

Promise that resolves to a Map containing all items in the collection

***

### subscribeChanges()

```ts
subscribeChanges(callback, options): CollectionSubscription;
```

Defined in: [packages/db/src/collection/index.ts:990](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L990)

Subscribe to changes in the collection

#### Parameters

##### callback

(`changes`) => `void`

Function called when items change

##### options

[`SubscribeChangesOptions`](../interfaces/SubscribeChangesOptions.md)\<`TOutput`, `TKey`\> = `{}`

Subscription options including includeInitialState and where filter

#### Returns

`CollectionSubscription`

Unsubscribe function - Call this to stop listening for changes

#### Examples

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

Defined in: [packages/db/src/collection/index.ts:914](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L914)

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

Defined in: [packages/db/src/collection/index.ts:784](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L784)

Updates one or more items in the collection using a callback function

##### Parameters

###### key

`unknown`[]

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
await tx.isPersisted.promise
```

```ts
// Update multiple items
const tx = collection.update(["todo-1", "todo-2"], (drafts) => {
  drafts.forEach(draft => { draft.completed = true })
})
await tx.isPersisted.promise
```

```ts
// Update with metadata
const tx = collection.update("todo-1",
  { metadata: { reason: "user update" } },
  (draft) => { draft.text = "Updated text" }
)
await tx.isPersisted.promise
```

```ts
// Handle errors
try {
  const tx = collection.update("item-1", draft => { draft.value = "new" })
  await tx.isPersisted.promise
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

Defined in: [packages/db/src/collection/index.ts:790](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L790)

Updates one or more items in the collection using a callback function

##### Parameters

###### keys

`unknown`[]

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
await tx.isPersisted.promise
```

```ts
// Update multiple items
const tx = collection.update(["todo-1", "todo-2"], (drafts) => {
  drafts.forEach(draft => { draft.completed = true })
})
await tx.isPersisted.promise
```

```ts
// Update with metadata
const tx = collection.update("todo-1",
  { metadata: { reason: "user update" } },
  (draft) => { draft.text = "Updated text" }
)
await tx.isPersisted.promise
```

```ts
// Handle errors
try {
  const tx = collection.update("item-1", draft => { draft.value = "new" })
  await tx.isPersisted.promise
  console.log('Update successful')
} catch (error) {
  console.log('Update failed:', error)
}
```

#### Call Signature

```ts
update(id, callback): Transaction;
```

Defined in: [packages/db/src/collection/index.ts:797](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L797)

Updates one or more items in the collection using a callback function

##### Parameters

###### id

`unknown`

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
await tx.isPersisted.promise
```

```ts
// Update multiple items
const tx = collection.update(["todo-1", "todo-2"], (drafts) => {
  drafts.forEach(draft => { draft.completed = true })
})
await tx.isPersisted.promise
```

```ts
// Update with metadata
const tx = collection.update("todo-1",
  { metadata: { reason: "user update" } },
  (draft) => { draft.text = "Updated text" }
)
await tx.isPersisted.promise
```

```ts
// Handle errors
try {
  const tx = collection.update("item-1", draft => { draft.value = "new" })
  await tx.isPersisted.promise
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

Defined in: [packages/db/src/collection/index.ts:803](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L803)

Updates one or more items in the collection using a callback function

##### Parameters

###### id

`unknown`

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
await tx.isPersisted.promise
```

```ts
// Update multiple items
const tx = collection.update(["todo-1", "todo-2"], (drafts) => {
  drafts.forEach(draft => { draft.completed = true })
})
await tx.isPersisted.promise
```

```ts
// Update with metadata
const tx = collection.update("todo-1",
  { metadata: { reason: "user update" } },
  (draft) => { draft.text = "Updated text" }
)
await tx.isPersisted.promise
```

```ts
// Handle errors
try {
  const tx = collection.update("item-1", draft => { draft.value = "new" })
  await tx.isPersisted.promise
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

Defined in: [packages/db/src/collection/index.ts:690](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L690)

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

Defined in: [packages/db/src/collection/index.ts:562](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L562)

Get all values (virtual derived state)

#### Returns

`IterableIterator`\<[`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`TOutput`, `TKey`\>\>

***

### waitFor()

```ts
waitFor<T>(event, timeout?): Promise<AllCollectionEvents[T]>;
```

Defined in: [packages/db/src/collection/index.ts:1032](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L1032)

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
