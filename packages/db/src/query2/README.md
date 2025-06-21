# New query builder, IR and query compiler

## Example query in useLiveQuery format

```js
const comments = useLiveQuery((q) =>
  q
    .from({ comment: commentsCollection })
    .join(
      { user: usersCollection },
      ({ comment, user }) => eq(comment.user_id, user.id)
    )
    .where(({ comment }) => or(
      eq(comment.id, 1),
      eq(comment.id, 2)
    ))
    .orderBy(({ comment }) => comment.date, 'desc')
    .select(({ comment, user }) => ({
      id: comment.id,
      content: comment.content,
      user,
    )
);
```

Aggregates would look like this:

```js
useLiveQuery((q) =>
  q
    .from({ issue })
    .groupBy(({ issue }) => issue.status)
    .select(({ issue }) => ({
      status: issue.status,
      count: count(issue.id),
      avgDuration: avg(issue.duration),
    }))
)
```

## Example query in IR format

```js
{
  from: { type: "inputRef", name: "comment", value: CommentsCollection },
  select: {
    id: { type: 'ref', collection: "comments", prop: "id" },
    content: { type: 'ref', collection: "comments", prop: "content" },
    user: { type: 'ref', collection: "user" },
  },
  where: {
    type: 'func',
    name: 'or',
    args: [
      {
        type: 'func',
        name: 'eq',
        args: [
          { type: 'ref', collection: 'comments', prop: 'id' },
          { type: 'val', value: 1 }
        ]
      },
      {
        type: 'func',
        name: 'eq',
        args: [
          { type: 'ref', collection: 'comments', prop: 'id' },
          { type: 'val', value: 2 }
        ]
    }
  },
  join: [
    {
      from: 'user',
      type: 'left',
      left: { type: 'ref', collection: 'comments', prop: 'user_id' },
      right: { type: 'ref', collection: 'user', prop: 'id' }
    }
  ],
  orderBy: [
    {
      value: { type: 'ref', collection: 'comments', prop: 'date' },
      direction: 'desc'
    }
  ],
}
```

## Expressions in the IR

```js
// Referance
{
  type: 'ref',
  path: ['comments', 'id']
}

// Literal values
{ type: 'val', value: 1 }

// Function call
{ type: 'func', name: 'eq', args: [ /* ... */ ] }
{ type: 'func', name: 'upper', args: [ /* ... */ ] }
// Args = ref, val, func

// Aggregate functions
{ 
  type: 'agg',
  name: 'count',
  args: [ { type: 'ref', path: ['comments', 'id'] } ] 
}

```

## Operators

- `eq(left, right)`
- `gt(left, right)`
- `gte(left, right)`
- `lt(left, right)`
- `lte(left, right)`
- `and(left, right)`
- `or(left, right)`
- `not(value)`
- `in(value, array)`
- `like(left, right)`
- `ilike(left, right)`

## Functions

- `upper(arg)`
- `lower(arg)`
- `length(arg)`
- `concat(array)`
- `coalesce(array)`

## Aggregate functions

This can only be used in the `select` clause.

- `count(arg)`
- `avg(arg)`
- `sum(arg)`
- `min(arg)`
- `max(arg)`

## Composable queries

We also need to consider composable queries - this query:

```js
const { allAggregate, byStatusAggregate, firstTenIssues } = useLiveQuery((q) => {
  const baseQuery = q
    .from({ issue: issuesCollection })
    .where(({ issue }) => eq(issue.projectId, projectId))

  const allAggregate = q
    .from({ issue: baseQuery })
    .select(({ issue }) => ({
      count: count(issue.id),
      avgDuration: avg(issue.duration)
    }))

  const byStatusAggregate = q
    .from({ issue: baseQuery })
    .groupBy(({ issue }) => issue.status)
    .select(({ issue }) => ({
      status: issue.status,
      count: count(issue.id),
      avgDuration: avg(issue.duration)
    }))
  
  const activeUsers = q
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.status, 'active'))
    .select(({ user }) => ({
      id: user.id,
      name: user.name,
    }))

  const firstTenIssues = q
    .from({ issue: baseQuery })
    .join(
      { user: activeUsers },
      ({ user, issue }) => eq(user.id, issue.userId),
    )
    .orderBy(({ issue }) => issue.createdAt)
    .limit(10)
    .select(({ issue }) => ({
      id: issue.id,
      title: issue.title,
    }))

  return {
    allAggregate,
    byStatusAggregate,
    firstTenIssues,
  }
, [projectId]);
```

