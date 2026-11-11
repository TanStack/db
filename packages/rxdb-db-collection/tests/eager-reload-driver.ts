/** Real local RxDB documents receive the complete-result reload judgment. */
import { createRxDatabase } from 'rxdb/plugins/core'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { rxdbCollectionOptions } from '../src/rxdb'
import type { RxCollection } from 'rxdb/plugins/core'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import type { EagerReloadAdapter } from '../../db-adapter-conformance/tests/eager-reload-driver'

let sequence = 0
export const rxdbEagerReloadAdapter: EagerReloadAdapter = {
  async open(initial, id) {
    const database = await createRxDatabase<{ rows: RxCollection<StartupRow> }>(
      {
        name: `eagerreload${sequence++}`,
        storage: getRxStorageMemory(),
        multiInstance: false,
      },
    )
    const { rows } = await database.addCollections({
      rows: {
        schema: {
          version: 0,
          type: `object`,
          primaryKey: `id`,
          properties: {
            id: { type: `string`, maxLength: 20 },
            value: { type: `number` },
          },
          required: [`id`, `value`],
        },
      },
    })
    const replace = async (next: Array<StartupRow>) => {
      const docs = await rows.find().exec()
      if (docs.length) await rows.bulkRemove(docs.map((row) => row.id))
      const inserted = await rows.bulkInsert(next)
      if (inserted.error.length)
        throw new Error(`RxDB reload fixture insert failed`)
    }
    await replace(initial)
    return {
      options: rxdbCollectionOptions({
        id,
        rxCollection: rows,
        syncMode: `eager`,
        syncBatchSize: 1,
      }),
      replace,
      dispose: () => database.remove(),
    }
  },
}
