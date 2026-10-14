import type { Collection } from '@tanstack/db'
import type { HealthSourceHandle } from './contract'

/**
 * Builds the `HealthSourceHandle` fixture from the adapter's own
 * `createCollection`, so the Collection lives in the adapter's realm. Every
 * driver uses this one fixture, so the five bindings face the same sync
 * adapter reports.
 */
export function makeHealthSource<T extends { id: string }>(
  createCollection: (options: any) => Collection<any, any, any>,
  id: string,
  initialData: ReadonlyArray<T>,
): HealthSourceHandle<T> {
  let controls:
    | {
        begin: () => void
        write: (message: { type: string; value: T }) => void
        commit: () => void
        markReady: () => void
        reportError: (error: unknown, options?: { final?: boolean }) => void
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
    reportError: (error, options) => controls!.reportError(error, options),
    reportHealthy: () => controls!.reportHealthy(),
  }
}
