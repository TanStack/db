import { DiffTriggerOperation, sanitizeSQL } from '@powersync/common'
import { or, withCollectionConfigFactory } from '@tanstack/db'
import { compileSQLite } from './sqlite-compiler'
import { PendingOperationStore } from './PendingOperationStore'
import { PowerSyncTransactor } from './PowerSyncTransactor'
import { DEFAULT_BATCH_SIZE } from './definitions'
import { asPowerSyncRecord, mapOperation } from './helpers'
import { POWERSYNC_TEST_HOOKS } from './internal'
import { convertTableToSchema } from './schema'
import { serializeForSQLite } from './serialization'
import type {
  CleanupFn,
  LoadSubsetOptions,
  OperationType,
  SyncAppliedReceipt,
  SyncConfig,
} from '@tanstack/db'
import type {
  AnyTableColumnType,
  ExtractedTable,
  ExtractedTableColumns,
  MapBaseColumnType,
  OptionalExtractedTable,
} from './helpers'
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
} from './definitions'
import type { PendingOperation } from './PendingOperationStore'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { LockContext, Table, TriggerDiffRecord } from '@powersync/common'

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
  config: BasePowerSyncCollectionConfig<TTable, never> & ConfigWithSQLiteTypes,
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
    ConfigWithSQLiteInputType<TTable, TSchema>,
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
    ConfigWithArbitraryCollectionTypes<TTable, TSchema>,
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
>(
  config: PowerSyncCollectionConfig<TTable, TSchema>,
): ReturnType<typeof createPowerSyncCollectionConfig<TTable, TSchema>> {
  const outputConfig = createPowerSyncCollectionConfig(config)
  return withCollectionConfigFactory(outputConfig, () =>
    createPowerSyncCollectionConfig(config),
  )
}

function createPowerSyncCollectionConfig<
  TTable extends Table,
  TSchema extends StandardSchemaV1<any> = never,
