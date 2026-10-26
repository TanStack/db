---
id: useLiveQuery
title: useLiveQuery
---

## Call Signature

```ts
function useLiveQuery<TContext>(queryFn): QueryResult<TContext>;
```

Defined in: [useLiveQuery.ts:153](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L153)

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

Defined in: [useLiveQuery.ts:157](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L157)

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

Defined in: [useLiveQuery.ts:163](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L163)

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

Defined in: [useLiveQuery.ts:169](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L169)

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

Defined in: [useLiveQuery.ts:193](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L193)

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

Defined in: [useLiveQuery.ts:197](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L197)

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

Defined in: [useLiveQuery.ts:211](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L211)

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

Defined in: [useLiveQuery.ts:224](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L224)

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
