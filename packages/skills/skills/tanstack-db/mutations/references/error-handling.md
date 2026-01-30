# Error Handling

Handle mutation failures gracefully with automatic rollback and recovery patterns.

## Automatic Rollback

When a mutation handler throws, optimistic state rolls back automatically:

```tsx
const todoCollection = createCollection({
  onUpdate: async ({ transaction }) => {
    const response = await api.update(...)
    if (!response.ok) {
      throw new Error('Update failed') // Triggers rollback
    }
  },
})

// User sees optimistic update immediately
todoCollection.update(id, (d) => { d.completed = true })

// If handler throws, UI reverts to previous state
```

## Catching Mutation Errors

### Using Transaction Promise

```tsx
const tx = todoCollection.update(id, (draft) => {
  draft.completed = true
})

try {
  await tx.isPersisted.promise
  toast.success('Saved!')
} catch (error) {
  toast.error(`Failed: ${error.message}`)
}
```

### With Custom Actions

```tsx
const updateTodo = createOptimisticAction<{ id: string; changes: Partial<Todo> }>({
  onMutate: ({ id, changes }) => {
    todoCollection.update(id, (d) => Object.assign(d, changes))
  },
  mutationFn: async ({ id, changes }, { signal }) => {
    const response = await api.update(id, changes, { signal })
    if (!response.ok) {
      throw new Error('Update failed')
    }
    await todoCollection.utils.refetch()
  },
})

// Handle at call site
try {
  await updateTodo({ id: '1', changes: { text: 'New text' } })
} catch (error) {
  console.error('Update failed:', error)
}
```

## Retry Patterns

TanStack DB does not auto-retry. Implement retry logic in handlers:

### Simple Retry

```tsx
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt === maxRetries - 1) throw error
      await new Promise((r) => setTimeout(r, delay * (attempt + 1)))
    }
  }
  throw new Error('Unreachable')
}

const todoCollection = createCollection({
  onUpdate: async ({ transaction }) => {
    await withRetry(() =>
      api.update(transaction.mutations[0].original.id, transaction.mutations[0].changes)
    )
  },
})
```

### With p-retry Library

```tsx
import pRetry from 'p-retry'

onUpdate: async ({ transaction }) => {
  await pRetry(
    () => api.update(...),
    {
      retries: 3,
      onFailedAttempt: (error) => {
        console.log(`Attempt ${error.attemptNumber} failed`)
      },
    }
  )
}
```

## Transaction State Monitoring

```tsx
const tx = todoCollection.update(id, (d) => { d.done = true })

// Poll state
const interval = setInterval(() => {
  console.log('State:', tx.state)
  if (tx.state === 'completed' || tx.state === 'failed') {
    clearInterval(interval)
  }
}, 100)

// Or use promise
tx.isPersisted.promise
  .then(() => console.log('Completed'))
  .catch((e) => console.log('Failed:', e))
```

## Schema Validation Errors

Schema validation happens before handlers run:

```tsx
import { SchemaValidationError } from '@tanstack/db'

try {
  todoCollection.insert({
    id: '1',
    text: '', // Invalid: min length 1
  })
} catch (error) {
  if (error instanceof SchemaValidationError) {
    console.log(error.type)    // 'insert'
    console.log(error.issues)  // [{ path: ['text'], message: '...' }]
  }
}
```

See [schemas/references/error-handling.md](../../schemas/references/error-handling.md) for more.

## Network Error Handling

```tsx
onUpdate: async ({ transaction }) => {
  try {
    const response = await fetch('/api/todos', {
      method: 'PATCH',
      body: JSON.stringify(transaction.mutations[0].changes),
    })

    if (!response.ok) {
      if (response.status === 409) {
        throw new Error('Conflict: data was modified by another user')
      }
      if (response.status === 403) {
        throw new Error('Permission denied')
      }
      throw new Error(`Server error: ${response.status}`)
    }
  } catch (error) {
    if (error.name === 'TypeError') {
      throw new Error('Network error: please check your connection')
    }
    throw error
  }
}
```

## Partial Failure Handling

When batching, handle partial failures:

```tsx
onUpdate: async ({ transaction }) => {
  const results = await Promise.allSettled(
    transaction.mutations.map((m) =>
      api.update(m.original.id, m.changes)
    )
  )

  const failures = results.filter((r) => r.status === 'rejected')
  if (failures.length > 0) {
    throw new Error(`${failures.length} of ${results.length} updates failed`)
  }
}
```

## User-Facing Error Messages

```tsx
function TodoItem({ todo }) {
  const [error, setError] = useState<string | null>(null)

  const toggleComplete = async () => {
    setError(null)
    const tx = todoCollection.update(todo.id, (d) => {
      d.completed = !d.completed
    })

    try {
      await tx.isPersisted.promise
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div>
      <span>{todo.text}</span>
      <button onClick={toggleComplete}>Toggle</button>
      {error && <span className="error">{error}</span>}
    </div>
  )
}
```

## Rollback vs Recovery

| Scenario | What Happens | User Experience |
|----------|--------------|-----------------|
| Handler throws | Auto-rollback | UI reverts, show error |
| Network timeout | Auto-rollback | UI reverts, retry option |
| Validation error | Never applied | Show validation message |
| Conflict | Auto-rollback | Refresh and retry |
