---
id: injectLiveQuery
title: injectLiveQuery
---

## Call Signature

```ts
function injectLiveQuery<TContext, TParams>(options): InjectLiveQueryResult<TContext>;
```

Defined in: [index.ts:119](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L119)

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
function injectLiveQuery<TContext, TParams>(options): InjectConditionalLiveQueryResult<TContext>;
```

Defined in: [index.ts:129](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L129)

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

[`InjectConditionalLiveQueryResult`](../type-aliases/InjectConditionalLiveQueryResult.md)\<`TContext`\>

## Call Signature

```ts
function injectLiveQuery<TContext>(queryFn): InjectLiveQueryResult<TContext>;
```

Defined in: [index.ts:139](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L139)

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
function injectLiveQuery<TContext>(queryFn): InjectConditionalLiveQueryResult<TContext>;
```

Defined in: [index.ts:142](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L142)

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### queryFn

(`q`) => `QueryBuilder`\<`TContext`\> \| `null` \| `undefined`

### Returns

[`InjectConditionalLiveQueryResult`](../type-aliases/InjectConditionalLiveQueryResult.md)\<`TContext`\>

## Call Signature

```ts
function injectLiveQuery<TContext>(config): InjectLiveQueryResult<TContext>;
```

Defined in: [index.ts:147](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L147)

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

Defined in: [index.ts:151](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L151)

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

Defined in: [index.ts:159](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L159)

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
