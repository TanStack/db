import { DiffTriggerOperation, LogLevels } from '@powersync/common'
import type {
  CommonPowerSyncDatabase,
  LockContext,
  TriggerRemoveCallback,
} from '@powersync/common'

/**
 * Options for {@link createDirectDiffTrigger}. Mirrors the SDK's
 * `CreateDiffTriggerOptions`, restricted to the shapes the collection
 * adapter uses.
 */
export type DirectDiffTriggerOptions = {
  /**
   * The SQLite table to trigger on. For a managed (`direct: true`) table this
   * is the table's schema name: the SDK materializes managed tables as real
   * tables under their schema name and does not create a `ps_data__<name>`
   * object for them (verified against `@powersync/node` 1.3.0 /
   * `@powersync/common` 2.5.0).
   */
  source: string
  /**
   * The tracking table the triggers write diff records into. Created here as
   * a TEMP table (or as a main-schema table when the adapter requires
   * cross-connection tracking) and dropped on removal.
   */
  destination: string
  /**
   * The real columns to track. Unlike the view-based path there is no JSON
   * `data` column, so payloads are built with `json_object` over these
   * columns directly. An empty array tracks only the row id.
   */
  columns: Array<string>
  setupContext?: LockContext
  when: Partial<Record<DiffTriggerOperation, string>>
  /**
   * An extra WHEN clause for updates that leave the tracked boundary: it must
   * fire when the OLD row matched the boundary and the NEW row does not. Such
   * updates record a `DELETE` diff, so the flush removes a row that left the
   * boundary instead of retaining its departed value. When omitted, `when`'s
   * UPDATE clause sees both entering and departing updates.
   */
  whenUpdateDeparting?: string
  hooks?: {
    /**
     * Executed inside a write lock before the tracking table is created.
     */
    beforeCreate?: (context: LockContext) => Promise<void>
  }
}

/**
 * The SQLite table shape used by the SDK's `TriggerManagerImpl`. The diff
 * flush path (`SELECT * FROM <destination>`) reads exactly these columns, so
 * adapter-managed triggers for managed tables must produce the same shape.
 */
const TRACKING_TABLE_COLUMNS = `
      operation_id INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT,
      operation TEXT,
      timestamp TEXT,
      value TEXT,
      previous_value TEXT
`

/**
 * Columns batched per `json_object` call. SQLite caps a function's argument
 * count (`SQLITE_MAX_FUNCTION_ARG`; 100 on default builds, higher on custom
 * builds), so a wide table must be split across several objects that are then
 * combined. 40 columns keeps every generated call (two arguments per column)
 * below the default cap.
 */
const JSON_OBJECT_COLUMN_BATCH_SIZE = 40

/**
 * Builds the JSON payload fragment for a trigger from the real columns of a
 * managed table. This replaces the SDK's `NEW.data` / `json_extract(NEW.data,
 * '$.<column>')` fragments, which assume the single JSON `data` column of a
 * managed view.
 *
 * Columns are split into batches (see {@link JSON_OBJECT_COLUMN_BATCH_SIZE})
 * and the batch objects are combined with `json_insert`, which keeps keys
 * whose value is null. (`json_patch` would drop them.)
 */
const jsonFragment = (columns: Array<string>, source: `NEW` | `OLD`) => {
  if (columns.length == 0) {
    // Don't track any columns except for the id
    return `'{}'`
  }
  const keyValuePairs = (batch: Array<string>) =>
    batch.map((column) => `'${column}', ${source}."${column}"`).join(', ')
  // json_insert addresses each column by JSON path rather than by key
  const pathValuePairs = (batch: Array<string>) =>
    batch.map((column) => `'$.${column}', ${source}."${column}"`).join(', ')
  const batches: Array<Array<string>> = []
  for (
    let index = 0;
    index < columns.length;
    index += JSON_OBJECT_COLUMN_BATCH_SIZE
  ) {
    batches.push(columns.slice(index, index + JSON_OBJECT_COLUMN_BATCH_SIZE))
  }
  const [firstBatch, ...remainingBatches] = batches
  // A non-empty column list always yields at least one batch
  return remainingBatches.reduce(
    (fragment, batch) => `json_insert(${fragment}, ${pathValuePairs(batch)})`,
    `json_object(${keyValuePairs(firstBatch!)})`,
  )
}

/**
 * Mirrors the SDK's trigger naming scheme (`__ps_temp_trigger_<op>__<destination>__<id>`)
 * so adapter-managed triggers are recognizable and collision-free alongside
 * SDK-created ones.
 */
