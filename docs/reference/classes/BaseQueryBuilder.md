---
id: BaseQueryBuilder
title: BaseQueryBuilder
---

# Class: BaseQueryBuilder\<TContext\>

Defined in: [packages/db/src/query/builder/index.ts:54](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L54)

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md) = [`Context`](../interfaces/Context.md)

## Constructors

### Constructor

```ts
new BaseQueryBuilder<TContext>(query): BaseQueryBuilder<TContext>;
```

Defined in: [packages/db/src/query/builder/index.ts:57](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L57)

#### Parameters

##### query

`Partial`\<[`QueryIR`](../@tanstack/namespaces/IR/interfaces/QueryIR.md)\> = `{}`

#### Returns

`BaseQueryBuilder`\<`TContext`\>

## Accessors

### fn

#### Get Signature

```ts
get fn(): object;
```

Defined in: [packages/db/src/query/builder/index.ts:729](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L729)

Functional variants of the query builder
These are imperative function that are called for ery row.
Warning: that these cannot be optimized by the query compiler, and may prevent
some type of optimizations being possible.

##### Example

```ts
q.fn.select((row) => ({
  name: row.user.name.toUpperCase(),
  age: row.user.age + 1,
}))
```

##### Returns

###### having()

```ts
having(callback): QueryBuilder<TContext>;
```

Filter grouped rows using a function that operates on each aggregated row
Warning: This cannot be optimized by the query compiler

###### Parameters

###### callback

(`row`) => `any`

A function that receives an aggregated row (with $selected when select() was called) and returns a boolean

###### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`TContext`\>

A QueryBuilder with functional having filter applied

###### Example

```ts
// Functional having (not optimized)
query
  .from({ posts: postsCollection })
  .groupBy(({posts}) => posts.userId)
  .select(({posts}) => ({ userId: posts.userId, count: count(posts.id) }))
  .fn.having(({ $selected }) => $selected.count > 5)
```

###### select()

```ts
select<TFuncSelectResult>(callback): QueryBuilder<WithResult<TContext, TFuncSelectResult>>;
```

Select fields using a function that operates on each row
Warning: This cannot be optimized by the query compiler

###### Type Parameters

###### TFuncSelectResult

`TFuncSelectResult`

###### Parameters

###### callback

(`row`) => `TFuncSelectResult`

A function that receives a row and returns the selected value

###### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<[`WithResult`](../type-aliases/WithResult.md)\<`TContext`, `TFuncSelectResult`\>\>

A QueryBuilder with functional selection applied

###### Example

```ts
// Functional select (not optimized)
query
  .from({ users: usersCollection })
  .fn.select(row => ({
    name: row.users.name.toUpperCase(),
    age: row.users.age + 1,
  }))
```

###### where()

```ts
where(callback): QueryBuilder<TContext>;
```

Filter rows using a function that operates on each row
Warning: This cannot be optimized by the query compiler

###### Parameters

###### callback

(`row`) => `any`

A function that receives a row and returns a boolean

###### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`TContext`\>

A QueryBuilder with functional filtering applied

###### Example

```ts
// Functional where (not optimized)
query
  .from({ users: usersCollection })
  .fn.where(row => row.users.name.startsWith('A'))
```

## Methods

### \_getQuery()

```ts
_getQuery(): QueryIR;
```

Defined in: [packages/db/src/query/builder/index.ts:816](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L816)

#### Returns

[`QueryIR`](../@tanstack/namespaces/IR/interfaces/QueryIR.md)

***

### distinct()

```ts
distinct(): QueryBuilder<TContext>;
```

Defined in: [packages/db/src/query/builder/index.ts:668](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L668)

Specify that the query should return distinct rows.
Deduplicates rows based on the selected columns.

#### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`TContext`\>

A QueryBuilder with distinct enabled

#### Example

```ts
// Get countries our users are from
query
  .from({ users: usersCollection })
  .select(({users}) => users.country)
  .distinct()
```

***

### findOne()

```ts
findOne(): QueryBuilder<TContext & SingleResult>;
```

Defined in: [packages/db/src/query/builder/index.ts:688](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L688)

Specify that the query should return a single result

#### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`TContext` & [`SingleResult`](../type-aliases/SingleResult.md)\>

A QueryBuilder that returns the first result

#### Example

