import { DiffTriggerOperation, sanitizeSQL } from "@powersync/common"
import { PendingOperationStore } from "./PendingOperationStore"
import { PowerSyncTransactor } from "./PowerSyncTransactor"
import { DEFAULT_BATCH_SIZE } from "./definitions"
import { asPowerSyncRecord, mapOperation } from "./helpers"
import { convertTableToSchema } from "./schema"
import { serializeForSQLite } from "./serialization"
import type {
  AnyTableColumnType,
  ExtractedTable,
  ExtractedTableColumns,
  MapBaseColumnType,
  OptionalExtractedTable,
} from "./helpers"
import type {
  BasePowerSyncCollectionConfig,
  ConfigWithArbitraryCollectionTypes,
  ConfigWithSQLiteInputType,
  ConfigWithSQLiteTypes,
  CustomSQLiteSerializer,
  EnhancedPowerSyncCollectionConfig,
  InferPowerSyncOutputType,
  PowerSyncCollectionConfig,
  PowerSyncCollectionUtils,
} from "./definitions"
import type { PendingOperation } from "./PendingOperationStore"
import type { SyncConfig } from "@tanstack/db"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { Table, TriggerDiffRecord } from "@powersync/common"

/**
 * Creates PowerSync collection options for use with a standard Collection.
 *
 * @template TTable - The SQLite-based typing
 * @template TSchema - The validation schema type (optionally supports a custom input type)
 * @param config - Configuration options for the PowerSync collection
 * @returns Collection options with utilities
 */

// Overload 1: No schema is provided

/**
 * Creates a PowerSync collection configuration with basic default validation.
 * Input and Output types are the SQLite column types.
 *
 * @example
 * ```typescript
 * const APP_SCHEMA = new Schema({
 *   documents: new Table({
 *     name: column.text,
 *   }),
 * })
 *
 * type Document = (typeof APP_SCHEMA)["types"]["documents"]
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
export function powerSyncCollectionOptions<TTable extends Table = Table>(
  config: BasePowerSyncCollectionConfig<TTable, never> & ConfigWithSQLiteTypes
): EnhancedPowerSyncCollectionConfig<
  TTable,
  OptionalExtractedTable<TTable>,
  never
>

// Overload 2: Schema is provided and the TInput matches SQLite types.

/**
 * Creates a PowerSync collection configuration with schema validation.
 *
 * The input types satisfy the SQLite column types.
 *
 * The output types are defined by the provided schema. This schema can enforce additional
 * validation or type transforms.
 * Arbitrary output typed mutations are encoded to SQLite for persistence. We provide a basic standard
 * serialization implementation to serialize column values. Custom or advanced types require providing additional
 * serializer specifications. Partial column overrides can be supplied to `serializer`.
 *
 * @example
 * ```typescript
 * import { z } from "zod"
 *
 * // The PowerSync SQLite schema
 * const APP_SCHEMA = new Schema({
 *   documents: new Table({
 *     name: column.text,
 *     // Dates are stored as ISO date strings in SQLite
 *     created_at: column.text
 *   }),
 * })
 *
 * // Advanced Zod validations. The output type of this schema
 * // is constrained to the SQLite schema of APP_SCHEMA
 * const schema = z.object({
 *   id: z.string(),
 *   // Notice that `name` is not nullable (is required) here and it has additional validation
 *   name: z.string().min(3, { message: "Should be at least 3 characters" }).nullable(),
 *   // The input type is still the SQLite string type. While collections will output smart Date instances.
 *   created_at: z.string().transform(val => new Date(val))
 * })
 *
 * const collection = createCollection(
 *   powerSyncCollectionOptions({
 *     database: db,
 *     table: APP_SCHEMA.props.documents,
 *     schema,
 *     serializer: {
 *        // The default is toISOString, this is just to demonstrate custom overrides
 *        created_at: (outputValue) => outputValue.toISOString(),
 *     },
 *   })
 * )
 * ```
 */
export function powerSyncCollectionOptions<
  TTable extends Table,
  TSchema extends StandardSchemaV1<
    // TInput is the SQLite types. We can use the supplied schema to validate sync input
    OptionalExtractedTable<TTable>,
    AnyTableColumnType<TTable>
  >,
>(
  config: BasePowerSyncCollectionConfig<TTable, TSchema> &
    ConfigWithSQLiteInputType<TTable, TSchema>
): EnhancedPowerSyncCollectionConfig<
  TTable,
  InferPowerSyncOutputType<TTable, TSchema>,
  TSchema
> & {
  schema: TSchema
}

