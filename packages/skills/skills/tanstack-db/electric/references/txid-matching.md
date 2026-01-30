# Txid Matching

Wait for Electric sync using PostgreSQL transaction IDs.

## Overview

When you persist a mutation to Postgres, Electric streams the change back. To prevent UI glitches (optimistic update removed then re-added), wait for the specific transaction to sync before removing optimistic state.

## Basic Pattern

Return `txid` from mutation handlers:

```tsx
const todosCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    getKey: (item) => item.id,
    shapeOptions: { url: '/api/todos' },

    onInsert: async ({ transaction }) => {
      const newItem = transaction.mutations[0].modified
      const response = await api.todos.create(newItem)

      // Return txid to wait for sync
      return { txid: response.txid }
    },

    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      const response = await api.todos.update({
        where: { id: original.id },
        data: changes
      })

      return { txid: response.txid }
    }
  })
)
```

## Backend Implementation

Query `pg_current_xact_id()` **inside** the same transaction as your mutation:

```typescript
async function createTodo(data) {
  let txid!: number

  const result = await sql.begin(async (tx) => {
    // MUST call inside transaction
    txid = await generateTxId(tx)

    const [todo] = await tx`
      INSERT INTO todos ${tx(data)}
      RETURNING *
    `
    return todo
  })

  return { todo: result, txid }
}

async function generateTxId(tx: any): Promise<number> {
  // ::xid cast gives raw 32-bit value matching Electric's stream
  const result = await tx`SELECT pg_current_xact_id()::xid::text as txid`
  const txid = result[0]?.txid

  if (txid === undefined) {
    throw new Error('Failed to get transaction ID')
  }

  return parseInt(txid, 10)
}
```

## Critical: Query Inside Transaction

**Common Bug**: Querying txid outside the mutation transaction causes matching to fail.

```typescript
// WRONG - txid from separate transaction
async function createTodo(data) {
  const txid = await generateTxId(sql)  // Wrong: different transaction

  await sql.begin(async (tx) => {
    await tx`INSERT INTO todos ${tx(data)}`
  })

  return { txid }  // Won't match!
}

// CORRECT - txid from same transaction
async function createTodo(data) {
  let txid!: number

  await sql.begin(async (tx) => {
    txid = await generateTxId(tx)  // Correct: same transaction
    await tx`INSERT INTO todos ${tx(data)}`
  })

  return { txid }  // Matches!
}
```

## Manual Waiting

Use `awaitTxId` utility for custom actions:

```tsx
const addTodoAction = createOptimisticAction({
  onMutate: ({ text }) => {
    todosCollection.insert({
      id: crypto.randomUUID(),
      text,
      completed: false
    })
  },

  mutationFn: async ({ text }) => {
    const response = await api.todos.create({ text })

    // Wait for specific txid
    await todosCollection.utils.awaitTxId(response.txid)
  }
})
```

## With Custom Timeout

```tsx
// Default timeout is 30 seconds
await collection.utils.awaitTxId(txid)

// Custom timeout (10 seconds)
await collection.utils.awaitTxId(txid, 10000)
```

## Debugging Txid Issues

Enable debug logging:

```javascript
localStorage.debug = 'ts/db:electric'
```

### When Working

```
ts/db:electric awaitTxId called with txid 123
ts/db:electric new txids synced from pg [123]
ts/db:electric awaitTxId found match for txid 123
```

### When Broken (Common Bug)

```
ts/db:electric awaitTxId called with txid 124
ts/db:electric new txids synced from pg [123]
// Stalls forever - 124 never arrives!
```

The mutation happened in transaction 123, but you queried txid in a separate transaction (124).

## When Txid Isn't Available

Use custom match functions instead:

```tsx
import { isChangeMessage } from '@tanstack/electric-db-collection'

onInsert: async ({ transaction, collection }) => {
  const newItem = transaction.mutations[0].modified
  await api.todos.create(newItem)

  await collection.utils.awaitMatch(
    (message) =>
      isChangeMessage(message) &&
      message.headers.operation === 'insert' &&
      message.value.text === newItem.text,
    5000
  )
}
```

See [Custom Match Functions](./shapes.md) for more patterns.
