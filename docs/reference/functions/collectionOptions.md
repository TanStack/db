---
id: collectionOptions
title: collectionOptions
---

## Call Signature

```ts
function collectionOptions<T, TKey, TUtils>(options): CollectionOptions<InferSchemaOutput<T>, TKey, T, TUtils> & NonSingleResult;
```

Defined in: [packages/db/src/client.ts:214](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L214)

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

[`CollectionOptions`](../type-aliases/CollectionOptions.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `T`, `TUtils`\> & [`NonSingleResult`](../type-aliases/NonSingleResult.md)

## Call Signature

```ts
function collectionOptions<T, TKey, TUtils>(options): CollectionOptions<InferSchemaOutput<T>, TKey, T, TUtils> & SingleResult;
```

Defined in: [packages/db/src/client.ts:223](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L223)

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

[`CollectionOptions`](../type-aliases/CollectionOptions.md)\<[`InferSchemaOutput`](../type-aliases/InferSchemaOutput.md)\<`T`\>, `TKey`, `T`, `TUtils`\> & [`SingleResult`](../type-aliases/SingleResult.md)

## Call Signature

```ts
function collectionOptions<T, TKey, TUtils>(options): CollectionOptions<T, TKey, never, TUtils> & NonSingleResult;
```

Defined in: [packages/db/src/client.ts:232](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L232)

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

[`CollectionOptions`](../type-aliases/CollectionOptions.md)\<`T`, `TKey`, `never`, `TUtils`\> & [`NonSingleResult`](../type-aliases/NonSingleResult.md)

## Call Signature

```ts
function collectionOptions<T, TKey, TUtils>(options): CollectionOptions<T, TKey, never, TUtils> & SingleResult;
```

Defined in: [packages/db/src/client.ts:241](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L241)

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

[`CollectionOptions`](../type-aliases/CollectionOptions.md)\<`T`, `TKey`, `never`, `TUtils`\> & [`SingleResult`](../type-aliases/SingleResult.md)

## Call Signature

```ts
function collectionOptions<TConfig>(id, factory): DescriptorFromConfig<TConfig>;
```

Defined in: [packages/db/src/client.ts:250](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L250)

### Type Parameters

#### TConfig

`TConfig` *extends* `AnyCollectionConfig`

### Parameters

#### id

`string`

#### factory

(`client`) => `TConfig`

### Returns

`DescriptorFromConfig`\<`TConfig`\>