// Overload 3: Schema is provided with arbitrary TInput and TOutput
/**
 * Creates a PowerSync collection configuration with schema validation.
 *
 * The input types are not linked to the internal SQLite table types. This can
 * give greater flexibility, e.g. by accepting rich types as input for `insert` or `update` operations.
 * An additional `deserializationSchema` is required in order to process incoming SQLite updates to the output type.
 *
 * The output types are defined by the provided schema. This schema can enforce additional
 * validation or type transforms.
 * Arbitrary output typed mutations are encoded to SQLite for persistence. We provide a basic standard
 * serialization implementation to serialize column values. Custom or advanced types require providing additional
 * serializer specifications. Partial column overrides can be supplied to `serializer`.
 *
 * @example
 * ```typescript
 * import { z } from "zod"
 *
 * // The PowerSync SQLite schema
 * const APP_SCHEMA = new Schema({
 *   documents: new Table({
 *     name: column.text,
 *     // Booleans are represented as integers in SQLite
 *     is_active: column.integer
 *   }),
 * })
 *
 * // Advanced Zod validations.
 * // We accept boolean values as input for operations and expose Booleans in query results
 * const schema = z.object({
 *   id: z.string(),
 *   isActive: z.boolean(), // TInput and TOutput are boolean
 * })
 *
 * // The deserializationSchema converts the SQLite synced INTEGER (0/1) values to booleans.
 * const deserializationSchema = z.object({
 *   id: z.string(),
 *   isActive: z.number().nullable().transform((val) => val == null ? true : val > 0),
 * })
 *
 * const collection = createCollection(
 *   powerSyncCollectionOptions({
 *     database: db,
 *     table: APP_SCHEMA.props.documents,
 *     schema,
 *     deserializationSchema,
 *   })
 * )
 * ```
 */
export function powerSyncCollectionOptions<
  TTable extends Table,
  TSchema extends StandardSchemaV1<
    // The input and output must have the same keys, the value types can be arbitrary
    AnyTableColumnType<TTable>,
    AnyTableColumnType<TTable>
  >,
>(
  config: BasePowerSyncCollectionConfig<TTable, TSchema> &
    ConfigWithArbitraryCollectionTypes<TTable, TSchema>
): EnhancedPowerSyncCollectionConfig<
  TTable,
  InferPowerSyncOutputType<TTable, TSchema>,
  TSchema
> & {
  utils: PowerSyncCollectionUtils<TTable>
  schema: TSchema
}

/**
 * Implementation of powerSyncCollectionOptions that handles both schema and non-schema configurations.
 */

export function powerSyncCollectionOptions<
  TTable extends Table,
  TSchema extends StandardSchemaV1<any> = never,
