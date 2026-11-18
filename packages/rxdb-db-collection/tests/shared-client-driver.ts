/**
 * Two source Collections read the same real installed RxCollection. Their
 * first query responses can wait independently, but all returned documents
 * and later events come from RxDB's memory storage and actual change stream.
 * Only resource acquisition/release and public snapshots are recorded here.
 */
import { createCollection } from '@tanstack/db'
import { createRxDatabase } from 'rxdb/plugins/core'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { Observable } from 'rxjs'
import { retainOracleCleanupObservation } from '../../db/tests/oracle-cleanup'
import { startupRows } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { rxdbCollectionOptions } from '../src/rxdb'
import type { RxChangeEvent, RxCollection } from 'rxdb/plugins/core'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import type {
  RxdbSharedHistory,
  RxdbSharedObservation,
} from './shared-client-oracle'

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { resolve, promise }
}
let sequence = 0
export async function observeRxdbSharedClient(
  h: RxdbSharedHistory,
  id: string,
  teardownFault = false,
  changeObservation?: (raw: RxdbSharedObservation) => RxdbSharedObservation,
): Promise<RxdbSharedObservation> {
  const database = await createRxDatabase<{ rows: RxCollection<StartupRow> }>({
    name: `rxdbshared${sequence++}`,
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
          id: { type: `string`, maxLength: 30 },
          value: { type: `number` },
        },
        required: [`id`, `value`],
      },
    },
  })
  const initial = await rows.bulkInsert(startupRows(h.initial, 1))
  if (initial.error.length) throw new Error(`RxDB shared source insert failed`)
  const queries = [0, 0]
  const releases = [0, 0]
  const acquisitions = [0, 0]
  const delivered = [gate(), gate()]
  const queried = [gate(), gate()]
  const collections = [0, 1].map((owner) => {
    const rxCollection = {
      schema: rows.schema,
      storageInstance: {
        schema: rows.storageInstance.schema,
        query: async (
          prepared: Parameters<typeof rows.storageInstance.query>[0],
        ) => {
          queries[owner]!++
          queried[owner]!.resolve()
          await delivered[owner]!.promise
          return rows.storageInstance.query(prepared)
        },
      },
    }
    // Use the real RxDB Observable and its actual subscription teardown.
    const stream = new Observable<RxChangeEvent<StartupRow>>((subscriber) => {
      acquisitions[owner]!++
      const subscription = rows.$.subscribe(subscriber)
      return () => {
        releases[owner]!++
        subscription.unsubscribe()
      }
    })
    return createCollection(
      rxdbCollectionOptions({
        id: `${id}-${owner}`,
        rxCollection: {
          ...rxCollection,
          $: stream,
        } as unknown as RxCollection<StartupRow>,
        syncMode: `eager`,
        startSync: false,
        syncBatchSize: h.batchSize,
      }),
    )
  })
  const first = collections[0]!
  const second = collections[1]!
  // This row law compares authored fields. Collection attribution fields are
  // different for each wrapper and belong to the optimistic-origin owner.
  const ordered = (values: Iterable<StartupRow>) =>
    [...values]
      .map(({ id: key, value }) => ({ id: key, value }))
      .sort((a, b) => a.id.localeCompare(b.id))
  const snapshot = () => ({
    rows: collections.map((collection) => ordered(collection.values())),
    statuses: collections.map((collection) => collection.status),
  })
  return retainOracleCleanupObservation<RxdbSharedObservation>(async () => {
    const firstReady = first.preload()
    await queried[0]!.promise
    if (h.join === `after-ready`) {
      delivered[0]!.resolve()
      await firstReady
    }
    const secondReady = second.preload()
    await queried[1]!.promise
    const joined = snapshot()
    delivered.forEach((entry) => entry.resolve())
    await Promise.all([firstReady, secondReady])
    const both = snapshot()
    await collections[h.retire]!.cleanup()
    const retired = snapshot()
    const releasedAtRetirement = [...releases]
    const existing = await rows.find().exec()
    const removed = await rows.bulkRemove(existing.map((row) => row.id))
    if (removed.error.length)
      throw new Error(`RxDB shared source removal failed`)
    const changed = await rows.bulkInsert(startupRows(h.next, 2))
    if (changed.error.length) throw new Error(`RxDB shared later insert failed`)
    // RxDB emits its storage events before writes settle. Task turns allow
    // finite Collection continuations to apply them; actual rows are compared.
    for (let turn = 0; turn < 3; turn++)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const later = snapshot()
    await collections[1 - h.retire]!.cleanup()
    const raw: RxdbSharedObservation = {
      joined,
      both,
      retired,
      later,
      acquisitions: [...acquisitions],
      releasesAtRetirement: releasedAtRetirement,
      releasesAfterCleanup: [...releases],
      queries: [...queries],
      sourceBefore: initial.success.length,
      sourceAfter: changed.success.length,
    }
    return changeObservation ? changeObservation(raw) : raw
  }, [
    () => delivered.forEach((entry) => entry.resolve()),
    () => first.cleanup(),
    () => second.cleanup(),
    async () => {
      await database.remove()
      if (teardownFault) throw new Error(`Injected RxDB shared removal failure`)
    },
  ])
}
