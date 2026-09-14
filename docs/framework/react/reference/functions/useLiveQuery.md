---
id: useLiveQuery
title: useLiveQuery
---

# Function: useLiveQuery()

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn, deps?): object;
```

Defined in: [useLiveQuery.ts:360](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L360)

Create a live query using a query function.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\>

Query function that defines what data to fetch

#### deps?

`unknown`[]

Deprecated array of dependencies that trigger query re-execution when changed

### Returns

`object`

Object with reactive data, state, and status information

#### collection

```ts
collection: Collection<{ [K in string | number | symbol]: ResultValue<TContext>[K] }, string | number, {
}>;
```

#### data

```ts
data: InferResultType<TContext>;
```

#### isCleanedUp

```ts
isCleanedUp: boolean;
```

#### isEnabled

```ts
isEnabled: true;
```

#### isError

```ts
isError: boolean;
```

#### isIdle

```ts
isIdle: boolean;
```

#### isLoading

```ts
isLoading: boolean;
```

#### isReady

```ts
isReady: boolean;
```

#### state

```ts
state: Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>;
```

#### status

```ts
status: CollectionStatus;
```

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
const { data, isLoading, isError, status } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
})

if (isLoading) return <div>Loading...</div>
if (isError) return <div>Error: {status}</div>

return (
  <ul>
    {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
  </ul>
)
```

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn, deps?): object;
```

Defined in: [useLiveQuery.ts:377](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L377)

Create a live query using a query function.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\> \| `null` \| `undefined`

Query function that defines what data to fetch

#### deps?

`unknown`[]

Deprecated array of dependencies that trigger query re-execution when changed

### Returns

`object`

Object with reactive data, state, and status information

#### collection

```ts
collection: 
  | Collection<{ [K in string | number | symbol]: ResultValue<TContext>[K] }, string | number, {
}, StandardSchemaV1<unknown, unknown>, { [K in string | number | symbol]: ResultValue<TContext>[K] }>
  | undefined;
```

#### data

```ts
data: InferResultType<TContext> | undefined;
```

#### isCleanedUp

```ts
isCleanedUp: boolean;
```

#### isEnabled

```ts
isEnabled: boolean;
```

#### isError

```ts
isError: boolean;
```

#### isIdle

```ts
isIdle: boolean;
```

#### isLoading

```ts
isLoading: boolean;
```

#### isReady

```ts
isReady: boolean;
```

#### state

```ts
state: 
  | Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>
  | undefined;
```

#### status

```ts
status: UseLiveQueryStatus;
```

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
const { data, isLoading, isError, status } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
})

if (isLoading) return <div>Loading...</div>
if (isError) return <div>Error: {status}</div>

return (
  <ul>
    {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
  </ul>
)
```

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn, deps?): object;
```

Defined in: [useLiveQuery.ts:396](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L396)

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

#### deps?

`unknown`[]

Deprecated array of dependencies that trigger query re-execution when changed

### Returns

`object`

Object with reactive data, state, and status information

#### collection

```ts
collection: 
  | Collection<{ [K in string | number | symbol]: ResultValue<TContext>[K] }, string | number, {
}, StandardSchemaV1<unknown, unknown>, { [K in string | number | symbol]: ResultValue<TContext>[K] }>
  | undefined;
```

#### data

```ts
data: InferResultType<TContext> | undefined;
```

#### isCleanedUp

```ts
isCleanedUp: boolean;
```

#### isEnabled

```ts
isEnabled: boolean;
```

#### isError

```ts
isError: boolean;
```

#### isIdle

```ts
isIdle: boolean;
```

#### isLoading

```ts
isLoading: boolean;
```

#### isReady

```ts
isReady: boolean;
```

#### state

```ts
state: 
  | Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>
  | undefined;
```

#### status

```ts
status: UseLiveQueryStatus;
```

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
const { data, isLoading, isError, status } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
})

if (isLoading) return <div>Loading...</div>
if (isError) return <div>Error: {status}</div>

return (
  <ul>
    {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
  </ul>
)
```

## Call Signature

```ts
function useLiveQuery<TResult, TKey, TUtils>(queryFn, deps?): object;
```

Defined in: [useLiveQuery.ts:415](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L415)

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

#### deps?

`unknown`[]

Deprecated array of dependencies that trigger query re-execution when changed

### Returns

`object`

Object with reactive data, state, and status information

#### collection

```ts
collection: 
  | Collection<TResult, TKey, TUtils, StandardSchemaV1<unknown, unknown>, TResult>
  | undefined;
```

#### data

```ts
data: TResult[] | undefined;
```

#### isCleanedUp

```ts
isCleanedUp: boolean;
```

#### isEnabled

```ts
isEnabled: boolean;
```

#### isError

```ts
isError: boolean;
```

#### isIdle

```ts
isIdle: boolean;
```

#### isLoading

