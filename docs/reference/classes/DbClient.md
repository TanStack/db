---
id: DbClient
title: DbClient
---

Defined in: [packages/db/src/client.ts:306](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L306)

## Constructors

### Constructor

```ts
new DbClient(options): DbClient;
```

Defined in: [packages/db/src/client.ts:324](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L324)

#### Parameters

##### options

[`DbClientOptions`](../type-aliases/DbClientOptions.md) = `{}`

#### Returns

`DbClient`

## Accessors

### activeTransaction

#### Get Signature

```ts
get activeTransaction(): 
  | Transaction<Record<string, unknown>>
  | undefined;
```

Defined in: [packages/db/src/client.ts:340](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L340)

##### Returns

  \| [`Transaction`](../interfaces/Transaction.md)\<`Record`\<`string`, `unknown`\>\>
  \| `undefined`

## Methods

### \_consumeLiveQueryResult()

```ts
_consumeLiveQueryResult(queryHash, dehydratedAt): void;
```

Defined in: [packages/db/src/client.ts:634](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L634)

**`Internal`**

#### Parameters

##### queryHash

`string`

##### dehydratedAt

`number`

#### Returns

`void`

***

### \_failPendingLiveQueries()

```ts
_failPendingLiveQueries(error): void;
```

Defined in: [packages/db/src/client.ts:677](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L677)

**`Internal`**

#### Parameters

##### error

`unknown`

#### Returns

`void`

***

### \_getLiveQuery()

```ts
_getLiveQuery(queryHash): DbClientLiveQuery | undefined;
```

Defined in: [packages/db/src/client.ts:629](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L629)

**`Internal`**

#### Parameters

##### queryHash

`string`

#### Returns

[`DbClientLiveQuery`](../type-aliases/DbClientLiveQuery.md) \| `undefined`

***

### \_isSsrServerCleanupEnabled()

```ts
_isSsrServerCleanupEnabled(): boolean;
```

Defined in: [packages/db/src/client.ts:624](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L624)

**`Internal`**

#### Returns

`boolean`

***

### \_isSsrStreamingEnabled()

```ts
_isSsrStreamingEnabled(): boolean;
```

Defined in: [packages/db/src/client.ts:614](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L614)

**`Internal`**

#### Returns

`boolean`

***

### \_materializeCollectionForRender()

```ts
_materializeCollectionForRender<T, TKey, TSchema, TUtils>(options): Collection<T, TKey, TUtils, TSchema, [TSchema] extends [never] ? T : InferSchemaInput<TSchema>>;
```

Defined in: [packages/db/src/client.ts:430](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L430)

**`Internal`**

#### Type Parameters

##### T

`T` *extends* `object`

##### TKey

`TKey` *extends* `string` \| `number`

##### TSchema

`TSchema` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

##### TUtils

`TUtils` *extends* [`UtilsRecord`](../type-aliases/UtilsRecord.md)

#### Parameters

##### options

[`CollectionOptions`](../type-aliases/CollectionOptions.md)\<`T`, `TKey`, `TSchema`, `TUtils`\>

#### Returns

[`Collection`](../interfaces/Collection.md)\<`T`, `TKey`, `TUtils`, `TSchema`, \[`TSchema`\] *extends* \[`never`\] ? `T` : [`InferSchemaInput`](../type-aliases/InferSchemaInput.md)\<`TSchema`\>\>

***

### \_registerLiveQuery()

```ts
_registerLiveQuery(queryHash, promise): Promise<void>;
```

Defined in: [packages/db/src/client.ts:642](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L642)

**`Internal`**

#### Parameters

##### queryHash

`string`

##### promise

`Promise`\<[`DehydratedLiveQueryResult`](../type-aliases/DehydratedLiveQueryResult.md)\<`object`, `string` \| `number`\>\>

#### Returns

`Promise`\<`void`\>

***

### \_registerLiveQueryResource()

```ts
_registerLiveQueryResource(owner, cleanup): () => void;
```

