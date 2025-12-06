---
id: PowerSyncCollectionConfig
title: PowerSyncCollectionConfig
---

# Type Alias: PowerSyncCollectionConfig\<TTable, TSchema\>

```ts
type PowerSyncCollectionConfig<TTable, TSchema> = BasePowerSyncCollectionConfig<TTable, TSchema> & 
  | ConfigWithSQLiteTypes
  | ConfigWithSQLiteInputType<TTable, TSchema>
| ConfigWithArbitraryCollectionTypes<TTable, TSchema>;
```

Defined in: [definitions.ts:222](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L222)

Configuration options for creating a PowerSync collection.

## Type Parameters

### TTable

`TTable` *extends* `Table` = `Table`

### TSchema

`TSchema` *extends* `StandardSchemaV1`\<`any`\> = `never`

## Example

```typescript
const APP_SCHEMA = new Schema({
  documents: new Table({
    name: column.text,
  }),
})

const db = new PowerSyncDatabase({
  database: {
    dbFilename: "test.sqlite",
  },
  schema: APP_SCHEMA,
})

const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents
  })
)
```
