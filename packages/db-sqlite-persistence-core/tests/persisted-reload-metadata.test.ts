/**
 * Ordinary regression tests for persisted full reloads and metadata: no-demand reloads, row metadata retention, exact snapshot comparison, and pullSince recovery, as fixed scenarios. The reload and metadata laws are owned by persisted-oracle.test.ts, which keeps its model-checked and generated cases.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  DbClient,
  IR,
  NoPendingSyncTransactionWriteError,
  collectionOptions,
  createCollection,
  whenSyncAccepted,
} from '@tanstack/db'
import { persistedCollectionOptions } from '../src'
import {
  atPersistedOracleCheckpoint,
  cleanupPersistedOracle,
  createCoordinatorHarness,
  createEventGate,
  createFailStopCoordinatorHarness,
  createRecordingAdapter,
  expectExactSnapshot,
  flushAsyncWork,
  overrideBaselineRows,
  stripVirtualProps,
} from './persisted-support'
import type { LoadSubsetOptions, SyncConfig } from '@tanstack/db'
import type { CollectionReset, PersistedTx, TxCommitted } from '../src'
import type { Todo, TodoSyncParams } from './persisted-support'

describe(`persistedCollectionOptions`, () => {
  it(`keeps a bare truncate away from another owner's queued marker`, async () => {
    const adapter = createRecordingAdapter()
    const firstPersistenceEntered = createEventGate()
    const releaseFirstPersistence = createEventGate()
    const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
    let applyCalls = 0
    adapter.applyCommittedTx = async (...args) => {
      applyCalls++
      if (applyCalls === 1) {
        firstPersistenceEntered.resolve()
        await releaseFirstPersistence.promise
      }
      await applyCommittedTx(...args)
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `bare-truncate-owner-isolation`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            sourceParams = params
            params.markReady()
          },
        },
        persistence: { adapter },
      }),
    )
    let firstReceipt: Promise<void> | undefined
    let queuedReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `bare truncate collection ready`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `first`, title: `must survive` },
      })
      firstReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void firstReceipt.catch(() => undefined)
      await atPersistedOracleCheckpoint(
        firstPersistenceEntered.promise,
        `bare truncate first owner persistence entered`,
      )

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `queued`, title: `owns queued marker` },
      })
      queuedReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void queuedReceipt.catch(() => undefined)

      let truncateError: unknown
      try {
        sourceParams.truncate()
      } catch (error) {
        truncateError = error
      }
      expect({
        truncateErrorIsOwned:
          truncateError instanceof NoPendingSyncTransactionWriteError,
        firstVisible: stripVirtualProps(collection.get(`first`)),
        queuedVisible: collection.has(`queued`),
      }).toEqual({
        truncateErrorIsOwned: true,
        firstVisible: { id: `first`, title: `must survive` },
        queuedVisible: false,
      })

      releaseFirstPersistence.resolve()
      await atPersistedOracleCheckpoint(firstReceipt, `first owner persisted`)
      await atPersistedOracleCheckpoint(queuedReceipt, `queued owner persisted`)
      expect({
        publicRows: Array.from(collection.values()).map(stripVirtualProps),
        durableRows: Array.from(adapter.rows.values()),
      }).toEqual({
        publicRows: [
          { id: `first`, title: `must survive` },
          { id: `queued`, title: `owns queued marker` },
        ],
        durableRows: [
          { id: `first`, title: `must survive` },
          { id: `queued`, title: `owns queued marker` },
        ],
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseFirstPersistence.resolve()
      await cleanupPersistedOracle(
        [
          () => firstReceipt?.catch(() => undefined),
          () => queuedReceipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`marks the collection errored with the exact persisted startup hydration failure`, async () => {
    const adapter = createRecordingAdapter()
    const startupError = new Error(`startup hydration failed exactly`)
    const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
    adapter.loadResumeSnapshot = (...args) => {
      if (args[1]?.includeRows === true) {
        return Promise.reject(startupError)
      }
      return loadResumeSnapshot(...args)
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-mark-ready-on-startup-failure`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {}
          },
        },
        persistence: {
          adapter,
        },
      }),
    )

    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    let hasPrimaryFailure = false
    try {
      await expect(collection.stateWhenReady()).rejects.toBe(startupError)
      expect(collection.status).toBe(`crashed`)
      expect(collection._lifecycle.getSyncError()).toBe(startupError)
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      warning.mockRestore()
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`reads staged metadata writes during hydration-queued transactions`, async () => {
    const adapter = createRecordingAdapter([
      {
        id: `cached-1`,
        title: `Cached row`,
      },
    ])
    adapter.rowMetadata.set(`cached-1`, { source: `persisted` })
    adapter.collectionMetadata.set(`startup:key`, { ready: true })

    let resolveLoadSubset: (() => void) | undefined
    const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
    adapter.loadResumeSnapshot = async (...args) => {
      if (args[1]?.includeRows === true) {
        await new Promise<void>((resolve) => {
          resolveLoadSubset = resolve
        })
      }
      return loadResumeSnapshot(...args)
    }

    let remoteBegin: (() => void) | undefined
    let remoteCommit: (() => void) | undefined
    let remoteTruncate: (() => void) | undefined
    let remoteMetadata:
      Parameters<SyncConfig<Todo, string>[`sync`]>[0][`metadata`] | undefined

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-metadata-read`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, commit, truncate, markReady, metadata }) => {
            remoteBegin = begin
            remoteCommit = commit
            remoteTruncate = truncate
            remoteMetadata = metadata
            markReady()
            return {}
          },
        },
        persistence: {
          adapter,
        },
      }),
    )

    const readyPromise = collection.stateWhenReady()
    for (let attempt = 0; attempt < 20 && !resolveLoadSubset; attempt++) {
      await flushAsyncWork()
    }

    expect(resolveLoadSubset).toBeDefined()
    expect(remoteBegin).toBeDefined()
    expect(remoteMetadata).toBeDefined()

    remoteBegin?.()
    remoteMetadata?.row.set(`cached-1`, { source: `staged` })
    remoteMetadata?.collection.set(`runtime:key`, { persisted: true })

    expect(remoteMetadata?.row.get(`cached-1`)).toEqual({ source: `staged` })
    expect(remoteMetadata?.collection.get(`runtime:key`)).toEqual({
      persisted: true,
    })
    expect(remoteMetadata?.collection.list()).toContainEqual({
      key: `runtime:key`,
      value: { persisted: true },
    })

    remoteTruncate?.()

    expect(remoteMetadata?.row.get(`cached-1`)).toBeUndefined()
    expect(remoteMetadata?.collection.get(`startup:key`)).toEqual({
      ready: true,
    })

    remoteCommit?.()
    resolveLoadSubset?.()
    await readyPromise
  })

  // A row the storage read supplies is a previous run's cache, a seed
  // (decision 9). A source insert without metadata names the whole row, so
  // it clears that row's metadata as it does for any seed (decision 12: a
  // write during a storage read follows the same rules).
  it(`clears a cached row's metadata when the source inserts it during the owning hydration`, async () => {
    const adapter = createRecordingAdapter([
      { id: `hydrated`, title: `Persisted baseline` },
    ])
    adapter.rowMetadata.set(`hydrated`, { source: `persisted` })
    adapter.rowMetadata.set(`new`, { source: `orphaned` })
    const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
    let durableMetadataMutations: Array<unknown> = []
    adapter.applyCommittedTx = async (...args) => {
      durableMetadataMutations = [...(args[1].rowMetadataMutations ?? [])]
      await applyCommittedTx(...args)
    }
    const hydrationEntered = createEventGate()
    const hydration = createEventGate()
    overrideBaselineRows(adapter, async () => {
      hydrationEntered.resolve()
      await hydration.promise
      return [
        {
          key: `hydrated`,
          value: { id: `hydrated`, title: `Persisted baseline` },
          metadata: { source: `persisted` },
        },
      ]
    })
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `hydration-owned-metadata`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            sourceParams = params
            params.markReady()
          },
        },
        persistence: { adapter },
      }),
    )
    const ready = collection.stateWhenReady()
    let receipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        hydrationEntered.promise,
        `metadata hydration entered`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `hydrated`, title: `Source replacement` },
      })
      sourceParams.write({
        type: `insert`,
        value: { id: `new`, title: `Genuinely new row` },
      })

      // Commit after hydration clears its runtime marker. The transaction's
      // captured hydration ownership must still distinguish these two keys.
      hydration.resolve()
      await atPersistedOracleCheckpoint(ready, `metadata hydration ready`)
      receipt = Promise.resolve(sourceParams.commit()).then(() => undefined)
      await atPersistedOracleCheckpoint(receipt, `metadata source receipt`)

      expect({
        publicHydrated: stripVirtualProps(collection.get(`hydrated`)),
        publicNew: stripVirtualProps(collection.get(`new`)),
        hydratedMetadata: adapter.rowMetadata.get(`hydrated`),
        newMetadata: adapter.rowMetadata.get(`new`),
        durableMetadataMutations,
      }).toEqual({
        publicHydrated: { id: `hydrated`, title: `Source replacement` },
        publicNew: { id: `new`, title: `Genuinely new row` },
        hydratedMetadata: undefined,
        newMetadata: undefined,
        durableMetadataMutations: [
          { type: `delete`, key: `hydrated` },
          { type: `delete`, key: `new` },
        ],
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      hydration.resolve()
      await cleanupPersistedOracle(
        [
          () => ready.catch(() => undefined),
          () => receipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  // A source transaction may begin during hydration and commit after that
  // same hydration finishes (the metadata-owner test above establishes this
  // history). Commit acceptance must survive later queued hydration. Starting
  // during hydration captures metadata ownership; it does not require replay
  // inside that hydration. This grammar varies the captured key membership,
  // commit-turn reservation, and the number of later hydrations. The first
  // scope is held after its task finishes. Without a reserved commit turn, later
  // reads run first. The adapter capability reserveCommitTurn holds those reads
  // behind the sync transaction, as Electric does for an overlapping stream.
  // All receipts settle before public/durable rows and metadata are compared.
  it.each(
    [false, true].flatMap((ownerSuppliesRow) =>
      [false, true].flatMap((reserveCommitTurn) =>
        [1, 2].map((laterHydrations) => ({
          ownerSuppliesRow,
          reserveCommitTurn,
          laterHydrations,
        })),
      ),
    ),
  )(
    `publishes a source begun during hydration after $laterHydrations later hydrations (ownerSuppliesRow=$ownerSuppliesRow, reserveCommitTurn=$reserveCommitTurn)`,
    async ({ ownerSuppliesRow, reserveCommitTurn, laterHydrations }) => {
      const baseline = { id: `shared`, title: `persisted`, detail: `baseline` }
      const adapter = createRecordingAdapter([baseline])
      adapter.rowMetadata.set(`shared`, { owner: `persisted` })
      const loadEntered = createEventGate()
      const releaseLoad = createEventGate()
      const firstPublished = createEventGate()
      const releaseScope = createEventGate()
      const loadSubset = adapter.loadSubset.bind(adapter)
      let loads = 0
      adapter.loadSubset = async (...args) => {
        if (++loads === 1) {
          loadEntered.resolve()
          await releaseLoad.promise
          return ownerSuppliesRow ? loadSubset(...args) : []
        }
        return loadSubset(...args)
      }
      let sourcePersistenceLoads = 0
      const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
      adapter.applyCommittedTx = async (...args) => {
        await applyCommittedTx(...args)
        if (args[1].mutations.some(({ key }) => key === `shared`)) {
          sourcePersistenceLoads = loads
        }
      }
      let sourceParams!: TodoSyncParams
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `source-begun-during-hydration`,
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
      const options = Array.from(
        { length: laterHydrations + 1 },
        (_, index) => ({
          limit: index + 1,
        }),
      )
      const receipts: Array<Promise<true | void>> = []
      let hasPrimaryFailure = false
      try {
        await collection.stateWhenReady()
        let scopes = 0
        adapter.runInHydrationScope = async (task) => {
          const first = ++scopes === 1
          const result = await task(adapter)
          if (first) {
            firstPublished.resolve()
            await releaseScope.promise
          }
          return result
        }
        const first = Promise.resolve(collection._sync.loadSubset(options[0]!))
        void first.catch(() => undefined)
        receipts.push(first)
        await atPersistedOracleCheckpoint(
          loadEntered.promise,
          `owning hydration entered`,
        )
        sourceParams.begin()
        if (reserveCommitTurn) {
          sourceParams.metadata!.persistence!.reserveCommitTurn()
        }
        sourceParams.write({
          type: `insert`,
          value: { ...baseline, title: `source` },
        })
        releaseLoad.resolve()
        await atPersistedOracleCheckpoint(
          firstPublished.promise,
          `owning hydration published`,
        )
        expect(collection.get(`shared`)?.title).toBe(
          ownerSuppliesRow ? `persisted` : undefined,
        )
        for (const option of options.slice(1)) {
          const load = Promise.resolve(collection._sync.loadSubset(option))
          void load.catch(() => undefined)
          receipts.push(load)
        }
        await flushAsyncWork()
        expect(loads).toBe(1)
        const committed = Promise.resolve(sourceParams.commit())
        void committed.catch(() => undefined)
        receipts.push(committed)
        releaseScope.resolve()
        const outcomes = await atPersistedOracleCheckpoint(
          Promise.allSettled(receipts),
          `source begun during hydration settled`,
        )
        // Accepted source writes follow the baseline. The source's insert
        // without metadata names the whole row, so it clears the cached row's
        // metadata whichever load supplied it (decisions 9 and 12).
        expect({
          outcomes,
          loads,
          sourcePersistenceLoads,
          status: collection.status,
          publicRow: stripVirtualProps(collection.get(`shared`)),
          durableRow: adapter.rows.get(`shared`),
          metadata: adapter.rowMetadata.get(`shared`),
        }).toEqual({
          outcomes: receipts.map(() => ({
            status: `fulfilled`,
            value: undefined,
          })),
          loads: laterHydrations + 1,
          sourcePersistenceLoads: reserveCommitTurn ? 1 : laterHydrations + 1,
          status: `ready`,
          publicRow: { ...baseline, title: `source` },
          durableRow: { ...baseline, title: `source` },
          metadata: undefined,
        })
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        releaseLoad.resolve()
        releaseScope.resolve()
        await cleanupPersistedOracle(
          [
            ...options.map(
              (option) => () => collection._sync.unloadSubset(option),
            ),
            () => Promise.allSettled(receipts),
            () => collection.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  // An on-demand Collection has no unconstrained persisted row demand before
  // its first subset request. A coordinator notification changes durable
  // authority but cannot manufacture that demand. The independent model has
  // zero or one active demand: zero requests no new rows; one unconstrained
  // demand requests the durable snapshot. A retired demand may leave its old
  // public row visible, so a peer full-reload notice must validate that row
  // immediately. The notice may not add unrelated durable rows. This history
  // checks both full-reload cuts and the later demand's public Collection and
  // adapter-call boundaries.
  // The reset history below applies the same demand law at a new cache epoch.
  it(`validates visible rows on a no-demand full reload without adding stored rows`, async () => {
    const stored = { id: `stored`, title: `Durable row` }
    const retained = { id: `retained`, title: `Still durable` }
    const adapter = createRecordingAdapter([stored, retained])
    const coordinator = createCoordinatorHarness()
    const collectionId = `zero-demand-full-reload`
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: collectionId,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
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
    try {
      await collection.stateWhenReady()
      expect(collection.has(`stored`)).toBe(false)
      expect(adapter.loadSubsetCalls).toHaveLength(0)
      const metadataReadsBefore = adapter.loadCollectionMetadataCalls.length
      coordinator.emit(
        {
          type: `tx:committed`,
          term: 1,
          seq: 1,
          txId: `zero-demand-reload`,
          latestRowVersion: 1,
          requiresFullReload: true,
        },
        undefined,
        collectionId,
      )
      await vi.waitFor(() =>
        expect(adapter.loadCollectionMetadataCalls).toHaveLength(
          metadataReadsBefore + 1,
        ),
      )
      await flushAsyncWork()
      await flushAsyncWork()
      expect(adapter.loadSubsetCalls).toHaveLength(0)
      expect(collection.has(`stored`)).toBe(false)

      const demand = {}
      await collection._sync.loadSubset(demand)
      expect(adapter.loadSubsetCalls).toHaveLength(1)
      expect(stripVirtualProps(collection.get(`stored`))).toEqual(stored)
      collection._sync.unloadSubset(demand)

      // A peer removes the row after demand retirement. Its full-reload notice
      // must retract the visible row without creating a new row demand.
      adapter.rows.delete(`stored`)
      const metadataReadsAfterRetirement =
        adapter.loadCollectionMetadataCalls.length
      const validationReads = adapter.loadResumeSnapshotCalls.length
      coordinator.emit(
        {
          type: `tx:committed`,
          term: 1,
          seq: 2,
          txId: `retired-demand-reload`,
          latestRowVersion: 2,
          requiresFullReload: true,
        },
        undefined,
        collectionId,
      )
      await vi.waitFor(() => {
        expect(adapter.loadResumeSnapshotCalls).toHaveLength(
          validationReads + 1,
        )
        expect(collection.has(`stored`)).toBe(false)
      })
      expect(adapter.loadCollectionMetadataCalls).toHaveLength(
        metadataReadsAfterRetirement,
      )
      expect(adapter.loadSubsetCalls).toHaveLength(1)
      expect(collection.has(`stored`)).toBe(false)
      expect(stripVirtualProps(collection.get(`retained`))).toEqual(retained)
      const newDemand = {}
      await collection._sync.loadSubset(newDemand)
      expect(adapter.loadSubsetCalls).toHaveLength(2)
      expect(adapter.loadResumeSnapshotCalls).toHaveLength(validationReads + 1)
      expect(collection.has(`stored`)).toBe(false)
      expect(stripVirtualProps(collection.get(`retained`))).toEqual(retained)
      collection._sync.unloadSubset(newDemand)

      // A bounded subset proves nothing about keys outside that subset.
      const loadSubset = adapter.loadSubset.bind(adapter)
      adapter.loadSubset = (id, options, context) =>
        options.limit === 0
          ? Promise.resolve([])
          : loadSubset(id, options, context)
      const emptyPage = { limit: 0 }
      await collection._sync.loadSubset(emptyPage)
      expect(stripVirtualProps(collection.get(`retained`))).toEqual(retained)
      collection._sync.unloadSubset(emptyPage)
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

  // A reset changes the durable cache epoch, not the Collection's demand.
  // The independent snapshot rule permits only keys already public when no
  // subset is retained: validate them against the new durable state, and add
  // no unrelated key. These controlled histories enter through the reset
  // notification and compare the public snapshot after its hydration scope
  // settles. They cover empty, changed, and deleted visible-key scopes, not
  // native-host notification delivery.
  it.each([`empty`, `updated`, `deleted`] as const)(
    `keeps a no-demand reset scoped to previously visible rows (%s)`,
    async (history) => {
      const visible = { id: `visible`, title: `Old row` }
      const unrelated = { id: `unrelated`, title: `Stored only` }
      const adapter = createRecordingAdapter(
        history === `empty` ? [unrelated] : [visible],
      )
      const coordinator = createCoordinatorHarness()
      const collectionId = `reset-visible-scope-${history}`
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
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
      try {
        collection.startSyncImmediate()
        await atPersistedOracleCheckpoint(
          collection.stateWhenReady(),
          `reset visible scope ready`,
        )
        if (history !== `empty`) {
          const demand = {}
          await collection._sync.loadSubset(demand)
          collection._sync.unloadSubset(demand)
        }
        expect(collection.has(visible.id)).toBe(history !== `empty`)

        if (history === `updated`) {
          adapter.rows.set(visible.id, { ...visible, title: `New row` })
        } else if (history === `deleted`) {
          adapter.rows.delete(visible.id)
        }
        adapter.rows.set(unrelated.id, unrelated)

        const resetSettled = createEventGate()
        adapter.runInHydrationScope = async (task) => {
          const result = await task(adapter)
          resetSettled.resolve()
          return result
        }
        const subsetReads = adapter.loadSubsetCalls.length
        coordinator.emit(
          { type: `collection:reset`, schemaVersion: 1, resetEpoch: 1 },
          undefined,
          collectionId,
        )
        await atPersistedOracleCheckpoint(
          resetSettled.promise,
          `reset visible scope published`,
        )
        expect({
          publicRows: new Map(
            Array.from(collection.values(), (row) => [
              row.id,
              stripVirtualProps(row),
            ]),
          ),
          subsetReads: adapter.loadSubsetCalls.length,
        }).toEqual({
          publicRows: new Map(
            history === `updated`
              ? [[visible.id, { ...visible, title: `New row` }]]
              : [],
          ),
          subsetReads,
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
    },
  )

  // A DbClient-hydrated row is already public but has not been confirmed by
  // the source. A complete persisted read can validate source-owned public
  // rows, but an absent or older cache row cannot revoke the hydration seed.
  // The independent model gives the seed precedence until a source change
  // confirms its key. These histories cross an unconstrained demand, a
  // no-demand peer notice, and a bounded empty-demand peer notice with absent,
  // older, and equal durable rows. At the settled Collection checkpoint, the
  // public row and change log must still equal the seed. The ordinary
  // non-hydrated correction is checked above.
  it.each(
    (
      [
        `complete demand`,
        `no-demand peer notice`,
        `bounded peer notice`,
      ] as const
    ).flatMap((path) =>
      ([`absent`, `older`, `equal`] as const).map((durable) => ({
        path,
        durable,
      })),
    ),
  )(
    `keeps a DbClient hydration seed across $path with $durable durable data`,
    async ({ path, durable }) => {
      const seed = { id: `seed`, title: `Hydrated row` }
      const stored =
        durable === `absent`
          ? []
          : [
              {
                id: `seed`,
                title: durable === `equal` ? seed.title : `Old row`,
              },
            ]
      const adapter = createRecordingAdapter(stored)
      if (path === `bounded peer notice`) {
        const loadSubset = adapter.loadSubset.bind(adapter)
        adapter.loadSubset = async (...args) => {
          const rows = await loadSubset(...args)
          return args[1].limit === 0 ? [] : rows
        }
      }
      const coordinator = createCoordinatorHarness()
      const collectionId = `hydrated-validation-${path}-${durable}`
      const descriptor = collectionOptions(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      const client = new DbClient()
      client.hydrate({
        collections: [{ collectionId, rows: [{ key: seed.id, value: seed }] }],
      })
      const collection = client.collection(descriptor)
      const changes: Array<string> = []
      const subscription = collection.subscribeChanges((batch) => {
        changes.push(...batch.map((change) => `${change.type}:${change.key}`))
      })
      let hasPrimaryFailure = false
      const boundedDemand = { limit: 0 }
      try {
        await collection.stateWhenReady()
        expect(stripVirtualProps(collection.get(seed.id))).toEqual(seed)
        if (path === `bounded peer notice`) {
          await collection._sync.loadSubset(boundedDemand)
          expect(stripVirtualProps(collection.get(seed.id))).toEqual(seed)
        }
        if (path === `complete demand`) {
          const demand = {}
          await collection._sync.loadSubset(demand)
          collection._sync.unloadSubset(demand)
        } else {
          const reads = adapter.loadResumeSnapshotCalls.length
          const subsetReads = adapter.loadSubsetCalls.length
          coordinator.emit(
            {
              type: `tx:committed`,
              term: 1,
              seq: 1,
              txId: `hydrated-validation`,
              latestRowVersion: 1,
              requiresFullReload: true,
            },
            undefined,
            collectionId,
          )
          await vi.waitFor(() => {
            if (path === `bounded peer notice`)
              expect(adapter.loadSubsetCalls).toHaveLength(subsetReads + 1)
            else expect(adapter.loadResumeSnapshotCalls).toHaveLength(reads + 1)
          })
          await flushAsyncWork()
          await flushAsyncWork()
        }
        expect({
          publicRow: stripVirtualProps(collection.get(seed.id)),
          changes,
        }).toEqual({ publicRow: seed, changes: [] })
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        if (path === `bounded peer notice`)
          collection._sync.unloadSubset(boundedDemand)
        subscription.unsubscribe()
        await cleanupPersistedOracle(
          [() => client.cleanup()],
          hasPrimaryFailure,
        )
      }
    },
  )

  // Preserving the seed cannot make an active reload ignore other rows. The
  // independent snapshot rule keeps the unconfirmed seed, replaces complete
  // durable values, removes absent ordinary keys, and admits new requested
  // keys. A second notice checks that the seed's protection survived the first
  // publication. The row values are observed after each settled peer notice.
  it(`preserves a hydration seed while replacing the rest of an active snapshot`, async () => {
    const seed = { id: `seed`, title: `Hydrated` }
    const old = { id: `ordinary`, title: `Old`, detail: `remove this field` }
    const removed = { id: `removed`, title: `Removed` }
    const adapter = createRecordingAdapter([old, removed])
    const coordinator = createCoordinatorHarness()
    const collectionId = `mixed-hydration-replacement`
    const descriptor = collectionOptions(
      persistedCollectionOptions<Todo, string>({
        id: collectionId,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    const client = new DbClient()
    client.hydrate({
      collections: [{ collectionId, rows: [{ key: seed.id, value: seed }] }],
    })
    const collection = client.collection(descriptor)
    const demand = { limit: 10 }
    let hasPrimaryFailure = false
    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      await collection._sync.loadSubset(demand)
      expect(collection._hasHydratedKey(seed.id)).toBe(true)
      const fresh = { id: `ordinary`, title: `Fresh` }
      const added = { id: `added`, title: `New` }
      adapter.rows.set(fresh.id, fresh)
      adapter.rows.delete(removed.id)
      adapter.rows.set(added.id, added)
      const firstReads =
        adapter.loadSubsetCalls.length + adapter.loadResumeSnapshotCalls.length
      coordinator.emit(
        {
          type: `tx:committed`,
          term: 1,
          seq: 1,
          txId: `mixed-first`,
          latestRowVersion: 1,
          requiresFullReload: true,
        },
        undefined,
        collectionId,
      )
      await vi.waitFor(() =>
        expect(
          adapter.loadSubsetCalls.length +
            adapter.loadResumeSnapshotCalls.length,
        ).toBe(firstReads + 1),
      )
      await flushAsyncWork()
      await flushAsyncWork()
      expect({
        seed: stripVirtualProps(collection.get(seed.id)),
        ordinary: stripVirtualProps(collection.get(old.id)),
        removed: collection.has(removed.id),
        added: stripVirtualProps(collection.get(added.id)),
        seedProtected: collection._hasHydratedKey(seed.id),
      }).toEqual({
        seed,
        ordinary: fresh,
        removed: false,
        added,
        seedProtected: true,
      })

      adapter.rows.set(seed.id, { id: seed.id, title: `Stale cache` })
      const secondReads =
        adapter.loadSubsetCalls.length + adapter.loadResumeSnapshotCalls.length
      coordinator.emit(
        {
          type: `tx:committed`,
          term: 1,
          seq: 2,
          txId: `mixed-second`,
          latestRowVersion: 2,
          requiresFullReload: true,
        },
        undefined,
        collectionId,
      )
      await vi.waitFor(() =>
        expect(
          adapter.loadSubsetCalls.length +
            adapter.loadResumeSnapshotCalls.length,
        ).toBe(secondReads + 1),
      )
      await flushAsyncWork()
      await flushAsyncWork()
      expect(stripVirtualProps(collection.get(seed.id))).toEqual(seed)
      expect(collection._hasHydratedKey(seed.id)).toBe(true)
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      collection._sync.unloadSubset(demand)
      await cleanupPersistedOracle([() => client.cleanup()], hasPrimaryFailure)
    }
  })

  // Row metadata of a key with no row is not durable, but this tab keeps it
  // until a source deletes the row (decision 16 in docs/contributing/
  // oracle-reviews/2026-10-22-sync-metadata-session.md; a full-reload notice
  // cleared it before). That holds when no subset demand remains: a public
  // row's presence changes whether the wrapper reads a durable row snapshot,
  // not that judgment. The sync metadata API is the observable boundary at
  // the settled notice checkpoint. A source metadata-only transaction
  // establishes the orphan through the real path.
  it.each([false, true])(
    `keeps orphan row metadata after a no-demand peer reload (public row=%s)`,
    async (hasPublicRow) => {
      const row = { id: `visible`, title: `Visible row` }
      const adapter = createRecordingAdapter(hasPublicRow ? [row] : [])
      const coordinator = createCoordinatorHarness()
      const collectionId = `zero-demand-orphan-${hasPublicRow}`
      let source!: TodoSyncParams
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          syncMode: `on-demand`,
          getKey: (value) => value.id,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      let hasPrimaryFailure = false
      try {
        await collection.stateWhenReady()
        if (hasPublicRow) {
          const demand = {}
          await collection._sync.loadSubset(demand)
          collection._sync.unloadSubset(demand)
        }
        expect(collection.has(row.id)).toBe(hasPublicRow)
        source.begin()
        source.metadata?.row.set(`ghost`, { obsolete: true })
        await whenSyncAccepted(source.commit())
        expect(source.metadata?.row.get(`ghost`)).toEqual({ obsolete: true })
        expect(collection.has(row.id)).toBe(hasPublicRow)
        expect(adapter.rows.has(row.id)).toBe(hasPublicRow)
        const metadataReads = adapter.loadCollectionMetadataCalls.length
        const snapshotReads = adapter.loadResumeSnapshotCalls.length
        coordinator.emit(
          {
            type: `tx:committed`,
            term: 1,
            seq: 2,
            txId: `orphan-peer-reload`,
            latestRowVersion: 2,
            requiresFullReload: true,
          },
          undefined,
          collectionId,
        )
        await vi.waitFor(() =>
          expect(
            adapter.loadCollectionMetadataCalls.length +
              adapter.loadResumeSnapshotCalls.length,
          ).toBe(metadataReads + snapshotReads + 1),
        )
        await flushAsyncWork()
        await flushAsyncWork()
        expect({
          orphan: source.metadata?.row.get(`ghost`),
          publicRow: stripVirtualProps(collection.get(row.id)),
        }).toEqual({
          orphan: { obsolete: true },
          publicRow: hasPublicRow ? row : undefined,
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
    },
  )

  // An equal durable value and row metadata require no public change batch.
  // This controlled history reaches the real sync metadata controls, then
  // retires its only demand before a peer notice. The Collection event log at
  // the settled notice checkpoint distinguishes a no-op from a redundant
  // update; core always supplies metadata controls to this adapter.
  it(`does not republish an unchanged metadata-bearing row after demand retirement`, async () => {
    const row = { id: `same`, title: `Unchanged` }
    const adapter = createRecordingAdapter([row])
    adapter.rowMetadata.set(row.id, { owner: `durable` })
    const coordinator = createCoordinatorHarness()
    const collectionId = `metadata-noop-peer`
    let source!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: collectionId,
        syncMode: `on-demand`,
        getKey: (value) => value.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let hasPrimaryFailure = false
    try {
      await collection.stateWhenReady()
      const demand = {}
      await collection._sync.loadSubset(demand)
      collection._sync.unloadSubset(demand)
      expect(source.metadata?.row.get(row.id)).toEqual({ owner: `durable` })
      const changes: Array<string> = []
      const subscription = collection.subscribeChanges((batch) => {
        changes.push(...batch.map((change) => `${change.type}:${change.key}`))
      })
      try {
        const reads = adapter.loadResumeSnapshotCalls.length
        coordinator.emit(
          {
            type: `tx:committed`,
            term: 1,
            seq: 1,
            txId: `same-metadata-peer`,
            latestRowVersion: 1,
            requiresFullReload: true,
          },
          undefined,
          collectionId,
        )
        await vi.waitFor(() =>
          expect(adapter.loadResumeSnapshotCalls).toHaveLength(reads + 1),
        )
        await flushAsyncWork()
        await flushAsyncWork()
        expect({
          row: stripVirtualProps(collection.get(row.id)),
          metadata: source.metadata?.row.get(row.id),
          changes,
        }).toEqual({ row, metadata: { owner: `durable` }, changes: [] })
      } finally {
        subscription.unsubscribe()
      }
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

  // A fresh acquisition of the same constrained demand must not keep a row
  // that its settled storage result excludes. The peer notice arrives after
  // demand retirement and must first correct the prior public rows without
  // publishing unrelated durable rows.
  // This controlled predicate has exactly one possible matching key.
  it(`corrects retired rows on a peer notice before constrained reacquisition`, async () => {
    const stored = { id: `stored`, title: `Durable row` }
    const retained = { id: `retained`, title: `Old durable value` }
    const adapter = createRecordingAdapter([stored, retained])
    adapter.rowMetadata.set(`retained`, { source: `old` })
    const loadSubset = adapter.loadSubset.bind(adapter)
    adapter.loadSubset = async (id, options, context) =>
      (await loadSubset(id, options, context)).filter(
        (row) => !options.where || row.key === `stored`,
      )
    const coordinator = createCoordinatorHarness()
    const collectionId = `retired-constrained-demand`
    let source!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: collectionId,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    const demand = {
      where: new IR.Func(`eq`, [
        new IR.PropRef([`id`]),
        new IR.Value(`stored`),
      ]),
    }
    let hasPrimaryFailure = false
    try {
      await collection.stateWhenReady()
      const originalDemand = {}
      await collection._sync.loadSubset(originalDemand)
      expect(stripVirtualProps(collection.get(`stored`))).toEqual(stored)
      expect(stripVirtualProps(collection.get(`retained`))).toEqual(retained)
      expect(source.metadata!.row.get(`retained`)).toEqual({ source: `old` })
      collection._sync.unloadSubset(originalDemand)

      adapter.rows.delete(`stored`)
      adapter.rowMetadata.delete(`retained`)
      adapter.rows.set(`retained`, {
        id: `retained`,
        title: `New durable value`,
      })
      adapter.rows.set(`unrequested`, {
        id: `unrequested`,
        title: `Not in the filtered demand`,
      })
      const metadataReads = adapter.loadCollectionMetadataCalls.length
      const validationReads = adapter.loadResumeSnapshotCalls.length
      coordinator.emit(
        {
          type: `tx:committed`,
          term: 1,
          seq: 1,
          txId: `constrained-peer-delete`,
          latestRowVersion: 1,
          requiresFullReload: true,
        },
        undefined,
        collectionId,
      )
      await vi.waitFor(() => {
        expect(adapter.loadResumeSnapshotCalls).toHaveLength(
          validationReads + 1,
        )
        expect(collection.has(`stored`)).toBe(false)
      })
      expect(adapter.loadCollectionMetadataCalls).toHaveLength(metadataReads)
      expect(adapter.loadSubsetCalls).toHaveLength(1)
      expect(collection.has(`stored`)).toBe(false)
      expect(collection.get(`retained`)?.title).toBe(`New durable value`)
      expect(source.metadata!.row.get(`retained`)).toBeUndefined()
      expect(collection.has(`unrequested`)).toBe(false)
      await collection._sync.loadSubset(demand)
      expect(adapter.loadSubsetCalls).toHaveLength(2)
      expect(adapter.loadResumeSnapshotCalls).toHaveLength(validationReads + 1)
      expect(collection.has(`stored`)).toBe(false)
      expect(collection.get(`retained`)?.title).toBe(`New durable value`)
      expect(collection.has(`unrequested`)).toBe(false)
      collection._sync.unloadSubset(demand)

      await collection._sync.loadSubset(demand)
      expect(adapter.loadResumeSnapshotCalls).toHaveLength(validationReads + 1)
      collection._sync.unloadSubset(demand)
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

  // Active demands form a union, not a first-match or last-match choice. A
  // targeted row can leave title=Keep while entering title=Other. Both
  // constrained demands remain active. The two acquisition orders reject
  // first-match and last-match shortcuts; a complete-demand shortcut cannot
  // pass either case. The adapter branches on the authored demand identity
  // only to supply controlled provider rows. The independent expectation is
  // the durable row admitted by title=Other. The callback and next task-turn
  // Collection snapshots must both contain the full row.
  it.each([`Keep first`, `Other first`] as const)(
    `keeps a targeted row requested by either active subset (%s)`,
    async (route) => {
      const old = { id: `ordinary`, title: `Keep`, detail: `retained` }
      const patch = { id: old.id, title: `Other` }
      const durable = { ...old, ...patch }
      const keepDemand = {
        where: new IR.Func(`eq`, [
          new IR.PropRef([`title`]),
          new IR.Value(`Keep`),
        ]),
      }
      const otherDemand = {
        where: new IR.Func(`eq`, [
          new IR.PropRef([`title`]),
          new IR.Value(`Other`),
        ]),
      }
      const adapter = createRecordingAdapter([old])
      const originalLoad = adapter.loadSubset.bind(adapter)
      adapter.loadSubset = async (id, options, context) => {
        const title =
          options.where === keepDemand.where
            ? `Keep`
            : options.where === otherDemand.where
              ? `Other`
              : undefined
        expect(title).toBeDefined()
        return (await originalLoad(id, options, context)).filter(
          (row) => row.value.title === title,
        )
      }
      const coordinator = createCoordinatorHarness()
      const collectionId = `targeted-union-${route}`
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      const demands =
        route === `Keep first`
          ? [keepDemand, otherDemand]
          : [otherDemand, keepDemand]
      const publicRows = () =>
        new Map(
          Array.from(collection.values(), (row) => [
            row.id,
            stripVirtualProps(row),
          ]),
        )
      const published = createEventGate()
      const snapshots: Array<Map<string, Todo>> = []
      let subscription:
        ReturnType<typeof collection.subscribeChanges> | undefined
      let hasPrimaryFailure = false
      try {
        await collection.stateWhenReady()
        for (const demand of demands) await collection._sync.loadSubset(demand)
        expectExactSnapshot(publicRows(), new Map([[old.id, old]]))
        subscription = collection.subscribeChanges(
          () => {
            snapshots.push(
              new Map(
                Array.from(publicRows(), ([key, row]) => [
                  key,
                  structuredClone(row),
                ]),
              ),
            )
            published.resolve()
          },
          { includeInitialState: false },
        )
        await adapter.applyCommittedTx(
          { kind: `eager`, collectionId },
          {
            txId: `targeted-union`,
            term: 1,
            seq: 1,
            rowVersion: 1,
            mutations: [{ type: `update`, key: old.id, value: patch }],
          },
        )
        expectExactSnapshot(adapter.rows, new Map([[old.id, durable]]))
        coordinator.emit(
          {
            type: `tx:committed`,
            term: 1,
            seq: 1,
            txId: `targeted-union`,
            latestRowVersion: 1,
            requiresFullReload: false,
            changedRows: [{ key: old.id, value: patch }],
            deletedKeys: [],
          },
          undefined,
          collectionId,
        )
        await atPersistedOracleCheckpoint(
          published.promise,
          `targeted union notice published`,
        )
        await flushAsyncWork()
        const expected = new Map([[old.id, durable]])
        expectExactSnapshot(publicRows(), expected)
        expect(snapshots).toHaveLength(1)
        for (const snapshot of snapshots)
          expectExactSnapshot(snapshot, expected)
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        subscription?.unsubscribe()
        for (const demand of demands) collection._sync.unloadSubset(demand)
        await cleanupPersistedOracle(
          [() => collection.cleanup()],
          hasPrimaryFailure,
        )
      }
    },
  )

  // A filtered acquisition proves only its predicate. Retiring an earlier
  // broad demand does not itself delete the rows it exposed. When a new
  // title=Keep demand is active, its persisted read of B says nothing about
  // previously public A outside that predicate. The independent model keeps
  // A unless durable evidence changes or deletes it, and applies the complete
  // durable B value. The same authored durable state and demands cross targeted
  // full-reload, and reset peer notices; their public snapshots must agree after
  // publication. Updated and deleted A reject a repair that merely preserves
  // an obsolete out-of-filter row. A DbClient seed stays source-owned across
  // every peer route, whether the durable snapshot lacks it or holds an older
  // value. The reset route must preserve it without an empty publication.
  it.each(
    ([`targeted`, `full reload`, `reset`] as const).flatMap((notice) =>
      ([`unchanged`, `updated`, `deleted`] as const).flatMap((outsideChange) =>
        ([`absent`, `older`] as const).map((seedCache) => ({
          notice,
          outsideChange,
          seedCache,
        })),
      ),
    ),
  )(
    `validates a previously public $outsideChange row and an $seedCache seed after a $notice notice`,
    async ({ notice, outsideChange, seedCache }) => {
      const outside = { id: `outside`, title: `Other` }
      const outsideUpdated = { ...outside, title: `Other now` }
      const inside = { id: `inside`, title: `Keep`, detail: `old` }
      const insideUpdated = { ...inside, detail: `new` }
      const seed = { id: `seed`, title: `Keep`, detail: `source-owned` }
      const storedSeed = { id: seed.id, title: `Other`, detail: `older` }
      const adapter = createRecordingAdapter([
        outside,
        inside,
        ...(seedCache === `older` ? [storedSeed] : []),
      ])
      const loadSubset = adapter.loadSubset.bind(adapter)
      adapter.loadSubset = async (id, options, context) =>
        (await loadSubset(id, options, context)).filter(
          (row) => !options.where || row.value.title === `Keep`,
        )
      const coordinator = createCoordinatorHarness()
      const collectionId = `mixed-demand-notice-${notice}-${outsideChange}-${seedCache}`
      const descriptor = collectionOptions(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      const client = new DbClient()
      client.hydrate({
        collections: [{ collectionId, rows: [{ key: seed.id, value: seed }] }],
      })
      const collection = client.collection(descriptor)
      const broadDemand = {}
      const filteredDemand = {
        where: new IR.Func(`eq`, [
          new IR.PropRef([`title`]),
          new IR.Value(`Keep`),
        ]),
      }
      const publicRows = () =>
        new Map(
          Array.from(collection.values(), (row) => [
            row.id,
            stripVirtualProps(row),
          ]),
        )
      const before = new Map<string, Todo>([
        [outside.id, outside],
        [inside.id, inside],
        [seed.id, seed],
      ])
      const durableExpected = new Map<string, Todo>([
        ...(outsideChange === `deleted`
          ? []
          : [
              [
                outside.id,
                outsideChange === `updated` ? outsideUpdated : outside,
              ] as [string, Todo],
            ]),
        [insideUpdated.id, insideUpdated],
        ...(seedCache === `older`
          ? ([[storedSeed.id, storedSeed]] as Array<[string, Todo]>)
          : []),
      ])
      const expected = new Map([...durableExpected, [seed.id, seed] as const])
      const published = createEventGate()
      const snapshots: Array<Map<string, Todo>> = []
      let subscription:
        ReturnType<typeof collection.subscribeChanges> | undefined
      let hasPrimaryFailure = false
      try {
        collection.startSyncImmediate()
        await collection.stateWhenReady()
        await collection._sync.loadSubset(broadDemand)
        expectExactSnapshot(publicRows(), before)
        collection._sync.unloadSubset(broadDemand)
        await collection._sync.loadSubset(filteredDemand)
        expectExactSnapshot(publicRows(), before)
        subscription = collection.subscribeChanges(
          () => {
            snapshots.push(
              new Map(
                Array.from(publicRows(), ([key, row]) => [
                  key,
                  structuredClone(row),
                ]),
              ),
            )
            published.resolve()
          },
          { includeInitialState: false },
        )
        const mutations: PersistedTx[`mutations`] = [
          {
            type: `update`,
            key: insideUpdated.id,
            value: { id: insideUpdated.id, detail: `new` },
          },
          ...(outsideChange === `updated`
            ? ([
                {
                  type: `update`,
                  key: outside.id,
                  value: { id: outside.id, title: outsideUpdated.title },
                },
              ] as PersistedTx[`mutations`])
            : outsideChange === `deleted`
              ? ([
                  { type: `delete`, key: outside.id, value: outside },
                ] as PersistedTx[`mutations`])
              : []),
        ]
        await adapter.applyCommittedTx(
          { kind: `eager`, collectionId },
          {
            txId: `mixed-demand-notice`,
            term: 1,
            seq: 1,
            rowVersion: 1,
            truncate: notice === `reset`,
            mutations:
              notice === `reset`
                ? Array.from(durableExpected, ([key, value]) => ({
                    type: `insert` as const,
                    key,
                    value,
                  }))
                : mutations,
          },
        )
        expectExactSnapshot(adapter.rows, durableExpected)
        const envelope: TxCommitted | CollectionReset =
          notice === `reset`
            ? { type: `collection:reset`, schemaVersion: 1, resetEpoch: 1 }
            : notice === `full reload`
              ? {
                  type: `tx:committed`,
                  term: 1,
                  seq: 1,
                  txId: `mixed-demand-notice`,
                  latestRowVersion: 1,
                  requiresFullReload: true,
                }
              : {
                  type: `tx:committed`,
                  term: 1,
                  seq: 1,
                  txId: `mixed-demand-notice`,
                  latestRowVersion: 1,
                  requiresFullReload: false,
                  changedRows: mutations
                    .filter((mutation) => mutation.type !== `delete`)
                    .map((mutation) => ({
                      key: mutation.key,
                      value: mutation.value,
                    })),
                  deletedKeys: outsideChange === `deleted` ? [outside.id] : [],
                }
        coordinator.emit(envelope, undefined, collectionId)
        await atPersistedOracleCheckpoint(
          published.promise,
          `mixed-demand peer publication`,
        )
        await flushAsyncWork()
        expect(snapshots).toHaveLength(1)
        for (const snapshot of snapshots)
          expectExactSnapshot(snapshot, expected)
        expectExactSnapshot(publicRows(), expected)
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        subscription?.unsubscribe()
        collection._sync.unloadSubset(filteredDemand)
        await cleanupPersistedOracle(
          [() => client.cleanup()],
          hasPrimaryFailure,
        )
      }
    },
  )

  // Hydration authority is temporary. A DbClient seed wins over durable data
  // only until an accepted source transaction confirms that key. After its
  // applied receipt, a later peer transaction has ordinary durable authority.
  // The model is the source-confirmed row or absence followed by the peer's
  // complete durable result. A source insert or update permits a later peer
  // update or delete; a source delete permits a later peer insert. Targeted and full-reload
  // notices use different production paths, but both must publish the same
  // public result at their settled change callback and afterward. An ordinary
  // sibling changes in every notice, so perpetual seed protection reaches the
  // exact-row comparison rather than only timing out waiting for a callback.
  // This is the neighboring witness to the protected-seed histories above: an
  // implementation that protects every hydrated key forever fails here.
  it.each(
    ([`targeted`, `full reload`] as const).flatMap((notice) => [
      { notice, confirmation: `update` as const, change: `update` as const },
      { notice, confirmation: `update` as const, change: `delete` as const },
      { notice, confirmation: `insert` as const, change: `update` as const },
      { notice, confirmation: `insert` as const, change: `delete` as const },
      { notice, confirmation: `delete` as const, change: `insert` as const },
    ]),
  )(
    `ends hydration protection after source $confirmation before a $notice peer $change`,
    async ({ notice, confirmation, change }) => {
      const seed = { id: `seed`, title: `Hydrated`, detail: `seed field` }
      const confirmed = { id: seed.id, title: `Source`, detail: `source field` }
      const peer = { id: seed.id, title: `Peer`, detail: `peer field` }
      const ordinary = { id: `ordinary`, title: `Old ordinary` }
      const ordinaryPeer = { id: ordinary.id, title: `New ordinary` }
      const adapter = createRecordingAdapter([ordinary])
      const coordinator = createCoordinatorHarness()
      coordinator.requestApplyCommittedTx = async (collectionId, tx) => {
        await adapter.applyCommittedTx({ kind: `eager`, collectionId }, tx)
        return {
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }
      }
      const collectionId = `confirmed-seed-${confirmation}-${notice}-${change}`
      let source!: TodoSyncParams
      const descriptor = collectionOptions(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      const client = new DbClient()
      client.hydrate({
        collections: [{ collectionId, rows: [{ key: seed.id, value: seed }] }],
      })
      const collection = client.collection(descriptor)
      const demand = {}
      const publicRows = () =>
        new Map(
          Array.from(collection.values(), (row) => [
            row.id,
            stripVirtualProps(row),
          ]),
        )
      const published = createEventGate()
      const snapshots: Array<Map<string, Todo>> = []
      let subscription:
        ReturnType<typeof collection.subscribeChanges> | undefined
      let hasPrimaryFailure = false
      try {
        collection.startSyncImmediate()
        await collection.stateWhenReady()
        await collection._sync.loadSubset(demand)
        expectExactSnapshot(
          publicRows(),
          new Map([
            [seed.id, seed],
            [ordinary.id, ordinary],
          ]),
        )

        source.begin()
        source.write(
          confirmation === `delete`
            ? { type: `delete`, key: seed.id }
            : { type: confirmation, value: confirmed },
        )
        await source.commit()
        const confirmedRows = new Map<string, Todo>([
          ...(confirmation === `delete`
            ? []
            : ([[seed.id, confirmed]] as Array<[string, Todo]>)),
          [ordinary.id, ordinary],
        ])
        expectExactSnapshot(publicRows(), confirmedRows)
        expectExactSnapshot(adapter.rows, confirmedRows)

        subscription = collection.subscribeChanges(
          () => {
            snapshots.push(
              new Map(
                Array.from(publicRows(), ([key, row]) => [
                  key,
                  structuredClone(row),
                ]),
              ),
            )
            published.resolve()
          },
          { includeInitialState: false },
        )
        const mutations: PersistedTx[`mutations`] = [
          { type: `update`, key: ordinary.id, value: ordinaryPeer },
          change === `delete`
            ? { type: `delete`, key: seed.id, value: confirmed }
            : { type: change, key: seed.id, value: peer },
        ]
        await adapter.applyCommittedTx(
          { kind: `eager`, collectionId },
          {
            txId: `confirmed-seed-peer`,
            term: 1,
            seq: 2,
            rowVersion: 2,
            mutations,
          },
        )
        const expected = new Map<string, Todo>(
          change !== `delete`
            ? [
                [seed.id, peer],
                [ordinary.id, ordinaryPeer],
              ]
            : [[ordinary.id, ordinaryPeer]],
        )
        expectExactSnapshot(adapter.rows, expected)
        const envelope: TxCommitted =
          notice === `full reload`
            ? {
                type: `tx:committed`,
                term: 1,
                seq: 2,
                txId: `confirmed-seed-peer`,
                latestRowVersion: 2,
                requiresFullReload: true,
              }
            : {
                type: `tx:committed`,
                term: 1,
                seq: 2,
                txId: `confirmed-seed-peer`,
                latestRowVersion: 2,
                requiresFullReload: false,
                changedRows:
                  change !== `delete`
                    ? [
                        { key: seed.id, value: peer },
                        { key: ordinary.id, value: ordinaryPeer },
                      ]
                    : [{ key: ordinary.id, value: ordinaryPeer }],
                deletedKeys: change === `delete` ? [seed.id] : [],
              }
        coordinator.emit(envelope, undefined, collectionId)
        await atPersistedOracleCheckpoint(
          published.promise,
          `confirmed seed peer publication`,
        )
        await flushAsyncWork()
        expect(snapshots).toHaveLength(1)
        for (const snapshot of snapshots)
          expectExactSnapshot(snapshot, expected)
        expectExactSnapshot(publicRows(), expected)
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        subscription?.unsubscribe()
        collection._sync.unloadSubset(demand)
        await cleanupPersistedOracle(
          [() => client.cleanup()],
          hasPrimaryFailure,
        )
      }
    },
  )

  // Hostile output controls calibrate the same comparison used above and by
  // the captured-read source history. A missing key, an obsolete defined
  // field, and an obsolete own-undefined field must all be rejected. These
  // controls do not substitute for the production RED witnesses above.
  it(`rejects omitted keys and retained fields at the exact snapshot comparison`, () => {
    const expected = new Map<string, Todo>([
      [`shared`, { id: `shared`, title: `Current` }],
      [`new`, { id: `new`, title: `New` }],
    ])
    expect(() =>
      expectExactSnapshot(
        new Map([[`shared`, { id: `shared`, title: `Current` }]]),
        expected,
      ),
    ).toThrow()
    for (const detail of [`obsolete`, undefined]) {
      expect(() =>
        expectExactSnapshot(
          new Map<string, Todo>([
            [`shared`, { id: `shared`, title: `Current`, detail }],
            [`new`, { id: `new`, title: `New` }],
          ]),
          expected,
        ),
      ).toThrow()
    }
  })

  // Persisted rows are a baseline for newer sync-adapter changes. The maintainer
  // decision recorded in issue-2036-admission-follow-up.md gives accepted sync
  // transactions precedence over that baseline. A persistence read cannot revoke
  // acceptance. A later truncate replay can supersede earlier source writes.
  //
  // A distinct overlap holds a complete read after it has captured the old
  // durable value. A source change submitted during that wait must prevail at
  // settlement after its receipt; the runtime may defer acceptance until the
  // held read ends.
  // The model is the authored baseline followed by one source operation. It
  // crosses same-key replacement/deletion and a new key absent from the read;
  // no intermediate publication timing is assumed before its receipt settles.
  it.each([`insert same`, `insert new`, `update`, `delete`] as const)(
    `keeps a source %s after a captured complete read`,
    async (operation) => {
      const old = { id: `shared`, title: `Persisted` }
      const fresh = {
        id: operation === `insert new` ? `new` : `shared`,
        title: `Source`,
      }
      const expectedRows = new Map<string, Todo>(
        operation === `delete`
          ? []
          : operation === `insert new`
            ? [
                [old.id, structuredClone(old)],
                [fresh.id, structuredClone(fresh)],
              ]
            : [[fresh.id, structuredClone(fresh)]],
      )
      const adapter = createRecordingAdapter([old])
      const originalLoad = adapter.loadSubset.bind(adapter)
      const readEntered = createEventGate()
      const releaseRead = createEventGate()
      adapter.loadSubset = async (...args) => {
        const captured = (await originalLoad(...args)).map((row) => ({
          ...row,
          value: structuredClone(row.value),
        }))
        readEntered.resolve()
        await releaseRead.promise
        return captured
      }
      let source!: TodoSyncParams
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `captured-complete-read-${operation}`,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter },
        }),
      )
      const demand = {}
      let pendingRead: Promise<unknown> | undefined
      let receipt: Promise<unknown> | undefined
      let hasPrimaryFailure = false
      try {
        await collection.stateWhenReady()
        pendingRead = Promise.resolve(collection._sync.loadSubset(demand))
        void pendingRead.catch(() => undefined)
        await atPersistedOracleCheckpoint(
          readEntered.promise,
          `complete read captured durable baseline`,
        )
        source.begin()
        source.write(
          operation === `delete`
            ? { type: `delete`, key: old.id }
            : {
                type: operation.startsWith(`insert`) ? `insert` : `update`,
                value: fresh,
              },
        )
        receipt = Promise.resolve(source.commit())
        void receipt.catch(() => undefined)
        await flushAsyncWork()
        expect(collection.get(old.id)?.title).not.toBe(old.title)
        releaseRead.resolve()
        await atPersistedOracleCheckpoint(
          Promise.all([pendingRead, receipt]),
          `captured complete read and source receipt settled`,
        )
        expectExactSnapshot(
          new Map(
            Array.from(collection.values(), (row) => [
              row.id,
              stripVirtualProps(row),
            ]),
          ),
          expectedRows,
        )
        expectExactSnapshot(adapter.rows, expectedRows)
        expect(collection.status).toBe(`ready`)
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        releaseRead.resolve()
        collection._sync.unloadSubset(demand)
        await cleanupPersistedOracle(
          [
            () => Promise.allSettled([pendingRead, receipt]),
            () => collection.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  // A source transaction binds to a storage read when it commits, so it may
  // stay open across one (decision 12). Its insert is the last write to the
  // row: it follows the read's row, and without metadata it clears the
  // cached row's metadata.
  it(`commits a source transaction that stays open across a hydration cycle`, async () => {
    const adapter = createRecordingAdapter()
    const firstEntered = createEventGate()
    const releaseFirst = createEventGate()
    const secondEntered = createEventGate()
    const releaseSecond = createEventGate()
    let loads = 0
    adapter.loadSubset = async () => {
      loads++
      if (loads === 1) {
        firstEntered.resolve()
        await releaseFirst.promise
        return []
      }
      secondEntered.resolve()
      await releaseSecond.promise
      const value = { id: `shared`, title: `second hydration` }
      adapter.rows.set(value.id, value)
      adapter.rowMetadata.set(value.id, { owner: `second hydration` })
      return [
        {
          key: value.id,
          value,
          metadata: adapter.rowMetadata.get(value.id),
        },
      ]
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `bounded-cross-hydration-source`,
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
    const firstOptions = { limit: 1 }
    const secondOptions = { limit: 2 }
    let hasPrimaryFailure = false

    try {
      await collection.stateWhenReady()
      const first = Promise.resolve(collection._sync.loadSubset(firstOptions))
      await firstEntered.promise
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `shared`, title: `source value` },
      })
      releaseFirst.resolve()
      await first

      const second = Promise.resolve(collection._sync.loadSubset(secondOptions))
      await secondEntered.promise
      const receipt = Promise.resolve(sourceParams.commit())
      releaseSecond.resolve()
      await second
      await receipt

      expect({
        publicRow: stripVirtualProps(collection.get(`shared`)),
        durableRow: adapter.rows.get(`shared`),
        durableMetadata: adapter.rowMetadata.get(`shared`),
        status: collection.status,
      }).toEqual({
        publicRow: { id: `shared`, title: `source value` },
        durableRow: { id: `shared`, title: `source value` },
        durableMetadata: undefined,
        status: `ready`,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseFirst.resolve()
      releaseSecond.resolve()
      collection._sync.unloadSubset(firstOptions)
      collection._sync.unloadSubset(secondOptions)
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  // Decision 12: a transaction begun before a storage read and committed
  // after it applies. Its insert is the last write to the row.
  it(`commits a source transaction begun before hydration and committed after it`, async () => {
    const adapter = createRecordingAdapter()
    const hydrationEntered = createEventGate()
    const releaseHydration = createEventGate()
    adapter.loadSubset = async () => {
      hydrationEntered.resolve()
      await releaseHydration.promise
      const value = { id: `shared`, title: `hydrated value` }
      adapter.rows.set(value.id, value)
      adapter.rowMetadata.set(value.id, { owner: `hydration` })
      return [
        {
          key: value.id,
          value,
          metadata: adapter.rowMetadata.get(value.id),
        },
      ]
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `bounded-hydration-bracketing-source`,
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
    const options = { limit: 1 }
    let hasPrimaryFailure = false

    try {
      await collection.stateWhenReady()
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `shared`, title: `source value` },
      })

      const hydration = Promise.resolve(collection._sync.loadSubset(options))
      await hydrationEntered.promise
      releaseHydration.resolve()
      await hydration

      await Promise.resolve(sourceParams.commit())
      expect({
        publicRow: stripVirtualProps(collection.get(`shared`)),
        durableRow: adapter.rows.get(`shared`),
        durableMetadata: adapter.rowMetadata.get(`shared`),
        status: collection.status,
      }).toEqual({
        publicRow: { id: `shared`, title: `source value` },
        durableRow: { id: `shared`, title: `source value` },
        durableMetadata: undefined,
        status: `ready`,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseHydration.resolve()
      collection._sync.unloadSubset(options)
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  // A row the storage read supplies is a previous run's cache, a seed
  // (decision 9). A source insert without metadata names the whole row, so
  // it clears that row's metadata as it does for any seed (decision 12: a
  // write during a storage read follows the same rules).
  it(`clears a cached row's metadata when the source inserts it during a full reload`, async () => {
    const adapter = createRecordingAdapter()
    adapter.rowMetadata.set(`hydrated`, { source: `persisted` })
    adapter.rowMetadata.set(`new`, { source: `orphaned` })
    const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
    let durableMetadataMutations: Array<unknown> = []
    adapter.applyCommittedTx = async (...args) => {
      durableMetadataMutations = [...(args[1].rowMetadataMutations ?? [])]
      await applyCommittedTx(...args)
    }
    const hydrationEntered = createEventGate()
    const hydration = createEventGate()
    let holdReload = false
    adapter.loadSubset = async () => {
      if (!holdReload) return []
      hydrationEntered.resolve()
      await hydration.promise
      return [
        {
          key: `hydrated`,
          value: { id: `hydrated`, title: `Persisted reload row` },
          metadata: { source: `persisted` },
        },
      ]
    }
    const coordinator = createFailStopCoordinatorHarness(
      `full-reload-hydration-owned-metadata`,
    )
    coordinator.requestApplyCommittedTx = async (collectionId, tx) => {
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        tx,
      )
      return {
        type: `rpc:applyCommittedTx:res`,
        rpcId: tx.txId,
        ok: true,
        term: tx.term,
        seq: tx.seq,
        latestRowVersion: tx.rowVersion,
      }
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `full-reload-hydration-owned-metadata`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            sourceParams = params
            params.markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let receipt: Promise<void> | undefined
    const demand = { limit: 1 }
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `full-reload metadata collection ready`,
      )
      await collection._sync.loadSubset(demand)
      holdReload = true
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `full-reload-metadata`,
        latestRowVersion: 1,
        requiresFullReload: true,
        changedRows: [],
        deletedKeys: [],
      })
      await atPersistedOracleCheckpoint(
        hydrationEntered.promise,
        `full-reload metadata hydration entered`,
      )

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `hydrated`, title: `Source replacement` },
      })
      sourceParams.write({
        type: `insert`,
        value: { id: `new`, title: `Genuinely new row` },
      })

      // Commit only after the reload's runtime marker clears. Ownership must
      // remain attached to the transaction rather than ambient runtime state.
      hydration.resolve()
      await vi.waitFor(() =>
        expect(stripVirtualProps(collection.get(`hydrated`))).toEqual({
          id: `hydrated`,
          title: `Persisted reload row`,
        }),
      )
      receipt = Promise.resolve(sourceParams.commit()).then(() => undefined)
      await atPersistedOracleCheckpoint(
        receipt,
        `full-reload metadata source receipt`,
      )

      expect({
        publicHydrated: stripVirtualProps(collection.get(`hydrated`)),
        publicNew: stripVirtualProps(collection.get(`new`)),
        hydratedMetadata: adapter.rowMetadata.get(`hydrated`),
        newMetadata: adapter.rowMetadata.get(`new`),
        durableMetadataMutations,
      }).toEqual({
        publicHydrated: { id: `hydrated`, title: `Source replacement` },
        publicNew: { id: `new`, title: `Genuinely new row` },
        hydratedMetadata: undefined,
        newMetadata: undefined,
        durableMetadataMutations: [
          { type: `delete`, key: `hydrated` },
          { type: `delete`, key: `new` },
        ],
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      hydration.resolve()
      collection._sync.unloadSubset(demand)
      await cleanupPersistedOracle(
        [() => receipt?.catch(() => undefined), () => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`persists truncate transactions and preserves intended collection metadata`, async () => {
    const adapter = createRecordingAdapter()

    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit: (() => void) | undefined
    let remoteTruncate: (() => void) | undefined
    let remoteMetadata:
      Parameters<SyncConfig<Todo, string>[`sync`]>[0][`metadata`] | undefined

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-truncate`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, truncate, markReady, metadata }) => {
            remoteBegin = begin
            remoteWrite = write as (message: {
              type: `insert`
              value: Todo
            }) => void
            remoteCommit = commit
            remoteTruncate = truncate
            remoteMetadata = metadata
            markReady()
            return {}
          },
        },
        persistence: {
          adapter,
        },
      }),
    )

    await collection.stateWhenReady()
    await flushAsyncWork()

    remoteBegin?.()
    remoteWrite?.({
      type: `insert`,
      value: {
        id: `pre-truncate`,
        title: `Pre truncate`,
      },
    })
    remoteMetadata?.collection.set(`electric:resume`, {
      kind: `reset`,
      updatedAt: 1,
    })
    remoteTruncate?.()
    remoteWrite?.({
      type: `insert`,
      value: {
        id: `post-truncate`,
        title: `Post truncate`,
      },
    })
    remoteCommit?.()
    await flushAsyncWork()

    expect(adapter.applyCommittedTxCalls.at(-1)?.tx.truncate).toBe(true)

    const reloadedCollection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-truncate`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: {
          adapter,
        },
      }),
    )

    await reloadedCollection.preload()
    await flushAsyncWork()

    expect(reloadedCollection.get(`pre-truncate`)).toBeUndefined()
    expect(stripVirtualProps(reloadedCollection.get(`post-truncate`))).toEqual({
      id: `post-truncate`,
      title: `Post truncate`,
    })
    expect(
      reloadedCollection._state.syncedCollectionMetadata.get(`electric:resume`),
    ).toEqual({
      kind: `reset`,
      updatedAt: 1,
    })
  })

  it(`fail-stops an OK seq-gap delta when its application receipt rejects`, async () => {
    const id = `gap-targeted-receipt`
    const receiptError = new Error(`gap targeted receipt failed exactly`)
    const firstApplied = createEventGate()
    const receiptEntered = createEventGate()
    const terminal = createEventGate()
    const fallbackReload = createEventGate()
    const barrierApplied = createEventGate()
    let loadCalls = 0
    const adapter = createRecordingAdapter()
    adapter.loadSubset = async () => {
      loadCalls++
      if (loadCalls > 1) fallbackReload.resolve()
      return []
    }
    const coordinator = createFailStopCoordinatorHarness(id)
    coordinator.pullSince = async () => ({
      type: `rpc:pullSince:res`,
      rpcId: `targeted-replay`,
      ok: true,
      latestTerm: 1,
      latestSeq: 3,
      latestRowVersion: 3,
      requiresFullReload: false,
      changedKeys: [`replayed`],
      deletedKeys: [],
      deltas: [
        {
          txId: `replayed-delta`,
          latestRowVersion: 2,
          changedRows: [
            {
              key: `replayed`,
              value: { id: `replayed`, title: `targeted replay` },
            },
          ],
          deletedKeys: [],
          rowMetadataMutations: [],
          collectionMetadataMutations: [],
        },
      ],
    })
    let rejectNextCommit = false
    let observeNextCommit = false
    let observeBarrierCommit = false
    const baseOptions = persistedCollectionOptions<Todo, string>({
      id,
      getKey: (row) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
      persistence: { adapter, coordinator },
    })
    const baseSync = baseOptions.sync.sync
    const collection = createCollection({
      ...baseOptions,
      sync: {
        ...baseOptions.sync,
        sync: (params) =>
          baseSync({
            ...params,
            commit: (signal) => {
              const actualReceipt = params.commit(signal)
              if (rejectNextCommit) {
                rejectNextCommit = false
                receiptEntered.resolve()
                void Promise.resolve(actualReceipt).catch(() => undefined)
                return Promise.reject(receiptError)
              }
              if (observeNextCommit) {
                observeNextCommit = false
                void Promise.resolve(actualReceipt).then(() =>
                  firstApplied.resolve(),
                )
              }
              if (observeBarrierCommit) {
                observeBarrierCommit = false
                void Promise.resolve(actualReceipt).then(() =>
                  barrierApplied.resolve(),
                )
              }
              return actualReceipt
            },
          }),
      },
    })
    const unsubscribeError = collection.on(`status:crashed`, () => {
      terminal.resolve()
    })
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `targeted gap initial ready`,
      )
      observeNextCommit = true
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `first`,
        latestRowVersion: 1,
        requiresFullReload: false,
        changedRows: [
          { key: `first`, value: { id: `first`, title: `first committed` } },
        ],
        deletedKeys: [],
      })
      await atPersistedOracleCheckpoint(
        firstApplied.promise,
        `targeted gap first transaction applied`,
      )

      rejectNextCommit = true
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 3,
        txId: `gap`,
        latestRowVersion: 3,
        requiresFullReload: false,
        changedRows: [],
        deletedKeys: [],
      })
      await atPersistedOracleCheckpoint(
        receiptEntered.promise,
        `targeted replay receipt entered`,
      )
      const outcome = await atPersistedOracleCheckpoint(
        Promise.race([
          terminal.promise.then(() => ({ kind: `terminal` as const })),
          fallbackReload.promise.then(() => ({ kind: `fallback` as const })),
        ]),
        `targeted terminal error or fallback reload`,
      )
      if (outcome.kind === `fallback`) {
        observeBarrierCommit = true
        coordinator.emit({
          type: `tx:committed`,
          term: 1,
          seq: 4,
          txId: `barrier`,
          latestRowVersion: 4,
          requiresFullReload: false,
          changedRows: [],
          deletedKeys: [],
        })
        await atPersistedOracleCheckpoint(
          barrierApplied.promise,
          `targeted fallback barrier`,
        )
      }

      expect({
        outcome: outcome.kind,
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
        loadCalls,
      }).toEqual({
        outcome: `terminal`,
        status: `crashed`,
        publicError: receiptError,
        loadCalls: 0,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      unsubscribeError()
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`fail-stops an OK seq-gap full reload when adapter loading rejects`, async () => {
    const id = `gap-full-reload-load`
    const loadError = new Error(`gap full reload load failed exactly`)
    const firstApplied = createEventGate()
    const failingLoadEntered = createEventGate()
    const terminal = createEventGate()
    const fallbackReload = createEventGate()
    const barrierApplied = createEventGate()
    let loadCalls = 0
    const adapter = createRecordingAdapter()
    adapter.loadSubset = async () => {
      loadCalls++
      if (loadCalls === 1) {
        failingLoadEntered.resolve()
        throw loadError
      }
      if (loadCalls === 2) fallbackReload.resolve()
      return []
    }
    const coordinator = createFailStopCoordinatorHarness(id)
    coordinator.pullSince = async () => ({
      type: `rpc:pullSince:res`,
      rpcId: `full-reload`,
      ok: true,
      latestTerm: 1,
      latestSeq: 3,
      latestRowVersion: 3,
      requiresFullReload: true,
    })
    let observeNextCommit = false
    let observeBarrierCommit = false
    const baseOptions = persistedCollectionOptions<Todo, string>({
      id,
      getKey: (row) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
      persistence: { adapter, coordinator },
    })
    const baseSync = baseOptions.sync.sync
    const collection = createCollection({
      ...baseOptions,
      sync: {
        ...baseOptions.sync,
        sync: (params) =>
          baseSync({
            ...params,
            commit: (signal) => {
              const actualReceipt = params.commit(signal)
              if (observeNextCommit) {
                observeNextCommit = false
                void Promise.resolve(actualReceipt).then(() =>
                  firstApplied.resolve(),
                )
              }
              if (observeBarrierCommit) {
                observeBarrierCommit = false
                void Promise.resolve(actualReceipt).then(() =>
                  barrierApplied.resolve(),
                )
              }
              return actualReceipt
            },
          }),
      },
    })
    const unsubscribeError = collection.on(`status:crashed`, () => {
      terminal.resolve()
    })
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `full reload gap initial ready`,
      )
      observeNextCommit = true
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `first`,
        latestRowVersion: 1,
        requiresFullReload: false,
        changedRows: [
          { key: `first`, value: { id: `first`, title: `first committed` } },
        ],
        deletedKeys: [],
      })
      await atPersistedOracleCheckpoint(
        firstApplied.promise,
        `full reload gap first transaction applied`,
      )

      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 3,
        txId: `gap`,
        latestRowVersion: 3,
        requiresFullReload: false,
        changedRows: [],
        deletedKeys: [],
      })
      await atPersistedOracleCheckpoint(
        failingLoadEntered.promise,
        `full reload gap failing load entered`,
      )
      const outcome = await atPersistedOracleCheckpoint(
        Promise.race([
          terminal.promise.then(() => ({ kind: `terminal` as const })),
          fallbackReload.promise.then(() => ({ kind: `fallback` as const })),
        ]),
        `full reload terminal error or second fallback reload`,
      )
      if (outcome.kind === `fallback`) {
        observeBarrierCommit = true
        coordinator.emit({
          type: `tx:committed`,
          term: 1,
          seq: 4,
          txId: `barrier`,
          latestRowVersion: 4,
          requiresFullReload: false,
          changedRows: [],
          deletedKeys: [],
        })
        await atPersistedOracleCheckpoint(
          barrierApplied.promise,
          `full reload fallback barrier`,
        )
      }

      expect({
        outcome: outcome.kind,
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
        loadCalls,
      }).toEqual({
        outcome: `terminal`,
        status: `crashed`,
        publicError: loadError,
        loadCalls: 1,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      unsubscribeError()
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`keeps seq-gap pull transport rejection on the fallback path`, async () => {
    const id = `gap-transport-control`
    const transportError = new Error(`gap pull transport failed exactly`)
    const firstApplied = createEventGate()
    const fallbackReload = createEventGate()
    const barrierApplied = createEventGate()
    let loadCalls = 0
    const adapter = createRecordingAdapter()
    adapter.loadSubset = async () => {
      loadCalls++
      if (loadCalls === 1) fallbackReload.resolve()
      return []
    }
    const coordinator = createFailStopCoordinatorHarness(id)
    coordinator.pullSince = async () => {
      throw transportError
    }
    let observeNextCommit = false
    let observeBarrierCommit = false
    const baseOptions = persistedCollectionOptions<Todo, string>({
      id,
      getKey: (row) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
      persistence: { adapter, coordinator },
    })
    const baseSync = baseOptions.sync.sync
    const collection = createCollection({
      ...baseOptions,
      sync: {
        ...baseOptions.sync,
        sync: (params) =>
          baseSync({
            ...params,
            commit: (signal) => {
              const actualReceipt = params.commit(signal)
              if (observeNextCommit) {
                observeNextCommit = false
                void Promise.resolve(actualReceipt).then(() =>
                  firstApplied.resolve(),
                )
              }
              if (observeBarrierCommit) {
                observeBarrierCommit = false
                void Promise.resolve(actualReceipt).then(() =>
                  barrierApplied.resolve(),
                )
              }
              return actualReceipt
            },
          }),
      },
    })
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `transport gap initial ready`,
      )
      observeNextCommit = true
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `first`,
        latestRowVersion: 1,
        requiresFullReload: false,
        changedRows: [
          { key: `first`, value: { id: `first`, title: `first committed` } },
        ],
        deletedKeys: [],
      })
      await atPersistedOracleCheckpoint(
        firstApplied.promise,
        `transport gap first transaction applied`,
      )

      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 3,
        txId: `gap`,
        latestRowVersion: 3,
        requiresFullReload: false,
        changedRows: [],
        deletedKeys: [],
      })
      await atPersistedOracleCheckpoint(
        fallbackReload.promise,
        `transport gap fallback reload`,
      )
      observeBarrierCommit = true
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 4,
        txId: `barrier`,
        latestRowVersion: 4,
        requiresFullReload: false,
        changedRows: [],
        deletedKeys: [],
      })
      await atPersistedOracleCheckpoint(
        barrierApplied.promise,
        `transport fallback barrier`,
      )

      expect(warning).toHaveBeenCalledWith(
        `Failed pullSince recovery attempt:`,
        transportError,
      )
      expect({
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
        loadCalls,
      }).toEqual({
        status: `ready`,
        publicError: undefined,
        loadCalls: 1,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      warning.mockRestore()
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`uses pullSince recovery when tx sequence gaps are detected`, async () => {
    const adapter = createRecordingAdapter([
      {
        id: `1`,
        title: `Initial`,
      },
    ])
    const coordinator = createCoordinatorHarness()
    coordinator.setPullSinceResponse({
      type: `rpc:pullSince:res`,
      rpcId: `pull-1`,
      ok: true,
      latestTerm: 1,
      latestSeq: 3,
      latestRowVersion: 3,
      requiresFullReload: false,
      changedKeys: [`2`],
      deletedKeys: [],
    })

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    await collection.preload()

    adapter.rows.set(`2`, {
      id: `2`,
      title: `Recovered`,
    })

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-1`,
      latestRowVersion: 1,
      requiresFullReload: false,
      changedRows: [{ key: `1`, value: { id: `1`, title: `Initial` } }],
      deletedKeys: [],
    })

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 3,
      txId: `tx-3`,
      latestRowVersion: 3,
      requiresFullReload: false,
      changedRows: [{ key: `2`, value: { id: `2`, title: `Recovered` } }],
      deletedKeys: [],
    })

    await flushAsyncWork()
    await flushAsyncWork()

    expect(coordinator.pullSinceCalls).toBe(1)
    expect(stripVirtualProps(collection.get(`2`))).toEqual({
      id: `2`,
      title: `Recovered`,
    })
  })

  it(`removes deleted rows after tx:committed invalidation reload`, async () => {
    const adapter = createRecordingAdapter([
      { id: `1`, title: `Keep` },
      { id: `2`, title: `Delete` },
    ])
    const coordinator = createCoordinatorHarness()

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    await collection.preload()
    await flushAsyncWork()
    expect(stripVirtualProps(collection.get(`2`))).toEqual({
      id: `2`,
      title: `Delete`,
    })

    adapter.rows.delete(`2`)

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-delete`,
      latestRowVersion: 1,
      requiresFullReload: false,
      changedRows: [],
      deletedKeys: [`2`],
    })

    await flushAsyncWork()
    await flushAsyncWork()

    expect(collection.get(`2`)).toBeUndefined()
  })

  it(`does not let a stale invalidation reload overwrite a restarted lifecycle`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `Initial` }])
    const coordinator = createCoordinatorHarness()
    const originalLoadSubset = adapter.loadSubset.bind(adapter)
    let loadCalls = 0
    let releaseStaleReload!: () => void
    const staleReloadGate = new Promise<void>((resolve) => {
      releaseStaleReload = resolve
    })
    adapter.loadSubset = async (...args) => {
      loadCalls++
      if (loadCalls === 1) {
        await staleReloadGate
        return [
          {
            key: `1`,
            value: { id: `1`, title: `Stale reload` },
          },
        ]
      }
      return originalLoadSubset(...args)
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    await collection.preload()
    await flushAsyncWork()
    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-stale-reload`,
      latestRowVersion: 1,
      requiresFullReload: true,
    })
    for (let attempt = 0; attempt < 20 && loadCalls < 1; attempt++) {
      await flushAsyncWork()
    }
    expect(loadCalls).toBe(1)

    await collection.cleanup()
    adapter.rows.set(`1`, { id: `1`, title: `Restarted` })
    collection.startSyncImmediate()
    releaseStaleReload()
    expect(collection.get(`1`)?.title).not.toBe(`Stale reload`)

    for (
      let attempt = 0;
      attempt < 20 && collection.get(`1`)?.title !== `Restarted`;
      attempt++
    ) {
      await flushAsyncWork()
    }
    expect(stripVirtualProps(collection.get(`1`))).toEqual({
      id: `1`,
      title: `Restarted`,
    })
    await collection.cleanup()
  })

  it(`does not let stale reload metadata start row loading after restart`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `Initial` }])
    const coordinator = createCoordinatorHarness()
    const originalLoadCollectionMetadata =
      adapter.loadCollectionMetadata!.bind(adapter)
    const originalLoadSubset = adapter.loadSubset.bind(adapter)
    let metadataCalls = 0
    let subsetCalls = 0
    let releaseStaleMetadata!: () => void
    const staleMetadataGate = new Promise<void>((resolve) => {
      releaseStaleMetadata = resolve
    })
    adapter.loadCollectionMetadata = async (...args) => {
      metadataCalls++
      if (metadataCalls === 1) await staleMetadataGate
      return originalLoadCollectionMetadata(...args)
    }
    adapter.loadSubset = async (...args) => {
      subsetCalls++
      return originalLoadSubset(...args)
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    await collection.preload()
    await flushAsyncWork()
    expect(metadataCalls).toBe(0)
    expect(subsetCalls).toBe(0)

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-stale-metadata`,
      latestRowVersion: 1,
      requiresFullReload: true,
    })
    for (let attempt = 0; attempt < 20 && metadataCalls < 1; attempt++) {
      await flushAsyncWork()
    }
    expect(metadataCalls).toBe(1)
    expect(subsetCalls).toBe(0)

    await collection.cleanup()
    adapter.rows.set(`1`, { id: `1`, title: `Restarted` })
    collection.startSyncImmediate()
    releaseStaleMetadata()
    for (
      let attempt = 0;
      attempt < 20 && collection.get(`1`)?.title !== `Restarted`;
      attempt++
    ) {
      await flushAsyncWork()
    }

    expect(metadataCalls).toBe(1)
    expect(subsetCalls).toBe(0)
    expect(stripVirtualProps(collection.get(`1`))).toEqual({
      id: `1`,
      title: `Restarted`,
    })
    await collection.cleanup()
  })

  it.each(
    [false, true].flatMap((sharedSubscription) =>
      [false, true].map((identical) => ({ sharedSubscription, identical })),
    ),
  )(
    `keeps sibling requests owned after one release: %j`,
    async ({ sharedSubscription, identical }) => {
      const adapter = createRecordingAdapter([
        { id: `1`, title: `Page row` },
        { id: `2`, title: `All-only row` },
      ])
      // This finite provider honors the only selection this law generates.
      const loadRows = adapter.loadSubset
      adapter.loadSubset = async (...args) => {
        const rows = await loadRows(...args)
        return rows.slice(0, args[1].limit)
      }
      const coordinator = createCoordinatorHarness()
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `sync-present`,
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
      collection.startSyncImmediate()
      const subscription = collection.subscribeChanges(() => {})
      const owner = sharedSubscription ? { subscription } : {}
      const page: LoadSubsetOptions = {
        ...owner,
        ...(identical ? {} : { limit: 1 }),
      }
      const all: LoadSubsetOptions = { ...owner }
      try {
        await collection._sync.loadSubset(page)
        expect([...collection.keys()]).toEqual(identical ? [`1`, `2`] : [`1`])
        await collection._sync.loadSubset(all)
        expect([...collection.keys()]).toEqual([`1`, `2`])
        collection._sync.unloadSubset(page)
        adapter.rows.set(`2`, { id: `2`, title: `After page release` })
        const beforeReload = adapter.loadSubsetCalls.length
        coordinator.emit({
          type: `tx:committed`,
          term: 1,
          seq: 1,
          txId: `sibling-update`,
          latestRowVersion: 1,
          requiresFullReload: true,
        })
        await flushAsyncWork()
        await flushAsyncWork()
        expect(
          adapter.loadSubsetCalls
            .slice(beforeReload)
            .map(({ options }) => options.limit),
        ).toEqual([undefined])
        expect([...collection.values()].map(stripVirtualProps)).toEqual([
          { id: `1`, title: `Page row` },
          { id: `2`, title: `After page release` },
        ])
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )
})
