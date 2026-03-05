---
id: ConfigWithSQLiteInputType
title: ConfigWithSQLiteInputType
---

# Type Alias: ConfigWithSQLiteInputType\<TTable, TSchema\>

```ts
type ConfigWithSQLiteInputType<TTable, TSchema> = SerializerConfig<StandardSchemaV1.InferOutput<TSchema>, ExtractedTable<TTable>> & object;
```

Defined in: definitions.ts:106

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

`TSchema` *extends* `StandardSchemaV1`\<`OptionalExtractedTable`\<`TTable`\>, `AnyTableColumnType`\<`TTable`\>\>
