---
id: createOptimisticAction
title: createOptimisticAction
---

# Function: createOptimisticAction()

```ts
function createOptimisticAction<TVariables>(options): (variables) => Transaction;
```

Defined in: [packages/db/src/optimistic-action.ts:52](https://github.com/TanStack/db/blob/main/packages/db/src/optimistic-action.ts#L52)

Creates an optimistic action function that applies local optimistic updates immediately
before executing the actual mutation on the server.

This pattern allows for responsive UI updates while the actual mutation is in progress.
The optimistic update is applied via the `onMutate` callback, and the server mutation
is executed via the `mutationFn`.

**Important:** Inside your `mutationFn`, you must ensure that your server writes have synced back
before you return, as the optimistic state is dropped when you return from the mutation function.
You generally use collection-specific helpers to do this, such as Query's `utils.refetch()`,
direct write APIs, or Electric's `utils.awaitTxId()`.

## Type Parameters

### TVariables

`TVariables` = `unknown`

The type of variables that will be passed to the action function

## Parameters

### options

[`CreateOptimisticActionsOptions`](../../interfaces/CreateOptimisticActionsOptions.md)\<`TVariables`\>

Configuration options for the optimistic action

## Returns

A function that accepts variables of type TVariables and returns a Transaction

```ts
(variables): Transaction;
```

### Parameters

#### variables

`TVariables`

### Returns

[`Transaction`](../../interfaces/Transaction.md)

## Example

```ts
const addTodo = createOptimisticAction<string>({
  onMutate: (text) => {
    // Instantly applies local optimistic state
    todoCollection.insert({
      id: uuid(),
      text,
      completed: false
    })
  },
  mutationFn: async (text, params) => {
    // Persist the todo to your backend
    const response = await fetch('/api/todos', {
      method: 'POST',
      body: JSON.stringify({ text, completed: false }),
    })
    const result = await response.json()

    // IMPORTANT: Ensure server writes have synced back before returning
    // This ensures the optimistic state can be safely discarded
    await todoCollection.utils.refetch()

    return result
  }
})

// Usage
const transaction = addTodo('New Todo Item')
```
