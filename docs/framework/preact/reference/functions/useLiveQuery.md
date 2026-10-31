---
id: useLiveQuery
title: useLiveQuery
---

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn): QueryResult<TContext>;
```

Defined in: [useLiveQuery.ts:142](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L142)

Subscribe a Preact component to a live query.

The hook derives the query's identity from its structured IR on each render,
so values captured by the callback recompile the query when they change. A
query whose IR cannot be hashed, such as one using `fn.where`, throws
`UnhashableQueryIRError` unless its config supplies `queryKey`. While the
hook is mounted, each Collection ID its queries read must keep naming one
source object, or it throws `SourceCollectionIdReuseError`.
Return `undefined` or `null` from the callback to disable the query.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\>

### Returns

`QueryResult`\<`TContext`\>

### Examples

```ts
const { data, isLoading } = useLiveQuery((q) =>
  q
    .from({ todos: todosCollection })
    .where(({ todos }) => eq(todos.completed, false)),
)
```

```ts
// Disable the query until its input exists
const { data, isEnabled } = useLiveQuery((q) =>
  userId
    ? q
        .from({ todos: todosCollection })
        .where(({ todos }) => eq(todos.userId, userId))
    : undefined,
)
```

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn): ConditionalQueryResult<TContext>;
```

Defined in: [useLiveQuery.ts:146](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L146)

Subscribe a Preact component to a live query.

The hook derives the query's identity from its structured IR on each render,
so values captured by the callback recompile the query when they change. A
query whose IR cannot be hashed, such as one using `fn.where`, throws
`UnhashableQueryIRError` unless its config supplies `queryKey`. While the
hook is mounted, each Collection ID its queries read must keep naming one
source object, or it throws `SourceCollectionIdReuseError`.
Return `undefined` or `null` from the callback to disable the query.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\> \| `null` \| `undefined`

### Returns

`ConditionalQueryResult`\<`TContext`\>

### Examples

```ts
const { data, isLoading } = useLiveQuery((q) =>
  q
    .from({ todos: todosCollection })
    .where(({ todos }) => eq(todos.completed, false)),
)
```