const generateTriggerName = (
  operation: DiffTriggerOperation | `UPDATE_DEPARTING`,
  destinationTable: string,
  triggerId: string,
  persistent: boolean,
) =>
  persistent
    ? // Persistent names must not match the SDK trigger manager's GC pattern
      // (`__ps_temp_trigger_%` in `sqlite_master`), which drops persisted
      // triggers nobody holds a claim for. The remove callback owns cleanup.
      `__ps_direct_trigger_${operation.toLowerCase()}__${destinationTable}__${triggerId}`
    : `__ps_temp_trigger_${operation.toLowerCase()}__${destinationTable}__${triggerId}`

/**
 * Configuration that web adapters expose when the database file is shared
 * across connections (for example multiple browser tabs on OPFS storage).
 * The web SDK reads the same flag to enable persisted triggers for its own
 * trigger manager.
 */
type AdapterConfiguration = {
  requiresPersistentTriggers?: boolean
}

/**
 * TEMP triggers only fire for writes on the connection that created them.
 * Adapters whose connections can observe each other's writes therefore need
 * the triggers (and the tracking table) in the main schema instead.
 */
const requiresPersistentTriggers = (database: CommonPowerSyncDatabase) => {
  const adapter = database.database as {
    getConfiguration?: () => AdapterConfiguration
  }
  return adapter.getConfiguration?.()?.requiresPersistentTriggers == true
}

/**
 * Resolves the unique id used in trigger names, preferring the setup
 * transaction's UUID provider so ids are stable across multi-tab
 * coordination contexts (same contract as the SDK's trigger manager).
 */
async function getUUID(context: LockContext | CommonPowerSyncDatabase) {
  const { id: uuid } = await context.get<{ id: string }>(`SELECT uuid() as id`)
  // Replace dashes with underscores for SQLite table/trigger name compatibility
  return uuid.replace(/-/g, `_`)
}

/**
 * Creates the tracking table and `AFTER INSERT/UPDATE/DELETE` diff triggers
 * for a managed (`direct: true`) PowerSync table.
 *
 * The SDK's `TriggerManagerImpl` only supports managed views: its trigger
 * payloads read `NEW.data` / `json_extract(NEW.data, '$.<column>')`, and it
 * triggers on `ps_data__<name>`, which does not exist for a managed table
 * (the real columns live on the table itself). Until the SDK gains support,
 * the adapter creates equivalent triggers itself:
 * - payloads are built with `json_object('column', NEW."column", ...)`
 *   batches over the real columns (`OLD` for the previous value),
 * - the tracking table shape, trigger naming, `when` clauses, `beforeCreate`
 *   hook timing and cleanup contract (drop triggers + tracking table) match
 *   `TriggerManagerImpl.createDiffTrigger`,
 * - tracking resources are TEMP unless the database's adapter requires
 *   cross-connection tracking (`requiresPersistentTriggers`, e.g. OPFS
 *   multi-tab web adapters): writes from another connection cannot fire a
 *   TEMP trigger, so such connections get main-schema (persistent) triggers
 *   and tracking table instead. The SDK's claim-based GC for persisted
 *   triggers is not reachable through the public trigger manager API, so
 *   persistent trigger names avoid its unclaimed-trigger pattern and only
 *   the remove callback cleans them up.
 *
 * @returns A callback to remove the trigger and drop the tracking table.
 */
