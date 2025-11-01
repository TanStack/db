# POC: Store Pic (Concurrent Store) Pattern for useLiveQuery

This POC demonstrates adapting TanStack/db's `useLiveQuery` hook to use React's upcoming concurrent stores pattern (also called "store pic" pattern) instead of `useSyncExternalStore`.

## Background

React's `useSyncExternalStore` forces synchronous updates, which breaks React's concurrent features when mutating stores during non-blocking transitions. React is introducing a new "concurrent stores" API to solve this.

## Key Concepts

### Store Pic Pattern
The "store pic" (store picture/snapshot) pattern maintains two versions of state:

1. **Committed State**: The state shown to synchronous renders
2. **Pending State**: The state being rendered in a transition

This allows:
- New components mounting during a transition see the committed state
- Existing components in the transition continue to render the pending state
- No tearing between different parts of the UI

### State Rebasing
When a sync update happens during a transition:
1. The sync update applies on top of the committed state (not the pending state)
2. The transition then replays on top of the new committed state
3. Updates maintain chronological order: initial → transition → sync

## Implementation

This POC provides:

1. **CollectionStore**: Wraps a TanStack Collection with committed/pending state tracking
2. **useLiveQueryConcurrent**: Alternative implementation of useLiveQuery using the store pic pattern
3. **CollectionStoreProvider**: Context provider for managing store commits

## Files

- `CollectionStore.ts`: Core store implementation with state rebasing
- `useLiveQueryConcurrent.ts`: Hook using concurrent store pattern
- `StoreManager.ts`: Manages commit tracking across stores
- `Emitter.ts`: Simple event emitter utility

## Usage

```tsx
import { CollectionStoreProvider, useLiveQueryConcurrent } from './poc-store-pic'
import { todosCollection } from './collections'

function App() {
  return (
    <CollectionStoreProvider>
      <TodoList />
    </CollectionStoreProvider>
  )
}

function TodoList() {
  const { data, isLoading } = useLiveQueryConcurrent((q) =>
    q.from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.completed, false))
  )

  if (isLoading) return <div>Loading...</div>

  return (
    <ul>
      {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
    </ul>
  )
}
```

## Benefits

1. **Concurrent-Safe**: Works with React transitions and Suspense
2. **No Tearing**: Components mounting mid-transition see consistent state
3. **Proper Rebasing**: Sync updates during transitions apply correctly
4. **Future-Proof**: Aligns with upcoming React concurrent stores API

## References

- [React Concurrent Stores Announcement](https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more#concurrent-stores)
- [react-redux PR #2263](https://github.com/reduxjs/react-redux/pull/2263)
- [react-concurrent-store ponyfill](https://github.com/thejustinwalsh/react-concurrent-store)