```ts
// Disable the query until its input exists
const { data, isEnabled } = useLiveQuery((q) =>
  userId
    ? q
        .from({ todos: todosCollection })
        .where(({ todos }) => eq(todos.userId, userId))
    : undefined,
)
```

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn): ConditionalQueryResult<TContext>;
```

Defined in: [useLiveQuery.ts:152](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L152)

Subscribe a Preact component to a live query.

The hook derives the query's identity from its structured IR on each render,
so values captured by the callback recompile the query when they change. A
query whose IR cannot be hashed, such as one using `fn.where`, throws
`UnhashableQueryIRError` unless its config supplies `queryKey`. While the
hook is mounted, each Collection ID its queries read must keep naming one
source object, or it throws `SourceCollectionIdReuseError`.
Return `undefined` or `null` from the callback to disable the query.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => 
  \| `LiveQueryCollectionConfig`\<`TContext`, `RootQueryResult`\<`TContext`\>\>
  \| `null`
  \| `undefined`

### Returns

`ConditionalQueryResult`\<`TContext`\>

### Examples

```ts
const { data, isLoading } = useLiveQuery((q) =>
  q
    .from({ todos: todosCollection })
    .where(({ todos }) => eq(todos.completed, false)),
)
```

```ts
// Disable the query until its input exists
const { data, isEnabled } = useLiveQuery((q) =>
  userId
    ? q
        .from({ todos: todosCollection })
        .where(({ todos }) => eq(todos.userId, userId))
    : undefined,
)
```

## Call Signature

```ts
function useLiveQuery<TResult, TKey, TUtils>(queryFn): UseConditionalLiveQueryResult<TResult, TKey, TResult[], Collection<TResult, TKey, TUtils, StandardSchemaV1<unknown, unknown>, TResult>>;
```

Defined in: [useLiveQuery.ts:158](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L158)

Subscribe a Preact component to a live query.

The hook derives the query's identity from its structured IR on each render,
so values captured by the callback recompile the query when they change. A
query whose IR cannot be hashed, such as one using `fn.where`, throws
`UnhashableQueryIRError` unless its config supplies `queryKey`. While the
hook is mounted, each Collection ID its queries read must keep naming one
source object, or it throws `SourceCollectionIdReuseError`.
Return `undefined` or `null` from the callback to disable the query.

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

### Returns

[`UseConditionalLiveQueryResult`](../interfaces/UseConditionalLiveQueryResult.md)\<`TResult`, `TKey`, `TResult`[], `Collection`\<`TResult`, `TKey`, `TUtils`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `TResult`\>\>

### Examples

```ts
const { data, isLoading } = useLiveQuery((q) =>
  q
    .from({ todos: todosCollection })
    .where(({ todos }) => eq(todos.completed, false)),
)
```

```ts
// Disable the query until its input exists
const { data, isEnabled } = useLiveQuery((q) =>
  userId
    ? q
        .from({ todos: todosCollection })
        .where(({ todos }) => eq(todos.userId, userId))
    : undefined,
)
```

## Call Signature

```ts
function useLiveQuery<TContext>(config): QueryResult<TContext>;
```

Defined in: [useLiveQuery.ts:182](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L182)

Subscribe to a live query described by a config object.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### config

[`UseLiveQueryConfig`](../type-aliases/UseLiveQueryConfig.md)\<`TContext`\>

### Returns

`QueryResult`\<`TContext`\>

### Example

```ts
const { data } = useLiveQuery({
  query: (q) => q.from({ todos: todosCollection }),
  gcTime: 60_000,
})
```

## Call Signature

```ts
function useLiveQuery<TContext>(config): ConditionalQueryResult<TContext>;
```

Defined in: [useLiveQuery.ts:186](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L186)

Subscribe a Preact component to a live query.

The hook derives the query's identity from its structured IR on each render,
so values captured by the callback recompile the query when they change. A
query whose IR cannot be hashed, such as one using `fn.where`, throws
`UnhashableQueryIRError` unless its config supplies `queryKey`. While the
hook is mounted, each Collection ID its queries read must keep naming one
source object, or it throws `SourceCollectionIdReuseError`.
Return `undefined` or `null` from the callback to disable the query.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### config

[`ConditionalUseLiveQueryConfig`](../type-aliases/ConditionalUseLiveQueryConfig.md)\<`TContext`\>

### Returns

`ConditionalQueryResult`\<`TContext`\>

### Examples

```ts
const { data, isLoading } = useLiveQuery((q) =>
  q
    .from({ todos: todosCollection })
    .where(({ todos }) => eq(todos.completed, false)),
)
```

```ts
// Disable the query until its input exists
const { data, isEnabled } = useLiveQuery((q) =>
  userId
    ? q
        .from({ todos: todosCollection })
        .where(({ todos }) => eq(todos.userId, userId))
    : undefined,
)
```

## Call Signature

```ts
function useLiveQuery<TResult, TKey, TUtils>(liveQueryCollection): UseLiveQueryResult<TResult, TKey, TResult[], Collection<TResult, TKey, TUtils, StandardSchemaV1<unknown, unknown>, TResult>>;
```

Defined in: [useLiveQuery.ts:200](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L200)

Subscribe to an existing live-query Collection. The hook starts its sync and
leaves its retention policy to the caller.

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

[`UseLiveQueryResult`](../interfaces/UseLiveQueryResult.md)\<`TResult`, `TKey`, `TResult`[], `Collection`\<`TResult`, `TKey`, `TUtils`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `TResult`\>\>

### Example

```ts
const activeTodos = createLiveQueryCollection((q) =>
  q.from({ todos: todosCollection }).where(({ todos }) => todos.active),
)
const { data, collection } = useLiveQuery(activeTodos)
```

## Call Signature

```ts
function useLiveQuery<TResult, TKey, TUtils>(liveQueryCollection): UseLiveQueryResult<TResult, TKey, TResult | undefined, Collection<TResult, TKey, TUtils, StandardSchemaV1<unknown, unknown>, TResult> & SingleResult>;
```

Defined in: [useLiveQuery.ts:213](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L213)

Subscribe a Preact component to a live query.

The hook derives the query's identity from its structured IR on each render,
so values captured by the callback recompile the query when they change. A
query whose IR cannot be hashed, such as one using `fn.where`, throws
`UnhashableQueryIRError` unless its config supplies `queryKey`. While the
hook is mounted, each Collection ID its queries read must keep naming one
source object, or it throws `SourceCollectionIdReuseError`.
Return `undefined` or `null` from the callback to disable the query.

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

[`UseLiveQueryResult`](../interfaces/UseLiveQueryResult.md)\<`TResult`, `TKey`, `TResult` \| `undefined`, `Collection`\<`TResult`, `TKey`, `TUtils`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `TResult`\> & `SingleResult`\>

### Examples

```ts
const { data, isLoading } = useLiveQuery((q) =>
  q
    .from({ todos: todosCollection })
    .where(({ todos }) => eq(todos.completed, false)),
)
```

```ts
// Disable the query until its input exists
const { data, isEnabled } = useLiveQuery((q) =>
  userId
    ? q
        .from({ todos: todosCollection })
        .where(({ todos }) => eq(todos.userId, userId))
    : undefined,
)
```
