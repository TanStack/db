import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { flushPromises } from './utils.js'
import type { LoadSubsetOptions } from '../src/types.js'

const cases = ([`none`, `success`, `failure`] as const).flatMap((replay) =>
  [`a`, `c`].flatMap((group) =>
    [false, true].flatMap((overlap) =>
      [false, true].map((evict) => ({ replay, group, overlap, evict })),
    ),
  ),
)

it.each(cases)(
  `source retention controls release: replay=$replay group=$group overlap=$overlap evict=$evict`,
  async ({ group, replay, overlap, evict }) => {
    type Row = { id: number; group: string }
    const loads: Array<{
      options: LoadSubsetOptions
      deferred: ReturnType<typeof createDeferred<void>>
    }> = []
    const unloads: Array<LoadSubsetOptions> = []
    const a = new Func(`eq`, [new PropRef([`group`]), new Value(`a`)])
    const b = overlap
      ? new Func(`in`, [new PropRef([`group`]), new Value([`a`, `b`])])
      : new Func(`eq`, [new PropRef([`group`]), new Value(`b`)])
    const rows = [
      { id: 1, group },
      { id: 2, group: `b` },
    ]
    let replaceRows!: (truncate: boolean) => void
    let releaseTarget = false
    const collection = createCollection<Row, number>({
      id: `source-retention`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync(operations) {
          replaceRows = (truncate) => {
            operations.begin()
            if (truncate) operations.truncate()
            for (const row of rows)
              operations.write({ type: `insert`, value: row })
            operations.commit()
          }
          operations.markReady()
          return {
            loadSubset(options) {
              const deferred = createDeferred<void>()
              void deferred.promise.catch(() => undefined)
              options.signal?.addEventListener(
                `abort`,
                () =>
                  deferred.reject(new DOMException(`Aborted`, `AbortError`)),
                { once: true },
              )
              loads.push({ options, deferred })
              return deferred.promise
            },
            unloadSubset(options) {
              unloads.push(options)
              if (releaseTarget && options.where === a && evict) {
                // The source, not predicate membership, decides retention.
                // This also covers a row unrelated to the released predicate.
                operations.begin()
                operations.write({ type: `delete`, key: 1 })
                operations.commit()
              }
            },
          }
        },
      },
    })
    const visible = new Map<string | number, Row>()
    let publications = 0
    const subscription = collection.subscribeChanges(
      (changes) => {
        publications++
        for (const change of changes) {
          if (change.type === `delete`) visible.delete(change.key)
          else
            visible.set(change.key, {
              id: change.value.id,
              group: change.value.group,
            })
        }
      },
      { includeInitialState: false },
    )
    try {
      // These rows are independent source data, not request-scoped writes.
      replaceRows(false)
      subscription.requestSnapshot({ where: a })
      subscription.requestSnapshot({ where: b })
      loads.forEach(({ deferred }) => deferred.resolve())
      await flushPromises()
      expect([...visible.values()]).toEqual(rows)
      if (replay !== `none`) {
        replaceRows(true)
        await flushPromises()
        expect(loads).toHaveLength(4)
      }
      const beforeRelease = publications
      releaseTarget = true
      subscription.releaseSnapshot(a)
      releaseTarget = false
      const released = loads[replay === `none` ? 0 : 2]!
      expect(released.options.signal?.aborted).toBe(true)
      expect(
        unloads.filter((options) => options === released.options),
      ).toHaveLength(1)
      expect(collection.has(1)).toBe(!evict)
      if (replay !== `none`) {
        expect([...visible.values()]).toEqual(rows)
        expect(publications).toBe(beforeRelease)
        const failure = new Error(`peer replay failed`)
        if (replay === `failure`) loads[3]!.deferred.reject(failure)
        else loads[3]!.deferred.resolve()
        await flushPromises()
        expect(subscription.lastError).toBe(
          replay === `failure` ? failure : undefined,
        )
      }
      expect([...visible.values()]).toEqual(
        evict && replay !== `failure` ? [rows[1]] : rows,
      )
      expect(publications - beforeRelease).toBe(
        Number(evict && replay !== `failure`),
      )
      expect(subscription.status).toBe(`ready`)
    } finally {
      releaseTarget = false
      subscription.unsubscribe()
      await collection.cleanup()
    }
    for (const { options } of loads) {
      expect(unloads.filter((unloaded) => unloaded === options)).toHaveLength(1)
    }
  },
)
