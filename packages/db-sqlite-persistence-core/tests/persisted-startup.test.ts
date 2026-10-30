/**
 * Ordinary tests for persistedCollectionOptions startup: descriptor and runtime ownership, startup metadata reload, and sync-config validation, as fixed scenarios. The startup and ownership laws they touch are owned by persisted-oracle.test.ts, which keeps its generated and model-checked cases.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  BasicIndex,
  DbClient,
  collectionOptions,
  createCollection,
  createTransaction,
} from '@tanstack/db'
import {
  IndeterminateCommitError,
  InvalidPersistedCollectionConfigError,
  InvalidSyncConfigError,
  persistedCollectionOptions,
} from '../src'
import {
  atPersistedOracleCheckpoint,
  cleanupPersistedOracle,
  createCoordinatorHarness,
  createEventGate,
  createNoopAdapter,
  createRecordingAdapter,
  flushAsyncWork,
  stripVirtualProps,
} from './persisted-support'
import type { PersistedSyncWrappedOptions } from '../src'
import type { Todo, TodoSyncParams } from './persisted-support'

describe(`persistedCollectionOptions`, () => {
  // A descriptor's one-owner claim is consumed by a constructed Collection,
  // not by a constructor attempt that failed before binding the runtime.
  // The independent admission model has unclaimed and claimed states; this
  // invalid-then-corrected history must remain unclaimed after the first
  // throw. The checkpoint is the second createCollection call and its later
  // durable write. A successful first construction is checked below.
  it(`permits a corrected descriptor after construction fails before owner binding`, async () => {
    const adapter = createRecordingAdapter()
    const options = persistedCollectionOptions<Todo, string>({
      id: `failed-construction-retry`,
      getKey: (row) => row.id,
      autoIndex: `eager`,
      persistence: { adapter },
    })
    expect(() => createCollection(options)).toThrow(/autoIndex/)
    options.defaultIndexType = BasicIndex
    const collection = createCollection(options)
    let unexpectedThird: typeof collection | undefined
    let hasPrimaryFailure = false
    try {
      await collection.stateWhenReady()
      expect(() => {
        unexpectedThird = createCollection(options)
      }).toThrow(InvalidPersistedCollectionConfigError)
      const receipt = collection.insert({ id: `owned`, title: `Retried owner` })
      await receipt.when('settled')
      expect(stripVirtualProps(collection.get(`owned`))).toEqual({
        id: `owned`,
        title: `Retried owner`,
      })
      expect(adapter.rows.get(`owned`)).toEqual({
        id: `owned`,
        title: `Retried owner`,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      await cleanupPersistedOracle(
        [() => unexpectedThird?.cleanup(), () => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  // Law: only a successfully constructed Collection consumes an options
  // descriptor. The same unclaimed -> claimed admission model applies if a
  // synchronous collaborator fails after sync startup begins. The first
  // attempt must expose that failure; after correction, the same descriptor
  // must construct and persist normally. This tests the public constructor
  // and durability receipt, rather than inspecting the private claim flag.
  // Both local-only and wrapped-source startup bind through distinct paths.
  // A subscription ledger checks that the failed attempt has no live listener,
  // the corrected owner has one, and cleanup releases it.
  it.each([`local-only`, `wrapped source`] as const)(
    `permits a corrected %s descriptor after sync-start construction fails`,
    async (mode) => {
      const adapter = createRecordingAdapter()
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
      const subscribe = coordinator.subscribe.bind(coordinator)
      const fault = new Error(`coordinator subscription failed`)
      let failSubscription = true
      let activeSubscriptions = 0
      coordinator.subscribe = (...args) => {
        if (failSubscription) throw fault
        const unsubscribe = subscribe(...args)
        activeSubscriptions++
        return () => {
          activeSubscriptions--
          unsubscribe()
        }
      }
      const base = {
        id: `failed-sync-start-construction-retry-${mode}`,
        getKey: (row: Todo) => row.id,
        startSync: true as const,
        persistence: { adapter, coordinator },
      }
      let source!: TodoSyncParams
      const construct =
        mode === `wrapped source`
          ? (() => {
              const options = persistedCollectionOptions<Todo, string>({
                ...base,
                sync: {
                  sync: (params) => {
                    source = params
                    params.markReady()
                  },
                },
              })
              return () => createCollection(options)
            })()
          : (() => {
              const options = persistedCollectionOptions<Todo, string>(base)
              return () => createCollection(options)
            })()
      expect(construct).toThrow(fault)
      expect(activeSubscriptions).toBe(0)
      failSubscription = false
      const collection = construct()
      let unexpectedThird: typeof collection | undefined
      let hasPrimaryFailure = false
      try {
        await collection.stateWhenReady()
        expect(activeSubscriptions).toBe(1)
        if (mode === `wrapped source`) await flushAsyncWork()
        expect(() => {
          unexpectedThird = construct()
        }).toThrow(InvalidPersistedCollectionConfigError)
        const row = { id: `owned`, title: `Retried owner` }
        if (mode === `wrapped source`) {
          source.begin()
          source.write({ type: `insert`, value: row })
          await source.commit()
        } else {
          await collection.insert(row).when('settled')
        }
        expect(stripVirtualProps(collection.get(`owned`))).toEqual({
          id: `owned`,
          title: `Retried owner`,
        })
        expect(adapter.rows.get(`owned`)).toEqual({
          id: `owned`,
          title: `Retried owner`,
        })
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        await cleanupPersistedOracle(
          [
            () => unexpectedThird?.cleanup(),
            () => collection.cleanup(),
            () => {
              expect(activeSubscriptions).toBe(0)
            },
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  // A persisted options descriptor owns one mutable runtime. The independent
  // ownership rule is one Collection per descriptor, including a spread copy:
  // copying fields cannot create a second runtime. The public creation boundary
  // must reject the second Collection before it can redirect the first one's
  // writes. Fresh descriptors remain legal and are covered elsewhere here and
  // by DbClient materialization. The checkpoint is createCollection itself,
  // then the first owner's durable receipt and public row after the rejection.
  it.each([`same object`, `spread copy`] as const)(
    `keeps one persisted options runtime bound to its first Collection (%s)`,
    async (reuse) => {
      const adapter = createRecordingAdapter()
      const options = persistedCollectionOptions<Todo, string>({
        id: `one-owner-${reuse}`,
        getKey: (row) => row.id,
        persistence: { adapter },
      })
      const first = createCollection(options)
      let second: typeof first | undefined
      let hasPrimaryFailure = false
      try {
        await first.stateWhenReady()
        expect(() => {
          second = createCollection(
            reuse === `same object` ? options : { ...options },
          )
        }).toThrow(InvalidPersistedCollectionConfigError)

        const receipt = first.insert({ id: `owned`, title: `First owner` })
        await receipt.when('settled')
        expect(stripVirtualProps(first.get(`owned`))).toEqual({
          id: `owned`,
          title: `First owner`,
        })
        expect(adapter.rows.get(`owned`)).toEqual({
          id: `owned`,
          title: `First owner`,
        })
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        await cleanupPersistedOracle(
          [() => second?.cleanup(), () => first.cleanup()],
          hasPrimaryFailure,
        )
      }
    },
  )

  // The same ownership rule applies when an upstream sync source is wrapped.
  // A source commit through the first Collection must remain public and durable
  // after a second Collection is rejected at admission.
  it.each([`same object`, `spread copy`] as const)(
    `keeps a wrapped sync source bound to its first Collection (%s)`,
    async (reuse) => {
      const adapter = createRecordingAdapter()
      let source!: TodoSyncParams
      const options = persistedCollectionOptions<Todo, string>({
        id: `one-source-owner-${reuse}`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
          },
        },
        persistence: { adapter },
      })
      const first = createCollection(options)
      let second: typeof first | undefined
      let hasPrimaryFailure = false
      try {
        await first.stateWhenReady()
        expect(() => {
          second = createCollection(
            reuse === `same object` ? options : { ...options },
          )
        }).toThrow(InvalidPersistedCollectionConfigError)

        source.begin()
        source.write({
          type: `insert`,
          value: { id: `owned`, title: `First source` },
        })
        await Promise.resolve(source.commit())
        expect(stripVirtualProps(first.get(`owned`))).toEqual({
          id: `owned`,
          title: `First source`,
        })
        expect(adapter.rows.get(`owned`)).toEqual({
          id: `owned`,
          title: `First source`,
        })
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        await cleanupPersistedOracle(
          [() => second?.cleanup(), () => first.cleanup()],
          hasPrimaryFailure,
        )
      }
    },
  )

  // Selecting only the public sync config bypasses the descriptor's claim.
  // The runtime's fallback guard must reject that second Collection before
  // changing the first owner's controls. This is a legal JavaScript copy of
  // the exposed config, not a second independent persisted options runtime.
  it.each([`local-only`, `sync-present`] as const)(
    `preserves the first owner after a copied sync config is rejected (%s)`,
    async (mode) => {
      const adapter = createRecordingAdapter()
      let source!: TodoSyncParams
      const base = {
        id: `selected-sync-${mode}`,
        getKey: (row: Todo) => row.id,
        persistence: { adapter },
      }
      // Each branch creates its Collection from one options type, so the
      // call never resolves overloads against a union.
      const syncOptions =
        mode === `sync-present`
          ? persistedCollectionOptions<Todo, string>({
              ...base,
              sync: {
                sync: (params) => {
                  source = params
                  params.markReady()
                },
              },
            })
          : undefined
      const localOptions = syncOptions
        ? undefined
        : persistedCollectionOptions<Todo, string>(base)
      const options = syncOptions ?? localOptions!
      const first = syncOptions
        ? createCollection(syncOptions)
        : createCollection(localOptions!)
      const second = createCollection({
        id: `unclaimed-${mode}`,
        getKey: (row: Todo) => row.id,
        sync: options.sync,
        startSync: false,
      })
      let hasPrimaryFailure = false
      try {
        await first.stateWhenReady()
        if (mode === `sync-present`) {
          source.begin()
          source.write({
            type: `insert`,
            value: { id: `owned`, title: `First source` },
          })
        }
        expect(() => second.startSyncImmediate()).toThrow(
          InvalidPersistedCollectionConfigError,
        )

        if (mode === `sync-present`) {
          await Promise.resolve(source.commit())
        } else {
          await first
            .insert({ id: `owned`, title: `First owner` })
            .when('settled')
        }
        expect(first.has(`owned`)).toBe(true)
        expect(second.has(`owned`)).toBe(false)
        expect(adapter.rows.get(`owned`)?.id).toBe(`owned`)
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        await cleanupPersistedOracle(
          [() => second.cleanup(), () => first.cleanup()],
          hasPrimaryFailure,
        )
      }
    },
  )

  // Construction, rather than first sync startup, assigns the descriptor's
  // Collection owner. A lazy wrapped source leaves a legal interval in which a
  // second Collection can select only its public sync field and start first.
  // The independent admission rule still gives the first constructed owner
  // the runtime; the selected copy must fail before it installs controls.
  it(`rejects a selected sync that starts before its lazy descriptor owner`, async () => {
    const adapter = createRecordingAdapter()
    let source!: TodoSyncParams
    const options = persistedCollectionOptions<Todo, string>({
      id: `lazy-selected-sync-owner`,
      getKey: (row) => row.id,
      startSync: false,
      sync: {
        sync: (params) => {
          source = params
          params.markReady()
        },
      },
      persistence: { adapter },
    })
    const first = createCollection(options)
    const selected = createCollection({
      id: `lazy-selected-sync-copy`,
      getKey: (row: Todo) => row.id,
      sync: options.sync,
      startSync: false,
    })
    let hasPrimaryFailure = false
    try {
      expect(() => selected.startSyncImmediate()).toThrow(
        InvalidPersistedCollectionConfigError,
      )
      first.startSyncImmediate()
      await first.stateWhenReady()
      source.begin()
      source.write({
        type: `insert`,
        value: { id: `owned`, title: `Original owner` },
      })
      await Promise.resolve(source.commit())
      expect(stripVirtualProps(first.get(`owned`))).toEqual({
        id: `owned`,
        title: `Original owner`,
      })
      expect(selected.has(`owned`)).toBe(false)
      expect(adapter.rows.get(`owned`)).toEqual({
        id: `owned`,
        title: `Original owner`,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      await cleanupPersistedOracle(
        [() => selected.cleanup(), () => first.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not reuse a persisted runtime after its Collection cleans up`, async () => {
    const options = persistedCollectionOptions<Todo, string>({
      id: `cleaned-up-owner`,
      getKey: (row) => row.id,
      persistence: { adapter: createRecordingAdapter() },
    })
    const first = createCollection(options)
    await first.cleanup()
    expect(() => createCollection(options)).toThrow(
      InvalidPersistedCollectionConfigError,
    )
  })

  // Cleanup ends a sync run, not the descriptor's permanent Collection claim.
  // Selecting only the wrapped sync field omits the public claim hook, so this
  // history checks the runtime guard after cleanup and the original owner's
  // ability to restart. The two modes cross local and upstream source controls.
  it.each([`local-only`, `sync-present`] as const)(
    `rejects a copied sync owner after cleanup and permits the first owner to restart (%s)`,
    async (mode) => {
      const adapter = createRecordingAdapter()
      let source!: TodoSyncParams
      const base = {
        id: `cleaned-selected-sync-${mode}`,
        getKey: (row: Todo) => row.id,
        persistence: { adapter },
      }
      // Each branch creates its Collection from one options type, so the
      // call never resolves overloads against a union.
      const syncOptions =
        mode === `sync-present`
          ? persistedCollectionOptions<Todo, string>({
              ...base,
              sync: {
                sync: (params) => {
                  source = params
                  params.markReady()
                },
              },
            })
          : undefined
      const localOptions = syncOptions
        ? undefined
        : persistedCollectionOptions<Todo, string>(base)
      const options = syncOptions ?? localOptions!
      const first = syncOptions
        ? createCollection(syncOptions)
        : createCollection(localOptions!)
      const second = createCollection({
        id: `post-cleanup-copy-${mode}`,
        getKey: (row: Todo) => row.id,
        sync: options.sync,
        startSync: false,
      })
      let hasPrimaryFailure = false
      try {
        await first.stateWhenReady()
        await first.cleanup()
        expect(() => second.startSyncImmediate()).toThrow(
          InvalidPersistedCollectionConfigError,
        )

        const replacementReady = createEventGate()
        const unsubscribe = first.on(`status:ready`, () =>
          replacementReady.resolve(),
        )
        try {
          first.startSyncImmediate()
          await atPersistedOracleCheckpoint(
            replacementReady.promise,
            `original persisted owner restarts`,
          )
        } finally {
          unsubscribe()
        }

        if (mode === `sync-present`) {
          source.begin()
          source.write({
            type: `insert`,
            value: { id: `after-restart`, title: `First source` },
          })
          await Promise.resolve(source.commit())
        } else {
          await first
            .insert({ id: `after-restart`, title: `First owner` })
            .when('settled')
        }
        expect(first.has(`after-restart`)).toBe(true)
        expect(second.has(`after-restart`)).toBe(false)
        expect(adapter.rows.get(`after-restart`)?.id).toBe(`after-restart`)
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        await cleanupPersistedOracle(
          [() => second.cleanup(), () => first.cleanup()],
          hasPrimaryFailure,
        )
      }
    },
  )

  it(`materializes one independent persisted runtime for each DbClient`, async () => {
    const adapter = createRecordingAdapter([{ id: `stored`, title: `Stored` }])
    const descriptor = collectionOptions(
      persistedCollectionOptions<Todo, string>({
        id: `client-owned-persistence`,
        getKey: (row) => row.id,
        persistence: { adapter },
      }),
    )
    const firstClient = new DbClient()
    const secondClient = new DbClient()
    let hasPrimaryFailure = false
    try {
      const first = firstClient.collection(descriptor)
      const second = secondClient.collection(descriptor)
      expect(first).not.toBe(second)
      await Promise.all([first.stateWhenReady(), second.stateWhenReady()])
      expect(stripVirtualProps(first.get(`stored`))).toEqual({
        id: `stored`,
        title: `Stored`,
      })
      expect(stripVirtualProps(second.get(`stored`))).toEqual({
        id: `stored`,
        title: `Stored`,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      await cleanupPersistedOracle(
        [() => secondClient.cleanup(), () => firstClient.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`preserves exact reconciliation context for an indeterminate commit`, () => {
    const cause = new Error(`response channel closed`)
    const error = new IndeterminateCommitError({
      collectionId: `todos`,
      requestType: `rpc:applyCommittedTx:req`,
      previousLeaderId: `leader-a`,
      previousTerm: 4,
      currentLeaderId: `leader-b`,
      currentTerm: 5,
      cause,
    })

    expect(error).toMatchObject({
      name: `IndeterminateCommitError`,
      code: `INDETERMINATE_COMMIT`,
      collectionId: `todos`,
      requestType: `rpc:applyCommittedTx:req`,
      previousLeaderId: `leader-a`,
      previousTerm: 4,
      currentLeaderId: `leader-b`,
      currentTerm: 5,
      cause,
    })
    expect(error.message).toContain(
      `rpc:applyCommittedTx:req crossed leadership from leader-a (term 4) to leader-b (term 5)`,
    )
  })

  it(`provides a sync-absent loopback configuration with persisted utils`, async () => {
    const adapter = createRecordingAdapter()
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `persisted-loopback`,
        getKey: (item) => item.id,
        persistence: {
          adapter,
        },
      }),
    )

    const insertTx = collection.insert({
      id: `1`,
      title: `Phase 0`,
    })

    await insertTx.when('settled')

    expect(stripVirtualProps(collection.get(`1`))).toEqual({
      id: `1`,
      title: `Phase 0`,
    })
    expect(adapter.applyCommittedTxCalls).toHaveLength(1)
    expect(adapter.applyCommittedTxCalls[0]?.tx.mutations[0]?.type).toBe(
      `insert`,
    )
    expect(typeof collection.utils.acceptMutations).toBe(`function`)
    expect(collection.utils.getLeadershipState?.().isLeader).toBe(true)
  })

  it(`hydrates a local-only baseline after a managed write advances startup evidence`, async () => {
    const adapter = createRecordingAdapter([
      { id: `baseline`, title: `Persisted before startup` },
    ])
    const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
    let releaseInitialSnapshot!: () => void
    const initialSnapshotRelease = new Promise<void>((resolve) => {
      releaseInitialSnapshot = resolve
    })
    let reportInitialSnapshot!: () => void
    const initialSnapshotCaptured = new Promise<void>((resolve) => {
      reportInitialSnapshot = resolve
    })
    let snapshotCalls = 0
    adapter.loadResumeSnapshot = async (...args) => {
      const snapshot = await loadResumeSnapshot(...args)
      snapshotCalls++
      if (snapshotCalls === 1) {
        reportInitialSnapshot()
        await initialSnapshotRelease
      }
      return snapshot
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `local-only-startup-write`,
        startSync: false,
        getKey: (item) => item.id,
        persistence: { adapter },
      }),
    )

    try {
      collection.startSyncImmediate()
      await initialSnapshotCaptured

      const insert = collection.insert({
        id: `concurrent`,
        title: `Managed during startup`,
      })
      releaseInitialSnapshot()
      await insert.when('settled')
      await collection.stateWhenReady()
      await vi.waitFor(() => expect(snapshotCalls).toBeGreaterThanOrEqual(2))

      expect(
        Array.from(collection.values(), (row) => stripVirtualProps(row)).sort(
          (left, right) => left.id.localeCompare(right.id),
        ),
      ).toEqual([
        { id: `baseline`, title: `Persisted before startup` },
        { id: `concurrent`, title: `Managed during startup` },
      ])
    } finally {
      releaseInitialSnapshot()
      await collection.cleanup()
    }
  })

  it(`supports acceptMutations for manual transactions`, async () => {
    const adapter = createRecordingAdapter()
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `persisted-manual`,
        getKey: (item) => item.id,
        persistence: {
          adapter,
        },
      }),
    )

    const tx = createTransaction({
      autoCommit: false,
      mutationFn: async ({ transaction }) => {
        await collection.utils.acceptMutations(transaction)
      },
    })

    tx.mutate(() => {
      collection.insert({
        id: `manual-1`,
        title: `Manual`,
      })
    })

    await tx.commit()

    expect(stripVirtualProps(collection.get(`manual-1`))).toEqual({
      id: `manual-1`,
      title: `Manual`,
    })
    expect(adapter.applyCommittedTxCalls).toHaveLength(1)
  })

  it(`loads collection metadata into collection state during startup`, async () => {
    const adapter = createRecordingAdapter()
    adapter.collectionMetadata.set(`electric:resume`, {
      kind: `resume`,
      offset: `10_0`,
      handle: `handle-1`,
      shapeId: `shape-1`,
      updatedAt: 1,
    })

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `persisted-startup-metadata`,
        getKey: (item) => item.id,
        persistence: {
          adapter,
        },
      }),
    )

    await collection.stateWhenReady()

    expect(adapter.loadResumeSnapshotCalls[0]).toMatchObject({
      collectionId: `persisted-startup-metadata`,
      includeRows: false,
    })
    expect(
      collection._state.syncedCollectionMetadata.get(`electric:resume`),
    ).toEqual({
      kind: `resume`,
      offset: `10_0`,
      handle: `handle-1`,
      shapeId: `shape-1`,
      updatedAt: 1,
    })
  })

  it(`restores row and collection metadata after metadata-bearing full reload`, async () => {
    const adapter = createRecordingAdapter([
      {
        id: `1`,
        title: `Tracked`,
      },
    ])
    adapter.rowMetadata.set(`1`, {
      source: `initial`,
    })
    adapter.collectionMetadata.set(`electric:resume`, {
      kind: `resume`,
      offset: `10_0`,
      handle: `handle-1`,
      shapeId: `shape-1`,
      updatedAt: 1,
    })
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

    expect(collection._state.syncedMetadata.get(`1`)).toEqual({
      source: `initial`,
    })
    expect(
      collection._state.syncedCollectionMetadata.get(`electric:resume`),
    ).toEqual({
      kind: `resume`,
      offset: `10_0`,
      handle: `handle-1`,
      shapeId: `shape-1`,
      updatedAt: 1,
    })

    adapter.rowMetadata.set(`1`, {
      source: `reloaded`,
    })
    adapter.collectionMetadata.delete(`electric:resume`)
    adapter.collectionMetadata.set(`queryCollection:gc:q1`, {
      queryHash: `q1`,
      mode: `until-revalidated`,
    })

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-reload`,
      latestRowVersion: 1,
      requiresFullReload: true,
    })

    await flushAsyncWork()
    await flushAsyncWork()

    expect(collection._state.syncedMetadata.get(`1`)).toEqual({
      source: `reloaded`,
    })
    expect(
      collection._state.syncedCollectionMetadata.has(`electric:resume`),
    ).toBe(false)
    expect(
      collection._state.syncedCollectionMetadata.get(`queryCollection:gc:q1`),
    ).toEqual({
      queryHash: `q1`,
      mode: `until-revalidated`,
    })
  })

  it(`persists metadata-only wrapped sync transactions`, async () => {
    const adapter = createRecordingAdapter()

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `persisted-metadata-only`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, commit, markReady, metadata }) => {
            begin()
            metadata?.collection.set(`runtime:key`, { persisted: true })
            commit()
            markReady()
          },
        },
        persistence: {
          adapter,
        },
      }),
    )

    await collection.stateWhenReady()
    await flushAsyncWork()

    expect(adapter.applyCommittedTxCalls).toHaveLength(1)
    expect(adapter.applyCommittedTxCalls[0]?.tx.mutations).toEqual([])
    expect(adapter.collectionMetadata.get(`runtime:key`)).toEqual({
      persisted: true,
    })
    expect(
      collection._state.syncedCollectionMetadata.get(`runtime:key`),
    ).toEqual({
      persisted: true,
    })
  })

  it(`replays metadata-only tx:committed deltas without full reload`, async () => {
    const adapter = createRecordingAdapter([
      {
        id: `1`,
        title: `Tracked`,
      },
    ])
    adapter.rowMetadata.set(`1`, { source: `initial` })
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
    const loadSubsetCallsAfterPreload = adapter.loadSubsetCalls.length

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-metadata-only`,
      // The seeded row has no stream position; this is its first contiguous
      // notification. A jump to version 2 would correctly require recovery.
      latestRowVersion: 1,
      requiresFullReload: false,
      changedRows: [],
      deletedKeys: [],
      rowMetadataMutations: [
        {
          type: `set`,
          key: `1`,
          value: { source: `replayed` },
        },
      ],
      collectionMetadataMutations: [
        {
          type: `set`,
          key: `electric:resume`,
          value: {
            kind: `reset`,
            updatedAt: 2,
          },
        },
      ],
    })

    await flushAsyncWork()
    await flushAsyncWork()

    expect(adapter.loadSubsetCalls.length).toBe(loadSubsetCallsAfterPreload)
    expect(collection._state.syncedMetadata.get(`1`)).toEqual({
      source: `replayed`,
    })
    expect(
      collection._state.syncedCollectionMetadata.get(`electric:resume`),
    ).toEqual({
      kind: `reset`,
      updatedAt: 2,
    })
  })

  it(`uses pullSince replay deltas for metadata-bearing seq-gap recovery`, async () => {
    const adapter = createRecordingAdapter([
      {
        id: `1`,
        title: `Tracked`,
      },
    ])
    adapter.rowMetadata.set(`1`, { source: `initial` })
    const coordinator = createCoordinatorHarness()
    coordinator.setPullSinceResponse({
      type: `rpc:pullSince:res`,
      rpcId: `pull-metadata`,
      ok: true,
      latestTerm: 1,
      latestSeq: 3,
      latestRowVersion: 3,
      requiresFullReload: false,
      changedKeys: [],
      deletedKeys: [],
      deltas: [
        {
          txId: `tx-gap-1`,
          latestRowVersion: 2,
          changedRows: [],
          deletedKeys: [],
          rowMetadataMutations: [
            {
              type: `set`,
              key: `1`,
              value: { source: `gap-replayed` },
            },
          ],
          collectionMetadataMutations: [],
        },
        {
          txId: `tx-gap-2`,
          latestRowVersion: 3,
          changedRows: [],
          deletedKeys: [],
          rowMetadataMutations: [],
          collectionMetadataMutations: [
            {
              type: `set`,
              key: `queryCollection:gc:q1`,
              value: {
                queryHash: `q1`,
                mode: `until-revalidated`,
              },
            },
          ],
        },
      ],
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
    await flushAsyncWork()
    const loadSubsetCallsAfterPreload = adapter.loadSubsetCalls.length

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 3,
      txId: `tx-gap-trigger`,
      latestRowVersion: 3,
      requiresFullReload: false,
      changedRows: [],
      deletedKeys: [],
    })

    await flushAsyncWork()
    await flushAsyncWork()

    expect(coordinator.pullSinceCalls).toBe(1)
    expect(adapter.loadSubsetCalls.length).toBe(loadSubsetCallsAfterPreload)
    expect(collection._state.syncedMetadata.get(`1`)).toEqual({
      source: `gap-replayed`,
    })
    expect(
      collection._state.syncedCollectionMetadata.get(`queryCollection:gc:q1`),
    ).toEqual({
      queryHash: `q1`,
      mode: `until-revalidated`,
    })
  })

  it(`throws InvalidSyncConfigError when sync key is present but null`, () => {
    const invalidOptions = {
      id: `invalid-sync-null`,
      getKey: (item: Todo) => item.id,
      sync: null,
      persistence: {
        adapter: createNoopAdapter(),
      },
    } as unknown as PersistedSyncWrappedOptions<Todo, string>

    expect(() => persistedCollectionOptions(invalidOptions)).toThrow(
      InvalidSyncConfigError,
    )
  })
})
