---
id: ConfigWithArbitraryCollectionTypes
title: ConfigWithArbitraryCollectionTypes
---

# Type Alias: ConfigWithArbitraryCollectionTypes\<TTable, TSchema\>

```ts
type ConfigWithArbitraryCollectionTypes<TTable, TSchema> = SerializerConfig<StandardSchemaV1.InferOutput<TSchema>, ExtractedTable<TTable>> & object;
```

Defined in: [definitions.ts:125](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L125)

Config where TInput and TOutput have arbitrarily typed values.
The keys of the types need to equal the SQLite types.
Since TInput is not the SQLite types, we require a schema in order to deserialize incoming SQLite updates. The schema should validate from SQLite to TOutput.

## Type Declaration

### deserializationSchema

```ts
deserializationSchema: StandardSchemaV1<ExtractedTable<TTable>, StandardSchemaV1.InferOutput<TSchema>>;
```

Schema for deserializing and validating input data from the sync stream.

This schema defines how to transform and validate data coming from SQLite types (as stored in the database)
into the desired output types (`TOutput`) expected by your application or validation logic.

The generic parameters allow for arbitrary input and output types, so you can specify custom conversion rules
for each column. This is especially useful when your application expects richer types (e.g., Date, enums, objects)
than what SQLite natively supports.

Use this to ensure that incoming data from the sync stream is properly converted and validated before use.

Example:
```typescript
deserializationSchema: z.object({
  createdAt: z.preprocess((val) => new Date(val as string), z.date()),
  meta: z.preprocess((val) => JSON.parse(val as string), z.object({ ... })),
})
```

This enables robust type safety and validation for incoming data, bridging the gap between SQLite storage
and your application's expected types.

### schema

```ts
schema: TSchema;
```

## Type Parameters

### TTable

`TTable` *extends* `Table`

### TSchema

`TSchema` *extends* `StandardSchemaV1`\<`AnyTableColumnType`\<`TTable`\>, `AnyTableColumnType`\<`TTable`\>\>
