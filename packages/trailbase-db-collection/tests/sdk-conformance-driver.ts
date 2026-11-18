/** Real SDK receiver for the unchanged eager source model and checker. */
import { createCollection } from '@tanstack/db'
import {
  fromSqlRow,
  jsonValueKinds,
  observedView,
  toSqlRow,
} from '../../db-adapter-conformance/src'
import { trailBaseCollectionOptions } from '../src/trailbase'
import { TrailBaseSdkService, untilSdk } from './sdk-service'
import type {
  ConformanceRow,
  EagerLiveSourceDriver,
} from '../../db-adapter-conformance/src'

type Row = { id: number; title: string; note: string | null; value: unknown }
const record = (row: ConformanceRow) => toSqlRow(row) as Row

export function trailBaseSdkConformanceDriver(): EagerLiveSourceDriver {
  return {
    adapter: `@tanstack/trailbase-db-collection (real SDK HTTP/SSE)`,
    capabilities: new Set([
      `duplicate-key-delivery`,
      `source-failure-after-ready`,
    ]),
    changeCommits: `per-change`,
    duplicateInsert: `replace`,
    valueKinds: jsonValueKinds,
    create() {
      const service = new TrailBaseSdkService<Row>()
      service.holdLists = true
      const answered = new Set<number>()
      const currentList = () =>
        service.lists.findIndex(
          (list, index) =>
            !answered.has(index) &&
            list.subscription === service.streams.length,
        )
      const rows = new Map<number, Row>()
      const collection = createCollection(
        trailBaseCollectionOptions({
          recordApi: service.api,
          getKey: (row: Row) => row.id,
          parse: {},
          serialize: {},
        }),
      )
      return {
        collection: observedView(collection, {
          row: fromSqlRow,
          key: (key) => key as number,
        }),
        provider: {
          // Erroring the native HTTP body releases its lock without calling
          // cancel. Normal cleanup propagates one cancellation through SDK SSE.
          releases: () =>
            service.streams.map((stream) =>
              Math.max(
                stream.cancellations,
                stream.ended && !stream.body.locked ? 1 : 0,
              ),
            ),
          deliverSnapshot: async (input) => {
            await untilSdk(() => currentList() >= 0, `eager list requested`)
            rows.clear()
            for (const row of input) rows.set(row.id, record(row))
            const index = currentList()
            answered.add(index)
            service.lists[index]!.resolve(input.map(record))
          },
          deliverChanges: (changes) => {
            for (const change of changes) {
              if (change.type === `upsert`) {
                const held = rows.has(change.row.id)
                const row = record(change.row)
                rows.set(row.id, row)
                service.emit(held ? { Update: row } : { Insert: row })
              } else {
                const row = rows.get(change.id)
                if (!row) throw new Error(`Service does not hold ${change.id}`)
                rows.delete(change.id)
                service.emit({ Delete: row })
              }
            }
          },
          fail: (error) => {
            const index = currentList()
            if (index >= 0) {
              answered.add(index)
              service.lists[index]!.reject(error)
            } else service.fail(error)
          },
        },
        settle: () => service.propagate(),
        dispose: () => service.dispose(),
      }
    },
  }
}
