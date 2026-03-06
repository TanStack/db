---
id: injectLiveQuery
title: injectLiveQuery
---

# Function: injectLiveQuery()

## Call Signature

```ts
function injectLiveQuery<TContext, TParams>(options): InjectLiveQueryResult<TContext>;
```

Defined in: [index.ts:89](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L89)

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

Defined in: [index.ts:99](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L99)

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

Defined in: [index.ts:109](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L109)

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

Defined in: [index.ts:112](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L112)

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

Defined in: [index.ts:117](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L117)

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

Defined in: [index.ts:121](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L121)

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

Defined in: [index.ts:129](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L129)

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
