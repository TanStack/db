---
id: useLiveQuery
title: useLiveQuery
---

# Function: useLiveQuery()

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn, deps?): UseLiveQueryReturn<{ [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }, InferResultType<TContext>>;
```

Defined in: useLiveQuery.svelte.ts:160

Create a live query using a query function

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\>

Query function that defines what data to fetch

#### deps?

() => `unknown`[]

Array of reactive dependencies that trigger query re-execution when changed

### Returns

[`UseLiveQueryReturn`](../interfaces/UseLiveQueryReturn.md)\<\{ \[K in string \| number \| symbol\]: (TContext\["result"\] extends object ? any\[any\] : TContext\["hasJoins"\] extends true ? TContext\["schema"\] : TContext\["schema"\]\[TContext\["fromSourceName"\]\])\[K\] \}, `InferResultType`\<`TContext`\>\>

Reactive object with query data, state, and status information

### Remarks

**IMPORTANT - Destructuring in Svelte 5:**
Direct destructuring breaks reactivity. To destructure, wrap with `$derived`:

❌ **Incorrect** - Loses reactivity:
```ts
const { data, isLoading } = useLiveQuery(...)
```

✅ **Correct** - Maintains reactivity:
```ts
// Option 1: Use dot notation (recommended)
const query = useLiveQuery(...)
// Access: query.data, query.isLoading

// Option 2: Wrap with $derived for destructuring
const query = useLiveQuery(...)
const { data, isLoading } = $derived(query)
```

This is a fundamental Svelte 5 limitation, not a library bug. See:
https://github.com/sveltejs/svelte/issues/11002

### Examples

```ts
// Basic query with object syntax (recommended pattern)
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todosCollection })
   .where(({ todos }) => eq(todos.completed, false))
   .select(({ todos }) => ({ id: todos.id, text: todos.text }))
)
// Access via: todosQuery.data, todosQuery.isLoading, etc.
```

```ts
// With reactive dependencies
let minPriority = $state(5)
const todosQuery = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority)),
  [() => minPriority] // Re-run when minPriority changes
)
```

```ts
// Destructuring with $derived (if needed)
const query = useLiveQuery((q) =>
  q.from({ todos: todosCollection })
)
const { data, isLoading, isError } = $derived(query)
// Now data, isLoading, and isError maintain reactivity
```

```ts
// Join pattern
const issuesQuery = useLiveQuery((q) =>
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
// Handle loading and error states in template
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todoCollection })
)

// In template:
// {#if todosQuery.isLoading}
//   <div>Loading...</div>
// {:else if todosQuery.isError}
//   <div>Error: {todosQuery.status}</div>
// {:else}
//   <ul>
//     {#each todosQuery.data as todo (todo.id)}
//       <li>{todo.text}</li>
//     {/each}
//   </ul>
// {/if}
```

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn, deps?): UseLiveQueryReturn<{ [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }, InferResultType<TContext> | undefined>;
```

Defined in: useLiveQuery.svelte.ts:166

Create a live query using a query function

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\> \| `null` \| `undefined`

Query function that defines what data to fetch

#### deps?

() => `unknown`[]

Array of reactive dependencies that trigger query re-execution when changed

### Returns

[`UseLiveQueryReturn`](../interfaces/UseLiveQueryReturn.md)\<\{ \[K in string \| number \| symbol\]: (TContext\["result"\] extends object ? any\[any\] : TContext\["hasJoins"\] extends true ? TContext\["schema"\] : TContext\["schema"\]\[TContext\["fromSourceName"\]\])\[K\] \}, `InferResultType`\<`TContext`\> \| `undefined`\>

Reactive object with query data, state, and status information

### Remarks

**IMPORTANT - Destructuring in Svelte 5:**
Direct destructuring breaks reactivity. To destructure, wrap with `$derived`:

❌ **Incorrect** - Loses reactivity:
```ts
const { data, isLoading } = useLiveQuery(...)
```

