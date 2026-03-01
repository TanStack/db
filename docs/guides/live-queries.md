---
title: Live Queries
id: live-queries
---

# TanStack DB Live Queries

TanStack DB provides a powerful, type-safe query system that allows you to fetch, filter, transform, and aggregate data from collections using a SQL-like fluent API. All queries are **live** by default, meaning they automatically update when the underlying data changes.

The query system is built around an API similar to SQL query builders like Kysely or Drizzle where you chain methods together to compose your query. The query builder doesn't perform operations in the order of method calls - instead, it composes your query into an optimal incremental pipeline that gets compiled and executed efficiently. Each method returns a new query builder, allowing you to chain operations together.

Live queries resolve to collections that automatically update when their underlying data changes. You can subscribe to changes, iterate over results, and use all the standard collection methods.

```ts
import { createCollection, liveQueryCollectionOptions, eq } from '@tanstack/db'

const activeUsers = createCollection(liveQueryCollectionOptions({
  query: (q) =>
    q
      .from({ user: usersCollection })
      .where(({ user }) => eq(user.active, true))
      .select(({ user }) => ({
        id: user.id,
        name: user.name,
        email: user.email,
      }))
}))
```

The result types are automatically inferred from your query structure, providing full TypeScript support. When you use a `select` clause, the result type matches your projection. Without `select`, you get the full schema with proper join optionality.

## Table of Contents