Defined in: [packages/db/src/client.ts:664](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L664)

**`Internal`**

#### Parameters

##### owner

`object`

##### cleanup

() => `Promise`\<`void`\>

#### Returns

```ts
(): void;
```

##### Returns

`void`

***

### \_setSsrServerCleanupEnabled()

```ts
_setSsrServerCleanupEnabled(enabled): void;
```

Defined in: [packages/db/src/client.ts:619](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L619)

**`Internal`**

#### Parameters

##### enabled

`boolean`

#### Returns

`void`

***

### \_setSsrStreamingEnabled()

```ts
_setSsrStreamingEnabled(enabled): void;
```

Defined in: [packages/db/src/client.ts:609](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L609)

**`Internal`**

#### Parameters

##### enabled

`boolean`

#### Returns

`void`

***

### applyCollectionChunk()

```ts
applyCollectionChunk(chunk): void;
```

Defined in: [packages/db/src/client.ts:599](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L599)

#### Parameters

##### chunk

[`DehydratedCollectionChunk`](../type-aliases/DehydratedCollectionChunk.md)

#### Returns

`void`

***

### cleanup()

```ts
cleanup(): Promise<void>;
```

Defined in: [packages/db/src/client.ts:684](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L684)

#### Returns

`Promise`\<`void`\>

***

### collection()

#### Call Signature

```ts
collection<T, TKey, TUtils>(options, materializeOptions?): Collection<InferSchemaOutput<T>, TKey, TUtils, T, InferSchemaInput<T>> & NonSingleResult;
```

Defined in: [packages/db/src/client.ts:386](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L386)

##### Type Parameters

###### T

`T` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

###### TKey

`TKey` *extends* `string` \| `number`

###### TUtils

`TUtils` *extends* [`UtilsRecord`](../type-aliases/UtilsRecord.md)

##### Parameters

###### options

