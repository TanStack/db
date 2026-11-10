/**
 * Real RxDB memory storage supplies the complete initial query, including its
 * paging and last-write-time cursor. Only the first query response is held to
 * cross persisted restore. The shared model judges rows at all startup cuts;
 * public reload re-reads the same RxCollection. This is a local-storage SDK
 * witness, not evidence about RxDB's separate server replication.
 */
import { createCollection } from '@tanstack/db'
import { createRxDatabase } from 'rxdb/plugins/core'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import {
  sortedStartupRows,
  startupRows,
} from '../../db-adapter-conformance/src/persisted-startup-oracle'
import { rxdbCollectionOptions } from '../src/rxdb'
import type { RxCollection } from 'rxdb/plugins/core'
import type {
  PersistedStartupHistory,
  StartupRow,
} from '../../db-adapter-conformance/src/persisted-startup-oracle'
import type { PersistedStartupAdapter } from '../../db-adapter-conformance/tests/persisted-startup-driver'

let sequence = 0
export const rxdbStartupAdapter: PersistedStartupAdapter<PersistedStartupHistory> =
  {
    scope: `collection`,
    async create(persistence, history, id) {
      const database = await createRxDatabase<{
        rows: RxCollection<StartupRow>
      }>({
        name: `persistedstartup${sequence++}`,
        storage: getRxStorageMemory(),
        multiInstance: false,
      })
      const { rows } = await database.addCollections({
        rows: {
          schema: {
            version: 0,
            type: `object`,
            primaryKey: `id`,
            properties: {
              id: { type: `string`, maxLength: 10 },
              value: { type: `number` },
            },
            required: [`id`, `value`],
          },
        },
      })
      const inserted = await rows.bulkInsert(startupRows(history.next, 2))
      if (inserted.error.length)
        throw new Error(`RxDB startup fixture failed to store source rows`)
      let release!: () => void
      let available = false
      const response = new Promise<void>((resolve) => {
        release = resolve
      })
      const query = rows.storageInstance.query.bind(rows.storageInstance)
      let first = true
      rows.storageInstance.query = async (prepared) => {
        if (first) {
          first = false
          await response
        }
        return query(prepared)
      }
      const collection = createCollection(
        persistedCollectionOptions({
          ...rxdbCollectionOptions({
            id,
            rxCollection: rows,
            syncBatchSize: 2,
            syncMode: `eager`,
          }),
          persistence,
        }),
      )
      return {
        collection,
        snapshot: () => ({ rows: sortedStartupRows(collection.values()) }),
        deliver: () => {
          available = true
          release()
          return Promise.resolve()
        },
        responseAvailable: () => available,
        refresh: () => collection.reload(),
        dispose: async () => {
          release()
          await withOracleCleanup(
            () => collection.cleanup(),
            [() => database.remove()],
          )
        },
      }
    },
  }
