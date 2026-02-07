---
id: useLiveQuery
title: useLiveQuery
---

# Function: useLiveQuery()

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn): Accessor<{ [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }[]> & object;
```

Defined in: [useLiveQuery.ts:98](https://github.com/TanStack/db/blob/main/packages/solid-db/src/useLiveQuery.ts#L98)

Create a live query using a query function

## Virtual properties

Live query results include computed, read-only virtual properties on every row:

- `$synced`: `true` when the row is confirmed by sync; `false` when it is still optimistic.
- `$origin`: `"local"` if the last confirmed change came from this client, otherwise `"remote"`.
- `$key`: the row key for the result.
- `$collectionId`: the source collection ID.

These props can be used in `where`, `select`, and `orderBy` clauses. They are added to
query outputs automatically and should not be persisted back to storage.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\>

Query function that defines what data to fetch

### Returns

Accessor that returns data with Suspense support, with state and status information as properties

### Examples

```ts
// Basic query with object syntax
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todosCollection })
   .where(({ todos }) => eq(todos.completed, false))
   .select(({ todos }) => ({ id: todos.id, text: todos.text }))
)
```

```ts
// With dependencies that trigger re-execution
const todosQuery = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority())),
)
```

```ts
// Join pattern
const personIssues = useLiveQuery((q) =>
  q.from({ issues: issueCollection })
   .join({ persons: personCollection }, ({ issues, persons }) =>
     eq(issues.userId, persons.id)
   )
   .select(({ issues, persons }) => ({
     id: issues.id,
     title: issues.title,
     userName: persons.name
   }))
)
```

```ts
// Handle loading and error states
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todoCollection })
)

return (
  <Switch>
    <Match when={todosQuery.isLoading}>
      <div>Loading...</div>
    </Match>
    <Match when={todosQuery.isError}>
      <div>Error: {todosQuery.status}</div>
    </Match>
    <Match when={todosQuery.isReady}>
      <For each={todosQuery()}>
        {(todo) => <li key={todo.id}>{todo.text}</li>}
      </For>
    </Match>
  </Switch>
)
```

```ts
// Use Suspense boundaries
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todoCollection })
)

return (
  <Suspense fallback={<div>Loading...</div>}>
    <For each={todosQuery()}>
      {(todo) => <li key={todo.id}>{todo.text}</li>}
    </For>
  </Suspense>
)
```

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn): Accessor<{ [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }[]> & object;
```

