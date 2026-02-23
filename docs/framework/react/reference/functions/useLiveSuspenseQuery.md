---
id: useLiveSuspenseQuery
title: useLiveSuspenseQuery
---

# Function: useLiveSuspenseQuery()

## Call Signature

```ts
function useLiveSuspenseQuery<TContext>(queryFn, deps?): object;
```

Defined in: useLiveSuspenseQuery.ts:109

Create a live query with React Suspense support

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\>

Query function that defines what data to fetch

#### deps?

`unknown`[]

Array of dependencies that trigger query re-execution when changed

### Returns

`object`

Object with reactive data and state - data is guaranteed to be defined

#### collection

```ts
collection: Collection<{ [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }, string | number, {
}>;
```

#### data

```ts
data: InferResultType<TContext>;
```

#### state

```ts
state: Map<string | number, { [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }>;
```

### Throws

Promise when data is loading (caught by Suspense boundary)

### Throws

Error when collection fails (caught by Error boundary)

### Examples

```ts
// Basic usage with Suspense
function TodoList() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
  )

  return (
    <ul>
      {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
    </ul>
  )
}

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TodoList />
    </Suspense>
  )
}
```

```ts
// Single result query
const { data } = useLiveSuspenseQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => eq(todos.id, 1))
         .findOne()
)
// data is guaranteed to be the single item (or undefined if not found)
```

```ts
// With dependencies that trigger re-suspension
const { data } = useLiveSuspenseQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority)),
  [minPriority] // Re-suspends when minPriority changes
)
```

```ts
// With Error boundary
function App() {
  return (
    <ErrorBoundary fallback={<div>Error loading data</div>}>
      <Suspense fallback={<div>Loading...</div>}>
        <TodoList />
      </Suspense>
    </ErrorBoundary>
  )
}
```

### Remarks

**Important:** This hook does NOT support disabled queries (returning undefined/null).
Following TanStack Query's useSuspenseQuery design, the query callback must always
return a valid query, collection, or config object.

❌ **This will cause a type error:**
```ts
useLiveSuspenseQuery(
  (q) => userId ? q.from({ users }) : undefined  // ❌ Error!
)
```

✅ **Use conditional rendering instead:**
```ts
function Profile({ userId }: { userId: string }) {
  const { data } = useLiveSuspenseQuery(
    (q) => q.from({ users }).where(({ users }) => eq(users.id, userId))
  )
  return <div>{data.name}</div>
}

// In parent component:
{userId ? <Profile userId={userId} /> : <div>No user</div>}
```

✅ **Or use useLiveQuery for conditional queries:**
```ts
const { data, isEnabled } = useLiveQuery(
  (q) => userId ? q.from({ users }) : undefined,  // ✅ Supported!
  [userId]
)
```

## Call Signature

```ts
function useLiveSuspenseQuery<TContext>(config, deps?): object;
```

Defined in: useLiveSuspenseQuery.ts:119

Create a live query with React Suspense support

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### config

`LiveQueryCollectionConfig`\<`TContext`\>

#### deps?

`unknown`[]

Array of dependencies that trigger query re-execution when changed

### Returns

`object`

Object with reactive data and state - data is guaranteed to be defined

#### collection

```ts
collection: Collection<{ [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }, string | number, {
}>;
```

#### data

```ts
data: InferResultType<TContext>;
```

#### state

```ts
state: Map<string | number, { [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }>;
```

### Throws

Promise when data is loading (caught by Suspense boundary)

### Throws

Error when collection fails (caught by Error boundary)

### Examples

```ts
// Basic usage with Suspense
function TodoList() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
  )

  return (
    <ul>
      {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
    </ul>
  )
}

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TodoList />
    </Suspense>
  )
}
```

```ts
// Single result query
const { data } = useLiveSuspenseQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => eq(todos.id, 1))
         .findOne()
)
// data is guaranteed to be the single item (or undefined if not found)
```

```ts
// With dependencies that trigger re-suspension
const { data } = useLiveSuspenseQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority)),
  [minPriority] // Re-suspends when minPriority changes
)
```

```ts
// With Error boundary
function App() {
  return (
    <ErrorBoundary fallback={<div>Error loading data</div>}>
      <Suspense fallback={<div>Loading...</div>}>
        <TodoList />
      </Suspense>
    </ErrorBoundary>
  )
}
```

### Remarks

**Important:** This hook does NOT support disabled queries (returning undefined/null).
Following TanStack Query's useSuspenseQuery design, the query callback must always
return a valid query, collection, or config object.

❌ **This will cause a type error:**
```ts
useLiveSuspenseQuery(
  (q) => userId ? q.from({ users }) : undefined  // ❌ Error!
)
```

✅ **Use conditional rendering instead:**
```ts
function Profile({ userId }: { userId: string }) {
  const { data } = useLiveSuspenseQuery(
    (q) => q.from({ users }).where(({ users }) => eq(users.id, userId))
  )
  return <div>{data.name}</div>
}

// In parent component:
{userId ? <Profile userId={userId} /> : <div>No user</div>}
```

