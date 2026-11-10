/** Real PowerSync SQLite table reads receive the unwrapped reload judgment. */
import { Schema, Table, column } from '@powersync/common'
import { z } from 'zod'
import { powerSyncCollectionOptions } from '../src/powersync'
import type { CommonPowerSyncDatabase } from '@powersync/common'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import type { EagerReloadAdapter } from '../../db-adapter-conformance/tests/eager-reload-driver'

const schema = new Schema({ rows: new Table({ value: column.integer }) })
const rowSchema = z.object({ id: z.string(), value: z.number() })
export function powerSyncEagerReloadAdapterFor(
  open: (schema: Schema) => Promise<{
    database: CommonPowerSyncDatabase
    dispose: () => Promise<unknown>
  }>,
): EagerReloadAdapter {
  return {
    async open(initial, id) {
      const { database, dispose } = await open(schema)
      const replace = (next: Array<StartupRow>) =>
        database.writeTransaction(async (tx) => {
          await tx.execute(`DELETE FROM rows`)
          for (const row of next)
            await tx.execute(`INSERT INTO rows(id, value) VALUES (?, ?)`, [
              row.id,
              row.value,
            ])
        })
      await replace(initial)
      return {
        options: powerSyncCollectionOptions({
          id,
          database,
          table: schema.props.rows,
          schema: rowSchema,
          syncBatchSize: 1,
          onDeserializationError: () => {},
        }),
        replace,
        dispose,
      }
    },
  }
}
