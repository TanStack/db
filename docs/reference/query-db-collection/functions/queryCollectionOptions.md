---
id: queryCollectionOptions
title: queryCollectionOptions
---

# Function: queryCollectionOptions()

## Call Signature

```ts
function queryCollectionOptions<T, TQueryFn, TError, TQueryKey, TKey, TQueryData>(config): CollectionConfig<InferSchemaOutput<T>, TKey, T, QueryCollectionUtils<InferSchemaOutput<T>, TKey, InferSchemaInput<T>, TError>> & object;
```

Defined in: [packages/query-db-collection/src/query.ts:392](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L392)

Creates query collection options for use with a standard Collection.
This integrates TanStack Query with TanStack DB for automatic synchronization.

Supports automatic type inference following the priority order:
1. Schema inference (highest priority)
2. QueryFn return type inference (second priority)

### Type Parameters

#### T

`T` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

Type of the schema if a schema is provided otherwise it is the type of the values returned by the queryFn

#### TQueryFn

`TQueryFn` *extends* (`context`) => `Promise`\<`any`\>

#### TError

`TError` = `unknown`

The type of errors that can occur during queries

#### TQueryKey

`TQueryKey` *extends* readonly `unknown`[] = readonly `unknown`[]

The type of the query key

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

The type of the item keys

#### TQueryData

`TQueryData` = `Awaited`\<`ReturnType`\<`TQueryFn`\>\>

### Parameters

#### config

[`QueryCollectionConfig`](../../interfaces/QueryCollectionConfig.md)\<`InferSchemaOutput`\<`T`\>, `TQueryFn`, `TError`, `TQueryKey`, `TKey`, `T`, `Awaited`\<`ReturnType`\<`TQueryFn`\>\>\> & `object`

Configuration options for the Query collection

### Returns

`CollectionConfig`\<`InferSchemaOutput`\<`T`\>, `TKey`, `T`, [`QueryCollectionUtils`](../../interfaces/QueryCollectionUtils.md)\<`InferSchemaOutput`\<`T`\>, `TKey`, `InferSchemaInput`\<`T`\>, `TError`\>\> & `object`

Collection options with utilities for direct writes and manual operations

### Examples

```ts
// Type inferred from queryFn return type (NEW!)
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => {
      const response = await fetch('/api/todos')
      return response.json() as Todo[] // Type automatically inferred!
    },
    queryClient,
    getKey: (item) => item.id, // item is typed as Todo
  })
)
```

```ts
// Explicit type
const todosCollection = createCollection<Todo>(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => fetch('/api/todos').then(r => r.json()),
    queryClient,
    getKey: (item) => item.id,
  })
)
```

```ts
// Schema inference
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => fetch('/api/todos').then(r => r.json()),
    queryClient,
    schema: todoSchema, // Type inferred from schema
    getKey: (item) => item.id,
  })
)
```

```ts
// With persistence handlers
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: fetchTodos,
    queryClient,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      await api.createTodos(transaction.mutations.map(m => m.modified))
    },
    onUpdate: async ({ transaction }) => {
      await api.updateTodos(transaction.mutations)
    },
    onDelete: async ({ transaction }) => {
      await api.deleteTodos(transaction.mutations.map(m => m.key))
    }
  })
)
```

```ts
// The select option extracts the items array from a response with metadata
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => fetch('/api/todos').then(r => r.json()),
    select: (data) => data.items, // Extract the array of items
    queryClient,
    schema: todoSchema,
    getKey: (item) => item.id,
  })
)
```

## Call Signature

```ts
function queryCollectionOptions<T, TQueryFn, TError, TQueryKey, TKey, TQueryData>(config): CollectionConfig<T, TKey, never, QueryCollectionUtils<T, TKey, T, TError>> & object;
```

Defined in: [packages/query-db-collection/src/query.ts:427](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L427)

Creates query collection options for use with a standard Collection.
This integrates TanStack Query with TanStack DB for automatic synchronization.

Supports automatic type inference following the priority order:
1. Schema inference (highest priority)
2. QueryFn return type inference (second priority)

### Type Parameters

#### T

`T` *extends* `object`

Type of the schema if a schema is provided otherwise it is the type of the values returned by the queryFn

