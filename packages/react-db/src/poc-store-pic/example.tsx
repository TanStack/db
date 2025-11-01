/**
 * Example: Using useLiveQueryConcurrent with the Store Pic Pattern
 *
 * This example demonstrates how the concurrent-safe hook works with
 * React transitions and prevents tearing.
 */

import { useTransition, useState } from "react"
import { eq, gt } from "@tanstack/db"
import {
  CollectionStoreProvider,
  useLiveQueryConcurrent,
} from "./index"

// Assume we have these collections defined elsewhere
// import { todosCollection, usersCollection } from './collections'
declare const todosCollection: any
declare const usersCollection: any

// ============================================================================
// Example 1: Basic Usage
// ============================================================================

function TodoList() {
  // Use the concurrent-safe hook just like useLiveQuery
  const { data, isLoading, isError } = useLiveQueryConcurrent((q) =>
    q
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.completed, false))
      .select(({ todos }) => ({
        id: todos.id,
        text: todos.text,
        priority: todos.priority,
      }))
  )

  if (isLoading) return <div>Loading...</div>
  if (isError) return <div>Error loading todos</div>

  return (
    <ul>
      {data.map((todo) => (
        <li key={todo.id}>
          {todo.text} (Priority: {todo.priority})
        </li>
      ))}
    </ul>
  )
}

// ============================================================================
// Example 2: With Dependencies
// ============================================================================

function FilteredTodos({ minPriority }: { minPriority: number }) {
  // Re-run query when minPriority changes
  const { data, isReady } = useLiveQueryConcurrent(
    (q) =>
      q
        .from({ todos: todosCollection })
        .where(({ todos }) => gt(todos.priority, minPriority)),
    [minPriority] // Dependencies trigger query re-execution
  )

  if (!isReady) return <div>Loading...</div>

  return (
    <div>
      <h2>High Priority Todos (>{minPriority})</h2>
      <ul>
        {data.map((todo) => (
          <li key={todo.id}>{todo.text}</li>
        ))}
      </ul>
    </div>
  )
}

// ============================================================================
// Example 3: With React Transitions (The Key Feature!)
// ============================================================================

function TodosWithTransition() {
  const [minPriority, setMinPriority] = useState(0)
  const [isPending, startTransition] = useTransition()

  // This query updates during transitions
  const { data, isReady } = useLiveQueryConcurrent(
    (q) =>
      q
        .from({ todos: todosCollection })
        .where(({ todos }) => gt(todos.priority, minPriority)),
    [minPriority]
  )

  const handleFilterChange = (newPriority: number) => {
    // Wrap the state update in a transition
    // The store pic pattern ensures:
    // 1. Existing components continue showing old data during transition
    // 2. New components mounting during transition see committed (old) state
    // 3. No tearing between different parts of the UI
    startTransition(() => {
      setMinPriority(newPriority)
    })
  }

  return (
    <div>
      <div>
        <button onClick={() => handleFilterChange(0)}>All</button>
        <button onClick={() => handleFilterChange(3)}>Medium+</button>
        <button onClick={() => handleFilterChange(5)}>High</button>
        {isPending && <span> (Updating...)</span>}
      </div>

      {isReady && (
        <ul>
          {data.map((todo) => (
            <li key={todo.id}>
              {todo.text} (Priority: {todo.priority})
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ============================================================================
// Example 4: Conditional/Disabled Queries
// ============================================================================

function ConditionalQuery({ userId }: { userId: number | null }) {
  // Query is disabled when userId is null
  const { data, isEnabled, isReady } = useLiveQueryConcurrent((q) => {
    if (!userId) return null // Disabled query

    return q
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.userId, userId))
  }, [userId])

  if (!isEnabled) return <div>Select a user to see their todos</div>
  if (!isReady) return <div>Loading...</div>

  return (
    <ul>
      {data?.map((todo) => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  )
}

// ============================================================================
// Example 5: Join Queries
// ============================================================================

function TodosWithUsers() {
  const { data, isLoading } = useLiveQueryConcurrent((q) =>
    q
      .from({ todos: todosCollection })
      .join({ users: usersCollection }, ({ todos, users }) =>
        eq(todos.userId, users.id)
      )
      .select(({ todos, users }) => ({
        id: todos.id,
        text: todos.text,
        userName: users.name,
        userEmail: users.email,
      }))
  )

  if (isLoading) return <div>Loading...</div>

  return (
    <ul>
      {data.map((item) => (
        <li key={item.id}>
          {item.text} - by {item.userName} ({item.userEmail})
        </li>
      ))}
    </ul>
  )
}

// ============================================================================
// Example 6: Using Pre-created Collection
// ============================================================================

// Create the collection outside component
// const sharedTodoCollection = createLiveQueryCollection((q) =>
//   q.from({ todos: todosCollection })
// )

declare const sharedTodoCollection: any

function SharedCollectionExample() {
  // Multiple components can use the same collection
  const { data, collection } = useLiveQueryConcurrent(sharedTodoCollection)

  const handleToggle = (id: number) => {
    // Use collection methods directly
    collection.update(id, (draft) => {
      draft.completed = !draft.completed
    })
  }

  return (
    <ul>
      {data.map((todo) => (
        <li key={todo.id} onClick={() => handleToggle(todo.id)}>
          {todo.text}
        </li>
      ))}
    </ul>
  )
}

// ============================================================================
// App Setup - IMPORTANT: Wrap with CollectionStoreProvider!
// ============================================================================

export function App() {
  return (
    // MUST wrap your app (or subtree) with the provider
    // This enables the store pic pattern
    <CollectionStoreProvider>
      <div>
        <h1>TanStack/db with Concurrent Stores</h1>

        <section>
          <h2>Basic Todo List</h2>
          <TodoList />
        </section>

        <section>
          <h2>With Transitions (No Tearing!)</h2>
          <TodosWithTransition />
        </section>

        <section>
          <h2>Todos with Users (Join)</h2>
          <TodosWithUsers />
        </section>
      </div>
    </CollectionStoreProvider>
  )
}

// ============================================================================
// Key Differences from useLiveQuery
// ============================================================================

/*
1. MUST wrap with <CollectionStoreProvider>
   - useLiveQuery: No provider needed
   - useLiveQueryConcurrent: REQUIRES CollectionStoreProvider

2. Concurrent-safe transitions
   - useLiveQuery: useTransition updates force sync (de-opts)
   - useLiveQueryConcurrent: Works properly with transitions

3. No tearing during transitions
   - useLiveQuery: Can tear when components mount mid-transition
   - useLiveQueryConcurrent: Maintains consistency via committed/pending snapshots

4. Performance considerations
   - useLiveQuery: Uses useSyncExternalStore (highly optimized)
   - useLiveQueryConcurrent: Uses store pic pattern (slight overhead for commit tracking)

5. Future alignment
   - useLiveQuery: Current React standard
   - useLiveQueryConcurrent: Aligns with upcoming React concurrent stores API
*/
