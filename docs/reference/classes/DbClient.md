---
id: DbClient
title: DbClient
---

Defined in: [packages/db/src/client.ts:411](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L411)

## Constructors

### Constructor

```ts
new DbClient(options): DbClient;
```

Defined in: [packages/db/src/client.ts:438](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L438)

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

Defined in: [packages/db/src/client.ts:456](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L456)

##### Returns

  \| [`Transaction`](../interfaces/Transaction.md)\<`Record`\<`string`, `unknown`\>\>
  \| `undefined`

## Methods

### \_assertLiveQuerySources()

```ts
_assertLiveQuerySources(
   queryHash, 
   sources, 
   rowOptions?): void;
```

Defined in: [packages/db/src/client.ts:896](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L896)

**`Internal`**

Reject incompatible local sources or row behavior for a reusable stream.

#### Parameters

##### queryHash

`string`

##### sources

readonly `AnyCollection`[]

##### rowOptions?

`LiveQueryRowOptions`

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

Defined in: [packages/db/src/client.ts:794](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L794)

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
   sources?, 
   rowOptions?): void;
```

Defined in: [packages/db/src/client.ts:935](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L935)

**`Internal`**

Capture the first server view without starting acquisition.

#### Parameters

##### queryHash

`string`

##### snapshot

[`DehydratedLiveQueryResult`](../type-aliases/DehydratedLiveQueryResult.md)

##### sources?

readonly `AnyCollection`[]

##### rowOptions?

`LiveQueryRowOptions`

#### Returns

`void`

***

### \_consumeLiveQueryResult()

```ts
_consumeLiveQueryResult(queryHash, dehydratedAt): void;
```

Defined in: [packages/db/src/client.ts:927](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L927)

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

Defined in: [packages/db/src/client.ts:1017](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L1017)

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

Defined in: [packages/db/src/client.ts:885](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L885)

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

Defined in: [packages/db/src/client.ts:810](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L810)

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

Defined in: [packages/db/src/client.ts:880](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L880)

**`Internal`**

#### Returns

`boolean`

***

### \_isSsrStreamingEnabled()

```ts
_isSsrStreamingEnabled(): boolean;
```

Defined in: [packages/db/src/client.ts:870](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L870)

**`Internal`**

#### Returns

`boolean`

***

### \_materializeCollectionForRender()

```ts
_materializeCollectionForRender<T, TKey, TSchema, TUtils>(options): Collection<T, TKey, TUtils, TSchema, [TSchema] extends [never] ? T : InferSchemaInput<TSchema>>;
```

Defined in: [packages/db/src/client.ts:606](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L606)

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
   sources?, 
rowOptions?): Promise<void>;
```

Defined in: [packages/db/src/client.ts:970](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L970)

**`Internal`**

#### Parameters

##### queryHash

`string`

##### promise

`Promise`\<[`DehydratedLiveQueryResult`](../type-aliases/DehydratedLiveQueryResult.md)\<`object`, `string` \| `number`\>\>

##### sources?

readonly `AnyCollection`[]

##### rowOptions?

`LiveQueryRowOptions`

#### Returns

`Promise`\<`void`\>

***

### \_registerLiveQueryResource()

```ts
_registerLiveQueryResource(owner, cleanup): () => void;
```

Defined in: [packages/db/src/client.ts:1004](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L1004)

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

Defined in: [packages/db/src/client.ts:875](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L875)

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

Defined in: [packages/db/src/client.ts:824](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L824)

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

Defined in: [packages/db/src/client.ts:840](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L840)

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

Defined in: [packages/db/src/client.ts:784](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L784)

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

Defined in: [packages/db/src/client.ts:1025](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L1025)

#### Returns

`Promise`\<`void`\>

***

### collection()

#### Call Signature

```ts
collection<T, TKey, TUtils>(options, materializeOptions?): Collection<InferSchemaOutput<T>, TKey, TUtils, T, InferSchemaInput<T>> & NonSingleResult;
```

Defined in: [packages/db/src/client.ts:562](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L562)

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

Defined in: [packages/db/src/client.ts:572](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L572)

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

Defined in: [packages/db/src/client.ts:582](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L582)

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

Defined in: [packages/db/src/client.ts:590](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L590)

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

Defined in: [packages/db/src/client.ts:460](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L460)

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

Defined in: [packages/db/src/client.ts:697](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L697)

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

Defined in: [packages/db/src/client.ts:440](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L440)

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

Defined in: [packages/db/src/client.ts:765](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L765)

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

Defined in: [packages/db/src/client.ts:466](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L466)

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

Defined in: [packages/db/src/client.ts:444](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L444)

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

Defined in: [packages/db/src/client.ts:788](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L788)

#### Parameters

##### listener

(`event`) => `void`

#### Returns

```ts
(): void;
```

##### Returns

`void`
