---
title: Live Queries
id: live-queries
---

# TanStack DB Live Queries

TanStack DB provides a powerful, type-safe query system that allows you to fetch, filter, transform, and aggregate data from collections using a SQL-like fluent API. All queries are **live** by default, meaning they automatically update when the underlying data changes.

The query system is built around a fluent API similar to SQL query builders like Kysely or Drizzle. The query builder doesn't perform operations in the order of method calls - instead, it composes your query into an optimal incremental pipeline that gets compiled and executed efficiently. Each method returns a new query builder, allowing you to chain operations together.

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

Live queries are just collections that automatically update when their underlying data changes. You can subscribe to changes, iterate over results, and use all the standard collection methods.

## Table of Contents

- [Creating Live Query Collections](#creating-live-query-collections)
- [Basic Queries](#basic-queries)
- [Where Clauses](#where-clauses)
- [Select Projections](#select-projections)
- [Joins](#joins)
- [Subqueries](#subqueries)
- [groupBy and Aggregations](#group-by-and-aggregations)
- [Order By, Limit, and Offset](#order-by-limit-and-offset)
- [Composable Queries](#composable-queries)
- [Functions Reference](#functions-reference)
- [Functional Variants](#functional-variants)

## Creating Live Query Collections

Live queries are collections that automatically update when their underlying data changes. You can create them using `liveQueryCollectionOptions` with `createCollection`, or use the convenience function `createLiveQueryCollection`.

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

For more details on framework integration, see the [React](/docs/framework/react/adapter) and [Vue](/docs/framework/vue/adapter) adapter documentation.

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `id` | `string` | Unique identifier (auto-generated if not provided) |
| `query` | `QueryBuilder` or function | The query definition |
| `getKey` | `(item) => string \| number` | Function to extract keys from results |
| `schema` | `Schema` | Optional schema for validation |
| `startSync` | `boolean` | Whether to start syncing immediately |
| `gcTime` | `number` | Garbage collection time in milliseconds |

## Basic Queries

The foundation of every query is the `from` method, which specifies the source collection or subquery. You can alias the source using object syntax.

### Simple Queries

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

### Table Aliasing

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

### Query Builder Pattern

Each method returns a new query builder, allowing you to chain operations:

```ts
const query = q
  .from({ user: usersCollection })
  .where(({ user }) => eq(user.active, true))
  .select(({ user }) => ({
    id: user.id,
    name: user.name,
  }))
  .orderBy(({ user }) => user.name, 'asc')
  .limit(10)

const activeUsers = createCollection(liveQueryCollectionOptions({ query }))
```

This pattern makes it easy to build complex queries step by step and reuse query parts.

## Where Clauses

Use `where` clauses to filter your data based on conditions. You can chain multiple `where` calls - they are combined with AND logic.

### Basic Filtering

Filter users by a simple condition:

```ts
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

For a complete reference of all available functions, see the [Functions Reference](#functions-reference) section.

## Select Projections

Use `select` to specify which fields to include in your results and transform your data. Without `select`, you get the full schema.

### Basic Projections

Select specific fields from your data:

```ts
const userNames = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .select(({ user }) => ({
      id: user.id,
      name: user.name,
      email: user.email,
    }))
)
```

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

### Using Functions

Transform your data using built-in functions:

```ts
import { upper, lower, concat } from '@tanstack/db'

const formattedUsers = createCollection(liveQueryCollectionOptions({
  query: (q) =>
    q
      .from({ user: usersCollection })
      .select(({ user }) => ({
        id: user.id,
        name: upper(user.name),
        email: lower(user.email),
        displayName: concat(user.firstName, ' ', user.lastName),
      }))
}))
```

### Including All Fields

To include all fields from a table, you can use the spread operator:

```ts
const usersWithExtra = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .select(({ user }) => ({
      ...user, // Include all user fields
      isActive: eq(user.active, true),
    }))
)
```

For a complete list of available functions, see the [Functions Reference](#functions-reference) section.

## Joins

Use `join` to combine data from multiple collections. Joins default to `left` join type and only support equality conditions.

### Basic Joins

Join users with their posts:

```ts
const userPosts = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .join({ post: postsCollection }, ({ user, post }) => 
      eq(user.id, post.userId)
    )
    .select(({ user, post }) => ({
      userName: user.name,
      postTitle: post.title,
      postContent: post.content,
    }))
)
```

### Join Types

Specify the join type as the third parameter:

```ts
// Inner join - only matching records
const activeUserPosts = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .join(
      { post: postsCollection }, 
      ({ user, post }) => eq(user.id, post.userId),
      'inner'
    )
)

// Right join - all posts, even without users
const allPosts = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .join(
      { post: postsCollection }, 
      ({ user, post }) => eq(user.id, post.userId),
      'right'
    )
)

// Full join - all users and all posts
const allUsersAndPosts = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .join(
      { post: postsCollection }, 
      ({ user, post }) => eq(user.id, post.userId),
      'full'
    )
)
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

### Join Results Without Select

When you don't use `select`, the result contains namespaced objects:

```ts
const userPosts = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .join({ post: postsCollection }, ({ user, post }) => 
      eq(user.id, post.userId)
    )
)

// Result type: { user: User, post: Post }
// Access: userPosts.get(1).user.name
```

### TypeScript Optionality

Join types affect TypeScript optionality. Left joins make joined fields optional:

```ts
// With left join, post fields are optional
const userPosts = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .join({ post: postsCollection }, ({ user, post }) => 
      eq(user.id, post.userId)
    )
    .select(({ user, post }) => ({
      userName: user.name,
      postTitle: post?.title, // post is optional
    }))
)
```

## Subqueries

Subqueries allow you to use the result of one query as input to another. They're different from using a live query collection directly - subqueries are embedded within the query itself.

### Subqueries in FROM Clauses

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

### Subqueries in JOIN Clauses

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

### Subquery Caching

When the same subquery is used multiple times within a query, it's automatically cached and executed only once:

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

### Basic Grouping

Group users by their department and count them:

```ts
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

> **Note**: In `groupBy` queries, the properties in your `select` clause must either be:
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

### Having Clauses

Filter aggregated results using `having`:

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
    .having(({ order }) => gt(sum(order.amount), 1000))
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

## Order By, Limit, and Offset

Use `orderBy`, `limit`, and `offset` to control the order and pagination of your results. Ordering is performed incrementally for optimal performance.

### Basic Ordering

Sort results by a single column:

```ts
const sortedUsers = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .orderBy(({ user }) => user.name, 'asc')
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

### Limiting Results

Limit the number of results returned:

```ts
const topUsers = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .orderBy(({ user }) => user.salary, 'desc')
    .limit(10)
    .select(({ user }) => ({
      id: user.id,
      name: user.name,
      salary: user.salary,
    }))
)
```

### Pagination with Offset

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

### Building Queries Incrementally

Create query parts and combine them:

```ts
// Base query for active users
const activeUsers = q
  .from({ user: usersCollection })
  .where(({ user }) => eq(user.active, true))

// Query for users with posts
const activeUsersWithPosts = q
  .from({ user: activeUsers })
  .join({ post: postsCollection }, ({ user, post }) => 
    eq(user.id, post.userId)
  )

// Final query with selection
const result = createLiveQueryCollection(activeUsersWithPosts
  .select(({ user, post }) => ({
    userName: user.name,
    postTitle: post.title,
  }))
)
```

### Conditional Query Building

Build queries based on runtime conditions:

```ts
function buildUserQuery(options: { activeOnly?: boolean; limit?: number }) {
  let query = q.from({ user: usersCollection })
  
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

Create live queries that depend on other live queries for automatic caching:

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

### Using Query Builder Instances

Create reusable query builder instances:

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

Use `Ref<MyType>` to create reusable callback functions:

```ts
import { Ref, eq, gt } from '@tanstack/db'

// Create reusable callbacks
const isActiveUser = (user: Ref<User>) => eq(user.active, true)
const isAdultUser = (user: Ref<User>) => gt(user.age, 18)

// Use them in queries
const activeAdults = createCollection(liveQueryCollectionOptions({
  query: (q) =>
    q
      .from({ user: usersCollection })
      .where(({ user }) => and(isActiveUser(user), isAdultUser(user)))
      .select(({ user }) => ({
        id: user.id,
        name: user.name,
        age: user.age,
      }))
}))
```

You can also create callbacks that take the whole row and pass them directly to `where`:

```ts
// Callback that takes the whole row
const isHighValueCustomer = (row: { user: User; order: Order }) => 
  row.user.active && row.order.amount > 1000

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

This approach makes your query logic more modular and testable.

## Functions Reference

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

The functional variant API provides an alternative to the standard API, offering more flexibility for complex transformations. With functional variants, the callback functions contain actual JavaScript code that gets executed to perform the operation, giving you the full power of JavaScript at your disposal. However, these variants cannot be optimized by the planned query optimizer or use the planned index system.

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
    .fn.having((row) => {
      return row.totalSpent > 1000 && row.orderCount >= 3
    })
)
```

### Complex Transformations

Functional variants excel at complex data transformations:

```ts
const userAnalytics = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .join({ post: postsCollection }, ({ user, post }) => 
      eq(user.id, post.userId)
    )
    .groupBy(({ user }) => user.id)
    .fn.select((row) => {
      const user = row.user
      const posts = row.posts || []
      
      return {
        userId: user.id,
        userName: user.name,
        postCount: posts.length,
        totalLikes: posts.reduce((sum, post) => sum + (post.likes || 0), 0),
        avgLikes: posts.length > 0 ? posts.reduce((sum, post) => sum + (post.likes || 0), 0) / posts.length : 0,
        engagement: posts.length > 0 ? 'high' : 'low',
        lastPostDate: posts.length > 0 ? Math.max(...posts.map(p => new Date(p.createdAt).getTime())) : null,
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
