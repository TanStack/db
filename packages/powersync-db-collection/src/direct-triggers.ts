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
   * a TEMP table and dropped on removal.
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
 * Builds the JSON payload fragment for a trigger from the real columns of a
 * managed table. This replaces the SDK's `NEW.data` / `json_extract(NEW.data,
 * '$.<column>')` fragments, which assume the single JSON `data` column of a
 * managed view.
 */
const jsonFragment = (columns: Array<string>, source: `NEW` | `OLD`) => {
  if (columns.length == 0) {
    // Don't track any columns except for the id
    return `'{}'`
  }
  return `json_object(${columns
    .map((column) => `'${column}', ${source}."${column}"`)
    .join(', ')})`
}

const generateTriggerName = (
  operation: DiffTriggerOperation,
  destinationTable: string,
  triggerId: string,
) =>
  `__ps_temp_trigger_${operation.toLowerCase()}__${destinationTable}__${triggerId}`

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
 * the adapter creates equivalent TEMP triggers itself:
 * - payloads are built with `json_object('column', NEW."column", ...)` over
 *   the real columns (`OLD` for the previous value),
 * - the tracking table shape, trigger naming, `when` clauses, `beforeCreate`
 *   hook timing and cleanup contract (drop triggers + tracking table) match
 *   `TriggerManagerImpl.createDiffTrigger`,
 * - triggers are always TEMP. The SDK's storage-backed (persisted) mode and
 *   its claim-based cleanup never apply here, because the adapter never
 *   passes `useStorage` to the SDK either.
 *
 * @returns A callback to remove the trigger and drop the tracking table.
 */
export async function createDirectDiffTrigger(
  database: CommonPowerSyncDatabase,
  options: DirectDiffTriggerOptions,
): Promise<TriggerRemoveCallback> {
  await database.waitForReady()
  const { source, destination, columns, when, hooks, setupContext } = options
  const operations = Object.keys(when) as Array<DiffTriggerOperation>
  if (operations.length == 0) {
    throw new Error(
      `At least one WHEN operation must be specified for the trigger.`,
    )
  }

  // The adapter's tracking resources are TEMP: each connection (tab) owns its
  // own tracking table and triggers, and they disappear with the connection.
  const tableTriggerTypeClause = `TEMP`

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

    if (operations.includes(DiffTriggerOperation.DELETE)) {
      const deleteTriggerId = generateTriggerName(
        DiffTriggerOperation.DELETE,
        destination,
        id,
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
