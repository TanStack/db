import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { evaluateReferenceExpression } from '../reference-expression.js'
import { flushPromises } from '../utils.js'
import type { LoadSubsetOptions, SyncConfig } from '../../src/types.js'

type Row = { id: number; rank: number }

describe(`Ordered demand retirement`, () => {
  it.each([false, true])(
    `replays only authoritative demand after repair, with peer=%s`,
    async (withPeer) => {
      const truth: Array<Row> = [1, 2, 3, 4].map((id) => ({ id, rank: id }))
      const active = new Set<LoadSubsetOptions>()
      const calls: Array<LoadSubsetOptions> = []
      const installed = new Map<number, Row>()
      let transferred = 0
      let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
      const source = createCollection<Row, number>({
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: (operations) => {
            sync = operations
            sync.markReady()
            return {
              loadSubset: async (options) => {
                active.add(options)
                calls.push(options)
                await Promise.resolve()
                if (options.signal?.aborted) return
                const rows = truth
                  .filter(
                    (row) =>
                      (!options.where ||
                        evaluateReferenceExpression(options.where, row) ===
                          true) &&
                      (!options.cursor ||
                        evaluateReferenceExpression(
                          options.cursor.whereFrom,
                          row,
                        ) === true),
                  )
                  .sort((a, b) => a.rank - b.rank)
                const offset = options.cursor ? 0 : (options.offset ?? 0)
                const selected = rows.slice(
                  offset,
                  options.limit === undefined
                    ? undefined
                    : offset + options.limit,
                )
                transferred += selected.length
                sync.begin()
                for (const value of selected) {
                  if (installed.get(value.id) === value) continue
                  sync.write({
                    type: installed.has(value.id) ? `update` : `insert`,
                    value,
                  })
                  installed.set(value.id, value)
                }
                await sync.commit()
              },
              unloadSubset: (options) => {
                expect(active.delete(options)).toBe(true)
              },
            }
          },
        },
      })
      const query = () =>
        createLiveQueryCollection((q) =>
          q
            .from({ row: source })
            .orderBy(({ row }) => row.rank)
            .limit(2)
            .select(({ row }) => ({ id: row.id, rank: row.rank })),
        )
      const live = query()
      const peer = withPeer ? query() : undefined
      try {
        await live.preload()
        await peer?.preload()
        const owners = withPeer ? 2 : 1
        expect(active.size).toBe(owners * 2)
        truth[0] = { id: 1, rank: 10 }
        installed.set(1, truth[0])
        sync.begin()
        sync.write({ type: `update`, value: truth[0] })
        await sync.commit()
        await flushPromises()
        expect(live.toArray.map((row) => row.id)).toEqual([2, 3])
        expect.soft(active.size).toBe(owners)
        expect
          .soft(
            [...active].every((options) => !options.orderBy && !options.where),
          )
          .toBe(true)

        const beforeCalls = calls.length
        const beforeRows = transferred
        installed.clear()
        sync.begin()
        sync.truncate()
        await sync.commit()
        await flushPromises()
        expect.soft(calls.length - beforeCalls).toBe(owners)
        expect.soft(transferred - beforeRows).toBe(owners * truth.length)
        expect(live.toArray.map((row) => row.id)).toEqual([2, 3])
        expect(live.isReady()).toBe(true)
        await live.cleanup()
        expect.soft(active.size).toBe(withPeer ? 1 : 0)
        if (peer) {
          expect(peer.toArray.map((row) => row.id)).toEqual([2, 3])
          expect(peer.isReady()).toBe(true)
        }
      } finally {
        await live.cleanup()
        await peer?.cleanup()
        await source.cleanup()
      }
    },
  )
})
