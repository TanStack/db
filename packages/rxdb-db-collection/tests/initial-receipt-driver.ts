/**
 * Real RxDB memory storage supplies the initial result. An actual persisting
 * optimistic transaction holds the core applied receipt. Cleanup cancels that
 * receipt; the receiving host records detached errors after task boundaries.
 * The shared receipt owner supplies all expectations, in Node and Chromium.
 */
import { createCollection, createTransaction } from '@tanstack/db'
import { createRxDatabase } from 'rxdb/plugins/core'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { rxdbCollectionOptions } from '../src/rxdb'
import { startupRows } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { retainOracleCleanupObservation } from '../../db/tests/oracle-cleanup'
import type { RxCollection } from 'rxdb/plugins/core'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import type {
  InitialReceiptHistory,
  InitialReceiptObservation,
} from '../../powersync-direct-collection/tests/initial-receipt-oracle'

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
export const rxdbReceiptTurn = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0))

let sequence = 0
export async function observeRxdbInitialReceipt(
  history: InitialReceiptHistory,
  detachedErrors: Array<string>,
  teardownFault: boolean | `detached` = false,
): Promise<InitialReceiptObservation> {
  const database = await createRxDatabase<{ rows: RxCollection<StartupRow> }>({
    name: `rxdbreceipt${sequence++}`,
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
  const inserted = await rows.bulkInsert(startupRows(history.rows, 2))
  if (inserted.error.length)
    throw new Error(`RxDB receipt source insert failed`)
  const queried = gate()
  const deliver = gate()
  const persist = gate()
  const storageQuery = rows.storageInstance.query.bind(rows.storageInstance)
  let first = true
  rows.storageInstance.query = async (prepared) => {
    if (first) {
      first = false
      queried.resolve()
      await deliver.promise
    }
    return storageQuery(prepared)
  }
  const options = rxdbCollectionOptions({
    id: `rxdb-receipt-${sequence}`,
    rxCollection: rows,
    syncMode: `eager`,
    syncBatchSize: 1,
  })
  const sync = options.sync.sync
  const committed = gate()
  let receiptCreated = false
  let receiptPending = false
  let receiptApplied = false
  let receiptRejected = false
  options.sync.sync = (params) =>
    sync({
      ...params,
      commit: (signal) => {
        const receipt = params.commit(signal)
        receiptCreated = receipt !== true
        receiptPending = receipt !== true
        if (receipt !== true)
          void receipt.then(
            () => {
              receiptPending = false
              receiptApplied = true
            },
            () => {
              receiptPending = false
              receiptRejected = true
            },
          )
        committed.resolve()
        return receipt
      },
    })
  const collection = createCollection(options)
  const preload = collection.preload().catch(() => {})
  const transaction = createTransaction({ mutationFn: () => persist.promise })
  const completed =
    await retainOracleCleanupObservation<InitialReceiptObservation>(async () => {
      await queried.promise
      transaction.mutate(() =>
        collection.insert({ id: `local`, value: history.reason }),
      )
      deliver.resolve()
      await committed.promise
      // Promise continuations reach the adapter's await before either schedule.
      await rxdbReceiptTurn()
      if (history.cleanupAt === `after-application`) {
        persist.resolve()
        await transaction.when(`settled`)
        await preload
      }
      const receiptPendingAtCleanup = receiptPending
      const receiptAppliedBeforeCleanup = receiptApplied
      await collection.cleanup()
      for (let turn = 0; turn < 8; turn++) await rxdbReceiptTurn()
      return {
        receiptCreated,
        receiptPendingAtCleanup,
        receiptAppliedBeforeCleanup,
        receiptRejected,
        finalStatus: collection.status,
        finalRows: collection.toArray,
        detachedErrors,
      }
    }, [
      () => deliver.resolve(),
      () => persist.resolve(),
      () => transaction.when(`settled`).catch(() => {}),
      () => collection.cleanup(),
      async () => {
        await database.remove()
        if (teardownFault === `detached`)
          void Promise.reject(
            new Error(`Injected detached error after RxDB removal`),
          )
        else if (teardownFault)
          throw new Error(`Injected RxDB receipt removal failure`)
      },
    ])
  // Teardown can itself schedule rejected continuations. Keep the host
  // recorder active through teardown and its native rejection-event turns.
  for (let turn = 0; turn < 8; turn++) await rxdbReceiptTurn()
  return { ...completed, detachedErrors: [...detachedErrors] }
}
