/**
 * The installed RxDB storage supplies every row and the real change feed.
 * Controlled wrappers hold the first storage query of each sync run and inject
 * either its rejection or an RxJS terminal error. These are independent run
 * acquisitions; no shared cached terminal-verdict premise is claimed.
 */
import { createRxDatabase } from 'rxdb/plugins/core'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { Observable } from 'rxjs'
import { rxdbCollectionOptions } from '../src/rxdb'
import type { Subscriber } from 'rxjs'
import type { RxChangeEvent, RxCollection } from 'rxdb/plugins/core'
import type { EagerGateAdapter } from '../../db-adapter-conformance/tests/eager-reload-driver'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'

function gate() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  // Teardown may release a gate that its stopped adapter no longer awaits.
  void promise.catch(() => {})
  return { resolve, reject, promise }
}
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
let sequence = 0
export const rxdbEagerGateAdapter: EagerGateAdapter = {
  sources: [`query`, `stream`],
  async open(source) {
    const database = await createRxDatabase<{ rows: RxCollection<StartupRow> }>(
      {
        name: `rxdbgate${sequence++}`,
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
            id: { type: `string`, maxLength: 30 },
            value: { type: `number` },
          },
          required: [`id`, `value`],
        },
      },
    })
    const sessions: Array<{
      gate: ReturnType<typeof gate>
      firstQuery: boolean
      subscriber: Subscriber<RxChangeEvent<StartupRow>>
    }> = []
    let failures = 0
    let failure: Error | undefined
    let recovering: Array<StartupRow> | undefined
    const latest = () => {
      const session = sessions.at(-1)
      if (!session) throw new Error(`RxDB gate adapter did not subscribe`)
      return session
    }
    const propagate = async () => {
      for (let count = 0; count < 5; count++) await turn()
    }
    const replace = async (next: Array<StartupRow>) => {
      const docs = await rows.find().exec()
      const deleted = await rows.bulkRemove(docs.map((doc) => doc.id))
      const inserted = await rows.bulkInsert(next)
      if (deleted.error.length || inserted.error.length)
        throw new Error(`RxDB gate source replacement failed`)
    }
    const deliver = async (next: Array<StartupRow>) => {
      await replace(next)
      latest().gate.resolve()
      await propagate()
    }
    return {
      options: (id) => {
        const rxCollection = {
          schema: rows.schema,
          storageInstance: {
            schema: rows.storageInstance.schema,
            query: async (
              prepared: Parameters<typeof rows.storageInstance.query>[0],
            ) => {
              const session = latest()
              if (!session.firstQuery) {
                session.firstQuery = true
                await session.gate.promise
              }
              return rows.storageInstance.query(prepared)
            },
          },
          $: new Observable<RxChangeEvent<StartupRow>>((subscriber) => {
            const session = { gate: gate(), subscriber, firstQuery: false }
            sessions.push(session)
            const actual = rows.$.subscribe(subscriber)
            return () => actual.unsubscribe()
          }),
        } as unknown as RxCollection<StartupRow>
        return rxdbCollectionOptions({
          id,
          rxCollection,
          syncMode: `eager`,
          syncBatchSize: 1,
        })
      },
      hold: () => {},
      deliver,
      reject: async (message) => {
        const session = latest()
        if (!session.firstQuery)
          throw new Error(`RxDB gate storage query was not entered`)
        failure = new Error(message)
        failures++
        if (source === `query`) session.gate.reject(failure)
        else {
          session.subscriber.error(failure)
          session.gate.resolve()
        }
        await propagate()
      },
      propagate: async () => {
        if (recovering) {
          const next = recovering
          recovering = undefined
          await deliver(next)
        }
        await propagate()
      },
      terminalEntries: () => failures,
      prepareRecovery: async (next) => {
        recovering = next
        await propagate()
      },
      matchesFailure: (error, message) =>
        error === failure && failure?.message === message,
      dispose: async () => {
        sessions.forEach((session) => session.gate.resolve())
        await database.remove()
      },
    }
  },
}
