import { expect, it } from 'vitest'
import { createCollection } from '../src/collection'
import { createDeferred } from '../src/deferred'
import { flushPromises } from './utils'
import type { LoadSubsetOptions, SyncConfig } from '../src/types'

type Row = { id: number; version: number }

it.each(
  [1, 2].flatMap((owners) =>
    ([`resolve`, `reject`, `throw`] as const).map((outcome) => ({
      owners,
      outcome,
    })),
  ),
)(
  `keeps replay adapter ownership balanced: %j`,
  async ({ owners, outcome }) => {
    const liveLeases = new Set<LoadSubsetOptions>()
    const loads: Array<LoadSubsetOptions> = []
    const releases: Array<LoadSubsetOptions> = []
    const pending: Array<ReturnType<typeof createDeferred<void>>> = []
    const failure = new Error(`adapter startup failed`)
    let generation = 1
    let starts = 0
    let stops = 0
    let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
    const source = createCollection<Row, number>({
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          sync = operations
          operations.markReady()
          return {
            loadSubset: (options) => {
              if (liveLeases.size === 0) starts++
              liveLeases.add(options)
              operations.begin()
              operations.write({
                type: source.has(1) ? `update` : `insert`,
                value: { id: 1, version: generation },
              })
              operations.commit()
              if (generation === 2 && outcome === `throw`) {
                // The adapter, not unloadSubset, owns rollback of a throw.
                liveLeases.delete(options)
                if (liveLeases.size === 0) stops++
                throw failure
              }
              loads.push(options)
              if (generation !== 2) return true
              const result = createDeferred<void>()
              pending.push(result)
              return result.promise
            },
            unloadSubset: (options) => {
              expect(liveLeases.delete(options)).toBe(true)
              releases.push(options)
              if (liveLeases.size === 0) stops++
            },
          }
        },
      },
    })
    const views = Array.from(
      { length: owners },
      () => new Map<string | number, number>(),
    )
    const subscriptions = views.map((view) =>
      source.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) view.delete(change.key)
            else view.set(change.key, change.value.version)
          }
        },
        { includeInitialState: false },
      ),
    )
    try {
      for (const subscription of subscriptions) subscription.requestSnapshot({})
      expect(liveLeases.size).toBe(owners)
      expect(starts).toBe(1)
      expect(stops).toBe(0)
      generation = 2
      sync.begin()
      sync.truncate()
      sync.commit()
      const waiters = Promise.allSettled(
        subscriptions.map(
          (subscription) => subscription.pendingTruncateReplacement,
        ),
      )
      await flushPromises()
      for (const view of views) expect([...view.values()]).toEqual([1])
      // Distinct logical owners may share one adapter resource. Retiring one
      // must never stop it while another successful owner still holds a lease.
      if (owners === 2 && outcome !== `throw`) expect(stops).toBe(0)
      if (owners === 1) {
        expect(starts).toBe(2)
        expect(stops).toBe(outcome === `throw` ? 2 : 1)
      }
      for (const result of pending) {
        if (outcome === `reject`) result.reject(failure)
        else result.resolve()
      }
      const settled = await waiters
      expect(settled).toEqual(
        Array.from({ length: owners }, () =>
          outcome === `resolve`
            ? { status: `fulfilled`, value: undefined }
            : { status: `rejected`, reason: failure },
        ),
      )
      await flushPromises()
      for (const view of views)
        expect([...view.values()]).toEqual([outcome === `resolve` ? 2 : 1])

      generation = 3
      sync.begin()
      sync.truncate()
      sync.commit()
      await flushPromises()
      for (const view of views) expect([...view.values()]).toEqual([3])
      expect(liveLeases.size).toBe(owners)
      subscriptions[0]!.unsubscribe()
      expect(liveLeases.size).toBe(owners - 1)
      for (const subscription of subscriptions) subscription.unsubscribe()
      expect(liveLeases.size).toBe(0)
      expect(starts).toBe(stops)
      expect(releases).toHaveLength(loads.length)
      for (const options of loads)
        expect(
          releases.filter((released) => released === options),
        ).toHaveLength(1)
    } finally {
      for (const result of pending) result.resolve()
      for (const subscription of subscriptions) subscription.unsubscribe()
      await source.cleanup()
    }
  },
)
