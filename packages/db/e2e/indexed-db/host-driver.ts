/** Shared production driver for real pages and dedicated workers. Expected
 * rows stay in host-oracle.spec.ts. Native events and storage supply all premises.
 */
import {
  createCollection,
  createIndexedDB,
  indexedDBCollectionOptions,
} from '@tanstack/db'

export type HostRow = { id: string | number; name: string }
export type HostCommand =
  | { type: 'insert'; store: string; rows: Array<HostRow> }
  | { type: 'import'; store: string; rows: Array<HostRow> }
  | { type: 'update'; store: string; key: string | number; name: string }
  | { type: 'clear'; store: string }
  | { type: 'observe' }
  | { type: 'status' }
  | { type: 'close' }
  | { type: 'cleanup' }
export type HostSetup = { database: string; stores: Array<string> }
function rows(values: Iterable<HostRow>) {
  return [...values]
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => JSON.stringify(a.id).localeCompare(JSON.stringify(b.id)))
}
export async function createHost({ database, stores }: HostSetup) {
  const descriptor = await createIndexedDB({
    name: database,
    stores,
    version: 1,
  })
  let nativeClose = 0
  descriptor.db.addEventListener('close', () => {
    nativeClose++
  })
  const collections = new Map(
    stores.map((name) => [
      name,
      createCollection(
        indexedDBCollectionOptions<HostRow>({
          db: descriptor,
          name,
          getKey: (row) => row.id,
        }),
      ),
    ]),
  )
  async function dispose() {
    const results = await Promise.allSettled(
      [...collections.values()].map((c) => c.cleanup()),
    )
    descriptor.close()
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : [],
    )
    if (failures.length)
      throw new AggregateError(failures, 'host cleanup failed')
  }
  try {
    await Promise.all([...collections.values()].map((c) => c.preload()))
  } catch (error) {
    try {
      await dispose()
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'host setup and cleanup failed',
        { cause: error },
      )
    }
    throw error
  }
  async function raw(store: string) {
    const tx = descriptor.db.transaction(store)
    const request = tx.objectStore(store).getAll()
    return new Promise<Array<HostRow>>((resolve, reject) => {
      tx.oncomplete = () => resolve(request.result)
      tx.onabort = () => reject(tx.error)
    })
  }
  return async (command: HostCommand) => {
    if (command.type === 'cleanup') {
      await dispose()
      return
    }
    if (command.type === 'close') {
      descriptor.close()
      return
    }
    if (command.type === 'status')
      return {
        nativeClose,
        collections: [...collections].map(([store, c]) => ({
          store,
          status: c.status,
          rows: rows(c.values()),
        })),
      }
    if (command.type === 'observe')
      return Promise.all(
        [...collections].map(async ([store, c]) => ({
          store,
          status: c.status,
          rows: rows(c.values()),
          durable: rows(await raw(store)),
          exported: rows(await c.utils.exportData()),
        })),
      )
    const c = collections.get(command.store)!
    if (command.type === 'insert')
      await c.insert(command.rows).isPersisted.promise
    else if (command.type === 'import') await c.utils.importData(command.rows)
    else if (command.type === 'clear') await c.utils.clearObjectStore()
    else
      await c.update(command.key, (draft) => {
        draft.name = command.name
      }).isPersisted.promise
    return undefined
  }
}
