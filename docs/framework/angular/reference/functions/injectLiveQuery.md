---
id: injectLiveQuery
title: injectLiveQuery
---

# Function: injectLiveQuery()

## Call Signature

```ts
function injectLiveQuery<TContext, TParams>(options): InjectLiveQueryResult<TContext>;
```

Defined in: [index.ts:87](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L87)

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

[`InjectLiveQueryResult`](../interfaces/InjectLiveQueryResult.md)\<`TContext`\>

## Call Signature

```ts
function injectLiveQuery<TContext, TParams>(options): InjectLiveQueryResult<TContext>;
```

Defined in: [index.ts:97](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L97)

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

[`InjectLiveQueryResult`](../interfaces/InjectLiveQueryResult.md)\<`TContext`\>

## Call Signature

```ts
function injectLiveQuery<TContext>(queryFn): InjectLiveQueryResult<TContext>;
```

Defined in: [index.ts:107](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L107)

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\>

### Returns

[`InjectLiveQueryResult`](../interfaces/InjectLiveQueryResult.md)\<`TContext`\>

## Call Signature

```ts
function injectLiveQuery<TContext>(queryFn): InjectLiveQueryResult<TContext>;
```

Defined in: [index.ts:110](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L110)

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\> \| `null` \| `undefined`

### Returns

[`InjectLiveQueryResult`](../interfaces/InjectLiveQueryResult.md)\<`TContext`\>

## Call Signature

```ts
function injectLiveQuery<TContext>(config): InjectLiveQueryResult<TContext>;
```

Defined in: [index.ts:115](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L115)

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### config

`LiveQueryCollectionConfig`\<`TContext`\>

### Returns

[`InjectLiveQueryResult`](../interfaces/InjectLiveQueryResult.md)\<`TContext`\>

## Call Signature

```ts
function injectLiveQuery<TResult, TKey, TUtils>(liveQueryCollection): InjectLiveQueryResultWithCollection<TResult, TKey, TUtils>;
```

Defined in: [index.ts:119](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L119)

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

[`InjectLiveQueryResultWithCollection`](../interfaces/InjectLiveQueryResultWithCollection.md)\<`TResult`, `TKey`, `TUtils`\>

## Call Signature

```ts
function injectLiveQuery<TResult, TKey, TUtils>(liveQueryCollection): InjectLiveQueryResultWithSingleResultCollection<TResult, TKey, TUtils>;
```

Defined in: [index.ts:127](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L127)

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

[`InjectLiveQueryResultWithSingleResultCollection`](../interfaces/InjectLiveQueryResultWithSingleResultCollection.md)\<`TResult`, `TKey`, `TUtils`\>