would result in this intermediate representation:

```js
{
  allAggregate: {
    from: {
      type: "queryRef",
      alias: "issue",
      value: {
        from: { 
          type: "collectionRef", 
          collection: IssuesCollection, 
          alias: "issue"
        },
        where: {
          type: "func",
          name: "eq",
          args: [
            { type: "ref", path: ["issue", "projectId"] },
            { type: "val", value: projectId },
          ],
        },
      },
    },
    select: {
      count: { 
        type: "agg",
        name: "count",
        args: [{ type: "ref", path: ["issue", "id"] }],
      },
    },
  }
  byStatusAggregate: {
    from: {
      type: "queryRef",
      alias: "issue",
      query: /* Ref the the same sub query object as allAggregate does in its from */,
    },
    groupBy: [{ type: "ref", path: ["issue", "status"] }],
    select: {
      count: { 
        type: "agg",
        name: "count",
        args: [{ type: "ref", path: ["issue", "id"] }],
      },
    },
  }
  firstTenIssues: {
    from: {
      type: "queryRef",
      alias: "issue",
      query: /* Ref the the same sub query object as allAggregate does in its from */,
    },
    join: [
      {
        from: { 
          type: "queryRef",
          alias: "user",
          query: {
            from: { 
              type: "collectionRef", 
              collection: UsersCollection, 
              alias: "user" 
            },
            where: {
              type: "func",
              name: "eq",
              args: [
                { type: "ref", path: ["user", "status"] },
                { type: "val", value: "active" },
              ],
            }
          },
        },
        type: "left",
        left: { type: "ref", path: ["issue", "userId"] },
        right: { type: "ref", path: ["user", "id"] },
      },
    ],
    orderBy: [{ type: "ref", path: ["issue", "createdAt"] }],
    limit: 10,
    select: {
      id: { type: "ref", path: ["issue", "id"] },
      title: { type: "ref", path: ["issue", "title"] },
    },
  }
}
```

## How the query builder will work

Each of the methods on the QueryBuilder will return a new QueryBuilder object.

Those that take a callback are passed a `RefProxy` object which records the path to the property. It will take a generic argument that is the shape of the data. So if you do `q.from({ user: usersCollection<User> })` then the `RefProxy` will have a type like:

```ts
RefProxy<{ user: User }>
```

The callback should return an expression.

There should be a generic context that is passed down through all the methods to new query builders. This should be used to infer the type of the query, providing type safety and autocompletion. It should also be used to infer the type of the result of the query.

### `from()`

`from` takes a single argument, which is an object with a single key, the alias, and a value which is a collection or a sub query.

### `select()`

`select` takes a callback, which is passed a `RefProxy` object. The callback should return an object with key/values paires, with the value being an expression.

### `join()`

`join` takes three arguments:

- an object with a single key, the alias, and a value which is a collection or a sub query
- a callback that is passed a `RefProxy` object of the current shape along with the new joined shape. It needs to return an `eq` expression. It will extract the left and right sides of the expression and use them as the left and right sides of the join in the IR.

### `where()` / `having()`

`where` and `having` take a callback, which is passed a `RefProxy` object. The callback should return an expression. This is evaluated to a boolean value for each row in the query, filtering out the rows that are false.

`having` is the same as `where`, but is applied after the `groupBy` clause.

### `groupBy()`

`groupBy` takes a callback, which is passed a `RefProxy` object. The callback should return an expression. This is evaluated to a value for each row in the query, grouping the rows by the value.

### `limit()` / `offset()`

`limit` and `offset` take a number.

### `orderBy()`

`orderBy` takes a callback, which is passed a `RefProxy` object. The callback should return an expression that is evaluated to a value for each row in the query, and the rows are sorted by the value.


# Example queries:

## 1. Simple filtering with multiple conditions

```js
const activeUsers = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .where(({ user }) => and(
      eq(user.status, 'active'),
      gt(user.lastLoginAt, new Date('2024-01-01'))
    ))
    .select(({ user }) => ({
      id: user.id,
      name: user.name,
      email: user.email,
    }))
);
```

## 2. Using string functions and LIKE operator

```js
const searchUsers = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .where(({ user }) => or(
      like(lower(user.name), '%john%'),
      like(lower(user.email), '%john%')
    ))
    .select(({ user }) => ({
      id: user.id,
      displayName: upper(user.name),
      emailLength: length(user.email),
    }))
);
```

