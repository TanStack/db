---
id: collectionOptions
title: collectionOptions
---

# Function: collectionOptions()

## Call Signature

```ts
function collectionOptions<T, TKey, TUtils>(options): CollectionOptions<InferSchemaOutput<T>, TKey, T, TUtils> & NonSingleResult;
```

Defined in: [packages/db/src/client.ts:179](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L179)

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

Defined in: [packages/db/src/client.ts:188](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L188)

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

Defined in: [packages/db/src/client.ts:197](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L197)

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

Defined in: [packages/db/src/client.ts:206](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L206)

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

Defined in: [packages/db/src/client.ts:215](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L215)

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
