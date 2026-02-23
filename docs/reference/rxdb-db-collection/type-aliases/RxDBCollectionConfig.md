---
id: RxDBCollectionConfig
title: RxDBCollectionConfig
---

# Type Alias: RxDBCollectionConfig\<T, TSchema\>

```ts
type RxDBCollectionConfig<T, TSchema> = Omit<BaseCollectionConfig<T, string, TSchema>, "onInsert" | "onUpdate" | "onDelete" | "getKey"> & object;
```

Defined in: rxdb.ts:49

Configuration interface for RxDB collection options

## Type Declaration

### rxCollection

```ts
rxCollection: RxCollection<T, unknown, unknown, unknown>;
```

The RxCollection from a RxDB Database instance.

### syncBatchSize?

```ts
optional syncBatchSize: number;
```

The maximum number of documents to read from the RxDB collection
in a single batch during the initial sync between RxDB and the
in-memory TanStack DB collection.

#### Remarks

- Defaults to `1000` if not specified.
- Larger values reduce the number of round trips to the storage
  engine but increase memory usage per batch.
- Smaller values may lower memory usage and allow earlier
  streaming of initial results, at the cost of more query calls.

Adjust this depending on your expected collection size and
performance characteristics of the chosen RxDB storage adapter.

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

The explicit type of items in the collection (highest priority). Use the document type of your RxCollection here.

### TSchema

`TSchema` *extends* `StandardSchemaV1` = `never`

The schema type for validation and type inference (second priority)

## Remarks

Type resolution follows a priority order:
1. If you provide an explicit type via generic parameter, it will be used
2. If no explicit type is provided but a schema is, the schema's output type will be inferred

You should provide EITHER an explicit type OR a schema, but not both, as they would conflict.
Notice that primary keys in RxDB must always be a string.