```ts
// Get the user matching the query
query
  .from({ users: usersCollection })
  .where(({users}) => eq(users.id, 1))
  .findOne()
```

***

### from()

```ts
from<TSource>(source): QueryBuilder<{
  baseSchema: SchemaFromSource<TSource>;
  fromSourceName: keyof TSource & string;
  hasJoins: false;
  schema: SchemaFromSource<TSource>;
}>;
```

Defined in: [packages/db/src/query/builder/index.ts:136](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L136)

Specify the source table or subquery for the query

#### Type Parameters

##### TSource

`TSource` *extends* [`Source`](../type-aliases/Source.md)

#### Parameters

##### source

`TSource`

An object with a single key-value pair where the key is the table alias and the value is a Collection or subquery

#### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<\{
  `baseSchema`: [`SchemaFromSource`](../type-aliases/SchemaFromSource.md)\<`TSource`\>;
  `fromSourceName`: keyof `TSource` & `string`;
  `hasJoins`: `false`;
  `schema`: [`SchemaFromSource`](../type-aliases/SchemaFromSource.md)\<`TSource`\>;
\}\>

A QueryBuilder with the specified source

#### Example

```ts
// Query from a collection
query.from({ users: usersCollection })

// Query from a subquery
const activeUsers = query.from({ u: usersCollection }).where(({u}) => eq(u.active, true))
query.from({ activeUsers })
```

***

### fullJoin()

```ts
fullJoin<TSource>(source, onCallback): QueryBuilder<MergeContextWithJoinType<TContext, SchemaFromSource<TSource>, "full">>;
```

Defined in: [packages/db/src/query/builder/index.ts:327](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L327)

Perform a FULL JOIN with another table or subquery

#### Type Parameters

##### TSource

`TSource` *extends* [`Source`](../type-aliases/Source.md)

#### Parameters

##### source

`TSource`

An object with a single key-value pair where the key is the table alias and the value is a Collection or subquery

##### onCallback

[`JoinOnCallback`](../type-aliases/JoinOnCallback.md)\<[`MergeContextForJoinCallback`](../type-aliases/MergeContextForJoinCallback.md)\<`TContext`, \{ \[K in string \| number \| symbol\]: \{ \[K in string \| number \| symbol\]: TSource\[K\] extends CollectionImpl\<any, any, any, any, any\> ? InferCollectionType\<any\[any\]\> : TSource\[K\] extends QueryBuilder\<TContext\> ? \{ \[K in string \| number \| symbol\]: ((...)\[(...)\] extends object ? any\[any\] : (...) extends (...) ? (...) : (...))\[K\] \} : never \}\[K\] \}\>\>

A function that receives table references and returns the join condition

#### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<[`MergeContextWithJoinType`](../type-aliases/MergeContextWithJoinType.md)\<`TContext`, [`SchemaFromSource`](../type-aliases/SchemaFromSource.md)\<`TSource`\>, `"full"`\>\>

A QueryBuilder with the full joined table available

#### Example

```ts
// Full join users with posts
query
  .from({ users: usersCollection })
  .fullJoin({ posts: postsCollection }, ({users, posts}) => eq(users.id, posts.userId))
```

***

### groupBy()

```ts
groupBy(callback): QueryBuilder<TContext>;
```

Defined in: [packages/db/src/query/builder/index.ts:590](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L590)

Group rows by one or more columns for aggregation

#### Parameters

##### callback

[`GroupByCallback`](../type-aliases/GroupByCallback.md)\<`TContext`\>

A function that receives table references and returns the field(s) to group by

#### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`TContext`\>

A QueryBuilder with grouping applied (enables aggregate functions in SELECT and HAVING)

#### Example

```ts
// Group by a single column
query
  .from({ posts: postsCollection })
  .groupBy(({posts}) => posts.userId)
  .select(({posts, count}) => ({
    userId: posts.userId,
    postCount: count()
  }))

// Group by multiple columns
query
  .from({ sales: salesCollection })
  .groupBy(({sales}) => [sales.region, sales.category])
  .select(({sales, sum}) => ({
    region: sales.region,
    category: sales.category,
    totalSales: sum(sales.amount)
  }))
```

***

### having()

```ts
having(callback): QueryBuilder<TContext>;
```

Defined in: [packages/db/src/query/builder/index.ts:414](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L414)

Filter grouped rows based on aggregate conditions

#### Parameters

##### callback