✅ **Correct** - Maintains reactivity:
```ts
// Option 1: Use dot notation (recommended)
const query = useLiveQuery(...)
// Access: query.data, query.isLoading

// Option 2: Wrap with $derived for destructuring
const query = useLiveQuery(...)
const { data, isLoading } = $derived(query)
```

This is a fundamental Svelte 5 limitation, not a library bug. See:
https://github.com/sveltejs/svelte/issues/11002

### Examples

```ts
// Basic query with object syntax (recommended pattern)
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todosCollection })
   .where(({ todos }) => eq(todos.completed, false))
   .select(({ todos }) => ({ id: todos.id, text: todos.text }))
)
// Access via: todosQuery.data, todosQuery.isLoading, etc.
```

```ts
// With reactive dependencies
let minPriority = $state(5)
const todosQuery = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority)),
  [() => minPriority] // Re-run when minPriority changes
)
```

```ts
// Destructuring with $derived (if needed)
const query = useLiveQuery((q) =>
  q.from({ todos: todosCollection })
)
const { data, isLoading, isError } = $derived(query)
// Now data, isLoading, and isError maintain reactivity
```

```ts
// Join pattern
const issuesQuery = useLiveQuery((q) =>
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
// Handle loading and error states in template
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todoCollection })
)

// In template:
// {#if todosQuery.isLoading}
//   <div>Loading...</div>
// {:else if todosQuery.isError}
//   <div>Error: {todosQuery.status}</div>
// {:else}
//   <ul>
//     {#each todosQuery.data as todo (todo.id)}
//       <li>{todo.text}</li>
//     {/each}
//   </ul>
// {/if}
```

## Call Signature

```ts
function useLiveQuery<TContext>(config, deps?): UseLiveQueryReturn<{ [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }, InferResultType<TContext>>;
```

Defined in: useLiveQuery.svelte.ts:214

Create a live query using configuration object

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### config

`LiveQueryCollectionConfig`\<`TContext`\>

Configuration object with query and options

#### deps?

() => `unknown`[]

Array of reactive dependencies that trigger query re-execution when changed

### Returns

[`UseLiveQueryReturn`](../interfaces/UseLiveQueryReturn.md)\<\{ \[K in string \| number \| symbol\]: (TContext\["result"\] extends object ? any\[any\] : TContext\["hasJoins"\] extends true ? TContext\["schema"\] : TContext\["schema"\]\[TContext\["fromSourceName"\]\])\[K\] \}, `InferResultType`\<`TContext`\>\>

Reactive object with query data, state, and status information

### Examples

```ts
// Basic config object usage
const todosQuery = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection }),
  gcTime: 60000
})
```

```ts
// With reactive dependencies
let filter = $state('active')
const todosQuery = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection })
                 .where(({ todos }) => eq(todos.status, filter))
}, [() => filter])
```

```ts
// Handle all states uniformly
const itemsQuery = useLiveQuery({
  query: (q) => q.from({ items: itemCollection })
})

// In template:
// {#if itemsQuery.isLoading}
//   <div>Loading...</div>
// {:else if itemsQuery.isError}
//   <div>Something went wrong</div>
// {:else if !itemsQuery.isReady}
//   <div>Preparing...</div>
// {:else}
//   <div>{itemsQuery.data.length} items loaded</div>
// {/if}
```

## Call Signature

```ts
function useLiveQuery<TResult, TKey, TUtils>(liveQueryCollection): UseLiveQueryReturnWithCollection<TResult, TKey, TUtils, TResult[]>;
```

Defined in: useLiveQuery.svelte.ts:263

Subscribe to an existing query collection (can be reactive)

### Type Parameters

#### TResult

`TResult` *extends* `object`

#### TKey

`TKey` *extends* `string` \| `number`

#### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>

### Parameters

#### liveQueryCollection

`MaybeGetter`\<`Collection`\<`TResult`, `TKey`, `TUtils`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `TResult`\> & `NonSingleResult`\>

