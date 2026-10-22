---
id: DbClient
title: DbClient
---

Defined in: [packages/db/src/client.ts:337](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L337)

## Constructors

### Constructor

```ts
new DbClient(options): DbClient;
```

Defined in: [packages/db/src/client.ts:356](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L356)

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

Defined in: [packages/db/src/client.ts:374](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L374)

##### Returns

  \| [`Transaction`](../interfaces/Transaction.md)\<`Record`\<`string`, `unknown`\>\>
  \| `undefined`

## Methods

### \_assertLiveQuerySources()

```ts
_assertLiveQuerySources(queryHash, sources): void;
```

Defined in: [packages/db/src/client.ts:721](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L721)

**`Internal`**

Reject a local stream whose hash already names different sources.

#### Parameters

##### queryHash

`string`

##### sources

readonly `AnyCollection`[]

#### Returns

`void`

***

### \_consumeLiveQueryResult()

```ts
_consumeLiveQueryResult(queryHash, dehydratedAt): void;
```

Defined in: [packages/db/src/client.ts:743](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L743)

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

Defined in: [packages/db/src/client.ts:789](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L789)

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

Defined in: [packages/db/src/client.ts:716](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L716)

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

Defined in: [packages/db/src/client.ts:711](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L711)

**`Internal`**

#### Returns

`boolean`

***

### \_isSsrStreamingEnabled()

```ts
_isSsrStreamingEnabled(): boolean;
```

Defined in: [packages/db/src/client.ts:701](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L701)

**`Internal`**

#### Returns

`boolean`

***

### \_materializeCollectionForRender()

```ts
_materializeCollectionForRender<T, TKey, TSchema, TUtils>(options): Collection<T, TKey, TUtils, TSchema, [TSchema] extends [never] ? T : InferSchemaInput<TSchema>>;
```

Defined in: [packages/db/src/client.ts:517](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L517)

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
_registerLiveQuery(
   queryHash, 
   promise, 
sources?): Promise<void>;
```

Defined in: [packages/db/src/client.ts:751](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L751)

**`Internal`**

#### Parameters

##### queryHash

`string`

##### promise

`Promise`\<[`DehydratedLiveQueryResult`](../type-aliases/DehydratedLiveQueryResult.md)\<`object`, `string` \| `number`\>\>

##### sources?

readonly `AnyCollection`[]

#### Returns

`Promise`\<`void`\>

***

### \_registerLiveQueryResource()

```ts
_registerLiveQueryResource(owner, cleanup): () => void;
```

Defined in: [packages/db/src/client.ts:776](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L776)

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

Defined in: [packages/db/src/client.ts:706](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L706)

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

Defined in: [packages/db/src/client.ts:696](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L696)

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

Defined in: [packages/db/src/client.ts:686](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L686)

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

Defined in: [packages/db/src/client.ts:796](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L796)

#### Returns

`Promise`\<`void`\>

***

### collection()

#### Call Signature

```ts
collection<T, TKey, TUtils>(options, materializeOptions?): Collection<InferSchemaOutput<T>, TKey, TUtils, T, InferSchemaInput<T>> & NonSingleResult;
```

Defined in: [packages/db/src/client.ts:473](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L473)

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

Defined in: [packages/db/src/client.ts:483](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L483)

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

Defined in: [packages/db/src/client.ts:493](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L493)

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

Defined in: [packages/db/src/client.ts:501](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L501)

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

Defined in: [packages/db/src/client.ts:378](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L378)

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

Defined in: [packages/db/src/client.ts:607](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L607)

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

Defined in: [packages/db/src/client.ts:358](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L358)

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

Defined in: [packages/db/src/client.ts:668](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L668)

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

Defined in: [packages/db/src/client.ts:384](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L384)

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

Defined in: [packages/db/src/client.ts:362](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L362)

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

Defined in: [packages/db/src/client.ts:690](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L690)

#### Parameters

##### listener

(`event`) => `void`

#### Returns

```ts
(): void;
```

##### Returns

`void`
