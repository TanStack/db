import { describe, expect, it, vi } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import {
  BasicIndex,
  DbClient,
  IR,
  NoPendingSyncTransactionCommitError,
  NoPendingSyncTransactionWriteError,
  collectionOptions,
  createCollection,
  createTransaction,
} from '@tanstack/db'
import {
  InvalidPersistedCollectionCoordinatorError,
  InvalidPersistedStorageKeyEncodingError,
  InvalidPersistedStorageKeyError,
  InvalidSyncConfigError,
  PersistenceDurabilityError,
  SingleProcessCoordinator,
  createPersistedTableName,
  decodePersistedStorageKey,
  encodePersistedStorageKey,
  persistedCollectionOptions,
} from '../src'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionPersistence,
  PersistedSyncWrappedOptions,
  PersistenceAdapter,
  ProtocolEnvelope,
  PullSinceResponse,
  TxCommitted,
} from '../src'
import type {
  LoadSubsetOptions,
  PendingMutation,
  SyncConfig,
} from '@tanstack/db'

/**
 * # Does persisted wrapping preserve one Collection history?
 *
 * RFC #1659 invariant 7 requires each accepted sync transaction to become
 * durable, remain replayable, or fail through an observable channel. Startup
 * hydrates rows and metadata, buffers concurrent source work, then publishes a
 * coherent public snapshot. Publication precedes durability, but a rejected
 * durability boundary must reject its applied receipt and fail-stop that sync
 * run without admitting a suffix.
 *
 * `foldDurabilityLedger` is the independent model for append-only source
 * obligations. The history grammar crosses hydration, a held adapter,
 * immediate/normal ordering, independent/dependent aborts, reservation failure
 * boundaries, ambient owner operations, receipt rejection, coordinator replay,
 * cleanup, and restart. Tests drive the real persisted wrapper, Collection,
 * coordinator, adapter, and local mutation path. Named checkpoints compare
 * public and durable rows, metadata, receipt settlement, exact errors, call
 * order, and lifecycle ownership.
 *
 * Fixed witnesses and bounded schedule tables preserve the known failure
 * paths. The model's omission and reordering controls challenge its judgment.
 * Native SQLite hosts, live Electric service behavior, adapter cancellation,
 * and the open B2-failure/E4 schedule remain separate evidence.
 */

/**
 * # Does persisted wrapping preserve one Collection history?
 *
 * Persistence adds a durable replica beneath an optional upstream sync source.
 * Startup hydrates rows and metadata, buffers concurrent remote work, then
 * publishes one coherent state. Committed transactions persist in sequence;
 * gaps recover through deltas or reload. Subset demands keep local and upstream
 * ownership separate so cancellation, release, offline mode, and retry cannot
 * steal a sibling acquisition lease.
 *
 * The recording adapter is a plain durable-state model: Maps for rows and
 * metadata plus ordered transaction, index, load, and reload calls. Tests drive
 * the real wrapper, Collection, coordinator, receipts, transactions, indexes,
 * cleanup, and restart. They compare durable state, public rows, metadata,
 * request options, sequence evidence, errors, and late-work fencing.
 *
 * Driver SQL behavior, browser page ownership, native runtimes, and the shared
 * conformance portfolio have separate owners. This file models persistence
 * protocol state, not a particular SQLite engine.
 */

type Todo = {
  id: string
  title: string
  detail?: string
}

type TodoSyncParams = Parameters<SyncConfig<Todo, string>[`sync`]>[0]

type RecordingAdapter = PersistenceAdapter & {
  applyCommittedTxCalls: Array<{
    collectionId: string
    tx: {
      term: number
      seq: number
      rowVersion: number
      truncate?: boolean
      mutations: Array<{
        type: `insert` | `update` | `delete`
        key: string | number
      }>
    }
  }>
  ensureIndexCalls: Array<{ collectionId: string; signature: string }>
  markIndexRemovedCalls: Array<{ collectionId: string; signature: string }>
  loadSubsetCalls: Array<{
    collectionId: string
    options: LoadSubsetOptions
    requiredIndexSignatures: ReadonlyArray<string>
  }>
  loadCollectionMetadataCalls: Array<string>
  rows: Map<string, Todo>
  rowMetadata: Map<string, unknown>
  collectionMetadata: Map<string, unknown>
}

function createRecordingAdapter(
  initialRows: Array<Todo> = [],
): RecordingAdapter {
  const rows = new Map(initialRows.map((row) => [row.id, row]))
  const rowMetadata = new Map<string, unknown>()

  const adapter: RecordingAdapter = {
    rows,
    rowMetadata,
    collectionMetadata: new Map(),
    applyCommittedTxCalls: [],
    ensureIndexCalls: [],
    markIndexRemovedCalls: [],
    loadSubsetCalls: [],
    loadCollectionMetadataCalls: [],
    loadSubset: (collectionId, options, ctx) => {
      adapter.loadSubsetCalls.push({
        collectionId,
        options,
        requiredIndexSignatures: ctx?.requiredIndexSignatures ?? [],
      })
      return Promise.resolve(
        Array.from(rows.values()).map((value) => ({
          key: value.id,
          value,
          metadata: rowMetadata.get(value.id),
        })),
      )
    },
    loadCollectionMetadata: (collectionId) => {
      adapter.loadCollectionMetadataCalls.push(collectionId)
      return Promise.resolve(
        Array.from(adapter.collectionMetadata.entries()).map(
          ([key, value]) => ({
            key,
            value,
          }),
        ),
      )
    },
    scanRows: () =>
      Promise.resolve(
        Array.from(rows.values()).map((value) => ({
          key: value.id,
          value,
          metadata: rowMetadata.get(value.id),
        })),
      ),
    applyCommittedTx: (collectionId, tx) => {
      adapter.applyCommittedTxCalls.push({
        collectionId,
        tx: {
          term: tx.term,
          seq: tx.seq,
          rowVersion: tx.rowVersion,
          truncate: tx.truncate,
          mutations: tx.mutations.map((mutation) => ({
            type: mutation.type,
            key: mutation.key,
          })),
        },
      })

      if (tx.truncate) {
        rows.clear()
        rowMetadata.clear()
      }

      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) {
          rows.delete(mutation.key as string)
          rowMetadata.delete(mutation.key as string)
        } else {
          rows.set(mutation.key as string, mutation.value as Todo)
          if (mutation.metadataChanged) {
            rowMetadata.set(mutation.key as string, mutation.metadata)
          }
        }
      }
      for (const rowMetadataMutation of tx.rowMetadataMutations ?? []) {
        if (rowMetadataMutation.type === `delete`) {
          rowMetadata.delete(rowMetadataMutation.key as string)
        } else {
          rowMetadata.set(
            rowMetadataMutation.key as string,
            rowMetadataMutation.value,
          )
        }
      }
      for (const metadataMutation of tx.collectionMetadataMutations ?? []) {
        if (metadataMutation.type === `delete`) {
          adapter.collectionMetadata.delete(metadataMutation.key)
        } else {
          adapter.collectionMetadata.set(
            metadataMutation.key,
            metadataMutation.value,
          )
        }
      }
      return Promise.resolve()
    },
    ensureIndex: (collectionId, signature) => {
      adapter.ensureIndexCalls.push({ collectionId, signature })
      return Promise.resolve()
    },
    markIndexRemoved: (collectionId, signature) => {
      adapter.markIndexRemovedCalls.push({ collectionId, signature })
      return Promise.resolve()
    },
  }

  return adapter
}

function createNoopAdapter(): PersistenceAdapter {
  return {
    loadSubset: () => Promise.resolve([]),
    applyCommittedTx: () => Promise.resolve(),
    ensureIndex: () => Promise.resolve(),
  }
}

type CoordinatorHarness = PersistedCollectionCoordinator & {
  emit: (payload: TxCommitted, senderId?: string) => void
  pullSinceCalls: number
  setPullSinceResponse: (response: PullSinceResponse) => void
}

function createCoordinatorHarness(): CoordinatorHarness {
  let subscriber: ((message: ProtocolEnvelope<unknown>) => void) | undefined =
    undefined
  let pullSinceResponse: PullSinceResponse = {
    type: `rpc:pullSince:res`,
    rpcId: `pull-0`,
    ok: true,
    latestTerm: 1,
    latestSeq: 0,
    latestRowVersion: 0,
    requiresFullReload: false,
    changedKeys: [],
    deletedKeys: [],
  }

  const harness: CoordinatorHarness = {
    pullSinceCalls: 0,
    getNodeId: () => `coordinator-node`,
    subscribe: (_collectionId, onMessage) => {
      subscriber = onMessage
      return () => {
        subscriber = undefined
      }
    },
    publish: () => {},
    isLeader: () => true,
    ensureLeadership: async () => {},
    requestEnsurePersistedIndex: async () => {},
    requestEnsureRemoteSubset: async () => {},
    pullSince: () => {
      harness.pullSinceCalls++
      return Promise.resolve(pullSinceResponse)
    },
    emit: (payload, senderId = `remote-node`) => {
      subscriber?.({
        v: 1,
        dbName: `test-db`,
        collectionId: `sync-present`,
        senderId,
        ts: Date.now(),
        payload,
      })
    },
    setPullSinceResponse: (response) => {
      pullSinceResponse = response
    },
  }

  return harness
}

type FailStopCoordinatorHarness = PersistedCollectionCoordinator & {
  emit: (payload: unknown, senderId?: string) => void
  publishCalls: Array<ProtocolEnvelope<unknown>>
  remoteEnsureCalls: Array<LoadSubsetOptions>
  unsubscribeCalls: number
}

function createFailStopCoordinatorHarness(
  collectionId: string,
): FailStopCoordinatorHarness {
  let subscriber: ((message: ProtocolEnvelope<unknown>) => void) | undefined
  const harness: FailStopCoordinatorHarness = {
    publishCalls: [],
    remoteEnsureCalls: [],
    unsubscribeCalls: 0,
    getNodeId: () => `fail-stop-coordinator`,
    subscribe: (_collectionId, onMessage) => {
      subscriber = onMessage
      return () => {
        harness.unsubscribeCalls++
        subscriber = undefined
      }
    },
    publish: (_collectionId, message) => {
      harness.publishCalls.push(message)
    },
    isLeader: () => true,
    ensureLeadership: async () => {},
    requestEnsurePersistedIndex: async () => {},
    requestEnsureRemoteSubset: async (_collectionId, options) => {
      harness.remoteEnsureCalls.push(options)
    },
    emit: (payload, senderId = `remote-fail-stop-peer`) => {
      subscriber?.({
        v: 1,
        dbName: `test-db`,
        collectionId,
        senderId,
        ts: Date.now(),
        payload,
      })
    },
  }
  return harness
}

const stripVirtualProps = <T extends Record<string, any> | undefined>(
  value: T,
): T => {
  if (!value || typeof value !== `object`) return value
  const {
    $synced: _synced,
    $origin: _origin,
    $key: _key,
    $collectionId: _collectionId,
    ...rest
  } = value as Record<string, unknown>
  return rest as T
}

async function flushAsyncWork(delayMs: number = 0): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

function createEventGate(): {
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
} {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function atPersistedOracleCheckpoint<T>(
  promise: Promise<T>,
  label: string,
  timeout = 1000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`Persisted oracle checkpoint timed out: ${label}`),
            ),
          timeout,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function cleanupPersistedOracle(
  actions: Array<() => void | Promise<unknown>>,
  hasPrimaryFailure: boolean,
): Promise<void> {
  const failures: Array<unknown> = []
  for (const [index, action] of actions.entries()) {
    try {
      await atPersistedOracleCheckpoint(
        Promise.resolve().then(action),
        `cleanup stage ${index}`,
        250,
      )
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) {
    if (hasPrimaryFailure) {
      console.warn(
        `Persisted oracle cleanup failed after the primary failure:`,
        failures,
      )
    } else {
      throw new AggregateError(failures, `Persisted oracle cleanup failed`)
    }
  }
}

type DurabilityLedgerEvent =
  | { type: `begin`; transactionId: string }
  | { type: `write`; transactionId: string; row: Todo }
  | { type: `commit`; transactionId: string }
  | { type: `abort`; transactionId: string }

// RFC #1659 durability law: a source commit remains one append-only obligation
// across a persistence hydration boundary. The independent fold deliberately
// has no hydration phase, queue, generation, or production transaction helper.
// These fixtures exercise the core adapter contract with in-memory storage;
// they do not claim native SQLite host or device execution.
function foldDurabilityLedger(events: ReadonlyArray<DurabilityLedgerEvent>): {
  committedRows: Map<string, Todo>
  commitOrder: Array<string>
} {
  const open = new Map<string, Array<Todo>>()
  const committedRows = new Map<string, Todo>()
  const commitOrder: Array<string> = []

  for (const event of events) {
    if (event.type === `begin`) {
      open.set(event.transactionId, [])
    } else if (event.type === `write`) {
      open.get(event.transactionId)?.push(structuredClone(event.row))
    } else if (event.type === `abort`) {
      open.delete(event.transactionId)
    } else {
      const rows = open.get(event.transactionId)
      if (!rows) continue
      for (const row of rows) committedRows.set(row.id, row)
      commitOrder.push(event.transactionId)
      open.delete(event.transactionId)
    }
  }

  return { committedRows, commitOrder }
}

function observeSettlement(promise: Promise<void>): {
  read: () =>
    | { status: `pending` }
    | { status: `fulfilled` }
    | { status: `rejected`; reason: unknown }
} {
  let outcome:
    | { status: `pending` }
    | { status: `fulfilled` }
    | { status: `rejected`; reason: unknown } = { status: `pending` }
  void promise.then(
    () => {
      outcome = { status: `fulfilled` }
    },
    (reason: unknown) => {
      outcome = { status: `rejected`, reason }
    },
  )
  return { read: () => outcome }
}

async function runRejectedHydrationBufferWitness(
  id: string,
  rows: ReadonlyArray<Todo>,
  options: { commitAfterHydrationFailure?: boolean } = {},
): Promise<void> {
  const hydrationEntered = createEventGate()
  const releaseHydration = createEventGate()
  const hydrationRejected = createEventGate()
  const hydrationError = new Error(`persisted hydration rejected exactly`)
  const adapter = createRecordingAdapter()
  const successfulLoadSubset = adapter.loadSubset.bind(adapter)
  adapter.loadSubset = async () => {
    hydrationEntered.resolve()
    await releaseHydration.promise
    hydrationRejected.resolve()
    throw hydrationError
  }

  let remoteBegin: (() => void) | undefined
  let remoteWrite:
    | ((message: { type: `insert`; value: Todo }) => void)
    | undefined
  let remoteCommit: (() => true | Promise<void>) | undefined
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id,
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
  let initialCollectionCleaned = false
  const cleanupActions: Array<() => void | Promise<unknown>> = [
    () => (initialCollectionCleaned ? undefined : collection.cleanup()),
  ]
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})

  try {
    void collection.stateWhenReady().catch(() => undefined)
    await atPersistedOracleCheckpoint(
      hydrationEntered.promise,
      `${id} hydration entered`,
    )
    expect(remoteBegin).toBeTypeOf(`function`)
    expect(remoteWrite).toBeTypeOf(`function`)
    expect(remoteCommit).toBeTypeOf(`function`)

    const committers = rows.map((row) => {
      remoteBegin!()
      remoteWrite!({ type: `insert`, value: row })
      return () => {
        const receipt = remoteCommit!()
        expect(receipt).toBeInstanceOf(Promise)
        return observeSettlement(Promise.resolve(receipt).then(() => undefined))
      }
    })
    let receipts = options.commitAfterHydrationFailure
      ? []
      : committers.map((commit) => commit())

    releaseHydration.resolve()
    await atPersistedOracleCheckpoint(
      hydrationRejected.promise,
      `${id} hydration rejected`,
    )
    await flushAsyncWork()

    if (options.commitAfterHydrationFailure) {
      receipts = committers.map((commit) => commit())
      await flushAsyncWork()
    }

    const receiptOutcomes = receipts.map((receipt) => {
      const outcome = receipt.read()
      return outcome.status === `rejected`
        ? {
            status: outcome.status,
            exactReason: outcome.reason === hydrationError,
          }
        : outcome
    })
    expect({
      status: collection.status,
      exactPublicError: collection._lifecycle.getSyncError() === hydrationError,
      receiptOutcomes,
      visibleRows: rows.filter((row) => collection.has(row.id)),
      durableRows: rows.filter((row) => adapter.rows.has(row.id)),
      durabilityCalls: adapter.applyCommittedTxCalls.length,
    }).toEqual({
      status: `error`,
      exactPublicError: true,
      receiptOutcomes: rows.map(() => ({
        status: `rejected`,
        exactReason: true,
      })),
      visibleRows: [],
      durableRows: [],
      durabilityCalls: 0,
    })

    await atPersistedOracleCheckpoint(
      collection.cleanup(),
      `${id} failed collection cleanup`,
    )
    initialCollectionCleaned = true
    adapter.loadSubset = successfulLoadSubset

    const reopened = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
        getKey: (item) => item.id,
        persistence: { adapter },
      }),
    )
    cleanupActions.push(() => reopened.cleanup())
    await atPersistedOracleCheckpoint(
      reopened.stateWhenReady(),
      `${id} reopened hydration`,
    )
    await flushAsyncWork()

    expect({
      visibleRows: rows.filter((row) => reopened.has(row.id)),
      durableRows: rows.filter((row) => adapter.rows.has(row.id)),
      rowMetadata: Array.from(adapter.rowMetadata.entries()),
      collectionMetadata: Array.from(adapter.collectionMetadata.entries()),
      durabilityCalls: adapter.applyCommittedTxCalls.length,
    }).toEqual({
      visibleRows: [],
      durableRows: [],
      rowMetadata: [],
      collectionMetadata: [],
      durabilityCalls: 0,
    })

    const freshRow = { id: `${id}:fresh`, title: `post-restart control` }
    const freshTransaction = reopened.insert(freshRow)
    await atPersistedOracleCheckpoint(
      (async () => {
        await freshTransaction.isPersisted.promise
      })(),
      `${id} fresh transaction persisted`,
    )
    await flushAsyncWork()

    expect({
      visibleFreshRow: stripVirtualProps(reopened.get(freshRow.id)),
      durableFreshRow: adapter.rows.get(freshRow.id),
      staleVisibleRows: rows.filter((row) => reopened.has(row.id)),
      staleDurableRows: rows.filter((row) => adapter.rows.has(row.id)),
      rowMetadata: Array.from(adapter.rowMetadata.entries()),
      collectionMetadata: Array.from(adapter.collectionMetadata.entries()),
      appliedKeys: adapter.applyCommittedTxCalls.flatMap(({ tx }) =>
        tx.mutations.map((mutation) => mutation.key),
      ),
    }).toEqual({
      visibleFreshRow: freshRow,
      durableFreshRow: freshRow,
      staleVisibleRows: [],
      staleDurableRows: [],
      rowMetadata: [],
      collectionMetadata: [],
      appliedKeys: [freshRow.id],
    })
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseHydration.resolve()
    warning.mockRestore()
    await cleanupPersistedOracle(cleanupActions, hasPrimaryFailure)
  }
}

