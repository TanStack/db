---
id: injectLiveQuery
title: injectLiveQuery
---

# Function: injectLiveQuery()

## Call Signature

```ts
function injectLiveQuery<TContext, TParams>(options): InjectLiveQueryResult<{ [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }>;
```

Defined in: [index.ts:51](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L51)

## Virtual properties

Live query results include computed, read-only virtual properties on every row:

- `$synced`: `true` when the row is confirmed by sync; `false` when it is still optimistic.
- `$origin`: `"local"` if the last confirmed change came from this client, otherwise `"remote"`.
- `$key`: the row key for the result.
- `$collectionId`: the source collection ID.

These props can be used in `where`, `select`, and `orderBy` clauses. They are added to
query outputs automatically and should not be persisted back to storage.

### Type Parameters

#### TContext

`TContext` *extends* `Context`

#### TParams

`TParams` *extends* `unknown`

### Parameters

#### options

##### params

() => `TParams`

##### query

(`args`) => `QueryBuilder`\<`TContext`\>

### Returns

[`InjectLiveQueryResult`](../interfaces/InjectLiveQueryResult.md)\<\{ \[K in string \| number \| symbol\]: (TContext\["result"\] extends object ? any\[any\] : TContext\["hasJoins"\] extends true ? TContext\["schema"\] : TContext\["schema"\]\[TContext\["fromSourceName"\]\])\[K\] \}\>

## Call Signature

```ts
function injectLiveQuery<TContext, TParams>(options): InjectLiveQueryResult<{ [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }>;
```

Defined in: [index.ts:61](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L61)

### Type Parameters

#### TContext

`TContext` *extends* `Context`

#### TParams

`TParams` *extends* `unknown`

### Parameters

#### options

##### params

() => `TParams`

##### query

(`args`) => `QueryBuilder`\<`TContext`\> \| `null` \| `undefined`

### Returns

[`InjectLiveQueryResult`](../interfaces/InjectLiveQueryResult.md)\<\{ \[K in string \| number \| symbol\]: (TContext\["result"\] extends object ? any\[any\] : TContext\["hasJoins"\] extends true ? TContext\["schema"\] : TContext\["schema"\]\[TContext\["fromSourceName"\]\])\[K\] \}\>

## Call Signature

```ts
function injectLiveQuery<TContext>(queryFn): InjectLiveQueryResult<{ [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }>;
```

Defined in: [index.ts:71](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L71)

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\>

### Returns

[`InjectLiveQueryResult`](../interfaces/InjectLiveQueryResult.md)\<\{ \[K in string \| number \| symbol\]: (TContext\["result"\] extends object ? any\[any\] : TContext\["hasJoins"\] extends true ? TContext\["schema"\] : TContext\["schema"\]\[TContext\["fromSourceName"\]\])\[K\] \}\>

## Call Signature

```ts
function injectLiveQuery<TContext>(queryFn): InjectLiveQueryResult<{ [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }>;
```

Defined in: [index.ts:74](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L74)

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\> \| `null` \| `undefined`

### Returns

[`InjectLiveQueryResult`](../interfaces/InjectLiveQueryResult.md)\<\{ \[K in string \| number \| symbol\]: (TContext\["result"\] extends object ? any\[any\] : TContext\["hasJoins"\] extends true ? TContext\["schema"\] : TContext\["schema"\]\[TContext\["fromSourceName"\]\])\[K\] \}\>

## Call Signature

```ts
function injectLiveQuery<TContext>(config): InjectLiveQueryResult<{ [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }>;
```

Defined in: [index.ts:79](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L79)

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### config

`LiveQueryCollectionConfig`\<`TContext`\>

### Returns

[`InjectLiveQueryResult`](../interfaces/InjectLiveQueryResult.md)\<\{ \[K in string \| number \| symbol\]: (TContext\["result"\] extends object ? any\[any\] : TContext\["hasJoins"\] extends true ? TContext\["schema"\] : TContext\["schema"\]\[TContext\["fromSourceName"\]\])\[K\] \}\>

## Call Signature

```ts
function injectLiveQuery<TResult, TKey, TUtils>(liveQueryCollection): InjectLiveQueryResult<TResult, TKey, TUtils>;
```

Defined in: [index.ts:82](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L82)

### Type Parameters

#### TResult

`TResult` *extends* `object`

#### TKey

`TKey` *extends* `string` \| `number`

#### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>

### Parameters

#### liveQueryCollection

`Collection`\<`TResult`, `TKey`, `TUtils`\>

### Returns

[`InjectLiveQueryResult`](../interfaces/InjectLiveQueryResult.md)\<`TResult`, `TKey`, `TUtils`\>
