import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { evaluateReferenceExpression } from '../reference-expression.js'
import { flushPromises } from '../utils.js'
import type { LoadSubsetOptions, SyncConfig } from '../../src/types.js'

type Row = { id: number; rank: number }

async function setup(
  indexed: boolean,
  multi: boolean,
  evict = false,
  syncFailure = false,
) {
  const truth = Array.from({ length: 20 }, (_, id) => ({
    id: id + 1,
    rank: id + 1,
  }))
  const installed = new Map<number, Row>()
  const calls: Array<LoadSubsetOptions> = []
  const active = new Set<LoadSubsetOptions>()
  const owned = new Map<LoadSubsetOptions, Set<number>>()
  let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
  let failFull = 0
  const failure = new Error(`transient full-source failure`)
  const source = createCollection<Row, number>({
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    ...(indexed
      ? { autoIndex: `eager` as const, defaultIndexType: BTreeIndex }
      : {}),
    sync: {
      sync: (operations) => {
        sync = operations
        sync.markReady()
        return {
          loadSubset: (options) => {
            calls.push(options)
            if (failFull && !options.orderBy && !options.where) {
              failFull--
              if (syncFailure) throw failure
              active.add(options)
              return Promise.reject(failure)
            }
            active.add(options)
            const rows = truth
              .filter(
                (row) =>
                  (!options.where ||
                    evaluateReferenceExpression(options.where, row) === true) &&
                  (!options.cursor ||
                    evaluateReferenceExpression(
                      options.cursor.whereFrom,
                      row,
                    ) === true),
              )
              .sort((a, b) => a.rank - b.rank || a.id - b.id)
            const offset = options.cursor ? 0 : (options.offset ?? 0)
            const selected = rows.slice(
              offset,
              options.limit === undefined ? undefined : offset + options.limit,
            )
            owned.set(options, new Set(selected.map((row) => row.id)))
            sync.begin()
            for (const row of selected) {
              if (installed.get(row.id) === row) continue
              sync.write({
                type: installed.has(row.id) ? `update` : `insert`,
                value: row,
              })
              installed.set(row.id, row)
            }
            return Promise.resolve(sync.commit()).then(() => {})
          },
          unloadSubset: (options) => {
            expect(active.delete(options)).toBe(true)
            const released = owned.get(options)
            owned.delete(options)
            if (!evict || !released) return
            sync.begin()
            for (const id of released) {
              const row = installed.get(id)
              if (row && ![...owned.values()].some((keys) => keys.has(id))) {
                installed.delete(id)
                sync.write({ type: `delete`, value: row })
              }
            }
            void sync.commit()
          },
        }
      },
    },
  })
  const createQuery = () =>
    createLiveQueryCollection((q) => {
      const sorted = q.from({ row: source }).orderBy(({ row }) => row.rank)
      return (multi ? sorted.orderBy(({ row }) => row.id) : sorted)
        .limit(2)
        .select(({ row }) => ({ id: row.id, rank: row.rank }))
    })
  const live = createQuery()
  await live.preload()
  return {
    live,
    createQuery,
    source,
    calls,
    active,
    failure,
    failNextFull: (count = 1) => {
      failFull = count
    },
    insert: (row: Row) => {
      truth.push(row)
      installed.set(row.id, row)
      sync.begin()
      sync.write({ type: `insert`, value: row })
      return sync.commit()
    },
    remove: (id: number) => {
      const index = truth.findIndex((row) => row.id === id)
      const [row] = truth.splice(index, 1)
      installed.delete(id)
      sync.begin()
      sync.write({ type: `delete`, value: row! })
      return sync.commit()
    },
    cleanup: async () => {
      await live.cleanup()
      await source.cleanup()
    },
  }
}

describe(`Ordered source work across default and indexed plans`, () => {
  it.each(
    [false, true].flatMap((indexed) =>
      [false, true].map((multi) => ({ indexed, multi })),
    ),
  )(
    `does not reacquire a full window for out-of-window inserts: %j`,
    async ({ indexed, multi }) => {
      const h = await setup(indexed, multi)
      try {
        const calls = h.calls.length
        const active = h.active.size
        for (let id = 100; id < 103; id++) {
          await h.insert({ id, rank: id })
          await flushPromises()
        }
        expect(h.live.toArray.map((row) => row.id)).toEqual([1, 2])
        expect.soft(h.calls.length - calls).toBe(0)
        expect(h.active.size).toBe(active)
      } finally {
        await h.cleanup()
      }
    },
  )

  it.each(
    [false, true].flatMap((multi) =>
      [false, true].map((peer) => ({ multi, peer })),
    ),
  )(
    `retires a replaced prefix without evicting current or peer rows: %j`,
    async ({ multi, peer }) => {
      const h = await setup(false, multi, true)
      const other = peer ? h.createQuery() : undefined
      try {
        await other?.preload()
        for (const limit of [3, 4, 5]) await h.live.utils.setWindow({ limit })
        expect(h.live.toArray.map((row) => row.id)).toEqual([1, 2, 3, 4, 5])
        expect([...h.active].filter((options) => options.orderBy)).toHaveLength(
          peer ? 2 : 1,
        )
        if (other) expect(other.toArray.map((row) => row.id)).toEqual([1, 2])
      } finally {
        await other?.cleanup()
        await h.cleanup()
      }
    },
  )

  it.each(
    [`success`, `exhausted`, `cleanup`].flatMap((outcome) =>
      [false, true].map((syncFailure) => ({ outcome, syncFailure })),
    ),
  )(
    `bounds automatic repair with stale rows retained: %j`,
    async ({ outcome, syncFailure }) => {
      const h = await setup(true, false, false, syncFailure)
      vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`] })
      try {
        h.failNextFull(outcome === `success` ? 1 : 3)
        await h.remove(1)
        await vi.advanceTimersByTimeAsync(0)
        const afterFailure = h.calls.length
        expect(h.live.utils.lastSubsetError).toBe(h.failure)
        expect(h.live.status).toBe(`ready`)
        expect(h.live.toArray.map((row) => row.id)).toEqual([1, 2])
        if (outcome === `cleanup`) await h.live.cleanup()
        await vi.advanceTimersByTimeAsync(249)
        expect(h.calls).toHaveLength(afterFailure)
        await vi.advanceTimersByTimeAsync(751)
        expect(h.calls.length - afterFailure).toBe(
          outcome === `cleanup` ? 0 : outcome === `success` ? 1 : 2,
        )
        if (outcome === `cleanup`) return
        expect(h.live.status).toBe(`ready`)
        expect(h.live.toArray.map((row) => row.id)).toEqual(
          outcome === `success` ? [2, 3] : [1, 2],
        )
        const settledCalls = h.calls.length
        await h.insert({ id: 50, rank: 0 })
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(10000)
        expect(h.calls).toHaveLength(settledCalls)
        if (outcome === `exhausted`) {
          expect(h.live.toArray.map((row) => row.id)).toEqual([1, 2])
          await h.live.utils.setWindow({ limit: 2 })
        }
        expect(h.live.toArray.map((row) => row.id)).toEqual([50, 2])
      } finally {
        await h.cleanup()
        vi.useRealTimers()
      }
    },
  )
})
