---
id: rxdbCollectionOptions
title: rxdbCollectionOptions
---

# Function: rxdbCollectionOptions()

## Call Signature

```ts
function rxdbCollectionOptions<T>(config): CollectionConfig<InferSchemaOutput<T>, string, T, UtilsRecord> & object;
```

Defined in: rxdb.ts:89

Creates RxDB collection options for use with a standard Collection

### Type Parameters

#### T

`T` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

### Parameters

#### config

[`RxDBCollectionConfig`](../type-aliases/RxDBCollectionConfig.md)\<`InferSchemaOutput`\<`T`\>, `T`\>

Configuration options for the RxDB collection

### Returns

`CollectionConfig`\<`InferSchemaOutput`\<`T`\>, `string`, `T`, `UtilsRecord`\> & `object`

Collection options with utilities

## Call Signature

```ts
function rxdbCollectionOptions<T>(config): CollectionConfig<T, string, never, UtilsRecord> & object;
```

Defined in: rxdb.ts:96

Creates RxDB collection options for use with a standard Collection

### Type Parameters

#### T

`T` *extends* `object`

### Parameters

#### config

`Omit`\<`BaseCollectionConfig`\<`T`, `string`, `never`, `UtilsRecord`, `any`\>, `"onInsert"` \| `"onUpdate"` \| `"onDelete"` \| `"getKey"`\> & `object` & `object`

Configuration options for the RxDB collection

### Returns

`CollectionConfig`\<`T`, `string`, `never`, `UtilsRecord`\> & `object`

Collection options with utilities
