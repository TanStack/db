import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import {
  captureMicrotaskErrors,
  createOnDemandCollection,
  flushPromises,
} from './utils.js'
import { startOutcomes } from './collection-subscription-lifecycle-cell-support.js'
import type { LoadSubsetOptions } from '../src/types.js'

/**
 * Pinned unit tests for CollectionSubscription demand lifecycle: concrete
 * acquisition, release, restart, and replay examples whose expectations are
 * written by hand. The law, its model, and the generated scenario checks are
 * owned by collection-subscription-lifecycle-oracle.test.ts.
 */

describe(`CollectionSubscription demand lifecycle oracle`, () => {
  it.each([`resolve`, `reject`] as const)(
    `retires a pending replay on cleanup before an obsolete %s`,
    async (outcome) => {
      type Row = { id: string; version: number }
      const replay = createDeferred<void>()
      const replayFailure = new Error(`obsolete replay failed`)
      let begin!: () => void
      let write!: (message: { type: `insert`; value: Row }) => void
      let commit!: () => void
      let truncate!: () => void
      let syncRunCount = 0
      let loadCount = 0
      const visible = new Map<string | number, Row>()
      const errors: Array<unknown> = []
      const statuses: Array<string> = []

      const collection = createOnDemandCollection<Row>({
        id: `cleanup-pending-replay-${outcome}`,
        sync: {
          sync: (operations) => {
            syncRunCount++
            begin = operations.begin
            write = operations.write
            commit = operations.commit
            truncate = operations.truncate
            if (syncRunCount > 1) {
              begin()
              write({ type: `insert`, value: { id: `row`, version: 3 } })
              commit()
            }
            operations.markReady()
            return {
              loadSubset: () => {
                loadCount++
                begin()
                write({
                  type: `insert`,
                  value: { id: `row`, version: loadCount },
                })
                commit()
                return loadCount === 1 || syncRunCount > 1
                  ? true
                  : replay.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) visible.delete(change.key)
            else {
              visible.set(change.key, {
                id: change.value.id,
                version: change.value.version,
              })
            }
          }
        },
        { includeInitialState: false },
      )
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      subscription.on(`status:change`, ({ status }) => statuses.push(status))

      subscription.requestSnapshot()
      expect([...visible.values()]).toEqual([{ id: `row`, version: 1 }])
      begin()
      truncate()
      commit()
      await flushPromises()
      expect(subscription.status).toBe(`loadingSubset`)

      await collection.cleanup()
      collection.startSyncImmediate()
      expect(syncRunCount).toBe(2)
      expect([...visible.values()]).toEqual([{ id: `row`, version: 3 }])
      expect(subscription.status).toBe(`loadingSubset`)
      await flushPromises()
      expect(subscription.status).toBe(`ready`)

      if (outcome === `resolve`) replay.resolve()
      else replay.reject(replayFailure)
      await flushPromises()

      expect([...visible.values()]).toEqual([{ id: `row`, version: 3 }])
      expect(errors).toEqual([])
      expect(subscription.lastError).toBeUndefined()
      expect(statuses.at(-1)).toBe(`ready`)

      subscription.unsubscribe()
      await collection.cleanup()
    },
  )

  it(`reacquires surviving on-demand demand after collection restart`, async () => {
    type Row = { id: string; version: number }
    let begin!: () => void
    let write!: (message: { type: `insert`; value: Row }) => void
    let commit!: () => void
    let nextSyncRunGeneration = 0
    let loadCount = 0
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const visible = new Map<string | number, Row>()
    const collection = createOnDemandCollection<Row>({
      id: `restart-surviving-demand`,
      sync: {
        sync: (operations) => {
          nextSyncRunGeneration++
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              loadCount++
              begin()
              write({
                type: `insert`,
                value: { id: `row`, version: loadCount },
              })
              commit()
              return true
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.type === `delete`) visible.delete(change.key)
          else {
            visible.set(change.key, {
              id: change.value.id,
              version: change.value.version,
            })
          }
        }
      },
      { includeInitialState: false },
    )
    subscription.requestSnapshot()
    expect([...visible.values()]).toEqual([{ id: `row`, version: 1 }])

    await collection.cleanup()
    collection.startSyncImmediate()
    expect(subscription.status).toBe(`loadingSubset`)
    expect(loads).toHaveLength(1)
    await flushPromises()

    expect(nextSyncRunGeneration).toBe(2)
    expect(loads).toHaveLength(2)
    expect(unloads).toEqual([])
    expect([...visible.values()]).toEqual([{ id: `row`, version: 2 }])
    expect(subscription.status).toBe(`ready`)

    subscription.unsubscribe()
    expect(unloads).toEqual([loads[1]])
    await collection.cleanup()
  })

  it(`reacquires demand requested while the collection is cleaned up`, async () => {
    const oldWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`old`)])
    const newWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`new`)])
    let nextSyncRunGeneration = 0
    const loads: Array<{
      syncRunGeneration: number
      options: LoadSubsetOptions
    }> = []
    const unloads: Array<{
      syncRunGeneration: number
      options: LoadSubsetOptions
    }> = []
    const collection = createOnDemandCollection<{ id: string }>({
      id: `request-while-cleaned-up`,
      sync: {
        sync: ({ markReady }) => {
          const syncRunGeneration = nextSyncRunGeneration++
          markReady()
          return {
            loadSubset: (options) => {
              loads.push({ syncRunGeneration, options })
              return true
            },
            unloadSubset: (options) =>
              unloads.push({ syncRunGeneration, options }),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot({ where: oldWhere })

    await collection.cleanup()
    subscription.requestSnapshot({ where: newWhere })
    collection.startSyncImmediate()
    await flushPromises()

    expect(loads.map(({ syncRunGeneration }) => syncRunGeneration)).toEqual([
      0, 1, 1,
    ])
    expect(loads.slice(1).map(({ options }) => options.where)).toEqual([
      oldWhere,
      newWhere,
    ])

    subscription.unsubscribe()
    expect(unloads.map(({ syncRunGeneration }) => syncRunGeneration)).toEqual([
      1, 1,
    ])
    expect(unloads.map(({ options }) => options.where)).toEqual([
      oldWhere,
      newWhere,
    ])
    await collection.cleanup()
  })

  it(`does not report a detached demand as physically settled`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    const observed: Array<unknown> = []
    let loads = 0
    const collection = createOnDemandCollection<{ id: string }>({
      id: `detached-demand-settlement`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              loads++
              return true
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    await collection.cleanup()
    subscription.requestSnapshot({
      where,
      onLoadSubsetResult: (result) => observed.push(result),
    })

    expect(loads).toBe(0)
    expect(observed).toEqual([expect.any(Promise)])

    collection.startSyncImmediate()
    await flushPromises()
    expect(loads).toBe(1)
    expect(observed).toEqual([expect.any(Promise)])

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it.each([false, true])(
    `ignores a pre-aborted snapshot without changing an existing demand: %s`,
    async (existingDemand) => {
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      let publications = 0
      let results = 0
      const collection = createOnDemandCollection<{ id: string }>({
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            write({ type: `insert`, value: { id: `row` } })
            commit()
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: (options) => unloads.push(options),
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => publications++, {
        includeInitialState: false,
      })
      try {
        if (existingDemand) subscription.requestSnapshot({ where })
        const previousPublications = publications
        const previousLoads = [...loads]
        const controller = new AbortController()
        controller.abort()

        expect(
          subscription.requestSnapshot({
            where,
            signal: controller.signal,
            onLoadSubsetResult: () => results++,
          }),
        ).toBe(false)
        await flushPromises()
        expect(publications).toBe(previousPublications)
        expect(results).toBe(0)
        expect(loads).toEqual(previousLoads)
        expect(unloads).toEqual([])
        if (existingDemand) expect(loads[0]!.signal?.aborted).toBe(false)

        subscription.releaseSnapshot(where)
        expect(unloads).toEqual(previousLoads)
        subscription.unsubscribe()
        expect(unloads).toEqual(previousLoads)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`re-enables an installed loader after initial recovery in the same sync run`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    const loads: Array<LoadSubsetOptions> = []
    let markError!: (error: unknown) => void
    let markReady!: () => void
    const collection = createOnDemandCollection<{ id: string }>({
      id: `installed-loader-error-ready-recovery`,
      startSync: false,
      sync: {
        sync: (operations) => {
          markError = operations.markError
          markReady = operations.markReady
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    collection.startSyncImmediate()
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    markError(new Error(`initial sync failed`))
    markReady()
    subscription.requestSnapshot({ where })

    expect(collection.status).toBe(`ready`)
    expect(loads.map(({ where: loadedWhere }) => loadedWhere)).toEqual([where])

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`releases unavailable demand without creating a physical acquisition`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    let markError!: (error: unknown) => void
    let markReady!: () => void
    const collection = createOnDemandCollection<{ id: string }>({
      id: `release-unavailable-demand`,
      startSync: false,
      sync: {
        sync: (operations) => {
          markError = operations.markError
          markReady = operations.markReady
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    collection.startSyncImmediate()
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    markError(new Error(`initial sync failed`))
    subscription.requestSnapshot({ where })
    subscription.releaseSnapshot(where)
    markReady()
    await flushPromises()

    expect(loads).toHaveLength(0)
    expect(unloads).toHaveLength(0)

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`keeps an eager subscription ready after collection restart`, async () => {
    const collection = createCollection<{ id: string }>({
      id: `eager-subscription-restart`,
      getKey: ({ id }) => id,
      syncMode: `eager`,
      sync: { sync: ({ markReady }) => markReady() },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot()

    await collection.cleanup()
    collection.startSyncImmediate()
    await flushPromises()

    expect(collection.status).toBe(`ready`)
    expect(subscription.status).toBe(`ready`)

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`retires restart loading when the replacement sync fails`, async () => {
    const syncFailure = new Error(`replacement sync failed`)
    let nextSyncRunGeneration = 0
    const collection = createOnDemandCollection<{ id: string }>({
      id: `failed-sync-restart`,
      sync: {
        sync: ({ markReady }) => {
          if (nextSyncRunGeneration++ > 0) throw syncFailure
          markReady()
          return { loadSubset: () => true }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot()

    await collection.cleanup()
    expect(() => collection.startSyncImmediate()).toThrow(syncFailure)
    await flushPromises()

    expect(collection.status).toBe(`error`)
    expect(subscription.status).toBe(`ready`)

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`does not repeat failed cleanup through a replacement sync run`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    let nextSyncRunGeneration = 0
    const unloadSyncRunGenerations: Array<number> = []
    const releaseFailure = new Error(`old sync run release failed`)
    const uncaught = captureMicrotaskErrors()
    const collection = createOnDemandCollection<{ id: string }>({
      id: `cleanup-debt-sync-run`,
      sync: {
        sync: ({ markReady }) => {
          const syncRunGeneration = nextSyncRunGeneration++
          markReady()
          return {
            loadSubset: () => true,
            unloadSubset: () => {
              unloadSyncRunGenerations.push(syncRunGeneration)
              if (syncRunGeneration === 0) throw releaseFailure
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot({ where })
    expect(() => subscription.releaseSnapshot(where)).not.toThrow()

    await collection.cleanup()
    collection.startSyncImmediate()
    await flushPromises()
    subscription.unsubscribe()

    expect(unloadSyncRunGenerations).toEqual([0])
    await collection.cleanup()
    expect(uncaught.errors).toEqual([releaseFailure])
    uncaught.restore()
  })

  it(`treats an externally aborted replay as failed without publishing partial rows`, async () => {
    type Row = { id: string; value: string }
    const abort = new AbortController()
    const replay = createDeferred<void>()
    let begin!: () => void
    let write!: (message: { type: `insert`; value: Row }) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const visible = new Map<string | number, Row>()
    const collection = createOnDemandCollection<Row>({
      id: `externally-aborted-replay`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: () => {
              loadCount++
              begin()
              write({
                type: `insert`,
                value: {
                  id: `row`,
                  value: loadCount === 1 ? `old` : `partial`,
                },
              })
              commit()
              return loadCount === 1 ? true : replay.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.type === `delete`) visible.delete(change.key)
          else {
            visible.set(change.key, {
              id: change.value.id,
              value: change.value.value,
            })
          }
        }
      },
      { includeInitialState: false },
    )

    subscription.requestSnapshot({ signal: abort.signal })
    expect([...visible.values()]).toEqual([{ id: `row`, value: `old` }])
    begin()
    truncate()
    commit()
    await flushPromises()
    abort.abort()
    replay.reject(new DOMException(`aborted`, `AbortError`))
    await flushPromises()

    expect([...visible.values()]).toEqual([{ id: `row`, value: `old` }])
    expect(subscription.status).toBe(`ready`)

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it.each(startOutcomes)(
    `retires replay setup when its adapter cleans up before %s`,
    async (outcome) => {
      type Row = { id: string; version: number }
      const pending = createDeferred<void>()
      void pending.promise.catch(() => {})
      const failure = new Error(`obsolete replay failed`)
      let begin!: () => void
      let write!: (message: { type: `insert`; value: Row }) => void
      let commit!: () => void
      let truncate!: () => void
      let loadCount = 0
      const visible = new Map<string | number, Row>()
      const errors: Array<unknown> = []
      const statuses: Array<string> = []

      const collection = createOnDemandCollection<Row>({
        id: `reentrant-cleanup-${outcome}`,
        sync: {
          sync: (operations) => {
            begin = operations.begin
            write = operations.write
            commit = operations.commit
            truncate = operations.truncate
            operations.markReady()
            return {
              loadSubset: () => {
                loadCount++
                begin()
                write({
                  type: `insert`,
                  value: { id: `row`, version: loadCount },
                })
                commit()
                if (loadCount === 1) return true
                void collection.cleanup()
                if (outcome === `throw`) throw failure
                if (outcome === `return`) return true
                return pending.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) visible.delete(change.key)
            else {
              visible.set(change.key, {
                id: change.value.id,
                version: change.value.version,
              })
            }
          }
        },
        { includeInitialState: false },
      )
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      subscription.on(`status:change`, ({ status }) => statuses.push(status))
      subscription.requestSnapshot()

      begin()
      truncate()
      commit()
      await flushPromises()
      if (outcome === `resolve`) pending.resolve()
      if (outcome === `reject`) pending.reject(failure)
      await flushPromises()

      expect(collection.status).toBe(`cleaned-up`)
      expect([...visible.values()]).toEqual([{ id: `row`, version: 1 }])
      expect(errors).toEqual([])
      expect(subscription.lastError).toBeUndefined()
      expect(subscription.status).toBe(`ready`)
      expect(statuses.at(-1)).not.toBe(`loadingSubset`)

      subscription.unsubscribe()
      await collection.cleanup()
    },
  )
})