[`CollectionOptions`](../type-aliases/CollectionOptions.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `T`, `TUtils`\> & [`NonSingleResult`](../type-aliases/NonSingleResult.md)

###### materializeOptions?

[`CollectionMaterializeOptions`](../type-aliases/CollectionMaterializeOptions.md)\<[`InferSchemaInput`](../type-aliases/InferSchemaInput.md)\<`T`\>\>

##### Returns

[`Collection`](../interfaces/Collection.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `TUtils`, `T`, [`InferSchemaInput`](../type-aliases/InferSchemaInput.md)\<`T`\>\> & [`NonSingleResult`](../type-aliases/NonSingleResult.md)

#### Call Signature

```ts
collection<T, TKey, TUtils>(options, materializeOptions?): Collection<InferSchemaOutput<T>, TKey, TUtils, T, InferSchemaInput<T>> & SingleResult;
```

Defined in: [packages/db/src/client.ts:396](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L396)

##### Type Parameters

###### T

`T` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

###### TKey

`TKey` *extends* `string` \| `number`

###### TUtils

`TUtils` *extends* [`UtilsRecord`](../type-aliases/UtilsRecord.md)

##### Parameters

###### options

[`CollectionOptions`](../type-aliases/CollectionOptions.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `T`, `TUtils`\> & [`SingleResult`](../type-aliases/SingleResult.md)

###### materializeOptions?

[`CollectionMaterializeOptions`](../type-aliases/CollectionMaterializeOptions.md)\<[`InferSchemaInput`](../type-aliases/InferSchemaInput.md)\<`T`\>\>

##### Returns

[`Collection`](../interfaces/Collection.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `TUtils`, `T`, [`InferSchemaInput`](../type-aliases/InferSchemaInput.md)\<`T`\>\> & [`SingleResult`](../type-aliases/SingleResult.md)

#### Call Signature

```ts
collection<T, TKey, TUtils>(options, materializeOptions?): Collection<T, TKey, TUtils, never, T> & NonSingleResult;
```

Defined in: [packages/db/src/client.ts:406](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L406)

##### Type Parameters

###### T

`T` *extends* `object`

###### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

###### TUtils

`TUtils` *extends* [`UtilsRecord`](../type-aliases/UtilsRecord.md) = [`UtilsRecord`](../type-aliases/UtilsRecord.md)

##### Parameters

###### options

[`CollectionOptions`](../type-aliases/CollectionOptions.md)\<`T`, `TKey`, `never`, `TUtils`\> & [`NonSingleResult`](../type-aliases/NonSingleResult.md)

###### materializeOptions?

[`CollectionMaterializeOptions`](../type-aliases/CollectionMaterializeOptions.md)\<`T`\>

##### Returns

[`Collection`](../interfaces/Collection.md)\<`T`, `TKey`, `TUtils`, `never`, `T`\> & [`NonSingleResult`](../type-aliases/NonSingleResult.md)

#### Call Signature

```ts
collection<T, TKey, TUtils>(options, materializeOptions?): Collection<T, TKey, TUtils, never, T> & SingleResult;
```

Defined in: [packages/db/src/client.ts:414](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L414)

##### Type Parameters

###### T

`T` *extends* `object`

###### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

###### TUtils

`TUtils` *extends* [`UtilsRecord`](../type-aliases/UtilsRecord.md) = [`UtilsRecord`](../type-aliases/UtilsRecord.md)

##### Parameters

###### options

[`CollectionOptions`](../type-aliases/CollectionOptions.md)\<`T`, `TKey`, `never`, `TUtils`\> & [`SingleResult`](../type-aliases/SingleResult.md)

###### materializeOptions?

[`CollectionMaterializeOptions`](../type-aliases/CollectionMaterializeOptions.md)\<`T`\>

##### Returns

[`Collection`](../interfaces/Collection.md)\<`T`, `TKey`, `TUtils`, `never`, `T`\> & [`SingleResult`](../type-aliases/SingleResult.md)

***

### createTransaction()

```ts
createTransaction<T>(config): Transaction<T>;
```

Defined in: [packages/db/src/client.ts:344](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L344)

#### Type Parameters

##### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

#### Parameters

##### config

[`TransactionConfig`](../interfaces/TransactionConfig.md)\<`T`\>

#### Returns

[`Transaction`](../interfaces/Transaction.md)\<`T`\>

***

### dehydrate()

```ts
dehydrate(options): DehydratedDbState;
```

Defined in: [packages/db/src/client.ts:520](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L520)

#### Parameters

##### options

[`DehydrateDbClientOptions`](../type-aliases/DehydrateDbClientOptions.md) = `{}`

#### Returns

[`DehydratedDbState`](../type-aliases/DehydratedDbState.md)

***

### getDependency()

```ts
getDependency<T>(key): T | undefined;
```

Defined in: [packages/db/src/client.ts:326](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L326)

#### Type Parameters

##### T

`T`

#### Parameters

##### key

`string`

#### Returns

`T` \| `undefined`

***

### hydrate()

```ts
hydrate(state): void;
```

Defined in: [packages/db/src/client.ts:581](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L581)

#### Parameters

##### state

[`DehydratedDbState`](../type-aliases/DehydratedDbState.md)

#### Returns

`void`

***

### preloadLiveQuery()

```ts
preloadLiveQuery(options): Promise<void>;
```

Defined in: [packages/db/src/client.ts:350](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L350)

#### Parameters

##### options

[`LiveQueryOptions`](../type-aliases/LiveQueryOptions.md)

#### Returns

`Promise`\<`void`\>

***

### requireDependency()

```ts
requireDependency<T>(key): T;
```

Defined in: [packages/db/src/client.ts:330](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L330)

#### Type Parameters

##### T

`T`

#### Parameters

##### key

`string`

#### Returns

`T`

***

### subscribe()

```ts
subscribe(listener): () => void;
```

Defined in: [packages/db/src/client.ts:603](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L603)

#### Parameters

##### listener

(`event`) => `void`

#### Returns

```ts
(): void;
```

##### Returns

`void`