## 3. Pagination with limit and offset

```js
const paginatedPosts = useLiveQuery((q) =>
  q
    .from({ post: postsCollection })
    .where(({ post }) => eq(post.published, true))
    .orderBy(({ post }) => post.createdAt, 'desc')
    .limit(10)
    .offset(page * 10)
    .select(({ post }) => ({
      id: post.id,
      title: post.title,
      excerpt: post.excerpt,
      publishedAt: post.publishedAt,
    }))
, [page]);
```

## 4. Complex aggregation with HAVING clause

```js
const popularCategories = useLiveQuery((q) =>
  q
    .from({ post: postsCollection })
    .join(
      { category: categoriesCollection },
      ({ post, category }) => eq(post.categoryId, category.id)
    )
    .groupBy(({ category }) => category.name)
    .having(({ post }) => gt(count(post.id), 5))
    .select(({ category, post }) => ({
      categoryName: category.name,
      postCount: count(post.id),
      avgViews: avg(post.views),
      totalViews: sum(post.views),
    }))
    .orderBy(({ post }) => count(post.id), 'desc')
);
```

## 5. Using IN operator with array

```js
const specificStatuses = useLiveQuery((q) =>
  q
    .from({ task: tasksCollection })
    .where(({ task }) => and(
      in(task.status, ['pending', 'in_progress', 'review']),
      gte(task.priority, 3)
    ))
    .select(({ task }) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
    }))
);
```

## 6. Multiple joins with different collections

```js
const orderDetails = useLiveQuery((q) =>
  q
    .from({ order: ordersCollection })
    .join(
      { customer: customersCollection },
      ({ order, customer }) => eq(order.customerId, customer.id)
    )
    .join(
      { product: productsCollection },
      ({ order, product }) => eq(order.productId, product.id)
    )
    .where(({ order }) => gte(order.createdAt, startDate))
    .select(({ order, customer, product }) => ({
      orderId: order.id,
      customerName: customer.name,
      productName: product.name,
      total: order.total,
      orderDate: order.createdAt,
    }))
    .orderBy(({ order }) => order.createdAt, 'desc')
, [startDate]);
```

## 7. Using COALESCE and string concatenation

```js
const userProfiles = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .select(({ user }) => ({
      id: user.id,
      fullName: concat([user.firstName, ' ', user.lastName]),
      displayName: coalesce([user.nickname, user.firstName, 'Anonymous']),
      bio: coalesce([user.bio, 'No bio available']),
    }))
);
```

## 8. Nested conditions with NOT operator

```js
const excludedPosts = useLiveQuery((q) =>
  q
    .from({ post: postsCollection })
    .where(({ post }) => and(
      eq(post.published, true),
      not(or(
        eq(post.categoryId, 1),
        like(post.title, '%draft%')
      ))
    ))
    .select(({ post }) => ({
      id: post.id,
      title: post.title,
      categoryId: post.categoryId,
    }))
);
```

## 9. Time-based analytics with date comparisons

```js
const monthlyStats = useLiveQuery((q) =>
  q
    .from({ event: eventsCollection })
    .where(({ event }) => and(
      gte(event.createdAt, startOfMonth),
      lt(event.createdAt, endOfMonth)
    ))
    .groupBy(({ event }) => event.type)
    .select(({ event }) => ({
      eventType: event.type,
      count: count(event.id),
      firstEvent: min(event.createdAt),
      lastEvent: max(event.createdAt),
    }))
, [startOfMonth, endOfMonth]);
```

## 10. Case-insensitive search with multiple fields

```js
const searchResults = useLiveQuery((q) =>
  q
    .from({ article: articlesCollection })
    .join(
      { author: authorsCollection },
      ({ article, author }) => eq(article.authorId, author.id)
    )
    .where(({ article, author }) => or(
      ilike(article.title, `%${searchTerm}%`),
      ilike(article.content, `%${searchTerm}%`),
      ilike(author.name, `%${searchTerm}%`)
    ))
    .select(({ article, author }) => ({
      id: article.id,
      title: article.title,
      authorName: author.name,
      snippet: article.content, // Would be truncated in real implementation
      relevanceScore: add(length(article.title), length(article.content)),
    }))
    .orderBy(({ article }) => article.updatedAt, 'desc')
    .limit(20)
, [searchTerm]);
```