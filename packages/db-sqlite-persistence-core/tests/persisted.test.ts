/**
 * Ordinary tests for persistedCollectionOptions: option validation, startup metadata, coordinator and single-process subset wiring, and fixed wire-projection cases. The persisted-wrapper laws that these tests touch (durability, hydration, lifecycle) are owned by persisted-oracle.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import { createCollection, createTransaction } from '@tanstack/db'
import {
  PersistedCollectionDurabilityError,
  persistedCollectionOptions,
} from '../src'
import {
  atPersistedOracleCheckpoint,
  cleanupPersistedOracle,
  createCoordinatorHarness,
  createEventGate,
  createFailStopCoordinatorHarness,
  createRecordingAdapter,
  flushAsyncWork,
  observeSettlement,
  stripVirtualProps,
} from './persisted-support'
import type { PersistedCollectionCoordinator, ProtocolEnvelope } from '../src'
import type { Todo, TodoSyncParams } from './persisted-support'

describe(`persistedCollectionOptions`, () => {
  it(`does not publish or allocate a sequence for an empty external source transaction`, async () => {
    const adapter = Object.assign(createRecordingAdapter(), {
      getStreamPosition: () =>
        Promise.resolve({
          latestTerm: 1,
          latestSeq: 10,
          latestRowVersion: 10,
        }),
    })
    let subscriber: ((message: ProtocolEnvelope<unknown>) => void) | undefined
    const published: Array<ProtocolEnvelope<unknown>> = []
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `empty-source-follower`,
      subscribe: (_collectionId, onMessage) => {
        subscriber = onMessage
        return () => {
          subscriber = undefined
        }
      },
      publish: (_collectionId, message) => published.push(message),
      isLeader: () => false,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestEnsureRemoteSubset: async () => {},
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
    }
    let sourceBegin: (() => void) | undefined
    let sourceCommit: (() => true | Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `empty-source-sequence`,
        getKey: (row) => row.id,
        sync: {
          sync: ({ begin, commit, markReady }) => {
            sourceBegin = begin
            sourceCommit = commit
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    try {
      await collection.stateWhenReady()
      sourceBegin?.()
      await sourceCommit?.()
      await flushAsyncWork()

      expect(published).toEqual([])

      subscriber?.({
        v: 1,
        dbName: `empty-source-sequence`,
        collectionId: `empty-source-sequence`,
        senderId: `elected-owner`,
        ts: Date.now(),
        payload: {
          type: `tx:committed`,
          term: 1,
          seq: 11,
          txId: `first-real-coordinator-sequence`,
          latestRowVersion: 11,
          requiresFullReload: false,
          changedRows: [
            {
              key: `kept`,
              value: { id: `kept`, title: `First real write` },
            },
          ],
          deletedKeys: [],
        },
      })
      await flushAsyncWork()

      expect(stripVirtualProps(collection.get(`kept`))).toEqual({
        id: `kept`,
        title: `First real write`,
      })
    } finally {
      await collection.cleanup()
    }
  })

  it(`persists a wrapped sync transaction when abort follows application`, async () => {
    const adapter = createRecordingAdapter()
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit:
      ((signal?: AbortSignal) => true | Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-abort-after-application`,
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
    let releaseMutation!: () => void
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve
    })
    const transaction = createTransaction({
      mutationFn: () => mutationGate,
    })

    try {
      await collection.stateWhenReady()
      transaction.mutate(() => {
        collection.insert({ id: `local`, title: `Optimistic gate` })
      })

      const abortController = new AbortController()
      let appliedPublications = 0
      const subscription = collection.subscribeChanges((changes) => {
        if (changes.some((change) => change.key === `remote`)) {
          appliedPublications++
          abortController.abort()
        }
      })
      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `remote`, title: `Already visible` },
      })
      const receipt = remoteCommit?.(abortController.signal)
      expect(receipt).toBeInstanceOf(Promise)

      releaseMutation()
      await transaction.isPersisted.promise
      await receipt
      subscription.unsubscribe()

      expect(appliedPublications).toBe(1)
      expect(abortController.signal.aborted).toBe(true)
      expect(stripVirtualProps(collection.get(`remote`))).toEqual({
        id: `remote`,
        title: `Already visible`,
      })
      expect(adapter.applyCommittedTxCalls).toHaveLength(1)
    } finally {
      releaseMutation()
      await transaction.isPersisted.promise.catch(() => undefined)
      await collection.cleanup()
    }
  })

  // An accepted sync transaction always applies, in commit order. A later
  // abort of its signal cannot remove it or the suffix that depends on it.
  it(`applies an accepted predecessor and its suffix after the predecessor's signal aborts`, async () => {
    const adapter = createRecordingAdapter()
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit:
      ((signal?: AbortSignal) => true | Promise<void>) | undefined
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-abort-before-publication-suffix`,
        getKey: (item) => item.id,
        sync: {
          sync: (params) => {
            sourceParams = params
            remoteBegin = params.begin
            remoteWrite = params.write as (message: {
              type: `insert`
              value: Todo
            }) => void
            remoteCommit = params.commit
            params.markReady()
          },
        },
        persistence: { adapter },
      }),
    )
    const localPersistence = createEventGate()
    const localTransaction = createTransaction({
      mutationFn: () => localPersistence.promise,
    })
    const aborted = new AbortController()
    let abortedReceipt: Promise<void> | undefined
    let dependentReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await collection.stateWhenReady()
      localTransaction.mutate(() => {
        collection.insert({ id: `local`, title: `publication gate` })
      })

      remoteBegin?.()
      sourceParams.metadata!.row.set(`shared`, { owner: `aborted` })
      abortedReceipt = Promise.resolve(remoteCommit?.(aborted.signal)).then(
        () => undefined,
      )
      void abortedReceipt.catch(() => undefined)

      remoteBegin?.()
      const stagedOwner = sourceParams.metadata!.row.get(`shared`)
      remoteWrite?.({
        type: `insert`,
        value: {
          id: `dependent`,
          title:
            (stagedOwner as { owner?: string } | undefined)?.owner ?? `missing`,
        },
      })
      dependentReceipt = Promise.resolve(remoteCommit?.()).then(() => undefined)
      void dependentReceipt.catch(() => undefined)

      expect(stagedOwner).toEqual({ owner: `aborted` })
      aborted.abort()
      expect(collection.get(`dependent`)).toBeUndefined()
      localPersistence.resolve()
      await localTransaction.isPersisted.promise
      const abortedOutcome = await atPersistedOracleCheckpoint(
        abortedReceipt.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `accepted predecessor receipt settled`,
      )
      const dependentOutcome = await atPersistedOracleCheckpoint(
        dependentReceipt.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `post-abort staged suffix settled`,
      )
      expect({
        abortedStatus: abortedOutcome.status,
        dependentStatus: dependentOutcome.status,
        status: collection.status,
        visibleDependent: stripVirtualProps(collection.get(`dependent`)),
        durableDependent: adapter.rows.get(`dependent`),
        durableMetadata: adapter.rowMetadata.get(`shared`),
      }).toEqual({
        abortedStatus: `fulfilled`,
        dependentStatus: `fulfilled`,
        status: `ready`,
        visibleDependent: { id: `dependent`, title: `aborted` },
        durableDependent: { id: `dependent`, title: `aborted` },
        durableMetadata: { owner: `aborted` },
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      localPersistence.resolve()
      await cleanupPersistedOracle(
        [
          () => localTransaction.isPersisted.promise.catch(() => undefined),
          () => abortedReceipt?.catch(() => undefined),
          () => dependentReceipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`rejects a wrapped sync receipt with a named terminal persistence error`, async () => {
    const adapter = createRecordingAdapter()
    const adapterError = Object.assign(
      new Error(`adapter write failed exactly`),
      {
        code: `SQLITE_FULL`,
        path: `adapter.applyCommittedTx`,
      },
    )
    const persistenceEntered = createEventGate()
    const persistence = createEventGate()
    adapter.applyCommittedTx = async () => {
      persistenceEntered.resolve()
      await persistence.promise
    }
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-persistence-error`,
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
    let hasPrimaryFailure = false

    try {
      await collection.stateWhenReady()
      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `failed`, title: `Not durable` },
      })
      const receipt = Promise.resolve(remoteCommit?.()).then(() => undefined)
      const settlement = observeSettlement(receipt)
      await atPersistedOracleCheckpoint(
        persistenceEntered.promise,
        `terminal persistence entered`,
      )
      await flushAsyncWork()

      expect({
        receipt: settlement.read(),
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
        visible: stripVirtualProps(collection.get(`failed`)),
        durable: adapter.rows.get(`failed`),
      }).toEqual({
        receipt: { status: `pending` },
        status: `ready`,
        publicError: undefined,
        visible: { id: `failed`, title: `Not durable` },
        durable: undefined,
      })

      persistence.reject(adapterError)
      const outcome = await receipt.then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )

      const publicError = collection._lifecycle.getSyncError()
      const receiptError =
        outcome.status === `rejected` && outcome.reason instanceof Error
          ? (outcome.reason as Error & {
              code?: unknown
              path?: unknown
            })
          : undefined
      expect({
        receiptStatus: outcome.status,
        receiptErrorName: receiptError?.name,
        receiptHasNamedPersistenceSemantics:
          outcome.status === `rejected` &&
          outcome.reason instanceof PersistedCollectionDurabilityError,
        receiptCauseIsAdapterError: receiptError?.cause === adapterError,
        receiptErrorCode: receiptError?.code,
        receiptErrorPath: receiptError?.path,
        publicErrorIsReceipt:
          outcome.status === `rejected` && publicError === outcome.reason,
        status: collection.status,
        visible: stripVirtualProps(collection.get(`failed`)),
        durable: adapter.rows.get(`failed`),
      }).toEqual({
        receiptStatus: `rejected`,
        receiptErrorName: `PersistedCollectionDurabilityError`,
        receiptHasNamedPersistenceSemantics: true,
        receiptCauseIsAdapterError: true,
        receiptErrorCode: `SQLITE_FULL`,
        receiptErrorPath: `adapter.applyCommittedTx`,
        publicErrorIsReceipt: true,
        status: `error`,
        visible: { id: `failed`, title: `Not durable` },
        durable: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      persistence.reject(adapterError)
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`publishes before persistence settles, then fails with the named durability error`, async () => {
    const adapter = createRecordingAdapter()
    const persistenceError = Object.assign(new Error(`persistence failed`), {
      code: `SQLITE_IOERR_WRITE`,
      path: `todos.sqlite-wal`,
    })
    let rejectPersistence: ((error: unknown) => void) | undefined
    adapter.applyCommittedTx = () =>
      new Promise<void>((_resolve, reject) => {
        rejectPersistence = reject
      })
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-persistence-error-main`,
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
      await collection.stateWhenReady()
      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `failed`, title: `Not durable` },
      })
      const receipt = Promise.resolve(remoteCommit?.())
      let settled = false
      void receipt.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )

      expect(stripVirtualProps(collection.get(`failed`))).toEqual({
        id: `failed`,
        title: `Not durable`,
      })
      expect(settled).toBe(false)
      await vi.waitFor(() => expect(rejectPersistence).toBeTypeOf(`function`))

      rejectPersistence!(persistenceError)
      const rejection = await receipt.then(
        () => undefined,
        (error: unknown) => error,
      )

      expect(rejection).not.toBe(persistenceError)
      expect(rejection).toMatchObject({
        name: `PersistedCollectionDurabilityError`,
        code: `SQLITE_IOERR_WRITE`,
        path: `todos.sqlite-wal`,
        cause: persistenceError,
      })
      expect(adapter.rows.get(`failed`)).toBeUndefined()
      expect(collection.status).toBe(`error`)
      expect(collection._lifecycle.getSyncError()).toBe(rejection)
    } finally {
      rejectPersistence?.(persistenceError)
      await collection.cleanup()
    }
  })

  it(`preserves a coordinator persistence classification without converting it to conflict`, async () => {
    const coordinator = createCoordinatorHarness()
    const persistenceResponse = {
      type: `rpc:applyCommittedTx:res` as const,
      rpcId: `persistence-response`,
      ok: false as const,
      code: `PERSISTENCE_ERROR` as const,
      error: `disk write failed`,
      sourceCode: `SQLITE_IOERR_FSYNC`,
      path: [`database`, `wal`] as const,
    }
    coordinator.requestApplyCommittedTx = () =>
      Promise.resolve(persistenceResponse)
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `coordinator-persistence-error`,
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
        persistence: { adapter: createRecordingAdapter(), coordinator },
      }),
    )

    try {
      await collection.stateWhenReady()
      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `remote-failure`, title: `Published once` },
      })
      const rejection = await Promise.resolve(remoteCommit?.()).then(
        () => undefined,
        (error: unknown) => error,
      )

      expect(rejection).toMatchObject({
        name: `PersistedCollectionDurabilityError`,
        code: `SQLITE_IOERR_FSYNC`,
        path: [`database`, `wal`],
        cause: persistenceResponse,
      })
      expect(String(rejection)).not.toContain(`CONFLICT`)
      expect(collection.status).toBe(`error`)
      expect(collection._lifecycle.getSyncError()).toBe(rejection)
    } finally {
      await collection.cleanup()
    }
  })

  it.each([`response`, `rejection`] as const)(
    `installs terminal state before synchronously reporting an external coordinator persistence %s`,
    async (failureMode) => {
      const coordinator = createCoordinatorHarness()
      const persistenceResponse = {
        type: `rpc:applyCommittedTx:res` as const,
        rpcId: `reentrant-${failureMode}`,
        ok: false as const,
        code: `PERSISTENCE_ERROR` as const,
        error: `disk write failed`,
        sourceCode: `SQLITE_IOERR_FSYNC`,
        path: [`database`, `wal`] as const,
      }
      const rejectedError = new PersistedCollectionDurabilityError(
        `coordinator persistence request rejected`,
        {
          cause: persistenceResponse,
          code: persistenceResponse.sourceCode,
          path: persistenceResponse.path,
        },
      )
      const requestApplyCommittedTx = vi.fn(() =>
        failureMode === `response`
          ? Promise.resolve(persistenceResponse)
          : Promise.reject(rejectedError),
      )
      coordinator.requestApplyCommittedTx = requestApplyCommittedTx
      let sourceParams!: TodoSyncParams
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `terminal-before-report-${failureMode}`,
          getKey: (item) => item.id,
          sync: {
            sync: (params) => {
              sourceParams = params
              params.markReady()
            },
          },
          persistence: { adapter: createRecordingAdapter(), coordinator },
        }),
      )
      let reentrantKeyReads = 0
      let reentrantReceipt:
        | Promise<
            { status: `fulfilled` } | { status: `rejected`; reason: unknown }
          >
        | undefined
      let hasPrimaryFailure = false

      try {
        await collection.stateWhenReady()
        const originalMarkError = collection._lifecycle.markError.bind(
          collection._lifecycle,
        )
        vi.spyOn(collection._lifecycle, `markError`).mockImplementation(
          (error) => {
            sourceParams.begin()
            sourceParams.write({
              type: `insert`,
              value: {
                get id() {
                  reentrantKeyReads++
                  return `reentrant`
                },
                title: `must be fenced before error observation`,
              },
            })
            reentrantReceipt = Promise.resolve(sourceParams.commit()).then(
              () => ({ status: `fulfilled` as const }),
              (reason: unknown) => ({ status: `rejected` as const, reason }),
            )
            originalMarkError(error)
          },
        )

        sourceParams.begin()
        sourceParams.write({
          type: `insert`,
          value: { id: `failed`, title: `must become terminal first` },
        })
        const primaryOutcome = await Promise.resolve(
          sourceParams.commit(),
        ).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        )
        const reentrantOutcome = await atPersistedOracleCheckpoint(
          reentrantReceipt!,
          `reentrant source receipt after coordinator ${failureMode}`,
        )
        const terminalError =
          primaryOutcome.status === `rejected`
            ? primaryOutcome.reason
            : undefined

        expect({
          primaryStatus: primaryOutcome.status,
          reentrantStatus: reentrantOutcome.status,
          sameTerminal:
            reentrantOutcome.status === `rejected` &&
            reentrantOutcome.reason === terminalError,
          reentrantKeyReads,
          coordinatorCalls: requestApplyCommittedTx.mock.calls.length,
          exactPublicError:
            collection._lifecycle.getSyncError() === terminalError,
        }).toEqual({
          primaryStatus: `rejected`,
          reentrantStatus: `rejected`,
          sameTerminal: true,
          reentrantKeyReads: 0,
          coordinatorCalls: 1,
          exactPublicError: true,
        })
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        await cleanupPersistedOracle(
          [() => reentrantReceipt, () => collection.cleanup()],
          hasPrimaryFailure,
        )
      }
    },
  )

  it(`keeps durability failure terminal when publication aborts the signal`, async () => {
    const adapter = createRecordingAdapter()
    const storageError = Object.assign(
      new Error(`post-publication durability failed exactly`),
      {
        code: `SQLITE_IOERR`,
        path: `adapter.applyCommittedTx`,
      },
    )
    const persistenceEntered = createEventGate()
    const releasePersistence = createEventGate()
    adapter.applyCommittedTx = async () => {
      persistenceEntered.resolve()
      await releasePersistence.promise
      throw storageError
    }
    let sourceParams!: TodoSyncParams
    const abortController = new AbortController()
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `post-publication-abort-durability`,
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
    const publication = collection.subscribeChanges((changes) => {
      if (changes.some((entry) => entry.key === `failed`)) {
        abortController.abort()
      }
    })
    let receipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `post-publication abort collection ready`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `failed`, title: `visible before durability` },
      })
      receipt = Promise.resolve(
        sourceParams.commit(abortController.signal),
      ).then(() => undefined)
      void receipt.catch(() => undefined)
      await atPersistedOracleCheckpoint(
        persistenceEntered.promise,
        `post-publication abort persistence entered`,
      )

      expect({
        signalAborted: abortController.signal.aborted,
        visible: stripVirtualProps(collection.get(`failed`)),
        status: collection.status,
      }).toEqual({
        signalAborted: true,
        visible: { id: `failed`, title: `visible before durability` },
        status: `ready`,
      })

      releasePersistence.resolve()
      const outcome = await atPersistedOracleCheckpoint(
        receipt.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `post-publication abort durability receipt`,
      )
      const terminalError =
        outcome.status === `rejected` ? outcome.reason : undefined

      expect({
        receiptStatus: outcome.status,
        namedDurability:
          terminalError instanceof PersistedCollectionDurabilityError,
        cause: terminalError instanceof Error ? terminalError.cause : undefined,
        exactPublicError:
          collection._lifecycle.getSyncError() === terminalError,
        status: collection.status,
        durable: adapter.rows.get(`failed`),
      }).toEqual({
        receiptStatus: `rejected`,
        namedDurability: true,
        cause: storageError,
        exactPublicError: true,
        status: `error`,
        durable: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releasePersistence.resolve()
      publication.unsubscribe()
      await cleanupPersistedOracle(
        [() => receipt?.catch(() => undefined), () => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`reserves FIFO admission before a publication callback commits a sibling`, async () => {
    const adapter = createRecordingAdapter()
    const successfulApply = adapter.applyCommittedTx.bind(adapter)
    const firstPersistenceEntered = createEventGate()
    const releaseFirstPersistence = createEventGate()
    const firstStorageError = new Error(`reentrant first durability failed`)
    let applyCalls = 0
    adapter.applyCommittedTx = async (...args) => {
      applyCalls++
      if (applyCalls === 1) {
        firstPersistenceEntered.resolve()
        await releaseFirstPersistence.promise
        throw firstStorageError
      }
      await successfulApply(...args)
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `reentrant-fifo-admission`,
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
    let siblingReceipt: Promise<void> | undefined
    let publicationTriggers = 0
    const subscription = collection.subscribeChanges((changes) => {
      if (
        publicationTriggers === 0 &&
        changes.some((entry) => entry.key === `first`)
      ) {
        publicationTriggers++
        sourceParams.begin()
        sourceParams.write({
          type: `insert`,
          value: { id: `sibling`, title: `must remain queued` },
        })
        siblingReceipt = Promise.resolve(sourceParams.commit()).then(
          () => undefined,
        )
        void siblingReceipt.catch(() => undefined)
      }
    })
    let firstReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `reentrant FIFO collection ready`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `first`, title: `publishes before durability` },
      })
      firstReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void firstReceipt.catch(() => undefined)
      await atPersistedOracleCheckpoint(
        firstPersistenceEntered.promise,
        `reentrant first persistence entered`,
      )
      await Promise.resolve()

      expect(siblingReceipt).toBeInstanceOf(Promise)
      const firstSettlement = observeSettlement(firstReceipt)
      const siblingSettlement = observeSettlement(siblingReceipt!)
      await Promise.resolve()
      expect({
        publicationTriggers,
        applyCalls,
        firstReceipt: firstSettlement.read(),
        siblingReceipt: siblingSettlement.read(),
        visibleFirst: stripVirtualProps(collection.get(`first`)),
        visibleSibling: collection.get(`sibling`),
        durableFirst: adapter.rows.get(`first`),
        durableSibling: adapter.rows.get(`sibling`),
      }).toEqual({
        publicationTriggers: 1,
        applyCalls: 1,
        firstReceipt: { status: `pending` },
        siblingReceipt: { status: `pending` },
        visibleFirst: { id: `first`, title: `publishes before durability` },
        visibleSibling: undefined,
        durableFirst: undefined,
        durableSibling: undefined,
      })

      releaseFirstPersistence.resolve()
      const firstOutcome = await atPersistedOracleCheckpoint(
        firstReceipt.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `reentrant first receipt rejected`,
      )
      const siblingOutcome = await atPersistedOracleCheckpoint(
        siblingReceipt!.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `reentrant sibling receipt rejected`,
      )
      const terminalError =
        firstOutcome.status === `rejected` ? firstOutcome.reason : undefined
      expect({
        firstStatus: firstOutcome.status,
        siblingStatus: siblingOutcome.status,
        sameTerminal:
          siblingOutcome.status === `rejected` &&
          siblingOutcome.reason === terminalError,
        status: collection.status,
        publicErrorIsFirst:
          collection._lifecycle.getSyncError() === terminalError,
        visibleSibling: collection.get(`sibling`),
        durableSibling: adapter.rows.get(`sibling`),
        applyCalls,
      }).toEqual({
        firstStatus: `rejected`,
        siblingStatus: `rejected`,
        sameTerminal: true,
        status: `error`,
        publicErrorIsFirst: true,
        visibleSibling: undefined,
        durableSibling: undefined,
        applyCalls: 1,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseFirstPersistence.resolve()
      subscription.unsubscribe()
      await cleanupPersistedOracle(
        [
          () => firstReceipt?.catch(() => undefined),
          () => siblingReceipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`keeps a reentrant sibling behind its hydration-drained parent outcome`, async () => {
    const adapter = createRecordingAdapter()
    const loadEntered = createEventGate()
    const rejectLoad = createEventGate()
    const subsetFailure = new Error(`request-local hydration failed`)
    adapter.loadSubset = async () => {
      loadEntered.resolve()
      await rejectLoad.promise
      throw subsetFailure
    }
    const persistenceEntered = createEventGate()
    const releasePersistence = createEventGate()
    const durabilityFailure = new Error(`hydration-drained durability failed`)
    let applyCalls = 0
    adapter.applyCommittedTx = async () => {
      applyCalls++
      persistenceEntered.resolve()
      await releasePersistence.promise
      throw durabilityFailure
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `hydration-drained-reentrant-fifo`,
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
    let siblingReceipt: Promise<void> | undefined
    const publication = collection.subscribeChanges((changes) => {
      if (
        siblingReceipt === undefined &&
        changes.some((change) => change.key === `parent`)
      ) {
        sourceParams.begin()
        sourceParams.write({
          type: `insert`,
          value: { id: `sibling`, title: `Must await parent outcome` },
        })
        siblingReceipt = Promise.resolve(sourceParams.commit()).then(
          () => undefined,
        )
        void siblingReceipt.catch(() => undefined)
      }
    })
    let load: Promise<void> | undefined
    let parentReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `hydration-drained FIFO collection ready`,
      )
      load = Promise.resolve(collection._sync.loadSubset({ limit: 1 })).then(
        () => undefined,
      )
      void load.catch(() => undefined)
      await atPersistedOracleCheckpoint(
        loadEntered.promise,
        `hydration-drained load entered`,
      )

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `parent`, title: `Publishes during failure drain` },
      })
      parentReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void parentReceipt.catch(() => undefined)
      rejectLoad.resolve()
      await atPersistedOracleCheckpoint(
        persistenceEntered.promise,
        `hydration-drained parent persistence entered`,
      )
      await Promise.resolve()

      expect(siblingReceipt).toBeInstanceOf(Promise)
      const parentSettlement = observeSettlement(parentReceipt)
      const siblingSettlement = observeSettlement(siblingReceipt!)
      await Promise.resolve()
      expect({
        applyCalls,
        parentReceipt: parentSettlement.read(),
        siblingReceipt: siblingSettlement.read(),
        publicParent: stripVirtualProps(collection.get(`parent`)),
        publicSibling: collection.get(`sibling`),
        durableSibling: adapter.rows.get(`sibling`),
      }).toEqual({
        applyCalls: 1,
        parentReceipt: { status: `pending` },
        siblingReceipt: { status: `pending` },
        publicParent: { id: `parent`, title: `Publishes during failure drain` },
        publicSibling: undefined,
        durableSibling: undefined,
      })

      releasePersistence.resolve()
      const parentOutcome = await atPersistedOracleCheckpoint(
        parentReceipt.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `hydration-drained parent rejected`,
      )
      const siblingOutcome = await atPersistedOracleCheckpoint(
        siblingReceipt!.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `hydration-drained sibling rejected`,
      )
      const loadOutcome = await atPersistedOracleCheckpoint(
        load.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `hydration-drained load settled`,
      )
      const terminalError =
        parentOutcome.status === `rejected` ? parentOutcome.reason : undefined

      expect({
        parentStatus: parentOutcome.status,
        siblingStatus: siblingOutcome.status,
        loadStatus: loadOutcome.status,
        sameSibling:
          siblingOutcome.status === `rejected` &&
          siblingOutcome.reason === terminalError,
        sameLoad:
          loadOutcome.status === `rejected` &&
          loadOutcome.reason === terminalError,
        namedDurability:
          terminalError instanceof PersistedCollectionDurabilityError,
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
        publicSibling: collection.get(`sibling`),
        applyCalls,
      }).toEqual({
        parentStatus: `rejected`,
        siblingStatus: `rejected`,
        loadStatus: `rejected`,
        sameSibling: true,
        sameLoad: true,
        namedDurability: true,
        status: `error`,
        publicError: terminalError,
        publicSibling: undefined,
        applyCalls: 1,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      rejectLoad.resolve()
      releasePersistence.resolve()
      publication.unsubscribe()
      await cleanupPersistedOracle(
        [
          () => load?.catch(() => undefined),
          () => parentReceipt?.catch(() => undefined),
          () => siblingReceipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`rejects a queued suffix derived from an aborted staged metadata layer`, async () => {
    const adapter = createRecordingAdapter()
    const successfulApply = adapter.applyCommittedTx.bind(adapter)
    const firstPersistenceEntered = createEventGate()
    const releaseFirstPersistence = createEventGate()
    let applyCalls = 0
    adapter.applyCommittedTx = async (...args) => {
      applyCalls++
      if (applyCalls === 1) {
        firstPersistenceEntered.resolve()
        await releaseFirstPersistence.promise
      }
      await successfulApply(...args)
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `aborted-staged-metadata-suffix`,
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
    let firstReceipt: Promise<void> | undefined
    let abortedReceipt: Promise<void> | undefined
    let dependentReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `aborted staged metadata collection ready`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `first`, title: `durability gate` },
      })
      firstReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void firstReceipt.catch(() => undefined)
      await atPersistedOracleCheckpoint(
        firstPersistenceEntered.promise,
        `first persistence entered before staged suffix`,
      )

      sourceParams.begin()
      sourceParams.metadata!.row.set(`shared`, { owner: `aborted` })
      abortedReceipt = Promise.resolve(
        sourceParams.commit(aborted.signal),
      ).then(() => undefined)
      void abortedReceipt.catch(() => undefined)

      sourceParams.begin()
      const stagedOwner = sourceParams.metadata!.row.get(`shared`)
      sourceParams.write({
        type: `insert`,
        value: {
          id: `dependent`,
          title:
            (stagedOwner as { owner?: string } | undefined)?.owner ?? `missing`,
        },
      })
      dependentReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void dependentReceipt.catch(() => undefined)

      expect(stagedOwner).toEqual({ owner: `aborted` })
      aborted.abort()
      releaseFirstPersistence.resolve()
      await atPersistedOracleCheckpoint(
        firstReceipt,
        `first durability gate settled`,
      )
      const abortedOutcome = await atPersistedOracleCheckpoint(
        abortedReceipt.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `aborted staged receipt settled`,
      )
      const dependentOutcome = await atPersistedOracleCheckpoint(
        dependentReceipt.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `dependent staged receipt settled`,
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
        visibleDependent: collection.get(`dependent`),
        durableDependent: adapter.rows.get(`dependent`),
        durableMetadata: adapter.rowMetadata.get(`shared`),
        applyCalls,
      }).toEqual({
        abortedStatus: `rejected`,
        abortedName: `AbortError`,
        dependentStatus: `rejected`,
        dependentExact: true,
        status: `error`,
        exactPublicError: true,
        visibleDependent: undefined,
        durableDependent: undefined,
        durableMetadata: undefined,
        applyCalls: 1,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseFirstPersistence.resolve()
      await cleanupPersistedOracle(
        [
          () => firstReceipt?.catch(() => undefined),
          () => abortedReceipt?.catch(() => undefined),
          () => dependentReceipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not fail-stop when an aborted staged collection metadata write was superseded`, async () => {
    const adapter = createRecordingAdapter()
    const successfulApply = adapter.applyCommittedTx.bind(adapter)
    const firstPersistenceEntered = createEventGate()
    const releaseFirstPersistence = createEventGate()
    let applyCalls = 0
    adapter.applyCommittedTx = async (...args) => {
      applyCalls++
      if (applyCalls === 1) {
        firstPersistenceEntered.resolve()
        await releaseFirstPersistence.promise
      }
      await successfulApply(...args)
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `superseded-staged-collection-metadata`,
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
    const olderAbort = new AbortController()
    let firstReceipt: Promise<void> | undefined
    let olderReceipt: Promise<void> | undefined
    let newerReceipt: Promise<void> | undefined
    let dependentReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `superseded collection metadata owner ready`,
      )

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `first`, title: `durability gate` },
      })
      firstReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void firstReceipt.catch(() => undefined)
      await atPersistedOracleCheckpoint(
        firstPersistenceEntered.promise,
        `first persistence entered before superseded metadata writes`,
      )

      sourceParams.begin()
      sourceParams.metadata!.collection.set(`shared`, { owner: `older` })
      olderReceipt = Promise.resolve(
        sourceParams.commit(olderAbort.signal),
      ).then(() => undefined)
      void olderReceipt.catch(() => undefined)

      sourceParams.begin()
      sourceParams.metadata!.collection.set(`shared`, { owner: `newer` })
      newerReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void newerReceipt.catch(() => undefined)

      sourceParams.begin()
      const stagedOwner = sourceParams
        .metadata!.collection.list()
        .find(({ key }) => key === `shared`)?.value
      sourceParams.write({
        type: `insert`,
        value: {
          id: `dependent`,
          title:
            (stagedOwner as { owner?: string } | undefined)?.owner ?? `missing`,
        },
      })
      dependentReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void dependentReceipt.catch(() => undefined)

      expect(stagedOwner).toEqual({ owner: `newer` })
      olderAbort.abort()
      releaseFirstPersistence.resolve()
      await atPersistedOracleCheckpoint(
        firstReceipt,
        `superseded metadata durability gate settled`,
      )
      const olderOutcome = await atPersistedOracleCheckpoint(
        olderReceipt.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `superseded older metadata receipt settled`,
      )
      const newerOutcome = await atPersistedOracleCheckpoint(
        newerReceipt.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `newer metadata receipt settled`,
      )
      const dependentOutcome = await atPersistedOracleCheckpoint(
        dependentReceipt.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `newest-owner dependent receipt settled`,
      )

      expect({
        olderStatus: olderOutcome.status,
        newerStatus: newerOutcome.status,
        dependentStatus: dependentOutcome.status,
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
        visibleDependent: stripVirtualProps(collection.get(`dependent`)),
        durableDependent: adapter.rows.get(`dependent`),
        durableMetadata: adapter.collectionMetadata.get(`shared`),
        applyCalls,
      }).toEqual({
        olderStatus: `rejected`,
        newerStatus: `fulfilled`,
        dependentStatus: `fulfilled`,
        status: `ready`,
        publicError: undefined,
        visibleDependent: { id: `dependent`, title: `newer` },
        durableDependent: { id: `dependent`, title: `newer` },
        durableMetadata: { owner: `newer` },
        applyCalls: 3,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseFirstPersistence.resolve()
      await cleanupPersistedOracle(
        [
          () => firstReceipt?.catch(() => undefined),
          () => olderReceipt?.catch(() => undefined),
          () => newerReceipt?.catch(() => undefined),
          () => dependentReceipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not let an old external coordinator success affect a restarted lifecycle`, async () => {
    const id = `external-lifecycle-success`
    const adapter = createRecordingAdapter()
    const oldPersistenceEntered = createEventGate()
    const releaseOldPersistence = createEventGate()
    const coordinator = createFailStopCoordinatorHarness(id)
    let requestCalls = 0
    coordinator.requestApplyCommittedTx = async (_collectionId, tx) => {
      requestCalls++
      oldPersistenceEntered.resolve()
      await releaseOldPersistence.promise
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
    const replacement = {
      id: `replacement`,
      title: `owned by restarted lifecycle`,
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
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
    let oldSettlement:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `${id} initial lifecycle ready`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `old`, title: `must remain owned by old lifecycle` },
      })
      oldSettlement = Promise.resolve(sourceParams.commit()).then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      await atPersistedOracleCheckpoint(
        oldPersistenceEntered.promise,
        `${id} old persistence entered`,
      )

      await collection.cleanup()
      cleanedUp = true
      adapter.rows.set(replacement.id, replacement)
      collection.startSyncImmediate()
      cleanedUp = false
      const replacementSettlement = collection.stateWhenReady().then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      releaseOldPersistence.resolve()

      const oldOutcome = await atPersistedOracleCheckpoint(
        oldSettlement,
        `${id} old receipt settled`,
      )
      const replacementOutcome = await atPersistedOracleCheckpoint(
        replacementSettlement,
        `${id} replacement lifecycle settled`,
      )
      await flushAsyncWork()

      expect({
        oldReceiptStatus: oldOutcome.status,
        replacementStatus: replacementOutcome.status,
        replacementVisible: stripVirtualProps(collection.get(replacement.id)),
        replacementPublicError: collection._lifecycle.getSyncError(),
        staleBroadcasts: coordinator.publishCalls.length,
        requestCalls,
      }).toEqual({
        oldReceiptStatus: `fulfilled`,
        replacementStatus: `fulfilled`,
        replacementVisible: replacement,
        replacementPublicError: undefined,
        staleBroadcasts: 0,
        requestCalls: 1,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseOldPersistence.resolve()
      await cleanupPersistedOracle(
        [
          () => oldSettlement,
          () => (cleanedUp ? undefined : collection.cleanup()),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not let an old external coordinator failure poison a restarted lifecycle`, async () => {
    const id = `external-lifecycle-failure`
    const adapter = createRecordingAdapter()
    const oldPersistenceEntered = createEventGate()
    const releaseOldPersistence = createEventGate()
    const oldCoordinatorError = new PersistedCollectionDurabilityError(
      `old lifecycle coordinator failure`,
      { code: `SQLITE_IOERR_FSYNC`, path: [`database`, `wal`] },
    )
    const coordinator = createFailStopCoordinatorHarness(id)
    let requestCalls = 0
    coordinator.requestApplyCommittedTx = async (_collectionId, tx) => {
      requestCalls++
      if (requestCalls === 1) {
        oldPersistenceEntered.resolve()
        await releaseOldPersistence.promise
        throw oldCoordinatorError
      }
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
    const replacement = {
      id: `replacement`,
      title: `owned by restarted lifecycle`,
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
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
    const startAndWaitForReady = async (label: string) => {
      const ready = createEventGate()
      const unsubscribe = collection.on(`status:ready`, () => ready.resolve())
      collection.startSyncImmediate()
      try {
        await atPersistedOracleCheckpoint(ready.promise, label)
      } finally {
        unsubscribe()
      }
    }
    let oldSettlement:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let replacementReceipt:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let hasPrimaryFailure = false

    try {
      await startAndWaitForReady(`${id} initial lifecycle ready`)
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `old`, title: `must remain owned by old lifecycle` },
      })
      oldSettlement = Promise.resolve(sourceParams.commit()).then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      await atPersistedOracleCheckpoint(
        oldPersistenceEntered.promise,
        `${id} old persistence entered`,
      )

      await collection.cleanup()
      await startAndWaitForReady(
        `${id} replacement lifecycle ready before old failure`,
      )
      sourceParams.begin()
      sourceParams.write({ type: `insert`, value: replacement })
      replacementReceipt = Promise.resolve(sourceParams.commit()).then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      releaseOldPersistence.resolve()

      const oldOutcome = await atPersistedOracleCheckpoint(
        oldSettlement,
        `${id} old receipt settled`,
      )
      const replacementOutcome = await atPersistedOracleCheckpoint(
        replacementReceipt,
        `${id} replacement transaction settled`,
      )
      await flushAsyncWork()

      expect({
        oldReceiptStatus: oldOutcome.status,
        replacementStatus: replacementOutcome.status,
        replacementVisible: stripVirtualProps(collection.get(replacement.id)),
        replacementPublicError: collection._lifecycle.getSyncError(),
        broadcasts: coordinator.publishCalls.length,
        requestCalls,
      }).toEqual({
        oldReceiptStatus: `rejected`,
        replacementStatus: `fulfilled`,
        replacementVisible: replacement,
        replacementPublicError: undefined,
        broadcasts: 0,
        requestCalls: 2,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseOldPersistence.resolve()
      await cleanupPersistedOracle(
        [
          () => oldSettlement,
          () => replacementReceipt,
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })
})