>(config: PowerSyncCollectionConfig<TTable, TSchema>) {
  const {
    database,
    table,
    schema: inputSchema,
    syncBatchSize = DEFAULT_BATCH_SIZE,
    syncMode = 'eager',
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
    Math.random() * 0xffffffff,
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
      const { begin, write, collection, commit, markReady, markError } = params
      const abortController = new AbortController()

      let disposeTracking:
        | ((options?: { context?: LockContext }) => Promise<void>)
        | null = null
      let trackingSetup: Promise<void> | null = null

      if (syncMode === `eager`) {
        return runEagerSync()
      } else {
        return runOnDemandSync()
      }

      /**
       * Disposes the current diff trigger, if one is active, and clears the
       * tracking state.
       */
      async function safelyDisposeTracking(
        context?: LockContext,
      ): Promise<void> {
        // Cleanup can race trigger creation. Wait until the disposer has been
        // published so an abort cannot strand a freshly-created trigger.
        const setup = trackingSetup
        if (setup) {
          await setup.catch(() => undefined)
        }

        const dispose = disposeTracking
        if (!dispose) {
          return
        }

        disposeTracking = null
        await dispose(context ? { context } : undefined)
      }

      async function establishTracking(
        options: Parameters<typeof createDiffTrigger>[0],
        appliedReceipts: Array<SyncAppliedReceipt>,
      ): Promise<void> {
        const setup = (async () => {
          const dispose = await createDiffTrigger(options, appliedReceipts)
          disposeTracking = dispose
        })()
        trackingSetup = setup

        try {
          await setup
        } finally {
          if (trackingSetup === setup) {
            trackingSetup = null
          }
        }
      }

      async function createDiffTrigger(
        options: {
          setupContext?: LockContext
          immediate?: boolean
          when: Record<DiffTriggerOperation, string>
          writeType: (rowId: string) => OperationType
          batchQuery: (
            lockContext: LockContext,
            batchSize: number,
            cursor: number,
          ) => Promise<Array<TableType>>
        },
        appliedReceipts: Array<SyncAppliedReceipt>,
      ) {
        const { setupContext, immediate, when, writeType, batchQuery } = options

        return await database.triggers.createDiffTrigger({
          source: viewName,
          destination: trackedTableName,
          setupContext,
          when,
          hooks: {
            beforeCreate: async (context) => {
              let currentBatchCount = syncBatchSize
              let cursor = 0
              while (currentBatchCount == syncBatchSize) {
                begin(immediate ? { immediate: true } : undefined)

                const batchItems = await batchQuery(
                  context,
                  syncBatchSize,
                  cursor,
                )
                currentBatchCount = batchItems.length
                cursor += currentBatchCount
                for (const row of batchItems) {
                  write({
                    type: writeType(row.id),
                    value: deserializeSyncRow(row),
                  })
                }
                appliedReceipts.push(commit())
              }
              database.logger.info(
                `Sync is ready for ${viewName} into ${trackedTableName}`,
              )
            },
          },
        })
      }

      async function flushDiffRecords(): Promise<void> {
        // PowerSync can notify after creating the tracking table but before its
        // create call returns. Preserve that notification until the disposer,
        // which proves the trigger is usable, has been published.
        const setup = trackingSetup
        if (setup) {
          await setup.catch(() => undefined)
        }
        if (!disposeTracking) {
          return
        }

        const ignoredReceipts: Array<SyncAppliedReceipt> = []
        await database
          .writeTransaction(async (context) => {
            await flushDiffRecordsWithContext(context, ignoredReceipts)
          })
          .catch((error) => {
            database.logger.error(
              `An error has been detected in the sync handler`,
              error,
            )
          })
      }

      // We can use this directly if we want to pair a flush with dispose+recreate diff trigger.
      async function flushDiffRecordsWithContext(
        context: LockContext,
        appliedReceipts: Array<SyncAppliedReceipt>,
      ): Promise<void> {
        // There is nothing to flush if no tracking table is currently active.
        if (!disposeTracking) {
          return
        }

        try {
          begin()
          const operations = await context.getAll<TriggerDiffRecord>(
            `SELECT * FROM ${trackedTableName} ORDER BY operation_id ASC`,
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

          const applied = commit()
          appliedReceipts.push(applied)
          // Mutation persistence is what releases the Collection's FIFO gate.
          // Confirm these local operations after the sync transaction is
          // staged; waiting for its applied receipt would deadlock the user
          // transaction that currently parks it.
          pendingOperationStore.resolvePendingFor(pendingOperations)
        } catch (error) {
          database.logger.error(
            `An error has been detected in the sync handler`,
            error,
          )
        }
      }

      // The sync function needs to be synchronous.
      async function start(afterOnChangeRegistered?: () => Promise<void>) {
        database.logger.info(
          `Sync is starting for ${viewName} into ${trackedTableName}`,
        )
        database.onChangeWithCallback(
          {
            onChange: async () => {
              await flushDiffRecords()
            },
          },
          {
            signal: abortController.signal,
            triggerImmediate: false,
            tables: [trackedTableName],
          },
        )

        await afterOnChangeRegistered?.()

        // If the abort controller was aborted while processing the request above
        if (abortController.signal.aborted) {
          await safelyDisposeTracking()
        } else {
          abortController.signal.addEventListener(
            `abort`,
            async () => {
              await safelyDisposeTracking()
            },
            { once: true },
          )
        }
      }

      // Eager mode.
      // Registers a diff trigger for the entire table.
      function runEagerSync() {
        let onUnload: CleanupFn | void | null = null

        start(async () => {
          const cleanup = await restConfig.onLoad?.()
          if (abortController.signal.aborted) {
            cleanup?.()
            return
          }
          onUnload = cleanup

          const appliedReceipts: Array<SyncAppliedReceipt> = []
          await establishTracking(
            {
              // Initial eager hydration must make the source usable before
              // PowerSync can persist a mutation queued during startup.
              immediate: true,
              when: {
                [DiffTriggerOperation.INSERT]: `TRUE`,
                [DiffTriggerOperation.UPDATE]: `TRUE`,
                [DiffTriggerOperation.DELETE]: `TRUE`,
              },
              writeType: (_rowId: string) => `insert`,
              batchQuery: (
                lockContext: LockContext,
                batchSize: number,
                cursor: number,
              ) =>
                lockContext.getAll<TableType>(
                  sanitizeSQL`SELECT * FROM ${viewName} LIMIT ? OFFSET ?`,
                  [batchSize, cursor],
                ),
            },
            appliedReceipts,
          )
          await Promise.all(appliedReceipts)
          markReady()
        }).catch((error) => {
          database.logger.error(
            `Could not start syncing process for ${viewName} into ${trackedTableName}`,
            error,
          )
          if (collection.status === `loading`) {
            markError(error)
          }
        })

        return () => {
          database.logger.info(
            `Sync has been stopped for ${viewName} into ${trackedTableName}`,
          )
          abortController.abort()
          onUnload?.()
        }
      }

      // On-demand mode.
      // Registers a diff trigger for the active WHERE expressions.
      function runOnDemandSync() {
        type DemandRecord = {
          options: LoadSubsetOptions
          state: `provisional` | `active` | `released` | `failed`
          cleanup?: CleanupFn
        }
        type PendingRelease = {
          options: LoadSubsetOptions
          failures: number
        }

        const demands = new Map<LoadSubsetOptions, DemandRecord>()
        const releasedSubsets = new WeakSet<LoadSubsetOptions>()
        const pendingReleases: Array<PendingRelease> = []
        let stopped = false
        let lifecycleGeneration = 0
        let trackingRevision = 0
        let reconciledTrackingRevision = 0
        let rebuildPromise: Promise<void> | null = null
        let drainingReleases = false
        let releaseRetryTimer: ReturnType<typeof setTimeout> | undefined
        const hasStopped = () => stopped

        const startup = start()
        void startup.catch((error) =>
          database.logger.error(
            `Could not start syncing process for ${viewName} into ${trackedTableName}`,
            error,
          ),
        )

        const activeWhereExpressions = () =>
          Array.from(demands.values())
            .filter((demand) => demand.state === `active`)
            .map((demand) => demand.options.where)

        // One reconciliation owns every queued revision so callers cannot
        // settle against a stale trigger configuration.
        const reconcileTracking = async (): Promise<void> => {
          while (
            !hasStopped() &&
            reconciledTrackingRevision !== trackingRevision
          ) {
            const generation = lifecycleGeneration
            const revision = trackingRevision
            const isCurrent = () =>
              !hasStopped() &&
              lifecycleGeneration === generation &&
              trackingRevision === revision
            const appliedReceipts: Array<SyncAppliedReceipt> = []

            await database.writeLock(async (ctx) => {
              if (!isCurrent()) return
              await flushDiffRecordsWithContext(ctx, appliedReceipts)
              if (!isCurrent()) return
              await safelyDisposeTracking(ctx)
              if (!isCurrent()) return

              const active = activeWhereExpressions()
              if (active.length === 0) return
              const combinedWhere =
                active.length === 1
                  ? active[0]
                  : or(active[0], active[1], ...active.slice(2))
              const compiledNewData = compileSQLite(
                { where: combinedWhere },
                { jsonColumn: 'NEW.data' },
              )
              const compiledOldData = compileSQLite(
                { where: combinedWhere },
                { jsonColumn: 'OLD.data' },
              )
              const compiledView = compileSQLite({ where: combinedWhere })
              const newDataWhenClause = toInlinedWhereClause(compiledNewData)
              const oldDataWhenClause = toInlinedWhereClause(compiledOldData)
              const viewWhereClause = toInlinedWhereClause(compiledView)

              await establishTracking(
                {
                  setupContext: ctx,
                  when: {
                    [DiffTriggerOperation.INSERT]: newDataWhenClause,
                    [DiffTriggerOperation.UPDATE]: `(${newDataWhenClause}) OR (${oldDataWhenClause})`,
                    [DiffTriggerOperation.DELETE]: oldDataWhenClause,
                  },
                  writeType: (rowId: string) =>
                    collection.has(rowId) ? `update` : `insert`,
                  batchQuery: (
                    lockContext: LockContext,
                    batchSize: number,
                    cursor: number,
                  ) =>
                    lockContext.getAll<TableType>(
                      `SELECT * FROM ${viewName} WHERE ${viewWhereClause} LIMIT ? OFFSET ?`,
                      [batchSize, cursor],
                    ),
                },
                appliedReceipts,
              )
              if (!isCurrent()) await safelyDisposeTracking(ctx)
            })
            await Promise.all(appliedReceipts)
            if (isCurrent()) {
              reconciledTrackingRevision = revision
            }
          }
        }

        const rebuildTracking = (): Promise<void> => {
          rebuildPromise ??= reconcileTracking().finally(() => {
            rebuildPromise = null
          })
          return rebuildPromise
        }

        const loadSubset = async (
          options: LoadSubsetOptions,
        ): Promise<void> => {
          if (hasStopped()) return
          // Never create a trigger that has no observer to drain its diff table.
          await startup
          if (
            hasStopped() ||
            releasedSubsets.has(options) ||
            options.signal?.aborted
          ) {
            return
          }

          const demand: DemandRecord = { options, state: `provisional` }
          demands.set(options, demand)
          try {
            const cleanup = await restConfig.onLoadSubset?.(options)
            if (cleanup) demand.cleanup = cleanup
          } catch (error) {
            demand.state = `failed`
            demands.delete(options)
            throw error
          }

          if (
            hasStopped() ||
            releasedSubsets.has(options) ||
            options.signal?.aborted ||
            demands.get(options) !== demand
          ) {
            demand.state = `released`
            demands.delete(options)
            demand.cleanup?.()
            return
          }

          demand.state = `active`
          trackingRevision++
          await rebuildTracking()
        }

        const toInlinedWhereClause = (compiled: {
          where?: string
          params: Array<unknown>
        }): string => {
          if (!compiled.where) return 'TRUE'
          const sqlParts = compiled.where.split('?')
          return sanitizeSQL(
            sqlParts as unknown as TemplateStringsArray,
            ...compiled.params,
          )
        }

        const performPhysicalRelease = async (
          options: LoadSubsetOptions,
        ): Promise<void> => {
          const compiledDeparting = compileSQLite({ where: options.where })
          const departingWhereSQL = toInlinedWhereClause(compiledDeparting)
          let rowsToEvict: Array<{ id: string }>
          for (;;) {
            if (hasStopped()) return
            const revision = trackingRevision
            const active = activeWhereExpressions()
            let evictionSQL: string
            if (active.length === 0) {
              evictionSQL = `SELECT id FROM ${viewName} WHERE ${departingWhereSQL}`
            } else {
              const combinedRemaining =
                active.length === 1
                  ? active[0]!
                  : or(active[0], active[1], ...active.slice(2))
              const compiledRemaining = compileSQLite({
                where: combinedRemaining,
              })
              const remainingWhereSQL = toInlinedWhereClause(compiledRemaining)
              evictionSQL = `SELECT id FROM ${viewName} WHERE (${departingWhereSQL}) AND NOT (${remainingWhereSQL})`
            }

            rowsToEvict = await database.getAll<{ id: string }>(evictionSQL)
            if (hasStopped()) return
            if (trackingRevision === revision) break
          }
          if (rowsToEvict.length > 0) {
            begin()
            for (const { id } of rowsToEvict) {
              write({ type: `delete`, key: id })
            }
            void commit()
          }
          await rebuildTracking()
        }

        function scheduleReleaseDrain(delay = 0): void {
          if (hasStopped() || drainingReleases || releaseRetryTimer) return
          if (delay > 0) {
            releaseRetryTimer = setTimeout(() => {
              releaseRetryTimer = undefined
              void drainReleases()
            }, delay)
            return
          }
          void drainReleases()
        }

        async function drainReleases(): Promise<void> {
          if (hasStopped() || drainingReleases) return
          drainingReleases = true
          let retryDelay = 0
          try {
            while (!hasStopped() && pendingReleases.length > 0) {
              const pending = pendingReleases[0]!
              try {
                await performPhysicalRelease(pending.options)
                pendingReleases.shift()
              } catch (error) {
                pending.failures++
                retryDelay = Math.min(1000 * 2 ** (pending.failures - 1), 30000)
                database.logger.error(
                  `Could not release subset tracking for ${viewName}; retrying`,
                  error,
                )
                break
              }
            }
          } finally {
            drainingReleases = false
          }
          if (pendingReleases.length > 0) scheduleReleaseDrain(retryDelay)
        }

        const unloadSubset = (options: LoadSubsetOptions): void => {
          releasedSubsets.add(options)
          const demand = demands.get(options)
          if (
            !demand ||
            demand.state === `released` ||
            demand.state === `failed`
          ) {
            return
          }

          const wasActive = demand.state === `active`
          demand.state = `released`
          demands.delete(options)
          if (wasActive) trackingRevision++
          try {
            demand.cleanup?.()
          } catch (error) {
            database.logger.error(
              `Could not clean up subset hook for ${viewName}`,
              error,
            )
          }

          if (wasActive) {
            pendingReleases.push({ options, failures: 0 })
            scheduleReleaseDrain()
          }
        }

        markReady()

        return {
          [POWERSYNC_TEST_HOOKS]: {
            getDemandCount: () => demands.size,
          },
          cleanup: () => {
            stopped = true
            lifecycleGeneration++
            trackingRevision++
            clearTimeout(releaseRetryTimer)
            releaseRetryTimer = undefined
            database.logger.info(
              `Sync has been stopped for ${viewName} into ${trackedTableName}`,
            )
            abortController.abort()
            for (const demand of demands.values()) {
              try {
                demand.cleanup?.()
              } catch (error) {
                database.logger.error(
                  `Could not clean up subset hook for ${viewName}`,
                  error,
                )
              }
              demand.state = `released`
            }
            demands.clear()
            pendingReleases.length = 0
          },
          loadSubset: (options: LoadSubsetOptions) => loadSubset(options),
          unloadSubset,
        }
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
    syncMode,
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
            >,
          ),
      }),
    },
  }
  return outputConfig
}
