---
title: Error Handling
id: error-handling
---

# Error Handling

TanStack DB provides comprehensive error handling capabilities to ensure robust data synchronization and state management. This guide covers the built-in error handling mechanisms and how to work with them effectively.

## Error Types

TanStack DB provides named error classes for better error handling and type safety. All error classes can be imported from `@tanstack/db` (or more commonly, the framework-specific package e.g. `@tanstack/react-db`):

```ts
import {
  SchemaValidationError,
  CollectionInErrorStateError,
  DuplicateKeyError,
  MissingHandlerError,
  TransactionError,
  // ... and many more
} from "@tanstack/db"
```

### SchemaValidationError

Thrown when data doesn't match the collection's schema during insert or update operations:

```ts
import { SchemaValidationError } from "@tanstack/db"

try {
  todoCollection.insert({ text: 123 }) // Invalid type
} catch (error) {
  if (error instanceof SchemaValidationError) {
    console.log(error.type) // 'insert' or 'update'
    console.log(error.issues) // Array of validation issues
    // Example issue: { message: "Expected string, received number", path: ["text"] }
  }
}
```

The error includes:
- `type`: Whether it was an 'insert' or 'update' operation
- `issues`: Array of validation issues with messages and paths
- `message`: A formatted error message listing all issues

## Collection Status and Error States

Collections track their status and transition between states:

```tsx
import { useLiveQuery } from "@tanstack/react-db"

const TodoList = () => {
  const { data, status, isError, isLoading, isReady } = useLiveQuery(
    (query) => query.from({ todos: todoCollection })
  )

  if (isError) {
    return <div>Collection is in error state</div>
  }

  if (isLoading) {
    return <div>Loading...</div>
  }

  return <div>{data?.map(todo => <div key={todo.id}>{todo.text}</div>)}</div>
}
```

Collection status values:
- `idle` - Not yet started
- `loading` - Loading initial data
- `initialCommit` - Processing initial data
- `ready` - Ready for use
- `error` - In error state
- `cleaned-up` - Cleaned up and no longer usable

## Transaction Error Handling

When mutations fail, TanStack DB automatically rolls back optimistic updates:

```ts
const todoCollection = createCollection({
  id: "todos",
  onInsert: async ({ transaction }) => {
    const response = await fetch("/api/todos", {
      method: "POST",
      body: JSON.stringify(transaction.mutations[0].modified),
    })
    
    if (!response.ok) {
      // Throwing an error will rollback the optimistic state
      throw new Error(`HTTP Error: ${response.status}`)
    }
    
    return response.json()
  },
})

// Usage - optimistic update will be rolled back if the mutation fails
try {
  const tx = await todoCollection.insert({
    id: "1",
    text: "New todo",
    completed: false,
  })
  
  await tx.isPersisted.promise
} catch (error) {
  // The optimistic update has been automatically rolled back
  console.error("Failed to create todo:", error)
}
```

### Transaction States and Error Information

Transactions have the following states:
- `pending` - Transaction is being processed
- `persisting` - Currently executing the mutation function
- `completed` - Transaction completed successfully
- `failed` - Transaction failed and was rolled back

Access transaction error information from collection operations:

```ts
const todoCollection = createCollection({
  id: "todos",
  onUpdate: async ({ transaction }) => {
    const response = await fetch(`/api/todos/${transaction.mutations[0].key}`, {
      method: "PUT",
      body: JSON.stringify(transaction.mutations[0].modified),
    })
    
    if (!response.ok) {
      throw new Error(`Update failed: ${response.status}`)
    }
  },
})

try {
  const tx = await todoCollection.update("todo-1", (draft) => {
    draft.completed = true
  })
  
  await tx.isPersisted.promise
} catch (error) {
  // Transaction has been rolled back
  console.log(tx.state) // "failed"
  console.log(tx.error) // { message: "Update failed: 500", error: Error }
}
```

Or with manual transaction creation:

```ts
const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    throw new Error("API failed")
  }
})

tx.mutate(() => {
  collection.insert({ id: "1", text: "Item" })
})

try {
  await tx.commit()
} catch (error) {
  // Transaction has been rolled back
  console.log(tx.state) // "failed"
  console.log(tx.error) // { message: "API failed", error: Error }
}
```