Pre-created query collection to subscribe to (can be a getter)

### Returns

[`UseLiveQueryReturnWithCollection`](../interfaces/UseLiveQueryReturnWithCollection.md)\<`TResult`, `TKey`, `TUtils`, `TResult`[]\>

Reactive object with query data, state, and status information

### Examples

```ts
// Using pre-created query collection
const myLiveQuery = createLiveQueryCollection((q) =>
  q.from({ todos: todosCollection }).where(({ todos }) => eq(todos.active, true))
)
const queryResult = useLiveQuery(myLiveQuery)
```

```ts
// Reactive query collection reference
let selectedQuery = $state(todosQuery)
const queryResult = useLiveQuery(() => selectedQuery)

// Switch queries reactively
selectedQuery = archiveQuery
```

```ts
// Access query collection methods directly
const queryResult = useLiveQuery(existingQuery)

// Use underlying collection for mutations
const handleToggle = (id) => {
  queryResult.collection.update(id, draft => { draft.completed = !draft.completed })
}
```

```ts
// Handle states consistently
const queryResult = useLiveQuery(sharedQuery)

// In template:
// {#if queryResult.isLoading}
//   <div>Loading...</div>
// {:else if queryResult.isError}
//   <div>Error loading data</div>
// {:else}
//   {#each queryResult.data as item (item.id)}
//     <Item {...item} />
//   {/each}
// {/if}
```

## Call Signature

```ts
function useLiveQuery<TResult, TKey, TUtils>(liveQueryCollection): UseLiveQueryReturnWithCollection<TResult, TKey, TUtils, TResult | undefined>;
```

Defined in: useLiveQuery.svelte.ts:274

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

`MaybeGetter`\<`Collection`\<`TResult`, `TKey`, `TUtils`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `TResult`\> & `SingleResult`\>

### Returns

[`UseLiveQueryReturnWithCollection`](../interfaces/UseLiveQueryReturnWithCollection.md)\<`TResult`, `TKey`, `TUtils`, `TResult` \| `undefined`\>

Reactive object with query data, state, and status information

### Remarks

**IMPORTANT - Destructuring in Svelte 5:**
Direct destructuring breaks reactivity. To destructure, wrap with `$derived`:

❌ **Incorrect** - Loses reactivity:
```ts
const { data, isLoading } = useLiveQuery(...)
```

✅ **Correct** - Maintains reactivity:
```ts
// Option 1: Use dot notation (recommended)
const query = useLiveQuery(...)
// Access: query.data, query.isLoading

// Option 2: Wrap with $derived for destructuring
const query = useLiveQuery(...)
const { data, isLoading } = $derived(query)
```

This is a fundamental Svelte 5 limitation, not a library bug. See:
https://github.com/sveltejs/svelte/issues/11002

### Examples

```ts
// Basic query with object syntax (recommended pattern)
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todosCollection })
   .where(({ todos }) => eq(todos.completed, false))
   .select(({ todos }) => ({ id: todos.id, text: todos.text }))
)
// Access via: todosQuery.data, todosQuery.isLoading, etc.
```

```ts
// With reactive dependencies
let minPriority = $state(5)
const todosQuery = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority)),
  [() => minPriority] // Re-run when minPriority changes
)
```

```ts
// Destructuring with $derived (if needed)
const query = useLiveQuery((q) =>
  q.from({ todos: todosCollection })
)
const { data, isLoading, isError } = $derived(query)
// Now data, isLoading, and isError maintain reactivity
```

```ts
// Join pattern
const issuesQuery = useLiveQuery((q) =>
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
// Handle loading and error states in template
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todoCollection })
)

// In template:
// {#if todosQuery.isLoading}
//   <div>Loading...</div>
// {:else if todosQuery.isError}
//   <div>Error: {todosQuery.status}</div>
// {:else}
//   <ul>
//     {#each todosQuery.data as todo (todo.id)}
//       <li>{todo.text}</li>
//     {/each}
//   </ul>
// {/if}
```
