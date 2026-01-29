---
id: Collection
title: Collection
---

# Interface: Collection\<T, TKey, TUtils, TSchema, TInsertInput\>

Defined in: [packages/db/src/collection/index.ts:48](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L48)

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

Defined in: [packages/db/src/collection/index.ts:283](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L283)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_lifecycle`](../classes/CollectionImpl.md#_lifecycle)

***

### \_state

```ts
_state: CollectionStateManager<T, TKey, TSchema, TInsertInput>;
```

Defined in: [packages/db/src/collection/index.ts:295](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L295)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_state`](../classes/CollectionImpl.md#_state)

***

### \_sync

```ts
_sync: CollectionSyncManager<T, TKey, TSchema, TInsertInput>;
```

Defined in: [packages/db/src/collection/index.ts:284](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L284)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`_sync`](../classes/CollectionImpl.md#_sync)

***

### config

```ts
config: CollectionConfig<T, TKey, TSchema>;
```

Defined in: [packages/db/src/collection/index.ts:274](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L274)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`config`](../classes/CollectionImpl.md#config)

***

### id

```ts
id: string;
```

Defined in: [packages/db/src/collection/index.ts:273](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L273)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`id`](../classes/CollectionImpl.md#id)

***

### singleResult?

```ts
readonly optional singleResult: true;
```

Defined in: [packages/db/src/collection/index.ts:56](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L56)

***

### utils

```ts
readonly utils: TUtils;
```

Defined in: [packages/db/src/collection/index.ts:55](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L55)

#### Overrides

[`CollectionImpl`](../classes/CollectionImpl.md).[`utils`](../classes/CollectionImpl.md#utils)

## Accessors

### compareOptions

#### Get Signature

```ts
get compareOptions(): StringCollationConfig;
```

Defined in: [packages/db/src/collection/index.ts:580](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L580)

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

Defined in: [packages/db/src/collection/index.ts:565](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L565)

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

Defined in: [packages/db/src/collection/index.ts:431](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L431)

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

Defined in: [packages/db/src/collection/index.ts:468](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L468)

Get the current size of the collection (cached)

##### Returns

`number`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`size`](../classes/CollectionImpl.md#size)

***

### state

#### Get Signature

```ts
get state(): Map<TKey, TOutput>;
```

Defined in: [packages/db/src/collection/index.ts:757](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L757)

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

`Map`\<`TKey`, `TOutput`\>

Map containing all items in the collection, with keys as identifiers

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`state`](../classes/CollectionImpl.md#state)

***

### status

#### Get Signature

```ts
get status(): CollectionStatus;
```

Defined in: [packages/db/src/collection/index.ts:386](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L386)

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

Defined in: [packages/db/src/collection/index.ts:393](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L393)

Get the number of subscribers to the collection

##### Returns

`number`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`subscriberCount`](../classes/CollectionImpl.md#subscribercount)

***

### toArray

#### Get Signature

```ts
get toArray(): TOutput[];
```

Defined in: [packages/db/src/collection/index.ts:786](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L786)

Gets the current state of the collection as an Array

##### Returns

`TOutput`[]

An Array containing all items in the collection

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`toArray`](../classes/CollectionImpl.md#toarray)

## Methods

### \[iterator\]()

```ts
iterator: IterableIterator<[TKey, T]>;
```

Defined in: [packages/db/src/collection/index.ts:496](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L496)

Get all entries (virtual derived state)

#### Returns

`IterableIterator`\<\[`TKey`, `T`\]\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`[iterator]`](../classes/CollectionImpl.md#iterator)

***

### cleanup()

```ts
cleanup(): Promise<void>;
```

Defined in: [packages/db/src/collection/index.ts:923](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L923)

Clean up the collection by stopping sync and clearing data
This can be called manually or automatically by garbage collection

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`cleanup`](../classes/CollectionImpl.md#cleanup)

***

### createIndex()

```ts
createIndex<TResolver>(indexCallback, config): IndexProxy<TKey>;
```

Defined in: [packages/db/src/collection/index.ts:555](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L555)

Creates an index on a collection for faster queries.
Indexes significantly improve query performance by allowing constant time lookups
and logarithmic time range queries instead of full scans.

#### Type Parameters

##### TResolver

`TResolver` *extends* [`IndexResolver`](../type-aliases/IndexResolver.md)\<`TKey`\> = *typeof* [`BTreeIndex`](../classes/BTreeIndex.md)

The type of the index resolver (constructor or async loader)

#### Parameters

##### indexCallback

(`row`) => `any`

Function that extracts the indexed value from each item

##### config

[`IndexOptions`](IndexOptions.md)\<`TResolver`\> = `{}`

Configuration including index type and type-specific options

#### Returns

[`IndexProxy`](../classes/IndexProxy.md)\<`TKey`\>

An index proxy that provides access to the index when ready

#### Example

```ts
// Create a default B+ tree index
const ageIndex = collection.createIndex((row) => row.age)

// Create a ordered index with custom options
const ageIndex = collection.createIndex((row) => row.age, {
  indexType: BTreeIndex,
  options: {
    compareFn: customComparator,
    compareOptions: { direction: 'asc', nulls: 'first', stringSort: 'lexical' }
  },
  name: 'age_btree'
})

// Create an async-loaded index
const textIndex = collection.createIndex((row) => row.content, {
  indexType: async () => {
    const { FullTextIndex } = await import('./indexes/fulltext.js')
    return FullTextIndex
  },
  options: { language: 'en' }
})
```

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`createIndex`](../classes/CollectionImpl.md#createindex)

***

### currentStateAsChanges()

```ts
currentStateAsChanges(options): 
  | void
  | ChangeMessage<T, string | number>[];
```

Defined in: [packages/db/src/collection/index.ts:824](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L824)

Returns the current state of the collection as an array of changes

#### Parameters

##### options

[`CurrentStateAsChangesOptions`](CurrentStateAsChangesOptions.md) = `{}`

Options including optional where filter

#### Returns

  \| `void`
  \| [`ChangeMessage`](ChangeMessage.md)\<`T`, `string` \| `number`\>[]

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

Defined in: [packages/db/src/collection/index.ts:734](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L734)

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
entries(): IterableIterator<[TKey, T]>;
```

Defined in: [packages/db/src/collection/index.ts:489](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L489)

Get all entries (virtual derived state)

#### Returns

`IterableIterator`\<\[`TKey`, `T`\]\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`entries`](../classes/CollectionImpl.md#entries)

***

### forEach()

```ts
forEach(callbackfn): void;
```

Defined in: [packages/db/src/collection/index.ts:503](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L503)

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
get(key): T | undefined;
```

Defined in: [packages/db/src/collection/index.ts:454](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L454)

Get the current value for a key (virtual derived state)

#### Parameters

##### key

`TKey`

#### Returns

`T` \| `undefined`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`get`](../classes/CollectionImpl.md#get)

***

### getKeyFromItem()

```ts
getKeyFromItem(item): TKey;
```

Defined in: [packages/db/src/collection/index.ts:518](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L518)

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

Defined in: [packages/db/src/collection/index.ts:461](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L461)

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

Defined in: [packages/db/src/collection/index.ts:621](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L621)

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

Defined in: [packages/db/src/collection/index.ts:423](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L423)

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

Defined in: [packages/db/src/collection/index.ts:475](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L475)

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

Defined in: [packages/db/src/collection/index.ts:512](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L512)

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

Defined in: [packages/db/src/collection/index.ts:902](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L902)

Unsubscribe from a collection event

#### Type Parameters

##### T

`T` *extends* 
  \| `"status:idle"`
  \| `"status:loading"`
  \| `"status:ready"`
  \| `"status:error"`
  \| `"status:cleaned-up"`
  \| `"status:change"`
  \| `"subscribers:change"`
  \| `"loadingSubset:change"`
  \| `"truncate"`

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

Defined in: [packages/db/src/collection/index.ts:882](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L882)

Subscribe to a collection event

#### Type Parameters

##### T

`T` *extends* 
  \| `"status:idle"`
  \| `"status:loading"`
  \| `"status:ready"`
  \| `"status:error"`
  \| `"status:cleaned-up"`
  \| `"status:change"`
  \| `"subscribers:change"`
  \| `"loadingSubset:change"`
  \| `"truncate"`

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

Defined in: [packages/db/src/collection/index.ts:892](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L892)

Subscribe to a collection event once

#### Type Parameters

##### T

`T` *extends* 
  \| `"status:idle"`
  \| `"status:loading"`
  \| `"status:ready"`
  \| `"status:error"`
  \| `"status:cleaned-up"`
  \| `"status:change"`
  \| `"subscribers:change"`
  \| `"loadingSubset:change"`
  \| `"truncate"`

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

Defined in: [packages/db/src/collection/index.ts:407](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L407)

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

Defined in: [packages/db/src/collection/index.ts:447](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L447)

Preload the collection data by starting sync if not already started
Multiple concurrent calls will share the same promise

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`preload`](../classes/CollectionImpl.md#preload)

***

### startSyncImmediate()

```ts
startSyncImmediate(): void;
```

Defined in: [packages/db/src/collection/index.ts:439](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L439)

Start sync immediately - internal method for compiled queries
This bypasses lazy loading for special cases like live query results

#### Returns

`void`

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`startSyncImmediate`](../classes/CollectionImpl.md#startsyncimmediate)

***

### stateWhenReady()

```ts
stateWhenReady(): Promise<Map<TKey, T>>;
```

Defined in: [packages/db/src/collection/index.ts:771](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L771)

Gets the current state of the collection as a Map, but only resolves when data is available
Waits for the first sync commit to complete before resolving

#### Returns

`Promise`\<`Map`\<`TKey`, `T`\>\>

Promise that resolves to a Map containing all items in the collection

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`stateWhenReady`](../classes/CollectionImpl.md#statewhenready)

***

### subscribeChanges()

```ts
subscribeChanges(callback, options): CollectionSubscription;
```

Defined in: [packages/db/src/collection/index.ts:872](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L872)

Subscribe to changes in the collection

#### Parameters

##### callback

(`changes`) => `void`

Function called when items change

##### options

[`SubscribeChangesOptions`](SubscribeChangesOptions.md)\<`T`\> = `{}`

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
toArrayWhenReady(): Promise<T[]>;
```

Defined in: [packages/db/src/collection/index.ts:796](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L796)

Gets the current state of the collection as an Array, but only resolves when data is available
Waits for the first sync commit to complete before resolving

#### Returns

`Promise`\<`T`[]\>

Promise that resolves to an Array containing all items in the collection

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`toArrayWhenReady`](../classes/CollectionImpl.md#toarraywhenready)

***

### update()

#### Call Signature

```ts
update(key, callback): Transaction;
```

Defined in: [packages/db/src/collection/index.ts:666](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L666)

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

Defined in: [packages/db/src/collection/index.ts:672](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L672)

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

Defined in: [packages/db/src/collection/index.ts:679](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L679)

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

Defined in: [packages/db/src/collection/index.ts:685](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L685)

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

Defined in: [packages/db/src/collection/index.ts:572](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L572)

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
values(): IterableIterator<T>;
```

Defined in: [packages/db/src/collection/index.ts:482](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L482)

Get all values (virtual derived state)

#### Returns

`IterableIterator`\<`T`\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`values`](../classes/CollectionImpl.md#values)

***

### waitFor()

```ts
waitFor<T>(event, timeout?): Promise<AllCollectionEvents[T]>;
```

Defined in: [packages/db/src/collection/index.ts:912](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L912)

Wait for a collection event

#### Type Parameters

##### T

`T` *extends* 
  \| `"status:idle"`
  \| `"status:loading"`
  \| `"status:ready"`
  \| `"status:error"`
  \| `"status:cleaned-up"`
  \| `"status:change"`
  \| `"subscribers:change"`
  \| `"loadingSubset:change"`
  \| `"truncate"`

#### Parameters

##### event

`T`

##### timeout?

`number`

#### Returns

`Promise`\<`AllCollectionEvents`\[`T`\]\>

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`waitFor`](../classes/CollectionImpl.md#waitfor)
