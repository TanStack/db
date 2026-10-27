/**
 * Ordinary regression tests for persisted hydration queues: source writes and deletes admitted behind hydration, refused inserts, and partial-update dependency work, as fixed scenarios. The queue and admission laws are owned by persisted-oracle.test.ts, which keeps the generated and model-checked cases.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  BasicIndex,
  DbClient,
  NoPendingSyncTransactionCommitError,
  NoPendingSyncTransactionWriteError,
  collectionOptions,
  createCollection,
  createTransaction,
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
  expectPendingKeyMembershipWork,
  flushAsyncWork,
  hydrationScopeModes,
  observeSettlement,
  overrideBaselineRows,
  refusalHistories,
  runRejectedHydrationBufferWitness,
  stripVirtualProps,
} from './persisted-support'
import type { Todo, TodoSyncParams } from './persisted-support'

describe(`persistedCollectionOptions`, () => {
  it(`keeps hydrated rows ahead of persisted startup rows`, async () => {
    const adapter = createRecordingAdapter([
      { id: `1`, title: `Persisted title` },
    ])
    const descriptor = collectionOptions(
      persistedCollectionOptions<Todo, string>({
        id: `hydration-precedence`,
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
    const client = new DbClient()
    client.hydrate({
      collections: [
        {
          collectionId: descriptor.id,
          rows: [
            {
              key: `1`,
              value: { id: `1`, title: `SSR title` },
            },
          ],
        },
      ],
    })

    const collection = client.collection(descriptor)
    await collection.stateWhenReady()
    await flushAsyncWork()

    expect(collection.get(`1`)).toMatchObject({
      id: `1`,
      title: `SSR title`,
    })

    await client.cleanup()
  })

  it(`bootstraps and tracks persisted index lifecycle in sync-present mode`, async () => {
    const adapter = createRecordingAdapter()
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-indexes`,
        getKey: (item) => item.id,
        defaultIndexType: BasicIndex,
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

    const preSyncIndex = collection.createIndex((row) => row.title, {
      name: `pre-sync-title`,
    })
    const expectedPreSyncSignature = collection.getIndexMetadata()[0]?.signature

    await collection.preload()
    await flushAsyncWork()

    expect(expectedPreSyncSignature).toBeDefined()
    expect(
      adapter.ensureIndexCalls.some(
        (call) => call.signature === expectedPreSyncSignature,
      ),
    ).toBe(true)

    const runtimeIndex = collection.createIndex((row) => row.id, {
      name: `runtime-id`,
    })
    await flushAsyncWork()

    const runtimeSignature = collection
      .getIndexMetadata()
      .find((index) => index.indexId === runtimeIndex.id)?.signature
    expect(runtimeSignature).toBeDefined()
    expect(
      adapter.ensureIndexCalls.some(
        (call) => call.signature === runtimeSignature,
      ),
    ).toBe(true)

    collection.removeIndex(preSyncIndex)
    await flushAsyncWork()
    expect(
      adapter.markIndexRemovedCalls.some(
        (call) => call.signature === expectedPreSyncSignature,
      ),
    ).toBe(true)
  })

  it(`queues remote sync writes that arrive during hydration`, async () => {
    const adapter = createRecordingAdapter([
      {
        id: `cached-1`,
        title: `Cached row`,
      },
    ])
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
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit: (() => void) | undefined

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            remoteBegin = begin
            remoteWrite = write as (message: {
              type: `insert`
              value: Todo
            }) => void
            remoteCommit = commit
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

    remoteBegin?.()
    remoteWrite?.({
      type: `insert`,
      value: {
        id: `during-hydrate`,
        title: `During hydrate`,
      },
    })
    remoteCommit?.()

    resolveLoadSubset?.()
    await readyPromise
    await flushAsyncWork()

    expect(stripVirtualProps(collection.get(`cached-1`))).toEqual({
      id: `cached-1`,
      title: `Cached row`,
    })
    expect(stripVirtualProps(collection.get(`during-hydrate`))).toEqual({
      id: `during-hydrate`,
      title: `During hydrate`,
    })
  })

  it(`queues a source write behind its owning hydration baseline`, async () => {
    const adapter = createRecordingAdapter([
      { id: `shared`, title: `Persisted baseline` },
    ])
    const hydrationEntered = createEventGate()
    const hydration = createEventGate()
    overrideBaselineRows(adapter, async () => {
      hydrationEntered.resolve()
      await hydration.promise
      return [
        {
          key: `shared`,
          value: { id: `shared`, title: `Persisted baseline` },
        },
      ]
    })
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `source-write-during-hydration`,
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
        `source write hydration entered`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `update`,
        value: { id: `shared`, title: `Newer source value` },
      })
      receipt = Promise.resolve(sourceParams.commit()).then(() => undefined)
      const settlement = observeSettlement(receipt)
      await Promise.resolve()

      expect({
        visible: collection.get(`shared`),
        receipt: settlement.read(),
        applyCalls: adapter.applyCommittedTxCalls.length,
      }).toEqual({
        visible: undefined,
        receipt: { status: `pending` },
        applyCalls: 0,
      })

      hydration.resolve()
      await atPersistedOracleCheckpoint(ready, `source write hydration ready`)
      await atPersistedOracleCheckpoint(
        receipt,
        `source write hydration receipt`,
      )
      expect({
        publicRow: stripVirtualProps(collection.get(`shared`)),
        durableRow: adapter.rows.get(`shared`),
        status: collection.status,
      }).toEqual({
        publicRow: { id: `shared`, title: `Newer source value` },
        durableRow: { id: `shared`, title: `Newer source value` },
        status: `ready`,
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

  it(`preserves a source transaction committed before the next persisted hydration`, async () => {
    const hydrationEntered = createEventGate()
    const hydration = createEventGate()
    const adapter = createRecordingAdapter()
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `before-hydration-boundary`,
        getKey: (item) => item.id,
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
        persistence: { adapter },
      }),
    )
    let hasPrimaryFailure = false

    try {
      collection.startSyncImmediate()
      await vi.waitFor(() => {
        expect(remoteBegin).toBeTypeOf(`function`)
        expect(remoteWrite).toBeTypeOf(`function`)
        expect(remoteCommit).toBeTypeOf(`function`)
      })
      const row = { id: `before`, title: `before` }
      remoteBegin?.()
      remoteWrite?.({ type: `insert`, value: row })
      const receipt = remoteCommit?.()
      expect(receipt).toBeInstanceOf(Promise)
      await receipt
      adapter.loadSubset = async () => {
        hydrationEntered.resolve()
        await hydration.promise
        return Array.from(adapter.rows, ([key, value]) => ({ key, value }))
      }
      const rehydrating = Promise.resolve(collection._sync.loadSubset({}))
      await atPersistedOracleCheckpoint(
        hydrationEntered.promise,
        `on-demand hydration entered`,
      )

      expect(stripVirtualProps(collection.get(`before`))).toEqual(row)
      expect(adapter.rows.get(`before`)).toEqual(row)
      hydration.resolve()
      await atPersistedOracleCheckpoint(
        rehydrating,
        `on-demand hydration completed`,
      )
      expect(stripVirtualProps(collection.get(`before`))).toEqual(row)
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      hydration.resolve()
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  describe.each(hydrationScopeModes)(
    `hydration failure with %s scope`,
    (scopeMode) => {
      it(`rejects every buffered receipt with the exact persisted hydration failure`, async () => {
        await runRejectedHydrationBufferWitness(
          `rejected-hydration-buffer-fixed`,
          [
            { id: `first`, title: `first buffered commit` },
            { id: `second`, title: `second buffered commit` },
          ],
          { scopeMode },
        )
      })

      it(`rejects a hydration-straddling transaction committed after hydration fails`, async () => {
        await runRejectedHydrationBufferWitness(
          `rejected-hydration-late-commit-fixed`,
          [{ id: `late`, title: `must not cross a failed baseline` }],
          { commitAfterHydrationFailure: true, scopeMode },
        )
      })

      it.each([
        {
          schedule: `one late commit`,
          rows: [{ id: `one-late`, title: `` }],
        },
        {
          schedule: `two sibling late commits`,
          rows: [
            { id: `late-a`, title: `a` },
            { id: `late-b`, title: `b` },
          ],
        },
        {
          schedule: `same-key late replacements`,
          rows: [
            { id: `late-shared`, title: `old` },
            { id: `late-shared`, title: `new` },
          ],
        },
      ])(
        `rejects generated late commits after hydration failure: $schedule`,
        async ({ schedule, rows }) => {
          await runRejectedHydrationBufferWitness(
            `rejected-hydration-late-${schedule.replaceAll(` `, `-`)}`,
            rows,
            { commitAfterHydrationFailure: true, scopeMode },
          )
        },
      )

      it.each([
        {
          schedule: `one buffered commit`,
          rows: [{ id: `one`, title: `one` }],
        },
        {
          schedule: `three sibling commits`,
          rows: [
            { id: `a`, title: `a` },
            { id: `b`, title: `b` },
            { id: `c`, title: `c` },
          ],
        },
        {
          schedule: `same-key replacement commits`,
          rows: [
            { id: `shared`, title: `old` },
            { id: `shared`, title: `new` },
          ],
        },
      ])(
        `rejects all receipts and adopts no rows after hydration failure: $schedule`,
        async ({ schedule, rows }) => {
          await runRejectedHydrationBufferWitness(
            `rejected-hydration-${schedule.replaceAll(` `, `-`)}`,
            rows,
            { scopeMode },
          )
        },
      )
    },
  )

  it(`discards a hydration-buffered transaction aborted before replay`, async () => {
    const adapter = createRecordingAdapter()
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
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit:
      ((signal?: AbortSignal) => true | Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-aborted-hydration-queue`,
        getKey: (item) => item.id,
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
        persistence: { adapter },
      }),
    )

    try {
      const ready = collection.stateWhenReady()
      for (let attempt = 0; attempt < 20 && !resolveLoadSubset; attempt++) {
        await flushAsyncWork()
      }
      const abortController = new AbortController()
      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `aborted`, title: `Must not replay` },
      })
      const applied = remoteCommit?.(abortController.signal)
      abortController.abort()
      resolveLoadSubset?.()
      await ready
      if (applied !== true) {
        await expect(applied).rejects.toMatchObject({ name: `AbortError` })
      }
      await flushAsyncWork()

      expect(collection.get(`aborted`)).toBeUndefined()
      expect(adapter.applyCommittedTxCalls).toHaveLength(0)
    } finally {
      resolveLoadSubset?.()
      await collection.cleanup()
    }
  })

  it(`continues an independent hydration queue after an in-flight sibling aborts`, async () => {
    const adapter = createRecordingAdapter()
    const hydrationEntered = createEventGate()
    const hydration = createEventGate()
    const prefixPersistenceEntered = createEventGate()
    const releasePrefixPersistence = createEventGate()
    const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
    adapter.applyCommittedTx = async (...args) => {
      if (args[1].mutations.some((mutation) => mutation.key === `prefix`)) {
        prefixPersistenceEntered.resolve()
        await releasePrefixPersistence.promise
      }
      return applyCommittedTx(...args)
    }
    overrideBaselineRows(adapter, async () => {
      hydrationEntered.resolve()
      await hydration.promise
      return []
    })
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `independent-hydration-abort`,
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
    const aborted = new AbortController()
    let prefixReceipt: Promise<void> | undefined
    let abortedReceipt: Promise<void> | undefined
    let independentReceipt: Promise<void> | undefined
    const ready = collection.stateWhenReady()
    void ready.catch(() => undefined)
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        hydrationEntered.promise,
        `independent abort hydration entered`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `prefix`, title: `durability held` },
      })
      prefixReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void prefixReceipt.catch(() => undefined)

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `aborted`, title: `must not publish` },
      })
      abortedReceipt = Promise.resolve(
        sourceParams.commit(aborted.signal),
      ).then(() => undefined)
      void abortedReceipt.catch(() => undefined)

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `independent`, title: `must survive sibling abort` },
      })
      independentReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void independentReceipt.catch(() => undefined)

      hydration.resolve()
      await atPersistedOracleCheckpoint(
        prefixPersistenceEntered.promise,
        `in-flight hydration prefix entered durability`,
      )
      aborted.abort()
      const independentSettlement = observeSettlement(independentReceipt)
      await Promise.resolve()
      expect({
        independent: independentSettlement.read(),
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        independent: { status: `pending` },
        status: `loading`,
        publicError: undefined,
      })

      releasePrefixPersistence.resolve()
      await atPersistedOracleCheckpoint(
        prefixReceipt,
        `independent abort prefix settled`,
      )
      await expect(
        atPersistedOracleCheckpoint(
          abortedReceipt,
          `in-flight hydration sibling aborted`,
        ),
      ).rejects.toMatchObject({ name: `AbortError` })
      await atPersistedOracleCheckpoint(
        independentReceipt,
        `independent hydration sibling applied`,
      )
      await atPersistedOracleCheckpoint(ready, `independent abort ready`)
      expect({
        status: collection.status,
        prefix: stripVirtualProps(collection.get(`prefix`)),
        aborted: collection.get(`aborted`),
        independent: stripVirtualProps(collection.get(`independent`)),
        durable: adapter.rows.get(`independent`),
      }).toEqual({
        status: `ready`,
        prefix: { id: `prefix`, title: `durability held` },
        aborted: undefined,
        independent: {
          id: `independent`,
          title: `must survive sibling abort`,
        },
        durable: {
          id: `independent`,
          title: `must survive sibling abort`,
        },
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      hydration.resolve()
      aborted.abort()
      releasePrefixPersistence.resolve()
      await cleanupPersistedOracle(
        [
          () => prefixReceipt?.catch(() => undefined),
          () => abortedReceipt?.catch(() => undefined),
          () => independentReceipt?.catch(() => undefined),
          () => ready.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`rejects every hydration-buffered receipt when replay fails`, async () => {
    const adapter = createRecordingAdapter()
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

    const replayError = new Error(`replay application failed`)
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-replay-failure-receipt`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            remoteBegin = begin
            remoteWrite = write as (message: {
              type: `insert`
              value: Todo
            }) => void
            remoteCommit = commit
            markReady()
            return {}
          },
        },
        persistence: {
          adapter,
        },
      }),
    )

    const readyOutcome = collection.stateWhenReady().then(
      () => ({ status: `fulfilled` as const }),
      (reason: unknown) => ({ status: `rejected` as const, reason }),
    )
    for (let attempt = 0; attempt < 20 && !resolveLoadSubset; attempt++) {
      await flushAsyncWork()
    }

    remoteBegin?.()
    remoteWrite?.({
      type: `insert`,
      value: { id: `during-hydrate`, title: `During hydrate` },
    })
    const failingReceipt = remoteCommit?.()
    remoteBegin?.()
    remoteWrite?.({
      type: `insert`,
      value: { id: `sibling`, title: `Sibling` },
    })
    const siblingReceipt = remoteCommit?.()
    expect(failingReceipt).toBeInstanceOf(Promise)
    expect(siblingReceipt).toBeInstanceOf(Promise)
    const setSyncedRow = collection._state.syncedData.set.bind(
      collection._state.syncedData,
    )
    vi.spyOn(collection._state.syncedData, `set`).mockImplementation(
      (key, value) => {
        if (key === `during-hydrate`) throw replayError
        return setSyncedRow(key, value)
      },
    )
    const failingExpectation = expect(
      Promise.resolve(failingReceipt),
    ).rejects.toBe(replayError)
    const siblingExpectation = expect(
      Promise.resolve(siblingReceipt),
    ).rejects.toBe(replayError)

    resolveLoadSubset?.()
    const ready = await atPersistedOracleCheckpoint(
      readyOutcome,
      `replay-failed hydration readiness settled`,
    )
    await failingExpectation
    await siblingExpectation
    remoteBegin?.()
    remoteWrite?.({
      type: `insert`,
      value: { id: `after-replay-failure`, title: `must not be admitted` },
    })
    const lateOutcome = await atPersistedOracleCheckpoint(
      Promise.resolve(remoteCommit?.()).then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      ),
      `post-replay-failure source receipt`,
    )

    expect({
      readyStatus: ready.status,
      readyExact: ready.status === `rejected` && ready.reason === replayError,
      lateStatus: lateOutcome.status,
      lateExact:
        lateOutcome.status === `rejected` && lateOutcome.reason === replayError,
      status: collection.status,
      exactPublicError: collection._lifecycle.getSyncError() === replayError,
      visibleLate: collection.get(`after-replay-failure`),
      durableLate: adapter.rows.get(`after-replay-failure`),
      applyCalls: adapter.applyCommittedTxCalls.length,
    }).toEqual({
      readyStatus: `rejected`,
      readyExact: true,
      lateStatus: `rejected`,
      lateExact: true,
      status: `error`,
      exactPublicError: true,
      visibleLate: undefined,
      durableLate: undefined,
      applyCalls: 0,
    })

    await collection.cleanup()
  })

  it.each([`metadata-snapshot`, `baseline-snapshot`, `row-apply`] as const)(
    `fail-stops startup when the %s phase fails`,
    async (phase) => {
      const phaseError = new Error(`${phase} failed exactly`)
      const adapter = createRecordingAdapter(
        phase === `row-apply`
          ? [{ id: `row-apply-failure`, title: `must not apply` }]
          : [],
      )
      if (phase !== `row-apply`) {
        const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
        adapter.loadResumeSnapshot = (...args) =>
          args[1]?.includeRows === (phase === `baseline-snapshot`)
            ? Promise.reject(phaseError)
            : loadResumeSnapshot(...args)
      }
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `terminal-startup-${phase}`,
          getKey: (row) => {
            if (phase === `row-apply` && row.id === `row-apply-failure`) {
              throw phaseError
            }
            return row.id
          },
          persistence: { adapter },
        }),
      )
      let hasPrimaryFailure = false

      try {
        const startupOutcome = await atPersistedOracleCheckpoint(
          collection.stateWhenReady().then(
            () => ({ status: `fulfilled` as const }),
            (reason: unknown) => ({ status: `rejected` as const, reason }),
          ),
          `${phase} startup boundary settled`,
        )

        expect({
          startupStatus: startupOutcome.status,
          startupExact:
            startupOutcome.status === `rejected` &&
            startupOutcome.reason === phaseError,
          status: collection.status,
          exactPublicError: collection._lifecycle.getSyncError() === phaseError,
          visibleRows: Array.from(collection.values()).map(stripVirtualProps),
          durableRows: Array.from(adapter.rows.values()),
          applyCalls: adapter.applyCommittedTxCalls.length,
        }).toEqual({
          startupStatus: `rejected`,
          startupExact: true,
          status: `error`,
          exactPublicError: true,
          visibleRows: [],
          durableRows:
            phase === `row-apply`
              ? [{ id: `row-apply-failure`, title: `must not apply` }]
              : [],
          applyCalls: 0,
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

  it(`fail-stops a coordinator transaction flushed after hydration`, async () => {
    const adapter = createRecordingAdapter()
    const hydrationEntered = createEventGate()
    const hydration = createEventGate()
    overrideBaselineRows(adapter, async () => {
      hydrationEntered.resolve()
      await hydration.promise
      return []
    })
    const flushError = new Error(`coordinator hydration flush failed exactly`)
    const coordinator = createFailStopCoordinatorHarness(
      `terminal-coordinator-hydration-flush`,
    )
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `terminal-coordinator-hydration-flush`,
        getKey: (row) => {
          if (row.id === `coordinator-bad`) throw flushError
          return row.id
        },
        sync: {
          sync: (params) => {
            sourceParams = params
            params.markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    const readyOutcome = collection.stateWhenReady().then(
      () => ({ status: `fulfilled` as const }),
      (reason: unknown) => ({ status: `rejected` as const, reason }),
    )
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        hydrationEntered.promise,
        `coordinator flush hydration entered`,
      )
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `coordinator-flush-failure`,
        latestRowVersion: 1,
        requiresFullReload: false,
        changedRows: [
          {
            key: `coordinator-bad`,
            value: { id: `coordinator-bad`, title: `must not publish` },
          },
        ],
        deletedKeys: [],
      })
      hydration.resolve()
      const ready = await atPersistedOracleCheckpoint(
        readyOutcome,
        `coordinator flush readiness settled`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `late`, title: `must not be admitted` },
      })
      const late = await atPersistedOracleCheckpoint(
        Promise.resolve(sourceParams.commit()).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `coordinator flush late receipt`,
      )

      expect({
        readyStatus: ready.status,
        readyExact: ready.status === `rejected` && ready.reason === flushError,
        lateStatus: late.status,
        lateExact: late.status === `rejected` && late.reason === flushError,
        status: collection.status,
        exactPublicError: collection._lifecycle.getSyncError() === flushError,
        visibleBad: collection.get(`coordinator-bad`),
        visibleLate: collection.get(`late`),
        durableLate: adapter.rows.get(`late`),
        applyCalls: adapter.applyCommittedTxCalls.length,
      }).toEqual({
        readyStatus: `rejected`,
        readyExact: true,
        lateStatus: `rejected`,
        lateExact: true,
        status: `error`,
        exactPublicError: true,
        visibleBad: undefined,
        visibleLate: undefined,
        durableLate: undefined,
        applyCalls: 0,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      hydration.resolve()
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`applies hydration-queued sync work after an unrelated local persistence rollback`, async () => {
    const adapter = createRecordingAdapter()
    const hydrationEntered = createEventGate()
    const hydration = createEventGate()
    overrideBaselineRows(adapter, async () => {
      hydrationEntered.resolve()
      await hydration.promise
      return []
    })
    const appliedError = new Error(`hydration applied receipt failed exactly`)
    const localPersistence = createEventGate()
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `terminal-hydration-applied-receipt`,
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
    const localTransaction = createTransaction({
      mutationFn: () => localPersistence.promise,
    })
    const readyOutcome = collection.stateWhenReady().then(
      () => ({ status: `fulfilled` as const }),
      (reason: unknown) => ({ status: `rejected` as const, reason }),
    )
    let remoteReceipt: true | Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        hydrationEntered.promise,
        `applied-receipt hydration entered`,
      )
      localTransaction.mutate(() => {
        collection.insert({ id: `local-gate`, title: `local pending` })
      })
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: {
          id: `remote-applied`,
          title: `applies after local rollback`,
        },
      })
      remoteReceipt = sourceParams.commit()
      expect(remoteReceipt).toBeInstanceOf(Promise)
      hydration.resolve()
      await flushAsyncWork()
      localPersistence.reject(appliedError)

      const ready = await atPersistedOracleCheckpoint(
        readyOutcome,
        `applied-receipt readiness settled`,
      )
      const remote = await atPersistedOracleCheckpoint(
        Promise.resolve(remoteReceipt).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `hydration-applied remote receipt settled`,
      )

      expect({
        readyStatus: ready.status,
        remoteStatus: remote.status,
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
        durableRemote: adapter.rows.get(`remote-applied`),
        applyCalls: adapter.applyCommittedTxCalls.length,
      }).toEqual({
        readyStatus: `fulfilled`,
        remoteStatus: `fulfilled`,
        status: `ready`,
        publicError: undefined,
        durableRemote: {
          id: `remote-applied`,
          title: `applies after local rollback`,
        },
        applyCalls: 1,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      hydration.resolve()
      localPersistence.reject(appliedError)
      await localTransaction.isPersisted.promise.catch(() => undefined)
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it.each(refusalHistories)(
    `drops a refused insert and applies source turns on its key: %j`,
    async ({ timing, firstWrite }) => {
      const adapter = createRecordingAdapter()
      const refused = new Error(`outbound save refused`)
      const outbound = createEventGate()
      const handlerEntered = createEventGate()
      let sourceParams!: TodoSyncParams
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `refused-insert-source-${timing}-${firstWrite}`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              sourceParams = params
              params.markReady()
            },
          },
          persistence: { adapter },
          onInsert: async () => {
            handlerEntered.resolve()
            await outbound.promise
          },
        }),
      )
      let transaction: ReturnType<typeof collection.insert> | undefined
      let firstReceipt: true | Promise<void> | undefined
      let secondReceipt: true | Promise<void> | undefined
      let expectedSource: Todo | undefined
      let hasPrimaryFailure = false
      const sourceRow: Todo = { id: `local`, title: `source row` }
      const laterRow: Todo = { id: `local`, title: `later source row` }

      // A source turn is an authoritative edit. This tiny model uses no
      // persisted-wrapper or Collection state to predict the next row.
      const checkSource = (checkpoint: string) => {
        const live = collection.get(`local`)
        expect(
          {
            live: stripVirtualProps(live),
            base: collection.base.get(`local`),
            durable: adapter.rows.get(`local`),
          },
          checkpoint,
        ).toEqual({
          live: expectedSource,
          base: expectedSource,
          durable: expectedSource,
        })
        if (expectedSource) expect(live?.$origin, checkpoint).toBe(`remote`)
      }
      const writeSource = (type: `insert` | `delete`, row = sourceRow) => {
        sourceParams.begin()
        if (type === `insert`) sourceParams.write({ type, value: row })
        else sourceParams.write({ type, key: `local` })
        return sourceParams.commit()
      }

      try {
        await atPersistedOracleCheckpoint(
          collection.stateWhenReady(),
          `refused insert collection ready`,
        )
        transaction = collection.insert({ id: `local`, title: `optimistic` })
        await atPersistedOracleCheckpoint(
          handlerEntered.promise,
          `refused insert handler entered`,
        )
        expect(collection.get(`local`)?.title).toBe(`optimistic`)
        expect(collection.base.has(`local`)).toBe(false)
        expect(adapter.rows.has(`local`)).toBe(false)

        if (timing === `before`) {
          firstReceipt = writeSource(firstWrite)
          expectedSource = firstWrite === `insert` ? sourceRow : undefined
          await atPersistedOracleCheckpoint(
            Promise.resolve(whenSyncAccepted(firstReceipt)).then(
              () => undefined,
            ),
            `source turn durable before refusal`,
          )
          expect(collection.get(`local`)?.title).toBe(`optimistic`)
          expect(adapter.rows.get(`local`)).toEqual(expectedSource)
          // Durability accepts the source turn. Its receipt still waits for
          // the refused mutation to settle and release core publication.
          const receiptState = observeSettlement(
            Promise.resolve(firstReceipt).then(() => undefined),
          )
          await flushAsyncWork()
          expect(receiptState.read()).toEqual({ status: `pending` })
        }

        outbound.reject(refused)
        await expect(transaction.isPersisted.promise).rejects.toBe(refused)
        expect(transaction.state).toBe(`failed`)
        checkSource(`after refused mutation settled`)
        if (firstReceipt !== undefined) {
          await Promise.resolve(firstReceipt)
          checkSource(`after held source receipt`)
        }

        if (timing === `after`) {
          firstReceipt = writeSource(firstWrite)
          expectedSource = firstWrite === `insert` ? sourceRow : undefined
          await atPersistedOracleCheckpoint(
            Promise.resolve(firstReceipt).then(() => undefined),
            `first post-failure source turn applied`,
          )
          checkSource(`after first source receipt`)
        }

        const secondWrite = firstWrite === `insert` ? `delete` : `insert`
        secondReceipt = writeSource(secondWrite, laterRow)
        expectedSource = secondWrite === `insert` ? laterRow : undefined
        await atPersistedOracleCheckpoint(
          Promise.resolve(secondReceipt).then(() => undefined),
          `second post-failure source turn applied`,
        )
        checkSource(`after second source receipt`)
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        if (transaction) outbound.reject(refused)
        await cleanupPersistedOracle(
          [
            () => transaction?.isPersisted.promise.catch(() => undefined),
            () =>
              firstReceipt === undefined
                ? undefined
                : Promise.resolve(firstReceipt).catch(() => undefined),
            () =>
              secondReceipt === undefined
                ? undefined
                : Promise.resolve(secondReceipt).catch(() => undefined),
            () => collection.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  // The synced wrapper forwards accepted source transactions to core without
  // a client identity. Under the key-and-timing rule, the first same-key turn
  // consumes a successful mutation's local attribution. A second accepted
  // turn replaces it with remote attribution. The independent source order
  // predicts the final row; compare it when the mutation and receipts settle.
  it.each([1, 2] as const)(
    `attributes only the first of %i persisted same-key source turns locally`,
    async (sourceTurns) => {
      const adapter = createRecordingAdapter()
      const handlerEntered = createEventGate()
      const releaseHandler = createEventGate()
      let source!: TodoSyncParams
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `persisted-origin-${sourceTurns}`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
            },
          },
          persistence: { adapter },
          onInsert: async () => {
            handlerEntered.resolve()
            await releaseHandler.promise
          },
        }),
      )
      let transaction: ReturnType<typeof collection.insert> | undefined
      const receipts: Array<true | Promise<void>> = []
      let hasPrimaryFailure = false

      try {
        await atPersistedOracleCheckpoint(
          collection.stateWhenReady(),
          `persisted origin collection ready`,
        )
        transaction = collection.insert({ id: `local`, title: `optimistic` })
        await atPersistedOracleCheckpoint(
          handlerEntered.promise,
          `persisted origin handler entered`,
        )
        for (let turn = 1; turn <= sourceTurns; turn++) {
          source.begin()
          source.write({
            type: turn === 1 ? `insert` : `update`,
            value: { id: `local`, title: `source ${turn}` },
          })
          const receipt = source.commit()
          receipts.push(receipt)
          await atPersistedOracleCheckpoint(
            Promise.resolve(whenSyncAccepted(receipt)).then(() => undefined),
            `source turn ${turn} accepted`,
          )
        }
        expect(collection.get(`local`)?.title).toBe(`optimistic`)

        releaseHandler.resolve()
        await atPersistedOracleCheckpoint(
          transaction.isPersisted.promise.then(() => undefined),
          `successful persisted origin mutation settled`,
        )
        await Promise.all(receipts.map((receipt) => Promise.resolve(receipt)))
        const row = { id: `local`, title: `source ${sourceTurns}` }
        expect(stripVirtualProps(collection.get(`local`))).toEqual(row)
        expect(collection.get(`local`)?.$origin).toBe(
          sourceTurns === 1 ? `local` : `remote`,
        )
        expect(collection.base.get(`local`)).toEqual(row)
        expect(adapter.rows.get(`local`)).toEqual(row)
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        releaseHandler.resolve()
        await cleanupPersistedOracle(
          [
            () => transaction?.isPersisted.promise.catch(() => undefined),
            ...receipts.map(
              (receipt) => () =>
                Promise.resolve(receipt).catch(() => undefined),
            ),
            () => collection.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  // A source commit made while a local mutation persists is accepted and
  // durably stored. Its rows stay hidden until that mutation settles.
  it(`accepts and stores a source commit made beneath a persisting mutation`, async () => {
    const adapter = createRecordingAdapter()
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `source-commit-beneath-mutation`,
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
    const localPersistence = createEventGate()
    const localTransaction = createTransaction({
      autoCommit: false,
      mutationFn: () => localPersistence.promise,
    })
    let localCommit: Promise<unknown> | undefined
    let remoteReceipt: true | Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `source commit collection ready`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `seed`, title: `baseline` },
      })
      await atPersistedOracleCheckpoint(
        Promise.resolve(sourceParams.commit()),
        `source commit seed persisted`,
      )

      localTransaction.mutate(() => {
        collection.update(`seed`, (draft) => {
          draft.title = `local pending`
        })
      })
      localCommit = localTransaction.commit()
      void localCommit.catch(() => undefined)
      expect(localTransaction.state).toBe(`persisting`)

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `remote`, title: `source commit` },
      })
      remoteReceipt = sourceParams.commit()
      await atPersistedOracleCheckpoint(
        Promise.resolve(whenSyncAccepted(remoteReceipt)).then(() => undefined),
        `source commit accepted before local settlement`,
      )
      // Accepted, but held: it becomes visible when the mutation settles.
      expect(remoteReceipt).not.toBe(true)
      const remoteSettlement = observeSettlement(remoteReceipt as Promise<void>)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(remoteSettlement.read()).toEqual({ status: `pending` })
      expect({
        localState: localTransaction.state,
        remoteVisible: collection.has(`remote`),
        remoteDurable: adapter.rows.get(`remote`),
      }).toEqual({
        localState: `persisting`,
        remoteVisible: false,
        remoteDurable: { id: `remote`, title: `source commit` },
      })

      localPersistence.resolve()
      await atPersistedOracleCheckpoint(
        localTransaction.isPersisted.promise,
        `local settlement publishes the source commit`,
      )
      expect(stripVirtualProps(collection.get(`remote`))).toEqual({
        id: `remote`,
        title: `source commit`,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      localPersistence.resolve()
      await cleanupPersistedOracle(
        [
          () => localCommit,
          () =>
            remoteReceipt === true ? undefined : Promise.resolve(remoteReceipt),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  // A handler may write, and await, a source commit queued behind an earlier
  // parked source commit. Both apply in commit order when it settles.
  it(`accepts a handler source commit queued behind a parked source commit`, async () => {
    const adapter = createRecordingAdapter()
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `handler-source-dependency`,
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
    const mutationEntered = createEventGate()
    const startDependency = createEventGate()
    const dependencySubmitted = createEventGate()
    let dependencyReceipt: true | Promise<void> | undefined
    const localTransaction = createTransaction({
      mutationFn: async () => {
        mutationEntered.resolve()
        await startDependency.promise
        sourceParams.begin()
        sourceParams.write({
          type: `insert`,
          value: { id: `dependency`, title: `releases user persistence` },
        })
        dependencyReceipt = sourceParams.commit()
        dependencySubmitted.resolve()
        await whenSyncAccepted(dependencyReceipt)
      },
    })
    const normalAbort = new AbortController()
    let normalReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `handler dependency collection ready`,
      )
      localTransaction.mutate(() => {
        collection.insert({ id: `local`, title: `user persistence pending` })
      })
      await atPersistedOracleCheckpoint(
        mutationEntered.promise,
        `user persistence entered`,
      )
      expect(localTransaction.state).toBe(`persisting`)

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `parked`, title: `waits for user persistence` },
      })
      normalReceipt = Promise.resolve(
        sourceParams.commit(normalAbort.signal),
      ).then(() => undefined)
      void normalReceipt.catch(() => undefined)
      expect(
        collection._state.pendingSyncedTransactions.some(
          (transaction) => transaction.committed,
        ),
      ).toBe(true)

      startDependency.resolve()
      await atPersistedOracleCheckpoint(
        dependencySubmitted.promise,
        `handler dependency submitted`,
      )
      await atPersistedOracleCheckpoint(
        localTransaction.isPersisted.promise,
        `user persistence completes after its awaited source commit`,
      )
      await atPersistedOracleCheckpoint(
        normalReceipt,
        `parked predecessor receipt`,
      )
      expect({
        dependencyVisible: stripVirtualProps(collection.get(`dependency`)),
        dependencyDurable: adapter.rows.get(`dependency`),
        parkedVisible: stripVirtualProps(collection.get(`parked`)),
        parkedDurable: adapter.rows.get(`parked`),
        durableOrder: adapter.applyCommittedTxCalls.flatMap((call) =>
          call.tx.mutations.map((mutation) => mutation.key),
        ),
        status: collection.status,
      }).toEqual({
        dependencyVisible: {
          id: `dependency`,
          title: `releases user persistence`,
        },
        dependencyDurable: {
          id: `dependency`,
          title: `releases user persistence`,
        },
        parkedVisible: { id: `parked`, title: `waits for user persistence` },
        parkedDurable: { id: `parked`, title: `waits for user persistence` },
        durableOrder: expect.arrayContaining([`parked`, `dependency`]),
        status: `ready`,
      })
      const durableKeys = adapter.applyCommittedTxCalls.flatMap((call) =>
        call.tx.mutations.map((mutation) => mutation.key),
      )
      expect(durableKeys.indexOf(`parked`)).toBeLessThan(
        durableKeys.indexOf(`dependency`),
      )
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      startDependency.resolve()
      normalAbort.abort()
      await cleanupPersistedOracle(
        [
          () => localTransaction.isPersisted.promise.catch(() => undefined),
          () => normalReceipt?.catch(() => undefined),
          () =>
            dependencyReceipt === true
              ? undefined
              : Promise.resolve(dependencyReceipt).catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`replays source transactions one by one behind a held predecessor`, async () => {
    const adapter = createRecordingAdapter()
    const firstPersistenceEntered = createEventGate()
    const releaseFirstPersistence = createEventGate()
    const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
    const persistedSharedTitles: Array<string> = []
    let applyCalls = 0
    adapter.applyCommittedTx = async (...args) => {
      applyCalls++
      for (const mutation of args[1].mutations) {
        if (mutation.type !== `delete` && mutation.key === `shared`) {
          persistedSharedTitles.push((mutation.value as Todo).title)
        }
      }
      if (applyCalls === 1) {
        firstPersistenceEntered.resolve()
        await releaseFirstPersistence.promise
      }
      await applyCommittedTx(...args)
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `source-fifo-order`,
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
    let gateReceipt: Promise<void> | undefined
    let olderReceipt: Promise<void> | undefined
    let newerReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `source FIFO ordering collection ready`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `gate`, title: `holds adapter` },
      })
      gateReceipt = Promise.resolve(sourceParams.commit()).then(() => undefined)
      void gateReceipt.catch(() => undefined)
      await atPersistedOracleCheckpoint(
        firstPersistenceEntered.promise,
        `source FIFO ordering predecessor persistence entered`,
      )

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `shared`, title: `older normal` },
      })
      olderReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void olderReceipt.catch(() => undefined)

      sourceParams.begin()
      sourceParams.write({
        type: `update`,
        value: { id: `shared`, title: `newer source value` },
      })
      newerReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void newerReceipt.catch(() => undefined)

      expect(collection.get(`shared`)).toBeUndefined()

      releaseFirstPersistence.resolve()
      await atPersistedOracleCheckpoint(gateReceipt, `ordering gate persisted`)
      await atPersistedOracleCheckpoint(
        olderReceipt,
        `older normal source receipt`,
      )
      await atPersistedOracleCheckpoint(
        newerReceipt,
        `newer source FIFO receipt`,
      )

      expect({
        status: collection.status,
        publicRow: stripVirtualProps(collection.get(`shared`)),
        durableRow: adapter.rows.get(`shared`),
        persistedTitles: persistedSharedTitles,
      }).toEqual({
        status: `ready`,
        publicRow: { id: `shared`, title: `newer source value` },
        durableRow: { id: `shared`, title: `newer source value` },
        persistedTitles: [`older normal`, `newer source value`],
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseFirstPersistence.resolve()
      await cleanupPersistedOracle(
        [
          () => gateReceipt?.catch(() => undefined),
          () => olderReceipt?.catch(() => undefined),
          () => newerReceipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`admits a queued insert after an earlier queued delete of the same key`, async () => {
    const adapter = createRecordingAdapter([
      { id: `shared`, title: `Original row` },
    ])
    const persistenceEntered = createEventGate()
    const releasePersistence = createEventGate()
    const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
    let applyCalls = 0
    adapter.applyCommittedTx = async (...args) => {
      applyCalls++
      if (applyCalls === 1) {
        persistenceEntered.resolve()
        await releasePersistence.promise
      }
      await applyCommittedTx(...args)
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `queued-delete-insert-prefix`,
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
    let gateReceipt: Promise<void> | undefined
    let deleteReceipt: Promise<void> | undefined
    let insertReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `queued-prefix collection ready`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `gate`, title: `Hold durability` },
      })
      gateReceipt = Promise.resolve(sourceParams.commit()).then(() => undefined)
      void gateReceipt.catch(() => undefined)
      await atPersistedOracleCheckpoint(
        persistenceEntered.promise,
        `queued-prefix durability held`,
      )

      sourceParams.begin()
      sourceParams.write({ type: `delete`, key: `shared` })
      deleteReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void deleteReceipt.catch(() => undefined)

      sourceParams.begin()
      expect(() =>
        sourceParams.write({
          type: `insert`,
          value: { id: `shared`, title: `Replacement row` },
        }),
      ).not.toThrow()
      insertReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void insertReceipt.catch(() => undefined)

      expect({
        publicRow: stripVirtualProps(collection.get(`shared`)),
        deleteReceipt: observeSettlement(deleteReceipt).read(),
        insertReceipt: observeSettlement(insertReceipt).read(),
      }).toEqual({
        publicRow: { id: `shared`, title: `Original row` },
        deleteReceipt: { status: `pending` },
        insertReceipt: { status: `pending` },
      })

      releasePersistence.resolve()
      await atPersistedOracleCheckpoint(gateReceipt, `queued-prefix gate`)
      await atPersistedOracleCheckpoint(deleteReceipt, `queued-prefix delete`)
      await atPersistedOracleCheckpoint(insertReceipt, `queued-prefix insert`)
      expect({
        publicRow: stripVirtualProps(collection.get(`shared`)),
        durableRow: adapter.rows.get(`shared`),
        status: collection.status,
      }).toEqual({
        publicRow: { id: `shared`, title: `Replacement row` },
        durableRow: { id: `shared`, title: `Replacement row` },
        status: `ready`,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releasePersistence.resolve()
      await cleanupPersistedOracle(
        [
          () => gateReceipt?.catch(() => undefined),
          () => deleteReceipt?.catch(() => undefined),
          () => insertReceipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`stores reentrant source commits from a publication callback in staging order`, async () => {
    const adapter = createRecordingAdapter()
    const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
    const persistedTitles: Array<string> = []
    adapter.applyCommittedTx = async (...args) => {
      for (const mutation of args[1].mutations) {
        if (mutation.type !== `delete` && mutation.key === `shared`) {
          persistedTitles.push((mutation.value as Todo).title)
        }
      }
      await applyCommittedTx(...args)
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `core-publication-source-order`,
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
    let earlierReceipt: Promise<void> | undefined
    let laterReceipt: Promise<void> | undefined
    let callbackCount = 0
    const publication = collection.subscribeChanges((changes) => {
      if (
        callbackCount === 0 &&
        changes.some((change) => change.key === `trigger`)
      ) {
        callbackCount++
        sourceParams.begin()
        sourceParams.write({
          type: `update`,
          value: { id: `shared`, title: `earlier` },
        })
        earlierReceipt = Promise.resolve(sourceParams.commit()).then(
          () => undefined,
        )
        void earlierReceipt.catch(() => undefined)

        sourceParams.begin()
        sourceParams.write({
          type: `update`,
          value: { id: `shared`, title: `later` },
        })
        laterReceipt = Promise.resolve(sourceParams.commit()).then(
          () => undefined,
        )
        void laterReceipt.catch(() => undefined)
      }
    })
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `core-publication ordering collection ready`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `trigger`, title: `Triggers source reentry` },
      })
      await Promise.resolve(sourceParams.commit())
      await vi.waitFor(() => expect(callbackCount).toBe(1))
      expect(earlierReceipt).toBeInstanceOf(Promise)
      expect(laterReceipt).toBeInstanceOf(Promise)
      await atPersistedOracleCheckpoint(
        earlierReceipt!,
        `core-publication earlier receipt`,
      )
      await atPersistedOracleCheckpoint(
        laterReceipt!,
        `core-publication later receipt`,
      )

      expect({
        publicRow: stripVirtualProps(collection.get(`shared`)),
        durableRow: adapter.rows.get(`shared`),
        persistedTitles,
        status: collection.status,
      }).toEqual({
        publicRow: { id: `shared`, title: `later` },
        durableRow: { id: `shared`, title: `later` },
        persistedTitles: [`earlier`, `later`],
        status: `ready`,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      publication.unsubscribe()
      await cleanupPersistedOracle(
        [
          () => earlierReceipt?.catch(() => undefined),
          () => laterReceipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`stores a source turn beneath an optimistic mutation and publishes it at settlement`, async () => {
    const adapter = createRecordingAdapter()
    const mutationEntered = createEventGate()
    const allowDemand = createEventGate()
    let upstreamLoads = 0
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `source-publication-before-mutation-demand`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            sourceParams = params
            params.markReady()
            return {
              loadSubset: () => {
                upstreamLoads++
                return true
              },
            }
          },
        },
        persistence: { adapter },
      }),
    )
    const subset = { limit: 1 }
    let localReceipt: Promise<unknown> | undefined
    let sourceReceipt: Promise<void> | undefined
    let demand: Promise<unknown> | undefined
    let hasPrimaryFailure = false

    try {
      await collection.stateWhenReady()
      const local = createTransaction({
        // A handler awaiting an on-demand load of its own Collection would
        // wait for itself: the load's rows publish when this mutation settles.
        mutationFn: async () => {
          mutationEntered.resolve()
          await allowDemand.promise
          demand = Promise.resolve(collection._sync.loadSubset(subset))
          void demand.catch(() => undefined)
        },
      })
      local.mutate(() => {
        collection.insert({ id: `local`, title: `optimistic local` })
      })
      localReceipt = local.isPersisted.promise
      void localReceipt.catch(() => undefined)
      await mutationEntered.promise

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `remote`, title: `authoritative source` },
      })
      const sourceCommit = sourceParams.commit()
      sourceReceipt = Promise.resolve(sourceCommit).then(() => undefined)
      await atPersistedOracleCheckpoint(
        Promise.resolve(whenSyncAccepted(sourceCommit)),
        `source commit accepted beneath optimistic mutation`,
      )

      expect({
        local: stripVirtualProps(collection.get(`local`)),
        remote: stripVirtualProps(collection.get(`remote`)),
        durableRemote: adapter.rows.get(`remote`),
        localState: local.state,
      }).toEqual({
        local: { id: `local`, title: `optimistic local` },
        remote: undefined,
        durableRemote: { id: `remote`, title: `authoritative source` },
        localState: `persisting`,
      })

      allowDemand.resolve()
      await atPersistedOracleCheckpoint(
        localReceipt,
        `mutation settles after starting its demand`,
      )
      await atPersistedOracleCheckpoint(
        demand!,
        `demand settles after mutation`,
      )
      expect({
        remote: stripVirtualProps(collection.get(`remote`)),
        status: collection.status,
        upstreamLoads,
      }).toEqual({
        remote: { id: `remote`, title: `authoritative source` },
        status: `ready`,
        upstreamLoads: 1,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      allowDemand.resolve()
      collection._sync.unloadSubset(subset)
      await cleanupPersistedOracle(
        [
          () => sourceReceipt?.catch(() => undefined),
          () => localReceipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`queues independent demand behind normal source publication without rejecting it`, async () => {
    const adapter = createRecordingAdapter()
    const mutationEntered = createEventGate()
    const releaseMutation = createEventGate()
    let upstreamLoads = 0
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `independent-demand-behind-source-publication`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            sourceParams = params
            params.markReady()
            return {
              loadSubset: () => {
                upstreamLoads++
                return true
              },
            }
          },
        },
        persistence: { adapter },
      }),
    )
    const subset = { limit: 1 }
    let localReceipt: Promise<unknown> | undefined
    let sourceReceipt: Promise<void> | undefined
    let demand: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await collection.stateWhenReady()
      const local = createTransaction({
        mutationFn: async () => {
          mutationEntered.resolve()
          await releaseMutation.promise
        },
      })
      local.mutate(() => {
        collection.insert({ id: `local`, title: `optimistic local` })
      })
      localReceipt = local.isPersisted.promise
      void localReceipt.catch(() => undefined)
      await mutationEntered.promise

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `remote`, title: `normal source` },
      })
      sourceReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void sourceReceipt.catch(() => undefined)
      demand = Promise.resolve(collection._sync.loadSubset(subset)).then(
        () => undefined,
      )
      void demand.catch(() => undefined)
      const sourceSettlement = observeSettlement(sourceReceipt)
      const demandSettlement = observeSettlement(demand)
      await Promise.resolve()
      expect({
        source: sourceSettlement.read(),
        demand: demandSettlement.read(),
        status: collection.status,
      }).toEqual({
        source: { status: `pending` },
        demand: { status: `pending` },
        status: `ready`,
      })

      releaseMutation.resolve()
      await atPersistedOracleCheckpoint(
        Promise.all([localReceipt, sourceReceipt, demand]),
        `independent demand after normal source publication`,
      )
      expect({
        status: collection.status,
        source: sourceSettlement.read(),
        demand: demandSettlement.read(),
        upstreamLoads,
        durableRemote: adapter.rows.get(`remote`),
      }).toEqual({
        status: `ready`,
        source: { status: `fulfilled`, value: undefined },
        demand: { status: `fulfilled`, value: undefined },
        upstreamLoads: 1,
        durableRemote: { id: `remote`, title: `normal source` },
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseMutation.resolve()
      collection._sync.unloadSubset(subset)
      await cleanupPersistedOracle(
        [
          () => demand?.catch(() => undefined),
          () => sourceReceipt?.catch(() => undefined),
          () => localReceipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`queues a source suffix behind held durability and fails it with the prefix`, async () => {
    const adapter = createRecordingAdapter()
    const coordinator = createCoordinatorHarness()
    const firstDurabilityEntered = createEventGate()
    const releaseFirstDurability = createEventGate()
    const persistenceResponse = {
      type: `rpc:applyCommittedTx:res` as const,
      rpcId: `failed-prefix`,
      ok: false as const,
      code: `PERSISTENCE_ERROR` as const,
      error: `prefix durability failed`,
      sourceCode: `SQLITE_IOERR_FSYNC`,
      path: [`database`, `wal`] as const,
    }
    let durabilityCalls = 0
    coordinator.requestApplyCommittedTx = async (collectionId, tx) => {
      durabilityCalls++
      if (durabilityCalls === 1) {
        firstDurabilityEntered.resolve()
        await releaseFirstDurability.promise
        return { ...persistenceResponse, rpcId: tx.txId }
      }
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
        id: `source-prefix-fail-stop`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            sourceParams = params
            params.markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let prefixReceipt: Promise<void> | undefined
    let suffixReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `source prefix fail-stop collection ready`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `prefix`, title: `fails durability` },
      })
      prefixReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void prefixReceipt.catch(() => undefined)
      await atPersistedOracleCheckpoint(
        firstDurabilityEntered.promise,
        `failed source prefix entered durability`,
      )

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `suffix`, title: `must not become durable` },
      })
      suffixReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void suffixReceipt.catch(() => undefined)
      const prefixSettlement = observeSettlement(prefixReceipt)
      const suffixSettlement = observeSettlement(suffixReceipt)
      await Promise.resolve()

      expect({
        prefixPublic: stripVirtualProps(collection.get(`prefix`)),
        suffixPublic: stripVirtualProps(collection.get(`suffix`)),
        prefixReceipt: prefixSettlement.read(),
        suffixReceipt: suffixSettlement.read(),
        durabilityCalls,
        prefixDurable: adapter.rows.get(`prefix`),
        suffixDurable: adapter.rows.get(`suffix`),
      }).toEqual({
        prefixPublic: { id: `prefix`, title: `fails durability` },
        suffixPublic: undefined,
        prefixReceipt: { status: `pending` },
        suffixReceipt: { status: `pending` },
        durabilityCalls: 1,
        prefixDurable: undefined,
        suffixDurable: undefined,
      })

      releaseFirstDurability.resolve()
      const prefixOutcome = await atPersistedOracleCheckpoint(
        prefixReceipt.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `failed source prefix receipt`,
      )
      const suffixOutcome = await atPersistedOracleCheckpoint(
        suffixReceipt.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `failed source suffix receipt`,
      )
      const terminalError =
        prefixOutcome.status === `rejected` ? prefixOutcome.reason : undefined
      expect({
        prefixStatus: prefixOutcome.status,
        terminalName:
          terminalError instanceof Error ? terminalError.name : undefined,
        terminalCause:
          terminalError instanceof Error ? terminalError.cause : undefined,
        suffixStatus: suffixOutcome.status,
        suffixName:
          suffixOutcome.status === `rejected` &&
          suffixOutcome.reason instanceof Error
            ? suffixOutcome.reason.name
            : undefined,
        sameTerminal:
          suffixOutcome.status === `rejected` &&
          suffixOutcome.reason === terminalError,
        durabilityCalls,
        suffixDurable: adapter.rows.get(`suffix`),
        status: collection.status,
        exactPublicError:
          collection._lifecycle.getSyncError() === terminalError,
      }).toEqual({
        prefixStatus: `rejected`,
        terminalName: `PersistedCollectionDurabilityError`,
        terminalCause: expect.objectContaining({
          code: `PERSISTENCE_ERROR`,
          path: [`database`, `wal`],
        }),
        suffixStatus: `rejected`,
        suffixName: `PersistedCollectionDurabilityError`,
        sameTerminal: true,
        durabilityCalls: 1,
        suffixDurable: undefined,
        status: `error`,
        exactPublicError: true,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseFirstDurability.resolve()
      await cleanupPersistedOracle(
        [
          () => prefixReceipt?.catch(() => undefined),
          () => suffixReceipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`bounds partial-update dependency work by pending owner count`, async () => {
    const adapter = createRecordingAdapter()
    const hydrationEntered = createEventGate()
    const hydration = createEventGate()
    overrideBaselineRows(adapter, async () => {
      hydrationEntered.resolve()
      await hydration.promise
      return []
    })
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `pending-key-membership-work`,
        getKey: (row) => row.id,
        sync: {
          rowUpdateMode: `partial`,
          sync: (params) => {
            sourceParams = params
            params.markReady()
          },
        },
        persistence: { adapter },
      }),
    )
    const ready = collection.stateWhenReady()
    const ownerSizes = [47, 83] as const
    const partialWrites = 19
    const ownerReceipts: Array<Promise<void>> = []
    const abortedReceipts: Array<Promise<unknown>> = []
    let hasPrimaryFailure = false
    let membershipChecks = 0
    let membershipSpy: ReturnType<typeof vi.spyOn> | undefined

    try {
      await atPersistedOracleCheckpoint(
        hydrationEntered.promise,
        `key-membership hydration entered`,
      )
      for (const [ownerIndex, size] of ownerSizes.entries()) {
        sourceParams.begin()
        for (let keyIndex = 0; keyIndex < size; keyIndex++) {
          sourceParams.write({
            type: `insert`,
            value: {
              id: `owner-${ownerIndex}-${keyIndex}`,
              title: `Queued owner row`,
            },
          })
        }
        const receipt = Promise.resolve(sourceParams.commit()).then(
          () => undefined,
        )
        void receipt.catch(() => undefined)
        ownerReceipts.push(receipt)
      }

      const originalHas = Set.prototype.has
      membershipSpy = vi
        .spyOn(Set.prototype, `has`)
        .mockImplementation(function (this: Set<unknown>, value: unknown) {
          if (
            typeof value === `string` &&
            value.startsWith(`partial-`) &&
            ownerSizes.includes(this.size as (typeof ownerSizes)[number])
          ) {
            membershipChecks++
          }
          return originalHas.call(this, value)
        })
      for (let index = 0; index < partialWrites; index++) {
        const aborted = new AbortController()
        aborted.abort()
        sourceParams.begin()
        sourceParams.write({
          type: `update`,
          value: { id: `partial-${index}`, title: `Partial update` },
        })
        abortedReceipts.push(
          Promise.resolve(sourceParams.commit(aborted.signal)).catch(
            (error) => error,
          ),
        )
      }
      membershipSpy.mockRestore()
      membershipSpy = undefined

      expectPendingKeyMembershipWork(
        membershipChecks,
        ownerSizes.length,
        partialWrites,
      )
      hydration.resolve()
      await atPersistedOracleCheckpoint(ready, `key-membership hydration ready`)
      await Promise.all(
        ownerReceipts.map((receipt, index) =>
          atPersistedOracleCheckpoint(receipt, `queued owner ${index} settled`),
        ),
      )
      await Promise.all(abortedReceipts)
      expect({
        durableRows: adapter.rows.size,
        status: collection.status,
      }).toEqual({
        durableRows: ownerSizes[0] + ownerSizes[1],
        status: `ready`,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      membershipSpy?.mockRestore()
      hydration.resolve()
      await cleanupPersistedOracle(
        [
          () => ready.catch(() => undefined),
          ...ownerReceipts.map(
            (receipt) => () => receipt.catch(() => undefined),
          ),
          () => Promise.all(abortedReceipts).then(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`rejects the old operation-scan answer for pending-key work`, () => {
    const pendingOwnerSizes = [47, 83]
    const partialWrites = 19
    expect(() =>
      expectPendingKeyMembershipWork(
        pendingOwnerSizes.reduce((sum, size) => sum + size, 0) * partialWrites,
        pendingOwnerSizes.length,
        partialWrites,
      ),
    ).toThrow()
    expect(() =>
      expectPendingKeyMembershipWork(
        pendingOwnerSizes.length * partialWrites,
        pendingOwnerSizes.length,
        partialWrites,
      ),
    ).not.toThrow()
  })

  it(`fail-stops a same-key partial suffix when its staged predecessor aborts`, async () => {
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
        id: `same-key-abort-dependency`,
        getKey: (row) => row.id,
        sync: {
          rowUpdateMode: `partial`,
          sync: (params) => {
            sourceParams = params
            params.markReady()
          },
        },
        persistence: { adapter },
      }),
    )
    const aborted = new AbortController()
    let gateReceipt: Promise<void> | undefined
    let abortedReceipt: Promise<void> | undefined
    let dependentReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `same-key dependency collection ready`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `gate`, title: `holds adapter` },
      })
      gateReceipt = Promise.resolve(sourceParams.commit()).then(() => undefined)
      void gateReceipt.catch(() => undefined)
      await atPersistedOracleCheckpoint(
        firstPersistenceEntered.promise,
        `same-key dependency persistence entered`,
      )

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: {
          id: `shared`,
          title: `predecessor`,
          detail: `required inherited field`,
        },
      })
      abortedReceipt = Promise.resolve(
        sourceParams.commit(aborted.signal),
      ).then(() => undefined)
      void abortedReceipt.catch(() => undefined)

      sourceParams.begin()
      sourceParams.write({
        type: `update`,
        value: { id: `shared`, title: `dependent suffix` },
      })
      dependentReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void dependentReceipt.catch(() => undefined)

      aborted.abort()
      releaseFirstPersistence.resolve()
      await atPersistedOracleCheckpoint(
        gateReceipt,
        `dependency gate persisted`,
      )
      const abortedOutcome = await atPersistedOracleCheckpoint(
        abortedReceipt.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `same-key predecessor aborted`,
      )
      const dependentOutcome = await atPersistedOracleCheckpoint(
        dependentReceipt.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `same-key dependent suffix settled`,
      )
      const terminalError =
        abortedOutcome.status === `rejected` ? abortedOutcome.reason : undefined

      expect({
        abortedStatus: abortedOutcome.status,
        abortedName:
          terminalError instanceof Error ? terminalError.name : undefined,
        dependentStatus: dependentOutcome.status,
        dependentExact:
          dependentOutcome.status === `rejected` &&
          dependentOutcome.reason === terminalError,
        status: collection.status,
        exactPublicError:
          collection._lifecycle.getSyncError() === terminalError,
        publicRow: collection.get(`shared`),
        durableRow: adapter.rows.get(`shared`),
        pendingMarkers: collection._state.pendingSyncedTransactions.length,
      }).toEqual({
        abortedStatus: `rejected`,
        abortedName: `AbortError`,
        dependentStatus: `rejected`,
        dependentExact: true,
        status: `error`,
        exactPublicError: true,
        publicRow: undefined,
        durableRow: undefined,
        pendingMarkers: 0,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseFirstPersistence.resolve()
      await cleanupPersistedOracle(
        [
          () => gateReceipt?.catch(() => undefined),
          () => abortedReceipt?.catch(() => undefined),
          () => dependentReceipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`closes a reentrant internal transaction after a terminal failure`, async () => {
    const adapter = createRecordingAdapter([
      { id: `hydrated`, title: `starts reentrant transaction` },
    ])
    const hydrationEntered = createEventGate()
    const releaseHydration = createEventGate()
    overrideBaselineRows(adapter, async () => {
      hydrationEntered.resolve()
      await releaseHydration.promise
      return [
        {
          key: `hydrated`,
          value: { id: `hydrated`, title: `starts reentrant transaction` },
        },
      ]
    })
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `terminal-internal-transaction`,
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
    let internalReservationStarted = false
    const subscription = collection.subscribeChanges((changes) => {
      if (
        !internalReservationStarted &&
        changes.some((change) => change.key === `hydrated`)
      ) {
        internalReservationStarted = true
        sourceParams.begin()
      }
    })
    const terminalError = new Error(`terminal transaction failure`)
    let externalReceipt: Promise<void> | undefined
    let internalReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      const ready = collection.stateWhenReady()
      await atPersistedOracleCheckpoint(
        hydrationEntered.promise,
        `reentrant transaction hydration entered`,
      )
      await vi.waitFor(() => expect(sourceParams).toBeDefined())
      releaseHydration.resolve()
      await atPersistedOracleCheckpoint(ready, `reentrant transaction ready`)
      expect({
        internalReservationStarted,
        pendingMarkers: collection._state.pendingSyncedTransactions.length,
      }).toEqual({
        internalReservationStarted: true,
        pendingMarkers: 0,
      })

      adapter.applyCommittedTx = () => Promise.reject(terminalError)
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `terminal`, title: `published before failure` },
      })
      externalReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void externalReceipt.catch(() => undefined)
      await expect(
        atPersistedOracleCheckpoint(
          externalReceipt,
          `external durability failure`,
        ),
      ).rejects.toMatchObject({
        name: `PersistedCollectionDurabilityError`,
        cause: terminalError,
      })

      internalReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void internalReceipt.catch(() => undefined)
      await expect(
        atPersistedOracleCheckpoint(
          internalReceipt,
          `terminal internal transaction rejected`,
        ),
      ).rejects.toMatchObject({ name: `PersistedCollectionDurabilityError` })
      expect({
        status: collection.status,
        pendingMarkers: collection._state.pendingSyncedTransactions.length,
      }).toEqual({ status: `error`, pendingMarkers: 0 })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseHydration.resolve()
      subscription.unsubscribe()
      await cleanupPersistedOracle(
        [
          () => externalReceipt?.catch(() => undefined),
          () => internalReceipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`keeps bare sync operations away from another owner's queued marker`, async () => {
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
        id: `two-owner-marker-isolation`,
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
    let strayCommitReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `two-owner marker collection ready`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `first`, title: `holds adapter` },
      })
      firstReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void firstReceipt.catch(() => undefined)
      await atPersistedOracleCheckpoint(
        firstPersistenceEntered.promise,
        `first owner persistence entered`,
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

      let writeError: unknown
      try {
        sourceParams.write({
          type: `insert`,
          value: { id: `stray`, title: `must not steal marker` },
        })
      } catch (error) {
        writeError = error
      }
      let commitError: unknown
      try {
        const receipt = sourceParams.commit()
        if (receipt !== true) {
          strayCommitReceipt = Promise.resolve(receipt).then(() => undefined)
          void strayCommitReceipt.catch(() => undefined)
        }
      } catch (error) {
        commitError = error
      }

      expect({
        writeErrorIsOwned:
          writeError instanceof NoPendingSyncTransactionWriteError,
        commitErrorIsOwned:
          commitError instanceof NoPendingSyncTransactionCommitError,
        queuedVisible: collection.has(`queued`),
        strayVisible: collection.has(`stray`),
      }).toEqual({
        writeErrorIsOwned: true,
        commitErrorIsOwned: true,
        queuedVisible: false,
        strayVisible: false,
      })

      releaseFirstPersistence.resolve()
      await atPersistedOracleCheckpoint(firstReceipt, `first owner persisted`)
      await atPersistedOracleCheckpoint(queuedReceipt, `queued owner persisted`)
      expect({
        queued: stripVirtualProps(collection.get(`queued`)),
        stray: collection.get(`stray`),
      }).toEqual({
        queued: { id: `queued`, title: `owns queued marker` },
        stray: undefined,
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
          () => strayCommitReceipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })
})