#### TQueryFn

`TQueryFn` *extends* (`context`) => `Promise`\<`any`\> = (`context`) => `Promise`\<`any`\>

#### TError

`TError` = `unknown`

The type of errors that can occur during queries

#### TQueryKey

`TQueryKey` *extends* readonly `unknown`[] = readonly `unknown`[]

The type of the query key

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

The type of the item keys

#### TQueryData

`TQueryData` = `Awaited`\<`ReturnType`\<`TQueryFn`\>\>

### Parameters

#### config

[`QueryCollectionConfig`](../../interfaces/QueryCollectionConfig.md)\<`T`, `TQueryFn`, `TError`, `TQueryKey`, `TKey`, `never`, `TQueryData`\> & `object`

Configuration options for the Query collection

### Returns

`CollectionConfig`\<`T`, `TKey`, `never`, [`QueryCollectionUtils`](../../interfaces/QueryCollectionUtils.md)\<`T`, `TKey`, `T`, `TError`\>\> & `object`

Collection options with utilities for direct writes and manual operations

### Examples

```ts
// Type inferred from queryFn return type (NEW!)
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => {
      const response = await fetch('/api/todos')
      return response.json() as Todo[] // Type automatically inferred!
    },
    queryClient,
    getKey: (item) => item.id, // item is typed as Todo
  })
)
```

```ts
// Explicit type
const todosCollection = createCollection<Todo>(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => fetch('/api/todos').then(r => r.json()),
    queryClient,
    getKey: (item) => item.id,
  })
)
```

```ts
// Schema inference
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => fetch('/api/todos').then(r => r.json()),
    queryClient,
    schema: todoSchema, // Type inferred from schema
    getKey: (item) => item.id,
  })
)
```

```ts
// With persistence handlers
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: fetchTodos,
    queryClient,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      await api.createTodos(transaction.mutations.map(m => m.modified))
    },
    onUpdate: async ({ transaction }) => {
      await api.updateTodos(transaction.mutations)
    },
    onDelete: async ({ transaction }) => {
      await api.deleteTodos(transaction.mutations.map(m => m.key))
    }
  })
)
```

```ts
// The select option extracts the items array from a response with metadata
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => fetch('/api/todos').then(r => r.json()),
    select: (data) => data.items, // Extract the array of items
    queryClient,
    schema: todoSchema,
    getKey: (item) => item.id,
  })
)
```

## Call Signature

```ts
function queryCollectionOptions<T, TError, TQueryKey, TKey>(config): CollectionConfig<InferSchemaOutput<T>, TKey, T, QueryCollectionUtils<InferSchemaOutput<T>, TKey, InferSchemaInput<T>, TError>> & object;
```

Defined in: [packages/query-db-collection/src/query.ts:460](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L460)

Creates query collection options for use with a standard Collection.
This integrates TanStack Query with TanStack DB for automatic synchronization.

Supports automatic type inference following the priority order:
1. Schema inference (highest priority)
2. QueryFn return type inference (second priority)

### Type Parameters

#### T

`T` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

Type of the schema if a schema is provided otherwise it is the type of the values returned by the queryFn

#### TError

`TError` = `unknown`

The type of errors that can occur during queries

#### TQueryKey

`TQueryKey` *extends* readonly `unknown`[] = readonly `unknown`[]

The type of the query key

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

The type of the item keys

### Parameters

#### config

[`QueryCollectionConfig`](../../interfaces/QueryCollectionConfig.md)\<`InferSchemaOutput`\<`T`\>, (`context`) => `Promise`\<`InferSchemaOutput`\<`T`\>[]\>, `TError`, `TQueryKey`, `TKey`, `T`, `InferSchemaOutput`\<`T`\>[]\> & `object`

Configuration options for the Query collection

### Returns

`CollectionConfig`\<`InferSchemaOutput`\<`T`\>, `TKey`, `T`, [`QueryCollectionUtils`](../../interfaces/QueryCollectionUtils.md)\<`InferSchemaOutput`\<`T`\>, `TKey`, `InferSchemaInput`\<`T`\>, `TError`\>\> & `object`

Collection options with utilities for direct writes and manual operations

