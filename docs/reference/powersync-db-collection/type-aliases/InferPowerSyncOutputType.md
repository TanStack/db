---
id: InferPowerSyncOutputType
title: InferPowerSyncOutputType
---

# Type Alias: InferPowerSyncOutputType\<TTable, TSchema\>

```ts
type InferPowerSyncOutputType<TTable, TSchema> = TSchema extends never ? ExtractedTable<TTable> : InferSchemaOutput<TSchema>;
```

Defined in: [definitions.ts:20](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/definitions.ts#L20)

Small helper which determines the output type if:
- Standard SQLite types are to be used OR
- If the provided schema should be used.

## Type Parameters

### TTable

`TTable` *extends* `Table` = `Table`

### TSchema

`TSchema` *extends* `StandardSchemaV1`\<`PowerSyncRecord`\> = `never`
