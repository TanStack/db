---
id: BasePowerSyncCollectionConfig
title: BasePowerSyncCollectionConfig
---

# Type Alias: BasePowerSyncCollectionConfig\<TTable, TSchema\>

```ts
type BasePowerSyncCollectionConfig<TTable, TSchema> = Omit<BaseCollectionConfig<ExtractedTable<TTable>, string, TSchema>, "onInsert" | "onUpdate" | "onDelete" | "getKey"> & object;
```

Defined in: [definitions.ts:165](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/definitions.ts#L165)

## Type Declaration

### database

```ts
database: AbstractPowerSyncDatabase;
```

The PowerSync database instance

### syncBatchSize?

```ts
optional syncBatchSize: number;
```

The maximum number of documents to read from the SQLite table
in a single batch during the initial sync between PowerSync and the
in-memory TanStack DB collection.

#### Remarks

- Defaults to [DEFAULT\_BATCH\_SIZE](../variables/DEFAULT_BATCH_SIZE.md) if not specified.
- Larger values reduce the number of round trips to the storage
  engine but increase memory usage per batch.
- Smaller values may lower memory usage and allow earlier
  streaming of initial results, at the cost of more query calls.

### table

```ts
table: TTable;
```

The PowerSync schema Table definition

## Type Parameters

### TTable

`TTable` *extends* `Table` = `Table`

### TSchema

`TSchema` *extends* `StandardSchemaV1` = `never`
