---
id: powerSyncCollectionOptions
title: powerSyncCollectionOptions
---

# Function: powerSyncCollectionOptions()

Implementation of powerSyncCollectionOptions that handles both schema and non-schema configurations.

## Call Signature

```ts
function powerSyncCollectionOptions<TTable>(config): EnhancedPowerSyncCollectionConfig<TTable, OptionalExtractedTable<TTable>, never>;
```

Defined in: [powersync.ts:71](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/powersync.ts#L71)

Creates a PowerSync collection configuration with basic default validation.
Input and Output types are the SQLite column types.

### Type Parameters

#### TTable

`TTable` *extends* `Table`\<`ColumnsType`\> = `Table`\<`ColumnsType`\>

### Parameters

#### config

`Omit`\<`BaseCollectionConfig`\<`ExtractedTable`\<`TTable`\>, `string`, `never`, `UtilsRecord`, `any`\>, `"onInsert"` \| `"onUpdate"` \| `"onDelete"` \| `"getKey"`\> & `object`

### Returns

[`EnhancedPowerSyncCollectionConfig`](../type-aliases/EnhancedPowerSyncCollectionConfig.md)\<`TTable`, `OptionalExtractedTable`\<`TTable`\>, `never`\>

### Example

```typescript
const APP_SCHEMA = new Schema({
  documents: new Table({
    name: column.text,
  }),
})

type Document = (typeof APP_SCHEMA)["types"]["documents"]

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

## Call Signature

```ts
function powerSyncCollectionOptions<TTable, TSchema>(config): CollectionConfig<InferPowerSyncOutputType<TTable, TSchema>, string, TSchema, UtilsRecord> & object & object;
```

Defined in: [powersync.ts:128](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/powersync.ts#L128)

Creates a PowerSync collection configuration with schema validation.

The input types satisfy the SQLite column types.

The output types are defined by the provided schema. This schema can enforce additional
validation or type transforms.
Arbitrary output typed mutations are encoded to SQLite for persistence. We provide a basic standard
serialization implementation to serialize column values. Custom or advanced types require providing additional
serializer specifications. Partial column overrides can be supplied to `serializer`.

### Type Parameters

#### TTable

`TTable` *extends* `Table`\<`ColumnsType`\>

#### TSchema

`TSchema` *extends* `StandardSchemaV1`\<`OptionalExtractedTable`\<`TTable`\>, `AnyTableColumnType`\<`TTable`\>\>

### Parameters

#### config

`Omit`\<`BaseCollectionConfig`\<`ExtractedTable`\<`TTable`\>, `string`, `TSchema`, `UtilsRecord`, `any`\>, `"onInsert"` \| `"onUpdate"` \| `"onDelete"` \| `"getKey"`\> & `object` & [`SerializerConfig`](../type-aliases/SerializerConfig.md)\<`InferOutput`\<`TSchema`\>, `ExtractedTable`\<`TTable`\>\> & `object`

### Returns

`CollectionConfig`\<[`InferPowerSyncOutputType`](../type-aliases/InferPowerSyncOutputType.md)\<`TTable`, `TSchema`\>, `string`, `TSchema`, `UtilsRecord`\> & `object` & `object`

### Example

```typescript
import { z } from "zod"

// The PowerSync SQLite schema
const APP_SCHEMA = new Schema({
  documents: new Table({
    name: column.text,
    // Dates are stored as ISO date strings in SQLite
    created_at: column.text
  }),
})

// Advanced Zod validations. The output type of this schema
// is constrained to the SQLite schema of APP_SCHEMA
const schema = z.object({
  id: z.string(),
  // Notice that `name` is not nullable (is required) here and it has additional validation
  name: z.string().min(3, { message: "Should be at least 3 characters" }).nullable(),
  // The input type is still the SQLite string type. While collections will output smart Date instances.
  created_at: z.string().transform(val => new Date(val))
})

const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents,
    schema,
    serializer: {
       // The default is toISOString, this is just to demonstrate custom overrides
       created_at: (outputValue) => outputValue.toISOString(),
    },
  })
)
```

## Call Signature

```ts
function powerSyncCollectionOptions<TTable, TSchema>(config): CollectionConfig<InferPowerSyncOutputType<TTable, TSchema>, string, TSchema, UtilsRecord> & object & object;
```

Defined in: [powersync.ts:196](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/powersync.ts#L196)

Creates a PowerSync collection configuration with schema validation.

The input types are not linked to the internal SQLite table types. This can
give greater flexibility, e.g. by accepting rich types as input for `insert` or `update` operations.
An additional `deserializationSchema` is required in order to process incoming SQLite updates to the output type.

The output types are defined by the provided schema. This schema can enforce additional
validation or type transforms.
Arbitrary output typed mutations are encoded to SQLite for persistence. We provide a basic standard
serialization implementation to serialize column values. Custom or advanced types require providing additional
serializer specifications. Partial column overrides can be supplied to `serializer`.

### Type Parameters

#### TTable

`TTable` *extends* `Table`\<`ColumnsType`\>

#### TSchema

`TSchema` *extends* `StandardSchemaV1`\<`AnyTableColumnType`\<`TTable`\>, `AnyTableColumnType`\<`TTable`\>\>

### Parameters

#### config

`Omit`\<`BaseCollectionConfig`\<`ExtractedTable`\<`TTable`\>, `string`, `TSchema`, `UtilsRecord`, `any`\>, `"onInsert"` \| `"onUpdate"` \| `"onDelete"` \| `"getKey"`\> & `object` & [`SerializerConfig`](../type-aliases/SerializerConfig.md)\<`InferOutput`\<`TSchema`\>, `ExtractedTable`\<`TTable`\>\> & `object`

### Returns

`CollectionConfig`\<[`InferPowerSyncOutputType`](../type-aliases/InferPowerSyncOutputType.md)\<`TTable`, `TSchema`\>, `string`, `TSchema`, `UtilsRecord`\> & `object` & `object`

### Example

```typescript
import { z } from "zod"

// The PowerSync SQLite schema
const APP_SCHEMA = new Schema({
  documents: new Table({
    name: column.text,
    // Booleans are represented as integers in SQLite
    is_active: column.integer
  }),
})

// Advanced Zod validations.
// We accept boolean values as input for operations and expose Booleans in query results
const schema = z.object({
  id: z.string(),
  isActive: z.boolean(), // TInput and TOutput are boolean
})

// The deserializationSchema converts the SQLite synced INTEGER (0/1) values to booleans.
const deserializationSchema = z.object({
  id: z.string(),
  isActive: z.number().nullable().transform((val) => val == null ? true : val > 0),
})

const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents,
    schema,
    deserializationSchema,
  })
)
```
