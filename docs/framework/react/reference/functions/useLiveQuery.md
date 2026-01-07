---
id: useLiveQuery
title: useLiveQuery
---

# Function: useLiveQuery()

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn, deps?): object;
```

Defined in: [useLiveQuery.ts:84](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L84)

Create a live query using a query function

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

Object with reactive data, state, and status information

#### collection

```ts
collection: Collection<{ [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }, string | number, {
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
state: Map<string | number, { [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }>;
```

#### status

```ts
status: CollectionStatus;
```

### Examples

```ts
// Basic query with object syntax
const { data, isLoading } = useLiveQuery((q) =>
  q.from({ todos: todosCollection })
   .where(({ todos }) => eq(todos.completed, false))
   .select(({ todos }) => ({ id: todos.id, text: todos.text }))
)
```

```ts
// Single result query
const { data } = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => eq(todos.id, 1))
         .findOne()
)
```

```ts
// With dependencies that trigger re-execution
const { data, state } = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority)),
  [minPriority] // Re-run when minPriority changes
)
```

```ts
// Join pattern
const { data } = useLiveQuery((q) =>
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
const { data, isLoading, isError, status } = useLiveQuery((q) =>
  q.from({ todos: todoCollection })
)

if (isLoading) return <div>Loading...</div>
if (isError) return <div>Error: {status}</div>

return (
  <ul>
    {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
  </ul>
)
```
