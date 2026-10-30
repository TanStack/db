import type { Collection } from '@tanstack/db'
import type { LaggingSourceHandle } from './contract'

/**
 * Builds the `LaggingSourceHandle` fixture from the adapter's own
 * `createCollection`, so the Collection lives in the adapter's realm. Every
 * driver uses this one fixture, so the five bindings face the same source
 * history.
 */
export function makeLaggingSource<T extends { id: string }>(
  createCollection: (options: any) => Collection<any, any, any>,
  id: string,
): LaggingSourceHandle<T> {
  const pendingLoads: Array<() => void> = []
  let controls:
    | {
        begin: () => void
        write: (message: { type: string; value: T }) => void
        commit: () => void
        markReady: () => void
      }
    | undefined
  const collection = createCollection({
    id,
    getKey: (row: T) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }: any) => {
        controls = { begin, write, commit, markReady }
        return {
          loadSubset: () =>
            new Promise<void>((resolve) => {
              pendingLoads.push(resolve)
            }),
        }
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
    emit: (rows) => writeRows(`insert`, rows),
    markReady: () => controls!.markReady(),
    loadStarted: () => pendingLoads.length > 0,
    settleNext: () => pendingLoads.shift()?.(),
    settle: () => pendingLoads.splice(0).forEach((resolve) => resolve()),
  }
}
