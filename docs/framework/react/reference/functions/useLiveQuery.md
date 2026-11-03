---
id: useLiveQuery
title: useLiveQuery
---

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn): object & LiveQueryStatusFlags;
```

Defined in: [useLiveQuery.ts:376](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L376)

Create a live query using a query function.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\>

Query function that defines what data to fetch

### Returns

`object` & `LiveQueryStatusFlags`

Object with reactive data, state, and status information

### Examples

```ts
// Prefer config object syntax
const { data, isLoading } = useLiveQuery({
  query: (q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
})
```

```ts
// Single result query
const { data } = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => eq(todos.id, 1))
         .findOne()
})
```

```ts
// Structured captured values are included in derived query identity
const { data, state } = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority)),
})
```

```ts
// Return undefined or null to disable a query
const { data, isEnabled } = useLiveQuery({
  query: (q) => {
    if (!userId) return undefined
    return q.from({ todos: todosCollection })
            .where(({ todos }) => eq(todos.userId, userId))
  },
})
```

```ts
// Join pattern
const { data } = useLiveQuery({
  query: (q) =>
    q.from({ issues: issueCollection })
     .join({ persons: personCollection }, ({ issues, persons }) =>
       eq(issues.userId, persons.id)
     )
     .select(({ issues, persons }) => ({
       id: issues.id,
       title: issues.title,
       userName: persons.name
     }))
})
```

```ts
// Handle loading and error states
const { data, isLoading, isLoadingError, status } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
})

if (isLoading) return <div>Loading...</div>
if (isLoadingError) return <div>Error: {status}</div>

return (
  <ul>
    {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
  </ul>
)
```

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn): object & LiveQueryStatusFlags;
```

Defined in: [useLiveQuery.ts:387](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L387)

Create a live query using a query function.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\> \| `null` \| `undefined`

Query function that defines what data to fetch

### Returns

`object` & `LiveQueryStatusFlags`

Object with reactive data, state, and status information

### Examples

```ts
// Prefer config object syntax
const { data, isLoading } = useLiveQuery({
  query: (q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
})
```

```ts
// Single result query
const { data } = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => eq(todos.id, 1))
         .findOne()
})
```

```ts
// Structured captured values are included in derived query identity
const { data, state } = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority)),
})
```

```ts
// Return undefined or null to disable a query
const { data, isEnabled } = useLiveQuery({
  query: (q) => {
    if (!userId) return undefined
    return q.from({ todos: todosCollection })
            .where(({ todos }) => eq(todos.userId, userId))
  },
})
```

```ts
// Join pattern
const { data } = useLiveQuery({
  query: (q) =>
    q.from({ issues: issueCollection })
     .join({ persons: personCollection }, ({ issues, persons }) =>
       eq(issues.userId, persons.id)
     )
     .select(({ issues, persons }) => ({
       id: issues.id,
       title: issues.title,
       userName: persons.name
     }))
})
```

```ts
// Handle loading and error states
const { data, isLoading, isLoadingError, status } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
})

if (isLoading) return <div>Loading...</div>
if (isLoadingError) return <div>Error: {status}</div>

return (
  <ul>
    {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
  </ul>
)
```

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn): object & LiveQueryStatusFlags;
```

Defined in: [useLiveQuery.ts:400](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L400)

Create a live query using a query function.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => 
  \| `LiveQueryCollectionConfig`\<`TContext`, `RootQueryResult`\<`TContext`\>\>
  \| `null`
  \| `undefined`

Query function that defines what data to fetch

### Returns

`object` & `LiveQueryStatusFlags`

Object with reactive data, state, and status information

### Examples

```ts
// Prefer config object syntax
const { data, isLoading } = useLiveQuery({
  query: (q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
})
```

```ts
// Single result query
const { data } = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => eq(todos.id, 1))
         .findOne()
})
```

```ts
// Structured captured values are included in derived query identity
const { data, state } = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority)),
})
```

```ts
// Return undefined or null to disable a query
const { data, isEnabled } = useLiveQuery({
  query: (q) => {
    if (!userId) return undefined
    return q.from({ todos: todosCollection })
            .where(({ todos }) => eq(todos.userId, userId))
  },
})
```

```ts
// Join pattern
const { data } = useLiveQuery({
  query: (q) =>
    q.from({ issues: issueCollection })
     .join({ persons: personCollection }, ({ issues, persons }) =>
       eq(issues.userId, persons.id)
     )
     .select(({ issues, persons }) => ({
       id: issues.id,
       title: issues.title,
       userName: persons.name
     }))
})
```

```ts
// Handle loading and error states
const { data, isLoading, isLoadingError, status } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
})

if (isLoading) return <div>Loading...</div>
if (isLoadingError) return <div>Error: {status}</div>