export async function createDirectDiffTrigger(
  database: CommonPowerSyncDatabase,
  options: DirectDiffTriggerOptions,
): Promise<TriggerRemoveCallback> {
  await database.waitForReady()
  const { source, destination, columns, when, whenUpdateDeparting, hooks, setupContext } = options
  const operations = Object.keys(when) as Array<DiffTriggerOperation>
  if (operations.length == 0) {
    throw new Error(
      `At least one WHEN operation must be specified for the trigger.`,
    )
  }

  // TEMP resources belong to this connection alone; persistent resources live
  // in the main schema for connections that track each other's writes.
  // Cleanup drops both by name through the remove callback.
  const persistent = requiresPersistentTriggers(database)
  const tableTriggerTypeClause = persistent ? `` : `TEMP`

  const whenClauses = Object.fromEntries(
    Object.entries(when).map(([operation, filter]) => [
      operation,
      `WHEN ${filter}`,
    ]),
  )

  const triggerIds: Array<string> = []
  const id = await getUUID(setupContext ?? database)

  const disposeWarningListener = database.registerListener({
    schemaChanged: () => {
      database.logger.log({
        level: LogLevels.warn,
        message: `The PowerSync schema has changed while previously configured triggers are still operational. This might cause unexpected results.`,
      })
    },
  })

  /**
   * Declare the cleanup function early since if any of the init steps fail,
   * we need to ensure we can cleanup the created resources.
   * We unfortunately cannot rely on transaction rollback.
   */
  const cleanup = async (removeOptions?: {
    context?: LockContext
  }): Promise<void> => {
    disposeWarningListener()
    const context = removeOptions?.context
    const doCleanup = async (tx: LockContext) => {
      for (const triggerId of triggerIds) {
        await tx.execute(`DROP TRIGGER IF EXISTS ${triggerId}; `)
      }
      await tx.execute(`DROP TABLE IF EXISTS ${destination};`)
    }
    if (context) {
      await doCleanup(context)
    } else {
      await database.writeLock(doCleanup)
    }
  }

  const setup = async (tx: LockContext) => {
    // Allow user code to execute in this lock context before the trigger is created.
    await hooks?.beforeCreate?.(tx)
    await tx.execute(
      `CREATE ${tableTriggerTypeClause} TABLE ${destination} (
        ${TRACKING_TABLE_COLUMNS}
      )`,
    )

    if (operations.includes(DiffTriggerOperation.INSERT)) {
      const insertTriggerId = generateTriggerName(
        DiffTriggerOperation.INSERT,
        destination,
        id,
        persistent,
      )
      triggerIds.push(insertTriggerId)

      await tx.execute(`
        CREATE ${tableTriggerTypeClause} TRIGGER ${insertTriggerId} AFTER INSERT ON ${source} ${
          whenClauses[DiffTriggerOperation.INSERT]
        } BEGIN
        INSERT INTO
          ${destination} (id, operation, timestamp, value)
        VALUES
          (
            NEW.id,
            'INSERT',
            strftime ('%Y-%m-%dT%H:%M:%fZ', 'now'),
            ${jsonFragment(columns, 'NEW')}
          );

        END
      `)
    }

    if (operations.includes(DiffTriggerOperation.UPDATE)) {
      const updateTriggerId = generateTriggerName(
        DiffTriggerOperation.UPDATE,
        destination,
        id,
        persistent,
      )
      triggerIds.push(updateTriggerId)

      await tx.execute(`
        CREATE ${tableTriggerTypeClause} TRIGGER ${updateTriggerId} AFTER
        UPDATE ON ${source} ${whenClauses[DiffTriggerOperation.UPDATE]} BEGIN
        INSERT INTO
          ${destination} (id, operation, timestamp, value, previous_value)
        VALUES
          (
            NEW.id,
            'UPDATE',
            strftime ('%Y-%m-%dT%H:%M:%fZ', 'now'),
            ${jsonFragment(columns, 'NEW')},
            ${jsonFragment(columns, 'OLD')}
          );

        END;
      `)
    }

    if (whenUpdateDeparting && operations.includes(DiffTriggerOperation.UPDATE)) {
      const departingTriggerId = generateTriggerName(
        `UPDATE_DEPARTING`,
        destination,
        id,
        persistent,
      )
      triggerIds.push(departingTriggerId)

      // An update that leaves the tracked boundary removes the row: record a
      // DELETE diff carrying the departed row so the flush drops it.
      await tx.execute(`
        CREATE ${tableTriggerTypeClause} TRIGGER ${departingTriggerId} AFTER
        UPDATE ON ${source} WHEN ${whenUpdateDeparting} BEGIN
        INSERT INTO
          ${destination} (id, operation, timestamp, value)
        VALUES
          (
            NEW.id,
            'DELETE',
            strftime ('%Y-%m-%dT%H:%M:%fZ', 'now'),
            ${jsonFragment(columns, 'OLD')}
          );

        END;
      `)
    }

    if (operations.includes(DiffTriggerOperation.DELETE)) {
      const deleteTriggerId = generateTriggerName(
        DiffTriggerOperation.DELETE,
        destination,
        id,
        persistent,
      )
      triggerIds.push(deleteTriggerId)

      await tx.execute(`
        CREATE ${tableTriggerTypeClause} TRIGGER ${deleteTriggerId} AFTER DELETE ON ${source} ${
          whenClauses[DiffTriggerOperation.DELETE]
        } BEGIN
        INSERT INTO
          ${destination} (id, operation, timestamp, value)
        VALUES
          (
            OLD.id,
            'DELETE',
            strftime ('%Y-%m-%dT%H:%M:%fZ', 'now'),
            ${jsonFragment(columns, 'OLD')}
          );

        END;
      `)
    }
  }

  try {
    if (setupContext) {
      await setup(setupContext)
    } else {
      await database.writeLock(setup)
    }
    return cleanup
  } catch (error) {
    try {
      await cleanup(setupContext ? { context: setupContext } : undefined)
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Error during operation and cleanup`,
      )
    }
    throw error
  }
}