### Examples

```ts
// Type inferred from queryFn return type (NEW!)
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => {
      const response = await fetch('/api/todos')
      return response.json() as Todo[] // Type automatically inferred!
    },
    queryClient,
    getKey: (item) => item.id, // item is typed as Todo
  })
)
```

```ts
// Explicit type
const todosCollection = createCollection<Todo>(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => fetch('/api/todos').then(r => r.json()),
    queryClient,
    getKey: (item) => item.id,
  })
)
```

```ts
// Schema inference
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => fetch('/api/todos').then(r => r.json()),
    queryClient,
    schema: todoSchema, // Type inferred from schema
    getKey: (item) => item.id,
  })
)
```

```ts
// With persistence handlers
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: fetchTodos,
    queryClient,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      await api.createTodos(transaction.mutations.map(m => m.modified))
    },
    onUpdate: async ({ transaction }) => {
      await api.updateTodos(transaction.mutations)
    },
    onDelete: async ({ transaction }) => {
      await api.deleteTodos(transaction.mutations.map(m => m.key))
    }
  })
)
```

```ts
// The select option extracts the items array from a response with metadata
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => fetch('/api/todos').then(r => r.json()),
    select: (data) => data.items, // Extract the array of items
    queryClient,
    schema: todoSchema,
    getKey: (item) => item.id,
  })
)
```

## Call Signature

```ts
function queryCollectionOptions<T, TError, TQueryKey, TKey>(config): CollectionConfig<T, TKey, never, QueryCollectionUtils<T, TKey, T, TError>> & object;
```

Defined in: [packages/query-db-collection/src/query.ts:494](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L494)

Creates query collection options for use with a standard Collection.
This integrates TanStack Query with TanStack DB for automatic synchronization.

Supports automatic type inference following the priority order:
1. Schema inference (highest priority)
2. QueryFn return type inference (second priority)

### Type Parameters

#### T

`T` *extends* `object`

Type of the schema if a schema is provided otherwise it is the type of the values returned by the queryFn

#### TError

`TError` = `unknown`

The type of errors that can occur during queries

#### TQueryKey

`TQueryKey` *extends* readonly `unknown`[] = readonly `unknown`[]

The type of the query key

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

The type of the item keys

### Parameters

#### config

[`QueryCollectionConfig`](../../interfaces/QueryCollectionConfig.md)\<`T`, (`context`) => `Promise`\<`T`[]\>, `TError`, `TQueryKey`, `TKey`, `never`, `T`[]\> & `object`

Configuration options for the Query collection

### Returns

`CollectionConfig`\<`T`, `TKey`, `never`, [`QueryCollectionUtils`](../../interfaces/QueryCollectionUtils.md)\<`T`, `TKey`, `T`, `TError`\>\> & `object`

Collection options with utilities for direct writes and manual operations

### Examples

```ts
// Type inferred from queryFn return type (NEW!)
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => {
      const response = await fetch('/api/todos')
      return response.json() as Todo[] // Type automatically inferred!
    },
    queryClient,
    getKey: (item) => item.id, // item is typed as Todo
  })
)
```

```ts
// Explicit type
const todosCollection = createCollection<Todo>(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => fetch('/api/todos').then(r => r.json()),
    queryClient,
    getKey: (item) => item.id,
  })
)
```

```ts
// Schema inference
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => fetch('/api/todos').then(r => r.json()),
    queryClient,
    schema: todoSchema, // Type inferred from schema
    getKey: (item) => item.id,
  })
)
```

```ts
// With persistence handlers
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: fetchTodos,
    queryClient,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      await api.createTodos(transaction.mutations.map(m => m.modified))
    },
    onUpdate: async ({ transaction }) => {
      await api.updateTodos(transaction.mutations)
    },
    onDelete: async ({ transaction }) => {
      await api.deleteTodos(transaction.mutations.map(m => m.key))
    }
  })
)
```

```ts
// The select option extracts the items array from a response with metadata
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => fetch('/api/todos').then(r => r.json()),
    select: (data) => data.items, // Extract the array of items
    queryClient,
    schema: todoSchema,
    getKey: (item) => item.id,
  })
)
```
