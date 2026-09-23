import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { createDeferred } from '../../db/src/deferred.js'
import { oraclePropertyOptions } from '../../db/tests/oracle-config.js'
import { expectedWindow } from './cursor-pagination/model.js'
import { createNoPeekDemandModel } from './cursor-pagination/no-peek.js'
import { createFactTransport } from './cursor-pagination/no-peek-transport.js'
import type { Row, Scope } from './cursor-pagination/model.js'

const scope: Scope = { group: undefined, descending: false }
const rowsOf = (count: number): Array<Row> =>
  Array.from({ length: count }, (_, id) => ({
    id,
    rank: Math.floor(id / 3),
    group: id % 2,
  }))

/** Transport sees only opaque pages. In these protocol tests its completion is
 * also the synthetic publication boundary; the production probe is separate. */
function createTransport(rows: Array<Row>, size: number, selected = scope) {
  return createFactTransport(rows, size, selected)
}

describe(`experimental publication-bound no-peek pagination`, () => {
  it(`keeps shallow continuation after a deeper consumer reaches the end`, async () => {
    const rows = rowsOf(9)
    const transport = createTransport(rows, 3)
    const model = createNoPeekDemandModel(transport.read)
    model.retainDemand(`shallow`, 3)
    model.retainDemand(`deep`, 10)
    await model.refresh()
    expect(model.get(`shallow`)).toEqual(expectedWindow(rows, scope, 3))
    expect(model.get(`deep`)).toEqual(expectedWindow(rows, scope, 10))
    model.retireDemand(`deep`)
    await model.refresh()
    expect(model.get(`shallow`)).toEqual(expectedWindow(rows, scope, 3))
  })

  it.each([
    `missing`,
    `foreign-stamp`,
    `wrong-boundary`,
    `transformed`,
  ] as const)(
    `acquires and retains a peek witness for %s facts`,
    async (fault) => {
      const rows = rowsOf(9)
      const transport = createTransport(rows, 3)
      const model = createNoPeekDemandModel(async (limit) => {
        const packet = await transport.read(limit)
        if (fault === `missing`) delete packet.fact
        if (fault === `foreign-stamp`) packet.fact!.stamp = {}
        if (fault === `wrong-boundary`) packet.fact!.end++
        if (fault === `transformed`) packet.transparent = false
        return packet
      })
      model.retainDemand(`a`, 3)
      await model.refresh()
      expect(model.get(`a`)).toEqual(expectedWindow(rows, scope, 3))
      expect(transport.requests).toEqual([3, 4])
      model.retainDemand(`b`, 10)
      await model.refresh()
      model.retireDemand(`b`)
      await model.refresh()
      expect(transport.requests.at(-1)).toBe(4)
      expect(model.get(`a`)).toEqual(expectedWindow(rows, scope, 3))
    },
  )

  it(`agrees with full-relation truth across scopes, peers, demand retirement and repartition`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 35 }),
        fc.integer({ min: 1, max: 9 }),
        fc.record({
          descending: fc.boolean(),
          group: fc.option(fc.integer({ min: 0, max: 1 }), { nil: undefined }),
        }),
        fc.array(
          fc.record({
            id: fc.constantFrom(`a`, `b`, `c`),
            count: fc.integer({ min: 1, max: 40 }),
            release: fc.boolean(),
            metadata: fc.boolean(),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        async (count, size, selected, history) => {
          const rows = rowsOf(count)
          const transport = createTransport(rows, size, selected)
          let metadata = true
          const model = createNoPeekDemandModel(async (limit) => {
            const packet = await transport.read(limit)
            if (!metadata) delete packet.fact
            return packet
          })
          const windows = new Map<string, number>()
          model.subscribe(() => {
            for (const [id, n] of windows)
              expect(model.get(id)).toEqual(expectedWindow(rows, selected, n))
          })
          for (const action of history) {
            metadata = action.metadata
            if (action.release) {
              model.retireDemand(action.id)
              windows.delete(action.id)
            } else {
              model.retainDemand(action.id, action.count)
              windows.set(action.id, action.count)
            }
            await model.refresh()
            for (const [id, n] of windows)
              expect(model.get(id)).toEqual(expectedWindow(rows, selected, n))
          }
        },
      ),
      oraclePropertyOptions(150, `cursor-pagination.no-peek`),
    )
  })

  it(`does not expose response facts before complete publication, or after reset`, async () => {
    const transport = createTransport(rowsOf(9), 3)
    const applied = createDeferred<void>()
    const received = createDeferred<void>()
    let held = false
    const model = createNoPeekDemandModel(async (limit) => {
      const packet = await transport.read(limit)
      if (held) {
        received.resolve()
        await applied.promise
      }
      return packet
    })
    model.retainDemand(`a`, 3)
    await model.refresh()
    const old = model.get(`a`)
    held = true
    model.retainDemand(`a`, 10)
    const pending = model.refresh()
    const observed = pending.then(
      () => undefined,
      (error: unknown) => error,
    )
    await received.promise
    expect(model.get(`a`)).toBe(old)
    model.reset()
    applied.resolve()
    expect(await observed).toMatchObject({ name: `AbortError` })
    expect(model.get(`a`)).toBeUndefined()
    held = false
    await model.refresh()
    expect(model.get(`a`)).toEqual(expectedWindow(rowsOf(9), scope, 10))
  })

  it(`notifies when only the published continuation changes`, async () => {
    let transport = createTransport(rowsOf(3), 3)
    const model = createNoPeekDemandModel((limit) => transport.read(limit))
    model.retainDemand(`a`, 3)
    const snapshots: Array<boolean | undefined> = []
    model.subscribe(() => snapshots.push(model.get(`a`)?.hasNextPage))
    await model.refresh()
    transport = createTransport(rowsOf(4), 3)
    await model.refresh()
    expect(snapshots).toEqual([false, true])
    expect(model.get(`a`)?.rows).toEqual(rowsOf(3))
  })

  it.each([`acquisition`, `fallback`] as const)(
    `keeps the last snapshot and queued peer usable after %s failure`,
    async (boundary) => {
      const transport = createTransport(rowsOf(9), 3)
      const failure = new Error(`Failed publication`)
      let fail = false
      const model = createNoPeekDemandModel(async (limit) => {
        if (fail && (boundary === `acquisition` || limit === 7)) {
          fail = false
          throw failure
        }
        const packet = await transport.read(limit)
        if (boundary === `fallback` && limit >= 6) delete packet.fact
        return packet
      })
      model.retainDemand(`a`, 3)
      await model.refresh()
      const old = model.get(`a`)
      model.retainDemand(`a`, 6)
      fail = true
      let publications = 0
      model.subscribe(() => publications++)
      await expect(model.refresh()).rejects.toBe(failure)
      expect(model.get(`a`)).toBe(old)
      expect(publications).toBe(0)
      model.retainDemand(`peer`, 9)
      const results = await Promise.allSettled([
        model.refresh(),
        model.refresh(),
      ])
      expect(results.map((result) => result.status)).toEqual([
        `fulfilled`,
        `fulfilled`,
      ])
      expect(model.get(`a`)).toEqual(expectedWindow(rowsOf(9), scope, 6))
      expect(model.get(`peer`)).toEqual(expectedWindow(rowsOf(9), scope, 9))
    },
  )

  it(`restores peek when metadata is withdrawn without changing the rows`, async () => {
    const transport = createTransport(rowsOf(9), 3)
    let metadata = true
    const model = createNoPeekDemandModel(async (limit) => {
      const packet = await transport.read(limit)
      if (!metadata) delete packet.fact
      return packet
    })
    model.retainDemand(`a`, 3)
    await model.refresh()
    const before = model.get(`a`)
    metadata = false
    await model.refresh()
    expect(transport.requests).toEqual([3, 3, 4])
    expect(model.get(`a`)).toEqual(before)
    await model.refresh()
    expect(transport.requests.at(-1)).toBe(4)
  })

  it(`saves a backend request only when peek crosses a page boundary`, async () => {
    for (const size of [3, 4, 50]) {
      const transport = createTransport(rowsOf(10), size)
      const model = createNoPeekDemandModel(transport.read)
      model.retainDemand(`a`, 3)
      await model.refresh()
      expect(transport.requests).toEqual([3])
      expect(transport.backend.calls).toHaveLength(1)
      const peek = createTransport(rowsOf(10), size)
      await peek.read(4)
      expect(peek.backend.calls).toHaveLength(size === 3 ? 2 : 1)
    }
  })
})
