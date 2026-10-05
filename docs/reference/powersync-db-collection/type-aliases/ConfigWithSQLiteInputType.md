---
id: ConfigWithSQLiteInputType
title: ConfigWithSQLiteInputType
---

```ts
type ConfigWithSQLiteInputType<TTable, TSchema> = SerializerConfig<StandardSchemaV1.InferOutput<TSchema>, ExtractedTable<TTable>> & object;
```

Defined in: [definitions.ts:110](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L110)

Config where TInput is the SQLite types while TOutput can be defined by TSchema.
We can use the same schema to validate TInput and incoming SQLite changes.

## Type Declaration

### schema

```ts
schema: TSchema;
```

## Type Parameters

### TTable

`TTable` *extends* `Table`

### TSchema

`TSchema` *extends* `StandardSchemaV1`\<[`OptionalExtractedTable`](OptionalExtractedTable.md)\<`TTable`\>, `AnyTableColumnType`\<`TTable`\>\>
