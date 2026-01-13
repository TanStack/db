---
'@tanstack/solid-db': minor
---

Update solid-db to enable suspense support.
You can now run do

```tsx
// Use Suspense boundaries
const todosQuery = useLiveQuery((q) => q.from({ todos: todoCollection }))

return (
  <>
    {/* Status and other getters don't trigger Suspense */}
    <div>Status {todosQuery.status}</div>
    <div>Loading {todosQuery.isLoading ? 'yes' : 'no'}</div>

    <Suspense fallback={<div>Loading...</div>}>
      <For each={todosQuery()}>
        {(todo) => <li key={todo.id}>{todo.text}</li>}
      </For>
    </Suspense>
  </>
)
```

All values returned from useLiveQuery are now getters, so no longer need to be called as functions. This is a breaking change. This is to match how createResource works, and everything still stays reactive.

```tsx
const todos = useLiveQuery(() => existingCollection)

const handleToggle = (id) => {
  // Can now access collection directly
  todos.collection.update(id, (draft) => {
    draft.completed = !draft.completed
  })
}

return (
  <>
    {/* Status and other getters don't trigger Suspense */}
    <div>Status {todos.status}</div>
    <div>Loading {todos.isLoading ? 'yes' : 'no'}</div>
    <div>Ready {todos.isReady ? 'yes' : 'no'}</div>
    <div>Idle {todos.isIdle ? 'yes' : 'no'}</div>
    <div>Error {todos.isError ? 'yes' : 'no'}</div>
  </>
)
```
