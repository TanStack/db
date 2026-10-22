---
id: createCollection
title: createCollection
---

## Call Signature

```ts
function createCollection<T, TKey, TUtils>(options): Collection<InferSchemaOutput<T>, TKey, TUtils, T, InferSchemaInput<T>> & NonSingleResult;
```

Defined in: [packages/db/src/collection/index.ts:241](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L241)

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

Defined in: [packages/db/src/collection/index.ts:258](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L258)

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

Defined in: [packages/db/src/collection/index.ts:276](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L276)

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

Defined in: [packages/db/src/collection/index.ts:292](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L292)

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

Defined in: [packages/db/src/collection/index.ts:305](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L305)

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

Defined in: [packages/db/src/collection/index.ts:318](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L318)

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

Defined in: [packages/db/src/collection/index.ts:330](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L330)

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

Defined in: [packages/db/src/collection/index.ts:343](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L343)

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
