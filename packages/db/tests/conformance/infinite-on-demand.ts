import { createFilterFunctionFromExpression } from '../../src/collection/change-events.js'
import type { Collection, LoadSubsetOptions } from '../../src/index.js'

interface Runtime {
  BTreeIndex: unknown
  createCollection: <T extends object>(
    options: any,
  ) => Collection<T, string | number, any>
}

let sequence = 0

export function makeInfiniteOnDemandSource<
  T extends { id: string; rank: number },
>(runtime: Runtime, data: ReadonlyArray<T>, asyncDelay?: number) {
  const calls: Array<LoadSubsetOptions> = []
  const collection = runtime.createCollection<T>({
    id: `infinite-conformance-on-demand-${sequence++}`,
    getKey: (row: T) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: runtime.BTreeIndex,
    sync: {
      sync: ({ markReady, begin, write, commit }: any) => {
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            calls.push({ ...options })
            let requested = [...data].sort((a, b) => b.rank - a.rank)
            if (options.cursor) {
              const filter = createFilterFunctionFromExpression(
                options.cursor.whereFrom,
              )
              requested = requested.filter(filter)
            }
            if (options.limit !== undefined) {
              requested = requested.slice(0, options.limit)
            }

            const load = () => {
              begin()
              for (const row of requested) write({ type: `insert`, value: row })
              commit()
            }
            if (asyncDelay === undefined) {
              load()
              return true
            }
            return new Promise<void>((resolve) => {
              setTimeout(() => {
                load()
                resolve()
              }, asyncDelay)
            })
          },
        }
      },
    },
  })
  return { collection, calls }
}
