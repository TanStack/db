---
id: createPacedMutations
title: createPacedMutations
---

# Function: createPacedMutations()

```ts
function createPacedMutations<TVariables, T>(config): (variables) => Transaction<T>;
```

Defined in: [packages/db/src/paced-mutations.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/paced-mutations.ts#L87)

Creates a paced mutations manager with pluggable timing strategies.

This function provides a way to control when and how optimistic mutations
are persisted to the backend, using strategies like debouncing, queuing,
or throttling. The optimistic updates are applied immediately via `onMutate`,
and the actual persistence is controlled by the strategy.

The returned function accepts variables of type TVariables and returns a
Transaction object that can be awaited to know when persistence completes
or to handle errors.

## Type Parameters

### TVariables

`TVariables` = `unknown`

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

## Parameters

### config

[`PacedMutationsConfig`](../../interfaces/PacedMutationsConfig.md)\<`TVariables`, `T`\>

Configuration including onMutate, mutationFn and strategy

## Returns

A function that accepts variables and returns a Transaction

```ts
(variables): Transaction<T>;
```

### Parameters

#### variables

`TVariables`

### Returns

[`Transaction`](../../interfaces/Transaction.md)\<`T`\>

## Examples

```ts
// Debounced mutations for auto-save
const updateTodo = createPacedMutations<string>({
  onMutate: (text) => {
    // Apply optimistic update immediately
    collection.update(id, draft => { draft.text = text })
  },
  mutationFn: async ({ transaction }) => {
    await api.save(transaction.mutations)
  },
  strategy: debounceStrategy({ wait: 500 })
})

// Call with variables, returns a transaction
const tx = updateTodo('New text')

// Await persistence or handle errors
await tx.isPersisted.promise
```

```ts
// Queue strategy for sequential processing
const addTodo = createPacedMutations<{ text: string }>({
  onMutate: ({ text }) => {
    collection.insert({ id: uuid(), text, completed: false })
  },
  mutationFn: async ({ transaction }) => {
    await api.save(transaction.mutations)
  },
  strategy: queueStrategy({
    wait: 200,
    addItemsTo: 'back',
    getItemsFrom: 'front'
  })
})
```
