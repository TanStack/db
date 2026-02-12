import type { AbstractPowerSyncDatabase, Table } from '@powersync/common'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type {
  BaseCollectionConfig,
  CollectionConfig,
  InferSchemaOutput,
} from '@tanstack/db'
import type {
  AnyTableColumnType,
  ExtractedTable,
  OptionalExtractedTable,
  PowerSyncRecord,
} from './helpers'

/**
 * Small helper which determines the output type if:
 * - Standard SQLite types are to be used OR
 * - If the provided schema should be used.
 */
export type InferPowerSyncOutputType<
  TTable extends Table = Table,
  TSchema extends StandardSchemaV1<PowerSyncRecord> = never,
> = TSchema extends never ? ExtractedTable<TTable> : InferSchemaOutput<TSchema>

/**
 * A mapping type for custom serialization of object properties to SQLite-compatible values.
 *
 * This type allows you to override, for keys in the input object (`TOutput`), a function that transforms
 * the value to the corresponding SQLite type (`TSQLite`). Keys not specified will use the default SQLite serialization.
 *
 * ## Generics
 * - `TOutput`: The input object type, representing the row data to be serialized.
 * - `TSQLite`: The target SQLite-compatible type for each property, typically inferred from the table schema.
 *
 * ## Usage
 * Use this type to define a map of serialization functions for specific keys when you need custom handling
 * (e.g., converting complex objects, formatting dates, or handling enums).
 *
 * Example:
 * ```ts
 * const serializer: CustomSQLiteSerializer<MyRowType, MySQLiteType> = {
 *   createdAt: (date) => date.toISOString(),
 *   status: (status) => status ? 1 : 0,
 *   meta: (meta) => JSON.stringify(meta),
 * };
 * ```
 *
 * ## Behavior
 * - Each key maps to a function that receives the value and returns the SQLite-compatible value.
 * - Used by `serializeForSQLite` to override default serialization for specific columns.
 */
export type CustomSQLiteSerializer<
  TOutput extends Record<string, unknown>,
  TSQLite extends Record<string, unknown>,
> = Partial<{
  [Key in keyof TOutput]: (
    value: TOutput[Key],
  ) => Key extends keyof TSQLite ? TSQLite[Key] : never
}>

export type SerializerConfig<
  TOutput extends Record<string, unknown>,
  TSQLite extends Record<string, unknown>,
> = {
  /**
   * Optional partial serializer object for customizing how individual columns are serialized for SQLite.
   *
   * This should be a partial map of column keys to serialization functions, following the
   * {@link CustomSQLiteSerializer} type. Each function receives the column value and returns a value
   * compatible with SQLite storage.
   *
   * If not provided for a column, the default behavior is used:
   *   - `TEXT`: Strings are stored as-is; Dates are converted to ISO strings; other types are JSON-stringified.
   *   - `INTEGER`/`REAL`: Numbers are stored as-is; booleans are mapped to 1/0.
   *
   * Use this option to override serialization for specific columns, such as formatting dates, handling enums,
   * or serializing complex objects.
   *
   * Example:
   * ```typescript
   * serializer: {
   *   createdAt: (date) => date.getTime(), // Store as timestamp
   *   meta: (meta) => JSON.stringify(meta), // Custom object serialization
   * }
   * ```
   */
  serializer?: CustomSQLiteSerializer<TOutput, TSQLite>

  /**
   * Application logic should ensure that incoming synced data is always valid.
   * Failing to deserialize and apply incoming changes results in data inconsistency - which is a fatal error.
   * Use this callback to react to deserialization errors.
   */
  onDeserializationError: (error: StandardSchemaV1.FailureResult) => void
}

/**
 * Config for when TInput and TOutput are both the SQLite types.
 */
export type ConfigWithSQLiteTypes = {}

/**
 * Config where TInput is the SQLite types while TOutput can be defined by TSchema.
 * We can use the same schema to validate TInput and incoming SQLite changes.
 */
export type ConfigWithSQLiteInputType<
  TTable extends Table,
  TSchema extends StandardSchemaV1<
    // TInput is the SQLite types.
    OptionalExtractedTable<TTable>,
    AnyTableColumnType<TTable>
  >,
> = SerializerConfig<
  StandardSchemaV1.InferOutput<TSchema>,
  ExtractedTable<TTable>
> & {
  schema: TSchema
}

/**
 * Config where TInput and TOutput have arbitrarily typed values.
 * The keys of the types need to equal the SQLite types.
 * Since TInput is not the SQLite types, we require a schema in order to deserialize incoming SQLite updates. The schema should validate from SQLite to TOutput.
 */
export type ConfigWithArbitraryCollectionTypes<
  TTable extends Table,
  TSchema extends StandardSchemaV1<
    // The input and output must have the same keys, the value types can be arbitrary
    AnyTableColumnType<TTable>,
    AnyTableColumnType<TTable>
  >,