[`WhereCallback`](../type-aliases/WhereCallback.md)\<`TContext`\>

A function that receives table references and returns an expression

#### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`TContext`\>

A QueryBuilder with the having condition applied

#### Example

```ts
// Filter groups by count
query
  .from({ posts: postsCollection })
  .groupBy(({posts}) => posts.userId)
  .having(({posts}) => gt(count(posts.id), 5))

// Filter by average
query
  .from({ orders: ordersCollection })
  .groupBy(({orders}) => orders.customerId)
  .having(({orders}) => gt(avg(orders.total), 100))

// Multiple having calls are ANDed together
query
  .from({ orders: ordersCollection })
  .groupBy(({orders}) => orders.customerId)
  .having(({orders}) => gt(count(orders.id), 5))
  .having(({orders}) => gt(avg(orders.total), 100))
```

***

### innerJoin()

```ts
innerJoin<TSource>(source, onCallback): QueryBuilder<MergeContextWithJoinType<TContext, SchemaFromSource<TSource>, "inner">>;
```

Defined in: [packages/db/src/query/builder/index.ts:301](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L301)

Perform an INNER JOIN with another table or subquery

#### Type Parameters

##### TSource

`TSource` *extends* [`Source`](../type-aliases/Source.md)

#### Parameters

##### source

`TSource`

An object with a single key-value pair where the key is the table alias and the value is a Collection or subquery

##### onCallback

[`JoinOnCallback`](../type-aliases/JoinOnCallback.md)\<[`MergeContextForJoinCallback`](../type-aliases/MergeContextForJoinCallback.md)\<`TContext`, \{ \[K in string \| number \| symbol\]: \{ \[K in string \| number \| symbol\]: TSource\[K\] extends CollectionImpl\<any, any, any, any, any\> ? InferCollectionType\<any\[any\]\> : TSource\[K\] extends QueryBuilder\<TContext\> ? \{ \[K in string \| number \| symbol\]: ((...)\[(...)\] extends object ? any\[any\] : (...) extends (...) ? (...) : (...))\[K\] \} : never \}\[K\] \}\>\>

A function that receives table references and returns the join condition

#### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<[`MergeContextWithJoinType`](../type-aliases/MergeContextWithJoinType.md)\<`TContext`, [`SchemaFromSource`](../type-aliases/SchemaFromSource.md)\<`TSource`\>, `"inner"`\>\>

A QueryBuilder with the inner joined table available

#### Example

```ts
// Inner join users with posts
query
  .from({ users: usersCollection })
  .innerJoin({ posts: postsCollection }, ({users, posts}) => eq(users.id, posts.userId))
```

***

### join()

```ts
join<TSource, TJoinType>(
   source, 
   onCallback, 
type): QueryBuilder<MergeContextWithJoinType<TContext, SchemaFromSource<TSource>, TJoinType>>;
```

Defined in: [packages/db/src/query/builder/index.ts:179](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L179)

Join another table or subquery to the current query

#### Type Parameters

##### TSource

`TSource` *extends* [`Source`](../type-aliases/Source.md)

##### TJoinType

`TJoinType` *extends* `"inner"` \| `"left"` \| `"right"` \| `"full"` = `"left"`

#### Parameters

##### source

`TSource`

An object with a single key-value pair where the key is the table alias and the value is a Collection or subquery

##### onCallback

[`JoinOnCallback`](../type-aliases/JoinOnCallback.md)\<[`MergeContextForJoinCallback`](../type-aliases/MergeContextForJoinCallback.md)\<`TContext`, \{ \[K in string \| number \| symbol\]: \{ \[K in string \| number \| symbol\]: TSource\[K\] extends CollectionImpl\<any, any, any, any, any\> ? InferCollectionType\<any\[any\]\> : TSource\[K\] extends QueryBuilder\<TContext\> ? \{ \[K in string \| number \| symbol\]: ((...)\[(...)\] extends object ? any\[any\] : (...) extends (...) ? (...) : (...))\[K\] \} : never \}\[K\] \}\>\>

A function that receives table references and returns the join condition

##### type

`TJoinType` = `...`

The type of join: 'inner', 'left', 'right', or 'full' (defaults to 'left')

#### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<[`MergeContextWithJoinType`](../type-aliases/MergeContextWithJoinType.md)\<`TContext`, [`SchemaFromSource`](../type-aliases/SchemaFromSource.md)\<`TSource`\>, `TJoinType`\>\>