>(config: PowerSyncCollectionConfig<TTable, TSchema>) {
  const {
    database,
    table,
    schema: inputSchema,
    syncBatchSize = DEFAULT_BATCH_SIZE,
    ...restConfig
  } = config

  const deserializationSchema =
    `deserializationSchema` in config ? config.deserializationSchema : null
  const serializer = `serializer` in config ? config.serializer : undefined
  const onDeserializationError =
    `onDeserializationError` in config
      ? config.onDeserializationError
      : undefined

  // The SQLite table type
  type TableType = ExtractedTable<TTable>

  // The collection output type
  type OutputType = InferPowerSyncOutputType<TTable, TSchema>

  const { viewName, trackMetadata: metadataIsTracked } = table

  /**
   * Deserializes data from the incoming sync stream
   */
  const deserializeSyncRow = (value: TableType): OutputType => {
    const validationSchema = deserializationSchema || schema
    const validation = validationSchema[`~standard`].validate(value)
    if (`value` in validation) {
      return validation.value
    } else if (`issues` in validation) {
      const issueMessage = `Failed to validate incoming data for ${viewName}. Issues: ${validation.issues.map((issue) => `${issue.path} - ${issue.message}`)}`
      database.logger.error(issueMessage)
      onDeserializationError!(validation)
      throw new Error(issueMessage)
    } else {
      const unknownErrorMessage = `Unknown deserialization error for ${viewName}`
      database.logger.error(unknownErrorMessage)
      onDeserializationError!({ issues: [{ message: unknownErrorMessage }] })
      throw new Error(unknownErrorMessage)
    }
  }

  // We can do basic runtime validations for columns if not explicit schema has been provided
  const schema = inputSchema ?? (convertTableToSchema(table) as TSchema)
  /**
   * The onInsert, onUpdate, and onDelete handlers should only return
   * after we have written the changes to TanStack DB.
   * We currently only write to TanStack DB from a diff trigger.
   * We wait for the diff trigger to observe the change,
   * and only then return from the on[X] handlers.
   * This ensures that when the transaction is reported as
   * complete to the caller, the in-memory state is already
   * consistent with the database.
   */
  const pendingOperationStore = PendingOperationStore.GLOBAL
  // Keep the tracked table unique in case of multiple tabs.
  const trackedTableName = `__${viewName}_tracking_${Math.floor(
    Math.random() * 0xffffffff
  )
    .toString(16)
    .padStart(8, `0`)}`

  const transactor = new PowerSyncTransactor({
    database,
  })

  /**
   * "sync"
   * Notice that this describes the Sync between the local SQLite table
   * and the in-memory tanstack-db collection.
   */
  const sync: SyncConfig<OutputType, string> = {
    sync: (params) => {
      const { begin, write, commit, markReady } = params
      const abortController = new AbortController()

      // The sync function needs to be synchronous
      async function start() {
        database.logger.info(
          `Sync is starting for ${viewName} into ${trackedTableName}`
        )
        database.onChangeWithCallback(
          {
            onChange: async () => {
              await database
                .writeTransaction(async (context) => {
                  begin()
                  const operations = await context.getAll<TriggerDiffRecord>(
                    `SELECT * FROM ${trackedTableName} ORDER BY timestamp ASC`
                  )
                  const pendingOperations: Array<PendingOperation> = []

                  for (const op of operations) {
                    const { id, operation, timestamp, value } = op
                    const parsedValue = deserializeSyncRow({
                      id,
                      ...JSON.parse(value),
                    })
                    const parsedPreviousValue =
                      op.operation == DiffTriggerOperation.UPDATE
                        ? deserializeSyncRow({
                            id,
                            ...JSON.parse(op.previous_value),
                          })
                        : undefined
                    write({
                      type: mapOperation(operation),
                      value: parsedValue,
                      previousValue: parsedPreviousValue,
                    })
                    pendingOperations.push({
                      id,
                      operation,
                      timestamp,
                      tableName: viewName,
                    })
                  }

                  // clear the current operations
                  await context.execute(`DELETE FROM ${trackedTableName}`)

                  commit()
                  pendingOperationStore.resolvePendingFor(pendingOperations)
                })
                .catch((error) => {
                  database.logger.error(
                    `An error has been detected in the sync handler`,
                    error
                  )
                })
            },
          },
          {
            signal: abortController.signal,
            triggerImmediate: false,
            tables: [trackedTableName],
          }
        )

        const disposeTracking = await database.triggers.createDiffTrigger({
          source: viewName,
          destination: trackedTableName,
          when: {
            [DiffTriggerOperation.INSERT]: `TRUE`,
            [DiffTriggerOperation.UPDATE]: `TRUE`,
            [DiffTriggerOperation.DELETE]: `TRUE`,
          },
          hooks: {
            beforeCreate: async (context) => {
              let currentBatchCount = syncBatchSize
              let cursor = 0
              while (currentBatchCount == syncBatchSize) {
                begin()
                const batchItems = await context.getAll<TableType>(
                  sanitizeSQL`SELECT * FROM ${viewName} LIMIT ? OFFSET ?`,
                  [syncBatchSize, cursor]
                )
                currentBatchCount = batchItems.length
                cursor += currentBatchCount
                for (const row of batchItems) {
                  write({
                    type: `insert`,
                    value: deserializeSyncRow(row),
                  })
                }
                commit()
              }
              markReady()
              database.logger.info(
                `Sync is ready for ${viewName} into ${trackedTableName}`
              )
            },
          },
        })

        // If the abort controller was aborted while processing the request above
        if (abortController.signal.aborted) {
          await disposeTracking()
        } else {
          abortController.signal.addEventListener(
            `abort`,
            () => {
              disposeTracking()
            },
            { once: true }
          )
        }
      }

      start().catch((error) =>
        database.logger.error(
          `Could not start syncing process for ${viewName} into ${trackedTableName}`,
          error
        )
      )

      return () => {
        database.logger.info(
          `Sync has been stopped for ${viewName} into ${trackedTableName}`
        )
        abortController.abort()
      }
    },
    // Expose the getSyncMetadata function
    getSyncMetadata: undefined,
  }

  const getKey = (record: OutputType) => asPowerSyncRecord(record).id

  const outputConfig: EnhancedPowerSyncCollectionConfig<
    TTable,
    OutputType,
    TSchema
  > = {
    ...restConfig,
    schema,
    getKey,
    // Syncing should start immediately since we need to monitor the changes for mutations
    startSync: true,
    sync,
    onInsert: async (params) => {
      // The transaction here should only ever contain a single insert mutation
      return await transactor.applyTransaction(params.transaction)
    },
    onUpdate: async (params) => {
      // The transaction here should only ever contain a single update mutation
      return await transactor.applyTransaction(params.transaction)
    },
    onDelete: async (params) => {
      // The transaction here should only ever contain a single delete mutation
      return await transactor.applyTransaction(params.transaction)
    },
    utils: {
      getMeta: () => ({
        tableName: viewName,
        trackedTableName,
        metadataIsTracked,
        serializeValue: (value) =>
          serializeForSQLite(
            value,
            // This is required by the input generic
            table as Table<
              MapBaseColumnType<InferPowerSyncOutputType<TTable, TSchema>>
            >,
            // Coerce serializer to the shape that corresponds to the Table constructed from OutputType
            serializer as CustomSQLiteSerializer<
              OutputType,
              ExtractedTableColumns<Table<MapBaseColumnType<OutputType>>>
            >
          ),
      }),
    },
  }
  return outputConfig
}
