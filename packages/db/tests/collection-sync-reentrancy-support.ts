// Shared helpers for the oracle file and the ordinary tests moved from it.
import { createCollection } from '../src/collection/index.js'
import type { SyncConfig } from '../src/types.js'

export type Row = {
  id: number
  value: string
}
export type SyncOps = Parameters<SyncConfig<Row, number>[`sync`]>[0]
export type OrderedRow = Row & { rank: number }
export type OrderedSync = Parameters<SyncConfig<OrderedRow, number>[`sync`]>[0]
export type LayoutCallback = {
  changes: Array<number>
  keys: Array<number>
  values: Array<string>
  markedReceiptSettled: boolean
  revision: number
}
export function createSyncHarness(id: string) {
  let sync!: SyncOps
  const collection = createCollection<Row, number>({
    id,
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: (ops) => {
        sync = ops
        ops.markReady()
      },
    },
  })

  return {
    collection,
    get sync() {
      return sync
    },
  }
}
export function stageInsert(sync: SyncOps, row: Row): void {
  sync.begin()
  sync.write({ type: `insert`, value: row })
}
export function installInitialOrderedRows(sync: OrderedSync): void {
  sync.begin()
  sync.write({
    type: `insert`,
    value: { id: 1, value: `one`, rank: 0 },
  })
  sync.write({
    type: `insert`,
    value: { id: 2, value: `two`, rank: 1 },
  })
  sync.commit()
  sync.markReady()
}
