---
id: injectLiveQuery
title: injectLiveQuery
---

## Call Signature

```ts
function injectLiveQuery<TContext, TParams>(options): InjectLiveQueryResult<TContext>;
```

Defined in: [angular-db/src/index.ts:120](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L120)

### Type Parameters

#### TContext

`TContext` *extends* `Context`

#### TParams

`TParams` *extends* `unknown`

### Parameters

#### options

##### params

() => `TParams`

##### pool?

\{
\}

Pass `pooledLiveQueries` to share one partition among equal-shape queries.

##### query

(`args`) => `QueryBuilder`\<`TContext`\>

### Returns

[`InjectLiveQueryResult`](../interfaces/InjectLiveQueryResult.md)\<`TContext`\>

## Call Signature

```ts
function injectLiveQuery<TContext, TParams>(options): InjectConditionalLiveQueryResult<TContext>;
```

Defined in: [angular-db/src/index.ts:132](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L132)

### Type Parameters

#### TContext

`TContext` *extends* `Context`

#### TParams

`TParams` *extends* `unknown`

### Parameters

#### options

##### params

() => `TParams`

##### pool?

\{
\}

Pass `pooledLiveQueries` to share one partition among equal-shape queries.

##### query

(`args`) => `QueryBuilder`\<`TContext`\> \| `null` \| `undefined`

### Returns

[`InjectConditionalLiveQueryResult`](../type-aliases/InjectConditionalLiveQueryResult.md)\<`TContext`\>

## Call Signature

```ts
function injectLiveQuery<TContext>(queryFn): InjectLiveQueryResult<TContext>;
```

Defined in: [angular-db/src/index.ts:144](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L144)

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

Defined in: [angular-db/src/index.ts:147](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L147)

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

Defined in: [angular-db/src/index.ts:152](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L152)

### Type Parameters

#### TContext

`TContext` *extends* `Context`

### Parameters

#### config

`LiveQueryHookConfig`\<`TContext`\>

### Returns

[`InjectLiveQueryResult`](../interfaces/InjectLiveQueryResult.md)\<`TContext`\>

## Call Signature

```ts
function injectLiveQuery<TResult, TKey, TUtils>(liveQueryCollection): InjectLiveQueryResultWithCollection<TResult, TKey, TUtils>;
```

Defined in: [angular-db/src/index.ts:156](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L156)

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

Defined in: [angular-db/src/index.ts:164](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L164)

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
