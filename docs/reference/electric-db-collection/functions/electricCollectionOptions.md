---
id: electricCollectionOptions
title: electricCollectionOptions
---

# Function: electricCollectionOptions()

## Call Signature

```ts
function electricCollectionOptions<T>(config): Omit<CollectionConfig<InferSchemaOutput<T>, string | number, T, UtilsRecord>, "utils" | "onInsert" | "onUpdate" | "onDelete"> & Pick<ElectricCollectionConfig<InferSchemaOutput<T>, T>, "onInsert" | "onUpdate" | "onDelete"> & object;
```

Defined in: [packages/electric-db-collection/src/electric.ts:529](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L529)

Creates Electric collection options for use with a standard Collection

### Type Parameters

#### T

`T` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

The explicit type of items in the collection (highest priority)

### Parameters

#### config

[`ElectricCollectionConfig`](../interfaces/ElectricCollectionConfig.md)\<`InferSchemaOutput`\<`T`\>, `T`\> & `object`

Configuration options for the Electric collection

### Returns

`Omit`\<`CollectionConfig`\<`InferSchemaOutput`\<`T`\>, `string` \| `number`, `T`, `UtilsRecord`\>, `"utils"` \| `"onInsert"` \| `"onUpdate"` \| `"onDelete"`\> & `Pick`\<[`ElectricCollectionConfig`](../interfaces/ElectricCollectionConfig.md)\<`InferSchemaOutput`\<`T`\>, `T`\>, `"onInsert"` \| `"onUpdate"` \| `"onDelete"`\> & `object`

Collection options with utilities

## Call Signature

```ts
function electricCollectionOptions<T>(config): Omit<CollectionConfig<T, string | number, never, UtilsRecord>, "utils" | "onInsert" | "onUpdate" | "onDelete"> & Pick<ElectricCollectionConfig<T, never>, "onInsert" | "onUpdate" | "onDelete"> & object;
```

Defined in: [packages/electric-db-collection/src/electric.ts:547](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L547)

Creates Electric collection options for use with a standard Collection

### Type Parameters

#### T

`T` *extends* `Row`\<`unknown`\>

The explicit type of items in the collection (highest priority)

### Parameters

#### config

[`ElectricCollectionConfig`](../interfaces/ElectricCollectionConfig.md)\<`T`, `never`\> & `object`

Configuration options for the Electric collection

### Returns

`Omit`\<`CollectionConfig`\<`T`, `string` \| `number`, `never`, `UtilsRecord`\>, `"utils"` \| `"onInsert"` \| `"onUpdate"` \| `"onDelete"`\> & `Pick`\<[`ElectricCollectionConfig`](../interfaces/ElectricCollectionConfig.md)\<`T`, `never`\>, `"onInsert"` \| `"onUpdate"` \| `"onDelete"`\> & `object`

Collection options with utilities
