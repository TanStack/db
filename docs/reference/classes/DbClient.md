---
id: DbClient
title: DbClient
---

Defined in: [packages/db/src/client.ts:348](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L348)

## Constructors

### Constructor

```ts
new DbClient(options): DbClient;
```

Defined in: [packages/db/src/client.ts:375](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L375)

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

Defined in: [packages/db/src/client.ts:393](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L393)

##### Returns

  \| [`Transaction`](../interfaces/Transaction.md)\<`Record`\<`string`, `unknown`\>\>
  \| `undefined`

## Methods

### \_assertLiveQuerySources()

```ts
_assertLiveQuerySources(queryHash, sources): void;
```

Defined in: [packages/db/src/client.ts:831](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L831)

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

### \_bindLiveQueryObserver()

```ts
_bindLiveQueryObserver<T, TKey>(
   collection, 
   queryHash, 
   suspendUntilReady, 
host): LiveQueryObserverClient<T, TKey>;
```

Defined in: [packages/db/src/client.ts:729](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L729)

**`Internal`**

Supply transport behavior without coupling ordinary observers to SSR.

#### Type Parameters

##### T

`T` *extends* `object`

##### TKey

`TKey` *extends* `string` \| `number`

#### Parameters

##### collection

[`Collection`](../interfaces/Collection.md)\<`T`, `TKey`, `any`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `T`\> | `null`

##### queryHash

`string` | `undefined`

##### suspendUntilReady

`boolean`

##### host

`LiveQueryObserverClientHost`\<`T`, `TKey`\>

#### Returns

`LiveQueryObserverClient`\<`T`, `TKey`\>

***

### \_captureServerQuery()

```ts
_captureServerQuery(
   queryHash, 
   snapshot, 
   sources?): void;
```

Defined in: [packages/db/src/client.ts:861](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L861)

**`Internal`**

Capture the first server view without starting acquisition.

#### Parameters

##### queryHash

`string`

##### snapshot

[`DehydratedLiveQueryResult`](../type-aliases/DehydratedLiveQueryResult.md)

##### sources?

readonly `AnyCollection`[]

#### Returns

`void`

***

### \_consumeLiveQueryResult()

```ts
_consumeLiveQueryResult(queryHash, dehydratedAt): void;
```

Defined in: [packages/db/src/client.ts:853](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L853)

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

Defined in: [packages/db/src/client.ts:939](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L939)

**`Internal`**

#### Parameters

##### error

`unknown`

#### Returns

`void`

***

### \_getLiveQuery()

```ts
_getLiveQuery(queryHash, forServerSnapshot): DbClientLiveQuery | undefined;
```

Defined in: [packages/db/src/client.ts:820](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L820)

**`Internal`**

#### Parameters

##### queryHash

`string`

##### forServerSnapshot

`boolean` = `false`

#### Returns

[`DbClientLiveQuery`](../type-aliases/DbClientLiveQuery.md) \| `undefined`

***

### \_hasSsrCollectionSnapshot()

```ts
_hasSsrCollectionSnapshot(collection): boolean;
```

Defined in: [packages/db/src/client.ts:745](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L745)

**`Internal`**

Normalized source transport carries rows, not readiness.

#### Parameters

##### collection

`AnyCollection`

#### Returns

`boolean`

***

### \_isSsrServerCleanupEnabled()

```ts
_isSsrServerCleanupEnabled(): boolean;
```

Defined in: [packages/db/src/client.ts:815](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L815)

**`Internal`**

#### Returns

`boolean`

***

### \_isSsrStreamingEnabled()

```ts
_isSsrStreamingEnabled(): boolean;
```

Defined in: [packages/db/src/client.ts:805](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L805)

**`Internal`**

#### Returns

`boolean`

***

### \_materializeCollectionForRender()

```ts
_materializeCollectionForRender<T, TKey, TSchema, TUtils>(options): Collection<T, TKey, TUtils, TSchema, [TSchema] extends [never] ? T : InferSchemaInput<TSchema>>;
```

Defined in: [packages/db/src/client.ts:541](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L541)

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

Defined in: [packages/db/src/client.ts:894](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L894)

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

Defined in: [packages/db/src/client.ts:926](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L926)

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

Defined in: [packages/db/src/client.ts:810](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L810)

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

Defined in: [packages/db/src/client.ts:759](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L759)

**`Internal`**

#### Parameters

##### enabled

`boolean`

#### Returns

`void`

***

### \_waitForSsrLiveQuery()

```ts
_waitForSsrLiveQuery(queryHash, forHydration): Promise<void> | undefined;
```

Defined in: [packages/db/src/client.ts:775](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L775)

**`Internal`**

Wait for transport without claiming or starting a local source.

#### Parameters

##### queryHash

`string`

##### forHydration

`boolean` = `false`

#### Returns

`Promise`\<`void`\> \| `undefined`

***

### applyCollectionChunk()

```ts
applyCollectionChunk(chunk): void;
```

Defined in: [packages/db/src/client.ts:719](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L719)

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

Defined in: [packages/db/src/client.ts:947](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L947)

#### Returns

`Promise`\<`void`\>

***

### collection()

#### Call Signature

```ts
collection<T, TKey, TUtils>(options, materializeOptions?): Collection<InferSchemaOutput<T>, TKey, TUtils, T, InferSchemaInput<T>> & NonSingleResult;
```

Defined in: [packages/db/src/client.ts:497](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L497)

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

Defined in: [packages/db/src/client.ts:507](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L507)

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

Defined in: [packages/db/src/client.ts:517](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L517)

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

Defined in: [packages/db/src/client.ts:525](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L525)

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

Defined in: [packages/db/src/client.ts:397](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L397)

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

Defined in: [packages/db/src/client.ts:632](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L632)

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

Defined in: [packages/db/src/client.ts:377](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L377)

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

Defined in: [packages/db/src/client.ts:700](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L700)

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

Defined in: [packages/db/src/client.ts:403](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L403)

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

Defined in: [packages/db/src/client.ts:381](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L381)

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

Defined in: [packages/db/src/client.ts:723](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L723)

#### Parameters

##### listener

(`event`) => `void`

#### Returns

```ts
(): void;
```

##### Returns

`void`