✅ **Or use useLiveQuery for conditional queries:**
```ts
const { data, isEnabled } = useLiveQuery(
  (q) => userId ? q.from({ users }) : undefined,  // ✅ Supported!
  [userId]
)
```

## Call Signature

```ts
function useLiveSuspenseQuery<TResult, TKey, TUtils>(liveQueryCollection): object;
```

Defined in: useLiveSuspenseQuery.ts:129

Create a live query with React Suspense support

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

### Returns

`object`

Object with reactive data and state - data is guaranteed to be defined

#### collection

```ts
collection: Collection<TResult, TKey, TUtils>;
```

#### data

```ts
data: TResult[];
```

#### state

```ts
state: Map<TKey, TResult>;
```

### Throws

Promise when data is loading (caught by Suspense boundary)

### Throws

Error when collection fails (caught by Error boundary)

### Examples

```ts
// Basic usage with Suspense
function TodoList() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
  )

  return (
    <ul>
      {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
    </ul>
  )
}

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TodoList />
    </Suspense>
  )
}
```

```ts
// Single result query
const { data } = useLiveSuspenseQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => eq(todos.id, 1))
         .findOne()
)
// data is guaranteed to be the single item (or undefined if not found)
```

```ts
// With dependencies that trigger re-suspension
const { data } = useLiveSuspenseQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority)),
  [minPriority] // Re-suspends when minPriority changes
)
```

```ts
// With Error boundary
function App() {
  return (
    <ErrorBoundary fallback={<div>Error loading data</div>}>
      <Suspense fallback={<div>Loading...</div>}>
        <TodoList />
      </Suspense>
    </ErrorBoundary>
  )
}
```

### Remarks

**Important:** This hook does NOT support disabled queries (returning undefined/null).
Following TanStack Query's useSuspenseQuery design, the query callback must always
return a valid query, collection, or config object.

❌ **This will cause a type error:**
```ts
useLiveSuspenseQuery(
  (q) => userId ? q.from({ users }) : undefined  // ❌ Error!
)
```

✅ **Use conditional rendering instead:**
```ts
function Profile({ userId }: { userId: string }) {
  const { data } = useLiveSuspenseQuery(
    (q) => q.from({ users }).where(({ users }) => eq(users.id, userId))
  )
  return <div>{data.name}</div>
}

// In parent component:
{userId ? <Profile userId={userId} /> : <div>No user</div>}
```

✅ **Or use useLiveQuery for conditional queries:**
```ts
const { data, isEnabled } = useLiveQuery(
  (q) => userId ? q.from({ users }) : undefined,  // ✅ Supported!
  [userId]
)
```

## Call Signature

```ts
function useLiveSuspenseQuery<TResult, TKey, TUtils>(liveQueryCollection): object;
```

Defined in: useLiveSuspenseQuery.ts:142

Create a live query with React Suspense support

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

Object with reactive data and state - data is guaranteed to be defined

#### collection

```ts
collection: Collection<TResult, TKey, TUtils, StandardSchemaV1<unknown, unknown>, TResult> & SingleResult;
```

#### data

```ts
data: TResult | undefined;
```

#### state

```ts
state: Map<TKey, TResult>;
```

### Throws

Promise when data is loading (caught by Suspense boundary)

### Throws

Error when collection fails (caught by Error boundary)

### Examples

```ts
// Basic usage with Suspense
function TodoList() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
  )

  return (
    <ul>
      {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
    </ul>
  )
}

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TodoList />
    </Suspense>
  )
}
```

```ts
// Single result query
const { data } = useLiveSuspenseQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => eq(todos.id, 1))
         .findOne()
)
// data is guaranteed to be the single item (or undefined if not found)
```

```ts
// With dependencies that trigger re-suspension
const { data } = useLiveSuspenseQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority)),
  [minPriority] // Re-suspends when minPriority changes
)
```

```ts
// With Error boundary
function App() {
  return (
    <ErrorBoundary fallback={<div>Error loading data</div>}>
      <Suspense fallback={<div>Loading...</div>}>
        <TodoList />
      </Suspense>
    </ErrorBoundary>
  )
}
```

### Remarks

**Important:** This hook does NOT support disabled queries (returning undefined/null).
Following TanStack Query's useSuspenseQuery design, the query callback must always
return a valid query, collection, or config object.

❌ **This will cause a type error:**
```ts
useLiveSuspenseQuery(
  (q) => userId ? q.from({ users }) : undefined  // ❌ Error!
)
```

✅ **Use conditional rendering instead:**
```ts
function Profile({ userId }: { userId: string }) {
  const { data } = useLiveSuspenseQuery(
    (q) => q.from({ users }).where(({ users }) => eq(users.id, userId))
  )
  return <div>{data.name}</div>
}

// In parent component:
{userId ? <Profile userId={userId} /> : <div>No user</div>}
```

✅ **Or use useLiveQuery for conditional queries:**
```ts
const { data, isEnabled } = useLiveQuery(
  (q) => userId ? q.from({ users }) : undefined,  // ✅ Supported!
  [userId]
)
```