Defined in: [useLiveQuery.ts:117](https://github.com/TanStack/db/blob/main/packages/solid-db/src/useLiveQuery.ts#L117)

Create a live query using a query function

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\> \| `null` \| `undefined`

Query function that defines what data to fetch

### Returns

Accessor that returns data with Suspense support, with state and status information as properties

### Examples

```ts
// Basic query with object syntax
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todosCollection })
   .where(({ todos }) => eq(todos.completed, false))
   .select(({ todos }) => ({ id: todos.id, text: todos.text }))
)
```

```ts
// With dependencies that trigger re-execution
const todosQuery = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority())),
)
```

```ts
// Join pattern
const personIssues = useLiveQuery((q) =>
  q.from({ issues: issueCollection })
   .join({ persons: personCollection }, ({ issues, persons }) =>
     eq(issues.userId, persons.id)
   )
   .select(({ issues, persons }) => ({
     id: issues.id,
     title: issues.title,
     userName: persons.name
   }))
)
```

```ts
// Handle loading and error states
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todoCollection })
)

return (
  <Switch>
    <Match when={todosQuery.isLoading}>
      <div>Loading...</div>
    </Match>
    <Match when={todosQuery.isError}>
      <div>Error: {todosQuery.status}</div>
    </Match>
    <Match when={todosQuery.isReady}>
      <For each={todosQuery()}>
        {(todo) => <li key={todo.id}>{todo.text}</li>}
      </For>
    </Match>
  </Switch>
)
```

```ts
// Use Suspense boundaries
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todoCollection })
)

return (
  <Suspense fallback={<div>Loading...</div>}>
    <For each={todosQuery()}>
      {(todo) => <li key={todo.id}>{todo.text}</li>}
    </For>
  </Suspense>
)
```

## Call Signature

```ts
function useLiveQuery<TContext>(config): Accessor<{ [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }[]> & object;
```

Defined in: [useLiveQuery.ts:178](https://github.com/TanStack/db/blob/main/packages/solid-db/src/useLiveQuery.ts#L178)

Create a live query using configuration object

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### config

`Accessor`\<`LiveQueryCollectionConfig`\<`TContext`, \{ \[K in string \| number \| symbol\]: (TContext\["result"\] extends object ? any\[any\] : TContext\["hasJoins"\] extends true ? TContext\["schema"\] : TContext\["schema"\]\[TContext\["fromSourceName"\]\])\[K\] \} & `object`\>\>

Configuration object with query and options

### Returns

Accessor that returns data with Suspense support, with state and status information as properties

### Examples

```ts
// Basic config object usage
const todosQuery = useLiveQuery(() => ({
  query: (q) => q.from({ todos: todosCollection }),
  gcTime: 60000
}))
```

```ts
// With query builder and options
const queryBuilder = new Query()
  .from({ persons: collection })
  .where(({ persons }) => gt(persons.age, 30))
  .select(({ persons }) => ({ id: persons.id, name: persons.name }))

const personsQuery = useLiveQuery(() => ({ query: queryBuilder }))
```

```ts
// Handle all states uniformly
const itemsQuery = useLiveQuery(() => ({
  query: (q) => q.from({ items: itemCollection })
}))

return (
  <Switch fallback={<div>{itemsQuery().length} items loaded</div>}>
    <Match when={itemsQuery.isLoading}>
      <div>Loading...</div>
    </Match>
    <Match when={itemsQuery.isError}>
      <div>Something went wrong</div>
    </Match>
    <Match when={!itemsQuery.isReady}>
      <div>Preparing...</div>
    </Match>
  </Switch>
)
```

## Call Signature

```ts
function useLiveQuery<TResult, TKey, TUtils>(liveQueryCollection): Accessor<TResult[]> & object;
```

Defined in: [useLiveQuery.ts:232](https://github.com/TanStack/db/blob/main/packages/solid-db/src/useLiveQuery.ts#L232)

Subscribe to an existing live query collection

### Type Parameters

#### TResult

`TResult` *extends* `object`

#### TKey

`TKey` *extends* `string` \| `number`

#### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>

### Parameters

#### liveQueryCollection

`Accessor`\<`Collection`\<`TResult`, `TKey`, `TUtils`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `TResult`\>\>

Pre-created live query collection to subscribe to

### Returns

Accessor that returns data with Suspense support, with state and status information as properties

### Examples

```ts
// Using pre-created live query collection
const myLiveQuery = createLiveQueryCollection((q) =>
  q.from({ todos: todosCollection }).where(({ todos }) => eq(todos.active, true))
)
const todosQuery = useLiveQuery(() => myLiveQuery)
```

```ts
// Access collection methods directly
const existingQuery = useLiveQuery(() => existingCollection)

// Use collection for mutations
const handleToggle = (id) => {
  existingQuery.collection.update(id, draft => { draft.completed = !draft.completed })
}
```

```ts
// Handle states consistently
const sharedQuery = useLiveQuery(() => sharedCollection)

return (
 <Switch fallback={<div><For each={sharedQuery()}>{(item) => <Item key={item.id} {...item} />}</For></div>}>
   <Match when={sharedQuery.isLoading}>
     <div>Loading...</div>
   </Match>
   <Match when={sharedQuery.isError}>
     <div>Error loading data</div>
   </Match>
 </Switch>
)
```
