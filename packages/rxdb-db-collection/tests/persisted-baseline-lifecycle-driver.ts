/** Real RxDB memory storage supplies rows; query settlement is controlled. */
import { createRxDatabase } from 'rxdb/plugins/core'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { Observable } from 'rxjs'
import { baselineGate } from '../../db-adapter-conformance/tests/persisted-baseline-lifecycle-driver'
import { hydrationLifecycleRows } from '../../trailbase-db-collection/tests/lifecycle-hydration-oracle'
import { rxdbCollectionOptions } from '../src/rxdb'
import type { RxChangeEvent, RxCollection } from 'rxdb/plugins/core'
import type { Subscriber } from 'rxjs'
import type { BaselineLifecycleAdapter } from '../../db-adapter-conformance/tests/persisted-baseline-lifecycle-driver'
import type { HydrationLifecycleRow } from '../../trailbase-db-collection/tests/lifecycle-hydration-oracle'

let sequence = 0
export const rxdbBaselineLifecycleAdapter: BaselineLifecycleAdapter = async (
  h,
  id,
) => {
  const database = await createRxDatabase<{
    rows: RxCollection<HydrationLifecycleRow>
  }>({
    name: `baselinelifecycle${sequence++}`,
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
  const replace = async (values: Array<HydrationLifecycleRow>) => {
    await rows.find().remove()
    const result = await rows.bulkInsert(values)
    if (result.error.length)
      throw new Error(`RxDB lifecycle source insert failed`)
  }
  await replace(hydrationLifecycleRows(h.old, 2))
  const source = rows.$
  const sessions: Array<{
    gate: ReturnType<typeof baselineGate<void>>
    releases: number
    first: boolean
    subscriber: Subscriber<RxChangeEvent<HydrationLifecycleRow>>
  }> = []
  Object.defineProperty(rows, `$`, {
    value: new Observable<RxChangeEvent<HydrationLifecycleRow>>(
      (subscriber) => {
        const session = {
          gate: baselineGate<void>(),
          releases: 0,
          first: true,
          subscriber,
        }
        sessions.push(session)
        const actual = source.subscribe(subscriber)
        return () => {
          session.releases++
          actual.unsubscribe()
        }
      },
    ),
  })
  const query = rows.storageInstance.query.bind(rows.storageInstance)
  rows.storageInstance.query = async (prepared) => {
    const session = sessions.at(-1)
    if (!session) throw new Error(`RxDB query has no lifecycle subscription`)
    if (session.first) {
      session.first = false
      await session.gate.promise
    }
    return query(prepared)
  }
  return {
    options: rxdbCollectionOptions({
      id,
      rxCollection: rows,
      syncMode: `eager`,
      syncBatchSize: h.batchSize,
    }),
    sessions: () => sessions.length,
    deliver: (run) => sessions[run]?.gate.resolve(),
    fail: (run, error) => sessions[run]!.gate.reject(error),
    streamFail: (run, error) => sessions[run]!.subscriber.error(error),
    replace,
    event: async (row) => {
      await rows.insert(row)
    },
    releases: () => sessions.map((session) => session.releases),
    hookReleases: () => [],
    hookAcquisitions: () => 0,
    diagnostics: () => [],
    dispose: () => database.remove(),
  }
}