let generatedOwnershipHistoryId = 0

function sortedTodoRows(rows: Iterable<Todo>): Array<Todo> {
  return Array.from(rows).sort((left, right) => left.id.localeCompare(right.id))
}

async function runImmediateOrderingLaw(
  relation: `same-key` | `disjoint`,
  olderTitle: string,
  newerTitle: string,
): Promise<void> {
  const historyId = ++generatedOwnershipHistoryId
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
      id: `generated-immediate-order-${historyId}`,
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
  const receipts: Array<Promise<void>> = []
  let hasPrimaryFailure = false

  try {
    await atPersistedOracleCheckpoint(
      collection.stateWhenReady(),
      `generated immediate ordering ready`,
    )
    sourceParams.begin()
    sourceParams.write({
      type: `insert`,
      value: { id: `gate`, title: `holds adapter` },
    })
    receipts.push(Promise.resolve(sourceParams.commit()).then(() => undefined))
    receipts.forEach((receipt) => void receipt.catch(() => undefined))
    await atPersistedOracleCheckpoint(
      firstPersistenceEntered.promise,
      `generated immediate ordering adapter hold`,
    )

    const olderKey = relation === `same-key` ? `shared` : `older`
    const newerKey = relation === `same-key` ? `shared` : `newer`
    const expected = new Map<string, Todo>([
      [`gate`, { id: `gate`, title: `holds adapter` }],
    ])
    expected.set(olderKey, { id: olderKey, title: olderTitle })

    sourceParams.begin()
    sourceParams.write({
      type: `insert`,
      value: { id: olderKey, title: olderTitle },
    })
    const olderReceipt = Promise.resolve(sourceParams.commit()).then(
      () => undefined,
    )
    receipts.push(olderReceipt)
    void olderReceipt.catch(() => undefined)

    sourceParams.begin({ immediate: true })
    sourceParams.write({
      type: relation === `same-key` ? `update` : `insert`,
      value: { id: newerKey, title: newerTitle },
    })
    expected.set(newerKey, { id: newerKey, title: newerTitle })
    const newerReceipt = Promise.resolve(sourceParams.commit()).then(
      () => undefined,
    )
    receipts.push(newerReceipt)
    void newerReceipt.catch(() => undefined)

    expect(
      sortedTodoRows(Array.from(collection.values()).map(stripVirtualProps)),
    ).toEqual(sortedTodoRows(expected.values()))

    releaseFirstPersistence.resolve()
    for (const [index, receipt] of receipts.entries()) {
      await atPersistedOracleCheckpoint(
        receipt,
        `generated immediate receipt ${index}`,
      )
    }
    expect({
      publicRows: sortedTodoRows(
        Array.from(collection.values()).map(stripVirtualProps),
      ),
      durableRows: sortedTodoRows(adapter.rows.values()),
      status: collection.status,
      pendingMarkers: collection._state.pendingSyncedTransactions.length,
    }).toEqual({
      publicRows: sortedTodoRows(expected.values()),
      durableRows: sortedTodoRows(expected.values()),
      status: `ready`,
      pendingMarkers: 0,
    })
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseFirstPersistence.resolve()
    await cleanupPersistedOracle(
      [
        ...receipts.map((receipt) => () => receipt.catch(() => undefined)),
        () => collection.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
}

async function runAbortRelationshipLaw(
  relationship: `independent` | `same-key`,
  predecessorTitle: string,
  successorTitle: string,
): Promise<void> {
  const historyId = ++generatedOwnershipHistoryId
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
      id: `generated-abort-graph-${historyId}`,
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
  const abortController = new AbortController()
  const receipts: Array<Promise<void>> = []
  let hasPrimaryFailure = false

  try {
    await atPersistedOracleCheckpoint(
      collection.stateWhenReady(),
      `generated abort graph ready`,
    )
    sourceParams.begin()
    sourceParams.write({
      type: `insert`,
      value: { id: `gate`, title: `holds adapter` },
    })
    const gateReceipt = Promise.resolve(sourceParams.commit()).then(
      () => undefined,
    )
    receipts.push(gateReceipt)
    void gateReceipt.catch(() => undefined)
    await atPersistedOracleCheckpoint(
      firstPersistenceEntered.promise,
      `generated abort graph adapter hold`,
    )

    const predecessorKey = relationship === `same-key` ? `shared` : `aborted`
    sourceParams.begin()
    sourceParams.write({
      type: `insert`,
      value: {
        id: predecessorKey,
        title: predecessorTitle,
        detail: `predecessor-only`,
      },
    })
    const predecessorReceipt = Promise.resolve(
      sourceParams.commit(abortController.signal),
    ).then(() => undefined)
    receipts.push(predecessorReceipt)
    void predecessorReceipt.catch(() => undefined)

    const successorKey = relationship === `same-key` ? `shared` : `survivor`
    sourceParams.begin()
    sourceParams.write({
      type: relationship === `same-key` ? `update` : `insert`,
      value: { id: successorKey, title: successorTitle },
    })
    const successorReceipt = Promise.resolve(sourceParams.commit()).then(
      () => undefined,
    )
    receipts.push(successorReceipt)
    void successorReceipt.catch(() => undefined)

    abortController.abort()
    releaseFirstPersistence.resolve()
    await atPersistedOracleCheckpoint(gateReceipt, `generated abort gate`)
    const predecessor = await atPersistedOracleCheckpoint(
      predecessorReceipt.then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      ),
      `generated predecessor abort`,
    )
    const successor = await atPersistedOracleCheckpoint(
      successorReceipt.then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      ),
      `generated successor settlement`,
    )
    const abortError =
      predecessor.status === `rejected` ? predecessor.reason : undefined

    expect({
      predecessorStatus: predecessor.status,
      predecessorName:
        abortError instanceof Error ? abortError.name : undefined,
      successorStatus: successor.status,
      sameFailure:
        successor.status === `rejected` && successor.reason === abortError,
      status: collection.status,
      publicSuccessor: stripVirtualProps(collection.get(successorKey)),
      durableSuccessor: adapter.rows.get(successorKey),
      pendingMarkers: collection._state.pendingSyncedTransactions.length,
    }).toEqual(
      relationship === `same-key`
        ? {
            predecessorStatus: `rejected`,
            predecessorName: `AbortError`,
            successorStatus: `rejected`,
            sameFailure: true,
            status: `error`,
            publicSuccessor: undefined,
            durableSuccessor: undefined,
            pendingMarkers: 0,
          }
        : {
            predecessorStatus: `rejected`,
            predecessorName: `AbortError`,
            successorStatus: `fulfilled`,
            sameFailure: false,
            status: `ready`,
            publicSuccessor: { id: successorKey, title: successorTitle },
            durableSuccessor: { id: successorKey, title: successorTitle },
            pendingMarkers: 0,
          },
    )
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseFirstPersistence.resolve()
    await cleanupPersistedOracle(
      [
        ...receipts.map((receipt) => () => receipt.catch(() => undefined)),
        () => collection.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
}

async function runBareOwnerOperationLaw(
  operation: `write` | `commit` | `truncate`,
  queuedTitle: string,
): Promise<void> {
  const historyId = ++generatedOwnershipHistoryId
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
      id: `generated-owner-isolation-${historyId}`,
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
  const receipts: Array<Promise<void>> = []
  let unexpectedReceipt: Promise<void> | undefined
  let hasPrimaryFailure = false

  try {
    await atPersistedOracleCheckpoint(
      collection.stateWhenReady(),
      `generated owner isolation ready`,
    )
    sourceParams.begin()
    sourceParams.write({
      type: `insert`,
      value: { id: `first`, title: `must survive` },
    })
    const firstReceipt = Promise.resolve(sourceParams.commit()).then(
      () => undefined,
    )
    receipts.push(firstReceipt)
    void firstReceipt.catch(() => undefined)
    await atPersistedOracleCheckpoint(
      firstPersistenceEntered.promise,
      `generated owner isolation adapter hold`,
    )

    sourceParams.begin()
    sourceParams.write({
      type: `insert`,
      value: { id: `queued`, title: queuedTitle },
    })
    const queuedReceipt = Promise.resolve(sourceParams.commit()).then(
      () => undefined,
    )
    receipts.push(queuedReceipt)
    void queuedReceipt.catch(() => undefined)

    let observedError: unknown
    try {
      if (operation === `write`) {
        sourceParams.write({
          type: `insert`,
          value: { id: `stray`, title: `must not publish` },
        })
      } else if (operation === `truncate`) {
        sourceParams.truncate()
      } else {
        const result = sourceParams.commit()
        if (result !== true) {
          unexpectedReceipt = Promise.resolve(result).then(() => undefined)
          void unexpectedReceipt.catch(() => undefined)
        }
      }
    } catch (error) {
      observedError = error
    }
    expect({
      exactError:
        operation === `commit`
          ? observedError instanceof NoPendingSyncTransactionCommitError
          : observedError instanceof NoPendingSyncTransactionWriteError,
      strayVisible: collection.has(`stray`),
    }).toEqual({ exactError: true, strayVisible: false })

    releaseFirstPersistence.resolve()
    await atPersistedOracleCheckpoint(firstReceipt, `generated first owner`)
    await atPersistedOracleCheckpoint(queuedReceipt, `generated queued owner`)
    expect({
      publicRows: sortedTodoRows(
        Array.from(collection.values()).map(stripVirtualProps),
      ),
      durableRows: sortedTodoRows(adapter.rows.values()),
      pendingMarkers: collection._state.pendingSyncedTransactions.length,
    }).toEqual({
      publicRows: sortedTodoRows([
        { id: `first`, title: `must survive` },
        { id: `queued`, title: queuedTitle },
      ]),
      durableRows: sortedTodoRows([
        { id: `first`, title: `must survive` },
        { id: `queued`, title: queuedTitle },
      ]),
      pendingMarkers: 0,
    })
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseFirstPersistence.resolve()
    await cleanupPersistedOracle(
      [
        ...receipts.map((receipt) => () => receipt.catch(() => undefined)),
        () => unexpectedReceipt?.catch(() => undefined),
        () => collection.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
}

async function runInternalReservationBoundaryLaw(
  boundary: `abort` | `cleanup` | `terminal-failure`,
  hydratedTitle: string,
): Promise<void> {
  const historyId = ++generatedOwnershipHistoryId
  const hydrated = { id: `hydrated`, title: hydratedTitle }
  const adapter = createRecordingAdapter([hydrated])
  const hydrationEntered = createEventGate()
  const releaseHydration = createEventGate()
  adapter.loadSubset = async () => {
    hydrationEntered.resolve()
    await releaseHydration.promise
    return [{ key: hydrated.id, value: hydrated }]
  }
  let sourceParams!: TodoSyncParams
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: `generated-internal-reservation-${historyId}`,
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
      changes.some((change) => change.key === hydrated.id)
    ) {
      internalReservationStarted = true
      sourceParams.begin()
    }
  })
  const receipts: Array<Promise<void>> = []
  let cleanedUp = false
  let hasPrimaryFailure = false

  try {
    const ready = collection.stateWhenReady()
    await atPersistedOracleCheckpoint(
      hydrationEntered.promise,
      `generated internal hydration entered`,
    )
    releaseHydration.resolve()
    await atPersistedOracleCheckpoint(ready, `generated internal ready`)
    expect({
      internalReservationStarted,
      pendingMarkers: collection._state.pendingSyncedTransactions.length,
    }).toEqual({ internalReservationStarted: true, pendingMarkers: 1 })

    if (boundary === `cleanup`) {
      await atPersistedOracleCheckpoint(
        collection.cleanup(),
        `generated internal cleanup`,
      )
      cleanedUp = true
      expect({
        status: collection.status,
        pendingMarkers: collection._state.pendingSyncedTransactions.length,
      }).toEqual({ status: `cleaned-up`, pendingMarkers: 0 })
      return
    }

    if (boundary === `abort`) {
      const abortController = new AbortController()
      abortController.abort()
      const receipt = Promise.resolve(
        sourceParams.commit(abortController.signal),
      ).then(() => undefined)
      receipts.push(receipt)
      void receipt.catch(() => undefined)
      await expect(
        atPersistedOracleCheckpoint(receipt, `generated internal abort`),
      ).rejects.toMatchObject({ name: `AbortError` })
      expect({
        status: collection.status,
        pendingMarkers: collection._state.pendingSyncedTransactions.length,
      }).toEqual({ status: `ready`, pendingMarkers: 0 })
      return
    }

    const terminalError = new Error(`generated terminal reservation failure`)
    adapter.applyCommittedTx = () => Promise.reject(terminalError)
    sourceParams.begin()
    sourceParams.write({
      type: `insert`,
      value: { id: `terminal`, title: `published before failure` },
    })
    const externalReceipt = Promise.resolve(sourceParams.commit()).then(
      () => undefined,
    )
    receipts.push(externalReceipt)
    void externalReceipt.catch(() => undefined)
    await expect(
      atPersistedOracleCheckpoint(
        externalReceipt,
        `generated external terminal failure`,
      ),
    ).rejects.toMatchObject({
      name: `PersistenceDurabilityError`,
      cause: terminalError,
    })

    const internalReceipt = Promise.resolve(sourceParams.commit()).then(
      () => undefined,
    )
    receipts.push(internalReceipt)
    void internalReceipt.catch(() => undefined)
    await expect(
      atPersistedOracleCheckpoint(
        internalReceipt,
        `generated terminal internal settlement`,
      ),
    ).rejects.toMatchObject({ name: `PersistenceDurabilityError` })
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
        ...receipts.map((receipt) => () => receipt.catch(() => undefined)),
        () => (cleanedUp ? undefined : collection.cleanup()),
      ],
      hasPrimaryFailure,
    )
  }
}

async function createTerminalFailureHarness(
  kind: `hydration` | `durability`,
  id: string,
) {
  const seed = { id: `seed`, title: `stable before terminal failure` }
  const adapter = createRecordingAdapter([seed])
  adapter.rowMetadata.set(seed.id, `row-metadata-before-failure`)
  adapter.collectionMetadata.set(`resume`, `collection-metadata-before-failure`)
  const coordinator = createFailStopCoordinatorHarness(id)
  const upstreamLoads: Array<LoadSubsetOptions> = []
  const upstreamUnloads: Array<LoadSubsetOptions> = []
  let sourceParams!: TodoSyncParams
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          sourceParams = params
          params.markReady()
          return {
            loadSubset: (options) => {
              upstreamLoads.push(options)
              return true
            },
            unloadSubset: (options) => {
              upstreamUnloads.push(options)
            },
          }
        },
      },
      persistence: { adapter, coordinator },
    }),
  )
  const initialLease: LoadSubsetOptions = { limit: 1 }
  await atPersistedOracleCheckpoint(
    collection.stateWhenReady(),
    `${id} initially ready`,
  )
  await atPersistedOracleCheckpoint(
    Promise.resolve(collection._sync.loadSubset(initialLease)),
    `${id} initial lease hydrated`,
  )
  await flushAsyncWork()

  let terminalError: unknown
  if (kind === `hydration`) {
    const hydrationError = new Error(`${id} terminal hydration failure`)
    adapter.loadSubset = () => Promise.reject(hydrationError)
    const outcome = await atPersistedOracleCheckpoint(
      Promise.resolve(collection._sync.loadSubset({ limit: 2 })).then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      ),
      `${id} hydration failure settled`,
    )
    expect(outcome).toEqual({ status: `rejected`, reason: hydrationError })
    terminalError = hydrationError
  } else {
    const adapterError = Object.assign(new Error(`${id} storage failure`), {
      code: `SQLITE_FULL`,
      path: `adapter.applyCommittedTx`,
    })
    adapter.applyCommittedTx = () => Promise.reject(adapterError)
    sourceParams.begin()
    sourceParams.write({
      type: `insert`,
      value: { id: `first`, title: `published before terminal failure` },
    })
    const outcome = await atPersistedOracleCheckpoint(
      Promise.resolve(sourceParams.commit()).then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      ),
      `${id} durability failure settled`,
    )
    expect(outcome.status).toBe(`rejected`)
    terminalError = outcome.status === `rejected` ? outcome.reason : undefined
    expect(terminalError).toBeInstanceOf(PersistenceDurabilityError)
    expect(
      terminalError instanceof Error ? terminalError.cause : undefined,
    ).toBe(adapterError)
  }

  expect(collection.status).toBe(`error`)
  expect(collection._lifecycle.getSyncError()).toBe(terminalError)

  return {
    adapter,
    collection,
    coordinator,
    initialLease,
    seed,
    sourceParams,
    terminalError,
    upstreamLoads,
    upstreamUnloads,
  }
}

