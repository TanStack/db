---
id: queryOnce
title: queryOnce
---

# Function: queryOnce()

## Call Signature

```ts
function queryOnce<TQueryFn, TQuery>(queryFn): Promise<InferResultType<ExtractContext<TQuery>>>;
```

Defined in: [packages/db/src/query/query-once.ts:59](https://github.com/TanStack/db/blob/main/packages/db/src/query/query-once.ts#L59)

Executes a one-shot query and returns the results as an array.

This function creates a live query collection, preloads it, extracts the results,
and automatically cleans up the collection. It's ideal for:
- AI/LLM context building
- Data export
- Background processing
- Testing

### Type Parameters

#### TQueryFn

`TQueryFn` *extends* (`q`) => [`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`any`\>

#### TQuery

`TQuery` *extends* [`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`any`\> = `ReturnType`\<`TQueryFn`\>

### Parameters

#### queryFn

`TQueryFn` & `RootQueryFn`\<`TQuery`\>

A function that receives the query builder and returns a query

### Returns

`Promise`\<[`InferResultType`](../type-aliases/InferResultType.md)\<[`ExtractContext`](../type-aliases/ExtractContext.md)\<`TQuery`\>\>\>

A promise that resolves to an array of query results

### Example

```typescript
// Basic query
const users = await queryOnce((q) =>
  q.from({ user: usersCollection })
)

// With filtering and projection
const activeUserNames = await queryOnce((q) =>
  q.from({ user: usersCollection })
   .where(({ user }) => eq(user.active, true))
   .select(({ user }) => ({ name: user.name }))
)
```

## Call Signature

```ts
function queryOnce<TQuery>(config): Promise<InferResultType<ExtractContext<TQuery>>>;
```

Defined in: [packages/db/src/query/query-once.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/query/query-once.ts#L83)

Executes a one-shot query using a configuration object.

### Type Parameters

#### TQuery

`TQuery` *extends* [`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`any`\>

### Parameters

#### config

[`QueryOnceConfig`](../interfaces/QueryOnceConfig.md)\<[`ExtractContext`](../type-aliases/ExtractContext.md)\<`TQuery`\>\> & `object`

Configuration object with the query function

### Returns

`Promise`\<[`InferResultType`](../type-aliases/InferResultType.md)\<[`ExtractContext`](../type-aliases/ExtractContext.md)\<`TQuery`\>\>\>

A promise that resolves to an array of query results

### Example

```typescript
const recentOrders = await queryOnce({
  query: (q) =>
    q.from({ order: ordersCollection })
     .orderBy(({ order }) => desc(order.createdAt))
     .limit(100),
})
```