A QueryBuilder with the joined table available

#### Example

```ts
// Left join users with posts
query
  .from({ users: usersCollection })
  .join({ posts: postsCollection }, ({users, posts}) => eq(users.id, posts.userId))

// Inner join with explicit type
query
  .from({ u: usersCollection })
  .join({ p: postsCollection }, ({u, p}) => eq(u.id, p.userId), 'inner')
```

// Join with a subquery
const activeUsers = query.from({ u: usersCollection }).where(({u}) => eq(u.active, true))
query
  .from({ activeUsers })
  .join({ p: postsCollection }, ({u, p}) => eq(u.id, p.userId))

***

### leftJoin()

```ts
leftJoin<TSource>(source, onCallback): QueryBuilder<MergeContextWithJoinType<TContext, SchemaFromSource<TSource>, "left">>;
```

Defined in: [packages/db/src/query/builder/index.ts:249](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L249)

Perform a LEFT JOIN with another table or subquery

#### Type Parameters

##### TSource

`TSource` *extends* [`Source`](../type-aliases/Source.md)

#### Parameters

##### source

`TSource`

An object with a single key-value pair where the key is the table alias and the value is a Collection or subquery

##### onCallback

[`JoinOnCallback`](../type-aliases/JoinOnCallback.md)\<[`MergeContextForJoinCallback`](../type-aliases/MergeContextForJoinCallback.md)\<`TContext`, \{ \[K in string \| number \| symbol\]: \{ \[K in string \| number \| symbol\]: TSource\[K\] extends CollectionImpl\<any, any, any, any, any\> ? InferCollectionType\<any\[any\]\> : TSource\[K\] extends QueryBuilder\<TContext\> ? \{ \[K in string \| number \| symbol\]: ((...)\[(...)\] extends object ? any\[any\] : (...) extends (...) ? (...) : (...))\[K\] \} : never \}\[K\] \}\>\>

A function that receives table references and returns the join condition

#### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<[`MergeContextWithJoinType`](../type-aliases/MergeContextWithJoinType.md)\<`TContext`, [`SchemaFromSource`](../type-aliases/SchemaFromSource.md)\<`TSource`\>, `"left"`\>\>

A QueryBuilder with the left joined table available

#### Example

```ts
// Left join users with posts
query
  .from({ users: usersCollection })
  .leftJoin({ posts: postsCollection }, ({users, posts}) => eq(users.id, posts.userId))
```

***

### limit()

```ts
limit(count): QueryBuilder<TContext>;
```

Defined in: [packages/db/src/query/builder/index.ts:623](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L623)

Limit the number of rows returned by the query
`orderBy` is required for `limit`

#### Parameters

##### count

`number`

Maximum number of rows to return

#### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`TContext`\>

A QueryBuilder with the limit applied

#### Example

```ts
// Get top 5 posts by likes
query
  .from({ posts: postsCollection })
  .orderBy(({posts}) => posts.likes, 'desc')
  .limit(5)
```

***

### offset()

```ts
offset(count): QueryBuilder<TContext>;
```

Defined in: [packages/db/src/query/builder/index.ts:647](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L647)

Skip a number of rows before returning results
`orderBy` is required for `offset`

#### Parameters

##### count

`number`

Number of rows to skip

#### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`TContext`\>

A QueryBuilder with the offset applied

#### Example

```ts
// Get second page of results
query
  .from({ posts: postsCollection })
  .orderBy(({posts}) => posts.createdAt, 'desc')
  .offset(page * pageSize)
  .limit(pageSize)
```

***

### orderBy()

```ts
orderBy(callback, options): QueryBuilder<TContext>;
```

Defined in: [packages/db/src/query/builder/index.ts:514](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L514)

Sort the query results by one or more columns

#### Parameters

##### callback

[`OrderByCallback`](../type-aliases/OrderByCallback.md)\<`TContext`\>

A function that receives table references and returns the field to sort by

##### options

[`OrderByDirection`](../@tanstack/namespaces/IR/type-aliases/OrderByDirection.md) | `OrderByOptions`

#### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`TContext`\>

A QueryBuilder with the ordering applied

#### Example