describe(`persistedCollectionOptions`, () => {
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

    await insertTx.isPersisted.promise

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

    expect(adapter.loadCollectionMetadataCalls).toEqual([
      `persisted-startup-metadata`,
    ])
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
      latestRowVersion: 2,
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

  it(`throws InvalidSyncConfigError when sync key is present but invalid`, () => {
    const invalidOptions = {
      id: `invalid-sync-shape`,
      getKey: (item: Todo) => item.id,
      sync: {} as unknown as SyncConfig<Todo, string>,
      persistence: {
        adapter: createNoopAdapter(),
      },
    } as PersistedSyncWrappedOptions<Todo, string>

    expect(() => persistedCollectionOptions(invalidOptions)).toThrow(
      InvalidSyncConfigError,
    )
  })

  it(`uses SingleProcessCoordinator when coordinator is omitted`, () => {
    const options = persistedCollectionOptions<Todo, string>({
      id: `default-coordinator`,
      getKey: (item) => item.id,
      persistence: {
        adapter: createNoopAdapter(),
      },
    })

    expect(options.persistence.coordinator).toBeInstanceOf(
      SingleProcessCoordinator,
    )
  })

  it(`resolves persistence per collection and forwards schemaVersion`, () => {
    const baseAdapter = createNoopAdapter()
    const syncAdapter = createNoopAdapter()
    const localAdapter = createNoopAdapter()
    const resolverCalls: Array<{
      collectionId: string
      mode: `sync-present` | `sync-absent`
      schemaVersion?: number
    }> = []

    const persistence: PersistedCollectionPersistence = {
      adapter: baseAdapter,
      resolvePersistenceForCollection: (options) => {
        resolverCalls.push(options)
        return {
          adapter: options.mode === `sync-present` ? syncAdapter : localAdapter,
        }
      },
    }

    const syncOptions = persistedCollectionOptions<Todo, string>({
      id: `sync-collection`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
      schemaVersion: 7,
      persistence,
    })
    expect(syncOptions.persistence.adapter).toBe(syncAdapter)

    const localOptions = persistedCollectionOptions<Todo, string>({
      id: `local-collection`,
      getKey: (item) => item.id,
      schemaVersion: 3,
      persistence,
    })
    expect(localOptions.persistence.adapter).toBe(localAdapter)

    expect(resolverCalls).toEqual([
      {
        collectionId: `sync-collection`,
        mode: `sync-present`,
        schemaVersion: 7,
      },
      {
        collectionId: `local-collection`,
        mode: `sync-absent`,
        schemaVersion: 3,
      },
    ])
  })

  it(`throws for invalid coordinator implementations`, () => {
    const invalidCoordinator = {
      getNodeId: () => `node-1`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: async () => {},
      // requestEnsurePersistedIndex is intentionally missing
    } as unknown as PersistedCollectionCoordinator

    expect(() =>
      persistedCollectionOptions<Todo, string>({
        id: `invalid-coordinator`,
        getKey: (item) => item.id,
        persistence: {
          adapter: createNoopAdapter(),
          coordinator: invalidCoordinator,
        },
      }),
    ).toThrow(InvalidPersistedCollectionCoordinatorError)
  })

  it(`preserves valid sync config in sync-present mode`, async () => {
    const adapter = createRecordingAdapter()
    const sync: SyncConfig<Todo, string> = {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({
          type: `insert`,
          value: {
            id: `remote-1`,
            title: `From remote`,
          },
        })
        commit()
        markReady()
      },
    }

    const options = persistedCollectionOptions<Todo, string>({
      id: `sync-present`,
      getKey: (item: Todo) => item.id,
      sync,
      persistence: {
        adapter,
      },
    })

    const collection = createCollection(options)
    await collection.stateWhenReady()
    await flushAsyncWork()

    expect(stripVirtualProps(collection.get(`remote-1`))).toEqual({
      id: `remote-1`,
      title: `From remote`,
    })
    expect(adapter.applyCommittedTxCalls).toHaveLength(1)
    expect(adapter.applyCommittedTxCalls[0]?.tx.mutations[0]?.type).toBe(
      `update`,
    )
  })

  it(`does not apply or persist a wrapped sync transaction committed with an aborted signal`, async () => {
    const adapter = createRecordingAdapter()
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit:
      | ((signal?: AbortSignal) => true | Promise<void>)
      | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-aborted-commit`,
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
      const abortController = new AbortController()
      abortController.abort()
      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `aborted`, title: `Must not publish` },
      })
      await expect(
        remoteCommit?.(abortController.signal),
      ).rejects.toMatchObject({ name: `AbortError` })
      await flushAsyncWork()

      expect(collection.get(`aborted`)).toBeUndefined()
      expect(adapter.applyCommittedTxCalls).toHaveLength(0)
      expect(collection._state.pendingSyncedTransactions).toHaveLength(0)

      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `recovered`, title: `Later transaction` },
      })
      await remoteCommit?.()

      expect(stripVirtualProps(collection.get(`recovered`))).toEqual({
        id: `recovered`,
        title: `Later transaction`,
      })
      expect(adapter.rows.get(`recovered`)).toEqual({
        id: `recovered`,
        title: `Later transaction`,
      })
      expect(collection._state.pendingSyncedTransactions).toHaveLength(0)
    } finally {
      await collection.cleanup()
    }
  })

  it(`persists a wrapped sync transaction when abort follows application`, async () => {
    const adapter = createRecordingAdapter()
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit:
      | ((signal?: AbortSignal) => true | Promise<void>)
      | undefined
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

  it(`fail-stops a queued suffix when its staged predecessor aborts before publication`, async () => {
    const adapter = createRecordingAdapter()
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit:
      | ((signal?: AbortSignal) => true | Promise<void>)
      | undefined
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
      const abortedOutcome = await atPersistedOracleCheckpoint(
        abortedReceipt.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `staged predecessor aborted before publication`,
      )
      localPersistence.resolve()
      await localTransaction.isPersisted.promise
      const dependentOutcome = await atPersistedOracleCheckpoint(
        dependentReceipt.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `post-abort staged suffix settled`,
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
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
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
          outcome.reason instanceof PersistenceDurabilityError,
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
        receiptErrorName: `PersistenceDurabilityError`,
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
        namedDurability: terminalError instanceof PersistenceDurabilityError,
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

  it(`does not let an old external adapter success affect a restarted lifecycle`, async () => {
    const id = `external-lifecycle-success`
    const adapter = createRecordingAdapter()
    const successfulApply = adapter.applyCommittedTx.bind(adapter)
    const oldPersistenceEntered = createEventGate()
    const releaseOldPersistence = createEventGate()
    adapter.applyCommittedTx = async (...args) => {
      oldPersistenceEntered.resolve()
      await releaseOldPersistence.promise
      await successfulApply(...args)
    }
    const coordinator = createFailStopCoordinatorHarness(id)
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
      adapter.loadSubset = () =>
        Promise.resolve([{ key: replacement.id, value: replacement }])
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
      }).toEqual({
        oldReceiptStatus: `fulfilled`,
        replacementStatus: `fulfilled`,
        replacementVisible: replacement,
        replacementPublicError: undefined,
        staleBroadcasts: 0,
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

  it(`does not let an old external adapter failure poison a restarted lifecycle`, async () => {
    const id = `external-lifecycle-failure`
    const adapter = createRecordingAdapter()
    const successfulApply = adapter.applyCommittedTx.bind(adapter)
    const oldPersistenceEntered = createEventGate()
    const releaseOldPersistence = createEventGate()
    const oldAdapterError = new Error(`old lifecycle adapter failure`)
    let applyCalls = 0
    adapter.applyCommittedTx = async (...args) => {
      applyCalls++
      if (applyCalls === 1) {
        oldPersistenceEntered.resolve()
        await releaseOldPersistence.promise
        throw oldAdapterError
      }
      await successfulApply(...args)
    }
    const coordinator = createFailStopCoordinatorHarness(id)
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
        applyCalls,
      }).toEqual({
        oldReceiptStatus: `rejected`,
        replacementStatus: `fulfilled`,
        replacementVisible: replacement,
        replacementPublicError: undefined,
        broadcasts: 1,
        applyCalls: 2,
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

  it(`does not deliver coordinator work accepted before lifecycle replacement into the new owner`, async () => {
    const id = `queued-coordinator-lifecycle`
    const adapter = createRecordingAdapter()
    const oldReloadEntered = createEventGate()
    const releaseOldReload = createEventGate()
    const replacementHydrationEntered = createEventGate()
    const releaseReplacementHydration = createEventGate()
    let subsetCalls = 0
    adapter.loadSubset = async () => {
      subsetCalls++
      if (subsetCalls === 2) {
        oldReloadEntered.resolve()
        await releaseOldReload.promise
        return []
      }
      if (subsetCalls === 3) {
        replacementHydrationEntered.resolve()
        await releaseReplacementHydration.promise
        return [
          {
            key: `replacement`,
            value: { id: `replacement`, title: `new owner baseline` },
          },
        ]
      }
      return []
    }
    const coordinator = createFailStopCoordinatorHarness(id)
    const replacementControlsReady = createEventGate()
    let sourceRuns = 0
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            sourceRuns++
            if (sourceRuns === 2) replacementControlsReady.resolve()
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let replacementReady:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `queued coordinator initial owner ready`,
      )
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `old-reload-gate`,
        latestRowVersion: 1,
        requiresFullReload: true,
      })
      await atPersistedOracleCheckpoint(
        oldReloadEntered.promise,
        `old coordinator reload entered`,
      )
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 2,
        txId: `queued-before-restart`,
        latestRowVersion: 2,
        requiresFullReload: false,
        changedRows: [
          {
            key: `stale`,
            value: { id: `stale`, title: `must stay with old owner` },
          },
        ],
        deletedKeys: [],
      })

      await collection.cleanup()
      cleanedUp = true
      collection.startSyncImmediate()
      cleanedUp = false
      replacementReady = collection.stateWhenReady().then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      await atPersistedOracleCheckpoint(
        replacementControlsReady.promise,
        `replacement sync controls installed`,
      )
      releaseOldReload.resolve()
      await atPersistedOracleCheckpoint(
        replacementHydrationEntered.promise,
        `replacement hydration entered after queued coordinator work`,
      )

      expect({
        sourceRuns,
        subsetCalls,
        staleVisible: collection.get(`stale`),
        staleDurable: adapter.rows.get(`stale`),
        replacementPublicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        sourceRuns: 2,
        subsetCalls: 3,
        staleVisible: undefined,
        staleDurable: undefined,
        replacementPublicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseOldReload.resolve()
      releaseReplacementHydration.resolve()
      await cleanupPersistedOracle(
        [
          () => replacementReady,
          () => (cleanedUp ? undefined : collection.cleanup()),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`discards a queued collection reset when its owner is cleaned up`, async () => {
    const id = `queued-reset-lifecycle`
    const adapter = createRecordingAdapter()
    const oldReloadEntered = createEventGate()
    const releaseOldReload = createEventGate()
    let subsetCalls = 0
    adapter.loadSubset = async () => {
      subsetCalls++
      if (subsetCalls === 2) {
        oldReloadEntered.resolve()
        await releaseOldReload.promise
      }
      return []
    }
    const coordinator = createFailStopCoordinatorHarness(id)
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `queued reset initial owner ready`,
      )
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `old-reset-gate`,
        latestRowVersion: 1,
        requiresFullReload: true,
      })
      await atPersistedOracleCheckpoint(
        oldReloadEntered.promise,
        `old reload entered before queued reset`,
      )
      coordinator.emit({
        type: `collection:reset`,
        schemaVersion: 1,
        resetEpoch: 1,
      })

      await collection.cleanup()
      cleanedUp = true
      releaseOldReload.resolve()
      await flushAsyncWork()
      await flushAsyncWork()

      expect({
        subsetCalls,
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        subsetCalls: 2,
        status: `cleaned-up`,
        publicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseOldReload.resolve()
      await cleanupPersistedOracle(
        [() => (cleanedUp ? undefined : collection.cleanup())],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not apply a delayed seq-gap replay response into a restarted lifecycle`, async () => {
    const id = `delayed-pull-since-lifecycle`
    const adapter = createRecordingAdapter()
    const pullEntered = createEventGate()
    const releasePull = createEventGate()
    const replacementHydrationEntered = createEventGate()
    const releaseReplacementHydration = createEventGate()
    let subsetCalls = 0
    adapter.loadSubset = async () => {
      subsetCalls++
      if (subsetCalls === 2) {
        replacementHydrationEntered.resolve()
        await releaseReplacementHydration.promise
        return [
          {
            key: `replacement`,
            value: { id: `replacement`, title: `new owner baseline` },
          },
        ]
      }
      return []
    }
    const coordinator = createFailStopCoordinatorHarness(id)
    coordinator.pullSince = async () => {
      pullEntered.resolve()
      await releasePull.promise
      return {
        type: `rpc:pullSince:res`,
        rpcId: `old-delayed-pull`,
        ok: true,
        latestTerm: 1,
        latestSeq: 2,
        latestRowVersion: 2,
        requiresFullReload: false,
        changedKeys: [`stale`],
        deletedKeys: [],
        deltas: [
          {
            txId: `old-delayed-delta`,
            latestRowVersion: 2,
            changedRows: [
              {
                key: `stale`,
                value: { id: `stale`, title: `must stay with old owner` },
              },
            ],
            deletedKeys: [],
            rowMetadataMutations: [],
            collectionMetadataMutations: [],
          },
        ],
      }
    }
    const replacementControlsReady = createEventGate()
    let sourceRuns = 0
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            sourceRuns++
            if (sourceRuns === 2) replacementControlsReady.resolve()
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let replacementReady:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `delayed pull initial owner ready`,
      )
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 2,
        txId: `gap-trigger`,
        latestRowVersion: 2,
        requiresFullReload: false,
        changedRows: [],
        deletedKeys: [],
      })
      await atPersistedOracleCheckpoint(
        pullEntered.promise,
        `old pullSince entered`,
      )

      await collection.cleanup()
      cleanedUp = true
      collection.startSyncImmediate()
      cleanedUp = false
      replacementReady = collection.stateWhenReady().then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      await atPersistedOracleCheckpoint(
        replacementControlsReady.promise,
        `delayed pull replacement controls installed`,
      )
      releasePull.resolve()
      await atPersistedOracleCheckpoint(
        replacementHydrationEntered.promise,
        `replacement hydration entered after delayed pull replay`,
      )

      expect({
        sourceRuns,
        subsetCalls,
        staleVisible: collection.get(`stale`),
        staleDurable: adapter.rows.get(`stale`),
        replacementPublicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        sourceRuns: 2,
        subsetCalls: 2,
        staleVisible: undefined,
        staleDurable: undefined,
        replacementPublicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releasePull.resolve()
      releaseReplacementHydration.resolve()
      await cleanupPersistedOracle(
        [
          () => replacementReady,
          () => (cleanedUp ? undefined : collection.cleanup()),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not apply a later seq-gap replay delta through replacement controls`, async () => {
    const id = `two-delta-replay-lifecycle`
    const firstReceiptEntered = createEventGate()
    const releaseFirstReceipt = createEventGate()
    const replacementControlsInstalled = createEventGate()
    const replacementHydrationEntered = createEventGate()
    const releaseReplacementHydration = createEventGate()
    let subsetCalls = 0
    const adapter = createRecordingAdapter()
    adapter.loadSubset = async () => {
      subsetCalls++
      if (subsetCalls === 2) {
        replacementHydrationEntered.resolve()
        await releaseReplacementHydration.promise
        return [
          {
            key: `replacement`,
            value: { id: `replacement`, title: `B baseline` },
          },
        ]
      }
      return []
    }
    const coordinator = createFailStopCoordinatorHarness(id)
    const pullArguments: Array<{
      collectionId: string
      fromRowVersion: number
    }> = []
    coordinator.pullSince = async (collectionId, fromRowVersion) => {
      pullArguments.push({ collectionId, fromRowVersion })
      return {
        type: `rpc:pullSince:res`,
        rpcId: `two-delta-replay`,
        ok: true,
        latestTerm: 1,
        latestSeq: 3,
        latestRowVersion: 3,
        requiresFullReload: false,
        changedKeys: [`first`, `second`],
        deletedKeys: [],
        deltas: [
          {
            txId: `A-delta-1`,
            latestRowVersion: 1,
            changedRows: [
              {
                key: `first`,
                value: { id: `first`, title: `A first delta` },
              },
            ],
            deletedKeys: [],
            rowMetadataMutations: [
              { type: `set`, key: `first`, value: { owner: `A-first` } },
            ],
            collectionMetadataMutations: [
              { type: `set`, key: `replay:first`, value: `A-first` },
            ],
          },
          {
            txId: `A-delta-2`,
            latestRowVersion: 2,
            changedRows: [
              {
                key: `second`,
                value: { id: `second`, title: `A second delta` },
              },
            ],
            deletedKeys: [],
            rowMetadataMutations: [
              { type: `set`, key: `second`, value: { owner: `A-second` } },
            ],
            collectionMetadataMutations: [
              { type: `set`, key: `replay:second`, value: `A-second` },
            ],
          },
        ],
      }
    }

    let gateNextApplicationReceipt = false
    let controlsRun = 0
    const applicationReceipts: Array<{
      controlsOwner: `A` | `B`
      returnedReceipt: `actual` | `held`
      rowMetadataKeys: Array<string>
      collectionMetadataKeys: Array<string>
    }> = []
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
        sync: (params) => {
          controlsRun++
          const controlsOwner =
            controlsRun === 1 ? (`A` as const) : (`B` as const)
          if (controlsOwner === `B`) replacementControlsInstalled.resolve()
          let rowMetadataKeys: Array<string> = []
          let collectionMetadataKeys: Array<string> = []
          return baseSync({
            ...params,
            begin: (options) => {
              rowMetadataKeys = []
              collectionMetadataKeys = []
              return params.begin(options)
            },
            metadata: {
              row: {
                ...params.metadata!.row,
                set: (key, value) => {
                  rowMetadataKeys.push(String(key))
                  params.metadata!.row.set(key, value)
                },
                delete: (key) => {
                  rowMetadataKeys.push(String(key))
                  params.metadata!.row.delete(key)
                },
              },
              collection: {
                ...params.metadata!.collection,
                set: (key, value) => {
                  collectionMetadataKeys.push(key)
                  params.metadata!.collection.set(key, value)
                },
                delete: (key) => {
                  collectionMetadataKeys.push(key)
                  params.metadata!.collection.delete(key)
                },
              },
            },
            commit: (signal) => {
              const actualReceipt = params.commit(signal)
              if (
                !gateNextApplicationReceipt &&
                applicationReceipts.length === 0
              ) {
                return actualReceipt
              }
              const trace = {
                controlsOwner,
                returnedReceipt: `actual` as `actual` | `held`,
                rowMetadataKeys: [...rowMetadataKeys],
                collectionMetadataKeys: [...collectionMetadataKeys],
              }
              applicationReceipts.push(trace)
              if (gateNextApplicationReceipt) {
                gateNextApplicationReceipt = false
                trace.returnedReceipt = `held`
                firstReceiptEntered.resolve()
                void Promise.resolve(actualReceipt).catch(() => undefined)
                return releaseFirstReceipt.promise
              }
              return actualReceipt
            },
          })
        },
      },
    })
    let replacementReady: Promise<unknown> | undefined
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `two-delta A lifecycle ready`,
      )
      applicationReceipts.length = 0
      gateNextApplicationReceipt = true
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 3,
        txId: `gap-trigger`,
        latestRowVersion: 3,
        requiresFullReload: false,
        changedRows: [],
        deletedKeys: [],
      })
      await atPersistedOracleCheckpoint(
        firstReceiptEntered.promise,
        `two-delta first A receipt held`,
      )
      expect(collection.get(`first`)?.title).toBe(`A first delta`)

      await collection.cleanup()
      cleanedUp = true
      collection.startSyncImmediate()
      cleanedUp = false
      replacementReady = collection.stateWhenReady()
      await atPersistedOracleCheckpoint(
        replacementControlsInstalled.promise,
        `two-delta B controls installed`,
      )

      releaseFirstReceipt.resolve()
      await atPersistedOracleCheckpoint(
        replacementHydrationEntered.promise,
        `two-delta B hydration held`,
      )
      await Promise.resolve()

      const secondReceipts = applicationReceipts.filter(
        (receipt) =>
          receipt.rowMetadataKeys.includes(`second`) ||
          receipt.collectionMetadataKeys.includes(`replay:second`),
      )
      expect({
        controlsRun,
        pullArguments,
        secondReceipts,
        secondRowMetadata: collection._state.syncedMetadata.get(`second`),
        secondCollectionMetadata:
          collection._state.syncedCollectionMetadata.get(`replay:second`),
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        controlsRun: 2,
        pullArguments: [{ collectionId: id, fromRowVersion: 0 }],
        secondReceipts: [],
        secondRowMetadata: undefined,
        secondCollectionMetadata: undefined,
        publicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseFirstReceipt.resolve()
      releaseReplacementHydration.resolve()
      await cleanupPersistedOracle(
        [
          () => replacementReady,
          () => (cleanedUp ? undefined : collection.cleanup()),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not confirm a delayed local coordinator response through a restarted owner`, async () => {
    const id = `delayed-local-confirmation-lifecycle`
    const adapter = createRecordingAdapter()
    const replacementHydrationEntered = createEventGate()
    const releaseReplacementHydration = createEventGate()
    let subsetCalls = 0
    adapter.loadSubset = async () => {
      subsetCalls++
      if (subsetCalls === 2) {
        replacementHydrationEntered.resolve()
        await releaseReplacementHydration.promise
        return [
          {
            key: `replacement`,
            value: { id: `replacement`, title: `new owner baseline` },
          },
        ]
      }
      return []
    }
    const coordinator = createFailStopCoordinatorHarness(id)
    const requestEntered = createEventGate()
    const releaseRequest = createEventGate()
    coordinator.requestApplyLocalMutations = async (
      _collectionId,
      mutations,
    ) => {
      requestEntered.resolve()
      await releaseRequest.promise
      return {
        type: `rpc:applyLocalMutations:res`,
        rpcId: `old-delayed-local`,
        ok: true,
        term: 1,
        seq: 1,
        latestRowVersion: 1,
        acceptedMutationIds: mutations.map((mutation) => mutation.mutationId),
      }
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
        getKey: (row) => row.id,
        persistence: { adapter, coordinator },
      }),
    )
    const oldRow = { id: `old-local`, title: `must stay with old owner` }
    let localTransaction: ReturnType<typeof collection.insert> | undefined
    let replacementReady:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `delayed local initial owner ready`,
      )
      localTransaction = collection.insert(oldRow)
      await atPersistedOracleCheckpoint(
        requestEntered.promise,
        `old local coordinator request entered`,
      )

      await collection.cleanup()
      cleanedUp = true
      collection.startSyncImmediate()
      cleanedUp = false
      replacementReady = collection.stateWhenReady().then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      releaseRequest.resolve()
      await atPersistedOracleCheckpoint(
        replacementHydrationEntered.promise,
        `replacement hydration entered after delayed local confirmation`,
      )

      expect({
        subsetCalls,
        staleVisible: collection.get(oldRow.id),
        staleDurable: adapter.rows.get(oldRow.id),
        replacementPublicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        subsetCalls: 2,
        staleVisible: undefined,
        staleDurable: undefined,
        replacementPublicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseRequest.resolve()
      releaseReplacementHydration.resolve()
      await cleanupPersistedOracle(
        [
          () => localTransaction?.isPersisted.promise.catch(() => undefined),
          () => replacementReady,
          () => (cleanedUp ? undefined : collection.cleanup()),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not admit an old pending user hook through a restarted coordinator`, async () => {
    const id = `pending-user-hook-lifecycle`
    const adapter = createRecordingAdapter()
    const coordinator = createFailStopCoordinatorHarness(id)
    const hookEntered = createEventGate()
    const releaseHook = createEventGate()
    let coordinatorRequests = 0
    coordinator.requestApplyLocalMutations = async (
      _collectionId,
      mutations,
    ) => {
      coordinatorRequests++
      return {
        type: `rpc:applyLocalMutations:res`,
        rpcId: `stale-user-hook-request`,
        ok: true,
        term: 1,
        seq: 1,
        latestRowVersion: 1,
        acceptedMutationIds: mutations.map((mutation) => mutation.mutationId),
      }
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
        getKey: (row) => row.id,
        onInsert: async () => {
          hookEntered.resolve()
          await releaseHook.promise
          return {}
        },
        persistence: { adapter, coordinator },
      }),
    )
    let transaction: ReturnType<typeof collection.insert> | undefined
    let transactionOutcome:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let replacementReady:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `pending user hook initial owner ready`,
      )
      transaction = collection.insert({
        id: `old-hook`,
        title: `must not enter replacement coordinator`,
      })
      transactionOutcome = transaction.isPersisted.promise.then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      await atPersistedOracleCheckpoint(
        hookEntered.promise,
        `old user hook entered before coordinator admission`,
      )
      expect(coordinatorRequests).toBe(0)

      await collection.cleanup()
      cleanedUp = true
      collection.startSyncImmediate()
      cleanedUp = false
      replacementReady = collection.stateWhenReady().then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      const replacementOutcome = await atPersistedOracleCheckpoint(
        replacementReady,
        `pending user hook replacement owner ready`,
      )
      releaseHook.resolve()
      const outcome = await atPersistedOracleCheckpoint(
        transactionOutcome,
        `pending user hook transaction settled`,
      )

      expect({
        replacementStatus: replacementOutcome.status,
        transactionStatus: outcome.status,
        coordinatorRequests,
        durableOldRow: adapter.rows.get(`old-hook`),
      }).toEqual({
        replacementStatus: `fulfilled`,
        transactionStatus: `rejected`,
        coordinatorRequests: 0,
        durableOldRow: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseHook.resolve()
      await cleanupPersistedOracle(
        [
          () => transactionOutcome,
          () => replacementReady,
          () => (cleanedUp ? undefined : collection.cleanup()),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not let old loopback readiness complete a restarted hydration`, async () => {
    const adapter = createRecordingAdapter()
    const oldHydrationEntered = createEventGate()
    const releaseOldHydration = createEventGate()
    const replacementHydrationEntered = createEventGate()
    const releaseReplacementHydration = createEventGate()
    let subsetCalls = 0
    adapter.loadSubset = async () => {
      subsetCalls++
      if (subsetCalls === 1) {
        oldHydrationEntered.resolve()
        await releaseOldHydration.promise
        return []
      }
      replacementHydrationEntered.resolve()
      await releaseReplacementHydration.promise
      return [
        {
          key: `replacement`,
          value: { id: `replacement`, title: `new owner baseline` },
        },
      ]
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `loopback-late-readiness-lifecycle`,
        getKey: (row) => row.id,
        persistence: { adapter },
      }),
    )
    const oldReady = collection.stateWhenReady().then(
      () => ({ status: `fulfilled` as const }),
      (reason: unknown) => ({ status: `rejected` as const, reason }),
    )
    let replacementReady:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        oldHydrationEntered.promise,
        `old loopback hydration entered`,
      )
      await collection.cleanup()
      cleanedUp = true
      collection.startSyncImmediate()
      cleanedUp = false
      replacementReady = collection.stateWhenReady().then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )

      releaseOldHydration.resolve()
      await atPersistedOracleCheckpoint(
        replacementHydrationEntered.promise,
        `replacement loopback hydration entered`,
      )
      await flushAsyncWork()

      expect({
        subsetCalls,
        replacementIsReady: collection.isReady(),
        replacementVisible: collection.get(`replacement`),
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        subsetCalls: 2,
        replacementIsReady: false,
        replacementVisible: undefined,
        publicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseOldHydration.resolve()
      releaseReplacementHydration.resolve()
      await cleanupPersistedOracle(
        [
          () => oldReady,
          () => replacementReady,
          () => (cleanedUp ? undefined : collection.cleanup()),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`marks a targeted invalidation commit-receipt rejection terminal`, async () => {
    const id = `targeted-invalidation-receipt`
    const adapter = createRecordingAdapter()
    const coordinator = createFailStopCoordinatorHarness(id)
    const receiptEntered = createEventGate()
    const rejectedReceipt = createEventGate()
    const receiptError = new Error(
      `targeted invalidation receipt failed exactly`,
    )
    let rejectNextCommit = false
    const baseOptions = persistedCollectionOptions<Todo, string>({
      id,
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
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
              if (!rejectNextCommit) return actualReceipt
              rejectNextCommit = false
              receiptEntered.resolve()
              void Promise.resolve(actualReceipt).catch(() => undefined)
              return rejectedReceipt.promise
            },
          }),
      },
    })
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `targeted receipt collection ready`,
      )
      rejectNextCommit = true
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `targeted-receipt-failure`,
        latestRowVersion: 1,
        requiresFullReload: false,
        changedRows: [
          {
            key: `targeted`,
            value: { id: `targeted`, title: `publication attempted` },
          },
        ],
        deletedKeys: [],
      })
      await atPersistedOracleCheckpoint(
        receiptEntered.promise,
        `targeted invalidation receipt entered`,
      )
      rejectedReceipt.reject(receiptError)
      await flushAsyncWork()
      await flushAsyncWork()

      expect({
        status: collection.status,
        exactPublicError: collection._lifecycle.getSyncError() === receiptError,
      }).toEqual({
        status: `error`,
        exactPublicError: true,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      rejectedReceipt.reject(receiptError)
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`waits for a reset truncate receipt before reloading`, async () => {
    const id = `reset-truncate-receipt`
    const seed = { id: `seed`, title: `must survive a failed reset` }
    const adapter = createRecordingAdapter([seed])
    const coordinator = createFailStopCoordinatorHarness(id)
    const receiptEntered = createEventGate()
    const rejectedReceipt = createEventGate()
    const receiptError = new Error(`reset truncate receipt failed exactly`)
    let rejectNextCommit = false
    const baseOptions = persistedCollectionOptions<Todo, string>({
      id,
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
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
              if (!rejectNextCommit) return actualReceipt
              rejectNextCommit = false
              receiptEntered.resolve()
              void Promise.resolve(actualReceipt).catch(() => undefined)
              return rejectedReceipt.promise
            },
          }),
      },
    })
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `reset receipt collection ready`,
      )
      const baselineLoadCount = adapter.loadSubsetCalls.length
      rejectNextCommit = true
      coordinator.emit({
        type: `collection:reset`,
        schemaVersion: 1,
        resetEpoch: 1,
      })
      await atPersistedOracleCheckpoint(
        receiptEntered.promise,
        `reset truncate receipt entered`,
      )
      await flushAsyncWork()
      await flushAsyncWork()

      expect(adapter.loadSubsetCalls.length).toBe(baselineLoadCount)

      rejectedReceipt.reject(receiptError)
      await flushAsyncWork()
      await flushAsyncWork()

      expect({
        status: collection.status,
        exactPublicError: collection._lifecycle.getSyncError() === receiptError,
      }).toEqual({
        status: `error`,
        exactPublicError: true,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      rejectedReceipt.reject(receiptError)
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`keeps local persistence pending through confirmation receipt settlement`, async () => {
    const id = `local-confirmation-receipt`
    const adapter = createRecordingAdapter()
    const coordinator = createFailStopCoordinatorHarness(id)
    const receiptEntered = createEventGate()
    const rejectedReceipt = createEventGate()
    const receiptError = new Error(`local confirmation receipt failed exactly`)
    let rejectNextCommit = false
    coordinator.requestApplyLocalMutations = async (
      _collectionId,
      mutations,
    ) => {
      rejectNextCommit = true
      return {
        type: `rpc:applyLocalMutations:res`,
        rpcId: `local-confirmation`,
        ok: true,
        term: 1,
        seq: 1,
        latestRowVersion: 1,
        acceptedMutationIds: mutations.map((mutation) => mutation.mutationId),
      }
    }
    const baseOptions = persistedCollectionOptions<Todo, string>({
      id,
      getKey: (row) => row.id,
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
              if (!rejectNextCommit) return actualReceipt
              rejectNextCommit = false
              receiptEntered.resolve()
              void Promise.resolve(actualReceipt).catch(() => undefined)
              return rejectedReceipt.promise
            },
          }),
      },
    })
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `local confirmation receipt collection ready`,
      )
      const transaction = collection.insert({
        id: `local`,
        title: `durable before confirmation settles`,
      })
      const transactionOutcome = transaction.isPersisted.promise.then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      await atPersistedOracleCheckpoint(
        receiptEntered.promise,
        `local confirmation receipt entered`,
      )
      const pending = observeSettlement(
        transactionOutcome.then(() => undefined),
      )
      await Promise.resolve()
      expect(pending.read()).toEqual({ status: `pending` })

      rejectedReceipt.reject(receiptError)
      const outcome = await atPersistedOracleCheckpoint(
        transactionOutcome,
        `local confirmation transaction settled`,
      )
      await flushAsyncWork()

      expect({
        transactionStatus: outcome.status,
        transactionExact:
          outcome.status === `rejected` && outcome.reason === receiptError,
        status: collection.status,
        exactPublicError: collection._lifecycle.getSyncError() === receiptError,
      }).toEqual({
        transactionStatus: `rejected`,
        transactionExact: true,
        status: `error`,
        exactPublicError: true,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      rejectedReceipt.reject(receiptError)
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not continue an old hydration into a replacement after its applied receipt settles`, async () => {
    const id = `hydration-applied-receipt-lifecycle`
    const adapter = createRecordingAdapter()
    const receiptEntered = createEventGate()
    const releaseReceipt = createEventGate()
    let gateNextCommit = false
    let subsetCalls = 0
    adapter.loadSubset = async () => {
      subsetCalls++
      if (subsetCalls === 1) {
        gateNextCommit = true
        return [
          {
            key: `old`,
            value: { id: `old`, title: `old owner hydration` },
          },
        ]
      }
      return [
        {
          key: `replacement`,
          value: { id: `replacement`, title: `new owner hydration` },
        },
      ]
    }
    const baseOptions = persistedCollectionOptions<Todo, string>({
      id,
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
      persistence: { adapter },
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
              if (!gateNextCommit) return actualReceipt
              gateNextCommit = false
              receiptEntered.resolve()
              void Promise.resolve(actualReceipt).catch(() => undefined)
              return releaseReceipt.promise
            },
          }),
      },
    })
    const oldReady = collection.stateWhenReady().then(
      () => ({ status: `fulfilled` as const }),
      (reason: unknown) => ({ status: `rejected` as const, reason }),
    )
    let replacementReady:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        receiptEntered.promise,
        `old hydration applied receipt entered`,
      )
      expect(stripVirtualProps(collection.get(`old`))).toEqual({
        id: `old`,
        title: `old owner hydration`,
      })

      await collection.cleanup()
      cleanedUp = true
      collection.startSyncImmediate()
      cleanedUp = false
      replacementReady = collection.stateWhenReady().then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      releaseReceipt.resolve()
      const replacementOutcome = await atPersistedOracleCheckpoint(
        replacementReady,
        `replacement hydration after old applied receipt`,
      )

      expect({
        replacementStatus: replacementOutcome.status,
        subsetCalls,
        oldVisible: collection.get(`old`),
        replacementVisible: stripVirtualProps(collection.get(`replacement`)),
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        replacementStatus: `fulfilled`,
        subsetCalls: 2,
        oldVisible: undefined,
        replacementVisible: {
          id: `replacement`,
          title: `new owner hydration`,
        },
        status: `ready`,
        publicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseReceipt.resolve()
      await cleanupPersistedOracle(
        [
          () => oldReady,
          () => replacementReady,
          () => (cleanedUp ? undefined : collection.cleanup()),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not let an old post-receipt continuation flush replacement coordinator work`, async () => {
    const id = `post-receipt-queue-lifecycle`
    const adapter = createRecordingAdapter()
    const coordinator = createFailStopCoordinatorHarness(id)
    const receiptEntered = createEventGate()
    const releaseReceipt = createEventGate()
    const replacementSourceStarted = createEventGate()
    const replacementHydrationEntered = createEventGate()
    const releaseReplacementHydration = createEventGate()
    let gateNextCommit = false
    let subsetCalls = 0
    let sourceRuns = 0
    adapter.loadSubset = async () => {
      subsetCalls++
      if (subsetCalls === 1) {
        gateNextCommit = true
        return [
          {
            key: `old`,
            value: { id: `old`, title: `old owner hydration` },
          },
        ]
      }
      replacementHydrationEntered.resolve()
      await releaseReplacementHydration.promise
      return [
        {
          key: `replacement`,
          value: { id: `replacement`, title: `new owner hydration` },
        },
      ]
    }
    const baseOptions = persistedCollectionOptions<Todo, string>({
      id,
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          sourceRuns++
          if (sourceRuns === 2) replacementSourceStarted.resolve()
          markReady()
        },
      },
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
              if (!gateNextCommit) return actualReceipt
              gateNextCommit = false
              receiptEntered.resolve()
              void Promise.resolve(actualReceipt).catch(() => undefined)
              return releaseReceipt.promise
            },
          }),
      },
    })
    const oldReady = collection.stateWhenReady().then(
      () => ({ status: `fulfilled` as const }),
      (reason: unknown) => ({ status: `rejected` as const, reason }),
    )
    let replacementReady:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        receiptEntered.promise,
        `old post-receipt hydration entered`,
      )
      await collection.cleanup()
      cleanedUp = true
      collection.startSyncImmediate()
      cleanedUp = false
      replacementReady = collection.stateWhenReady().then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      await atPersistedOracleCheckpoint(
        replacementSourceStarted.promise,
        `replacement source subscribed behind old receipt`,
      )
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `replacement-queued-work`,
        latestRowVersion: 1,
        requiresFullReload: false,
        changedRows: [
          {
            key: `queued`,
            value: { id: `queued`, title: `belongs after replacement hydrate` },
          },
        ],
        deletedKeys: [],
      })

      releaseReceipt.resolve()
      await atPersistedOracleCheckpoint(
        replacementHydrationEntered.promise,
        `replacement hydration entered after old receipt`,
      )
      await flushAsyncWork()

      expect({
        sourceRuns,
        subsetCalls,
        queuedVisible: collection.get(`queued`),
      }).toEqual({
        sourceRuns: 2,
        subsetCalls: 2,
        queuedVisible: undefined,
      })

      releaseReplacementHydration.resolve()
      const replacementOutcome = await atPersistedOracleCheckpoint(
        replacementReady,
        `replacement hydration settled before coordinator work`,
      )
      await flushAsyncWork()
      await flushAsyncWork()

      expect({
        replacementStatus: replacementOutcome.status,
        oldVisible: collection.get(`old`),
        replacementVisible: stripVirtualProps(collection.get(`replacement`)),
        queuedVisible: stripVirtualProps(collection.get(`queued`)),
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        replacementStatus: `fulfilled`,
        oldVisible: undefined,
        replacementVisible: {
          id: `replacement`,
          title: `new owner hydration`,
        },
        queuedVisible: {
          id: `queued`,
          title: `belongs after replacement hydrate`,
        },
        publicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseReceipt.resolve()
      releaseReplacementHydration.resolve()
      await cleanupPersistedOracle(
        [
          () => oldReady,
          () => replacementReady,
          () => (cleanedUp ? undefined : collection.cleanup()),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`rejects new source transactions after a terminal persistence failure`, async () => {
    const adapter = createRecordingAdapter()
    const adapterError = Object.assign(
      new Error(`terminal adapter write failed exactly`),
      {
        code: `SQLITE_FULL`,
        path: `adapter.applyCommittedTx`,
      },
    )
    const successfulApply = adapter.applyCommittedTx.bind(adapter)
    let applyCalls = 0
    adapter.applyCommittedTx = async (collectionId, tx) => {
      applyCalls++
      if (applyCalls === 1) throw adapterError
      await successfulApply(collectionId, tx)
    }
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-terminal-persistence-admission`,
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
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `terminal persistence admission collection ready`,
      )
      remoteBegin!()
      remoteWrite!({
        type: `insert`,
        value: { id: `first`, title: `published before persistence` },
      })
      const firstOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve(remoteCommit!()).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `first terminal persistence receipt`,
      )
      const terminalError =
        firstOutcome.status === `rejected` ? firstOutcome.reason : undefined

      expect({
        receiptStatus: firstOutcome.status,
        errorName:
          terminalError instanceof Error ? terminalError.name : undefined,
        cause: terminalError instanceof Error ? terminalError.cause : undefined,
        publicErrorIsReceipt:
          collection._lifecycle.getSyncError() === terminalError,
        status: collection.status,
        firstVisible: stripVirtualProps(collection.get(`first`)),
        firstDurable: adapter.rows.get(`first`),
        applyCalls,
      }).toEqual({
        receiptStatus: `rejected`,
        errorName: `PersistenceDurabilityError`,
        cause: adapterError,
        publicErrorIsReceipt: true,
        status: `error`,
        firstVisible: {
          id: `first`,
          title: `published before persistence`,
        },
        firstDurable: undefined,
        applyCalls: 1,
      })

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
        `late terminal persistence receipt`,
      )

      expect({
        receiptStatus: lateOutcome.status,
        exactReceipt:
          lateOutcome.status === `rejected` &&
          lateOutcome.reason === terminalError,
        publicErrorIsTerminal:
          collection._lifecycle.getSyncError() === terminalError,
        status: collection.status,
        lateVisible: collection.get(`late`),
        lateDurable: adapter.rows.get(`late`),
        applyCalls,
      }).toEqual({
        receiptStatus: `rejected`,
        exactReceipt: true,
        publicErrorIsTerminal: true,
        status: `error`,
        lateVisible: undefined,
        lateDurable: undefined,
        applyCalls: 1,
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

  it.each([`hydration`, `durability`] as const)(
    `fences metadata and truncate transactions after a terminal %s failure`,
    async (failureKind) => {
      const harness = await createTerminalFailureHarness(
        failureKind,
        `terminal-transaction-surface-${failureKind}`,
      )
      const {
        adapter,
        collection,
        coordinator,
        seed,
        sourceParams,
        terminalError,
      } = harness
      const applyCallsBefore = adapter.applyCommittedTxCalls.length
      const publishCallsBefore = coordinator.publishCalls.length
      const operations: Array<{ name: string; apply: () => void }> = [
        {
          name: `row metadata set`,
          apply: () =>
            sourceParams.metadata!.row.set(seed.id, `must-not-replace-row`),
        },
        {
          name: `row metadata delete`,
          apply: () => sourceParams.metadata!.row.delete(seed.id),
        },
        {
          name: `collection metadata set`,
          apply: () =>
            sourceParams.metadata!.collection.set(
              `resume`,
              `must-not-replace-collection`,
            ),
        },
        {
          name: `collection metadata delete`,
          apply: () => sourceParams.metadata!.collection.delete(`resume`),
        },
        {
          name: `truncate`,
          apply: () => sourceParams.truncate(),
        },
      ]
      let hasPrimaryFailure = false

      try {
        for (const operation of operations) {
          sourceParams.begin()
          const operationOutcome = await Promise.resolve()
            .then(operation.apply)
            .then(
              () => ({ status: `fulfilled` as const }),
              (reason: unknown) => ({ status: `rejected` as const, reason }),
            )
          const receiptOutcome = await atPersistedOracleCheckpoint(
            Promise.resolve(sourceParams.commit()).then(
              () => ({ status: `fulfilled` as const }),
              (reason: unknown) => ({ status: `rejected` as const, reason }),
            ),
            `${failureKind} ${operation.name} terminal receipt`,
          )

          expect({
            operation: operationOutcome.status,
            receipt: receiptOutcome.status,
            exactReceipt:
              receiptOutcome.status === `rejected` &&
              receiptOutcome.reason === terminalError,
            visibleSeed: stripVirtualProps(collection.get(seed.id)),
            durableSeed: adapter.rows.get(seed.id),
            rowMetadata: sourceParams.metadata!.row.get(seed.id),
            collectionMetadata: sourceParams.metadata!.collection.get(`resume`),
            applyCalls: adapter.applyCommittedTxCalls.length,
            publishCalls: coordinator.publishCalls.length,
            status: collection.status,
            exactPublicError:
              collection._lifecycle.getSyncError() === terminalError,
          }).toEqual({
            operation: `fulfilled`,
            receipt: `rejected`,
            exactReceipt: true,
            visibleSeed: seed,
            durableSeed: seed,
            rowMetadata: `row-metadata-before-failure`,
            collectionMetadata: `collection-metadata-before-failure`,
            applyCalls: applyCallsBefore,
            publishCalls: publishCallsBefore,
            status: `error`,
            exactPublicError: true,
          })
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
    },
  )

  it(`fences reload, upstream hydration, and late readiness after terminal persistence failure`, async () => {
    const harness = await createTerminalFailureHarness(
      `durability`,
      `terminal-persistence-reload-surfaces`,
    )
    const {
      adapter,
      collection,
      coordinator,
      sourceParams,
      terminalError,
      upstreamLoads,
    } = harness
    const late = { id: `late-reload`, title: `must not hydrate` }
    const loadCallsBefore = adapter.loadSubsetCalls.length
    const upstreamCallsBefore = upstreamLoads.length
    const publishCallsBefore = coordinator.publishCalls.length
    adapter.loadSubset = (collectionId, options, context) => {
      adapter.loadSubsetCalls.push({
        collectionId,
        options,
        requiredIndexSignatures: context?.requiredIndexSignatures ?? [],
      })
      return Promise.resolve([{ key: late.id, value: late }])
    }
    let hasPrimaryFailure = false

    try {
      const loadOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve(collection._sync.loadSubset({ limit: 3 })).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `post-persistence terminal loadSubset`,
      )
      sourceParams.markReady()
      await flushAsyncWork()

      expect({
        loadStatus: loadOutcome.status,
        loadExact:
          loadOutcome.status === `rejected` &&
          loadOutcome.reason === terminalError,
        adapterLoads: adapter.loadSubsetCalls.length,
        upstreamLoads: upstreamLoads.length,
        publishCalls: coordinator.publishCalls.length,
        visibleLate: collection.get(late.id),
        durableLate: adapter.rows.get(late.id),
        status: collection.status,
        exactPublicError:
          collection._lifecycle.getSyncError() === terminalError,
      }).toEqual({
        loadStatus: `rejected`,
        loadExact: true,
        adapterLoads: loadCallsBefore,
        upstreamLoads: upstreamCallsBefore,
        publishCalls: publishCallsBefore,
        visibleLate: undefined,
        durableLate: undefined,
        status: `error`,
        exactPublicError: true,
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

  it(`rejects an already-admitted sibling when the preceding persistence fails`, async () => {
    const adapter = createRecordingAdapter()
    const firstPersistenceEntered = createEventGate()
    const firstPersistence = createEventGate()
    const adapterError = new Error(`first pending persistence failed exactly`)
    const successfulApply = adapter.applyCommittedTx.bind(adapter)
    let applyCalls = 0
    adapter.applyCommittedTx = async (...args) => {
      applyCalls++
      if (applyCalls === 1) {
        firstPersistenceEntered.resolve()
        await firstPersistence.promise
        return
      }
      await successfulApply(...args)
    }
    const coordinator = createFailStopCoordinatorHarness(
      `terminal-pending-sibling`,
    )
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `terminal-pending-sibling`,
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
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `pending sibling collection ready`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `a`, title: `first publishes before persistence` },
      })
      const firstReceipt = Promise.resolve(sourceParams.commit()).then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      await atPersistedOracleCheckpoint(
        firstPersistenceEntered.promise,
        `first persistence entered before sibling admission`,
      )

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `b`, title: `must not publish or persist` },
      })
      const secondReceipt = Promise.resolve(sourceParams.commit()).then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      const secondSettlement = observeSettlement(
        secondReceipt.then(
          () => undefined,
          () => undefined,
        ),
      )
      expect(secondSettlement.read()).toEqual({ status: `pending` })

      firstPersistence.reject(adapterError)
      const firstOutcome = await atPersistedOracleCheckpoint(
        firstReceipt,
        `first failed persistence receipt`,
      )
      const terminalError =
        firstOutcome.status === `rejected` ? firstOutcome.reason : undefined
      const secondOutcome = await atPersistedOracleCheckpoint(
        secondReceipt,
        `already-admitted sibling terminal receipt`,
      )

      expect({
        firstStatus: firstOutcome.status,
        terminalName:
          terminalError instanceof Error ? terminalError.name : undefined,
        terminalCause:
          terminalError instanceof Error ? terminalError.cause : undefined,
        secondStatus: secondOutcome.status,
        secondExact:
          secondOutcome.status === `rejected` &&
          secondOutcome.reason === terminalError,
        applyCalls,
        firstVisible: stripVirtualProps(collection.get(`a`)),
        firstDurable: adapter.rows.get(`a`),
        secondVisible: collection.get(`b`),
        secondDurable: adapter.rows.get(`b`),
        publishCalls: coordinator.publishCalls.length,
        status: collection.status,
        exactPublicError:
          collection._lifecycle.getSyncError() === terminalError,
      }).toEqual({
        firstStatus: `rejected`,
        terminalName: `PersistenceDurabilityError`,
        terminalCause: adapterError,
        secondStatus: `rejected`,
        secondExact: true,
        applyCalls: 1,
        firstVisible: { id: `a`, title: `first publishes before persistence` },
        firstDurable: undefined,
        secondVisible: undefined,
        secondDurable: undefined,
        publishCalls: 0,
        status: `error`,
        exactPublicError: true,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      firstPersistence.reject(adapterError)
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`marks direct adapter failure terminal and fences later local mutations`, async () => {
    const adapter = createRecordingAdapter()
    const adapterError = Object.assign(
      new Error(`local adapter failed exactly`),
      {
        code: `SQLITE_IOERR`,
        path: `adapter.applyCommittedTx`,
      },
    )
    const successfulApply = adapter.applyCommittedTx.bind(adapter)
    let applyCalls = 0
    adapter.applyCommittedTx = async (...args) => {
      applyCalls++
      if (applyCalls === 1) throw adapterError
      await successfulApply(...args)
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `terminal-loopback-local-durability`,
        getKey: (row) => row.id,
        persistence: { adapter },
      }),
    )
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `local durability collection ready`,
      )
      const firstTransaction = collection.insert({
        id: `first-local`,
        title: `must roll back`,
      })
      const firstOutcome = await atPersistedOracleCheckpoint(
        firstTransaction.isPersisted.promise.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `first local durability failure`,
      )
      const terminalError =
        firstOutcome.status === `rejected` ? firstOutcome.reason : undefined

      const loadCallsBefore = adapter.loadSubsetCalls.length
      adapter.loadSubset = (collectionId, options, context) => {
        adapter.loadSubsetCalls.push({
          collectionId,
          options,
          requiredIndexSignatures: context?.requiredIndexSignatures ?? [],
        })
        return Promise.resolve([
          {
            key: `forced-late`,
            value: { id: `forced-late`, title: `must not hydrate` },
          },
        ])
      }
      const forceOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve(collection.utils.forceReloadSubset!({ limit: 4 })).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `force reload after local durability failure`,
      )

      const lateOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve()
          .then(async () => {
            const lateTransaction = collection.insert({
              id: `late-local`,
              title: `must not be admitted`,
            })
            await lateTransaction.isPersisted.promise
          })
          .then(
            () => ({ status: `fulfilled` as const }),
            (reason: unknown) => ({ status: `rejected` as const, reason }),
          ),
        `late local terminal receipt`,
      )

      expect({
        firstStatus: firstOutcome.status,
        errorName:
          terminalError instanceof Error ? terminalError.name : undefined,
        errorCause:
          terminalError instanceof Error ? terminalError.cause : undefined,
        errorCode:
          terminalError instanceof Error
            ? (terminalError as Error & { code?: unknown }).code
            : undefined,
        forceStatus: forceOutcome.status,
        forceExact:
          forceOutcome.status === `rejected` &&
          forceOutcome.reason === terminalError,
        loadCalls: adapter.loadSubsetCalls.length,
        forceVisible: collection.get(`forced-late`),
        lateStatus: lateOutcome.status,
        lateErrorName:
          lateOutcome.status === `rejected` &&
          lateOutcome.reason instanceof Error
            ? lateOutcome.reason.name
            : undefined,
        status: collection.status,
        exactPublicError:
          collection._lifecycle.getSyncError() === terminalError,
        applyCalls,
        firstVisible: collection.get(`first-local`),
        firstDurable: adapter.rows.get(`first-local`),
        lateVisible: collection.get(`late-local`),
        lateDurable: adapter.rows.get(`late-local`),
      }).toEqual({
        firstStatus: `rejected`,
        errorName: `PersistenceDurabilityError`,
        errorCause: adapterError,
        errorCode: `SQLITE_IOERR`,
        forceStatus: `rejected`,
        forceExact: true,
        loadCalls: loadCallsBefore,
        forceVisible: undefined,
        lateStatus: `rejected`,
        lateErrorName: `CollectionStateError`,
        status: `error`,
        exactPublicError: true,
        applyCalls: 1,
        firstVisible: undefined,
        firstDurable: undefined,
        lateVisible: undefined,
        lateDurable: undefined,
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

  it(`fences direct acceptMutations and local mutations after hydration failure`, async () => {
    const adapter = createRecordingAdapter()
    const hydrationError = new Error(`loopback hydration failed exactly`)
    adapter.loadSubset = () => Promise.reject(hydrationError)
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `terminal-loopback-hydration`,
        getKey: (row) => row.id,
        persistence: { adapter },
      }),
    )
    let hasPrimaryFailure = false

    try {
      await expect(
        atPersistedOracleCheckpoint(
          collection.stateWhenReady(),
          `loopback hydration rejected`,
        ),
      ).rejects.toBe(hydrationError)
      expect(collection.status).toBe(`error`)
      expect(collection._lifecycle.getSyncError()).toBe(hydrationError)

      adapter.loadSubset = () => Promise.resolve([])
      const now = new Date()
      const directRow = { id: `direct`, title: `must not be accepted` }
      const directMutation: PendingMutation<Todo, `insert`> = {
        mutationId: `direct-after-hydration`,
        original: {},
        modified: directRow,
        changes: directRow,
        globalKey: `terminal-loopback-hydration:direct`,
        key: directRow.id,
        type: `insert`,
        metadata: undefined,
        syncMetadata: {},
        optimistic: true,
        createdAt: now,
        updatedAt: now,
        collection,
      }
      const directOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve(
          collection.utils.acceptMutations({
            mutations: [
              directMutation as unknown as PendingMutation<
                Record<string, unknown>
              >,
            ],
          }),
        ).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `direct acceptMutations after hydration failure`,
      )
      const localOutcome = await Promise.resolve()
        .then(() =>
          collection.insert({
            id: `late-local-hydration`,
            title: `must not be admitted`,
          }),
        )
        .then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        )

      expect({
        directStatus: directOutcome.status,
        directExact:
          directOutcome.status === `rejected` &&
          directOutcome.reason === hydrationError,
        localStatus: localOutcome.status,
        localErrorName:
          localOutcome.status === `rejected` &&
          localOutcome.reason instanceof Error
            ? localOutcome.reason.name
            : undefined,
        status: collection.status,
        exactPublicError:
          collection._lifecycle.getSyncError() === hydrationError,
        applyCalls: adapter.applyCommittedTxCalls.length,
        directVisible: collection.get(directRow.id),
        directDurable: adapter.rows.get(directRow.id),
        localVisible: collection.get(`late-local-hydration`),
        localDurable: adapter.rows.get(`late-local-hydration`),
      }).toEqual({
        directStatus: `rejected`,
        directExact: true,
        localStatus: `rejected`,
        localErrorName: `CollectionStateError`,
        status: `error`,
        exactPublicError: true,
        applyCalls: 0,
        directVisible: undefined,
        directDurable: undefined,
        localVisible: undefined,
        localDurable: undefined,
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

  it(`preserves row metadata set before a metadata-less insert in the same sync transaction`, async () => {
    const adapter = createRecordingAdapter()
    const ownership = { queryCollection: { owners: [`gc:q1`] } }
    const sync: SyncConfig<Todo, string> = {
      sync: ({ begin, write, commit, markReady, metadata }) => {
        begin()
        metadata?.row.set(`remote-1`, ownership)
        write({
          type: `insert`,
          value: {
            id: `remote-1`,
            title: `From remote`,
          },
        })
        commit()
        markReady()
      },
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item: Todo) => item.id,
        sync,
        persistence: {
          adapter,
        },
      }),
    )

    await collection.stateWhenReady()
    await flushAsyncWork()

    expect(adapter.rowMetadata.get(`remote-1`)).toEqual(ownership)
    expect(collection._state.syncedMetadata.get(`remote-1`)).toEqual(ownership)
  })

  it(`resets stale row metadata for a metadata-less insert with no queued metadata`, async () => {
    const adapter = createRecordingAdapter()
    adapter.rowMetadata.set(`remote-1`, { stale: true })
    const sync: SyncConfig<Todo, string> = {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({
          type: `insert`,
          value: {
            id: `remote-1`,
            title: `From remote`,
          },
        })
        commit()
        markReady()
      },
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item: Todo) => item.id,
        sync,
        persistence: {
          adapter,
        },
      }),
    )

    await collection.stateWhenReady()
    await flushAsyncWork()

    expect(adapter.rowMetadata.has(`remote-1`)).toBe(false)
  })

  it(`uses a stable generated collection id in sync-present mode when id is omitted`, async () => {
    const adapter = createRecordingAdapter()
    const options = persistedCollectionOptions<Todo, string>({
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
      persistence: {
        adapter,
      },
    })

    expect(options.id).toBeDefined()

    const collection = createCollection(options)
    await collection.preload()
    await flushAsyncWork()

    expect(collection.id).toBe(options.id)
    expect(adapter.loadSubsetCalls[0]?.collectionId).toBe(collection.id)
  })

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
    adapter.loadSubset = async () => {
      await new Promise<void>((resolve) => {
        resolveLoadSubset = resolve
      })
      return [
        {
          key: `cached-1`,
          value: {
            id: `cached-1`,
            title: `Cached row`,
          },
        },
      ]
    }

    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
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

  it(`preserves a source transaction committed before the next persisted hydration`, async () => {
    const hydrationEntered = createEventGate()
    const hydration = createEventGate()
    const adapter = createRecordingAdapter()
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
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

  it.each([`during`, `straddles`, `after`] as const)(
    `durably settles a source transaction that commits %s persisted hydration`,
    async (position) => {
      const hydrationEntered = createEventGate()
      const hydration = createEventGate()
      const adapter = createRecordingAdapter()
      adapter.loadSubset = async () => {
        hydrationEntered.resolve()
        await hydration.promise
        return []
      }

      const persistedTransactionOrder: Array<string> = []
      const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
      adapter.applyCommittedTx = async (...args) => {
        const title = args[1].mutations.find(
          (mutation) => mutation.type !== `delete`,
        )?.value as Todo | undefined
        if (title) persistedTransactionOrder.push(title.title)
        await applyCommittedTx(...args)
      }

      let remoteBegin: (() => void) | undefined
      let remoteWrite:
        | ((message: { type: `insert`; value: Todo }) => void)
        | undefined
      let remoteCommit: (() => true | Promise<void>) | undefined
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `hydration-boundary-${position}`,
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
      const ledger: Array<DurabilityLedgerEvent> = []
      const transactionId = position
      const row = { id: `shared`, title: position }
      let receipt: Promise<void> | undefined
      let hasPrimaryFailure = false

      const beginAndWrite = () => {
        ledger.push({ type: `begin`, transactionId })
        remoteBegin?.()
        ledger.push({ type: `write`, transactionId, row })
        remoteWrite?.({ type: `insert`, value: row })
      }
      const commit = () => {
        ledger.push({ type: `commit`, transactionId })
        const applied = remoteCommit?.()
        expect(applied).toBeInstanceOf(Promise)
        receipt = Promise.resolve(applied).then(() => undefined)
      }

      try {
        const ready = collection.stateWhenReady()
        await atPersistedOracleCheckpoint(
          hydrationEntered.promise,
          `${position} hydration entered`,
        )
        expect(remoteBegin).toBeTypeOf(`function`)
        expect(remoteCommit).toBeTypeOf(`function`)

        if (position === `during`) {
          beginAndWrite()
          commit()
          hydration.resolve()
          await atPersistedOracleCheckpoint(
            ready,
            `${position} hydration completed`,
          )
        } else {
          if (position === `straddles`) beginAndWrite()
          hydration.resolve()
          await atPersistedOracleCheckpoint(
            ready,
            `${position} hydration completed`,
          )
          if (position === `after`) beginAndWrite()
          commit()
        }

        const settlement = observeSettlement(receipt!)
        const checkpointId = `checkpoint-${position}`
        const checkpointRow = { id: checkpointId, title: checkpointId }
        ledger.push({ type: `begin`, transactionId: checkpointId })
        remoteBegin?.()
        ledger.push({
          type: `write`,
          transactionId: checkpointId,
          row: checkpointRow,
        })
        remoteWrite?.({ type: `insert`, value: checkpointRow })
        ledger.push({ type: `commit`, transactionId: checkpointId })
        const checkpointReceipt = remoteCommit?.()
        expect(checkpointReceipt).toBeInstanceOf(Promise)
        await atPersistedOracleCheckpoint(
          Promise.resolve(checkpointReceipt),
          `${position} later durable receipt`,
        )

        // A settled later durable receipt is the exact cut: FIFO forbids it
        // from overtaking an earlier commit opened in the old phase.
        expect(settlement.read()).toEqual({ status: `fulfilled` })
        const expected = foldDurabilityLedger(ledger)
        expect(persistedTransactionOrder).toEqual(expected.commitOrder)
        expect(stripVirtualProps(collection.get(`shared`))).toEqual(row)
        expect(adapter.rows.get(`shared`)).toEqual(row)
        expect(adapter.rows.get(checkpointId)).toEqual(checkpointRow)

        await collection.cleanup()
        adapter.loadSubset = () =>
          Promise.resolve(
            Array.from(adapter.rows, ([key, value]) => ({ key, value })),
          )
        const reopened = createCollection(
          persistedCollectionOptions<Todo, string>({
            id: `hydration-boundary-${position}`,
            getKey: (item) => item.id,
            sync: { sync: ({ markReady }) => markReady() },
            persistence: { adapter },
          }),
        )
        let hasReopenFailure = false
        try {
          await atPersistedOracleCheckpoint(
            reopened.stateWhenReady(),
            `${position} reopened hydration completed`,
          )
          expect(stripVirtualProps(reopened.get(`shared`))).toEqual(
            expected.committedRows.get(`shared`),
          )
        } catch (error) {
          hasReopenFailure = true
          throw error
        } finally {
          await cleanupPersistedOracle(
            [() => reopened.cleanup()],
            hasReopenFailure,
          )
        }
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
    },
  )

  it(`does not let a later same-key transaction overtake a hydration-straddling commit`, async () => {
    const hydrationEntered = createEventGate()
    const hydration = createEventGate()
    const adapter = createRecordingAdapter()
    adapter.loadSubset = async () => {
      hydrationEntered.resolve()
      await hydration.promise
      return []
    }
    const persistedTransactionOrder: Array<string> = []
    const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
    adapter.applyCommittedTx = async (...args) => {
      const row = args[1].mutations.find(
        (mutation) => mutation.type !== `delete`,
      )?.value as Todo | undefined
      if (row) persistedTransactionOrder.push(row.title)
      await applyCommittedTx(...args)
    }

    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `hydration-straddle-sibling-fifo`,
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
    const ledger: Array<DurabilityLedgerEvent> = []
    let firstReceipt: Promise<void> | undefined
    let secondReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    const sourceTransaction = (transactionId: string, title: string) => {
      const row = { id: `shared`, title }
      ledger.push({ type: `begin`, transactionId })
      remoteBegin?.()
      ledger.push({ type: `write`, transactionId, row })
      remoteWrite?.({ type: `insert`, value: row })
      ledger.push({ type: `commit`, transactionId })
      return Promise.resolve(remoteCommit?.()).then(() => undefined)
    }

    try {
      const ready = collection.stateWhenReady()
      await atPersistedOracleCheckpoint(
        hydrationEntered.promise,
        `FIFO hydration entered`,
      )

      const firstRow = { id: `shared`, title: `first` }
      ledger.push({ type: `begin`, transactionId: `first` })
      remoteBegin?.()
      ledger.push({ type: `write`, transactionId: `first`, row: firstRow })
      remoteWrite?.({ type: `insert`, value: firstRow })
      hydration.resolve()
      await atPersistedOracleCheckpoint(ready, `FIFO hydration completed`)
      ledger.push({ type: `commit`, transactionId: `first` })
      firstReceipt = Promise.resolve(remoteCommit?.()).then(() => undefined)
      const firstSettlement = observeSettlement(firstReceipt)

      secondReceipt = sourceTransaction(`second`, `second`)
      const secondSettlement = observeSettlement(secondReceipt)
      await atPersistedOracleCheckpoint(
        secondReceipt,
        `later same-key receipt settled`,
      )

      const expected = foldDurabilityLedger(ledger)
      expect(persistedTransactionOrder).toEqual(expected.commitOrder)
      expect(firstSettlement.read()).toEqual({ status: `fulfilled` })
      expect(secondSettlement.read()).toEqual({ status: `fulfilled` })
      expect(adapter.rows.get(`shared`)).toEqual(
        expected.committedRows.get(`shared`),
      )
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

  it(`settles an aborted hydration-straddling commit without applying it`, async () => {
    const hydrationEntered = createEventGate()
    const hydration = createEventGate()
    const adapter = createRecordingAdapter()
    adapter.loadSubset = async () => {
      hydrationEntered.resolve()
      await hydration.promise
      return []
    }
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit:
      | ((signal?: AbortSignal) => true | Promise<void>)
      | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `aborted-hydration-straddle`,
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
    const ledger: Array<DurabilityLedgerEvent> = []
    const controller = new AbortController()
    let receipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      const ready = collection.stateWhenReady()
      await atPersistedOracleCheckpoint(
        hydrationEntered.promise,
        `abort hydration entered`,
      )
      ledger.push({ type: `begin`, transactionId: `aborted` })
      remoteBegin?.()
      const row = { id: `aborted`, title: `must not apply` }
      ledger.push({ type: `write`, transactionId: `aborted`, row })
      remoteWrite?.({ type: `insert`, value: row })
      controller.abort()
      ledger.push({ type: `abort`, transactionId: `aborted` })
      hydration.resolve()
      await atPersistedOracleCheckpoint(ready, `abort hydration completed`)
      receipt = Promise.resolve(remoteCommit?.(controller.signal)).then(
        () => undefined,
      )
      await expect(
        atPersistedOracleCheckpoint(receipt, `aborted receipt settled`),
      ).rejects.toMatchObject({ name: `AbortError` })
      expect(foldDurabilityLedger(ledger).committedRows.size).toBe(0)
      expect(collection.get(`aborted`)).toBeUndefined()
      expect(adapter.rows.get(`aborted`)).toBeUndefined()
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

  it(`rejects every buffered receipt with the exact persisted hydration failure`, async () => {
    await runRejectedHydrationBufferWitness(`rejected-hydration-buffer-fixed`, [
      { id: `first`, title: `first buffered commit` },
      { id: `second`, title: `second buffered commit` },
    ])
  })

  it(`rejects a hydration-straddling transaction committed after hydration fails`, async () => {
    await runRejectedHydrationBufferWitness(
      `rejected-hydration-late-commit-fixed`,
      [{ id: `late`, title: `must not cross a failed baseline` }],
      { commitAfterHydrationFailure: true },
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
        { commitAfterHydrationFailure: true },
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
      )
    },
  )

  it(`append-only transaction judgment rejects omission and reordering`, () => {
    const events: Array<DurabilityLedgerEvent> = [
      { type: `begin`, transactionId: `first` },
      {
        type: `write`,
        transactionId: `first`,
        row: { id: `shared`, title: `first` },
      },
      { type: `commit`, transactionId: `first` },
      { type: `begin`, transactionId: `second` },
      {
        type: `write`,
        transactionId: `second`,
        row: { id: `shared`, title: `second` },
      },
      { type: `commit`, transactionId: `second` },
    ]
    const expected = foldDurabilityLedger(events)

    expect(expected.commitOrder).toEqual([`first`, `second`])
    expect(expected.commitOrder).not.toEqual([`second`])
    expect(expected.commitOrder).not.toEqual([`second`, `first`])
    expect(expected.committedRows.get(`shared`)).toEqual({
      id: `shared`,
      title: `second`,
    })
  })

  it(`discards a hydration-buffered transaction aborted before replay`, async () => {
    const adapter = createRecordingAdapter()
    let resolveLoadSubset: (() => void) | undefined
    adapter.loadSubset = async () => {
      await new Promise<void>((resolve) => {
        resolveLoadSubset = resolve
      })
      return []
    }
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit:
      | ((signal?: AbortSignal) => true | Promise<void>)
      | undefined
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
    adapter.loadSubset = async () => {
      hydrationEntered.resolve()
      await hydration.promise
      return []
    }
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
    const localPersistence = createEventGate()
    const localTransaction = createTransaction({
      mutationFn: () => localPersistence.promise,
    })
    const aborted = new AbortController()
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
      localTransaction.mutate(() => {
        collection.insert({ id: `local-gate`, title: `local pending` })
      })
      expect(localTransaction.state).toBe(`persisting`)

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
      await vi.waitFor(() =>
        expect(
          collection._state.pendingSyncedTransactions.some(
            (transaction) => transaction.committed,
          ),
        ).toBe(true),
      )
      aborted.abort()
      await expect(
        atPersistedOracleCheckpoint(
          abortedReceipt,
          `in-flight hydration sibling aborted`,
        ),
      ).rejects.toMatchObject({ name: `AbortError` })

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

      localPersistence.resolve()
      await atPersistedOracleCheckpoint(
        localTransaction.isPersisted.promise,
        `independent abort local gate settled`,
      )
      await atPersistedOracleCheckpoint(
        independentReceipt,
        `independent hydration sibling applied`,
      )
      await atPersistedOracleCheckpoint(ready, `independent abort ready`)
      expect({
        status: collection.status,
        independent: stripVirtualProps(collection.get(`independent`)),
        durable: adapter.rows.get(`independent`),
      }).toEqual({
        status: `ready`,
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
      localPersistence.resolve()
      await localTransaction.isPersisted.promise.catch(() => undefined)
      await cleanupPersistedOracle(
        [
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
    adapter.loadSubset = async () => {
      await new Promise<void>((resolve) => {
        resolveLoadSubset = resolve
      })
      return []
    }

    const replayError = new Error(`replay application failed`)
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
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

  it.each([`stream-position`, `collection-metadata`, `row-apply`] as const)(
    `fail-stops startup when the %s phase fails`,
    async (phase) => {
      const phaseError = new Error(`${phase} failed exactly`)
      const adapter = createRecordingAdapter(
        phase === `row-apply`
          ? [{ id: `row-apply-failure`, title: `must not apply` }]
          : [],
      )
      if (phase === `stream-position`) {
        adapter.getStreamPosition = () => Promise.reject(phaseError)
      } else if (phase === `collection-metadata`) {
        adapter.loadCollectionMetadata = () => Promise.reject(phaseError)
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
    adapter.loadSubset = async () => {
      hydrationEntered.resolve()
      await hydration.promise
      return []
    }
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
    adapter.loadSubset = async () => {
      hydrationEntered.resolve()
      await hydration.promise
      return []
    }
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
        value: { id: `remote-applied`, title: `applies after local rollback` },
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

  it.each([
    {
      label: `immediate source transaction`,
      options: { immediate: true },
      expectedVisibleBeforeLocalSettlement: true,
      expectedApplyCallsBeforeLocalSettlement: 2,
    },
    {
      label: `non-immediate control`,
      options: undefined,
      expectedVisibleBeforeLocalSettlement: false,
      expectedApplyCallsBeforeLocalSettlement: 1,
    },
  ] as const)(
    `preserves $label admission through the persisted wrapper`,
    async ({
      options,
      expectedVisibleBeforeLocalSettlement,
      expectedApplyCallsBeforeLocalSettlement,
    }) => {
      const adapter = createRecordingAdapter()
      let sourceParams!: TodoSyncParams
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `begin-options-${options?.immediate ? `immediate` : `normal`}`,
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
          `begin-options collection ready`,
        )
        sourceParams.begin()
        sourceParams.write({
          type: `insert`,
          value: { id: `seed`, title: `baseline` },
        })
        await atPersistedOracleCheckpoint(
          Promise.resolve(sourceParams.commit()),
          `begin-options seed persisted`,
        )

        localTransaction.mutate(() => {
          collection.update(`seed`, (draft) => {
            draft.title = `local pending`
          })
        })
        localCommit = localTransaction.commit()
        void localCommit.catch(() => undefined)
        expect(localTransaction.state).toBe(`persisting`)

        sourceParams.begin(options)
        sourceParams.write({
          type: `insert`,
          value: { id: `remote`, title: `source commit` },
        })
        remoteReceipt = sourceParams.commit()
        expect(remoteReceipt).toBeInstanceOf(Promise)

        expect({
          localState: localTransaction.state,
          remoteVisible: collection.has(`remote`),
          applyCalls: adapter.applyCommittedTxCalls.length,
        }).toEqual({
          localState: `persisting`,
          remoteVisible: expectedVisibleBeforeLocalSettlement,
          applyCalls: expectedApplyCallsBeforeLocalSettlement,
        })

        if (options?.immediate) {
          await atPersistedOracleCheckpoint(
            Promise.resolve(remoteReceipt),
            `immediate source receipt before local settlement`,
          )
          expect(localTransaction.state).toBe(`persisting`)
        } else {
          const settlement = observeSettlement(
            Promise.resolve(remoteReceipt).then(() => undefined),
          )
          await Promise.resolve()
          expect(settlement.read()).toEqual({ status: `pending` })
        }
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        localPersistence.resolve()
        await cleanupPersistedOracle(
          [
            () => localCommit,
            () =>
              remoteReceipt === true
                ? undefined
                : Promise.resolve(remoteReceipt),
            () => collection.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  it(`lets an immediate source dependency release a persisting user transaction`, async () => {
    const adapter = createRecordingAdapter()
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `immediate-source-dependency`,
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
        sourceParams.begin({ immediate: true })
        sourceParams.write({
          type: `insert`,
          value: { id: `dependency`, title: `releases user persistence` },
        })
        dependencyReceipt = sourceParams.commit()
        dependencySubmitted.resolve()
        await dependencyReceipt
      },
    })
    const normalAbort = new AbortController()
    let normalReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `immediate dependency collection ready`,
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
        `immediate dependency submitted`,
      )
      expect({
        localState: localTransaction.state,
        dependencyVisible: collection.has(`dependency`),
      }).toEqual({
        localState: `persisting`,
        dependencyVisible: true,
      })

      await atPersistedOracleCheckpoint(
        localTransaction.isPersisted.promise,
        `user persistence released by immediate dependency`,
      )
      await atPersistedOracleCheckpoint(
        normalReceipt,
        `parked predecessor applied with immediate dependency`,
      )
      if (dependencyReceipt !== true) {
        await atPersistedOracleCheckpoint(
          Promise.resolve(dependencyReceipt),
          `immediate dependency receipt settled`,
        )
      }
      expect(adapter.rows.get(`dependency`)).toEqual({
        id: `dependency`,
        title: `releases user persistence`,
      })
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

  it(`preserves source order when an immediate commit overtakes a held predecessor`, async () => {
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
        id: `immediate-source-order`,
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
        `immediate ordering collection ready`,
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
        `immediate ordering predecessor persistence entered`,
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

      sourceParams.begin({ immediate: true })
      sourceParams.write({
        type: `update`,
        value: { id: `shared`, title: `newer immediate` },
      })
      newerReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void newerReceipt.catch(() => undefined)

      expect(stripVirtualProps(collection.get(`shared`))).toEqual({
        id: `shared`,
        title: `newer immediate`,
      })

      releaseFirstPersistence.resolve()
      await atPersistedOracleCheckpoint(gateReceipt, `ordering gate persisted`)
      await atPersistedOracleCheckpoint(
        olderReceipt,
        `older normal source receipt`,
      )
      await atPersistedOracleCheckpoint(
        newerReceipt,
        `newer immediate source receipt`,
      )

      expect({
        status: collection.status,
        publicRow: stripVirtualProps(collection.get(`shared`)),
        durableRow: adapter.rows.get(`shared`),
        persistedTitles: persistedSharedTitles,
      }).toEqual({
        status: `ready`,
        publicRow: { id: `shared`, title: `newer immediate` },
        durableRow: { id: `shared`, title: `newer immediate` },
        persistedTitles: [`older normal`, `newer immediate`],
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

  it(`releases a reentrant internal reservation after a terminal failure`, async () => {
    const adapter = createRecordingAdapter([
      { id: `hydrated`, title: `starts reentrant reservation` },
    ])
    const hydrationEntered = createEventGate()
    const releaseHydration = createEventGate()
    adapter.loadSubset = async () => {
      hydrationEntered.resolve()
      await releaseHydration.promise
      return [
        {
          key: `hydrated`,
          value: { id: `hydrated`, title: `starts reentrant reservation` },
        },
      ]
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `terminal-internal-reservation`,
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
    const terminalError = new Error(`terminal reservation failure`)
    let externalReceipt: Promise<void> | undefined
    let internalReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      const ready = collection.stateWhenReady()
      await atPersistedOracleCheckpoint(
        hydrationEntered.promise,
        `reentrant reservation hydration entered`,
      )
      await vi.waitFor(() => expect(sourceParams).toBeDefined())
      releaseHydration.resolve()
      await atPersistedOracleCheckpoint(ready, `reentrant reservation ready`)
      expect({
        internalReservationStarted,
        pendingMarkers: collection._state.pendingSyncedTransactions.length,
      }).toEqual({
        internalReservationStarted: true,
        pendingMarkers: 1,
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
        name: `PersistenceDurabilityError`,
        cause: terminalError,
      })

      internalReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void internalReceipt.catch(() => undefined)
      await expect(
        atPersistedOracleCheckpoint(
          internalReceipt,
          `terminal internal reservation rejected`,
        ),
      ).rejects.toMatchObject({ name: `PersistenceDurabilityError` })
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

  fcTest.prop(
    [
      fc.uniqueArray(
        fc.constantFrom<`same-key` | `disjoint`>(`same-key`, `disjoint`),
        { minLength: 2, maxLength: 2 },
      ),
      fc.tuple(fc.string({ maxLength: 12 }), fc.string({ maxLength: 12 })),
    ],
    { numRuns: 4 },
  )(
    `generated immediate histories preserve source order and settle every receipt`,
    async (relations, titles) => {
      for (const relation of relations) {
        await runImmediateOrderingLaw(relation, titles[0], titles[1])
      }
    },
  )

  fcTest.prop(
    [
      fc.uniqueArray(
        fc.constantFrom<`independent` | `same-key`>(`independent`, `same-key`),
        { minLength: 2, maxLength: 2 },
      ),
      fc.tuple(fc.string({ maxLength: 12 }), fc.string({ maxLength: 12 })),
    ],
    { numRuns: 4 },
  )(
    `generated abort graphs preserve independent siblings and reject dependent suffixes`,
    async (relationships, titles) => {
      for (const relationship of relationships) {
        await runAbortRelationshipLaw(relationship, titles[0], titles[1])
      }
    },
  )

  fcTest.prop(
    [
      fc.uniqueArray(
        fc.constantFrom<`write` | `commit` | `truncate`>(
          `write`,
          `commit`,
          `truncate`,
        ),
        { minLength: 3, maxLength: 3 },
      ),
      fc.string({ maxLength: 12 }),
    ],
    { numRuns: 4 },
  )(
    `generated bare operations cannot capture another owner's reservation`,
    async (operations, queuedTitle) => {
      for (const operation of operations) {
        await runBareOwnerOperationLaw(operation, queuedTitle)
      }
    },
  )

  fcTest.prop(
    [
      fc.uniqueArray(
        fc.constantFrom<`abort` | `cleanup` | `terminal-failure`>(
          `abort`,
          `cleanup`,
          `terminal-failure`,
        ),
        { minLength: 3, maxLength: 3 },
      ),
      fc.string({ maxLength: 12 }),
    ],
    { numRuns: 4 },
  )(
    `generated reservation boundaries release every internally owned marker`,
    async (boundaries, hydratedTitle) => {
      for (const boundary of boundaries) {
        await runInternalReservationBoundaryLaw(boundary, hydratedTitle)
      }
    },
  )

  it(`marks the collection errored with the exact persisted startup hydration failure`, async () => {
    const adapter = createRecordingAdapter()
    const startupError = new Error(`startup hydration failed exactly`)
    adapter.loadSubset = async () => {
      throw startupError
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
      expect(collection.status).toBe(`error`)
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
    adapter.loadSubset = async () => {
      await new Promise<void>((resolve) => {
        resolveLoadSubset = resolve
      })
      return [
        {
          key: `cached-1`,
          value: {
            id: `cached-1`,
            title: `Cached row`,
          },
          metadata: adapter.rowMetadata.get(`cached-1`),
        },
      ]
    }

    let remoteBegin: (() => void) | undefined
    let remoteCommit: (() => void) | undefined
    let remoteTruncate: (() => void) | undefined
    let remoteMetadata:
      | Parameters<SyncConfig<Todo, string>[`sync`]>[0][`metadata`]
      | undefined

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

  it(`persists truncate transactions and preserves intended collection metadata`, async () => {
    const adapter = createRecordingAdapter()

    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit: (() => void) | undefined
    let remoteTruncate: (() => void) | undefined
    let remoteMetadata:
      | Parameters<SyncConfig<Todo, string>[`sync`]>[0][`metadata`]
      | undefined

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
    const unsubscribeError = collection.on(`status:error`, () => {
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
        status: `error`,
        publicError: receiptError,
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
      if (loadCalls === 2) {
        failingLoadEntered.resolve()
        throw loadError
      }
      if (loadCalls === 3) fallbackReload.resolve()
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
    const unsubscribeError = collection.on(`status:error`, () => {
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
        status: `error`,
        publicError: loadError,
        loadCalls: 2,
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
      if (loadCalls === 2) fallbackReload.resolve()
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
        loadCalls: 2,
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
    let releaseFreshReload!: () => void
    const staleReloadGate = new Promise<void>((resolve) => {
      releaseStaleReload = resolve
    })
    const freshReloadGate = new Promise<void>((resolve) => {
      releaseFreshReload = resolve
    })
    adapter.loadSubset = async (...args) => {
      loadCalls++
      if (loadCalls === 2) {
        await staleReloadGate
        return [
          {
            key: `1`,
            value: { id: `1`, title: `Stale reload` },
          },
        ]
      }
      if (loadCalls === 3) await freshReloadGate
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
    for (let attempt = 0; attempt < 20 && loadCalls < 2; attempt++) {
      await flushAsyncWork()
    }
    expect(loadCalls).toBe(2)

    await collection.cleanup()
    adapter.rows.set(`1`, { id: `1`, title: `Restarted` })
    collection.startSyncImmediate()
    releaseStaleReload()
    for (let attempt = 0; attempt < 20 && loadCalls < 3; attempt++) {
      await flushAsyncWork()
    }
    expect(loadCalls).toBe(3)
    expect(collection.get(`1`)?.title).not.toBe(`Stale reload`)

    releaseFreshReload()
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
      if (metadataCalls === 2) await staleMetadataGate
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
    expect(metadataCalls).toBe(1)
    expect(subsetCalls).toBe(1)

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-stale-metadata`,
      latestRowVersion: 1,
      requiresFullReload: true,
    })
    for (let attempt = 0; attempt < 20 && metadataCalls < 2; attempt++) {
      await flushAsyncWork()
    }
    expect(metadataCalls).toBe(2)

    await collection.cleanup()
    adapter.rows.set(`1`, { id: `1`, title: `Restarted` })
    collection.startSyncImmediate()
    releaseStaleMetadata()
    for (
      let attempt = 0;
      attempt < 20 && (metadataCalls < 3 || subsetCalls < 2);
      attempt++
    ) {
      await flushAsyncWork()
    }

    expect(metadataCalls).toBe(3)
    expect(subsetCalls).toBe(2)
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

  it(`marks the collection errored with the exact later on-demand hydration failure`, async () => {
    const hydrationFailure = new Error(`later on-demand hydration failed`)
    const adapter = createRecordingAdapter()
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `later-on-demand-hydration-failure`,
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
      expect(collection.status).toBe(`ready`)
      adapter.loadSubset = () => Promise.reject(hydrationFailure)

      await expect(
        atPersistedOracleCheckpoint(
          Promise.resolve(collection._sync.loadSubset({ limit: 1 })),
          `later on-demand hydration rejected`,
        ),
      ).rejects.toBe(hydrationFailure)

      expect(collection.status).toBe(`error`)
      expect(collection._lifecycle.getSyncError()).toBe(hydrationFailure)
      expect([...collection.values()]).toEqual([])
      expect(adapter.rows.size).toBe(0)
      expect(adapter.applyCommittedTxCalls).toEqual([])
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

      expect(collection.status).toBe(`error`)
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
        persistence: { adapter },
      }),
    )
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `terminal-hydration collection initially ready`,
      )
      adapter.loadSubset = () => Promise.reject(hydrationFailure)
      await expect(
        atPersistedOracleCheckpoint(
          Promise.resolve(collection._sync.loadSubset({ limit: 1 })),
          `terminal hydration rejected`,
        ),
      ).rejects.toBe(hydrationFailure)
      expect(collection.status).toBe(`error`)

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
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`rejects new source transactions after a terminal hydration failure`, async () => {
    const hydrationFailure = new Error(`terminal source hydration failed`)
    const adapter = createRecordingAdapter()
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
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
        persistence: { adapter },
      }),
    )
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `terminal source-hydration collection initially ready`,
      )
      adapter.loadSubset = () => Promise.reject(hydrationFailure)
      await expect(
        atPersistedOracleCheckpoint(
          Promise.resolve(collection._sync.loadSubset({ limit: 1 })),
          `terminal source hydration rejected`,
        ),
      ).rejects.toBe(hydrationFailure)
      expect(collection.status).toBe(`error`)
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
        status: `error`,
        lateVisible: undefined,
        lateDurable: undefined,
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
    const second: LoadSubsetOptions = { limit: 1 }
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

  it.each([`abort`, `release`, `offline`] as const)(
    `handles remote ensure after %s without resurrecting cancelled demand`,
    async (action) => {
      vi.useFakeTimers()
      const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const failure = Object.assign(new Error(action), {
        name: action === `abort` ? `AbortError` : `Error`,
      })
      const ensure = vi.fn(async () => {
        throw new Error(`offline`)
      })
      const coordinator: PersistedCollectionCoordinator = {
        getNodeId: () => `cancel-ensure`,
        subscribe: () => () => {},
        publish: () => {},
        isLeader: () => true,
        ensureLeadership: async () => {},
        requestEnsurePersistedIndex: async () => {},
        requestEnsureRemoteSubset: ensure,
      }
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `cancel-ensure-${action}`,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return {
                loadSubset: async () => {
                  throw failure
                },
              }
            },
          },
          persistence: { adapter: createRecordingAdapter(), coordinator },
        }),
      )
      const options = { limit: 1 }
      try {
        collection.startSyncImmediate()
        const result = await Promise.resolve(
          collection._sync.loadSubset(options),
        ).then(
          () => `ready`,
          (error: unknown) => error,
        )
        if (action === `release`) collection._sync.unloadSubset(options)
        const callsBeforeRetry = ensure.mock.calls.length
        await vi.advanceTimersByTimeAsync(200)
        if (action === `offline`) {
          expect(result).toBe(failure)
          expect(ensure.mock.calls.length).toBeGreaterThan(callsBeforeRetry)
        } else {
          if (action === `abort`) expect(result).toBe(failure)
          expect(ensure).toHaveBeenCalledTimes(callsBeforeRetry)
        }
      } finally {
        await collection.cleanup()
        warning.mockRestore()
        vi.useRealTimers()
      }
    },
  )

  it(`retries queued remote subset ensure after transient failures`, async () => {
    const adapter = createRecordingAdapter()
    let ensureCalls = 0

    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `retry-node`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestEnsureRemoteSubset: async () => {
        ensureCalls++
        if (ensureCalls === 1) {
          throw new Error(`offline`)
        }
      },
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-retry`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {}
          },
        },
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    collection.startSyncImmediate()
    await flushAsyncWork()

    await (collection as any)._sync.loadSubset({ limit: 1 })
    await flushAsyncWork(120)

    expect(ensureCalls).toBeGreaterThanOrEqual(2)
  })

  it(`fails sync-absent persistence when follower ack omits mutation ids`, async () => {
    const adapter = createRecordingAdapter()
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `follower-node`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => false,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyLocalMutations: async () => ({
        type: `rpc:applyLocalMutations:res`,
        rpcId: `ack-1`,
        ok: true,
        term: 1,
        seq: 1,
        latestRowVersion: 1,
        acceptedMutationIds: [],
      }),
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-absent-ack`,
        getKey: (item) => item.id,
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    const tx = collection.insert({
      id: `ack-mismatch`,
      title: `Ack mismatch`,
    })

    await expect(tx.isPersisted.promise).rejects.toThrow(
      /partial acceptance is not supported/,
    )
    expect(collection.get(`ack-mismatch`)).toBeUndefined()
  })

  it(`targeted update avoids full loadSubset call`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `Original` }])
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

    // Update the row in the adapter backing store
    adapter.rows.set(`1`, { id: `1`, title: `Updated` })

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-targeted`,
      latestRowVersion: 1,
      requiresFullReload: false,
      changedRows: [{ key: `1`, value: { id: `1`, title: `Updated` } }],
      deletedKeys: [],
    })

    await flushAsyncWork()
    await flushAsyncWork()

    // Targeted path should NOT have called loadSubset again
    expect(adapter.loadSubsetCalls.length).toBe(loadSubsetCallsAfterPreload)
    expect(stripVirtualProps(collection.get(`1`))).toEqual({
      id: `1`,
      title: `Updated`,
    })
  })

  it(`targeted update removes row that no longer matches WHERE`, async () => {
    const adapter = createRecordingAdapter([
      { id: `1`, title: `Keep` },
      { id: `2`, title: `Keep` },
    ])
    const coordinator = createCoordinatorHarness()

    const whereExpr = new IR.Func(`eq`, [
      new IR.PropRef([`title`]),
      new IR.Value(`Keep`),
    ])

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        syncMode: `on-demand`,
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

    collection.startSyncImmediate()
    await flushAsyncWork()

    // Load a filtered subset with WHERE title = 'Keep'
    await (collection as any)._sync.loadSubset({ where: whereExpr })
    await flushAsyncWork()
    expect(stripVirtualProps(collection.get(`2`))).toEqual({
      id: `2`,
      title: `Keep`,
    })

    // Change the row so it no longer matches WHERE title = 'Keep'
    adapter.rows.set(`2`, { id: `2`, title: `Changed` })

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-where`,
      latestRowVersion: 1,
      requiresFullReload: false,
      changedRows: [{ key: `2`, value: { id: `2`, title: `Changed` } }],
      deletedKeys: [],
    })

    await flushAsyncWork()
    await flushAsyncWork()

    // Row no longer matches WHERE — should be removed from collection
    expect(collection.get(`2`)).toBeUndefined()
  })

  it(`paginated subset falls back to full reload`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `Row 1` }])
    const coordinator = createCoordinatorHarness()

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        syncMode: `on-demand`,
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

    collection.startSyncImmediate()
    await flushAsyncWork()

    // Add a paginated subset (limit)
    await (collection as any)._sync.loadSubset({ limit: 10 })
    await flushAsyncWork()
    const loadSubsetCallsAfterPaginated = adapter.loadSubsetCalls.length

    // Update the row in the adapter backing store
    adapter.rows.set(`1`, { id: `1`, title: `Updated` })

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-paginated`,
      latestRowVersion: 1,
      requiresFullReload: false,
      changedRows: [{ key: `1`, value: { id: `1`, title: `Updated` } }],
      deletedKeys: [],
    })

    await flushAsyncWork()
    await flushAsyncWork()

    // With a paginated subset active, should fall back to full reload
    expect(adapter.loadSubsetCalls.length).toBeGreaterThan(
      loadSubsetCallsAfterPaginated,
    )
    expect(stripVirtualProps(collection.get(`1`))).toEqual({
      id: `1`,
      title: `Updated`,
    })
  })

  it(`fail-stops queued and later work when reset reload fails after truncation`, async () => {
    const seed = { id: `seed`, title: `durable baseline` }
    const adapter = createRecordingAdapter([seed])
    const coordinator = createFailStopCoordinatorHarness(
      `terminal-reset-reload-failure`,
    )
    const reloadEntered = createEventGate()
    const reload = createEventGate()
    const reloadError = new Error(`reset reload failed exactly`)
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `terminal-reset-reload-failure`,
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
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    let queuedReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `reset reload collection ready`,
      )
      expect(stripVirtualProps(collection.get(seed.id))).toEqual(seed)
      adapter.loadSubset = async () => {
        reloadEntered.resolve()
        await reload.promise
        throw reloadError
      }
      coordinator.emit({
        type: `collection:reset`,
        schemaVersion: 1,
        resetEpoch: 1,
      })
      await atPersistedOracleCheckpoint(
        reloadEntered.promise,
        `reset reload entered after memory truncate`,
      )
      expect(collection.get(seed.id)).toBeUndefined()

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `queued`, title: `must reject with reset failure` },
      })
      queuedReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void queuedReceipt.catch(() => undefined)
      const queuedSettlement = observeSettlement(queuedReceipt)
      expect(queuedSettlement.read()).toEqual({ status: `pending` })

      reload.reject(reloadError)
      await flushAsyncWork()
      await flushAsyncWork()

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `late`, title: `must not continue after reset failure` },
      })
      const lateOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve(sourceParams.commit()).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `post-reset-reload-failure receipt`,
      )
      const queuedOutcome = queuedSettlement.read()

      expect({
        queuedStatus: queuedOutcome.status,
        queuedExact:
          queuedOutcome.status === `rejected` &&
          queuedOutcome.reason === reloadError,
        lateStatus: lateOutcome.status,
        lateExact:
          lateOutcome.status === `rejected` &&
          lateOutcome.reason === reloadError,
        status: collection.status,
        exactPublicError: collection._lifecycle.getSyncError() === reloadError,
        visibleSeed: collection.get(seed.id),
        durableSeed: adapter.rows.get(seed.id),
        visibleQueued: collection.get(`queued`),
        durableQueued: adapter.rows.get(`queued`),
        visibleLate: collection.get(`late`),
        durableLate: adapter.rows.get(`late`),
        applyCalls: adapter.applyCommittedTxCalls.length,
        publishCalls: coordinator.publishCalls.length,
      }).toEqual({
        queuedStatus: `rejected`,
        queuedExact: true,
        lateStatus: `rejected`,
        lateExact: true,
        status: `error`,
        exactPublicError: true,
        visibleSeed: undefined,
        durableSeed: seed,
        visibleQueued: undefined,
        durableQueued: undefined,
        visibleLate: undefined,
        durableLate: undefined,
        applyCalls: 0,
        publishCalls: 0,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      reload.reject(reloadError)
      warning.mockRestore()
      await cleanupPersistedOracle(
        [
          () => collection.cleanup(),
          () => queuedReceipt?.catch(() => undefined),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`fences coordinator delivery after terminal failure while allowing release and cleanup`, async () => {
    const harness = await createTerminalFailureHarness(
      `durability`,
      `terminal-coordinator-delivery-fence`,
    )
    const {
      adapter,
      collection,
      coordinator,
      initialLease,
      terminalError,
      upstreamLoads,
      upstreamUnloads,
    } = harness
    const adapterLoadsBefore = adapter.loadSubsetCalls.length
    const ensureCallsBefore = coordinator.remoteEnsureCalls.length
    const upstreamLoadsBefore = upstreamLoads.length
    const applyCallsBefore = adapter.applyCommittedTxCalls.length
    const publishCallsBefore = coordinator.publishCalls.length
    adapter.loadSubset = (collectionId, options, context) => {
      adapter.loadSubsetCalls.push({
        collectionId,
        options,
        requiredIndexSignatures: context?.requiredIndexSignatures ?? [],
      })
      return Promise.resolve([
        {
          key: `coordinator-late`,
          value: { id: `coordinator-late`, title: `must not arrive` },
        },
      ])
    }
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `post-terminal-targeted`,
        latestRowVersion: 1,
        requiresFullReload: false,
        changedRows: [
          {
            key: `targeted-late`,
            value: { id: `targeted-late`, title: `must not arrive` },
          },
        ],
        deletedKeys: [],
      })
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 2,
        txId: `post-terminal-full-reload`,
        latestRowVersion: 2,
        requiresFullReload: true,
      })
      coordinator.emit({
        type: `collection:reset`,
        schemaVersion: 1,
        resetEpoch: 2,
      })
      const remoteEnsureOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve(collection._sync.loadSubset({ limit: 9 })).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `post-terminal remote ensure delivery`,
      )
      await flushAsyncWork()
      await flushAsyncWork()
      await flushAsyncWork()

      const beforeCleanup = {
        targetedVisible: collection.get(`targeted-late`),
        reloadVisible: collection.get(`coordinator-late`),
        status: collection.status,
        exactPublicError:
          collection._lifecycle.getSyncError() === terminalError,
      }

      collection._sync.unloadSubset(initialLease)
      const unloadCount = upstreamUnloads.length
      await collection.cleanup()
      cleanedUp = true

      expect({
        remoteEnsureStatus: remoteEnsureOutcome.status,
        remoteEnsureExact:
          remoteEnsureOutcome.status === `rejected` &&
          remoteEnsureOutcome.reason === terminalError,
        adapterLoads: adapter.loadSubsetCalls.length,
        ensureCalls: coordinator.remoteEnsureCalls.length,
        upstreamLoads: upstreamLoads.length,
        unloadCount,
        unsubscribeCalls: coordinator.unsubscribeCalls,
        applyCalls: adapter.applyCommittedTxCalls.length,
        publishCalls: coordinator.publishCalls.length,
        targetedVisible: beforeCleanup.targetedVisible,
        reloadVisible: beforeCleanup.reloadVisible,
        targetedDurable: adapter.rows.get(`targeted-late`),
        reloadDurable: adapter.rows.get(`coordinator-late`),
        status: beforeCleanup.status,
        exactPublicError: beforeCleanup.exactPublicError,
      }).toEqual({
        remoteEnsureStatus: `rejected`,
        remoteEnsureExact: true,
        adapterLoads: adapterLoadsBefore,
        ensureCalls: ensureCallsBefore,
        upstreamLoads: upstreamLoadsBefore,
        unloadCount: 1,
        unsubscribeCalls: 1,
        applyCalls: applyCallsBefore,
        publishCalls: publishCallsBefore,
        targetedVisible: undefined,
        reloadVisible: undefined,
        targetedDurable: undefined,
        reloadDurable: undefined,
        status: `error`,
        exactPublicError: true,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      await cleanupPersistedOracle(
        [() => (cleanedUp ? undefined : collection.cleanup())],
        hasPrimaryFailure,
      )
    }
  })

  it(`keeps a hydrated resume baseline across narrow full reloads`, async () => {
    const adapter = createRecordingAdapter([
      { id: `1`, title: `Narrow` },
      { id: `2`, title: `Baseline only` },
    ])
    const loadSubset = adapter.loadSubset.bind(adapter)
    adapter.loadSubset = async (...args) => {
      const rows = await loadSubset(...args)
      return args[1].where ? rows.filter((row) => row.key === `1`) : rows
    }
    const coordinator = createCoordinatorHarness()
    let hydrateBaseline: (() => Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady, metadata }) => {
            hydrateBaseline = (
              metadata?.row as
                | { whenHydrated?: () => Promise<void> }
                | undefined
            )?.whenHydrated
            markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    collection.startSyncImmediate()
    await vi.waitFor(() => expect(hydrateBaseline).toBeTypeOf(`function`))
    await hydrateBaseline!()
    expect(collection.has(`2`)).toBe(true)

    await collection._sync.loadSubset({
      where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(`1`)]),
    })
    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `full-reload`,
      latestRowVersion: 1,
      requiresFullReload: true,
    })
    await flushAsyncWork()
    await flushAsyncWork()

    expect(collection.has(`2`)).toBe(true)
    await collection.cleanup()
  })

  it(`ignores late wrapped sync writes after cleanup`, async () => {
    let lateWrite!: (message: { type: `insert`; value: Todo }) => void
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `late-write-after-cleanup`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ write, markReady }) => {
            lateWrite = (message) => write(message)
            markReady()
          },
        },
        persistence: { adapter: createNoopAdapter() },
      }),
    )

    await collection.preload()
    await collection.cleanup()

    expect(() =>
      lateWrite({
        type: `insert`,
        value: { id: `late`, title: `Late` },
      }),
    ).not.toThrow()
    expect(collection.has(`late`)).toBe(false)
  })
})

