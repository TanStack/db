---
id: indexedDBCollectionOptions
title: indexedDBCollectionOptions
---

## Call Signature

```ts
function indexedDBCollectionOptions<T, TKey>(config): CollectionConfig<InferSchemaOutput<T>, TKey, T, IndexedDBCollectionUtils<InferSchemaOutput<T>, InferSchemaInput<T>>> & object;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:371](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L371)

Creates IndexedDB collection options for use with a standard Collection.
This provides persistent local storage with cross-tab synchronization.

IMPORTANT: You must first create the database with createIndexedDB() and
pass the instance to this function. This ensures all stores are created
upfront in a single upgrade transaction.

### Type Parameters

#### T

`T` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### Parameters

#### config

[`IndexedDBCollectionConfig`](../interfaces/IndexedDBCollectionConfig.md)\<`InferSchemaOutput`\<`T`\>, `T`, `TKey`\> & `object`

### Returns

`CollectionConfig`\<`InferSchemaOutput`\<`T`\>, `TKey`, `T`, [`IndexedDBCollectionUtils`](../interfaces/IndexedDBCollectionUtils.md)\<`InferSchemaOutput`\<`T`\>, `InferSchemaInput`\<`T`\>\>\> & `object`

### Examples

```ts
// Step 1: Create database with all stores
const db = await createIndexedDB({
  name: 'myApp',
  version: 1,
  stores: ['todos', 'users'],
})

// Step 2: Create collections using the shared database
const todosCollection = createCollection(
  indexedDBCollectionOptions({
    db,
    name: 'todos',
    schema: todoSchema,
    getKey: (item: { id: string }) => item.id,
  })
)
```

```ts
// Without schema (explicit type)
const todosCollection = createCollection(
  indexedDBCollectionOptions<Todo>({
    db,
    name: 'todos',
    getKey: (item: { id: string }) => item.id,
  })
)
```

## Call Signature

```ts
function indexedDBCollectionOptions<T, TKey>(config): CollectionConfig<T, TKey, never, IndexedDBCollectionUtils<T>> & object;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:393](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L393)

Creates IndexedDB collection options for use with a standard Collection.
This provides persistent local storage with cross-tab synchronization.

IMPORTANT: You must first create the database with createIndexedDB() and
pass the instance to this function. This ensures all stores are created
upfront in a single upgrade transaction.

### Type Parameters

#### T

`T` *extends* `object`

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### Parameters

#### config

[`IndexedDBCollectionConfig`](../interfaces/IndexedDBCollectionConfig.md)\<`T`, `never`, `TKey`\> & `object`

### Returns

`CollectionConfig`\<`T`, `TKey`, `never`, [`IndexedDBCollectionUtils`](../interfaces/IndexedDBCollectionUtils.md)\<`T`\>\> & `object`

### Examples

```ts
// Step 1: Create database with all stores
const db = await createIndexedDB({
  name: 'myApp',
  version: 1,
  stores: ['todos', 'users'],
})

// Step 2: Create collections using the shared database
const todosCollection = createCollection(
  indexedDBCollectionOptions({
    db,
    name: 'todos',
    schema: todoSchema,
    getKey: (item: { id: string }) => item.id,
  })
)
```

```ts
// Without schema (explicit type)
const todosCollection = createCollection(
  indexedDBCollectionOptions<Todo>({
    db,
    name: 'todos',
    getKey: (item: { id: string }) => item.id,
  })
)
```
