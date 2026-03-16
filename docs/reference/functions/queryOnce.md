---
id: queryOnce
title: queryOnce
---

# Function: queryOnce()

## Call Signature

```ts
function queryOnce<TContext>(queryFn): Promise<InferResultType<TContext>>;
```

Defined in: [packages/db/src/query/query-once.ts:47](https://github.com/TanStack/db/blob/main/packages/db/src/query/query-once.ts#L47)

Executes a one-shot query and returns the results as an array.

This function creates a live query collection, preloads it, extracts the results,
and automatically cleans up the collection. It's ideal for:
- AI/LLM context building
- Data export
- Background processing
- Testing

### Type Parameters

#### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

### Parameters

#### queryFn

(`q`) => [`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`TContext`\>

A function that receives the query builder and returns a query

### Returns

`Promise`\<[`InferResultType`](../type-aliases/InferResultType.md)\<`TContext`\>\>

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
function queryOnce<TContext>(config): Promise<InferResultType<TContext>>;
```

Defined in: [packages/db/src/query/query-once.ts:68](https://github.com/TanStack/db/blob/main/packages/db/src/query/query-once.ts#L68)

Executes a one-shot query using a configuration object.

### Type Parameters

#### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

### Parameters

#### config

[`QueryOnceConfig`](../interfaces/QueryOnceConfig.md)\<`TContext`\>

Configuration object with the query function

### Returns

`Promise`\<[`InferResultType`](../type-aliases/InferResultType.md)\<`TContext`\>\>

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