describe(`persisted key and identifier helpers`, () => {
  it(`encodes and decodes persisted storage keys without collisions`, () => {
    expect(encodePersistedStorageKey(1)).toBe(`n:1`)
    expect(encodePersistedStorageKey(`1`)).toBe(`s:1`)
    expect(decodePersistedStorageKey(`n:1`)).toBe(1)
    expect(decodePersistedStorageKey(`s:1`)).toBe(`1`)
    expect(Object.is(decodePersistedStorageKey(`n:-0`), -0)).toBe(true)
  })

  it(`throws for invalid persisted key values and encodings`, () => {
    expect(() => encodePersistedStorageKey(Number.POSITIVE_INFINITY)).toThrow(
      InvalidPersistedStorageKeyError,
    )
    expect(() => decodePersistedStorageKey(`legacy-key`)).toThrow(
      InvalidPersistedStorageKeyEncodingError,
    )
  })

  it(`creates deterministic safe table names`, () => {
    const first = createPersistedTableName(`todos`)
    const second = createPersistedTableName(`todos`)
    const tombstoneName = createPersistedTableName(`todos`, `t`)

    expect(first).toBe(second)
    expect(first).toMatch(/^c_[a-z2-7]+_[0-9a-z]+$/)
    expect(tombstoneName).toMatch(/^t_[a-z2-7]+_[0-9a-z]+$/)
  })
})
