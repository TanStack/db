/**
 * Public Collection driver for the LocalStorage author-order law. This module
 * records outcomes, durable bytes and public/freshly restored rows; it owns no
 * expected result. Native browsers and custom Storage use this same loop.
 */
import { createCollection } from '../src/collection/index'
import { createDeferred } from '../src/deferred'
import { localStorageCollectionOptions } from '../src/local-storage'
import { retainOracleCleanupObservation } from './oracle-cleanup'
import type { StorageApi, StorageEventApi } from '../src/local-storage'
import type { Row } from './local-storage-fixtures'
import type { History } from './local-storage-write-order-oracle'

export const initial: Array<Row> = [
  { id: `a`, value: 0 },
  { id: `b`, value: 0 },
]
export const sortedRows = (values: Iterable<Row>) =>
  [...values]
    .map(({ id, value }) => ({ id, value }))
    .sort((a, b) => a.id.localeCompare(b.id))

function memoryStorage(): StorageApi {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
  }
}

function durableRows(storage: StorageApi, storageKey: string) {
  const raw = storage.getItem(storageKey)
  if (raw === null) return null
  const records = JSON.parse(raw) as Record<string, { data: Row }>
  return sortedRows(Object.values(records).map(({ data }) => data))
}

export async function driveLocalStorageWriteOrder(
  history: History,
  observe: (checkpoint: string, value: unknown) => void,
  storage: StorageApi = memoryStorage(),
  storageKey = `rows`,
  storageEventApi: StorageEventApi = {
    addEventListener() {},
    removeEventListener() {},
  },
) {
  const { writes, release, accepted } = history
  storage.setItem(
    storageKey,
    JSON.stringify(
      Object.fromEntries(
        initial.map((row) => [
          `s:${row.id}`,
          { versionKey: `initial-${row.id}`, data: row },
        ]),
      ),
    ),
  )
  const gates = writes.map(() => createDeferred<void>())
  const entered = writes.map(() => createDeferred<void>())
  // An update names itself by the value it authored. A delete names itself by
  // its key: a legal history deletes a key at most once.
  const deletes = new Map<string, number>(
    writes.flatMap((write, index) =>
      write.kind === `delete` ? [[write.id, index] as const] : [],
    ),
  )
  const hold = (index: number) => {
    entered[index]!.resolve()
    return gates[index]!.promise
  }
  type Mutations = { mutations: Array<{ modified: Row; original: Row }> }
  const makeCollection = (withHandlers: boolean) =>
    createCollection(
      localStorageCollectionOptions<Row>({
        storageKey,
        storage,
        storageEventApi,
        getKey: (row) => row.id,
        ...(withHandlers
          ? {
              onUpdate: ({ transaction }: { transaction: Mutations }) =>
                hold(transaction.mutations[0]!.modified.value - 1),
              onDelete: ({ transaction }: { transaction: Mutations }) =>
                hold(deletes.get(transaction.mutations[0]!.original.id)!),
            }
          : {}),
      }),
    )
  const collection = makeCollection(true)
  let reopened: ReturnType<typeof makeCollection> | undefined
  const completed = await retainOracleCleanupObservation(async () => {
    await collection.preload()
    const transactions = writes.map((write, index) =>
      write.kind === `update`
        ? collection.update(write.id, (draft) => {
            draft.value = index + 1
          })
        : collection.delete(write.id),
    )
    const settled = writes.map(() => false)
    const outcomes = transactions.map((transaction, index) =>
      transaction.when(`settled`).then(
        () => ((settled[index] = true), true),
        () => ((settled[index] = true), false),
      ),
    )
    await Promise.all(entered.map((item) => item.promise))
    for (const [step, index] of release.entries()) {
      if (accepted[index]) gates[index]!.resolve()
      else gates[index]!.reject(new Error(`handler ${index} rejected`))
      await Promise.resolve()
      await Promise.resolve()
      observe(`held after release ${step + 1}`, {
        released: release.slice(0, step + 1),
        settled: [...settled],
        durable: durableRows(storage, storageKey),
      })
    }
    observe(`settled`, {
      outcomes: await Promise.all(outcomes),
      durable: durableRows(storage, storageKey),
      public: sortedRows(collection.values()),
    })
    reopened = makeCollection(false)
    await reopened.preload()
    observe(`fresh restore`, sortedRows(reopened.values()))
    return { cleanupErrors: [] as Array<string> }
  }, [
    () => gates.forEach((gate) => gate.resolve()),
    () => reopened?.cleanup(),
    () => collection.cleanup(),
    () => storage.removeItem(storageKey),
  ])
  observe(`cleanup errors`, completed.cleanupErrors)
}

/** The browser transports these completed observations after teardown. */
export async function collectLocalStorageWriteOrder(
  history: History,
  storage: StorageApi,
  storageKey: string,
  storageEventApi: StorageEventApi,
) {
  const observations: Array<{ checkpoint: string; value: unknown }> = []
  await driveLocalStorageWriteOrder(
    history,
    (checkpoint, value) => observations.push({ checkpoint, value }),
    storage,
    storageKey,
    storageEventApi,
  )
  return { observations }
}
