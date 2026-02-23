---
id: injectLiveQuery
title: injectLiveQuery
---

# Function: injectLiveQuery()

## Call Signature

```ts
function injectLiveQuery<TContext, TParams>(options): InjectLiveQueryResult<{ [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }>;
```

Defined in: index.ts:51

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

Defined in: index.ts:61

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

Defined in: index.ts:71

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

Defined in: index.ts:74

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

Defined in: index.ts:79

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

Defined in: index.ts:82

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
