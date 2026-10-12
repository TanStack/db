---
id: DbClient
title: DbClient
---

Defined in: [packages/db/src/client.ts:316](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L316)

## Constructors

### Constructor

```ts
new DbClient(options): DbClient;
```

Defined in: [packages/db/src/client.ts:334](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L334)

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

Defined in: [packages/db/src/client.ts:352](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L352)

##### Returns

  \| [`Transaction`](../interfaces/Transaction.md)\<`Record`\<`string`, `unknown`\>\>
  \| `undefined`

## Methods

### \_consumeLiveQueryResult()

```ts
_consumeLiveQueryResult(queryHash, dehydratedAt): void;
```

Defined in: [packages/db/src/client.ts:646](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L646)

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

Defined in: [packages/db/src/client.ts:689](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L689)

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

Defined in: [packages/db/src/client.ts:641](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L641)

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

Defined in: [packages/db/src/client.ts:636](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L636)

**`Internal`**

#### Returns

`boolean`

***

### \_isSsrStreamingEnabled()

```ts
_isSsrStreamingEnabled(): boolean;
```

Defined in: [packages/db/src/client.ts:626](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L626)

**`Internal`**

#### Returns

`boolean`

***

### \_materializeCollectionForRender()

```ts
_materializeCollectionForRender<T, TKey, TSchema, TUtils>(options): Collection<T, TKey, TUtils, TSchema, [TSchema] extends [never] ? T : InferSchemaInput<TSchema>>;
```

Defined in: [packages/db/src/client.ts:442](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L442)

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

Defined in: [packages/db/src/client.ts:654](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L654)

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

Defined in: [packages/db/src/client.ts:676](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L676)

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

Defined in: [packages/db/src/client.ts:631](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L631)

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

Defined in: [packages/db/src/client.ts:621](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L621)

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

Defined in: [packages/db/src/client.ts:611](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L611)

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

Defined in: [packages/db/src/client.ts:696](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L696)

#### Returns

`Promise`\<`void`\>

***

### collection()

#### Call Signature

```ts
collection<T, TKey, TUtils>(options, materializeOptions?): Collection<InferSchemaOutput<T>, TKey, TUtils, T, InferSchemaInput<T>> & NonSingleResult;
```

Defined in: [packages/db/src/client.ts:398](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L398)

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

Defined in: [packages/db/src/client.ts:408](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L408)

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

Defined in: [packages/db/src/client.ts:418](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L418)

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

Defined in: [packages/db/src/client.ts:426](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L426)

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

Defined in: [packages/db/src/client.ts:356](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L356)

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

Defined in: [packages/db/src/client.ts:532](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L532)

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

Defined in: [packages/db/src/client.ts:336](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L336)

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

Defined in: [packages/db/src/client.ts:593](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L593)

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

Defined in: [packages/db/src/client.ts:362](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L362)

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

Defined in: [packages/db/src/client.ts:340](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L340)

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

Defined in: [packages/db/src/client.ts:615](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L615)

#### Parameters

##### listener

(`event`) => `void`

#### Returns

```ts
(): void;
```

##### Returns

`void`