```ts
isLoading: boolean;
```

#### isReady

```ts
isReady: boolean;
```

#### state

```ts
state: Map<TKey, TResult> | undefined;
```

#### status

```ts
status: UseLiveQueryStatus;
```

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
const { data, isLoading, isError, status } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
})

if (isLoading) return <div>Loading...</div>
if (isError) return <div>Error: {status}</div>

return (
  <ul>
    {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
  </ul>
)
```

## Call Signature

```ts
function useLiveQuery<TContext, TResult, TKey, TUtils>(queryFn, deps?): object;
```

Defined in: [useLiveQuery.ts:438](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L438)

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

#### deps?

`unknown`[]

Deprecated array of dependencies that trigger query re-execution when changed

### Returns

`object`

Object with reactive data, state, and status information

#### collection

```ts
collection: 
  | Collection<TResult, TKey, TUtils, StandardSchemaV1<unknown, unknown>, TResult>
  | Collection<{ [K in string | number | symbol]: ResultValue<TContext>[K] }, string | number, {
}, StandardSchemaV1<unknown, unknown>, { [K in string | number | symbol]: ResultValue<TContext>[K] }>
  | undefined;
```

#### data

```ts
data: InferResultType<TContext> | TResult[] | undefined;
```

#### isCleanedUp

```ts
isCleanedUp: boolean;
```

#### isEnabled

```ts
isEnabled: boolean;
```

#### isError

```ts
isError: boolean;
```

#### isIdle

```ts
isIdle: boolean;
```

#### isLoading

```ts
isLoading: boolean;
```

#### isReady

```ts
isReady: boolean;
```

#### state

```ts
state: 
  | Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>
  | Map<TKey, TResult>
  | undefined;
```

#### status

```ts
status: UseLiveQueryStatus;
```

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
const { data, isLoading, isError, status } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
})

if (isLoading) return <div>Loading...</div>
if (isError) return <div>Error: {status}</div>

return (
  <ul>
    {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
  </ul>
)
```

## Call Signature

```ts
function useLiveQuery<TContext>(config): object;
```

Defined in: [useLiveQuery.ts:508](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L508)

Create a live query using configuration object

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### config

[`UseLiveQueryConfig`](../type-aliases/UseLiveQueryConfig.md)\<`TContext`\>

Configuration object with query and options

### Returns

`object`

Object with reactive data, state, and status information

#### collection

```ts
collection: Collection<{ [K in string | number | symbol]: ResultValue<TContext>[K] }, string | number, {
}>;
```

#### data

```ts
data: InferResultType<TContext>;
```

#### isCleanedUp

```ts
isCleanedUp: boolean;
```

#### isEnabled

```ts
isEnabled: true;
```

#### isError

```ts
isError: boolean;
```

#### isIdle

```ts
isIdle: boolean;
```

#### isLoading

```ts
isLoading: boolean;
```

#### isReady

```ts
isReady: boolean;
```

#### state

```ts
state: Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>;
```

#### status

```ts
status: CollectionStatus;
```

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
const { data, isLoading, isReady, isError } = useLiveQuery({
  query: (q) => q.from({ items: itemCollection })
})

if (isLoading) return <div>Loading...</div>
if (isError) return <div>Something went wrong</div>
if (!isReady) return <div>Preparing...</div>

return <div>{data.length} items loaded</div>
```

## Call Signature

```ts
function useLiveQuery<TContext>(config): object;
```

Defined in: [useLiveQuery.ts:524](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L524)

Create a live query using a query function.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### config

[`ConditionalUseLiveQueryConfig`](../type-aliases/ConditionalUseLiveQueryConfig.md)\<`TContext`\>

### Returns

`object`

Object with reactive data, state, and status information

#### collection

```ts
collection: 
  | Collection<{ [K in string | number | symbol]: ResultValue<TContext>[K] }, string | number, {
}, StandardSchemaV1<unknown, unknown>, { [K in string | number | symbol]: ResultValue<TContext>[K] }>
  | undefined;
```

#### data

```ts
data: InferResultType<TContext> | undefined;
```

#### isCleanedUp

```ts
isCleanedUp: boolean;
```

#### isEnabled

```ts
isEnabled: boolean;
```

#### isError

```ts
isError: boolean;
```

#### isIdle

```ts
isIdle: boolean;
```

#### isLoading

```ts
isLoading: boolean;
```

#### isReady

```ts
isReady: boolean;
```

#### state

```ts
state: 
  | Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>
  | undefined;
```

#### status

```ts
status: UseLiveQueryStatus;
```

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
const { data, isLoading, isError, status } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
})

if (isLoading) return <div>Loading...</div>
if (isError) return <div>Error: {status}</div>

return (
  <ul>
    {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
  </ul>
)
```

## Call Signature

```ts
function useLiveQuery<TContext>(config, deps?): object;
```

Defined in: [useLiveQuery.ts:540](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L540)

Create a live query using a query function.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### config

`LiveQueryCollectionConfig`\<`TContext`\>

#### deps?

`unknown`[]

Deprecated array of dependencies that trigger query re-execution when changed

### Returns

`object`

Object with reactive data, state, and status information

#### collection

```ts
collection: Collection<{ [K in string | number | symbol]: ResultValue<TContext>[K] }, string | number, {
}>;
```

#### data

```ts
data: InferResultType<TContext>;
```

#### isCleanedUp

```ts
isCleanedUp: boolean;
```

#### isEnabled

```ts
isEnabled: true;
```

#### isError

```ts
isError: boolean;
```

#### isIdle

```ts
isIdle: boolean;
```

#### isLoading

```ts
isLoading: boolean;
```

#### isReady

```ts
isReady: boolean;
```

#### state

```ts
state: Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>;
```

#### status

```ts
status: CollectionStatus;
```

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
const { data, isLoading, isError, status } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
})

