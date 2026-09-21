import {
  BasicIndex,
  createCollection,
  createLiveQueryCollection,
} from '@tanstack/db'
import { describe, expect, it } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import { createLiveQueryWindowController } from '../../db/src/live-query-window-controller.js'
import { expectedWindow } from './cursor-pagination/model.js'
import { createNoPeekDemandModel } from './cursor-pagination/no-peek.js'
import { createFactTransport } from './cursor-pagination/no-peek-transport.js'
import type { Row } from './cursor-pagination/model.js'
import type { PrefixPublication } from './cursor-pagination/no-peek.js'

const scope = { group: undefined, descending: false }

/** Narrow bridge for one immutable source ordered by unique id. Facts are kept
 * outside production and admitted only after the real setWindow/preload gate.
 * This intentionally does not claim generic compiler eligibility or automatic
 * metadata-only notification support. */
function createGraphFixture(
  count: number,
  pageSize: number,
  hold = false,
  filtered = false,
) {
  const rows: Array<Row> = Array.from({ length: count }, (_, id) => ({
    id,
    rank: id,
    group: 0,
  }))
  const transport = createFactTransport(rows, pageSize, scope)
  const received = createDeferred<void>()
  const release = createDeferred<void>()
  let fact: PrefixPublication | undefined
  const loaded = new Set<number>()
  const source = createCollection<Row>({
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BasicIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: async (options) => {
            let batch: Array<Row>
            if (options.where) {
              const where = options.where
              if (
                where.type !== `func` ||
                where.name !== `eq` ||
                where.args[0]?.type !== `ref` ||
                where.args[0].path[0] !== `id` ||
                where.args[1]?.type !== `val`
              ) {
                throw new Error(`Unsupported probe filter`)
              }
              const id = where.args[1].value
              batch = rows.filter((row) => row.id === id)
            } else {
              // This endpoint uses offset as permitted by the source contract;
              // cursor hints are not substituted for the offset window.
              const offset = options.offset ?? 0
              const packet = await transport.read(
                offset + (options.limit ?? rows.length + 1),
              )
              if (offset === 0) fact = packet
              batch = packet.rows.slice(offset)
              received.resolve()
              if (hold) await release.promise
            }
            begin()
            for (const row of batch) {
              if (!loaded.has(row.id)) {
                write({ type: `insert`, value: row })
                loaded.add(row.id)
              }
            }
            await commit()
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection((q) => {
    const query = q
      .from({ row: source })
      .orderBy(({ row }) => row.id)
      .limit(1)
    return filtered ? query.fn.where(({ row }) => row.id < 3) : query
  })
  const windows: Array<number> = []
  const acquire = async (requested: number): Promise<PrefixPublication> => {
    windows.push(requested)
    const settled = live.utils.setWindow({ offset: 0, limit: requested })
    if (settled !== true) await settled
    await live.preload()
    const stamp = fact?.stamp ?? {}
    return {
      rows: live.toArray.map(({ id, rank, group }) => ({ id, rank, group })),
      requested,
      stamp,
      transparent: !filtered,
      fact: fact?.fact,
    }
  }
  return {
    rows,
    live,
    transport,
    acquire,
    windows,
    received,
    release,
    fact: () => fact,
    async cleanup() {
      release.resolve()
      await live.cleanup()
      await source.cleanup()
    },
  }
}

describe(`no-peek bridge at real graph publication`, () => {
  it.each([0, 3, 4, 9])(
    `matches peek-ahead output with %s remote rows`,
    async (count) => {
      const candidate = createGraphFixture(count, 3)
      const baseline = createGraphFixture(count, 3)
      const model = createNoPeekDemandModel(candidate.acquire)
      const controller = createLiveQueryWindowController(baseline.live, {
        pageSize: 3,
      })
      const unsubscribe = controller.subscribe(() => {})
      try {
        model.retainDemand(`a`, 3)
        await model.refresh()
        await controller.preload()
        expect(model.get(`a`)).toEqual(expectedWindow(candidate.rows, scope, 3))
        expect(controller.getSnapshot().hasNextPage).toBe(
          model.get(`a`)?.hasNextPage,
        )
        expect(controller.getSnapshot().data.map(({ id }) => id)).toEqual(
          model.get(`a`)?.rows.map(({ id }) => id),
        )
        expect(candidate.transport.requests[0]).toBe(3)
        expect(baseline.transport.requests[0]).toBe(4)
        expect(candidate.transport.backend.calls).toHaveLength(1)
        expect(baseline.transport.backend.calls).toHaveLength(count > 3 ? 2 : 1)
      } finally {
        unsubscribe()
        controller.dispose()
        await candidate.cleanup()
        await baseline.cleanup()
      }
    },
  )

  it(`holds continuation behind actual source and graph publication`, async () => {
    const fixture = createGraphFixture(9, 3, true)
    const model = createNoPeekDemandModel(fixture.acquire)
    model.retainDemand(`a`, 3)
    let notifications = 0
    model.subscribe(() => notifications++)
    const pending = model.refresh()
    const observed = pending.then(
      () => undefined,
      (error: unknown) => error,
    )
    try {
      await fixture.received.promise
      expect(fixture.fact()?.fact?.hasMore).toBe(true)
      expect(fixture.live.toArray).toEqual([])
      expect(model.get(`a`)).toBeUndefined()
      expect(notifications).toBe(0)
      fixture.release.resolve()
      expect(await observed).toBeUndefined()
      expect(model.get(`a`)).toEqual(expectedWindow(fixture.rows, scope, 3))
      expect(notifications).toBe(1)
    } finally {
      fixture.release.resolve()
      await observed
      await fixture.cleanup()
    }
  })

  it(`falls back for a local filter even though the order is unchanged`, async () => {
    const fixture = createGraphFixture(9, 3, false, true)
    const model = createNoPeekDemandModel(fixture.acquire, false)
    model.retainDemand(`a`, 3)
    try {
      const rawPrefix = await createFactTransport(fixture.rows, 3, scope).read(
        3,
      )
      expect(rawPrefix.fact?.hasMore).toBe(true)
      await model.refresh()
      expect(model.get(`a`)).toEqual(
        expectedWindow(
          fixture.rows.filter((row) => row.id < 3),
          scope,
          3,
        ),
      )
      expect(fixture.windows).toEqual([4])
      expect(model.get(`a`)?.hasNextPage).toBe(false)
      // An opaque local filter requires the existing full-source loading path.
      expect(fixture.transport.requests[0]).toBe(10)
    } finally {
      await fixture.cleanup()
    }
  })
})
