/**
 * A real local PowerSync SQLite table supplies the entire eager source result.
 * The public onLoad hook holds that read while the oracle orders it against
 * persisted restore. The shared model checks the second persistence store;
 * source SQLite is not a reason to waive replacement in a wrapped Collection.
 * Reload reads the unchanged table again. Remote PowerSync replication is
 * outside this local-table witness.
 * A representation axis prefixes provider IDs and deserializes them back to
 * the same model Collection keys. Expected rows do not depend on that encoding.
 */
import { Schema, Table, column } from '@powersync/common'
import { createCollection } from '@tanstack/db'
import { z } from 'zod'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import {
  sortedStartupRows,
  startupRows,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import {
  startupInitialRender,
  trackStartupSync,
  untilStartup,
} from '../../db-adapter-conformance/tests/persisted-startup-driver'
import { powerSyncCollectionOptions } from '../src'
import type { CommonPowerSyncDatabase } from '@powersync/common'
import type { PersistedStartupHistory } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import type { PersistedStartupAdapter } from '../../db-adapter-conformance/tests/persisted-startup-driver'

const schema = new Schema({ rows: new Table({ value: column.integer }) })
const rowSchema = z.object({ id: z.string(), value: z.number() })
export function powerSyncStartupAdapterFor(
  open: (schema: Schema) => Promise<{
    database: CommonPowerSyncDatabase
    dispose: () => Promise<void>
  }>,
): PersistedStartupAdapter<PersistedStartupHistory> {
  return {
    scope: `collection`,
    async create(persistence, history, id, metadataTransform) {
      const { database, dispose } = await open(schema)
      const sourceKey = (key: string) =>
        history.sourceKeys ? `provider:${key}` : key
      const deserializedSourceKeys = new Set<string>()
      await database.writeTransaction(async (tx) => {
        for (const row of startupRows(history.next, 2))
          await tx.execute(`INSERT INTO rows (id, value) VALUES (?, ?)`, [
            sourceKey(row.id),
            row.value,
          ])
      })
      let pending: (() => void) | undefined
      const options = powerSyncCollectionOptions({
        id,
        database,
        table: schema.props.rows,
        syncBatchSize: history.batchSize ?? 1,
        schema: rowSchema,
        ...(history.sourceKeys
          ? {
              deserializationSchema: z.object({
                id: z.string().transform((key) => {
                  if (!key.startsWith(`provider:`))
                    throw new Error(`PowerSync source key encoding was lost`)
                  deserializedSourceKeys.add(key)
                  return key.slice(`provider:`.length)
                }),
                value: z.number(),
              }),
            }
          : {}),
        onDeserializationError: () => {},
        onLoad: () =>
          new Promise<void>((resolve) => {
            pending = resolve
          }),
      })
      const startup = trackStartupSync(options.sync, metadataTransform)
      const collection = createCollection(
        persistedCollectionOptions({
          ...options,
          sync: startup.sync,
          ...startupInitialRender(history),
          persistence,
        }),
      )
      const responseAvailable = () =>
        startup.hasCommitted() &&
        startup.committedRowCount() >= startupRows(history.next, 2).length
      const deliver = async () => {
        await untilStartup(() => pending !== undefined)
        const release = pending!
        pending = undefined
        release()
        await untilStartup(responseAvailable)
      }
      return {
        collection,
        syncOutcome: startup.syncOutcome,
        initialResult: startup.initialResult,
        firstSubmission: startup.firstSubmission,
        sourceTransactions: startup.sourceTransactions,
        waitForRestore: startup.waitForRestore,
        checkStartup: () =>
          history.sourceKeys &&
          startupRows(history.next, 2).some(
            (row) => !deserializedSourceKeys.has(sourceKey(row.id)),
          )
            ? [`PowerSync source-key transformation was not reached`]
            : [],
        snapshot: () => ({ rows: sortedStartupRows(collection.values()) }),
        deliver,
        responseAvailable,
        refresh: async () => {
          const reloaded = collection.reload()
          await deliver()
          await reloaded
        },
        dispose: async () => {
          pending?.()
          await withOracleCleanup(() => collection.cleanup(), [dispose])
        },
      }
    },
  }
}