if (isLoading) return <div>Loading...</div>
if (isError) return <div>Error: {status}</div>

return (
  <ul>
    {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
  </ul>
)
```

## Call Signature

```ts
function useLiveQuery<TContext>(config, deps): object;
```

Defined in: [useLiveQuery.ts:557](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L557)

Create a live query using a query function.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### config

[`ConditionalUseLiveQueryConfig`](../type-aliases/ConditionalUseLiveQueryConfig.md)\<`TContext`\>

#### deps

`unknown`[]

Deprecated array of dependencies that trigger query re-execution when changed

### Returns

`object`

Object with reactive data, state, and status information

#### collection

```ts
collection: 
  | Collection<{ [K in string | number | symbol]: ResultValue<TContext>[K] }, string | number, {
}, StandardSchemaV1<unknown, unknown>, { [K in string | number | symbol]: ResultValue<TContext>[K] }>
  | undefined;
```

#### data

```ts
data: InferResultType<TContext> | undefined;
```

#### isCleanedUp

```ts
isCleanedUp: boolean;
```

#### isEnabled

```ts
isEnabled: boolean;
```

#### isError

```ts
isError: boolean;
```

#### isIdle

```ts
isIdle: boolean;
```

#### isLoading

```ts
isLoading: boolean;
```

#### isReady

```ts
isReady: boolean;
```

#### state

```ts
state: 
  | Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>
  | undefined;
```

#### status

```ts
status: UseLiveQueryStatus;
```

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
const { data, isLoading, isError, status } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
})

if (isLoading) return <div>Loading...</div>
if (isError) return <div>Error: {status}</div>

return (
  <ul>
    {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
  </ul>
)
```

## Call Signature

```ts
function useLiveQuery<TResult, TKey, TUtils>(liveQueryCollection): object;
```

Defined in: [useLiveQuery.ts:603](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L603)

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

`object`

Object with reactive data, state, and status information

#### collection

```ts
collection: Collection<TResult, TKey, TUtils>;
```

#### data

```ts
data: TResult[];
```

#### isCleanedUp

```ts
isCleanedUp: boolean;
```

#### isEnabled

```ts
isEnabled: true;
```

#### isError

```ts
isError: boolean;
```

#### isIdle

```ts
isIdle: boolean;
```

#### isLoading

```ts
isLoading: boolean;
```

#### isReady

```ts
isReady: boolean;
```

#### state

```ts
state: Map<TKey, TResult>;
```

#### status

```ts
status: CollectionStatus;
```

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
const { data, isLoading, isError } = useLiveQuery(sharedCollection)

if (isLoading) return <div>Loading...</div>
if (isError) return <div>Error loading data</div>

return <div>{data.map(item => <Item key={item.id} {...item} />)}</div>
```

## Call Signature

```ts
function useLiveQuery<TResult, TKey, TUtils>(liveQueryCollection): object;
```

Defined in: [useLiveQuery.ts:623](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L623)

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

`object`

Object with reactive data, state, and status information

#### collection

```ts
collection: Collection<TResult, TKey, TUtils, StandardSchemaV1<unknown, unknown>, TResult> & SingleResult;
```

#### data

```ts
data: TResult | undefined;
```

#### isCleanedUp

```ts
isCleanedUp: boolean;
```

#### isEnabled

```ts
isEnabled: true;
```

#### isError

```ts
isError: boolean;
```

#### isIdle

```ts
isIdle: boolean;
```

#### isLoading

```ts
isLoading: boolean;
```

#### isReady

```ts
isReady: boolean;
```

#### state

```ts
state: Map<TKey, TResult>;
```

#### status

```ts
status: CollectionStatus;
```

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
const { data, isLoading, isError, status } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
})

if (isLoading) return <div>Loading...</div>
if (isError) return <div>Error: {status}</div>

return (
  <ul>
    {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
  </ul>
)
```
