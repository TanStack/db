---
id: createCollection
title: createCollection
---

# Function: createCollection()

## Call Signature

```ts
function createCollection<T, TKey, TUtils>(options): Collection<InferSchemaOutput<T>, TKey, TUtils, T, InferSchemaInput<T>> & NonSingleResult;
```

Defined in: packages/db/src/collection/index.ts:130

Creates a new Collection instance with the given configuration

### Type Parameters

#### T

`T` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

The schema type if a schema is provided, otherwise the type of items in the collection

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

The type of the key for the collection

#### TUtils

`TUtils` *extends* [`UtilsRecord`](../../type-aliases/UtilsRecord.md) = [`UtilsRecord`](../../type-aliases/UtilsRecord.md)

The utilities record type

### Parameters

#### options

[`CollectionConfig`](../../interfaces/CollectionConfig.md)\<[`InferSchemaOutput`](../../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `T`, [`UtilsRecord`](../../type-aliases/UtilsRecord.md)\> & `object` & [`NonSingleResult`](../../type-aliases/NonSingleResult.md)

Collection options with optional utilities

### Returns

[`Collection`](../../interfaces/Collection.md)\<[`InferSchemaOutput`](../../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `TUtils`, `T`, [`InferSchemaInput`](../../type-aliases/InferSchemaInput.md)\<`T`\>\> & [`NonSingleResult`](../../type-aliases/NonSingleResult.md)

A new Collection with utilities exposed both at top level and under .utils

### Examples

```ts
// Pattern 1: With operation handlers (direct collection calls)
const todos = createCollection({
  id: "todos",
  getKey: (todo) => todo.id,
  schema,
  onInsert: async ({ transaction, collection }) => {
    // Send to API
    await api.createTodo(transaction.mutations[0].modified)
  },
  onUpdate: async ({ transaction, collection }) => {
    await api.updateTodo(transaction.mutations[0].modified)
  },
  onDelete: async ({ transaction, collection }) => {
    await api.deleteTodo(transaction.mutations[0].key)
  },
  sync: { sync: () => {} }
})

// Direct usage (handlers manage transactions)
const tx = todos.insert({ id: "1", text: "Buy milk", completed: false })
await tx.isPersisted.promise
```

```ts
// Pattern 2: Manual transaction management
const todos = createCollection({
  getKey: (todo) => todo.id,
  schema: todoSchema,
  sync: { sync: () => {} }
})

// Explicit transaction usage
const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    // Handle all mutations in transaction
    await api.saveChanges(transaction.mutations)
  }
})

tx.mutate(() => {
  todos.insert({ id: "1", text: "Buy milk" })
  todos.update("2", draft => { draft.completed = true })
})

await tx.isPersisted.promise
```

```ts
// Using schema for type inference (preferred as it also gives you client side validation)
const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean()
})

const todos = createCollection({
  schema: todoSchema,
  getKey: (todo) => todo.id,
  sync: { sync: () => {} }
})
```

## Call Signature

```ts
function createCollection<T, TKey, TUtils>(options): Collection<InferSchemaOutput<T>, TKey, TUtils, T, InferSchemaInput<T>> & SingleResult;
```

Defined in: packages/db/src/collection/index.ts:143

Creates a new Collection instance with the given configuration

### Type Parameters

#### T

`T` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

The schema type if a schema is provided, otherwise the type of items in the collection

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

The type of the key for the collection

#### TUtils

`TUtils` *extends* [`UtilsRecord`](../../type-aliases/UtilsRecord.md) = [`UtilsRecord`](../../type-aliases/UtilsRecord.md)

The utilities record type

### Parameters

#### options

[`CollectionConfig`](../../interfaces/CollectionConfig.md)\<[`InferSchemaOutput`](../../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `T`, [`UtilsRecord`](../../type-aliases/UtilsRecord.md)\> & `object` & [`SingleResult`](../../type-aliases/SingleResult.md)

Collection options with optional utilities

### Returns

[`Collection`](../../interfaces/Collection.md)\<[`InferSchemaOutput`](../../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `TUtils`, `T`, [`InferSchemaInput`](../../type-aliases/InferSchemaInput.md)\<`T`\>\> & [`SingleResult`](../../type-aliases/SingleResult.md)

A new Collection with utilities exposed both at top level and under .utils

### Examples

```ts
// Pattern 1: With operation handlers (direct collection calls)
const todos = createCollection({
  id: "todos",
  getKey: (todo) => todo.id,
  schema,
  onInsert: async ({ transaction, collection }) => {
    // Send to API
    await api.createTodo(transaction.mutations[0].modified)
  },
  onUpdate: async ({ transaction, collection }) => {
    await api.updateTodo(transaction.mutations[0].modified)
  },
  onDelete: async ({ transaction, collection }) => {
    await api.deleteTodo(transaction.mutations[0].key)
  },
  sync: { sync: () => {} }
})

// Direct usage (handlers manage transactions)
const tx = todos.insert({ id: "1", text: "Buy milk", completed: false })
await tx.isPersisted.promise
```

```ts
// Pattern 2: Manual transaction management
const todos = createCollection({
  getKey: (todo) => todo.id,
  schema: todoSchema,
  sync: { sync: () => {} }
})

// Explicit transaction usage
const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    // Handle all mutations in transaction
    await api.saveChanges(transaction.mutations)
  }
})

tx.mutate(() => {
  todos.insert({ id: "1", text: "Buy milk" })
  todos.update("2", draft => { draft.completed = true })
})

await tx.isPersisted.promise
```

```ts
// Using schema for type inference (preferred as it also gives you client side validation)
const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean()
})

const todos = createCollection({
  schema: todoSchema,
  getKey: (todo) => todo.id,
  sync: { sync: () => {} }
})
```

## Call Signature

```ts
function createCollection<T, TKey, TUtils>(options): Collection<T, TKey, TUtils, never, T> & NonSingleResult;
```

Defined in: packages/db/src/collection/index.ts:157

Creates a new Collection instance with the given configuration

### Type Parameters

#### T

`T` *extends* `object`

The schema type if a schema is provided, otherwise the type of items in the collection

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

The type of the key for the collection

#### TUtils

`TUtils` *extends* [`UtilsRecord`](../../type-aliases/UtilsRecord.md) = [`UtilsRecord`](../../type-aliases/UtilsRecord.md)

The utilities record type

### Parameters

#### options

[`CollectionConfig`](../../interfaces/CollectionConfig.md)\<`T`, `TKey`, `never`, [`UtilsRecord`](../../type-aliases/UtilsRecord.md)\> & `object` & [`NonSingleResult`](../../type-aliases/NonSingleResult.md)

Collection options with optional utilities

### Returns

[`Collection`](../../interfaces/Collection.md)\<`T`, `TKey`, `TUtils`, `never`, `T`\> & [`NonSingleResult`](../../type-aliases/NonSingleResult.md)

A new Collection with utilities exposed both at top level and under .utils

### Examples

```ts
// Pattern 1: With operation handlers (direct collection calls)
const todos = createCollection({
  id: "todos",
  getKey: (todo) => todo.id,
  schema,
  onInsert: async ({ transaction, collection }) => {
    // Send to API
    await api.createTodo(transaction.mutations[0].modified)
  },
  onUpdate: async ({ transaction, collection }) => {
    await api.updateTodo(transaction.mutations[0].modified)
  },
  onDelete: async ({ transaction, collection }) => {
    await api.deleteTodo(transaction.mutations[0].key)
  },
  sync: { sync: () => {} }
})

// Direct usage (handlers manage transactions)
const tx = todos.insert({ id: "1", text: "Buy milk", completed: false })
await tx.isPersisted.promise
```

```ts
// Pattern 2: Manual transaction management
const todos = createCollection({
  getKey: (todo) => todo.id,
  schema: todoSchema,
  sync: { sync: () => {} }
})

// Explicit transaction usage
const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    // Handle all mutations in transaction
    await api.saveChanges(transaction.mutations)
  }
})

tx.mutate(() => {
  todos.insert({ id: "1", text: "Buy milk" })
  todos.update("2", draft => { draft.completed = true })
})

await tx.isPersisted.promise
```

```ts
// Using schema for type inference (preferred as it also gives you client side validation)
const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean()
})

const todos = createCollection({
  schema: todoSchema,
  getKey: (todo) => todo.id,
  sync: { sync: () => {} }
})
```

## Call Signature

```ts
function createCollection<T, TKey, TUtils>(options): Collection<T, TKey, TUtils, never, T> & SingleResult;
```

Defined in: packages/db/src/collection/index.ts:170

Creates a new Collection instance with the given configuration

### Type Parameters

#### T

`T` *extends* `object`

The schema type if a schema is provided, otherwise the type of items in the collection

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

The type of the key for the collection

#### TUtils

`TUtils` *extends* [`UtilsRecord`](../../type-aliases/UtilsRecord.md) = [`UtilsRecord`](../../type-aliases/UtilsRecord.md)

The utilities record type

### Parameters

#### options

[`CollectionConfig`](../../interfaces/CollectionConfig.md)\<`T`, `TKey`, `never`, [`UtilsRecord`](../../type-aliases/UtilsRecord.md)\> & `object` & [`SingleResult`](../../type-aliases/SingleResult.md)

Collection options with optional utilities

### Returns

[`Collection`](../../interfaces/Collection.md)\<`T`, `TKey`, `TUtils`, `never`, `T`\> & [`SingleResult`](../../type-aliases/SingleResult.md)

A new Collection with utilities exposed both at top level and under .utils

### Examples

```ts
// Pattern 1: With operation handlers (direct collection calls)
const todos = createCollection({
  id: "todos",
  getKey: (todo) => todo.id,
  schema,
  onInsert: async ({ transaction, collection }) => {
    // Send to API
    await api.createTodo(transaction.mutations[0].modified)
  },
  onUpdate: async ({ transaction, collection }) => {
    await api.updateTodo(transaction.mutations[0].modified)
  },
  onDelete: async ({ transaction, collection }) => {
    await api.deleteTodo(transaction.mutations[0].key)
  },
  sync: { sync: () => {} }
})

// Direct usage (handlers manage transactions)
const tx = todos.insert({ id: "1", text: "Buy milk", completed: false })
await tx.isPersisted.promise
```

```ts
// Pattern 2: Manual transaction management
const todos = createCollection({
  getKey: (todo) => todo.id,
  schema: todoSchema,
  sync: { sync: () => {} }
})

// Explicit transaction usage
const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    // Handle all mutations in transaction
    await api.saveChanges(transaction.mutations)
  }
})

tx.mutate(() => {
  todos.insert({ id: "1", text: "Buy milk" })
  todos.update("2", draft => { draft.completed = true })
})

await tx.isPersisted.promise
```

```ts
// Using schema for type inference (preferred as it also gives you client side validation)
const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean()
})

const todos = createCollection({
  schema: todoSchema,
  getKey: (todo) => todo.id,
  sync: { sync: () => {} }
})
```
