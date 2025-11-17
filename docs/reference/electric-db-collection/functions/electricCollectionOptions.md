---
id: electricCollectionOptions
title: electricCollectionOptions
---

# Function: electricCollectionOptions()

## Call Signature

```ts
function electricCollectionOptions<T>(config): CollectionConfig<InferSchemaOutput<T>, string | number, T, UtilsRecord> & object;
```

Defined in: [packages/electric-db-collection/src/electric.ts:293](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L293)

Creates Electric collection options for use with a standard Collection

### Type Parameters

#### T

`T` *extends* `StandardSchemaV1`\<`unknown`, `unknown`\>

The explicit type of items in the collection (highest priority)

### Parameters

#### config

[`ElectricCollectionConfig`](../../interfaces/ElectricCollectionConfig.md)\<`InferSchemaOutput`\<`T`\>, `T`\> & `object`

Configuration options for the Electric collection

### Returns

`CollectionConfig`\<`InferSchemaOutput`\<`T`\>, `string` \| `number`, `T`, `UtilsRecord`\> & `object`

Collection options with utilities

## Call Signature

```ts
function electricCollectionOptions<T>(config): CollectionConfig<T, string | number, never, UtilsRecord> & object;
```

Defined in: [packages/electric-db-collection/src/electric.ts:304](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L304)

Creates Electric collection options for use with a standard Collection

### Type Parameters

#### T

`T` *extends* `Row`\<`unknown`\>

The explicit type of items in the collection (highest priority)

### Parameters

#### config

[`ElectricCollectionConfig`](../../interfaces/ElectricCollectionConfig.md)\<`T`, `never`\> & `object`

Configuration options for the Electric collection

### Returns

`CollectionConfig`\<`T`, `string` \| `number`, `never`, `UtilsRecord`\> & `object`

Collection options with utilities