## Collection Operation Errors

### Invalid Collection State

Collections in an `error` state cannot perform operations and must be manually recovered:

```ts
import { CollectionInErrorStateError } from "@tanstack/db"

try {
  todoCollection.insert(newTodo)
} catch (error) {
  if (error instanceof CollectionInErrorStateError) {
    // Collection needs to be cleaned up and restarted
    await todoCollection.cleanup()
    
    // Now retry the operation
    todoCollection.insert(newTodo)
  }
}
```

### Missing Mutation Handlers

Direct mutations require handlers to be configured:

```ts
const todoCollection = createCollection({
  id: "todos",
  getKey: (todo) => todo.id,
  // Missing onInsert handler
})

// This will throw an error
todoCollection.insert(newTodo)
// Error: Collection.insert called directly (not within an explicit transaction) but no 'onInsert' handler is configured
```

### Duplicate Key Errors

Inserting items with existing keys will throw:

```ts
import { DuplicateKeyError } from "@tanstack/db"

try {
  todoCollection.insert({ id: "existing-id", text: "Todo" })
} catch (error) {
  if (error instanceof DuplicateKeyError) {
    console.log(`Duplicate key: ${error.message}`)
  }
}
```

### Schema Validation Errors

Schema validation must be synchronous:

```ts
const todoCollection = createCollection({
  id: "todos",
  getKey: (todo) => todo.id,
  schema: {
    "~standard": {
      validate: async (data) => { // Async validation not allowed
        // ...
      }
    }
  }
})

// Will throw: Schema validation must be synchronous
```

## Sync Error Handling

### Query Collection Sync Errors

Query collections handle sync errors gracefully and mark the collection as ready even on error to avoid blocking applications:

```ts
import { queryCollectionOptions } from "@tanstack/query-db-collection"

const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["todos"],
    queryFn: async () => {
      const response = await fetch("/api/todos")
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`)
      }
      return response.json()
    },
    queryClient,
    getKey: (item) => item.id,
    schema: todoSchema,
    // Standard TanStack Query error handling options
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })
)
```

When sync errors occur:
- Error is logged to console: `[QueryCollection] Error observing query...`
- Collection is marked as ready to prevent blocking the application
- Cached data remains available

### Sync Write Errors

Sync functions must handle their own errors during write operations:

```ts
const collection = createCollection({
  id: "todos",
  sync: {
    sync: ({ begin, write, commit }) => {
      begin()
      
      try {
        // Will throw if key already exists
        write({ type: "insert", value: { id: "existing-id", text: "Todo" } })
      } catch (error) {
        // Error: Cannot insert document with key "existing-id" from sync because it already exists
      }
      
      commit()
    }
  }
})
```

### Cleanup Error Handling

Cleanup errors are isolated to prevent blocking the cleanup process:

```ts
const collection = createCollection({
  id: "todos",
  sync: {
    sync: ({ begin, commit }) => {
      begin()
      commit()
      
      // Return a cleanup function
      return () => {
        // If this throws, the error is re-thrown in a microtask
        // but cleanup continues successfully
        throw new Error("Sync cleanup failed")
      }
    },
  },
})

// Cleanup completes even if the sync cleanup function throws
await collection.cleanup() // Resolves successfully
// Error is re-thrown asynchronously via queueMicrotask
```

## Error Recovery Patterns

### Collection Cleanup and Restart

Clean up collections in error states:

```ts
if (todoCollection.status === "error") {
  // Cleanup will stop sync and reset the collection
  await todoCollection.cleanup()
  
  // Collection will automatically restart on next access
  todoCollection.preload() // Or any other operation
}
```

### Graceful Degradation

Collections continue to work with cached data even when sync fails:

```tsx
const TodoApp = () => {
  const { data, isError } = useLiveQuery((query) => 
    query.from({ todos: todoCollection })
  )

  return (
    <div>
      {isError && (
        <div>Sync failed, but you can still view cached data</div>
      )}
      {data?.map(todo => <TodoItem key={todo.id} todo={todo} />)}
    </div>
  )
}
```

### Transaction Rollback Cascading

When a transaction fails, conflicting transactions are automatically rolled back:

```ts
const tx1 = createTransaction({ mutationFn: async () => {} })
const tx2 = createTransaction({ mutationFn: async () => {} })