return (
  <ul>
    {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
  </ul>
)
```

## Call Signature

```ts
function useLiveQuery<TResult, TKey, TUtils>(queryFn): object & LiveQueryStatusFlags;
```

Defined in: [useLiveQuery.ts:413](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L413)

Create a live query using a query function.

### Type Parameters

#### TResult

`TResult` *extends* `object`

#### TKey

`TKey` *extends* `string` \| `number`

#### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>

### Parameters

#### queryFn

(`q`) => 
  \| `Collection`\<`TResult`, `TKey`, `TUtils`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `TResult`\>
  \| `null`
  \| `undefined`

Query function that defines what data to fetch

### Returns

`object` & `LiveQueryStatusFlags`

Object with reactive data, state, and status information

### Examples

```ts
// Prefer config object syntax
const { data, isLoading } = useLiveQuery({
  query: (q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
})
```

```ts
// Single result query
const { data } = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => eq(todos.id, 1))
         .findOne()
})
```

```ts
// Structured captured values are included in derived query identity
const { data, state } = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority)),
})
```

```ts
// Return undefined or null to disable a query
const { data, isEnabled } = useLiveQuery({
  query: (q) => {
    if (!userId) return undefined
    return q.from({ todos: todosCollection })
            .where(({ todos }) => eq(todos.userId, userId))
  },
})
```

```ts
// Join pattern
const { data } = useLiveQuery({
  query: (q) =>
    q.from({ issues: issueCollection })
     .join({ persons: personCollection }, ({ issues, persons }) =>
       eq(issues.userId, persons.id)
     )
     .select(({ issues, persons }) => ({
       id: issues.id,
       title: issues.title,
       userName: persons.name
     }))
})
```

```ts
// Handle loading and error states
const { data, isLoading, isLoadingError, status } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
})

if (isLoading) return <div>Loading...</div>
if (isLoadingError) return <div>Error: {status}</div>

return (
  <ul>
    {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
  </ul>
)
```

## Call Signature

```ts
function useLiveQuery<TContext, TResult, TKey, TUtils>(queryFn): object & LiveQueryStatusFlags;
```

Defined in: [useLiveQuery.ts:430](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L430)

Create a live query using a query function.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

#### TResult

`TResult` *extends* `object`

#### TKey

`TKey` *extends* `string` \| `number`

#### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>

### Parameters

#### queryFn

(`q`) => 
  \| `QueryBuilder`\<`TContext`\>
  \| `LiveQueryCollectionConfig`\<`TContext`, `RootQueryResult`\<`TContext`\>\>
  \| `Collection`\<`TResult`, `TKey`, `TUtils`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `TResult`\>
  \| `null`
  \| `undefined`

Query function that defines what data to fetch

### Returns

`object` & `LiveQueryStatusFlags`

Object with reactive data, state, and status information

### Examples

```ts
// Prefer config object syntax
const { data, isLoading } = useLiveQuery({
  query: (q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
})
```

```ts
// Single result query
const { data } = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => eq(todos.id, 1))
         .findOne()
})
```

```ts
// Structured captured values are included in derived query identity
const { data, state } = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority)),
})
```

```ts
// Return undefined or null to disable a query
const { data, isEnabled } = useLiveQuery({
  query: (q) => {
    if (!userId) return undefined
    return q.from({ todos: todosCollection })
            .where(({ todos }) => eq(todos.userId, userId))
  },
})
```

```ts
// Join pattern
const { data } = useLiveQuery({
  query: (q) =>
    q.from({ issues: issueCollection })
     .join({ persons: personCollection }, ({ issues, persons }) =>
       eq(issues.userId, persons.id)
     )
     .select(({ issues, persons }) => ({
       id: issues.id,
       title: issues.title,
       userName: persons.name
     }))
})
```

```ts
// Handle loading and error states
const { data, isLoading, isLoadingError, status } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
})

if (isLoading) return <div>Loading...</div>
if (isLoadingError) return <div>Error: {status}</div>

return (
  <ul>
    {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
  </ul>
)
```

## Call Signature

```ts
function useLiveQuery<TContext>(config): object & LiveQueryStatusFlags;
```

Defined in: [useLiveQuery.ts:491](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L491)

Create a live query using configuration object

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### config

[`UseLiveQueryConfig`](../type-aliases/UseLiveQueryConfig.md)\<`TContext`\>

Configuration object with query and options

### Returns

`object` & `LiveQueryStatusFlags`

Object with reactive data, state, and status information

### Examples

```ts
// Basic config object usage
const { data, status } = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection }),
  gcTime: 60000
})
```

```ts
// With query builder and options
const queryBuilder = new Query()
  .from({ persons: collection })
  .where(({ persons }) => gt(persons.age, 30))
  .select(({ persons }) => ({ id: persons.id, name: persons.name }))

const { data, isReady } = useLiveQuery({
  query: queryBuilder,
})
```

```ts
// Handle all states uniformly
const { data, isLoading, isReady, isLoadingError } = useLiveQuery({
  query: (q) => q.from({ items: itemCollection })
})

