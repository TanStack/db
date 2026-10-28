/**
 * Ordinary regression tests for persisted retained demand: synchronous answers from hydrated rows, failed reloads, partial updates, and acquisitions, as fixed scenarios. The demand laws are owned by persisted-oracle.test.ts, whose retained-demand property stays there.
 */
import { describe, expect, it, vi } from 'vitest'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { persistedCollectionOptions } from '../src'
import {
  atPersistedOracleCheckpoint,
  cleanupPersistedOracle,
  configureHydrationScope,
  createCoordinatorHarness,
  createEventGate,
  createFailStopCoordinatorHarness,
  createLocalCoordinatorHarness,
  createRecordingAdapter,
  flushAsyncWork,
  hydrationScopeModes,
  itUnlessAnyOracleReplay,
  observeSettlement,
  overrideBaselineRows,
  stripVirtualProps,
} from './persisted-support'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { Todo, TodoSyncParams } from './persisted-support'

describe(`persistedCollectionOptions`, () => {
  it(`answers only retained exact demands synchronously from hydrated rows`, async () => {
    const adapter = createRecordingAdapter([
      { id: `1`, title: `one` },
      { id: `2`, title: `two` },
    ])
    const loadRows = adapter.loadSubset
    adapter.loadSubset = async (...args) => {
      const rows = await loadRows(...args)
      return rows.slice(0, args[1].limit)
    }
    const coordinator = createLocalCoordinatorHarness()
    const upstreamLoads: Array<LoadSubsetOptions> = []
    const upstreamUnloads: Array<LoadSubsetOptions> = []
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                upstreamLoads.push(options)
                return true
              },
              unloadSubset: (options) => upstreamUnloads.push(options),
            }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    collection.startSyncImmediate()
    const first: LoadSubsetOptions = { limit: 2 }
    const sibling: LoadSubsetOptions = { limit: 2 }
    try {
      await collection._sync.loadSubset(first)
      const persistedReads = adapter.loadSubsetCalls.length

      expect(collection._sync.loadSubset(sibling)).toBe(true)
      expect(adapter.loadSubsetCalls).toHaveLength(persistedReads)
      expect(upstreamLoads).toEqual([first, sibling])

      collection._sync.unloadSubset(first)
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `retained-sibling`,
        latestRowVersion: 1,
        requiresFullReload: true,
      })
      await flushAsyncWork()
      await flushAsyncWork()
      expect(collection.size).toBe(2)

      collection._sync.unloadSubset(sibling)
      const narrow: LoadSubsetOptions = { limit: 1 }
      await collection._sync.loadSubset(narrow)
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 2,
        txId: `drop-released-demand`,
        latestRowVersion: 2,
        requiresFullReload: true,
      })
      await flushAsyncWork()
      await flushAsyncWork()
      expect(collection.size).toBe(1)

      const reacquired = collection._sync.loadSubset({ limit: 2 })
      expect(reacquired).not.toBe(true)
      await reacquired
      expect(collection.size).toBe(2)
      expect(upstreamUnloads).toEqual([first, sibling])
    } finally {
      await collection.cleanup()
    }
  })

  it(`makes a sibling live query synchronously ready from a retained hydrated demand`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `cached` }])
    const source = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `hydrated-demand-live-query`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter },
      }),
    )
    source.startSyncImmediate()
    const query = () =>
      createLiveQueryCollection({
        query: (q) =>
          q.from({ todo: source }).where(({ todo }) => eq(todo.id, `1`)),
      })
    const owner = query()
    let sibling: ReturnType<typeof query> | undefined
    try {
      await owner.preload()
      sibling = query()
      // A live query is ready only after a subscriber or a preload asks for
      // its data. Its first preload starts its sync run, so the retained demand
      // makes it ready before that call returns.
      void sibling.preload()
      expect(sibling.status).toBe(`ready`)
      expect(sibling.toArray.map(({ id }) => id)).toEqual([`1`])
    } finally {
      await sibling?.cleanup()
      await owner.cleanup()
      await source.cleanup()
    }
  })

  it(`makes a loopback sibling synchronously ready from a retained hydrated demand`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `cached` }])
    const source = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `loopback-hydrated-demand-live-query`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        persistence: { adapter },
      }),
    )
    source.startSyncImmediate()
    const query = () =>
      createLiveQueryCollection({
        query: (q) =>
          q.from({ todo: source }).where(({ todo }) => eq(todo.id, `1`)),
      })
    const owner = query()
    let sibling: ReturnType<typeof query> | undefined
    try {
      await owner.preload()
      sibling = query()
      // A live query is ready only after a subscriber or a preload asks for
      // its data. Its first preload starts its sync run, so the retained demand
      // makes it ready before that call returns.
      void sibling.preload()
      expect(sibling.status).toBe(`ready`)
      expect(sibling.toArray.map(({ id }) => id)).toEqual([`1`])
    } finally {
      await sibling?.cleanup()
      await owner.cleanup()
      await source.cleanup()
    }
  })

  it(`invalidates hydrated demand when the source truncates`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `cached` }])
    let truncateSource!: () => void
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `hydrated-demand-truncate`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ begin, truncate, commit, markReady }) => {
            truncateSource = () => {
              begin()
              truncate()
              commit()
            }
            markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter },
      }),
    )
    collection.startSyncImmediate()
    try {
      await collection._sync.loadSubset({ limit: 1 })
      expect(collection.size).toBe(1)
      truncateSource()
      expect(collection.size).toBe(0)

      const persistedReads = adapter.loadSubsetCalls.length
      const reacquired = collection._sync.loadSubset({ limit: 1 })
      expect(reacquired).not.toBe(true)
      await reacquired
      expect(adapter.loadSubsetCalls).toHaveLength(persistedReads + 1)
    } finally {
      await collection.cleanup()
    }
  })

  it(`does not restore hydrated coverage after a truncate overtakes a reload`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `cached` }])
    const readSubset = adapter.loadSubset
    let subsetReads = 0
    let enterReload!: () => void
    let releaseReload!: () => void
    const reloadEntered = new Promise<void>((resolve) => {
      enterReload = resolve
    })
    const reloadGate = new Promise<void>((resolve) => {
      releaseReload = resolve
    })
    adapter.loadSubset = async (...args) => {
      subsetReads++
      if (subsetReads === 2) {
        enterReload()
        await reloadGate
      }
      return readSubset(...args)
    }
    const coordinator = createLocalCoordinatorHarness()
    let truncateSource!: () => void
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ begin, truncate, commit, markReady }) => {
            truncateSource = () => {
              begin()
              truncate()
              commit()
            }
            markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    collection.startSyncImmediate()
    try {
      await collection._sync.loadSubset({ limit: 1 })
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `reload-before-truncate`,
        latestRowVersion: 1,
        requiresFullReload: true,
      })
      await reloadEntered
      truncateSource()
      releaseReload()
      await flushAsyncWork()
      await flushAsyncWork()
      expect(collection.size).toBe(0)

      const readsBeforeReacquire = adapter.loadSubsetCalls.length
      const reacquired = collection._sync.loadSubset({ limit: 1 })
      expect(reacquired).not.toBe(true)
      await reacquired
      expect(adapter.loadSubsetCalls).toHaveLength(readsBeforeReacquire + 1)
    } finally {
      releaseReload()
      await collection.cleanup()
    }
  })

  it(`does not advertise hydrated coverage after a terminal reset reload failure`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `cached` }])
    const readSubset = adapter.loadSubset
    const failure = new Error(`reset reload failed`)
    let failNextRead = false
    adapter.loadSubset = async (...args) => {
      if (failNextRead) {
        failNextRead = false
        throw failure
      }
      return readSubset(...args)
    }
    const coordinator = createLocalCoordinatorHarness()
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: { sync: ({ markReady }) => (markReady(), {}) },
        persistence: { adapter, coordinator },
      }),
    )
    collection.startSyncImmediate()
    try {
      const retained: LoadSubsetOptions = { limit: 1 }
      await collection._sync.loadSubset(retained)
      expect(collection.size).toBe(1)

      failNextRead = true
      coordinator.emit({
        type: `collection:reset`,
        schemaVersion: 1,
        resetEpoch: 1,
      })
      await flushAsyncWork()
      await flushAsyncWork()
      // Failed durable validation cannot retract the last public row. The
      // failed run must still reject a later acquisition instead of treating
      // that retained row as proof of hydrated coverage.
      expect(stripVirtualProps(collection.get(`1`))).toEqual({
        id: `1`,
        title: `cached`,
      })

      const readsBeforeReacquire = adapter.loadSubsetCalls.length
      const reacquired = collection._sync.loadSubset({ limit: 1 })
      expect(reacquired).not.toBe(true)
      await expect(Promise.resolve(reacquired)).rejects.toBe(failure)
      expect(adapter.loadSubsetCalls).toHaveLength(readsBeforeReacquire)
      expect(collection.status).toBe(`crashed`)
      expect(collection._lifecycle.getSyncError()).toBe(failure)
    } finally {
      warn.mockRestore()
      await collection.cleanup()
    }
  })

  it(`does not retain refresh history as permanent subset demand`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `Before` }])
    const coordinator = createCoordinatorHarness()
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        persistence: { adapter, coordinator },
      }),
    )
    collection.startSyncImmediate()
    try {
      await collection._sync.loadSubset({ limit: 1 })
      for (let i = 0; i < 20; i++)
        await collection.utils.forceReloadSubset!({ limit: 1 })
      const before = adapter.loadSubsetCalls.length
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `refresh-invalidation`,
        latestRowVersion: 1,
        requiresFullReload: true,
      })
      await flushAsyncWork()
      await flushAsyncWork()
      expect(adapter.loadSubsetCalls.length - before).toBe(1)
    } finally {
      await collection.cleanup()
    }
  })

  it(`reports a non-abort upstream failure rather than treating hydration as remote success`, async () => {
    const failure = new Error(`remote acquisition failed`)
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `remote-acquisition-failure`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => Promise.reject(failure),
            }
          },
        },
        persistence: {
          adapter: createRecordingAdapter([
            { id: `cached`, title: `Last known row` },
          ]),
        },
      }),
    )
    collection.startSyncImmediate()
    try {
      await expect(
        Promise.resolve(collection._sync.loadSubset({})),
      ).rejects.toBe(failure)
      expect(stripVirtualProps(collection.get(`cached`))).toEqual({
        id: `cached`,
        title: `Last known row`,
      })
    } finally {
      warn.mockRestore()
      await collection.cleanup()
    }
  })

  it(`keeps an incremental persisted subset failure request-local and retries without restart`, async () => {
    const hydrationFailure = new Error(`later on-demand hydration failed`)
    const adapter = createRecordingAdapter([
      { id: `cached`, title: `Last successful snapshot` },
    ])
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `request-local-on-demand-hydration-failure`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter },
      }),
    )
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `on-demand collection initially ready`,
      )
      await atPersistedOracleCheckpoint(
        Promise.resolve(collection._sync.loadSubset({ limit: 1 })),
        `initial persisted subset hydration`,
      )
      expect(stripVirtualProps(collection.get(`cached`))).toEqual({
        id: `cached`,
        title: `Last successful snapshot`,
      })
      expect(collection.status).toBe(`ready`)
      adapter.loadSubset = () => Promise.reject(hydrationFailure)

      // A distinct demand must still reach persistence; the retained exact
      // demand above is eligible for the synchronous hydrated fast path.
      await expect(
        atPersistedOracleCheckpoint(
          Promise.resolve(collection._sync.loadSubset({ limit: 2 })),
          `later on-demand hydration rejected`,
        ),
      ).rejects.toBe(hydrationFailure)

      expect(collection.status).toBe(`ready`)
      expect(collection._lifecycle.getSyncError()).toBeUndefined()
      expect(stripVirtualProps(collection.get(`cached`))).toEqual({
        id: `cached`,
        title: `Last successful snapshot`,
      })
      expect(adapter.applyCommittedTxCalls).toEqual([])

      adapter.rows.set(`retry`, {
        id: `retry`,
        title: `Explicit retry succeeded`,
      })
      adapter.loadSubset = async () =>
        Array.from(adapter.rows, ([key, value]) => ({ key, value }))
      await atPersistedOracleCheckpoint(
        Promise.resolve(collection._sync.loadSubset({ limit: 2 })),
        `request-local persisted subset retry`,
      )
      expect(stripVirtualProps(collection.get(`retry`))).toEqual({
        id: `retry`,
        title: `Explicit retry succeeded`,
      })
      expect(collection.status).toBe(`ready`)
      expect(collection._lifecycle.getSyncError()).toBeUndefined()
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  itUnlessAnyOracleReplay.each(hydrationScopeModes)(
    `settles hydration-buffered source work and reconciles an overlapping retry after incremental load rejection (%s scope)`,
    async (scopeMode) => {
      const failure = new Error(`incremental subset rejected exactly`)
      const adapter = createRecordingAdapter()
      const loadPersistedRows = adapter.loadSubset.bind(adapter)
      const loadEntered = createEventGate()
      const rejectLoad = createEventGate()
      adapter.loadSubset = async () => {
        loadEntered.resolve()
        await rejectLoad.promise
        throw failure
      }
      const routing = configureHydrationScope(adapter, scopeMode)
      let sourceParams!: TodoSyncParams
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `request-local-failure-releases-source-receipt`,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          sync: {
            sync: (params) => {
              sourceParams = params
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter },
        }),
      )
      let load: Promise<void> | undefined
      let receipt: Promise<void> | undefined
      let hasPrimaryFailure = false

      try {
        await atPersistedOracleCheckpoint(
          collection.stateWhenReady(),
          `request-local receipt collection ready`,
        )
        load = Promise.resolve(collection._sync.loadSubset({ limit: 1 })).then(
          () => undefined,
        )
        void load.catch(() => undefined)
        await atPersistedOracleCheckpoint(
          loadEntered.promise,
          `request-local hydration entered`,
        )

        sourceParams.begin()
        sourceParams.write({
          type: `insert`,
          value: { id: `source`, title: `Must outlive request failure` },
        })
        receipt = Promise.resolve(sourceParams.commit()).then(() => undefined)
        const receiptState = observeSettlement(receipt)
        expect(receiptState.read()).toEqual({ status: `pending` })

        rejectLoad.resolve()
        await expect(
          atPersistedOracleCheckpoint(load, `request-local load rejected`),
        ).rejects.toBe(failure)
        await atPersistedOracleCheckpoint(
          receipt,
          `hydration-buffered source receipt settled`,
        )

        expect({
          receipt: receiptState.read(),
          status: collection.status,
          publicError: collection._lifecycle.getSyncError(),
          publicRow: stripVirtualProps(collection.get(`source`)),
          durableRow: adapter.rows.get(`source`),
        }).toEqual({
          receipt: { status: `fulfilled` },
          status: `ready`,
          publicError: undefined,
          publicRow: { id: `source`, title: `Must outlive request failure` },
          durableRow: { id: `source`, title: `Must outlive request failure` },
        })

        expect(
          routing?.violations() ?? [],
          `failed incremental reads retain the current scope for surviving source work`,
        ).toEqual([])
        adapter.loadSubset = loadPersistedRows
        await atPersistedOracleCheckpoint(
          Promise.resolve(collection._sync.loadSubset({ limit: 1 })),
          `overlapping request-local retry loaded durable source row`,
        )
        expect({
          status: collection.status,
          publicError: collection._lifecycle.getSyncError(),
          publicRows: [...collection.values()].map(stripVirtualProps),
          durableRows: [...adapter.rows.values()],
        }).toEqual({
          status: `ready`,
          publicError: undefined,
          publicRows: [{ id: `source`, title: `Must outlive request failure` }],
          durableRows: [
            { id: `source`, title: `Must outlive request failure` },
          ],
        })
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        rejectLoad.resolve()
        await cleanupPersistedOracle(
          [
            () => load?.catch(() => undefined),
            () => receipt?.catch(() => undefined),
            () => collection.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  it(`fail-stops when a buffered partial update cannot reconstruct its persisted baseline`, async () => {
    const requestFailure = new Error(`incremental subset rejected`)
    const baselineFailure = new Error(
      `persisted baseline reconstruction failed`,
    )
    const adapter = createRecordingAdapter([
      {
        id: `shared`,
        title: `Persisted baseline`,
        detail: `required baseline field`,
      },
    ])
    const loadEntered = createEventGate()
    const rejectLoad = createEventGate()
    adapter.loadSubset = async () => {
      loadEntered.resolve()
      await rejectLoad.promise
      throw requestFailure
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `request-local-partial-baseline-failure`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          rowUpdateMode: `partial`,
          sync: (params) => {
            sourceParams = params
            params.markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter },
      }),
    )
    let load: Promise<void> | undefined
    let receipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `partial baseline failure collection ready`,
      )
      adapter.loadResumeSnapshot = () => Promise.reject(baselineFailure)
      load = Promise.resolve(collection._sync.loadSubset({ limit: 1 })).then(
        () => undefined,
      )
      void load.catch(() => undefined)
      await atPersistedOracleCheckpoint(
        loadEntered.promise,
        `partial baseline failure load entered`,
      )

      sourceParams.begin()
      sourceParams.write({
        type: `update`,
        value: { id: `shared`, title: `Partial update` },
      })
      receipt = Promise.resolve(sourceParams.commit()).then(() => undefined)
      void receipt.catch(() => undefined)
      expect(observeSettlement(receipt).read()).toEqual({ status: `pending` })

      rejectLoad.resolve()
      await expect(
        atPersistedOracleCheckpoint(load, `partial baseline load rejected`),
      ).rejects.toBe(baselineFailure)
      await expect(
        atPersistedOracleCheckpoint(
          receipt,
          `partial baseline source receipt rejected`,
        ),
      ).rejects.toBe(baselineFailure)
      expect({
        status: collection.status,
        exactPublicError:
          collection._lifecycle.getSyncError() === baselineFailure,
        publicRow: collection.get(`shared`),
        durableRow: adapter.rows.get(`shared`),
        durabilityCalls: adapter.applyCommittedTxCalls.length,
      }).toEqual({
        status: `crashed`,
        exactPublicError: true,
        publicRow: undefined,
        durableRow: {
          id: `shared`,
          title: `Persisted baseline`,
          detail: `required baseline field`,
        },
        durabilityCalls: 0,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      rejectLoad.resolve()
      await cleanupPersistedOracle(
        [
          () => load?.catch(() => undefined),
          () => receipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`applies a partial upsert when the persisted snapshot proves the key absent`, async () => {
    const requestFailure = new Error(`incremental subset rejected`)
    const adapter = createRecordingAdapter()
    const loadEntered = createEventGate()
    const rejectLoad = createEventGate()
    adapter.loadSubset = async () => {
      loadEntered.resolve()
      await rejectLoad.promise
      throw requestFailure
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `request-local-missing-partial-baseline`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          rowUpdateMode: `partial`,
          sync: (params) => {
            sourceParams = params
            params.markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter },
      }),
    )
    let load: Promise<void> | undefined
    let receipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await collection.stateWhenReady()
      load = Promise.resolve(collection._sync.loadSubset({ limit: 1 })).then(
        () => undefined,
      )
      void load.catch(() => undefined)
      await loadEntered.promise

      sourceParams.begin()
      sourceParams.write({
        type: `update`,
        value: { id: `missing`, title: `partial` },
      })
      receipt = Promise.resolve(sourceParams.commit()).then(() => undefined)
      void receipt.catch(() => undefined)
      rejectLoad.resolve()

      await expect(load).rejects.toBe(requestFailure)
      await receipt
      expect({
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
        publicRow: stripVirtualProps(collection.get(`missing`)),
        durableRow: adapter.rows.get(`missing`),
        durabilityCalls: adapter.applyCommittedTxCalls.length,
      }).toEqual({
        status: `ready`,
        publicError: undefined,
        publicRow: { id: `missing`, title: `partial` },
        durableRow: { id: `missing`, title: `partial` },
        durabilityCalls: 1,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      rejectLoad.resolve()
      await cleanupPersistedOracle(
        [
          () => load?.catch(() => undefined),
          () => receipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  // Decision 12: a transaction begun before a storage read may write and
  // commit while it runs. When the read fails, its partial update publishes
  // over the recovered durable baseline, as one begun during the read does
  // (the next test).
  it(`commits a transaction begun before a failing storage read`, async () => {
    const requestFailure = new Error(`incremental subset rejected`)
    const baseline: Todo = {
      id: `shared`,
      title: `Persisted baseline`,
      detail: `required baseline field`,
    }
    const adapter = createRecordingAdapter([baseline])
    const loadEntered = createEventGate()
    const rejectLoad = createEventGate()
    adapter.loadSubset = async () => {
      loadEntered.resolve()
      await rejectLoad.promise
      throw requestFailure
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `request-local-begin-before-hydration`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          rowUpdateMode: `partial`,
          sync: (params) => {
            sourceParams = params
            params.markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter },
      }),
    )
    let load: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await collection.stateWhenReady()
      sourceParams.begin()
      load = Promise.resolve(collection._sync.loadSubset({ limit: 1 })).then(
        () => undefined,
      )
      void load.catch(() => undefined)
      await loadEntered.promise

      sourceParams.write({
        type: `update`,
        value: { id: baseline.id, title: `Source update` },
      })
      const receipt = Promise.resolve(sourceParams.commit())
      rejectLoad.resolve()

      await expect(load).rejects.toBe(requestFailure)
      await receipt
      const expected: Todo = { ...baseline, title: `Source update` }
      expect({
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
        publicRow: stripVirtualProps(collection.get(baseline.id)),
        durableRow: adapter.rows.get(baseline.id),
      }).toEqual({
        status: `ready`,
        publicError: undefined,
        publicRow: expected,
        durableRow: expected,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      rejectLoad.resolve()
      await cleanupPersistedOracle(
        [() => load?.catch(() => undefined), () => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`publishes a recovered baseline and dependent partial update atomically`, async () => {
    const requestFailure = new Error(`incremental subset rejected`)
    const baseline: Todo = {
      id: `shared`,
      title: `Persisted baseline`,
      detail: `required baseline field`,
    }
    const expected: Todo = { ...baseline, title: `Source update` }
    const adapter = createRecordingAdapter([baseline])
    const loadEntered = createEventGate()
    const rejectLoad = createEventGate()
    adapter.loadSubset = async () => {
      loadEntered.resolve()
      await rejectLoad.promise
      throw requestFailure
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `request-local-atomic-baseline-recovery`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          rowUpdateMode: `partial`,
          sync: (params) => {
            sourceParams = params
            params.markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter },
      }),
    )
    const abortController = new AbortController()
    const publicCuts: Array<Todo | undefined> = []
    const subscription = collection.subscribeChanges((changes) => {
      if (changes.some(({ key }) => key === baseline.id)) {
        publicCuts.push(stripVirtualProps(collection.get(baseline.id)))
        abortController.abort()
      }
    })
    let load: Promise<void> | undefined
    let receipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await collection.stateWhenReady()
      load = Promise.resolve(collection._sync.loadSubset({ limit: 1 })).then(
        () => undefined,
      )
      void load.catch(() => undefined)
      await loadEntered.promise

      sourceParams.begin()
      sourceParams.write({
        type: `update`,
        value: { id: baseline.id, title: expected.title },
      })
      receipt = Promise.resolve(
        sourceParams.commit(abortController.signal),
      ).then(() => undefined)
      rejectLoad.resolve()

      await expect(load).rejects.toBe(requestFailure)
      await receipt
      expect({
        abortedFromPublication: abortController.signal.aborted,
        publicCuts,
        publicRow: stripVirtualProps(collection.get(baseline.id)),
        durableRow: adapter.rows.get(baseline.id),
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        abortedFromPublication: true,
        publicCuts: [expected],
        publicRow: expected,
        durableRow: expected,
        status: `ready`,
        publicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      rejectLoad.resolve()
      subscription.unsubscribe()
      await cleanupPersistedOracle(
        [
          () => load?.catch(() => undefined),
          () => receipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it.each([`delete`, `truncate`] as const)(
    `treats a buffered %s prefix as authoritative absence for a partial upsert`,
    async (prefix) => {
      const requestFailure = new Error(`incremental subset rejected`)
      const baseline: Todo = {
        id: `shared`,
        title: `Persisted baseline`,
        detail: `required baseline field`,
      }
      const adapter = createRecordingAdapter([baseline])
      const loadEntered = createEventGate()
      const rejectLoad = createEventGate()
      adapter.loadSubset = async () => {
        loadEntered.resolve()
        await rejectLoad.promise
        throw requestFailure
      }
      let sourceParams!: TodoSyncParams
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `request-local-${prefix}-partial-prefix`,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          sync: {
            rowUpdateMode: `partial`,
            sync: (params) => {
              sourceParams = params
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter },
        }),
      )
      let load: Promise<void> | undefined
      let prefixReceipt: Promise<void> | undefined
      let partialReceipt: Promise<void> | undefined
      let hasPrimaryFailure = false

      try {
        await collection.stateWhenReady()
        load = Promise.resolve(collection._sync.loadSubset({ limit: 1 })).then(
          () => undefined,
        )
        void load.catch(() => undefined)
        await loadEntered.promise

        sourceParams.begin()
        if (prefix === `delete`) {
          sourceParams.write({ type: `delete`, key: baseline.id })
        } else {
          sourceParams.truncate()
        }
        prefixReceipt = Promise.resolve(sourceParams.commit()).then(
          () => undefined,
        )
        void prefixReceipt.catch(() => undefined)

        sourceParams.begin()
        sourceParams.write({
          type: `update`,
          value: { id: baseline.id, title: `partial after ${prefix}` },
        })
        partialReceipt = Promise.resolve(sourceParams.commit()).then(
          () => undefined,
        )
        void partialReceipt.catch(() => undefined)
        rejectLoad.resolve()

        await expect(load).rejects.toBe(requestFailure)
        await prefixReceipt
        await partialReceipt
        expect({
          status: collection.status,
          publicError: collection._lifecycle.getSyncError(),
          publicRow: collection.get(baseline.id),
          durableRow: adapter.rows.get(baseline.id),
          durableOrder: adapter.applyCommittedTxCalls.map(({ tx }) =>
            tx.truncate ? `truncate` : tx.mutations[0]?.type,
          ),
        }).toEqual({
          status: `ready`,
          publicError: undefined,
          publicRow: expect.objectContaining({
            id: baseline.id,
            title: `partial after ${prefix}`,
          }),
          durableRow: {
            id: baseline.id,
            title: `partial after ${prefix}`,
          },
          durableOrder: [prefix, `update`],
        })
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        rejectLoad.resolve()
        await cleanupPersistedOracle(
          [
            () => load?.catch(() => undefined),
            () => prefixReceipt?.catch(() => undefined),
            () => partialReceipt?.catch(() => undefined),
            () => collection.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  it.each([`delete`, `truncate`] as const)(
    `treats a same-transaction %s prefix as authoritative absence for a partial upsert`,
    async (prefix) => {
      const baseline: Todo = {
        id: `shared`,
        title: `Persisted baseline`,
        detail: `required baseline field`,
      }
      const adapter = createRecordingAdapter([baseline])
      const loadEntered = createEventGate()
      const rejectLoad = createEventGate()
      adapter.loadSubset = async () => {
        loadEntered.resolve()
        await rejectLoad.promise
        throw new Error(`incremental subset rejected`)
      }
      let sourceParams!: TodoSyncParams
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `request-local-same-transaction-${prefix}-partial`,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          sync: {
            rowUpdateMode: `partial`,
            sync: (params) => {
              sourceParams = params
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter },
        }),
      )
      let load: Promise<void> | undefined
      let receipt: Promise<void> | undefined
      let hasPrimaryFailure = false

      try {
        await collection.stateWhenReady()
        load = Promise.resolve(collection._sync.loadSubset({ limit: 1 })).then(
          () => undefined,
        )
        void load.catch(() => undefined)
        await loadEntered.promise

        sourceParams.begin()
        if (prefix === `delete`) {
          sourceParams.write({ type: `delete`, key: baseline.id })
        } else {
          sourceParams.truncate()
        }
        sourceParams.write({
          type: `update`,
          value: { id: baseline.id, title: `partial after ${prefix}` },
        })
        receipt = Promise.resolve(sourceParams.commit()).then(() => undefined)
        void receipt.catch(() => undefined)
        rejectLoad.resolve()

        await expect(load).rejects.toThrow(`incremental subset rejected`)
        await receipt
        expect({
          status: collection.status,
          publicRow: stripVirtualProps(collection.get(baseline.id)),
          durableRow: adapter.rows.get(baseline.id),
          durabilityCalls: adapter.applyCommittedTxCalls.length,
          recoverySnapshotCalls: adapter.loadResumeSnapshotCalls.filter(
            ({ includeRows }) => includeRows === true,
          ).length,
        }).toEqual({
          status: `ready`,
          publicRow: {
            id: baseline.id,
            title: `partial after ${prefix}`,
          },
          durableRow: {
            id: baseline.id,
            title: `partial after ${prefix}`,
          },
          durabilityCalls: 1,
          recoverySnapshotCalls: 0,
        })
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        rejectLoad.resolve()
        await cleanupPersistedOracle(
          [
            () => load?.catch(() => undefined),
            () => receipt?.catch(() => undefined),
            () => collection.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  it(`keeps fallback-snapshot admissions inside buffered baseline recovery`, async () => {
    const rows: Array<Todo> = [
      { id: `a`, title: `A baseline`, detail: `A required` },
      { id: `b`, title: `B baseline`, detail: `B required` },
    ]
    const adapter = createRecordingAdapter(rows)
    const loadEntered = createEventGate()
    const rejectLoad = createEventGate()
    const fallbackEntered = createEventGate()
    const releaseFallback = createEventGate()
    adapter.loadSubset = async () => {
      loadEntered.resolve()
      await rejectLoad.promise
      throw new Error(`incremental subset rejected`)
    }
    const restoreBaselineRows = overrideBaselineRows(adapter, async () => {
      fallbackEntered.resolve()
      await releaseFallback.promise
      return rows.map((value) => ({ key: value.id, value }))
    })
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `request-local-fallback-admission`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          rowUpdateMode: `partial`,
          sync: (params) => {
            sourceParams = params
            params.markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter },
      }),
    )
    let load: Promise<void> | undefined
    const receipts: Array<Promise<void>> = []
    let hasPrimaryFailure = false

    try {
      await collection.stateWhenReady()
      load = Promise.resolve(collection._sync.loadSubset({ limit: 1 })).then(
        () => undefined,
      )
      void load.catch(() => undefined)
      await loadEntered.promise

      sourceParams.begin()
      sourceParams.write({
        type: `update`,
        value: { id: `a`, title: `A source` },
      })
      receipts.push(
        Promise.resolve(sourceParams.commit()).then(() => undefined),
      )
      receipts.forEach((receipt) => void receipt.catch(() => undefined))
      rejectLoad.resolve()
      await fallbackEntered.promise

      sourceParams.begin()
      sourceParams.write({
        type: `update`,
        value: { id: `b`, title: `B source` },
      })
      const lateReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      receipts.push(lateReceipt)
      void lateReceipt.catch(() => undefined)
      expect(observeSettlement(lateReceipt).read()).toEqual({
        status: `pending`,
      })

      releaseFallback.resolve()
      await expect(load).rejects.toThrow(`incremental subset rejected`)
      await Promise.all(receipts)
      expect({
        publicRows: [`a`, `b`].map((key) =>
          stripVirtualProps(collection.get(key)),
        ),
        durableRows: [`a`, `b`].map((key) => adapter.rows.get(key)),
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        publicRows: [
          { id: `a`, title: `A source`, detail: `A required` },
          { id: `b`, title: `B source`, detail: `B required` },
        ],
        durableRows: [
          { id: `a`, title: `A source`, detail: `A required` },
          { id: `b`, title: `B source`, detail: `B required` },
        ],
        status: `ready`,
        publicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      rejectLoad.resolve()
      releaseFallback.resolve()
      restoreBaselineRows()
      await cleanupPersistedOracle(
        [
          () => load?.catch(() => undefined),
          ...receipts.map((receipt) => () => receipt.catch(() => undefined)),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not publish a fallback baseline for an aborted dependent update`, async () => {
    const baseline: Todo = {
      id: `shared`,
      title: `Persisted baseline`,
      detail: `required baseline field`,
    }
    const adapter = createRecordingAdapter([baseline])
    const loadEntered = createEventGate()
    const rejectLoad = createEventGate()
    const fallbackEntered = createEventGate()
    const releaseFallback = createEventGate()
    adapter.loadSubset = async () => {
      loadEntered.resolve()
      await rejectLoad.promise
      throw new Error(`incremental subset rejected`)
    }
    const restoreBaselineRows = overrideBaselineRows(adapter, async () => {
      fallbackEntered.resolve()
      await releaseFallback.promise
      return [{ key: baseline.id, value: baseline }]
    })
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `request-local-aborted-partial-baseline`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          rowUpdateMode: `partial`,
          sync: (params) => {
            sourceParams = params
            params.markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter },
      }),
    )
    const publicEvents: Array<string> = []
    const subscription = collection.subscribeChanges((changes) => {
      publicEvents.push(
        ...changes.map((change) => `${change.type}:${change.key}`),
      )
    })
    const abortController = new AbortController()
    let load: Promise<void> | undefined
    let receipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await collection.stateWhenReady()
      load = Promise.resolve(collection._sync.loadSubset({ limit: 1 })).then(
        () => undefined,
      )
      void load.catch(() => undefined)
      await loadEntered.promise

      sourceParams.begin()
      sourceParams.write({
        type: `update`,
        value: { id: baseline.id, title: `aborted partial` },
      })
      receipt = Promise.resolve(
        sourceParams.commit(abortController.signal),
      ).then(() => undefined)
      void receipt.catch(() => undefined)
      rejectLoad.resolve()
      await fallbackEntered.promise
      abortController.abort()
      releaseFallback.resolve()

      await expect(load).rejects.toThrow(`incremental subset rejected`)
      await expect(receipt).rejects.toMatchObject({ name: `AbortError` })
      expect({
        publicEvents,
        publicRow: collection.get(baseline.id),
        durableRow: adapter.rows.get(baseline.id),
        durabilityCalls: adapter.applyCommittedTxCalls.length,
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        publicEvents: [],
        publicRow: undefined,
        durableRow: baseline,
        durabilityCalls: 0,
        status: `ready`,
        publicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      rejectLoad.resolve()
      releaseFallback.resolve()
      restoreBaselineRows()
      subscription.unsubscribe()
      await cleanupPersistedOracle(
        [
          () => load?.catch(() => undefined),
          () => receipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not let a later fallback dependency preserve metadata deleted by a fresh insert`, async () => {
    const baseline: Todo = {
      id: `shared`,
      title: `Persisted baseline`,
      detail: `old detail`,
    }
    const adapter = createRecordingAdapter([baseline])
    adapter.rowMetadata.set(baseline.id, { owner: `stale` })
    const loadEntered = createEventGate()
    const rejectLoad = createEventGate()
    adapter.loadSubset = async () => {
      loadEntered.resolve()
      await rejectLoad.promise
      throw new Error(`incremental subset rejected`)
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `request-local-insert-partial-metadata`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          rowUpdateMode: `partial`,
          sync: (params) => {
            sourceParams = params
            params.markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter },
      }),
    )
    let load: Promise<void> | undefined
    const receipts: Array<Promise<void>> = []
    let hasPrimaryFailure = false

    try {
      await collection.stateWhenReady()
      load = Promise.resolve(collection._sync.loadSubset({ limit: 1 })).then(
        () => undefined,
      )
      void load.catch(() => undefined)
      await loadEntered.promise

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: baseline.id, title: `Fresh insert`, detail: `new detail` },
      })
      receipts.push(
        Promise.resolve(sourceParams.commit()).then(() => undefined),
      )
      sourceParams.begin()
      sourceParams.write({
        type: `update`,
        value: { id: baseline.id, title: `Later partial` },
      })
      receipts.push(
        Promise.resolve(sourceParams.commit()).then(() => undefined),
      )
      receipts.forEach((receipt) => void receipt.catch(() => undefined))
      rejectLoad.resolve()

      await expect(load).rejects.toThrow(`incremental subset rejected`)
      await Promise.all(receipts)
      expect({
        publicRow: stripVirtualProps(collection.get(baseline.id)),
        durableRow: adapter.rows.get(baseline.id),
        publicMetadata: sourceParams.metadata!.row.get(baseline.id),
        durableMetadata: adapter.rowMetadata.get(baseline.id),
      }).toEqual({
        publicRow: {
          id: baseline.id,
          title: `Later partial`,
          detail: `new detail`,
        },
        durableRow: {
          id: baseline.id,
          title: `Later partial`,
          detail: `new detail`,
        },
        publicMetadata: undefined,
        durableMetadata: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      rejectLoad.resolve()
      await cleanupPersistedOracle(
        [
          () => load?.catch(() => undefined),
          ...receipts.map((receipt) => () => receipt.catch(() => undefined)),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`preserves an overlapping subset demand when its predecessor fails`, async () => {
    const failure = new Error(`failed demand is not active`)
    const adapter = createRecordingAdapter()
    const failedOptions: LoadSubsetOptions = { limit: 1 }
    const replacementOptions: LoadSubsetOptions = { limit: 1 }
    const firstLoadEntered = createEventGate()
    const rejectFirstLoad = createEventGate()
    const reloadCalls: Array<LoadSubsetOptions> = []
    let initialCalls = 0
    let reloading = false
    adapter.loadSubset = async (_collectionId, requestedOptions) => {
      if (reloading) {
        reloadCalls.push(requestedOptions)
      }
      if (!reloading) {
        initialCalls++
        if (initialCalls === 1) {
          firstLoadEntered.resolve()
          await rejectFirstLoad.promise
          throw failure
        }
      }
      if (requestedOptions === failedOptions) {
        return [
          {
            key: `phantom`,
            value: { id: `phantom`, title: `Failed demand leaked` },
          },
        ]
      }
      return [
        {
          key: `replacement`,
          value: {
            id: `replacement`,
            title: reloading ? `Replacement reloaded` : `Replacement initial`,
          },
        },
      ]
    }
    const coordinator = createFailStopCoordinatorHarness(
      `request-local-active-subset-identity`,
    )
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `request-local-active-subset-identity`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let firstLoad: Promise<void> | undefined
    let replacementLoad: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `active-subset identity collection ready`,
      )
      firstLoad = Promise.resolve(
        collection._sync.loadSubset(failedOptions),
      ).then(() => undefined)
      void firstLoad.catch(() => undefined)
      await atPersistedOracleCheckpoint(
        firstLoadEntered.promise,
        `failed subset demand entered hydration`,
      )
      replacementLoad = Promise.resolve(
        collection._sync.loadSubset(replacementOptions),
      ).then(() => undefined)
      void replacementLoad.catch(() => undefined)
      expect(observeSettlement(replacementLoad).read()).toEqual({
        status: `pending`,
      })
      rejectFirstLoad.resolve()
      await expect(firstLoad).rejects.toBe(failure)
      await atPersistedOracleCheckpoint(
        replacementLoad,
        `replacement subset loaded`,
      )

      reloading = true
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `reload-active-subsets`,
        latestRowVersion: 1,
        requiresFullReload: true,
        changedRows: [],
        deletedKeys: [],
      })
      await vi.waitFor(() =>
        expect(stripVirtualProps(collection.get(`replacement`))).toEqual({
          id: `replacement`,
          title: `Replacement reloaded`,
        }),
      )

      expect({
        reloadCalls,
        phantom: collection.get(`phantom`),
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        reloadCalls: [replacementOptions],
        phantom: undefined,
        status: `ready`,
        publicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      rejectFirstLoad.resolve()
      await cleanupPersistedOracle(
        [
          () => firstLoad?.catch(() => undefined),
          () => replacementLoad?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`reports a persisted subset failure only to its requesting subscription`, async () => {
    const failure = new Error(`requesting subscription failed exactly`)
    const adapter = createRecordingAdapter([
      { id: `cached`, title: `Shared cached row` },
    ])
    const loadSubset = adapter.loadSubset.bind(adapter)
    let calls = 0
    adapter.loadSubset = (...args) => {
      calls++
      return calls === 1 ? Promise.reject(failure) : loadSubset(...args)
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `request-local-subscription-hydration-failure`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter },
      }),
    )
    const failing = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const healthy = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const reported: Array<unknown> = []
    failing.on(`loadSubset:error`, ({ error }) => reported.push(error))
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `subscription-isolation collection ready`,
      )
      failing.requestSnapshot({ optimizedOnly: false })
      healthy.requestSnapshot({ optimizedOnly: false })
      await flushAsyncWork()

      expect({
        reported,
        failingError: failing.lastError,
        healthyError: healthy.lastError,
        failingStatus: failing.status,
        healthyStatus: healthy.status,
        collectionStatus: collection.status,
        publicError: collection._lifecycle.getSyncError(),
        cached: stripVirtualProps(collection.get(`cached`)),
      }).toEqual({
        reported: [failure],
        failingError: failure,
        healthyError: undefined,
        failingStatus: `ready`,
        healthyStatus: `ready`,
        collectionStatus: `ready`,
        publicError: undefined,
        cached: { id: `cached`, title: `Shared cached row` },
      })

      adapter.rows.set(`retry`, {
        id: `retry`,
        title: `Retry visible to both owners`,
      })
      failing.requestSnapshot({ optimizedOnly: false, refetch: true })
      await flushAsyncWork()
      expect(stripVirtualProps(collection.get(`retry`))).toEqual({
        id: `retry`,
        title: `Retry visible to both owners`,
      })
      expect(collection.status).toBe(`ready`)
      expect(collection._lifecycle.getSyncError()).toBeUndefined()
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      failing.unsubscribe()
      healthy.unsubscribe()
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`marks the collection errored and rejects later forced work after a hydration failure`, async () => {
    const hydrationFailure = new Error(`later forced hydration failed`)
    const adapter = createRecordingAdapter()
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `later-forced-hydration-failure`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        persistence: { adapter },
      }),
    )
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `forced-hydration collection initially ready`,
      )
      expect(collection.status).toBe(`ready`)
      adapter.loadSubset = () => Promise.reject(hydrationFailure)

      await expect(
        atPersistedOracleCheckpoint(
          Promise.resolve(collection.utils.forceReloadSubset!({ limit: 1 })),
          `later forced hydration rejected`,
        ),
      ).rejects.toBe(hydrationFailure)

      expect(collection.status).toBe(`crashed`)
      expect(collection._lifecycle.getSyncError()).toBe(hydrationFailure)
      expect([...collection.values()]).toEqual([])
      expect(adapter.rows.size).toBe(0)
      expect(adapter.applyCommittedTxCalls).toEqual([])

      let laterAdapterCalls = 0
      adapter.loadSubset = () => {
        laterAdapterCalls++
        return Promise.resolve([
          {
            key: `late-forced`,
            value: { id: `late-forced`, title: `must not be admitted` },
          },
        ])
      }
      await expect(
        atPersistedOracleCheckpoint(
          Promise.resolve(collection.utils.forceReloadSubset!({ limit: 2 })),
          `later forced subset work settled`,
        ),
      ).rejects.toBe(hydrationFailure)
      expect({
        laterAdapterCalls,
        visible: collection.get(`late-forced`),
        durable: adapter.rows.get(`late-forced`),
        durabilityCalls: adapter.applyCommittedTxCalls.length,
      }).toEqual({
        laterAdapterCalls: 0,
        visible: undefined,
        durable: undefined,
        durabilityCalls: 0,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`rejects subset work admitted after a terminal hydration failure`, async () => {
    const hydrationFailure = new Error(`terminal hydration failed`)
    const adapter = createRecordingAdapter()
    const coordinator = createFailStopCoordinatorHarness(
      `terminal-hydration-rejects-later-work`,
    )
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `terminal-hydration-rejects-later-work`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let hasPrimaryFailure = false
    const demand = { limit: 1 }

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `terminal hydration collection initially ready`,
      )
      await collection._sync.loadSubset(demand)
      adapter.loadSubset = () => Promise.reject(hydrationFailure)
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `terminal-hydration-rejects-later-work`,
        latestRowVersion: 1,
        requiresFullReload: true,
        changedRows: [],
        deletedKeys: [],
      })
      await vi.waitFor(() =>
        expect(collection._lifecycle.getSyncError()).toBe(hydrationFailure),
      )
      expect(collection.status).toBe(`crashed`)

      let laterAdapterCalls = 0
      adapter.loadSubset = () => {
        laterAdapterCalls++
        return Promise.resolve([
          {
            key: `late`,
            value: { id: `late`, title: `must not be admitted` },
          },
        ])
      }
      const laterOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve(collection._sync.loadSubset({ limit: 2 })).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `later subset work settled`,
      )

      expect({
        status: laterOutcome.status,
        exactReason:
          laterOutcome.status === `rejected` &&
          laterOutcome.reason === hydrationFailure,
        laterAdapterCalls,
        visible: collection.get(`late`),
        durable: adapter.rows.get(`late`),
        durabilityCalls: adapter.applyCommittedTxCalls.length,
      }).toEqual({
        status: `rejected`,
        exactReason: true,
        laterAdapterCalls: 0,
        visible: undefined,
        durable: undefined,
        durabilityCalls: 0,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      collection._sync.unloadSubset(demand)
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`rejects new source transactions after a terminal hydration failure`, async () => {
    const hydrationFailure = new Error(`terminal source hydration failed`)
    const adapter = createRecordingAdapter()
    const coordinator = createFailStopCoordinatorHarness(
      `terminal-hydration-rejects-new-source-work`,
    )
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `terminal-hydration-rejects-new-source-work`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            remoteBegin = begin
            remoteWrite = write as (message: {
              type: `insert`
              value: Todo
            }) => void
            remoteCommit = commit
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let hasPrimaryFailure = false
    const demand = { limit: 1 }

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `terminal source hydration collection initially ready`,
      )
      await collection._sync.loadSubset(demand)
      adapter.loadSubset = () => Promise.reject(hydrationFailure)
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `terminal-hydration-rejects-new-source-work`,
        latestRowVersion: 1,
        requiresFullReload: true,
        changedRows: [],
        deletedKeys: [],
      })
      await vi.waitFor(() =>
        expect(collection._lifecycle.getSyncError()).toBe(hydrationFailure),
      )
      expect(collection.status).toBe(`crashed`)
      expect(collection._lifecycle.getSyncError()).toBe(hydrationFailure)

      remoteBegin!()
      remoteWrite!({
        type: `insert`,
        value: { id: `late`, title: `must not be admitted` },
      })
      const lateOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve(remoteCommit!()).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `late terminal hydration source receipt`,
      )

      expect({
        receiptStatus: lateOutcome.status,
        exactReceipt:
          lateOutcome.status === `rejected` &&
          lateOutcome.reason === hydrationFailure,
        publicErrorIsHydration:
          collection._lifecycle.getSyncError() === hydrationFailure,
        status: collection.status,
        lateVisible: collection.get(`late`),
        lateDurable: adapter.rows.get(`late`),
        applyCalls: adapter.applyCommittedTxCalls.length,
      }).toEqual({
        receiptStatus: `rejected`,
        exactReceipt: true,
        publicErrorIsHydration: true,
        status: `crashed`,
        lateVisible: undefined,
        lateDurable: undefined,
        applyCalls: 0,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      collection._sync.unloadSubset(demand)
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it.each([`throw`, `reject`] as const)(
    `releases only transferred upstream ownership after a load %s`,
    async (mode) => {
      const failure = new Error(`failed upstream load`)
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const peer: LoadSubsetOptions = { limit: 1 }
      const failed: LoadSubsetOptions = { limit: 1 }
      const leases = new Set<LoadSubsetOptions>()
      let publish!: (title: string) => Promise<void>
      const unload = vi.fn((options: LoadSubsetOptions) => {
        leases.delete(options)
      })
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `failed-load-ownership-${mode}`,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              publish = async (title) => {
                if (!leases.has(peer)) return
                begin()
                write({
                  type: collection.has(`live`) ? `update` : `insert`,
                  value: { id: `live`, title },
                })
                await commit()
              }
              markReady()
              return {
                loadSubset: (options) => {
                  if (options === failed && mode === `throw`) throw failure
                  // Returning a promise transfers the ongoing lease, even if
                  // fetching its initial snapshot subsequently fails.
                  leases.add(options)
                  return options === failed ? Promise.reject(failure) : true
                },
                unloadSubset: unload,
              }
            },
          },
          persistence: { adapter: createRecordingAdapter() },
        }),
      )
      collection.startSyncImmediate()
      try {
        await collection._sync.loadSubset(peer)
        await expect(collection._sync.loadSubset(failed)).rejects.toBe(failure)
        expect(leases.has(failed)).toBe(mode === `reject`)
        collection._sync.unloadSubset(failed)
        expect(unload.mock.calls.map(([options]) => options)).toEqual(
          mode === `reject` ? [failed] : [],
        )
        expect(leases).toEqual(new Set([peer]))
        await publish(`Peer still live`)
        expect(collection.get(`live`)?.title).toBe(`Peer still live`)
        collection._sync.unloadSubset(peer)
        expect(leases.size).toBe(0)
        await publish(`Must not arrive`)
        expect(collection.get(`live`)?.title).toBe(`Peer still live`)
      } finally {
        warn.mockRestore()
        await collection.cleanup()
      }
    },
  )

  it(`does not mark a demand hydrated after its last acquisition leaves mid-read`, async () => {
    const adapter = createRecordingAdapter([
      { id: `1`, title: `one` },
      { id: `2`, title: `two` },
      { id: `3`, title: `three` },
    ])
    const readSubset = adapter.loadSubset
    let releaseRead!: () => void
    let enterRead!: () => void
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    const readEntered = new Promise<void>((resolve) => {
      enterRead = resolve
    })
    let blockNextRead = true
    adapter.loadSubset = async (...args) => {
      if (blockNextRead) {
        blockNextRead = false
        enterRead()
        await readGate
      }
      return readSubset(...args)
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `released-mid-read`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { loadSubset: () => true, unloadSubset: () => {} }
          },
        },
        persistence: { adapter },
      }),
    )
    collection.startSyncImmediate()

    try {
      const first: LoadSubsetOptions = { limit: 3 }
      const pending = collection._sync.loadSubset(first)
      await readEntered
      collection._sync.unloadSubset(first)
      releaseRead()
      await pending

      const reacquired = collection._sync.loadSubset({ limit: 3 })
      expect(reacquired).not.toBe(true)
      await reacquired
      expect(collection.get(`3`)).toBeDefined()
    } finally {
      releaseRead()
      await collection.cleanup()
    }
  })

  it(`does not answer a registered but unread demand synchronously`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `one` }])
    const readSubset = adapter.loadSubset
    let releaseRead!: () => void
    let enterRead!: () => void
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    const readEntered = new Promise<void>((resolve) => {
      enterRead = resolve
    })
    let blockNextRead = true
    adapter.loadSubset = async (...args) => {
      if (blockNextRead) {
        blockNextRead = false
        enterRead()
        await readGate
      }
      return readSubset(...args)
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `registered-before-read`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { loadSubset: () => true, unloadSubset: () => {} }
          },
        },
        persistence: { adapter },
      }),
    )
    collection.startSyncImmediate()

    try {
      const first = collection._sync.loadSubset({ limit: 1 })
      await readEntered
      const second = collection._sync.loadSubset({ limit: 1 })
      expect(second).not.toBe(true)
      releaseRead()
      await Promise.all([first, second])
      expect(collection.get(`1`)).toBeDefined()
    } finally {
      releaseRead()
      await collection.cleanup()
    }
  })

  it(`stops ensuring an aborted coordinator acquisition`, async () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const abortError = Object.assign(new Error(`abort`), { name: `AbortError` })
    const ensured: Array<LoadSubsetOptions> = []
    const first: LoadSubsetOptions = { limit: 1 }
    const second: LoadSubsetOptions = { limit: 1 }
    const coordinator = createCoordinatorHarness()
    coordinator.requestEnsureRemoteSubset = (_id, options) => {
      ensured.push(options)
      return options === second ? Promise.reject(abortError) : Promise.resolve()
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `fast-path-abort`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { loadSubset: () => true, unloadSubset: () => {} }
          },
        },
        persistence: {
          adapter: createRecordingAdapter([{ id: `1`, title: `one` }]),
          coordinator,
        },
      }),
    )

    try {
      collection.startSyncImmediate()
      await collection._sync.loadSubset(first)
      const result = await Promise.resolve(
        collection._sync.loadSubset(second),
      ).then(
        () => `ready`,
        (error: unknown) => error,
      )
      expect(result).toBe(abortError)

      const callsBeforeRetry = ensured.filter(
        (options) => options === second,
      ).length
      await vi.advanceTimersByTimeAsync(500)
      expect(ensured.filter((options) => options === second)).toHaveLength(
        callsBeforeRetry,
      )
    } finally {
      await collection.cleanup()
      warning.mockRestore()
      vi.useRealTimers()
    }
  })

  it(`does not release or acquire an upstream lease cancelled during hydration`, async () => {
    const adapter = createRecordingAdapter()
    const hydrate = adapter.loadSubset
    let blocked = false
    let enterHydration!: () => void
    let finishHydration!: () => void
    const entered = new Promise<void>((resolve) => {
      enterHydration = resolve
    })
    const gate = new Promise<void>((resolve) => {
      finishHydration = resolve
    })
    adapter.loadSubset = async (...args) => {
      if (blocked) {
        enterHydration()
        await gate
      }
      return hydrate(...args)
    }
    let leases = 0
    let loads = 0
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `cancelled-hydration-lease`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                loads++
                leases++
                return true
              },
              unloadSubset: () => {
                leases--
              },
            }
          },
        },
        persistence: { adapter },
      }),
    )
    collection.startSyncImmediate()
    const first: LoadSubsetOptions = { limit: 1 }
    const second: LoadSubsetOptions = { limit: 2 }
    try {
      await collection._sync.loadSubset(first)
      expect(leases).toBe(1)
      blocked = true
      const pending = collection._sync.loadSubset(second)
      await entered
      collection._sync.unloadSubset(second)
      expect(leases).toBe(1)
      finishHydration()
      await pending
      expect(loads).toBe(1)
      collection._sync.unloadSubset(first)
      expect(leases).toBe(0)
    } finally {
      finishHydration()
      await collection.cleanup()
    }
  })

  it.each([
    {
      action: `retain` as const,
      expectedEnsures: 1,
      expectedReleases: 0,
    },
    {
      action: `unload` as const,
      expectedEnsures: 0,
      expectedReleases: 1,
    },
    {
      action: `abort` as const,
      expectedEnsures: 0,
      expectedReleases: 0,
    },
  ])(
    `acquires coordinator demand after hydration iff it remains active: $action`,
    async ({ action, expectedEnsures, expectedReleases }) => {
      const adapter = createRecordingAdapter()
      const hydrate = adapter.loadSubset
      let enterHydration!: () => void
      let finishHydration!: () => void
      const entered = new Promise<void>((resolve) => {
        enterHydration = resolve
      })
      const gate = new Promise<void>((resolve) => {
        finishHydration = resolve
      })
      adapter.loadSubset = async (...args) => {
        enterHydration()
        await gate
        return hydrate(...args)
      }
      const ensure = vi.fn(async () => {})
      const release = vi.fn(async () => {})
      const coordinator = createCoordinatorHarness()
      coordinator.isLeader = () => false
      coordinator.requestEnsureRemoteSubset = ensure
      coordinator.requestReleaseRemoteSubset = release
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `coordinator-hydration-demand-${action}`,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return {}
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      const controller = new AbortController()
      const options: LoadSubsetOptions = {
        limit: 1,
        signal: controller.signal,
      }

      try {
        collection.startSyncImmediate()
        const pending = collection._sync.loadSubset(options)
        await entered
        if (action === `unload`) collection._sync.unloadSubset(options)
        if (action === `abort`) controller.abort()
        finishHydration()
        // An explicit abort of a retained demand now rejects promptly. The
        // earlier law treated it as a fulfilled load, even though hydration
        // must still suppress the remote acquisition. Release stays quiet.
        if (action === `abort`) {
          await expect(pending).rejects.toMatchObject({ name: `AbortError` })
        } else {
          await pending
        }

        // The earlier history law cancelled only after remote acquisition had
        // begun. Holding the real adapter hydration seam exposes the distinct
        // post-hydration transfer boundary. `retain` is the hostile control:
        // the cancellation guard must not suppress live demand.
        expect({
          ensures: ensure.mock.calls.length,
          releases: release.mock.calls.length,
        }).toEqual({
          ensures: expectedEnsures,
          releases: expectedReleases,
        })
      } finally {
        finishHydration()
        await collection.cleanup()
      }
    },
  )
})