```ts
// Sort by a single column
query
  .from({ users: usersCollection })
  .orderBy(({users}) => users.name)

// Sort descending
query
  .from({ users: usersCollection })
  .orderBy(({users}) => users.createdAt, 'desc')

// Multiple sorts (chain orderBy calls)
query
  .from({ users: usersCollection })
  .orderBy(({users}) => users.lastName)
  .orderBy(({users}) => users.firstName)
```

***

### rightJoin()

```ts
rightJoin<TSource>(source, onCallback): QueryBuilder<MergeContextWithJoinType<TContext, SchemaFromSource<TSource>, "right">>;
```

Defined in: [packages/db/src/query/builder/index.ts:275](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L275)

Perform a RIGHT JOIN with another table or subquery

#### Type Parameters

##### TSource

`TSource` *extends* [`Source`](../type-aliases/Source.md)

#### Parameters

##### source

`TSource`

An object with a single key-value pair where the key is the table alias and the value is a Collection or subquery

##### onCallback

[`JoinOnCallback`](../type-aliases/JoinOnCallback.md)\<[`MergeContextForJoinCallback`](../type-aliases/MergeContextForJoinCallback.md)\<`TContext`, \{ \[K in string \| number \| symbol\]: \{ \[K in string \| number \| symbol\]: TSource\[K\] extends CollectionImpl\<any, any, any, any, any\> ? InferCollectionType\<any\[any\]\> : TSource\[K\] extends QueryBuilder\<TContext\> ? \{ \[K in string \| number \| symbol\]: ((...)\[(...)\] extends object ? any\[any\] : (...) extends (...) ? (...) : (...))\[K\] \} : never \}\[K\] \}\>\>

A function that receives table references and returns the join condition

#### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<[`MergeContextWithJoinType`](../type-aliases/MergeContextWithJoinType.md)\<`TContext`, [`SchemaFromSource`](../type-aliases/SchemaFromSource.md)\<`TSource`\>, `"right"`\>\>

A QueryBuilder with the right joined table available

#### Example

```ts
// Right join users with posts
query
  .from({ users: usersCollection })
  .rightJoin({ posts: postsCollection }, ({users, posts}) => eq(users.id, posts.userId))
```

***

### select()

```ts
select<TSelectObject>(callback): QueryBuilder<WithResult<TContext, ResultTypeFromSelect<TSelectObject>>>;
```

Defined in: [packages/db/src/query/builder/index.ts:473](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L473)

Select specific columns or computed values from the query

#### Type Parameters

##### TSelectObject

`TSelectObject` *extends* `SelectShape`

#### Parameters

##### callback

(`refs`) => `TSelectObject`

A function that receives table references and returns an object with selected fields or expressions

#### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<[`WithResult`](../type-aliases/WithResult.md)\<`TContext`, [`ResultTypeFromSelect`](../type-aliases/ResultTypeFromSelect.md)\<`TSelectObject`\>\>\>

A QueryBuilder that returns only the selected fields

#### Example

```ts
// Select specific columns
query
  .from({ users: usersCollection })
  .select(({users}) => ({
    name: users.name,
    email: users.email
  }))

// Select with computed values
query
  .from({ users: usersCollection })
  .select(({users}) => ({
    fullName: concat(users.firstName, ' ', users.lastName),
    ageInMonths: mul(users.age, 12)
  }))

// Select with aggregates (requires GROUP BY)
query
  .from({ posts: postsCollection })
  .groupBy(({posts}) => posts.userId)
  .select(({posts, count}) => ({
    userId: posts.userId,
    postCount: count(posts.id)
  }))
```

***

### where()

```ts
where(callback): QueryBuilder<TContext>;
```

Defined in: [packages/db/src/query/builder/index.ts:366](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L366)

Filter rows based on a condition

#### Parameters

##### callback

[`WhereCallback`](../type-aliases/WhereCallback.md)\<`TContext`\>

A function that receives table references and returns an expression

#### Returns

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`TContext`\>

A QueryBuilder with the where condition applied

#### Example

```ts
// Simple condition
query
  .from({ users: usersCollection })
  .where(({users}) => gt(users.age, 18))

// Multiple conditions
query
  .from({ users: usersCollection })
  .where(({users}) => and(
    gt(users.age, 18),
    eq(users.active, true)
  ))

// Multiple where calls are ANDed together
query
  .from({ users: usersCollection })
  .where(({users}) => gt(users.age, 18))
  .where(({users}) => eq(users.active, true))
```
