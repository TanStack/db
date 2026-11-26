---
id: useLiveQuery
title: useLiveQuery
---

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn): Result<InferResultType<TContext>, GetResult<TContext>, Collection<GetResult<TContext>, string | number, {}>>;
```

Defined in: [useLiveQuery.ts:133](https://github.com/TanStack/db/blob/main/packages/solid-db/src/useLiveQuery.ts#L133)

Create a live query using a query function

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\>

Query function that defines what data to fetch

### Returns

`Result`\<`InferResultType`\<`TContext`\>, `GetResult`\<`TContext`\>, `Collection`\<`GetResult`\<`TContext`\>, `string` \| `number`, `{}`\>\>

Accessor that returns the current rows synchronously, with the status flags, `state`, `collection`, and the `loaded` first-data gate

### Examples

```ts
// Basic query with object syntax
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todosCollection })
   .where(({ todos }) => eq(todos.completed, false))
   .select(({ todos }) => ({ id: todos.id, text: todos.text }))
)

<For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>
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
const todosQuery = useLiveQuery((q) => q.from({ todos: todoCollection }))

return (
  <Errored fallback={(err) => <div>Error: {String(err())}</div>}>
    <Loading fallback={<div>Loading...</div>}>
      <For each={todosQuery.loaded()}>
        {(todo) => <li>{todo.text}</li>}
      </For>
    </Loading>
  </Errored>
)
```

```ts
// Without boundaries: branch on the status flags instead
<Switch>
  <Match when={todosQuery.isLoadingError || todosQuery.isCrashed}>
    <div>Could not load todos</div>
  </Match>
  <Match when={todosQuery.isLoading}><div>Loading...</div></Match>
  <Match when={todosQuery.isReady}>
    <For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>
  </Match>
</Switch>
```

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn): Result<InferConditionalResultType<TContext>, GetResult<TContext>, Collection<GetResult<TContext>, string | number, {}> | null>;
```

Defined in: [useLiveQuery.ts:153](https://github.com/TanStack/db/blob/main/packages/solid-db/src/useLiveQuery.ts#L153)

Create a live query using a query function that can return `null` or `undefined` to disable the query. The accessor returns no rows, `status` is `disabled`, `isReady` is `true`, and `collection` is `null`.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\> \| `null` \| `undefined`

Query function that defines what data to fetch

### Returns

`Result`\<`InferConditionalResultType`\<`TContext`\>, `GetResult`\<`TContext`\>, `Collection`\<`GetResult`\<`TContext`\>, `string` \| `number`, `{}`\> \| `null`\>

Accessor that returns the current rows synchronously, with the status flags, `state`, `collection` (`null` while disabled), and the `loaded` first-data gate

### Examples

```ts
const todosQuery = useLiveQuery((q) =>
  enabled() ? q.from({ todos: todosCollection }) : null,
)
```

## Call Signature

```ts
function useLiveQuery<TContext>(config): Result<InferResultType<TContext>, GetResult<TContext>, Collection<GetResult<TContext>, string | number, {}>>;
```

Defined in: [useLiveQuery.ts:188](https://github.com/TanStack/db/blob/main/packages/solid-db/src/useLiveQuery.ts#L188)

Create a live query using configuration object

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### config

`Accessor`\<`LiveQueryHookConfig`\<`TContext`, `RootQueryResult`\<`TContext`\>\>\>

Configuration object with query and options

### Returns

`Result`\<`InferResultType`\<`TContext`\>, `GetResult`\<`TContext`\>, `Collection`\<`GetResult`\<`TContext`\>, `string` \| `number`, `{}`\>\>

Accessor that returns the current rows synchronously, with the status flags, `state`, `collection`, and the `loaded` first-data gate

### Examples

```ts
// Basic config object usage
const todosQuery = useLiveQuery(() => ({
  query: (q) => q.from({ todos: todosCollection }),
  gcTime: 60000
}))
```

```ts
// Handle loading and errors through boundaries
const itemsQuery = useLiveQuery(() => ({
  query: (q) => q.from({ items: itemCollection })
}))

return (
  <Errored fallback={(err) => <div>Something went wrong: {String(err())}</div>}>
    <Loading fallback={<div>Loading...</div>}>
      <div>{itemsQuery.loaded().length} items loaded</div>
    </Loading>
  </Errored>
)
```

## Call Signature

```ts
function useLiveQuery<TResult, TKey, TUtils>(liveQueryCollection): Result<Array<TResult>, TResult, Collection<TResult, TKey, TUtils>>;
```

Defined in: [useLiveQuery.ts:213](https://github.com/TanStack/db/blob/main/packages/solid-db/src/useLiveQuery.ts#L213)

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

`Result`\<`Array`\<`TResult`\>, `TResult`, `Collection`\<`TResult`, `TKey`, `TUtils`\>\>

Accessor that returns the current rows synchronously, with the status flags, `state`, `collection`, and the `loaded` first-data gate

### Examples

```ts
// Using pre-created live query collection
const myLiveQuery = createLiveQueryCollection((q) =>
  q.from({ todos: todosCollection }).where(({ todos }) => eq(todos.active, true))
)
const todosQuery = useLiveQuery(() => myLiveQuery)
```

```ts
// Use the collection for mutations
const handleToggle = (id: string) => {
  todosQuery.collection.update(id, draft => { draft.completed = !draft.completed })
}
```

## Call Signature

```ts
function useLiveQuery<TResult, TKey, TUtils>(liveQueryCollection): Result<TResult | undefined, TResult, Collection<TResult, TKey, TUtils> & SingleResult>;
```

Defined in: [useLiveQuery.ts:235](https://github.com/TanStack/db/blob/main/packages/solid-db/src/useLiveQuery.ts#L235)

Subscribe to an existing single-result live query collection (one built with `findOne`). The accessor returns one row, or `undefined` until there is one.

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

Pre-created single-result live query collection to subscribe to

### Returns

`Result`\<`TResult` \| `undefined`, `TResult`, `Collection`\<`TResult`, `TKey`, `TUtils`\> & `SingleResult`\>

Accessor that returns the current row synchronously (`undefined` when there is none), with the status flags, `state`, `collection`, and the `loaded` first-data gate

### Examples

```ts
const userQuery = useLiveQuery(() => currentUserQuery)

return <Show when={userQuery()}>{(user) => <div>{user().name}</div>}</Show>
```