> = SerializerConfig<
  StandardSchemaV1.InferOutput<TSchema>,
  ExtractedTable<TTable>
> & {
  schema: TSchema
  /**
   * Schema for deserializing and validating input data from the sync stream.
   *
   * This schema defines how to transform and validate data coming from SQLite types (as stored in the database)
   * into the desired output types (`TOutput`) expected by your application or validation logic.
   *
   * The generic parameters allow for arbitrary input and output types, so you can specify custom conversion rules
   * for each column. This is especially useful when your application expects richer types (e.g., Date, enums, objects)
   * than what SQLite natively supports.
   *
   * Use this to ensure that incoming data from the sync stream is properly converted and validated before use.
   *
   * Example:
   * ```typescript
   * deserializationSchema: z.object({
   *   createdAt: z.preprocess((val) => new Date(val as string), z.date()),
   *   meta: z.preprocess((val) => JSON.parse(val as string), z.object({ ... })),
   * })
   * ```
   *
   * This enables robust type safety and validation for incoming data, bridging the gap between SQLite storage
   * and your application's expected types.
   */
  deserializationSchema: StandardSchemaV1<
    ExtractedTable<TTable>,
    StandardSchemaV1.InferOutput<TSchema>
  >
}
export type BasePowerSyncCollectionConfig<
  TTable extends Table = Table,
  TSchema extends StandardSchemaV1 = never,
> = Omit<
  BaseCollectionConfig<ExtractedTable<TTable>, string, TSchema>,
  `onInsert` | `onUpdate` | `onDelete` | `getKey`
> & {
  /** The PowerSync schema Table definition */
  table: TTable
  /** The PowerSync database instance */
  database: AbstractPowerSyncDatabase
  /**
   * The maximum number of documents to read from the SQLite table
   * in a single batch during the initial sync between PowerSync and the
   * in-memory TanStack DB collection.
   *
   * @remarks
   * - Defaults to {@link DEFAULT_BATCH_SIZE} if not specified.
   * - Larger values reduce the number of round trips to the storage
   *   engine but increase memory usage per batch.
   * - Smaller values may lower memory usage and allow earlier
   *   streaming of initial results, at the cost of more query calls.
   */
  syncBatchSize?: number
}

/**
 * Configuration interface for PowerSync collection options.
 * @template TTable - The PowerSync table schema definition
 * @template TSchema - The validation schema type
 */
/**
 * Configuration options for creating a PowerSync collection.
 *
 * @example
 * ```typescript
 * const APP_SCHEMA = new Schema({
 *   documents: new Table({
 *     name: column.text,
 *   }),
 * })
 *
 * const db = new PowerSyncDatabase({
 *   database: {
 *     dbFilename: "test.sqlite",
 *   },
 *   schema: APP_SCHEMA,
 * })
 *
 * const collection = createCollection(
 *   powerSyncCollectionOptions({
 *     database: db,
 *     table: APP_SCHEMA.props.documents
 *   })
 * )
 * ```
 */
export type PowerSyncCollectionConfig<
  TTable extends Table = Table,
  TSchema extends StandardSchemaV1<any> = never,
> = BasePowerSyncCollectionConfig<TTable, TSchema> &
  (
    | ConfigWithSQLiteTypes
    | ConfigWithSQLiteInputType<TTable, TSchema>
    | ConfigWithArbitraryCollectionTypes<TTable, TSchema>
  )

/**
 * Metadata for the PowerSync Collection.
 */
export type PowerSyncCollectionMeta<TTable extends Table = Table> = {
  /**
   * The SQLite table representing the collection.
   */
  tableName: string
  /**
   * The internal table used to track diffs for the collection.
   */
  trackedTableName: string

  /**
   * Serializes a collection value to the SQLite type
   */
  serializeValue: (value: any) => ExtractedTable<TTable>

  /**
   * Whether the PowerSync table tracks metadata.
   */
  metadataIsTracked: boolean
}

/**
 * A CollectionConfig which includes utilities for PowerSync.
 */
export type EnhancedPowerSyncCollectionConfig<
  TTable extends Table,
  OutputType extends Record<string, unknown> = Record<string, unknown>,
  TSchema extends StandardSchemaV1 = never,
> = CollectionConfig<OutputType, string, TSchema, PowerSyncCollectionUtils<TTable>> & {
  id?: string
  utils: PowerSyncCollectionUtils<TTable>
  schema?: TSchema
}

/**
 * Collection-level utilities for PowerSync.
 */
export type PowerSyncCollectionUtils<TTable extends Table = Table> = {
  getMeta: () => PowerSyncCollectionMeta<TTable>
}

/**
 * Default value for {@link PowerSyncCollectionConfig#syncBatchSize}.
 */
export const DEFAULT_BATCH_SIZE = 1000