tx1.mutate(() => collection.update("1", draft => { draft.value = "A" }))
tx2.mutate(() => collection.update("1", draft => { draft.value = "B" })) // Same item

// Rolling back tx1 will also rollback tx2 due to conflict
tx1.rollback() // tx2 is automatically rolled back
```

### Handling Invalid State Errors

Transactions validate their state before operations:

```ts
const tx = createTransaction({ mutationFn: async () => {} })

// Complete the transaction
await tx.commit()

// These will throw:
tx.mutate(() => {}) // Error: You can no longer call .mutate() as the transaction is no longer pending
tx.commit() // Error: You can no longer call .commit() as the transaction is no longer pending
tx.rollback() // Error: You can no longer call .rollback() as the transaction is already completed
```

## Best Practices

1. **Use instanceof checks** - Use `instanceof` instead of string matching for error handling:
   ```ts
   // ✅ Good - type-safe error handling
   if (error instanceof SchemaValidationError) {
     // Handle validation error
   }
   
   // ❌ Avoid - brittle string matching  
   if (error.message.includes("validation failed")) {
     // Handle validation error
   }
   ```

2. **Import specific error types** - Import only the error classes you need for better tree-shaking
3. **Always handle SchemaValidationError** - Provide clear feedback for validation failures
4. **Check collection status** - Use `isError`, `isLoading`, `isReady` flags in React components
5. **Handle transaction promises** - Always handle `isPersisted.promise` rejections

## Example: Complete Error Handling

```tsx
import { 
  createCollection, 
  SchemaValidationError,
  DuplicateKeyError,
  createTransaction
} from "@tanstack/db"
import { useLiveQuery } from "@tanstack/react-db"

const todoCollection = createCollection({
  id: "todos",
  schema: todoSchema,
  getKey: (todo) => todo.id,
  onInsert: async ({ transaction }) => {
    const response = await fetch("/api/todos", {
      method: "POST",
      body: JSON.stringify(transaction.mutations[0].modified),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return response.json()
  },
  sync: {
    sync: ({ begin, write, commit }) => {
      // Your sync implementation
      begin()
      // ... sync logic
      commit()
    }
  }
})

const TodoApp = () => {
  const { data, status, isError, isLoading } = useLiveQuery(
    (query) => query.from({ todos: todoCollection })
  )

  const handleAddTodo = async (text: string) => {
    try {
      const tx = await todoCollection.insert({
        id: crypto.randomUUID(),
        text,
        completed: false,
      })
      
      // Wait for persistence
      await tx.isPersisted.promise
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        alert(`Validation error: ${error.issues[0]?.message}`)
      } else if (error instanceof DuplicateKeyError) {
        alert("A todo with this ID already exists")
      } else {
        alert(`Failed to add todo: ${error.message}`)
      }
    }
  }

  const handleCleanup = async () => {
    try {
      await todoCollection.cleanup()
      // Collection will restart on next access
    } catch (error) {
      console.error("Cleanup failed:", error)
    }
  }

  if (isError) {
    return (
      <div>
        <div>Collection error - data may be stale</div>
        <button onClick={handleCleanup}>
          Restart Collection
        </button>
      </div>
    )
  }

  if (isLoading) {
    return <div>Loading todos...</div>
  }

  return (
    <div>
      <button onClick={() => handleAddTodo("New todo")}>
        Add Todo
      </button>
      {data?.map(todo => (
        <div key={todo.id}>{todo.text}</div>
      ))}
    </div>
  )
}
```

## See Also

- [Mutations Guide](./overview.md#mutations) - Learn about optimistic updates and rollbacks
- [API Reference](./overview.md#api-reference) - Detailed API documentation
- [TanStack Query Error Handling](https://tanstack.com/query/latest/docs/react/guides/error-handling) - Query-specific error handling
