/** Real PowerSync SQLite supplies rows; its public onLoad gate orders runs. */
import { LogLevels, Schema, Table, column } from '@powersync/common'
import { z } from 'zod'
import { baselineGate } from '../../db-adapter-conformance/tests/persisted-baseline-lifecycle-driver'
import { hydrationLifecycleRows } from '../../trailbase-db-collection/tests/lifecycle-hydration-oracle'
import { powerSyncCollectionOptions } from '../src'
import type { CommonPowerSyncDatabase } from '@powersync/common'
import type { BaselineLifecycleAdapter } from '../../db-adapter-conformance/tests/persisted-baseline-lifecycle-driver'
import type { HydrationLifecycleRow } from '../../trailbase-db-collection/tests/lifecycle-hydration-oracle'

const schema = new Schema({ rows: new Table({ value: column.integer }) })
export function powerSyncBaselineLifecycleAdapterFor(
  open: (schema: Schema) => Promise<{
    database: CommonPowerSyncDatabase
    dispose: () => Promise<unknown>
  }>,
): BaselineLifecycleAdapter {
  return async (h, id) => {
    const { database, dispose } = await open(schema)
    const diagnostics: Array<{ message: string; error: unknown }> = []
    const log = database.logger.log.bind(database.logger)
    database.logger.log = (entry) => {
      if (entry.level === LogLevels.error)
        // The provider generates a random private tracking-table suffix per run.
        // Record the diagnostic relation, error identity, order and count;
        // neither the public failure law nor its check depends on that name.
        diagnostics.push({
          message: String(entry.message).replace(
            /__rows_tracking_[0-9a-f]+/g,
            `__rows_tracking_<provider-id>`,
          ),
          error: entry.error,
        })
      else log(entry)
    }
    const replace = (rows: Array<HydrationLifecycleRow>) =>
      database.writeTransaction(async (tx) => {
        await tx.execute(`DELETE FROM rows`)
        for (const row of rows)
          await tx.execute(`INSERT INTO rows (id, value) VALUES (?, ?)`, [
            row.id,
            row.value,
          ])
      })
    await replace(hydrationLifecycleRows(h.old, 2))
    const sessions: Array<{ releases: number }> = []
    const hooks: Array<{
      gate: ReturnType<typeof baselineGate<void>>
      releases: number
      acquired: boolean
    }> = []
    const register = database.onChangeWithCallback.bind(database)
    database.onChangeWithCallback = (handler, options) => {
      const session = { releases: 0 }
      sessions.push(session)
      options?.signal?.addEventListener(
        `abort`,
        () => {
          session.releases++
        },
        { once: true },
      )
      return register(handler, options)
    }
    const options = powerSyncCollectionOptions({
      id,
      database,
      table: schema.props.rows,
      schema: z.object({ id: z.string(), value: z.number() }),
      syncBatchSize: h.batchSize,
      onDeserializationError: () => {},
      onLoad: async () => {
        const hook = {
          gate: baselineGate<void>(),
          releases: 0,
          acquired: false,
        }
        hooks.push(hook)
        await hook.gate.promise
        hook.acquired = true
        return () => {
          hook.releases++
        }
      },
    })
    return {
      options,
      sessions: () => hooks.length,
      deliver: (run) => hooks[run]?.gate.resolve(),
      fail: (run, error) => hooks[run]!.gate.reject(error),
      replace,
      event: async (row) => {
        await database.execute(`INSERT INTO rows (id, value) VALUES (?, ?)`, [
          row.id,
          row.value,
        ])
      },
      releases: () => sessions.map((session) => session.releases),
      hookReleases: () =>
        hooks.filter((hook) => hook.acquired).map((hook) => hook.releases),
      hookAcquisitions: () => hooks.filter((hook) => hook.acquired).length,
      diagnostics: () => diagnostics,
      dispose,
    }
  }
}