if (isLoading) return <div>Loading...</div>
if (isLoadingError) return <div>Something went wrong</div>
if (!isReady) return <div>Preparing...</div>

return <div>{data.length} items loaded</div>
```

## Call Signature

```ts
function useLiveQuery<TContext>(config): object & LiveQueryStatusFlags;
```

Defined in: [useLiveQuery.ts:502](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L502)

Create a live query using a query function.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### config

[`ConditionalUseLiveQueryConfig`](../type-aliases/ConditionalUseLiveQueryConfig.md)\<`TContext`\>

### Returns

`object` & `LiveQueryStatusFlags`

Object with reactive data, state, and status information

### Examples

```ts
// Prefer config object syntax
const { data, isLoading } = useLiveQuery({
  query: (q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
})
```

```ts
// Single result query
const { data } = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => eq(todos.id, 1))
         .findOne()
})
```

```ts
// Structured captured values are included in derived query identity
const { data, state } = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority)),
})
```

```ts
// Return undefined or null to disable a query
const { data, isEnabled } = useLiveQuery({
  query: (q) => {
    if (!userId) return undefined
    return q.from({ todos: todosCollection })
            .where(({ todos }) => eq(todos.userId, userId))
  },
})
```

```ts
// Join pattern
const { data } = useLiveQuery({
  query: (q) =>
    q.from({ issues: issueCollection })
     .join({ persons: personCollection }, ({ issues, persons }) =>
       eq(issues.userId, persons.id)
     )
     .select(({ issues, persons }) => ({
       id: issues.id,
       title: issues.title,
       userName: persons.name
     }))
})
```

```ts
// Handle loading and error states
const { data, isLoading, isLoadingError, status } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
})

if (isLoading) return <div>Loading...</div>
if (isLoadingError) return <div>Error: {status}</div>

return (
  <ul>
    {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
  </ul>
)
```

## Call Signature

```ts
function useLiveQuery<TResult, TKey, TUtils>(liveQueryCollection): object & LiveQueryStatusFlags;
```

Defined in: [useLiveQuery.ts:542](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L542)

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

`Collection`\<`TResult`, `TKey`, `TUtils`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `TResult`\> & `NonSingleResult`

Pre-created live query collection to subscribe to

### Returns

`object` & `LiveQueryStatusFlags`

Object with reactive data, state, and status information

### Examples

```ts
// Using pre-created live query collection
const myLiveQuery = createLiveQueryCollection((q) =>
  q.from({ todos: todosCollection }).where(({ todos }) => eq(todos.active, true))
)
const { data, collection } = useLiveQuery(myLiveQuery)
```

```ts
// Access collection methods directly
const { data, collection, isReady } = useLiveQuery(existingCollection)

// Use collection for mutations
const handleToggle = (id) => {
  collection.update(id, draft => { draft.completed = !draft.completed })
}
```

```ts
// Handle states consistently
const { data, isLoading, isLoadingError } = useLiveQuery(sharedCollection)

if (isLoading) return <div>Loading...</div>
if (isLoadingError) return <div>Error loading data</div>

return <div>{data.map(item => <Item key={item.id} {...item} />)}</div>
```

## Call Signature

```ts
function useLiveQuery<TResult, TKey, TUtils>(liveQueryCollection): object & LiveQueryStatusFlags;
```

Defined in: [useLiveQuery.ts:557](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L557)

Create a live query using a query function.

### Type Parameters

#### TResult

`TResult` *extends* `object`

#### TKey

`TKey` *extends* `string` \| `number`

#### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>

### Parameters

#### liveQueryCollection

`Collection`\<`TResult`, `TKey`, `TUtils`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `TResult`\> & `SingleResult`

### Returns

`object` & `LiveQueryStatusFlags`

Object with reactive data, state, and status information

### Examples

```ts
// Prefer config object syntax
const { data, isLoading } = useLiveQuery({
  query: (q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
})
```

```ts
// Single result query
const { data } = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => eq(todos.id, 1))
         .findOne()
})
```

```ts
// Structured captured values are included in derived query identity
const { data, state } = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority)),
})
```

```ts
// Return undefined or null to disable a query
const { data, isEnabled } = useLiveQuery({
  query: (q) => {
    if (!userId) return undefined
    return q.from({ todos: todosCollection })
            .where(({ todos }) => eq(todos.userId, userId))
  },
})
```

```ts
// Join pattern
const { data } = useLiveQuery({
  query: (q) =>
    q.from({ issues: issueCollection })
     .join({ persons: personCollection }, ({ issues, persons }) =>
       eq(issues.userId, persons.id)
     )
     .select(({ issues, persons }) => ({
       id: issues.id,
       title: issues.title,
       userName: persons.name
     }))
})
```

```ts
// Handle loading and error states
const { data, isLoading, isLoadingError, status } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
})

if (isLoading) return <div>Loading...</div>
if (isLoadingError) return <div>Error: {status}</div>

return (
  <ul>
    {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
  </ul>
)
```
