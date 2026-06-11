---
id: Collection
title: Collection
---

# Interface: Collection\<T, TKey, TUtils, TSchema, TInsertInput\>

Defined in: [packages/db/src/collection/index.ts:54](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L54)

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

Defined in: [packages/db/src/collection/index.ts:289](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L289)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_lifecycle`](../classes/CollectionImpl.md#_lifecycle)

***

### \_state

```ts
_state: CollectionStateManager<T, TKey, TSchema, TInsertInput>;
```

Defined in: [packages/db/src/collection/index.ts:301](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L301)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_state`](../classes/CollectionImpl.md#_state)

***

### \_sync

```ts
_sync: CollectionSyncManager<T, TKey, TSchema, TInsertInput>;
```

Defined in: [packages/db/src/collection/index.ts:290](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L290)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_sync`](../classes/CollectionImpl.md#_sync)

***

### config

```ts
config: CollectionConfig<T, TKey, TSchema>;
```

Defined in: [packages/db/src/collection/index.ts:280](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L280)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`config`](../classes/CollectionImpl.md#config)

***

### deferDataRefresh

```ts
deferDataRefresh: Promise<void> | null = null;
```

Defined in: [packages/db/src/collection/index.ts:308](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L308)

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

Defined in: [packages/db/src/collection/index.ts:279](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L279)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`id`](../classes/CollectionImpl.md#id)

***

### singleResult?

```ts
readonly optional singleResult: true;
```

Defined in: [packages/db/src/collection/index.ts:62](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L62)

***

### utils

```ts
readonly utils: TUtils;
```

Defined in: [packages/db/src/collection/index.ts:61](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L61)

#### Overrides

[`CollectionImpl`](../classes/CollectionImpl.md).[`utils`](../classes/CollectionImpl.md#utils)

## Accessors

### compareOptions

#### Get Signature

```ts
get compareOptions(): StringCollationConfig;
```

Defined in: [packages/db/src/collection/index.ts:643](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L643)

##### Returns

[`StringCollationConfig`](../type-aliases/StringCollationConfig.md)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`compareOptions`](../classes/CollectionImpl.md#compareoptions)

***

### indexes

#### Get Signature

```ts
get indexes(): Map<number, BaseIndex<TKey>>;
```

Defined in: [packages/db/src/collection/index.ts:628](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L628)

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

Defined in: [packages/db/src/collection/index.ts:456](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L456)

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

Defined in: [packages/db/src/collection/index.ts:493](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L493)

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

Defined in: [packages/db/src/collection/index.ts:820](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L820)

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

Defined in: [packages/db/src/collection/index.ts:411](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L411)

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

Defined in: [packages/db/src/collection/index.ts:418](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L418)

Get the number of subscribers to the collection

##### Returns

`number`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`subscriberCount`](../classes/CollectionImpl.md#subscribercount)

***

### toArray

#### Get Signature

```ts
get toArray(): WithVirtualProps<TOutput, TKey>[];
```

Defined in: [packages/db/src/collection/index.ts:849](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L849)

Gets the current state of the collection as an Array

##### Returns

[`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`TOutput`, `TKey`\>[]

An Array containing all items in the collection

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`toArray`](../classes/CollectionImpl.md#toarray)

## Methods

### \[iterator\]()

```ts
iterator: IterableIterator<[TKey, WithVirtualProps<T, TKey>]>;
```

Defined in: [packages/db/src/collection/index.ts:531](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L531)

Get all entries (virtual derived state)

#### Returns

`IterableIterator`\<\[`TKey`, [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`T`, `TKey`\>\]\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`[iterator]`](../classes/CollectionImpl.md#iterator)

***

### cleanup()

```ts
cleanup(): Promise<void>;
```

Defined in: [packages/db/src/collection/index.ts:988](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L988)

Clean up the collection by stopping sync and clearing data
This can be called manually or automatically by garbage collection

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`cleanup`](../classes/CollectionImpl.md#cleanup)

***

### createIndex()

```ts
createIndex<TIndexType>(indexCallback, config): BaseIndex<TKey>;
```

Defined in: [packages/db/src/collection/index.ts:597](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L597)

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
  | ChangeMessage<WithVirtualProps<T, TKey>, string | number>[];
```

Defined in: [packages/db/src/collection/index.ts:887](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L887)

Returns the current state of the collection as an array of changes

#### Parameters

##### options

[`CurrentStateAsChangesOptions`](CurrentStateAsChangesOptions.md) = `{}`

Options including optional where filter

#### Returns

  \| `void`
  \| [`ChangeMessage`](ChangeMessage.md)\<[`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`T`, `TKey`\>, `string` \| `number`\>[]

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

Defined in: [packages/db/src/collection/index.ts:797](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L797)

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

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`delete`](../classes/CollectionImpl.md#delete)

***

### entries()

```ts
entries(): IterableIterator<[TKey, WithVirtualProps<T, TKey>]>;
```

Defined in: [packages/db/src/collection/index.ts:519](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L519)

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

Defined in: [packages/db/src/collection/index.ts:540](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L540)

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

Defined in: [packages/db/src/collection/index.ts:479](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L479)

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

Defined in: [packages/db/src/collection/index.ts:621](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L621)

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

Defined in: [packages/db/src/collection/index.ts:571](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L571)

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

Defined in: [packages/db/src/collection/index.ts:486](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L486)

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
insert(data, config?): Transaction<Record<string, unknown>>;
```

Defined in: [packages/db/src/collection/index.ts:684](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L684)

Inserts one or more items into the collection

#### Parameters

##### data

`TInsertInput` | `TInsertInput`[]

##### config?

[`InsertConfig`](InsertConfig.md)

Optional configuration including metadata

#### Returns

[`Transaction`](Transaction.md)\<`Record`\<`string`, `unknown`\>\>

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

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`insert`](../classes/CollectionImpl.md#insert)

***

### isReady()

```ts
isReady(): boolean;
```

Defined in: [packages/db/src/collection/index.ts:448](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L448)

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

Defined in: [packages/db/src/collection/index.ts:500](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L500)

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

Defined in: [packages/db/src/collection/index.ts:556](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L556)

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

Defined in: [packages/db/src/collection/index.ts:967](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L967)

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

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`off`](../classes/CollectionImpl.md#off)

***

### on()

```ts
on<T>(event, callback): () => void;
```

Defined in: [packages/db/src/collection/index.ts:947](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L947)

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

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`on`](../classes/CollectionImpl.md#on)

***

### once()

```ts
once<T>(event, callback): () => void;
```

Defined in: [packages/db/src/collection/index.ts:957](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L957)

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

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`once`](../classes/CollectionImpl.md#once)

***

### onFirstReady()

```ts
onFirstReady(callback): void;
```

Defined in: [packages/db/src/collection/index.ts:432](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L432)

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

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`onFirstReady`](../classes/CollectionImpl.md#onfirstready)

***

### preload()

```ts
preload(): Promise<void>;
```

Defined in: [packages/db/src/collection/index.ts:472](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L472)

Preload the collection data by starting sync if not already started
Multiple concurrent calls will share the same promise

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`preload`](../classes/CollectionImpl.md#preload)

***

### removeIndex()

```ts
removeIndex(indexOrId): boolean;
```

Defined in: [packages/db/src/collection/index.ts:612](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L612)

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

Defined in: [packages/db/src/collection/index.ts:464](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L464)

Start sync immediately - internal method for compiled queries
This bypasses lazy loading for special cases like live query results

#### Returns

`void`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`startSyncImmediate`](../classes/CollectionImpl.md#startsyncimmediate)

***

### stateWhenReady()

```ts
stateWhenReady(): Promise<Map<TKey, WithVirtualProps<T, TKey>>>;
```

Defined in: [packages/db/src/collection/index.ts:834](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L834)

Gets the current state of the collection as a Map, but only resolves when data is available
Waits for the first sync commit to complete before resolving

#### Returns

`Promise`\<`Map`\<`TKey`, [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`T`, `TKey`\>\>\>

Promise that resolves to a Map containing all items in the collection

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`stateWhenReady`](../classes/CollectionImpl.md#statewhenready)

***

### subscribeChanges()

```ts
subscribeChanges(callback, options): CollectionSubscription;
```

Defined in: [packages/db/src/collection/index.ts:935](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L935)

Subscribe to changes in the collection

#### Parameters

##### callback

(`changes`) => `void`

Function called when items change

##### options

[`SubscribeChangesOptions`](SubscribeChangesOptions.md)\<`T`, `TKey`\> = `{}`

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

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`subscribeChanges`](../classes/CollectionImpl.md#subscribechanges)

***

### toArrayWhenReady()

```ts
toArrayWhenReady(): Promise<WithVirtualProps<T, TKey>[]>;
```

Defined in: [packages/db/src/collection/index.ts:859](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L859)

Gets the current state of the collection as an Array, but only resolves when data is available
Waits for the first sync commit to complete before resolving

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

Defined in: [packages/db/src/collection/index.ts:729](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L729)

Updates one or more items in the collection using a callback function

##### Parameters

###### key

`unknown`[]

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

##### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`update`](../classes/CollectionImpl.md#update)

#### Call Signature

```ts
update(
   keys, 
   config, 
   callback): Transaction;
```

Defined in: [packages/db/src/collection/index.ts:735](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L735)

Updates one or more items in the collection using a callback function

##### Parameters

###### keys

`unknown`[]

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

##### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`update`](../classes/CollectionImpl.md#update)

#### Call Signature

```ts
update(id, callback): Transaction;
```

Defined in: [packages/db/src/collection/index.ts:742](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L742)

Updates one or more items in the collection using a callback function

##### Parameters

###### id

`unknown`

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

##### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`update`](../classes/CollectionImpl.md#update)

#### Call Signature

```ts
update(
   id, 
   config, 
   callback): Transaction;
```

Defined in: [packages/db/src/collection/index.ts:748](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L748)

Updates one or more items in the collection using a callback function

##### Parameters

###### id

`unknown`

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

Defined in: [packages/db/src/collection/index.ts:635](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L635)

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

Defined in: [packages/db/src/collection/index.ts:507](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L507)

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

Defined in: [packages/db/src/collection/index.ts:977](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L977)

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

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`waitFor`](../classes/CollectionImpl.md#waitfor)
