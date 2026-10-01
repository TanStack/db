---
id: useLiveQuery
title: useLiveQuery
---

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn): Accessor<InferResultType<TContext>> & object;
```

Defined in: [useLiveQuery.ts:112](https://github.com/TanStack/db/blob/main/packages/solid-db/src/useLiveQuery.ts#L112)

Create a live query using a query function

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\>

Query function that defines what data to fetch

### Returns

Accessor that returns data with Loading boundary support, with state and collection as properties

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
// Handle loading and error states with boundaries
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todoCollection })
)

return (
  <Errored catch={(err) => <div>Error: {err.message}</div>}>
    <Loading fallback={<div>Loading...</div>}>
      <For each={todosQuery()}>
        {(todo) => <li key={todo.id}>{todo.text}</li>}
      </For>
    </Loading>
  </Errored>
)
```

```ts
// Use Loading boundaries
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todoCollection })
)

return (
  <Loading fallback={<div>Loading...</div>}>
    <For each={todosQuery()}>
      {(todo) => <li key={todo.id}>{todo.text}</li>}
    </For>
  </Loading>
)
```

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn): Accessor<InferConditionalResultType<TContext>> & object;
```

Defined in: [useLiveQuery.ts:134](https://github.com/TanStack/db/blob/main/packages/solid-db/src/useLiveQuery.ts#L134)

Create a live query using a query function

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\> \| `null` \| `undefined`

Query function that defines what data to fetch

### Returns

Accessor that returns data with Loading boundary support, with state and collection as properties

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
// Handle loading and error states with boundaries
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todoCollection })
)

return (
  <Errored catch={(err) => <div>Error: {err.message}</div>}>
    <Loading fallback={<div>Loading...</div>}>
      <For each={todosQuery()}>
        {(todo) => <li key={todo.id}>{todo.text}</li>}
      </For>
    </Loading>
  </Errored>
)
```

```ts
// Use Loading boundaries
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todoCollection })
)

return (
  <Loading fallback={<div>Loading...</div>}>
    <For each={todosQuery()}>
      {(todo) => <li key={todo.id}>{todo.text}</li>}
    </For>
  </Loading>
)
```

## Call Signature

```ts
function useLiveQuery<TContext>(config): Accessor<InferResultType<TContext>> & object;
```

Defined in: [useLiveQuery.ts:198](https://github.com/TanStack/db/blob/main/packages/solid-db/src/useLiveQuery.ts#L198)

Create a live query using configuration object

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### config

`Accessor`\<`LiveQueryCollectionConfig`\<`TContext`, `RootQueryResult`\<`TContext`\>\>\>

Configuration object with query and options

### Returns

Accessor that returns data with Loading boundary support, with state and collection as properties

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

Defined in: [useLiveQuery.ts:255](https://github.com/TanStack/db/blob/main/packages/solid-db/src/useLiveQuery.ts#L255)

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

`Accessor`\<`Collection`\<`TResult`, `TKey`, `TUtils`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `TResult`\> & `NonSingleResult`\>

Pre-created live query collection to subscribe to

### Returns

Accessor that returns data with Loading boundary support, with state and collection as properties

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

## Call Signature

```ts
function useLiveQuery<TResult, TKey, TUtils>(liveQueryCollection): Accessor<TResult | undefined> & object;
```

Defined in: [useLiveQuery.ts:283](https://github.com/TanStack/db/blob/main/packages/solid-db/src/useLiveQuery.ts#L283)

Create a live query using a query function

### Type Parameters

#### TResult

`TResult` *extends* `object`

#### TKey

`TKey` *extends* `string` \| `number`

#### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>

### Parameters

#### liveQueryCollection

`Accessor`\<`Collection`\<`TResult`, `TKey`, `TUtils`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `TResult`\> & `SingleResult`\>

### Returns

Accessor that returns data with Loading boundary support, with state and collection as properties

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
// Handle loading and error states with boundaries
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todoCollection })
)

return (
  <Errored catch={(err) => <div>Error: {err.message}</div>}>
    <Loading fallback={<div>Loading...</div>}>
      <For each={todosQuery()}>
        {(todo) => <li key={todo.id}>{todo.text}</li>}
      </For>
    </Loading>
  </Errored>
)
```

```ts
// Use Loading boundaries
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todoCollection })
)

return (
  <Loading fallback={<div>Loading...</div>}>
    <For each={todosQuery()}>
      {(todo) => <li key={todo.id}>{todo.text}</li>}
    </For>
  </Loading>
)
```
