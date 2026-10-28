import type { Collection } from '@tanstack/db'
import type { SyncSourceHandle } from './contract'

/**
 * Builds the `SyncSourceHandle` fixture from the adapter's own
 * `createCollection`, so the Collection lives in the adapter's realm. Every
 * driver uses this one fixture, so the five bindings face the same sync
 * adapter reports.
 */
export function makeSyncSource<T extends { id: string }>(
  createCollection: (options: any) => Collection<any, any, any>,
  id: string,
  initialData: ReadonlyArray<T>,
): SyncSourceHandle<T> {
  let controls:
    | {
        begin: () => void
        write: (message: { type: string; value: T }) => void
        commit: () => void
        markReady: () => void
        fail: (error: unknown) => void
        reportError: (error: unknown) => void
        reportHealthy: () => void
      }
    | undefined
  const collection = createCollection({
    id,
    getKey: (row: T) => row.id,
    startSync: true,
    sync: {
      sync: (params: any) => {
        controls = params
        params.begin()
        initialData.forEach((value) => params.write({ type: `insert`, value }))
        params.commit()
        params.markReady()
      },
    },
  })
  const writeRows = (type: string, rows: ReadonlyArray<T>) => {
    controls!.begin()
    rows.forEach((value) => controls!.write({ type, value }))
    controls!.commit()
  }
  return {
    collection,
    insert: (row) => writeRows(`insert`, [row]),
    update: (row) => writeRows(`update`, [row]),
    remove: (row) => writeRows(`delete`, [row]),
    reportError: (error) => controls!.reportError(error),
    fail: (error) => controls!.fail(error),
    reportHealthy: () => controls!.reportHealthy(),
  }
}