- [Creating Live Query Collections](#creating-live-query-collections)
- [One-shot Queries with queryOnce](#one-shot-queries-with-queryonce)
- [From Clause](#from-clause)
- [Where Clauses](#where-clauses)
- [Select Projections](#select)
- [Joins](#joins)
- [Subqueries](#subqueries)
- [groupBy and Aggregations](#groupby-and-aggregations)
- [findOne](#findone)
- [Distinct](#distinct)
- [Order By, Limit, and Offset](#order-by-limit-and-offset)
- [Composable Queries](#composable-queries)
- [Expression Functions Reference](#expression-functions-reference)
- [Functional Variants](#functional-variants)

## Creating Live Query Collections

To create a live query collection, you can use `liveQueryCollectionOptions` with `createCollection`, or use the convenience function `createLiveQueryCollection`.

### Using liveQueryCollectionOptions

The fundamental way to create a live query is using `liveQueryCollectionOptions` with `createCollection`:

```ts
import { createCollection, liveQueryCollectionOptions, eq } from '@tanstack/db'

const activeUsers = createCollection(liveQueryCollectionOptions({
  query: (q) =>
    q
      .from({ user: usersCollection })
      .where(({ user }) => eq(user.active, true))
      .select(({ user }) => ({
        id: user.id,
        name: user.name,
      }))
}))
```

### Configuration Options

For more control, you can specify additional options:

```ts
const activeUsers = createCollection(liveQueryCollectionOptions({
  id: 'active-users', // Optional: auto-generated if not provided
  query: (q) =>
    q
      .from({ user: usersCollection })
      .where(({ user }) => eq(user.active, true))
      .select(({ user }) => ({
        id: user.id,
        name: user.name,
      })),
  getKey: (user) => user.id, // Optional: uses stream key if not provided
  startSync: true, // Optional: starts sync immediately
}))
```
| Option | Type | Description |
|--------|------|-------------|
| `id` | `string` (optional) | An optional unique identifier for the live query. If not provided, it will be auto-generated. This is useful for debugging and logging. |
| `query` | `QueryBuilder` or function | The query definition, this is either a `Query` instance or a function that returns a `Query` instance. |
| `getKey` | `(item) => string \| number` (optional) | A function that extracts a unique key from each row. If not provided, the stream's internal key will be used. For simple cases this is the key from the parent collection, but in the case of joins, the auto-generated key will be a composite of the parent keys. Using `getKey` is useful when you want to use a specific key from a parent collection for the resulting collection. |
| `schema` | `Schema` (optional) | Optional schema for validation |
| `startSync` | `boolean` (optional) | Whether to start syncing immediately. Defaults to `true`. |
| `gcTime` | `number` (optional) | Garbage collection time in milliseconds. Defaults to `5000` (5 seconds). |

### Convenience Function

For simpler cases, you can use `createLiveQueryCollection` as a shortcut:

```ts
import { createLiveQueryCollection, eq } from '@tanstack/db'

const activeUsers = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.active, true))
    .select(({ user }) => ({
      id: user.id,
      name: user.name,
    }))
)
```

## One-shot Queries with queryOnce

If you need a one-time snapshot (no ongoing reactivity), use `queryOnce`. It
creates a live query collection, preloads it, extracts the results, and cleans
up automatically so you do not have to remember to call `cleanup()`.

```ts
import { eq, queryOnce } from '@tanstack/db'

// Basic one-shot query
const activeUsers = await queryOnce((q) =>
  q
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.active, true))
    .select(({ user }) => ({ id: user.id, name: user.name }))
)

// Single result with findOne()
const user = await queryOnce((q) =>
  q
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.id, userId))
    .findOne()
)
```

Use `queryOnce` for scripts, background tasks, data export, or AI/LLM context
building. `findOne()` resolves to `undefined` when no rows match. For UI
bindings and reactive updates, use live queries instead.

### Using with Frameworks

In React, you can use the `useLiveQuery` hook:

```tsx
import { useLiveQuery } from '@tanstack/react-db'

function UserList() {
  const activeUsers = useLiveQuery((q) =>
    q
      .from({ user: usersCollection })
      .where(({ user }) => eq(user.active, true))
  )

  return (
    <ul>
      {activeUsers.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  )
}
```

In Angular, you can use the `injectLiveQuery` function:

```typescript
import { Component } from '@angular/core'
import { injectLiveQuery } from '@tanstack/angular-db'

@Component({
  selector: 'user-list',
  template: `
    @for (user of activeUsers.data(); track user.id) {
      <li>{{ user.name }}</li>
    }
  `
})
export class UserListComponent {
  activeUsers = injectLiveQuery((q) =>
    q
      .from({ user: usersCollection })
      .where(({ user }) => eq(user.active, true))
  )
}
```

> **Note:** React hooks (`useLiveQuery`, `useLiveInfiniteQuery`, `useLiveSuspenseQuery`) accept an optional dependency array parameter to re-execute queries when values change, similar to React's `useEffect`. See the [React Adapter documentation](../framework/react/overview#dependency-arrays) for details on when and how to use dependency arrays.

For more details on framework integration, see the [React](../framework/react/overview), [Vue](../framework/vue/overview), and [Angular](../framework/angular/overview) adapter documentation.

### Using with React Suspense

For React applications, you can use the `useLiveSuspenseQuery` hook to integrate with React Suspense boundaries. This hook suspends rendering while data loads initially, then streams updates without re-suspending.

```tsx
import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { Suspense } from 'react'

function UserList() {
  // This will suspend until data is ready
  const { data } = useLiveSuspenseQuery((q) =>
    q
      .from({ user: usersCollection })
      .where(({ user }) => eq(user.active, true))
  )

  // data is always defined - no need for optional chaining
  return (
    <ul>
      {data.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  )
}

function App() {
  return (
    <Suspense fallback={<div>Loading users...</div>}>
      <UserList />
    </Suspense>
  )
}
```

#### Type Safety

The key difference from `useLiveQuery` is that `data` is always defined (never `undefined`). The hook suspends during initial load, so by the time your component renders, data is guaranteed to be available:

```tsx
function UserStats() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ user: usersCollection })
  )

  // TypeScript knows data is Array<User>, not Array<User> | undefined
  return <div>Total users: {data.length}</div>
}
```

#### Error Handling

Combine with Error Boundaries to handle loading errors:

```tsx
import { ErrorBoundary } from 'react-error-boundary'

function App() {
  return (
    <ErrorBoundary fallback={<div>Failed to load users</div>}>
      <Suspense fallback={<div>Loading users...</div>}>
        <UserList />
      </Suspense>
    </ErrorBoundary>
  )
}
```

#### Reactive Updates

After the initial load, data updates stream in without re-suspending:

```tsx
function UserList() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ user: usersCollection })
  )

  // Suspends once during initial load
  // After that, data updates automatically when users change
  // UI never re-suspends for live updates
  return (
    <ul>
      {data.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  )
}
```

#### Re-suspending on Dependency Changes

When dependencies change, the hook re-suspends to load new data:

```tsx
function FilteredUsers({ minAge }: { minAge: number }) {
  const { data } = useLiveSuspenseQuery(
    (q) =>
      q
        .from({ user: usersCollection })
        .where(({ user }) => gt(user.age, minAge)),
    [minAge] // Re-suspend when minAge changes
  )

  return (
    <ul>
      {data.map(user => (
        <li key={user.id}>{user.name} - {user.age}</li>
      ))}
    </ul>
  )
}
```

#### When to Use Which Hook

- **Use `useLiveSuspenseQuery`** when:
  - You want to use React Suspense for loading states
  - You prefer handling loading/error states with `<Suspense>` and `<ErrorBoundary>` components
  - You want guaranteed non-undefined data types
  - The query always needs to run (not conditional)

- **Use `useLiveQuery`** when:
  - You need conditional/disabled queries
  - You prefer handling loading/error states within your component
  - You want to show loading states inline without Suspense
  - You need access to `status` and `isLoading` flags
  - **You're using a router with loaders** (React Router, TanStack Router, etc.) - preload in the loader and use `useLiveQuery` in the component

```tsx
// useLiveQuery - handle states in component
function UserList() {
  const { data, status, isLoading } = useLiveQuery((q) =>
    q.from({ user: usersCollection })
  )

  if (isLoading) return <div>Loading...</div>
  if (status === 'error') return <div>Error loading users</div>

  return <ul>{data?.map(user => <li key={user.id}>{user.name}</li>)}</ul>
}

// useLiveSuspenseQuery - handle states with Suspense/ErrorBoundary
function UserList() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ user: usersCollection })
  )

  return <ul>{data.map(user => <li key={user.id}>{user.name}</li>)}</ul>
}

// useLiveQuery with router loader - recommended pattern
// In your route configuration:
const route = {
  path: '/users',
  loader: async () => {
    // Preload the collection in the loader
    await usersCollection.preload()
    return null
  },
  component: UserList,
}

// In your component:
function UserList() {
  // Collection is already loaded, so data is immediately available
  const { data } = useLiveQuery((q) =>
    q.from({ user: usersCollection })
  )

  return <ul>{data?.map(user => <li key={user.id}>{user.name}</li>)}</ul>
}
```

### Conditional Queries

In React, you can conditionally disable a query by returning `undefined` or `null` from the `useLiveQuery` callback. When disabled, the hook returns a special state indicating the query is not active.

```tsx
import { useLiveQuery } from '@tanstack/react-db'

function TodoList({ userId }: { userId?: string }) {
  const { data, isEnabled, status } = useLiveQuery((q) => {
    // Disable the query when userId is not available
    if (!userId) return undefined

    return q
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.userId, userId))
  }, [userId])

  if (!isEnabled) {
    return <div>Please select a user</div>
  }

  return (
    <ul>
      {data?.map(todo => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  )
}
```

When the query is disabled (callback returns `undefined` or `null`):
- `status` is `'disabled'`
- `data`, `state`, and `collection` are `undefined`
- `isEnabled` is `false`
- `isLoading`, `isReady`, `isIdle`, and `isError` are all `false`

This pattern is useful for "wait until inputs exist" flows without needing to conditionally render the hook itself or manage an external enabled flag.

### Alternative Callback Return Types

The `useLiveQuery` callback can return different types depending on your use case:

#### Returning a Query Builder (Standard)

The most common pattern is to return a query builder:

```tsx
const { data } = useLiveQuery((q) =>
  q.from({ todos: todosCollection })
   .where(({ todos }) => eq(todos.completed, false))
)
```

#### Returning a Pre-created Collection

You can return an existing collection directly:

```tsx
const activeUsersCollection = createLiveQueryCollection((q) =>
  q.from({ users: usersCollection })
   .where(({ users }) => eq(users.active, true))
)

function UserList({ usePrebuilt }: { usePrebuilt: boolean }) {
  const { data } = useLiveQuery((q) => {
    // Toggle between pre-created collection and ad-hoc query
    if (usePrebuilt) return activeUsersCollection

    return q.from({ users: usersCollection })
  }, [usePrebuilt])

  return <ul>{data?.map(user => <li key={user.id}>{user.name}</li>)}</ul>
}
```

#### Returning a LiveQueryCollectionConfig

You can return a configuration object to specify additional options like a custom ID:

```tsx
const { data } = useLiveQuery((q) => {
  return {
    query: q.from({ items: itemsCollection })
             .select(({ items }) => ({ id: items.id })),
    id: 'items-view', // Custom ID for debugging
    gcTime: 10000 // Custom garbage collection time
  }
})
```

This is particularly useful when you need to:
- Attach a stable ID for debugging or logging
- Configure collection-specific options like `gcTime` or `getKey`
- Conditionally switch between different collection configurations

## From Clause

The foundation of every query is the `from` method, which specifies the source collection or subquery. You can alias the source using object syntax.

### Method Signature

```ts
from({
  [alias]: Collection | Query,
}): Query
```

**Parameters:**
- `[alias]` - A Collection or Query instance. Note that only a single aliased collection or subquery is allowed in the `from` clause.

### Basic Usage

Start with a basic query that selects all records from a collection:

```ts
const allUsers = createCollection(liveQueryCollectionOptions({
  query: (q) => q.from({ user: usersCollection })
}))
```

The result contains all users with their full schema. You can iterate over the results or access them by key:

```ts
// Get all users as an array
const users = allUsers.toArray

// Get a specific user by ID
const user = allUsers.get(1)

// Check if a user exists
const hasUser = allUsers.has(1)
```

Use aliases to make your queries more readable, especially when working with multiple collections:

```ts
const users = createCollection(liveQueryCollectionOptions({
  query: (q) => q.from({ u: usersCollection })
}))

// Access fields using the alias
const userNames = createCollection(liveQueryCollectionOptions({
  query: (q) =>
    q
      .from({ u: usersCollection })
      .select(({ u }) => ({
        name: u.name,
        email: u.email,
      }))
}))
```

## Where Clauses

Use `where` clauses to filter your data based on conditions. You can chain multiple `where` calls - they are combined with `and` logic.

The `where` method takes a callback function that receives an object containing your table aliases and returns a boolean expression. You build these expressions using comparison functions like `eq()`, `gt()`, and logical operators like `and()` and `or()`. This declarative approach allows the query system to optimize your filters efficiently. These are described in more detail in the [Expression Functions Reference](#expression-functions-reference) section. This is very similar to how you construct queries using Kysely or Drizzle.

It's important to note that the `where` method is not a function that is executed on each row or the results, its a way to describe the query that will be executed. This declarative approach works well for almost all use cases, but if you need to use a more complex condition, there is the functional variant as `fn.where` which is described in the [Functional Variants](#functional-variants) section.

### Method Signature

```ts
where(
  condition: (row: TRow) => Expression<boolean>
): Query
```

**Parameters:**
- `condition` - A callback function that receives the row object with table aliases and returns a boolean expression

### Basic Filtering

Filter users by a simple condition:

```ts
import { eq } from '@tanstack/db'

const activeUsers = createCollection(liveQueryCollectionOptions({
  query: (q) =>
    q
      .from({ user: usersCollection })
      .where(({ user }) => eq(user.active, true))
}))
```

### Multiple Conditions

Chain multiple `where` calls for AND logic:

```ts
import { eq, gt } from '@tanstack/db'

const adultActiveUsers = createCollection(liveQueryCollectionOptions({
  query: (q) =>
    q
      .from({ user: usersCollection })
      .where(({ user }) => eq(user.active, true))
      .where(({ user }) => gt(user.age, 18))
}))
```

### Complex Conditions

Use logical operators to build complex conditions:

```ts
import { eq, gt, or, and } from '@tanstack/db'

const specialUsers = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .where(({ user }) => 
      and(
        eq(user.active, true),
        or(
          gt(user.age, 25),
          eq(user.role, 'admin')
        )
      )
    )
)
```

### Available Operators

The query system provides several comparison operators:

```ts
import { eq, gt, gte, lt, lte, like, ilike, inArray, and, or, not } from '@tanstack/db'

// Equality
eq(user.id, 1)

// Comparisons
gt(user.age, 18)    // greater than
gte(user.age, 18)   // greater than or equal
lt(user.age, 65)    // less than
lte(user.age, 65)   // less than or equal

// String matching
like(user.name, 'John%')    // case-sensitive pattern matching
ilike(user.name, 'john%')   // case-insensitive pattern matching

// Array membership
inArray(user.id, [1, 2, 3])

// Logical operators
and(condition1, condition2)
or(condition1, condition2)
not(condition)
```

For a complete reference of all available functions, see the [Expression Functions Reference](#expression-functions-reference) section.

## Select

Use `select` to specify which fields to include in your results and transform your data. Without `select`, you get the full schema.

Similar to the `where` clause, the `select` method takes a callback function that receives an object containing your table aliases and returns an object with the fields you want to include in your results. These can be combined with functions from the [Expression Functions Reference](#expression-functions-reference) section to create computed fields. You can also use the spread operator to include all fields from a table.

### Method Signature

```ts
select(
  projection: (row: TRow) => Record<string, Expression>
): Query
```

**Parameters:**
- `projection` - A callback function that receives the row object with table aliases and returns the selected fields object

### Basic Selects

Select specific fields from your data:

````ts
const userNames = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .select(({ user }) => ({
      id: user.id,
      name: user.name,
      email: user.email,
    }))
)

/*
Result type: { id: number, name: string, email: string }

```ts
for (const row of userNames) {
  console.log(row.name)
}
```
*/
````

### Field Renaming

Rename fields in your results:

```ts
const userProfiles = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .select(({ user }) => ({
      userId: user.id,
      fullName: user.name,
      contactEmail: user.email,
    }))
)
```

### Computed Fields

Create computed fields using expressions:

```ts
import { gt, length } from '@tanstack/db'

const userStats = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .select(({ user }) => ({
      id: user.id,
      name: user.name,
      isAdult: gt(user.age, 18),
      nameLength: length(user.name),
    }))
)
```

### Using Functions and Including All Fields

Transform your data using built-in functions:

````ts
import { concat, upper, gt } from '@tanstack/db'

const formattedUsers = createCollection(liveQueryCollectionOptions({
  query: (q) =>
    q
      .from({ user: usersCollection })
      .select(({ user }) => ({
        ...user, // Include all user fields
        displayName: upper(concat(user.firstName, ' ', user.lastName)),
        isAdult: gt(user.age, 18),
      }))
}))

/*
Result type:
{
  id: number,
  name: string,
  email: string,
  displayName: string,
  isAdult: boolean,
}
*/
````

For a complete list of available functions, see the [Expression Functions Reference](#expression-functions-reference) section.

## Joins

Use `join` to combine data from multiple collections. Joins default to `left` join type and only support equality conditions.

Joins in TanStack DB are a way to combine data from multiple collections, and are conceptually very similar to SQL joins. When two collections are joined, the result is a new collection that contains the combined data as single rows. The new collection is a live query collection, and will automatically update when the underlying data changes.

A `join` without a `select` will return row objects that are namespaced with the aliases of the joined collections.

The result type of a join will take into account the join type, with the optionality of the joined fields being determined by the join type.

> [!NOTE]
> We are working on an `include` system that will enable joins that project to a hierarchical object. For example an `issue` row could have a `comments` property that is an array of `comment` rows.
> See [this issue](https://github.com/TanStack/db/issues/288) for more details.

### Method Signature

```ts
join(
  { [alias]: Collection | Query },
  condition: (row: TRow) => Expression<boolean>, // Must be an `eq` condition
  joinType?: 'left' | 'right' | 'inner' | 'full'
): Query
```

**Parameters:**
- `aliases` - An object where keys are alias names and values are collections or subqueries to join
- `condition` - A callback function that receives the combined row object and returns an equality condition
- `joinType` - Optional join type: `'left'` (default), `'right'`, `'inner'`, or `'full'`

### Basic Joins

Join users with their posts:

````ts
const userPosts = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .join({ post: postsCollection }, ({ user, post }) => 
      eq(user.id, post.userId)
    )
)

/*
Result type: 
{ 
  user: User,
  post?: Post, // post is optional because it is a left join
}

```ts
for (const row of userPosts) {
  console.log(row.user.name, row.post?.title)
}
```
*/
````

### Join Types

Specify the join type as the third parameter:

```ts
const activeUserPosts = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .join(
      { post: postsCollection }, 
      ({ user, post }) => eq(user.id, post.userId),
      'inner', // `inner`, `left`, `right` or `full`
    )
)
```

Or using the aliases `leftJoin`, `rightJoin`, `innerJoin` and `fullJoin` methods:

### Left Join
```ts
// Left join - all users, even without posts
const allUsers = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .leftJoin(
      { post: postsCollection }, 
      ({ user, post }) => eq(user.id, post.userId),
    )
)

/*
Result type:
{
  user: User,
  post?: Post, // post is optional because it is a left join
}
*/
```

### Right Join

```ts
// Right join - all posts, even without users
const allPosts = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .rightJoin(
      { post: postsCollection }, 
      ({ user, post }) => eq(user.id, post.userId),
    )
)

/*
Result type:
{
  user?: User, // user is optional because it is a right join
  post: Post,
}
*/
```

### Inner Join

```ts
// Inner join - only matching records
const activeUserPosts = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .innerJoin(
      { post: postsCollection }, 
      ({ user, post }) => eq(user.id, post.userId),
    )
)

/*
Result type:
{
  user: User,
  post: Post,
}
*/
```

### Full Join

```ts
// Full join - all users and all posts
const allUsersAndPosts = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .fullJoin(
      { post: postsCollection }, 
      ({ user, post }) => eq(user.id, post.userId),
    )
)

/*
Result type:
{
  user?: User, // user is optional because it is a full join
  post?: Post, // post is optional because it is a full join
}
*/
```

### Multiple Joins

Chain multiple joins in a single query:

```ts
const userPostComments = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .join({ post: postsCollection }, ({ user, post }) => 
      eq(user.id, post.userId)
    )
    .join({ comment: commentsCollection }, ({ post, comment }) => 
      eq(post.id, comment.postId)
    )
    .select(({ user, post, comment }) => ({
      userName: user.name,
      postTitle: post.title,
      commentText: comment.text,
    }))
)
```

## Subqueries

Subqueries allow you to use the result of one query as input to another, they are embedded within the query itself and are compile to a single query pipeline. They are very similar to SQL subqueries that are executed as part of a single operation.

Note that subqueries are not the same as using a live query result in a `from` or `join` clause in a new query. When you do that the intermediate result is fully computed and accessible to you, subqueries are internal to their parent query and not materialised to a collection themselves and so are more efficient.

See the [Caching Intermediate Results](#caching-intermediate-results) section for more details on using live query results in a `from` or `join` clause in a new query.

### Subqueries in `from` Clauses

Use a subquery as the main source:

```ts
const activeUserPosts = createCollection(liveQueryCollectionOptions({
  query: (q) => {
    // Build the subquery first
    const activeUsers = q
      .from({ user: usersCollection })
      .where(({ user }) => eq(user.active, true))
    
    // Use the subquery in the main query
    return q
      .from({ activeUser: activeUsers })
      .join({ post: postsCollection }, ({ activeUser, post }) => 
        eq(activeUser.id, post.userId)
      )
  }
}))
```

### Subqueries in `join` Clauses

Join with a subquery result:

```ts
const userRecentPosts = createCollection(liveQueryCollectionOptions({
  query: (q) => {
    // Build the subquery first
    const recentPosts = q
      .from({ post: postsCollection })
      .where(({ post }) => gt(post.createdAt, '2024-01-01'))
      .orderBy(({ post }) => post.createdAt, 'desc')
      .limit(1)
    
    // Use the subquery in the main query
    return q
      .from({ user: usersCollection })
      .join({ recentPost: recentPosts }, ({ user, recentPost }) => 
        eq(user.id, recentPost.userId)
      )
  }
}))
```

### Subquery deduplication  

When the same subquery is used multiple times within a query, it's automatically deduplicated and executed only once:

```ts
const complexQuery = createCollection(liveQueryCollectionOptions({
  query: (q) => {
    // Build the subquery once
    const activeUsers = q
      .from({ user: usersCollection })
      .where(({ user }) => eq(user.active, true))
    
    // Use the same subquery multiple times
    return q
      .from({ activeUser: activeUsers })
      .join({ post: postsCollection }, ({ activeUser, post }) => 
        eq(activeUser.id, post.userId)
      )
      .join({ comment: commentsCollection }, ({ activeUser, comment }) => 
        eq(activeUser.id, comment.userId)
      )
  }
}))
```

In this example, the `activeUsers` subquery is used twice but executed only once, improving performance.

### Complex Nested Subqueries

Build complex queries with multiple levels of nesting:

```ts
import { count } from '@tanstack/db'

const topUsers = createCollection(liveQueryCollectionOptions({
  query: (q) => {
    // Build the post count subquery
    const postCounts = q
      .from({ post: postsCollection })
      .groupBy(({ post }) => post.userId)
      .select(({ post }) => ({
        userId: post.userId,
        count: count(post.id),
      }))
    
    // Build the user stats subquery
    const userStats = q
      .from({ user: usersCollection })
      .join({ postCount: postCounts }, ({ user, postCount }) => 
        eq(user.id, postCount.userId)
      )
      .select(({ user, postCount }) => ({
        id: user.id,
        name: user.name,
        postCount: postCount.count,
      }))
      .orderBy(({ userStats }) => userStats.postCount, 'desc')
      .limit(10)
    
    // Use the user stats subquery in the main query
    return q.from({ userStats })
  }
}))
```

## groupBy and Aggregations

Use `groupBy` to group your data and apply aggregate functions. When you use aggregates in `select` without `groupBy`, the entire result set is treated as a single group.

### Method Signature

```ts
groupBy(
  grouper: (row: TRow) => Expression | Expression[]
): Query
```

**Parameters:**
- `grouper` - A callback function that receives the row object and returns the grouping key(s). Can return a single value or an array for multi-column grouping

### Basic Grouping

Group users by their department and count them:

```ts
import { count, avg } from '@tanstack/db'

const departmentStats = createCollection(liveQueryCollectionOptions({
  query: (q) =>
    q
      .from({ user: usersCollection })
      .groupBy(({ user }) => user.departmentId)
      .select(({ user }) => ({
        departmentId: user.departmentId,
        userCount: count(user.id),
        avgAge: avg(user.age),
      }))
}))
```

> [!NOTE]
> In `groupBy` queries, the properties in your `select` clause must either be:
> - An aggregate function (like `count`, `sum`, `avg`)
> - A property that was used in the `groupBy` clause
> 
> You cannot select properties that are neither aggregated nor grouped.

### Multiple Column Grouping

Group by multiple columns by returning an array from the callback:

```ts
const userStats = createCollection(liveQueryCollectionOptions({
  query: (q) =>
    q
      .from({ user: usersCollection })
      .groupBy(({ user }) => [user.departmentId, user.role])
      .select(({ user }) => ({
        departmentId: user.departmentId,
        role: user.role,
        count: count(user.id),
        avgSalary: avg(user.salary),
      }))
}))
```

### Aggregate Functions

Use various aggregate functions to summarize your data:

```ts
import { count, sum, avg, min, max } from '@tanstack/db'

const orderStats = createCollection(liveQueryCollectionOptions({
  query: (q) =>
    q
      .from({ order: ordersCollection })
      .groupBy(({ order }) => order.customerId)
      .select(({ order }) => ({
        customerId: order.customerId,
        totalOrders: count(order.id),
        totalAmount: sum(order.amount),
        avgOrderValue: avg(order.amount),
        minOrder: min(order.amount),
        maxOrder: max(order.amount),
      }))
}))
```

See the [Aggregate Functions](#aggregate-functions) section for a complete list of available aggregate functions.

### Having Clauses

Filter aggregated results using `having` - this is similar to the `where` clause, but is applied after the aggregation has been performed.

#### Method Signature

```ts
having(
  condition: (row: TRow) => Expression<boolean>
): Query
```

**Parameters:**
- `condition` - A callback function that receives table references (and `$selected` if the query contains a `select()` clause) and returns a boolean expression

```ts
// Using aggregate functions directly
const highValueCustomers = createLiveQueryCollection((q) =>
  q
    .from({ order: ordersCollection })
    .groupBy(({ order }) => order.customerId)
    .having(({ order }) => gt(sum(order.amount), 1000))
)

// Using SELECT fields via $selected (recommended when select() is used)
const highValueCustomersWithSelect = createLiveQueryCollection((q) =>
  q
    .from({ order: ordersCollection })
    .groupBy(({ order }) => order.customerId)
    .select(({ order }) => ({
      customerId: order.customerId,
      totalSpent: sum(order.amount),
      orderCount: count(order.id),
    }))
    .having(({ $selected }) => gt($selected.totalSpent, 1000))
)
```

### Implicit Single-Group Aggregation

When you use aggregates without `groupBy`, the entire result set is grouped:

```ts
const overallStats = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .select(({ user }) => ({
      totalUsers: count(user.id),
      avgAge: avg(user.age),
      maxSalary: max(user.salary),
    }))
)
```

This is equivalent to grouping the entire collection into a single group.

### Accessing Grouped Data

Grouped results can be accessed by the group key:

```ts
const deptStats = createCollection(liveQueryCollectionOptions({
  query: (q) =>
    q
      .from({ user: usersCollection })
      .groupBy(({ user }) => user.departmentId)
      .select(({ user }) => ({
        departmentId: user.departmentId,
        count: count(user.id),
      }))
}))

// Access by department ID
const engineeringStats = deptStats.get(1)
```

> **Note**: Grouped results are keyed differently based on the grouping:
> - **Single column grouping**: Keyed by the actual value (e.g., `deptStats.get(1)`)
> - **Multiple column grouping**: Keyed by a JSON string of the grouped values (e.g., `userStats.get('[1,"admin"]')`)

## findOne

Use `findOne` to return a single result instead of an array. This is useful when you expect to find at most one matching record, such as when querying by a unique identifier.

The `findOne` method changes the return type from an array to a single object or `undefined`. When no matching record is found, the result is `undefined`.

### Method Signature

```ts
findOne(): Query
```

### Basic Usage

Find a specific user by ID:

```ts
const user = createLiveQueryCollection((q) =>
  q
    .from({ users: usersCollection })
    .where(({ users }) => eq(users.id, 1))
    .findOne()
)

// Result type: User | undefined
// If user with id=1 exists: { id: 1, name: 'John', ... }
// If not found: undefined
```

### With React Hooks

Use `findOne` with `useLiveQuery` to get a single record:

```tsx
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/db'

function UserProfile({ userId }: { userId: string }) {
  const { data: user, isLoading } = useLiveQuery((q) =>
    q
      .from({ users: usersCollection })
      .where(({ users }) => eq(users.id, userId))
      .findOne()
  , [userId])

  if (isLoading) return <div>Loading...</div>
  if (!user) return <div>User not found</div>

  return <div>{user.name}</div>
}
```

### With Select

Combine `findOne` with `select` to project specific fields:

```ts
const userEmail = createLiveQueryCollection((q) =>
  q
    .from({ users: usersCollection })
    .where(({ users }) => eq(users.id, 1))
    .select(({ users }) => ({
      id: users.id,
      email: users.email,
    }))
    .findOne()
)

// Result type: { id: number, email: string } | undefined
```

### Return Type Behavior

The return type changes based on whether `findOne` is used:

```ts
// Without findOne - returns array
const users = createLiveQueryCollection((q) =>
  q.from({ users: usersCollection })
)
// Type: Array<User>

// With findOne - returns single object or undefined
const user = createLiveQueryCollection((q) =>
  q.from({ users: usersCollection }).findOne()
)
// Type: User | undefined
```

### Best Practices

**Use when:**
- Querying by unique identifiers (ID, email, etc.)
- You expect at most one result
- You want type-safe single-record access without array indexing

**Avoid when:**
- You might have multiple matching records (use regular queries instead)
- You need to iterate over results

## Distinct

Use `distinct` to remove duplicate rows from your query results based on the selected columns. The `distinct` operator ensures that each unique combination of selected values appears only once in the result set.

> [!IMPORTANT]
> The `distinct` operator requires a `select` clause. You cannot use `distinct` without specifying which columns to select.

### Method Signature

```ts
distinct(): Query
```

### Basic Usage

Get unique values from a single column:

```ts
const uniqueCountries = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .select(({ user }) => ({ country: user.country }))
    .distinct()
)

// Result contains only unique countries
// If you have users from USA, Canada, and UK, the result will have 3 items
```

### Multiple Column Distinct

Get unique combinations of multiple columns:

```ts
const uniqueRoleSalaryPairs = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .select(({ user }) => ({
      role: user.role,
      salary: user.salary,
    }))
    .distinct()
)

// Result contains only unique role-salary combinations
// e.g., Developer-75000, Developer-80000, Manager-90000
```

### Edge Cases

#### Null Values

Null values are treated as distinct values:

```ts
const uniqueValues = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .select(({ user }) => ({ department: user.department }))
    .distinct()
)

// If some users have null departments, null will appear as a distinct value
// Result might be: ['Engineering', 'Marketing', null]
```

## Order By, Limit, and Offset

Use `orderBy`, `limit`, and `offset` to control the order and pagination of your results. Ordering is performed incrementally for optimal performance.

### Method Signatures

```ts
orderBy(
  selector: (row: TRow) => Expression,
  direction?: 'asc' | 'desc'
): Query

limit(count: number): Query

offset(count: number): Query
```

**Parameters:**
- `selector` - A callback function that receives the row object and returns the value to sort by
- `direction` - Sort direction: `'asc'` (default) or `'desc'`
- `count` - Number of rows to limit or skip

### Basic Ordering

Sort results by a single column:

```ts
const sortedUsers = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .orderBy(({ user }) => user.name)
    .select(({ user }) => ({
      id: user.id,
      name: user.name,
    }))
)
```

### Multiple Column Ordering

Order by multiple columns:

```ts
const sortedUsers = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .orderBy(({ user }) => user.departmentId, 'asc')
    .orderBy(({ user }) => user.name, 'asc')
    .select(({ user }) => ({
      id: user.id,
      name: user.name,
      departmentId: user.departmentId,
    }))
)
```

### Ordering by SELECT Fields

When you use `select()` with aggregates or computed values, you can order by those fields using the `$selected` namespace:

```ts
const topCustomers = createLiveQueryCollection((q) =>
  q
    .from({ order: ordersCollection })
    .groupBy(({ order }) => order.customerId)
    .select(({ order }) => ({
      customerId: order.customerId,
      totalSpent: sum(order.amount),
      orderCount: count(order.id),
      latestOrder: max(order.createdAt),
    }))
    .orderBy(({ $selected }) => $selected.totalSpent, 'desc')
    .limit(10)
)
```

### Descending Order

Use `desc` for descending order:

```ts
const recentPosts = createLiveQueryCollection((q) =>
  q
    .from({ post: postsCollection })
    .orderBy(({ post }) => post.createdAt, 'desc')
    .select(({ post }) => ({
      id: post.id,
      title: post.title,
      createdAt: post.createdAt,
    }))
)
```

### Pagination with `limit` and `offset`

Skip results using `offset`:

```ts
const page2Users = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .orderBy(({ user }) => user.name, 'asc')
    .limit(20)
    .offset(20) // Skip first 20 results
    .select(({ user }) => ({
      id: user.id,
      name: user.name,
    }))
)
```

## Composable Queries

Build complex queries by composing smaller, reusable parts. This approach makes your queries more maintainable and allows for better performance through caching.

### Conditional Query Building

Build queries based on runtime conditions:

```ts
import { Query, eq } from '@tanstack/db'

function buildUserQuery(options: { activeOnly?: boolean; limit?: number }) {
  let query = new Query().from({ user: usersCollection })
  
  if (options.activeOnly) {
    query = query.where(({ user }) => eq(user.active, true))
  }
  
  if (options.limit) {
    query = query.limit(options.limit)
  }
  
  return query.select(({ user }) => ({
    id: user.id,
    name: user.name,
  }))
}

const activeUsers = createLiveQueryCollection(buildUserQuery({ activeOnly: true, limit: 10 }))
```

### Caching Intermediate Results

The result of a live query collection is a collection itself, and will automatically update when the underlying data changes. This means that you can use the result of a live query collection as a source in another live query collection. This pattern is useful for building complex queries where you want to cache intermediate results to make further queries faster.

```ts
// Base query for active users
const activeUsers = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.active, true))
)

// Query that depends on active users
const activeUserPosts = createLiveQueryCollection((q) =>
  q
    .from({ user: activeUsers })
    .join({ post: postsCollection }, ({ user, post }) => 
      eq(user.id, post.userId)
    )
    .select(({ user, post }) => ({
      userName: user.name,
      postTitle: post.title,
    }))
)
```

### Reusable Query Definitions

You can use the `Query` class to create reusable query definitions. This is useful for building complex queries where you want to reuse the same query builder instance multiple times throughout your application.

```ts
import { Query, eq } from '@tanstack/db'

// Create a reusable query builder
const userQuery = new Query()
  .from({ user: usersCollection })
  .where(({ user }) => eq(user.active, true))

// Use it in different contexts
const activeUsers = createLiveQueryCollection({
  query: userQuery.select(({ user }) => ({
    id: user.id,
    name: user.name,
  }))
})

// Or as a subquery
const userPosts = createLiveQueryCollection((q) =>
  q
    .from({ activeUser: userQuery })
    .join({ post: postsCollection }, ({ activeUser, post }) => 
      eq(activeUser.id, post.userId)
    )
)
```

### Reusable Callback Functions

Creating reusable query logic is a common pattern that improves code organization and maintainability. The recommended approach is to use callback functions with the `Ref<T>` type rather than trying to type `QueryBuilder` instances directly.

#### The Recommended Pattern

Use `Ref<MyType>` to create reusable filter and transform functions:

```ts
import type { Ref } from '@tanstack/db'
import { eq, gt, and } from '@tanstack/db'

// Create reusable filter callbacks
const isActiveUser = ({ user }: { user: Ref<User> }) =>
  eq(user.active, true)

const isAdultUser = ({ user }: { user: Ref<User> }) =>
  gt(user.age, 18)

const isActiveAdult = ({ user }: { user: Ref<User> }) =>
  and(isActiveUser({ user }), isAdultUser({ user }))

// Use them in queries - they work seamlessly with .where()
const activeAdults = createCollection(liveQueryCollectionOptions({
  query: (q) =>
    q
      .from({ user: usersCollection })
      .where(isActiveUser)
      .where(isAdultUser)
      .select(({ user }) => ({
        id: user.id,
        name: user.name,
        age: user.age,
      }))
}))
```

The callback signature `({ user }: { user: Ref<User> }) => Expression` matches exactly what `.where()` expects, making it type-safe and composable.

#### Chaining Multiple Filters

You can chain multiple reusable filters:

```tsx
import { useLiveQuery } from '@tanstack/react-db'

const { data } = useLiveQuery((q) => {
  return q
    .from({ item: itemsCollection })
    .where(({ item }) => eq(item.id, 1))
    .where(activeItemFilter)      // Reusable filter 1
    .where(verifiedItemFilter)     // Reusable filter 2
    .select(({ item }) => ({ ...item }))
}, [])
```

#### Using with Different Aliases

The pattern works with any table alias:

```ts
const activeFilter = ({ item }: { item: Ref<Item> }) =>
  eq(item.active, true)

// Works with any alias name
const query1 = new Query()
  .from({ item: itemsCollection })
  .where(activeFilter)

const query2 = new Query()
  .from({ i: itemsCollection })
  .where(({ i }) => activeFilter({ item: i }))  // Map the alias
```

#### Callbacks with Multiple Tables

For queries with joins, create callbacks that accept multiple refs:

```ts
const isHighValueCustomer = ({ user, order }: {
  user: Ref<User>
  order: Ref<Order>
}) => and(
  eq(user.active, true),
  gt(order.amount, 1000)
)

// Use directly in where clause
const highValueCustomers = createCollection(liveQueryCollectionOptions({
  query: (q) =>
    q
      .from({ user: usersCollection })
      .join({ order: ordersCollection }, ({ user, order }) =>
        eq(user.id, order.userId)
      )
      .where(isHighValueCustomer)
      .select(({ user, order }) => ({
        userName: user.name,
        orderAmount: order.amount,
      }))
}))
```

#### Why Not Type QueryBuilder?

You might be tempted to create functions that accept and return `QueryBuilder`:

```ts
// ❌ Not recommended - overly complex typing
const applyFilters = <T extends QueryBuilder<unknown>>(query: T): T => {
  return query.where(({ item }) => eq(item.active, true))
}
```

This approach has several issues:

1. **Complex Types**: `QueryBuilder<T>` generic represents the entire query context including base schema, current schema, joins, result types, etc.
2. **Type Inference**: The type changes with every method call, making it impractical to type manually
3. **Limited Flexibility**: Hard to compose multiple filters or use with different table aliases

Instead, use callback functions that work with the `.where()`, `.select()`, and other query methods directly.

#### Reusable Select Transformations

You can also create reusable select projections:

```ts
const basicUserInfo = ({ user }: { user: Ref<User> }) => ({
  id: user.id,
  name: user.name,
  email: user.email,
})

const userWithStats = ({ user }: { user: Ref<User> }) => ({
  ...basicUserInfo({ user }),
  isAdult: gt(user.age, 18),
  isActive: eq(user.active, true),
})

const users = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .select(userWithStats)
)
```

This approach makes your query logic more modular, testable, and reusable across your application.

## Expression Functions Reference

The query system provides a comprehensive set of functions for filtering, transforming, and aggregating data.

### Comparison Operators

#### `eq(left, right)`
Equality comparison:
```ts
eq(user.id, 1)
eq(user.name, 'John')
```

#### `gt(left, right)`, `gte(left, right)`, `lt(left, right)`, `lte(left, right)`
Numeric, string and date comparisons:
```ts
gt(user.age, 18)
gte(user.salary, 50000)
lt(user.createdAt, new Date('2024-01-01'))
lte(user.rating, 5)
```

#### `inArray(value, array)`
Check if a value is in an array:
```ts
inArray(user.id, [1, 2, 3])
inArray(user.role, ['admin', 'moderator'])
```

#### `like(value, pattern)`, `ilike(value, pattern)`
String pattern matching:
```ts
like(user.name, 'John%')    // Case-sensitive
ilike(user.email, '%@gmail.com')  // Case-insensitive
```

#### `isUndefined(value)`, `isNull(value)`
Check for missing vs null values:
```ts
// Check if a property is missing/undefined
isUndefined(user.profile)

// Check if a value is explicitly null
isNull(user.profile)
```

These functions are particularly important when working with joins and optional properties, as they distinguish between:
- `undefined`: The property is absent or not present
- `null`: The property exists but is explicitly set to null

**Example with joins:**
```ts
// Find users without a matching profile (left join resulted in undefined)
const usersWithoutProfiles = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .leftJoin(
      { profile: profilesCollection },
      ({ user, profile }) => eq(user.id, profile.userId)
    )
    .where(({ profile }) => isUndefined(profile))
)

// Find users with explicitly null bio field
const usersWithNullBio = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .where(({ user }) => isNull(user.bio))
)
```

### Logical Operators

#### `and(...conditions)`
Combine conditions with AND logic:
```ts
and(
  eq(user.active, true),
  gt(user.age, 18),
  eq(user.role, 'user')
)
```

#### `or(...conditions)`
Combine conditions with OR logic:
```ts
or(
  eq(user.role, 'admin'),
  eq(user.role, 'moderator')
)
```

#### `not(condition)`
Negate a condition:
```ts
not(eq(user.active, false))
```

### String Functions

#### `upper(value)`, `lower(value)`
Convert case:
```ts
upper(user.name)  // 'JOHN'
lower(user.email) // 'john@example.com'
```

#### `length(value)`
Get string or array length:
```ts
length(user.name)     // String length
length(user.tags)     // Array length
```

#### `concat(...values)`
Concatenate strings:
```ts
concat(user.firstName, ' ', user.lastName)
concat('User: ', user.name, ' (', user.id, ')')
```

### Mathematical Functions

#### `add(left, right)`
Add two numbers:
```ts
add(user.salary, user.bonus)
```

#### `coalesce(...values)`
Return the first non-null value:
```ts
coalesce(user.displayName, user.name, 'Unknown')
```

### Aggregate Functions

#### `count(value)`
Count non-null values:
```ts
count(user.id)        // Count all users
count(user.postId)    // Count users with posts
```

#### `sum(value)`
Sum numeric values:
```ts
sum(order.amount)
sum(user.salary)
```

#### `avg(value)`
Calculate average:
```ts
avg(user.salary)
avg(order.amount)
```

#### `min(value)`, `max(value)`
Find minimum and maximum values:
```ts
min(user.salary)
max(order.amount)
```

### Function Composition

Functions can be composed and chained:

```ts
// Complex condition
and(
  eq(user.active, true),
  or(
    gt(user.age, 25),
    eq(user.role, 'admin')
  ),
  not(inArray(user.id, bannedUserIds))
)

// Complex transformation
concat(
  upper(user.firstName),
  ' ',
  upper(user.lastName),
  ' (',
  user.id,
  ')'
)

// Complex aggregation
avg(add(user.salary, coalesce(user.bonus, 0)))
```

## Functional Variants

The functional variant API provides an alternative to the standard API, offering more flexibility for complex transformations. With functional variants, the callback functions contain actual code that gets executed to perform the operation, giving you the full power of JavaScript at your disposal.

> [!WARNING]
> The functional variant API cannot be optimized by the query optimizer or use collection indexes. It is intended for use in rare cases where the standard API is not sufficient.

### Functional Select

Use `fn.select()` for complex transformations with JavaScript logic:

```ts
const userProfiles = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .fn.select((row) => ({
      id: row.user.id,
      displayName: `${row.user.firstName} ${row.user.lastName}`,
      salaryTier: row.user.salary > 100000 ? 'senior' : 'junior',
      emailDomain: row.user.email.split('@')[1],
      isHighEarner: row.user.salary > 75000,
    }))
)
```

### Functional Where

Use `fn.where()` for complex filtering logic:

```ts
const specialUsers = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .fn.where((row) => {
      const user = row.user
      return user.active && 
             (user.age > 25 || user.role === 'admin') &&
             user.email.includes('@company.com')
    })
)
```

### Functional Having

Use `fn.having()` for complex aggregation filtering:

```ts
const highValueCustomers = createLiveQueryCollection((q) =>
  q
    .from({ order: ordersCollection })
    .groupBy(({ order }) => order.customerId)
    .select(({ order }) => ({
      customerId: order.customerId,
      totalSpent: sum(order.amount),
      orderCount: count(order.id),
    }))
    .fn.having(({ $selected }) => {
      return $selected.totalSpent > 1000 && $selected.orderCount >= 3
    })
)
```

### Complex Transformations

Functional variants excel at complex data transformations:

```ts
const userProfiles = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .fn.select((row) => {
      const user = row.user
      const fullName = `${user.firstName} ${user.lastName}`.trim()
      const emailDomain = user.email.split('@')[1]
      const ageGroup = user.age < 25 ? 'young' : user.age < 50 ? 'adult' : 'senior'
      
      return {
        userId: user.id,
        displayName: fullName || user.name,
        contactInfo: {
          email: user.email,
          domain: emailDomain,
          isCompanyEmail: emailDomain === 'company.com'
        },
        demographics: {
          age: user.age,
          ageGroup: ageGroup,
          isAdult: user.age >= 18
        },
        status: user.active ? 'active' : 'inactive',
        profileStrength: fullName && user.email && user.age ? 'complete' : 'incomplete'
      }
    })
)
```

### Type Inference

Functional variants maintain full TypeScript support:

```ts
const processedUsers = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .fn.select((row): ProcessedUser => ({
      id: row.user.id,
      name: row.user.name.toUpperCase(),
      age: row.user.age,
      ageGroup: row.user.age < 25 ? 'young' : row.user.age < 50 ? 'adult' : 'senior',
    }))
)
```

### When to Use Functional Variants

Use functional variants when you need:
- Complex JavaScript logic that can't be expressed with built-in functions
- Integration with external libraries or utilities
- Full JavaScript power for custom operations

The callbacks in functional variants are actual JavaScript functions that get executed, unlike the standard API which uses declarative expressions. This gives you complete control over the logic but comes with the trade-off of reduced optimization opportunities.

However, prefer the standard API when possible, as it provides better performance and optimization opportunities.
