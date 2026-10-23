---
id: createCollection
title: createCollection
---

## Call Signature

```ts
function createCollection<T, TKey, TUtils>(options): Collection<InferSchemaOutput<T>, TKey, TUtils, T, InferSchemaInput<T>> & NonSingleResult;
```

Defined in: [packages/db/src/collection/index.ts:247](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L247)

### Type Parameters

#### T

`T` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

#### TKey

`TKey` *extends* `string` \| `number`

#### TUtils

`TUtils` *extends* [`UtilsRecord`](../type-aliases/UtilsRecord.md)

### Parameters

#### options

`Omit`\<[`CollectionConfig`](../interfaces/CollectionConfig.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `T`, `TUtils`\>, `"utils"`\> & `object` & [`NonSingleResult`](../type-aliases/NonSingleResult.md)

### Returns

[`Collection`](../interfaces/Collection.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `TUtils`, `T`, [`InferSchemaInput`](../type-aliases/InferSchemaInput.md)\<`T`\>\> & [`NonSingleResult`](../type-aliases/NonSingleResult.md)

## Call Signature

```ts
function createCollection<T, TKey, TUtils>(options): Collection<InferSchemaOutput<T>, TKey, Exclude<TUtils, undefined>, T, InferSchemaInput<T>> & NonSingleResult;
```

Defined in: [packages/db/src/collection/index.ts:264](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L264)

### Type Parameters

#### T

`T` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

#### TKey

`TKey` *extends* `string` \| `number`

#### TUtils

`TUtils` *extends* [`UtilsRecord`](../type-aliases/UtilsRecord.md)

### Parameters

#### options

[`CollectionConfig`](../interfaces/CollectionConfig.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `T`, `TUtils`\> & `object` & [`NonSingleResult`](../type-aliases/NonSingleResult.md)

### Returns

[`Collection`](../interfaces/Collection.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `Exclude`\<`TUtils`, `undefined`\>, `T`, [`InferSchemaInput`](../type-aliases/InferSchemaInput.md)\<`T`\>\> & [`NonSingleResult`](../type-aliases/NonSingleResult.md)

## Call Signature

```ts
function createCollection<T, TKey, TUtils>(options): Collection<InferSchemaOutput<T>, TKey, TUtils, T, InferSchemaInput<T>> & SingleResult;
```

Defined in: [packages/db/src/collection/index.ts:282](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L282)

### Type Parameters

#### T

`T` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

#### TKey

`TKey` *extends* `string` \| `number`

#### TUtils

`TUtils` *extends* [`UtilsRecord`](../type-aliases/UtilsRecord.md)

### Parameters

#### options

`Omit`\<[`CollectionConfig`](../interfaces/CollectionConfig.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `T`, `TUtils`\>, `"utils"`\> & `object` & [`SingleResult`](../type-aliases/SingleResult.md)

### Returns

[`Collection`](../interfaces/Collection.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `TUtils`, `T`, [`InferSchemaInput`](../type-aliases/InferSchemaInput.md)\<`T`\>\> & [`SingleResult`](../type-aliases/SingleResult.md)

## Call Signature

```ts
function createCollection<T, TKey, TUtils>(options): Collection<InferSchemaOutput<T>, TKey, TUtils, T, InferSchemaInput<T>> & SingleResult;
```

Defined in: [packages/db/src/collection/index.ts:298](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L298)

### Type Parameters

#### T

`T` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

#### TKey

`TKey` *extends* `string` \| `number`

#### TUtils

`TUtils` *extends* [`UtilsRecord`](../type-aliases/UtilsRecord.md)

### Parameters

#### options

[`CollectionConfig`](../interfaces/CollectionConfig.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `T`, `TUtils`\> & `object` & [`SingleResult`](../type-aliases/SingleResult.md)

### Returns

[`Collection`](../interfaces/Collection.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `TUtils`, `T`, [`InferSchemaInput`](../type-aliases/InferSchemaInput.md)\<`T`\>\> & [`SingleResult`](../type-aliases/SingleResult.md)

## Call Signature

```ts
function createCollection<T, TKey, TUtils>(options): Collection<T, TKey, TUtils, never, T> & NonSingleResult;
```

Defined in: [packages/db/src/collection/index.ts:311](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L311)

### Type Parameters

#### T

`T` *extends* `object`

#### TKey

`TKey` *extends* `string` \| `number`

#### TUtils

`TUtils` *extends* [`UtilsRecord`](../type-aliases/UtilsRecord.md)

### Parameters

#### options

`Omit`\<[`CollectionConfig`](../interfaces/CollectionConfig.md)\<`T`, `TKey`, `never`, `TUtils`\>, `"utils"`\> & `object` & [`NonSingleResult`](../type-aliases/NonSingleResult.md)

### Returns

[`Collection`](../interfaces/Collection.md)\<`T`, `TKey`, `TUtils`, `never`, `T`\> & [`NonSingleResult`](../type-aliases/NonSingleResult.md)

## Call Signature

```ts
function createCollection<T, TKey, TUtils>(options): Collection<T, TKey, TUtils, never, T> & NonSingleResult;
```

Defined in: [packages/db/src/collection/index.ts:324](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L324)

### Type Parameters

#### T

`T` *extends* `object`

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

#### TUtils

`TUtils` *extends* [`UtilsRecord`](../type-aliases/UtilsRecord.md) = [`UtilsRecord`](../type-aliases/UtilsRecord.md)

### Parameters

#### options

[`CollectionConfig`](../interfaces/CollectionConfig.md)\<`T`, `TKey`, `never`, `TUtils`\> & `object` & [`NonSingleResult`](../type-aliases/NonSingleResult.md)

### Returns

[`Collection`](../interfaces/Collection.md)\<`T`, `TKey`, `TUtils`, `never`, `T`\> & [`NonSingleResult`](../type-aliases/NonSingleResult.md)

## Call Signature

```ts
function createCollection<T, TKey, TUtils>(options): Collection<T, TKey, TUtils, never, T> & SingleResult;
```

Defined in: [packages/db/src/collection/index.ts:336](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L336)

### Type Parameters

#### T

`T` *extends* `object`

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

#### TUtils

`TUtils` *extends* [`UtilsRecord`](../type-aliases/UtilsRecord.md) = [`UtilsRecord`](../type-aliases/UtilsRecord.md)

### Parameters

#### options

`Omit`\<[`CollectionConfig`](../interfaces/CollectionConfig.md)\<`T`, `TKey`, `never`, `TUtils`\>, `"utils"`\> & `object` & [`SingleResult`](../type-aliases/SingleResult.md)

### Returns

[`Collection`](../interfaces/Collection.md)\<`T`, `TKey`, `TUtils`, `never`, `T`\> & [`SingleResult`](../type-aliases/SingleResult.md)

## Call Signature

```ts
function createCollection<T, TKey, TUtils>(options): Collection<T, TKey, TUtils, never, T> & SingleResult;
```

Defined in: [packages/db/src/collection/index.ts:349](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L349)

### Type Parameters

#### T

`T` *extends* `object`

#### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

#### TUtils

`TUtils` *extends* [`UtilsRecord`](../type-aliases/UtilsRecord.md) = [`UtilsRecord`](../type-aliases/UtilsRecord.md)

### Parameters

#### options

[`CollectionConfig`](../interfaces/CollectionConfig.md)\<`T`, `TKey`, `never`, `TUtils`\> & `object` & [`SingleResult`](../type-aliases/SingleResult.md)

### Returns

[`Collection`](../interfaces/Collection.md)\<`T`, `TKey`, `TUtils`, `never`, `T`\> & [`SingleResult`](../type-aliases/SingleResult.md)
