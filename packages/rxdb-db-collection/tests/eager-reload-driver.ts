/**
 * Real local RxDB documents receive the complete-result reload judgment.
 * The source reads storage pages directly, rather than RxQuery documents.
 * An actual empty storage page establishes exhaustion independently of the
 * adapter's commit/readiness choice; finite source continuations drain next.
 */
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
    let finishRead!: () => void
    let rejectRead!: (error: unknown) => void
    let completeRead = Promise.resolve()
    const query = rows.storageInstance.query.bind(rows.storageInstance)
    const storage = Object.create(
      rows.storageInstance,
    ) as typeof rows.storageInstance
    storage.query = async (prepared) => {
      // Capture the source run so an obsolete read cannot complete a new one.
      const finish = finishRead
      const reject = rejectRead
      try {
        const result = await query(prepared)
        if (result.documents.length === 0) finish()
        return result
      } catch (error) {
        reject(error)
        throw error
      }
    }
    // Fixture replacements keep the original storage instance. Only the
    // adapter's direct storage reads pass through this transparent facade;
    // an empty helper RxQuery can never satisfy source exhaustion.
    const sourceRows = new Proxy(rows, {
      get(target, property) {
        if (property === `storageInstance`) return storage
        const value = Reflect.get(target, property, target)
        return typeof value === `function` ? value.bind(target) : value
      },
    })
    const options = rxdbCollectionOptions({
      id,
      rxCollection: sourceRows,
      syncMode: `eager`,
      syncBatchSize: 1,
    })
    const source = options.sync.sync
    options.sync.sync = (params) => {
      completeRead = new Promise<void>((resolve, reject) => {
        finishRead = resolve
        rejectRead = reject
      })
      void completeRead.catch(() => {})
      return source(params)
    }
    return {
      options,
      replace,
      propagate: async () => {
        await completeRead
        // Real storage exhaustion is the premise; these turns only drain the
        // finite initialFetch/start continuations until their receipt awaits.
        // They also finish an empty run with commit/markReady suppressed.
        for (let turn = 0; turn < 4; turn++)
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
      },
      dispose: () => database.remove(),
    }
  },
}
