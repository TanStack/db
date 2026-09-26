import { describe, expect, it, vi } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import {
  BasicIndex,
  DbClient,
  IR,
  NoPendingSyncTransactionCommitError,
  NoPendingSyncTransactionWriteError,
  SyncTransactionAbortedError,
  collectionOptions,
  createCollection,
  createLiveQueryCollection,
  createTransaction,
  eq,
} from '@tanstack/db'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from '../../db/tests/oracle-config.js'
import {
  IndeterminateCommitError,
  InvalidPersistedCollectionCoordinatorError,
  InvalidPersistedStorageKeyEncodingError,
  InvalidPersistedStorageKeyError,
  InvalidSyncConfigError,
  PersistedCollectionDurabilityError,
  SingleProcessCoordinator,
  createPersistedTableName,
  decodePersistedStorageKey,
  encodePersistedStorageKey,
  persistedCollectionOptions,
  toTransportedLoadSubsetOptions,
} from '../src'
import type {
  CollectionReset,
  PersistedCollectionCoordinator,
  PersistedCollectionPersistence,
  PersistedSyncWrappedOptions,
  PersistenceAdapter,
  ProtocolEnvelope,
  PullSinceResponse,
  RemoteSubsetOwner,
  TxCommitted,
} from '../src'
import type {
  Collection,
  LoadSubsetOptions,
  PendingMutation,
  Subscription,
  SyncConfig,
  SyncMetadataApi,
} from '@tanstack/db'

/**
 * # Does persisted wrapping preserve one Collection history?
 *
 * RFC #1659 invariant 7 requires each accepted sync transaction to become
 * durable, remain replayable, or fail through an observable channel.
 * Persistence adds a durable replica beneath an optional upstream sync source.
 * Startup hydrates rows and metadata, buffers concurrent source work, then
 * publishes one coherent public snapshot. Complete committed transactions
 * route through the configured collection owner. Publication precedes
 * durability, but a rejected durability boundary must reject its applied
 * receipt and fail-stop that sync run without admitting a suffix.
 *
 * `foldDurabilityLedger` is the independent model for append-only source
 * obligations. The recording adapter is a plain durable-state model: Maps for
 * rows and metadata plus ordered transaction, index, load, and reload calls.
 * Histories cross hydration, held adapters, source FIFO ordering,
 * independent/dependent aborts, open-transaction failure boundaries, ambient owner
 * operations, applied-receipt rejection, remote subset demand, acquisition
 * release, retry, coordinator replay, queued startup reloads, unscheduled
 * startup/reset overlap, cleanup, and restart. Tests drive the
 * real persisted wrapper, Collection, coordinator, adapter, transactions,
 * indexes, and local mutation path.
 * Cleanup waits for source and persistence release work after any teardown
 * failure. A retired source sync cannot publish new remote subset ownership.
 * A source abort before core application rejects that transaction's receipt.
 * It does not invalidate the durable baseline or an independent queued source
 * transaction when the failed transaction made no public or durable change.
 *
 * Refinement checkpoints compare public rows, durable state, metadata, request
 * data, sequence evidence, exact errors, and late-work fencing. Fixed hostile
 * values challenge wire admission. Controlled failures challenge publication
 * and durability classification. Fixed witnesses and bounded schedule tables
 * preserve known failure paths, while omission and reordering controls
 * challenge the model's judgment. Focused Browser and Electron suites own the
 * multiprocess transport and host-specific replay partitions.
 *
 * Known omissions: driver SQL behavior, native host ownership, and the shared
 * conformance portfolio have separate owners. This file proves the role
 * partition for non-single-process remote demand: an ownerless elected node
 * does not route, while a follower may route to the elected owner's registered
 * source. Native SQLite hosts, live Electric service behavior, adapter
 * cancellation, and the open B2-failure/E4 schedule remain separate evidence.
 */

type Todo = {
  id: string
  title: string
  detail?: string
}

type TodoSyncParams = Parameters<SyncConfig<Todo, string>[`sync`]>[0]

const requestedOracleReplayProperty = readOracleRunConfig().replayProperty
const describeUnlessOracleReplay =
  requestedOracleReplayProperty === undefined ? describe : describe.skip

const persistedKeySetEvidenceStatuses = [
  `consistent`,
  `unknown`,
  `incompatible`,
] as const

type OnDemandEvidenceObservation = {
  status: (typeof persistedKeySetEvidenceStatuses)[number]
  route: `loadSubset` | `forceReloadSubset`
  baselineVisible: boolean | `not-observed`
  onDemandVisible: boolean
}

function expectOnDemandEvidenceLaw(
  observation: OnDemandEvidenceObservation,
): void {
  try {
    expect(observation).toEqual({
      status: observation.status,
      route: observation.route,
      baselineVisible:
        observation.route === `loadSubset`
          ? observation.status !== `incompatible`
          : `not-observed`,
      onDemandVisible: true,
    })
  } catch (cause) {
    throw new Error(
      `on-demand rows must not inherit baseline evidence rejection`,
      { cause },
    )
  }
}

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
  loadResumeSnapshotCalls: Array<{
    collectionId: string
    includeRows: boolean | undefined
    requiredIndexSignatures: ReadonlyArray<string>
  }>
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
    loadResumeSnapshotCalls: [],
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
    loadResumeSnapshot: (collectionId, options) => {
      adapter.loadResumeSnapshotCalls.push({
        collectionId,
        includeRows: options?.includeRows,
        requiredIndexSignatures: options?.requiredIndexSignatures ?? [],
      })
      const latest = adapter.applyCommittedTxCalls.at(-1)?.tx
      return Promise.resolve({
        rows:
          options?.includeRows === false
            ? []
            : Array.from(rows.values()).map((value) => ({
                key: value.id,
                value,
                metadata: rowMetadata.get(value.id),
              })),
        keySet: { status: `consistent` },
        collectionMetadata: Array.from(
          adapter.collectionMetadata,
          ([key, value]) => ({ key, value }),
        ),
        latestTerm: latest?.term ?? 0,
        latestSeq: latest?.seq ?? 0,
        latestRowVersion: latest?.rowVersion ?? 0,
        resetEpoch: 0,
      })
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
        } else if (mutation.type === `update`) {
          rows.set(mutation.key as string, {
            ...rows.get(mutation.key as string),
            ...(mutation.value as Todo),
          })
          if (mutation.metadataChanged) {
            rowMetadata.set(mutation.key as string, mutation.metadata)
          }
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

function overrideBaselineRows(
  adapter: RecordingAdapter,
  loadRows: () =>
    | Array<{ key: string; value: Todo; metadata?: unknown }>
    | Promise<Array<{ key: string; value: Todo; metadata?: unknown }>>,
): () => void {
  const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
  adapter.loadResumeSnapshot = async (...args) => {
    const snapshot = await loadResumeSnapshot(...args)
    if (args[1]?.includeRows === false) return snapshot
    return { ...snapshot, rows: await loadRows() }
  }
  return () => {
    adapter.loadResumeSnapshot = loadResumeSnapshot
  }
}

function createNoopAdapter(): PersistenceAdapter {
  return {
    loadSubset: () => Promise.resolve([]),
    loadResumeSnapshot: () =>
      Promise.resolve({
        rows: [],
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }),
    applyCommittedTx: () => Promise.resolve(),
    ensureIndex: () => Promise.resolve(),
  }
}

type CoordinatorHarness = PersistedCollectionCoordinator & {
  emit: (payload: TxCommitted | CollectionReset, senderId?: string) => void
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
    // Remote subset ownership is outside this protocol-delivery harness.
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

function createLocalCoordinatorHarness() {
  let subscriber: ((message: ProtocolEnvelope<unknown>) => void) | undefined
  return Object.assign(new SingleProcessCoordinator(), {
    subscribe: (
      _collectionId: string,
      onMessage: (message: ProtocolEnvelope<unknown>) => void,
    ) => {
      subscriber = onMessage
      return () => {
        subscriber = undefined
      }
    },
    emit: (payload: TxCommitted | CollectionReset) => {
      subscriber?.({
        v: 1,
        dbName: `test-db`,
        collectionId: `sync-present`,
        senderId: `remote-node`,
        ts: Date.now(),
        payload,
      })
    },
  })
}

type FailStopCoordinatorHarness = PersistedCollectionCoordinator & {
  emit: (payload: unknown, senderId?: string) => void
  publishCalls: Array<ProtocolEnvelope<unknown>>
  remoteEnsureCalls: Array<LoadSubsetOptions>
  remoteReleaseCalls: Array<LoadSubsetOptions>
  unsubscribeCalls: number
}

function createFailStopCoordinatorHarness(
  collectionId: string,
): FailStopCoordinatorHarness {
  let subscriber: ((message: ProtocolEnvelope<unknown>) => void) | undefined
  const harness: FailStopCoordinatorHarness = {
    publishCalls: [],
    remoteEnsureCalls: [],
    remoteReleaseCalls: [],
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
    requestReleaseRemoteSubset: async (_collectionId, options) => {
      harness.remoteReleaseCalls.push(options)
    },
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

function createDeferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
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

it.each([false, true])(
  `persisted oracle cleanup attempts every action without hiding a primary failure: %s`,
  async (hasPrimaryFailure) => {
    const firstFailure = new Error(`first oracle cleanup failure`)
    const secondFailure = new Error(`second oracle cleanup failure`)
    const attempts: Array<string> = []
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})

    try {
      const outcome = await cleanupPersistedOracle(
        [
          () => {
            attempts.push(`first`)
            throw firstFailure
          },
          () => {
            attempts.push(`second`)
            return Promise.reject(secondFailure)
          },
          () => {
            attempts.push(`last`)
          },
        ],
        hasPrimaryFailure,
      ).then(
        () => undefined,
        (error: unknown) => error,
      )

      expect(attempts).toEqual([`first`, `second`, `last`])
      if (hasPrimaryFailure) {
        expect(outcome).toBeUndefined()
        expect(warning).toHaveBeenCalledWith(
          `Persisted oracle cleanup failed after the primary failure:`,
          [firstFailure, secondFailure],
        )
      } else {
        expect(outcome).toBeInstanceOf(AggregateError)
        expect((outcome as AggregateError).errors).toEqual([
          firstFailure,
          secondFailure,
        ])
        expect(warning).not.toHaveBeenCalled()
      }
    } finally {
      warning.mockRestore()
    }
  },
)

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

function expectPendingKeyMembershipWork(
  actual: number,
  pendingOwners: number,
  partialWrites: number,
): void {
  expect(
    actual,
    `one key-membership lookup per pending owner and partial write`,
  ).toBe(pendingOwners * partialWrites)
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
  const restoreBaselineRows = overrideBaselineRows(adapter, async () => {
    hydrationEntered.resolve()
    await releaseHydration.promise
    hydrationRejected.resolve()
    throw hydrationError
  })

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
    restoreBaselineRows()

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

type SourceFifoOrderingObservation = {
  publicRows: Array<Todo>
  durableRows: Array<Todo>
  status: string
  pendingMarkers: number
}

function expectSourceFifoOrderingObservation(
  actual: SourceFifoOrderingObservation,
  expectedRows: ReadonlyArray<Todo>,
): void {
  expect(actual).toEqual({
    publicRows: expectedRows,
    durableRows: expectedRows,
    status: `ready`,
    pendingMarkers: 0,
  })
}

type AbortGraphObservation = {
  predecessorStatus: `fulfilled` | `rejected`
  predecessorName: string | undefined
  successorStatus: `fulfilled` | `rejected`
  sameFailure: boolean
  status: string
  publicSuccessor: Todo | undefined
  durableSuccessor: Todo | undefined
  pendingMarkers: number
}

function expectAbortGraphObservation(
  actual: AbortGraphObservation,
  relationship: `independent` | `same-key`,
  successorKey: string,
  successorTitle: string,
): void {
  expect(actual).toEqual(
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
}

type OwnerIsolationAdmissionObservation = {
  exactError: boolean
  strayVisible: boolean
}

function expectOwnerIsolationAdmission(
  actual: OwnerIsolationAdmissionObservation,
): void {
  expect(actual).toEqual({ exactError: true, strayVisible: false })
}

type OpenTransactionBoundaryObservation = {
  status: string
  pendingMarkers: number
}

type RequestLocalFailureObservation = {
  receiptStatus: `pending` | `fulfilled` | `rejected`
  publicRows: Array<Todo>
  durableRows: Array<Todo>
  status: string
  publicError: unknown
}

function expectOpenTransactionBoundaryObservation(
  actual: OpenTransactionBoundaryObservation,
  boundary: `abort` | `cleanup` | `terminal-failure`,
): void {
  expect(actual).toEqual({
    status:
      boundary === `cleanup`
        ? `cleaned-up`
        : boundary === `abort`
          ? `ready`
          : `error`,
    pendingMarkers: 0,
  })
}

function expectRequestLocalFailureObservation(
  actual: RequestLocalFailureObservation,
  expectedRows: ReadonlyArray<Todo>,
): void {
  expect(actual).toEqual({
    receiptStatus: `fulfilled`,
    publicRows: expectedRows,
    durableRows: expectedRows,
    status: `ready`,
    publicError: undefined,
  })
}

async function runSourceFifoOrderingLaw(
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
      id: `generated-source-fifo-order-${historyId}`,
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
      `generated source FIFO ordering ready`,
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
      `generated source FIFO ordering adapter hold`,
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

    sourceParams.begin()
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
    ).toEqual(sortedTodoRows([{ id: `gate`, title: `holds adapter` }]))

    releaseFirstPersistence.resolve()
    for (const [index, receipt] of receipts.entries()) {
      await atPersistedOracleCheckpoint(
        receipt,
        `generated source FIFO receipt ${index}`,
      )
    }
    expectSourceFifoOrderingObservation(
      {
        publicRows: sortedTodoRows(
          Array.from(collection.values()).map(stripVirtualProps),
        ),
        durableRows: sortedTodoRows(adapter.rows.values()),
        status: collection.status,
        pendingMarkers: collection._state.pendingSyncedTransactions.length,
      },
      sortedTodoRows(expected.values()),
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

    expectAbortGraphObservation(
      {
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
      },
      relationship,
      successorKey,
      successorTitle,
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
    expectOwnerIsolationAdmission({
      exactError:
        operation === `commit`
          ? observedError instanceof NoPendingSyncTransactionCommitError
          : observedError instanceof NoPendingSyncTransactionWriteError,
      strayVisible: collection.has(`stray`),
    })

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

async function runInternalOpenTransactionBoundaryLaw(
  boundary: `abort` | `cleanup` | `terminal-failure`,
  hydratedTitle: string,
): Promise<void> {
  const historyId = ++generatedOwnershipHistoryId
  const hydrated = { id: `hydrated`, title: hydratedTitle }
  const adapter = createRecordingAdapter([hydrated])
  const hydrationEntered = createEventGate()
  const releaseHydration = createEventGate()
  overrideBaselineRows(adapter, async () => {
    hydrationEntered.resolve()
    await releaseHydration.promise
    return [{ key: hydrated.id, value: hydrated }]
  })
  let sourceParams!: TodoSyncParams
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: `generated-internal-transaction-${historyId}`,
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
    }).toEqual({ internalReservationStarted: true, pendingMarkers: 0 })

    if (boundary === `cleanup`) {
      await atPersistedOracleCheckpoint(
        collection.cleanup(),
        `generated internal cleanup`,
      )
      cleanedUp = true
      expectOpenTransactionBoundaryObservation(
        {
          status: collection.status,
          pendingMarkers: collection._state.pendingSyncedTransactions.length,
        },
        boundary,
      )
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
      expectOpenTransactionBoundaryObservation(
        {
          status: collection.status,
          pendingMarkers: collection._state.pendingSyncedTransactions.length,
        },
        boundary,
      )
      return
    }

    const terminalError = new Error(`generated terminal transaction failure`)
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
      name: `PersistedCollectionDurabilityError`,
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
    ).rejects.toMatchObject({ name: `PersistedCollectionDurabilityError` })
    expectOpenTransactionBoundaryObservation(
      {
        status: collection.status,
        pendingMarkers: collection._state.pendingSyncedTransactions.length,
      },
      boundary,
    )
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

type RequestLocalFailureOperation = `partial-update` | `delete` | `insert`

async function runRequestLocalFailureOperationLaw(
  operation: RequestLocalFailureOperation,
  baselineTitle: string,
  sourceTitle: string,
): Promise<void> {
  const historyId = ++generatedOwnershipHistoryId
  const baseline: Todo = {
    id: `shared`,
    title: baselineTitle,
    detail: `required baseline detail`,
  }
  const inserted: Todo = {
    id: baseline.id,
    title: sourceTitle,
    detail: `complete insert detail`,
  }
  const adapter = createRecordingAdapter(
    operation === `insert` ? [] : [baseline],
  )
  const loadPersistedRows = adapter.loadSubset.bind(adapter)
  const loadEntered = createEventGate()
  const rejectLoad = createEventGate()
  const loadFailure = new Error(
    `generated request-local ${operation} load failure`,
  )
  let loadCalls = 0
  adapter.loadSubset = async (...args) => {
    loadCalls++
    if (loadCalls === 1) {
      loadEntered.resolve()
      await rejectLoad.promise
      throw loadFailure
    }
    return loadPersistedRows(...args)
  }
  let sourceParams!: TodoSyncParams
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: `generated-request-local-failure-${historyId}`,
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
  const expectedRows =
    operation === `delete`
      ? []
      : operation === `insert`
        ? [inserted]
        : [{ ...baseline, title: sourceTitle }]
  let load: Promise<void> | undefined
  let receipt: Promise<void> | undefined
  let hasPrimaryFailure = false

  try {
    await atPersistedOracleCheckpoint(
      collection.stateWhenReady(),
      `generated request-local collection ready`,
    )
    load = Promise.resolve(collection._sync.loadSubset({ limit: 1 })).then(
      () => undefined,
    )
    void load.catch(() => undefined)
    await atPersistedOracleCheckpoint(
      loadEntered.promise,
      `generated request-local load entered`,
    )

    sourceParams.begin()
    sourceParams.write(
      operation === `delete`
        ? { type: `delete`, key: baseline.id }
        : operation === `insert`
          ? { type: `insert`, value: inserted }
          : {
              type: `update`,
              value: { id: baseline.id, title: sourceTitle } as Todo,
            },
    )
    receipt = Promise.resolve(sourceParams.commit()).then(() => undefined)
    const receiptState = observeSettlement(receipt)
    expect(receiptState.read()).toEqual({ status: `pending` })

    rejectLoad.resolve()
    await expect(
      atPersistedOracleCheckpoint(load, `generated request-local rejection`),
    ).rejects.toBe(loadFailure)
    await atPersistedOracleCheckpoint(
      receipt,
      `generated request-local receipt settlement`,
    )
    expectRequestLocalFailureObservation(
      {
        receiptStatus: receiptState.read().status,
        publicRows: sortedTodoRows(
          [...collection.values()].map(stripVirtualProps),
        ),
        durableRows: sortedTodoRows(adapter.rows.values()),
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
      },
      expectedRows,
    )

    await atPersistedOracleCheckpoint(
      Promise.resolve(collection._sync.loadSubset({ limit: 1 })),
      `generated request-local retry`,
    )
    expectRequestLocalFailureObservation(
      {
        receiptStatus: receiptState.read().status,
        publicRows: sortedTodoRows(
          [...collection.values()].map(stripVirtualProps),
        ),
        durableRows: sortedTodoRows(adapter.rows.values()),
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
      },
      expectedRows,
    )
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
}

type GeneratedPersistenceHistory = {
  axes: Array<string>
  titles: Array<string>
}

type GeneratedPersistenceGrammar = {
  property: string
  axes: ReadonlyArray<string>
  axisContribution: Readonly<Record<string, string>>
  titleCount: number
  witness: GeneratedPersistenceHistory
}

const sourceFifoOrderingAxes = [`same-key`, `disjoint`] as const
const abortGraphAxes = [`independent`, `same-key`] as const
const ownerIsolationAxes = [`write`, `commit`, `truncate`] as const
const openTransactionBoundaryAxes = [
  `abort`,
  `cleanup`,
  `terminal-failure`,
] as const
const requestLocalFailureAxes = [`partial-update`, `delete`, `insert`] as const
const generatedTitleMaxLength = 12
const generatedPersistenceFixedSeeds = {
  sourceFifoOrdering: 18_530_101,
  abortGraph: 18_530_102,
  ownerIsolation: 18_530_103,
  openTransactionBoundary: 18_530_104,
  requestLocalFailure: 18_530_105,
} as const

const generatedPersistenceGrammars: ReadonlyArray<GeneratedPersistenceGrammar> =
  [
    {
      property: `sqlite-persistence.source-fifo-order`,
      axes: sourceFifoOrderingAxes,
      axisContribution: {
        [`same-key`]: `the later source value wins in source order`,
        disjoint: `both unrelated values and receipts survive`,
      },
      titleCount: 2,
      witness: {
        axes: [`same-key`, `disjoint`],
        titles: [`older`, `newer`],
      },
    },
    {
      property: `sqlite-persistence.abort-graph`,
      axes: abortGraphAxes,
      axisContribution: {
        independent: `an unrelated sibling survives the abort`,
        [`same-key`]: `a dependent suffix shares the predecessor failure`,
      },
      titleCount: 2,
      witness: {
        axes: [`independent`, `same-key`],
        titles: [`predecessor`, `successor`],
      },
    },
    {
      property: `sqlite-persistence.owner-isolation`,
      axes: ownerIsolationAxes,
      axisContribution: {
        write: `bare write rejects without publishing a stray row`,
        commit: `bare commit rejects without settling another owner`,
        truncate: `bare truncate rejects without clearing another owner`,
      },
      titleCount: 1,
      witness: {
        axes: [`write`, `commit`, `truncate`],
        titles: [`queued`],
      },
    },
    {
      property: `sqlite-persistence.open-transaction-boundary`,
      axes: openTransactionBoundaryAxes,
      axisContribution: {
        abort: `explicit abort leaves no core transaction`,
        cleanup: `cleanup leaves no core transaction`,
        [`terminal-failure`]: `fail-stop leaves no core transaction`,
      },
      titleCount: 1,
      witness: {
        axes: [`abort`, `cleanup`, `terminal-failure`],
        titles: [`hydrated`],
      },
    },
    {
      property: `sqlite-persistence.request-local-failure-buffered-source`,
      axes: requestLocalFailureAxes,
      axisContribution: {
        [`partial-update`]: `an unseen persisted baseline is reconstructed`,
        delete: `a buffered delete settles without resurrection`,
        insert: `a complete buffered insert settles without duplication`,
      },
      titleCount: 2,
      witness: {
        axes: [`partial-update`, `delete`, `insert`],
        titles: [`baseline`, `source`],
      },
    },
  ]

function reconstructGeneratedPersistenceHistory(
  grammar: GeneratedPersistenceGrammar,
  history: GeneratedPersistenceHistory,
): GeneratedPersistenceHistory {
  const requiredAxes = new Set(grammar.axes)
  const axesAreExact =
    history.axes.length === grammar.axes.length &&
    new Set(history.axes).size === grammar.axes.length &&
    history.axes.every((axis) => requiredAxes.has(axis))
  const titlesAreInRange =
    history.titles.length === grammar.titleCount &&
    history.titles.every(
      (title) => [...title].length <= generatedTitleMaxLength,
    )
  if (!axesAreExact || !titlesAreInRange) {
    throw new Error(
      `invalid generated persistence history: ${grammar.property}`,
    )
  }
  return {
    axes: [...history.axes],
    titles: [...history.titles],
  }
}

function fullAxisOrder<Axis extends string>(
  axes: ReadonlyArray<Axis>,
): fc.Arbitrary<Array<Axis>> {
  return fc.shuffledSubarray([...axes], {
    minLength: axes.length,
    maxLength: axes.length,
  })
}

const generatedTitle = fc.string({ maxLength: generatedTitleMaxLength })

type SourceFifoOrderingHistory = {
  relations: Array<`same-key` | `disjoint`>
  titles: [string, string]
}

type AbortGraphHistory = {
  relationships: Array<`independent` | `same-key`>
  titles: [string, string]
}

type OwnerIsolationHistory = {
  operations: Array<`write` | `commit` | `truncate`>
  queuedTitle: string
}

type OpenTransactionBoundaryHistory = {
  boundaries: Array<`abort` | `cleanup` | `terminal-failure`>
  hydratedTitle: string
}

type RequestLocalFailureHistory = {
  operations: Array<RequestLocalFailureOperation>
  titles: [string, string]
}

const sourceFifoOrderingHistory: fc.Arbitrary<SourceFifoOrderingHistory> =
  fc.record({
    relations: fullAxisOrder(sourceFifoOrderingAxes),
    titles: fc.tuple(generatedTitle, generatedTitle),
  })

const abortGraphHistory: fc.Arbitrary<AbortGraphHistory> = fc.record({
  relationships: fullAxisOrder(abortGraphAxes),
  titles: fc.tuple(generatedTitle, generatedTitle),
})

const ownerIsolationHistory: fc.Arbitrary<OwnerIsolationHistory> = fc.record({
  operations: fullAxisOrder(ownerIsolationAxes),
  queuedTitle: generatedTitle,
})

const openTransactionBoundaryHistory: fc.Arbitrary<OpenTransactionBoundaryHistory> =
  fc.record({
    boundaries: fullAxisOrder(openTransactionBoundaryAxes),
    hydratedTitle: generatedTitle,
  })

const requestLocalFailureHistory: fc.Arbitrary<RequestLocalFailureHistory> =
  fc.record({
    operations: fullAxisOrder(requestLocalFailureAxes),
    titles: fc.tuple(generatedTitle, generatedTitle),
  })

function generatedPersistenceGrammarSamples(): ReadonlyArray<{
  grammar: GeneratedPersistenceGrammar
  histories: Array<GeneratedPersistenceHistory>
}> {
  const grammar = (property: string): GeneratedPersistenceGrammar => {
    const match = generatedPersistenceGrammars.find(
      (candidate) => candidate.property === property,
    )
    if (match === undefined) throw new Error(`missing grammar: ${property}`)
    return match
  }
  const sampleOptions = (seed: number) => ({ seed, numRuns: 4 })
  return [
    {
      grammar: grammar(`sqlite-persistence.source-fifo-order`),
      histories: fc
        .sample(
          sourceFifoOrderingHistory,
          sampleOptions(generatedPersistenceFixedSeeds.sourceFifoOrdering),
        )
        .map((history) => ({
          axes: history.relations,
          titles: [...history.titles],
        })),
    },
    {
      grammar: grammar(`sqlite-persistence.abort-graph`),
      histories: fc
        .sample(
          abortGraphHistory,
          sampleOptions(generatedPersistenceFixedSeeds.abortGraph),
        )
        .map((history) => ({
          axes: history.relationships,
          titles: [...history.titles],
        })),
    },
    {
      grammar: grammar(`sqlite-persistence.owner-isolation`),
      histories: fc
        .sample(
          ownerIsolationHistory,
          sampleOptions(generatedPersistenceFixedSeeds.ownerIsolation),
        )
        .map((history) => ({
          axes: history.operations,
          titles: [history.queuedTitle],
        })),
    },
    {
      grammar: grammar(`sqlite-persistence.open-transaction-boundary`),
      histories: fc
        .sample(
          openTransactionBoundaryHistory,
          sampleOptions(generatedPersistenceFixedSeeds.openTransactionBoundary),
        )
        .map((history) => ({
          axes: history.boundaries,
          titles: [history.hydratedTitle],
        })),
    },
    {
      grammar: grammar(
        `sqlite-persistence.request-local-failure-buffered-source`,
      ),
      histories: fc
        .sample(
          requestLocalFailureHistory,
          sampleOptions(generatedPersistenceFixedSeeds.requestLocalFailure),
        )
        .map((history) => ({
          axes: history.operations,
          titles: [...history.titles],
        })),
    },
  ]
}

async function runGeneratedSourceFifoOrderingHistory(
  history: SourceFifoOrderingHistory,
): Promise<void> {
  for (const relation of history.relations) {
    await runSourceFifoOrderingLaw(
      relation,
      history.titles[0],
      history.titles[1],
    )
  }
}

async function runGeneratedAbortGraphHistory(
  history: AbortGraphHistory,
): Promise<void> {
  for (const relationship of history.relationships) {
    await runAbortRelationshipLaw(
      relationship,
      history.titles[0],
      history.titles[1],
    )
  }
}

async function runGeneratedOwnerIsolationHistory(
  history: OwnerIsolationHistory,
): Promise<void> {
  for (const operation of history.operations) {
    await runBareOwnerOperationLaw(operation, history.queuedTitle)
  }
}

async function runGeneratedOpenTransactionBoundaryHistory(
  history: OpenTransactionBoundaryHistory,
): Promise<void> {
  for (const boundary of history.boundaries) {
    await runInternalOpenTransactionBoundaryLaw(boundary, history.hydratedTitle)
  }
}

async function runGeneratedRequestLocalFailureHistory(
  history: RequestLocalFailureHistory,
): Promise<void> {
  for (const operation of history.operations) {
    await runRequestLocalFailureOperationLaw(
      operation,
      history.titles[0],
      history.titles[1],
    )
  }
}

function registerGeneratedPersistenceProperty<Value>(options: {
  property: string
  title: string
  arbitrary: fc.Arbitrary<Value>
  fixedSeed: number
  run: (value: Value) => Promise<void>
}): void {
  const { property, title, arbitrary, fixedSeed, run } = options
  if (requestedOracleReplayProperty === undefined) {
    fcTest.prop([arbitrary], { seed: fixedSeed, numRuns: oracleRuns(4) })(
      `${title} (fixed)`,
      run,
    )
    fcTest.prop([arbitrary], oraclePropertyOptions(4, property))(
      `${title} (random)`,
      run,
    )
  } else if (requestedOracleReplayProperty === property) {
    fcTest.prop([arbitrary], oraclePropertyOptions(4, property))(
      `${title} (replay)`,
      run,
    )
  }
}

describe(`generated persistence durability oracles`, () => {
  if (requestedOracleReplayProperty === undefined) {
    it(`reconstructs the full grammar and rejects ablated, out-of-range, and foreign histories`, () => {
      for (const {
        grammar,
        histories,
      } of generatedPersistenceGrammarSamples()) {
        for (const history of histories) {
          expect(
            reconstructGeneratedPersistenceHistory(grammar, history),
          ).toEqual(history)
        }
      }

      for (const grammar of generatedPersistenceGrammars) {
        expect(Object.keys(grammar.axisContribution).sort()).toEqual(
          [...grammar.axes].sort(),
        )
        for (const contribution of Object.values(grammar.axisContribution)) {
          expect(contribution).not.toBe(``)
        }
        expect(
          reconstructGeneratedPersistenceHistory(grammar, grammar.witness),
        ).toEqual(grammar.witness)

        for (const omittedAxis of grammar.axes) {
          expect(() =>
            reconstructGeneratedPersistenceHistory(grammar, {
              ...grammar.witness,
              axes: grammar.witness.axes.filter((axis) => axis !== omittedAxis),
            }),
          ).toThrow(`invalid generated persistence history`)
        }

        expect(
          reconstructGeneratedPersistenceHistory(grammar, {
            axes: [...grammar.axes],
            titles: Array.from({ length: grammar.titleCount }, () =>
              `x`.repeat(generatedTitleMaxLength),
            ),
          }).titles,
        ).toEqual(
          Array.from({ length: grammar.titleCount }, () =>
            `x`.repeat(generatedTitleMaxLength),
          ),
        )
        expect(
          reconstructGeneratedPersistenceHistory(grammar, {
            axes: [...grammar.axes],
            titles: Array.from({ length: grammar.titleCount }, () => ``),
          }).titles,
        ).toEqual(Array.from({ length: grammar.titleCount }, () => ``))
        expect(() =>
          reconstructGeneratedPersistenceHistory(grammar, {
            axes: [...grammar.axes],
            titles: [
              `x`.repeat(generatedTitleMaxLength + 1),
              ...Array.from(
                { length: Math.max(0, grammar.titleCount - 1) },
                () => ``,
              ),
            ],
          }),
        ).toThrow(`invalid generated persistence history`)
        expect(() =>
          reconstructGeneratedPersistenceHistory(grammar, {
            ...grammar.witness,
            axes: grammar.axes.map((axis, index) =>
              index === grammar.axes.length - 1 ? grammar.axes[0]! : axis,
            ),
          }),
        ).toThrow(`invalid generated persistence history`)
        expect(() =>
          reconstructGeneratedPersistenceHistory(grammar, {
            ...grammar.witness,
            axes: [...grammar.axes.slice(0, -1), `foreign-axis`],
          }),
        ).toThrow(`invalid generated persistence history`)
      }
    })

    it.each([
      {
        name: `source-fifo-order older same-key value wins`,
        reject: () =>
          expectSourceFifoOrderingObservation(
            {
              publicRows: [{ id: `shared`, title: `older` }],
              durableRows: [{ id: `shared`, title: `older` }],
              status: `ready`,
              pendingMarkers: 0,
            },
            [{ id: `shared`, title: `newer` }],
          ),
      },
      {
        name: `abort-graph independent sibling inherits the abort`,
        reject: () =>
          expectAbortGraphObservation(
            {
              predecessorStatus: `rejected`,
              predecessorName: `AbortError`,
              successorStatus: `rejected`,
              sameFailure: true,
              status: `error`,
              publicSuccessor: undefined,
              durableSuccessor: undefined,
              pendingMarkers: 0,
            },
            `independent`,
            `survivor`,
            `must survive`,
          ),
      },
      {
        name: `owner-isolation bare write steals and publishes a queued marker`,
        reject: () =>
          expectOwnerIsolationAdmission({
            exactError: false,
            strayVisible: true,
          }),
      },
      {
        name: `open-transaction boundary leaks one core marker`,
        reject: () =>
          expectOpenTransactionBoundaryObservation(
            { status: `error`, pendingMarkers: 1 },
            `terminal-failure`,
          ),
      },
      {
        name: `request-local partial update drops the unseen baseline field`,
        reject: () =>
          expectRequestLocalFailureObservation(
            {
              receiptStatus: `fulfilled`,
              publicRows: [{ id: `shared`, title: `source` }],
              durableRows: [
                {
                  id: `shared`,
                  title: `source`,
                  detail: `required baseline detail`,
                },
              ],
              status: `ready`,
              publicError: undefined,
            },
            [
              {
                id: `shared`,
                title: `source`,
                detail: `required baseline detail`,
              },
            ],
          ),
      },
    ])(`rejects named wrong answer: $name`, ({ reject }) => {
      expect(reject).toThrow()
    })
  }

  registerGeneratedPersistenceProperty({
    property: `sqlite-persistence.source-fifo-order`,
    title: `serialized histories preserve source order and settle every receipt`,
    arbitrary: sourceFifoOrderingHistory,
    fixedSeed: generatedPersistenceFixedSeeds.sourceFifoOrdering,
    run: runGeneratedSourceFifoOrderingHistory,
  })
  registerGeneratedPersistenceProperty({
    property: `sqlite-persistence.abort-graph`,
    title: `abort graphs preserve independent siblings and reject dependent suffixes`,
    arbitrary: abortGraphHistory,
    fixedSeed: generatedPersistenceFixedSeeds.abortGraph,
    run: runGeneratedAbortGraphHistory,
  })
  registerGeneratedPersistenceProperty({
    property: `sqlite-persistence.owner-isolation`,
    title: `bare operations cannot capture another owner's transaction`,
    arbitrary: ownerIsolationHistory,
    fixedSeed: generatedPersistenceFixedSeeds.ownerIsolation,
    run: runGeneratedOwnerIsolationHistory,
  })
  registerGeneratedPersistenceProperty({
    property: `sqlite-persistence.open-transaction-boundary`,
    title: `open transaction boundaries leave no core marker`,
    arbitrary: openTransactionBoundaryHistory,
    fixedSeed: generatedPersistenceFixedSeeds.openTransactionBoundary,
    run: runGeneratedOpenTransactionBoundaryHistory,
  })
  registerGeneratedPersistenceProperty({
    property: `sqlite-persistence.request-local-failure-buffered-source`,
    title: `request-local load failure preserves buffered source semantics`,
    arbitrary: requestLocalFailureHistory,
    fixedSeed: generatedPersistenceFixedSeeds.requestLocalFailure,
    run: runGeneratedRequestLocalFailureHistory,
  })
})

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
    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `${id}-failed-full-reload`,
      latestRowVersion: 1,
      requiresFullReload: true,
      changedRows: [],
      deletedKeys: [],
    })
    await vi.waitFor(() =>
      expect(collection._lifecycle.getSyncError()).toBe(hydrationError),
    )
    terminalError = hydrationError
  } else {
    const adapterError = Object.assign(new Error(`${id} storage failure`), {
      code: `SQLITE_FULL`,
      path: `adapter.applyCommittedTx`,
    })
    coordinator.requestApplyCommittedTx = () =>
      Promise.reject(
        new PersistedCollectionDurabilityError(
          `Failed to durably persist collection "${id}"`,
          {
            cause: adapterError,
            code: adapterError.code,
            path: adapterError.path,
          },
        ),
      )
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
    expect(terminalError).toBeInstanceOf(PersistedCollectionDurabilityError)
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

describeUnlessOracleReplay(`persistedCollectionOptions`, () => {
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
      await insert.isPersisted.promise
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

  it.todo(
    `loads active subsets and collection metadata from one atomic full-reload generation`,
  )

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

  it(`coalesces duplicate single-process subset acknowledgements until owner work finishes`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-coalesced`)
    let releaseLoad = (): void => {}
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    const owner = Object.assign(
      vi.fn(() => loadGate),
      { unloadSubset: vi.fn(), onError: vi.fn() },
    )
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const options: LoadSubsetOptions = { limit: 1 }

    try {
      let firstSettled = false
      let duplicateSettled = false
      const first = coordinator
        .requestEnsureRemoteSubset(`todos`, options)
        .then(() => {
          firstSettled = true
        })
      await Promise.resolve()
      const duplicate = coordinator
        .requestEnsureRemoteSubset(`todos`, options)
        .then(() => {
          duplicateSettled = true
        })
      await Promise.resolve()

      expect({
        ownerCalls: owner.mock.calls.length,
        firstSettled,
        duplicateSettled,
      }).toEqual({
        ownerCalls: 1,
        firstSettled: false,
        duplicateSettled: false,
      })

      releaseLoad()
      await Promise.all([first, duplicate])
    } finally {
      releaseLoad()
      unregisterOwner()
    }
  })

  it(`preserves process-local subset lifecycle fields for owner load and unload`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-live-fields`)
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const signal = new AbortController().signal
    const subscription = {
      on: () => () => {},
    } as unknown as Subscription
    const options: LoadSubsetOptions = { limit: 1, signal, subscription }

    try {
      await coordinator.requestEnsureRemoteSubset(`todos`, options)
      expect(owner).toHaveBeenCalledTimes(1)
      const delivered = owner.mock.calls[0]![0] as LoadSubsetOptions
      expect(delivered).toMatchObject({ limit: 1 })
      expect(delivered.signal).toBe(signal)
      expect(delivered.subscription).toBe(subscription)

      await coordinator.requestReleaseRemoteSubset(`todos`, options)
      expect(owner.unloadSubset).toHaveBeenCalledTimes(1)
      expect(owner.unloadSubset).toHaveBeenCalledWith(delivered)
    } finally {
      unregisterOwner()
    }
  })

  it(`coalesces same-stack single-process subset reentry until owner work finishes`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-reentrant`)
    let releaseLoad = (): void => {}
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    const options: LoadSubsetOptions = { limit: 1 }
    let duplicate: Promise<void> | undefined
    let didReenter = false
    const owner = Object.assign(
      vi.fn(() => {
        if (!didReenter) {
          didReenter = true
          duplicate = coordinator.requestEnsureRemoteSubset(`todos`, options)
        }
        return loadGate
      }),
      { unloadSubset: vi.fn(), onError: vi.fn() },
    )
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )

    try {
      let firstSettled = false
      let duplicateSettled = false
      const first = coordinator
        .requestEnsureRemoteSubset(`todos`, options)
        .then(() => {
          firstSettled = true
        })
      await Promise.resolve()
      const duplicateResult = duplicate!.then(() => {
        duplicateSettled = true
      })
      await Promise.resolve()

      expect({
        ownerCalls: owner.mock.calls.length,
        firstSettled,
        duplicateSettled,
      }).toEqual({
        ownerCalls: 1,
        firstSettled: false,
        duplicateSettled: false,
      })

      releaseLoad()
      await Promise.all([first, duplicateResult])
    } finally {
      releaseLoad()
      unregisterOwner()
    }
  })

  it(`waits for a pending single-process subset load before unloading it`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-release-order`)
    let releaseLoad = (): void => {}
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    const events: Array<string> = []
    const owner = Object.assign(
      vi.fn(async () => {
        events.push(`load-start`)
        await loadGate
        events.push(`load-finish`)
      }),
      {
        unloadSubset: vi.fn(() => {
          events.push(`unload`)
        }),
        onError: vi.fn(),
      },
    )
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const options: LoadSubsetOptions = { limit: 1 }

    try {
      const load = coordinator.requestEnsureRemoteSubset(`todos`, options)
      await Promise.resolve()
      let releaseSettled = false
      const release = coordinator
        .requestReleaseRemoteSubset(`todos`, options)
        .then(() => {
          releaseSettled = true
        })
      await Promise.resolve()

      const beforeLoadRelease = { events: [...events], releaseSettled }
      expect(beforeLoadRelease).toEqual({
        events: [`load-start`],
        releaseSettled: false,
      })

      releaseLoad()
      await Promise.all([load, release])
      expect(events).toEqual([`load-start`, `load-finish`, `unload`])
    } finally {
      releaseLoad()
      unregisterOwner()
    }
  })

  it(`rejects unsupported single-process subset values before owner work`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-wire-domain`)
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )

    try {
      await expect(
        coordinator.requestEnsureRemoteSubset(`todos`, {
          where: new IR.Func(`in`, [
            new IR.PropRef([`todos`, `status`]),
            new IR.Value([`kept`, () => {}]),
          ]),
        }),
      ).rejects.toMatchObject({
        name: `RemoteSubsetWireValueError`,
        path: `options.where.args[1].value[1]`,
      })
      expect(owner).not.toHaveBeenCalled()
    } finally {
      unregisterOwner()
    }
  })

  it(`rejects a sparse function argument at its exact expression path`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-wire-hole`)
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const args = [new IR.PropRef([`todos`, `status`])]
    args.length = 2

    try {
      await expect(
        coordinator.requestEnsureRemoteSubset(`todos`, {
          where: new IR.Func(`eq`, args),
        }),
      ).rejects.toMatchObject({
        name: `RemoteSubsetWireValueError`,
        path: `options.where.args[1]`,
      })
      expect(owner).not.toHaveBeenCalled()
    } finally {
      unregisterOwner()
    }
  })

  it(`preserves an explicit source alias through remote subset projection`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-wire-alias`)
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const options: LoadSubsetOptions = {
      where: new IR.Func(`eq`, [
        new IR.PropRef([`todos`, `status`], `todos`),
        new IR.Value(`kept`),
      ]),
    }

    try {
      await coordinator.requestEnsureRemoteSubset(`todos`, options)
      expect(owner).toHaveBeenCalledWith({
        where: {
          type: `func`,
          name: `eq`,
          args: [
            { type: `ref`, path: [`todos`, `status`], sourceAlias: `todos` },
            { type: `val`, value: `kept` },
          ],
        },
      })
    } finally {
      await coordinator.requestReleaseRemoteSubset(`todos`, options)
      unregisterOwner()
    }
  })

  it(`rejects a remote subset source alias that disagrees with its path`, () => {
    expect(() =>
      toTransportedLoadSubsetOptions({
        where: new IR.Func(`eq`, [
          new IR.PropRef([`todos`, `status`], `other`),
          new IR.Value(`kept`),
        ]),
      }),
    ).toThrowError(/options\.where\.args\[0\]\.sourceAlias/)
  })

  it(`projects lexical comparison options without locale-only wire fields`, () => {
    const projected = toTransportedLoadSubsetOptions({
      orderBy: [
        {
          expression: new IR.PropRef([`todos`, `title`]),
          compareOptions: {
            direction: `asc`,
            nulls: `last`,
            stringSort: `lexical`,
            locale: `en`,
            localeOptions: { sensitivity: `base` },
          },
        },
      ],
    } as unknown as LoadSubsetOptions)

    expect(projected.orderBy?.[0]?.compareOptions).toEqual({
      direction: `asc`,
      nulls: `last`,
      stringSort: `lexical`,
    })
  })

  it(`preserves locale comparison fields when the optional sort mode is omitted`, () => {
    const projected = toTransportedLoadSubsetOptions({
      orderBy: [
        {
          expression: new IR.PropRef([`todos`, `title`]),
          compareOptions: {
            direction: `asc`,
            nulls: `last`,
            locale: `en`,
            localeOptions: { sensitivity: `base` },
          },
        },
      ],
    } as LoadSubsetOptions)

    expect(projected.orderBy?.[0]?.compareOptions).toEqual({
      direction: `asc`,
      nulls: `last`,
      locale: `en`,
      localeOptions: { sensitivity: `base` },
    })
  })

  it.each([
    [`limit`, { limit: Number.NaN }, `options.limit`],
    [`limit`, { limit: Number.POSITIVE_INFINITY }, `options.limit`],
    [`limit`, { limit: -1 }, `options.limit`],
    [`limit`, { limit: 0.5 }, `options.limit`],
    [`limit`, { limit: Number.MAX_SAFE_INTEGER + 1 }, `options.limit`],
    [`offset`, { offset: Number.NaN }, `options.offset`],
    [`offset`, { offset: Number.NEGATIVE_INFINITY }, `options.offset`],
    [`offset`, { offset: -1 }, `options.offset`],
    [`offset`, { offset: 0.5 }, `options.offset`],
    [`offset`, { offset: Number.MAX_SAFE_INTEGER + 1 }, `options.offset`],
  ] as const)(
    `rejects an invalid transported subset %s before owner work`,
    (_field, options, path) => {
      let error: unknown
      try {
        toTransportedLoadSubsetOptions(options)
      } catch (caught) {
        error = caught
      }
      expect(error).toMatchObject({
        name: `RemoteSubsetWireValueError`,
        path,
      })
    },
  )

  it(`preserves valid transported subset window boundaries`, () => {
    expect(
      toTransportedLoadSubsetOptions({
        limit: 0,
        offset: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual({ limit: 0, offset: Number.MAX_SAFE_INTEGER })
  })

  it(`reports and rethrows a single-process owner unload rejection`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-unload-error`)
    const unloadError = new Error(`single-process owner unload failed`)
    const ownerErrors: Array<unknown> = []
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(() =>
        Promise.reject(unloadError),
      ) as unknown as RemoteSubsetOwner[`unloadSubset`],
      onError: (error: unknown) => ownerErrors.push(error),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const options: LoadSubsetOptions = { limit: 1 }

    try {
      await coordinator.requestEnsureRemoteSubset(`todos`, options)
      await expect(
        coordinator.requestReleaseRemoteSubset(`todos`, options),
      ).rejects.toBe(unloadError)
      expect(ownerErrors).toEqual([unloadError])
    } finally {
      unregisterOwner()
    }
  })

  it(`reports one fail-stop lifecycle error when a single-process async unload rejects`, async () => {
    const unloadError = new Error(`remote owner unload failed`)
    let unloadThenCalls = 0
    const rejectingThenable = {
      then: (
        _resolve: (value?: void) => void,
        reject: (error: unknown) => void,
      ) => {
        unloadThenCalls++
        queueMicrotask(() => reject(unloadError))
      },
    }
    const sourceUnloadMock = vi.fn((options: LoadSubsetOptions) =>
      options.limit === 1 ? rejectingThenable : undefined,
    )
    const sourceUnload = sourceUnloadMock as unknown as (
      options: LoadSubsetOptions,
    ) => void
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `owner-unload-error`,
        getKey: (todo) => todo.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => true,
              unloadSubset: sourceUnload,
            }
          },
        },
        persistence: {
          adapter: createRecordingAdapter(),
        },
      }),
    )
    const failing: LoadSubsetOptions = { limit: 1 }
    const sibling: LoadSubsetOptions = { limit: 2 }
    const markError = vi.spyOn(collection._lifecycle, `markError`)
    const unhandled: Array<unknown> = []
    const captureUnhandled = (error: unknown) => unhandled.push(error)
    process.on(`unhandledRejection`, captureUnhandled)

    try {
      collection.startSyncImmediate()
      await collection._sync.loadSubset(failing)
      await collection._sync.loadSubset(sibling)
      collection._sync.unloadSubset(failing)
      collection._sync.unloadSubset(sibling)
      await flushAsyncWork()
      await flushAsyncWork()

      expect({
        status: collection.status,
        error: collection._lifecycle.getSyncError(),
        unloadThenCalls,
        unloadOptions: sourceUnloadMock.mock.calls.map(([options]) => options),
        lifecycleErrors: markError.mock.calls.map(([error]) => error),
        unhandled,
      }).toEqual({
        status: `error`,
        error: unloadError,
        unloadThenCalls: 1,
        unloadOptions: [failing, sibling],
        lifecycleErrors: [unloadError],
        unhandled: [],
      })

      await flushAsyncWork()
      expect(sourceUnloadMock).toHaveBeenCalledTimes(2)
      expect(markError).toHaveBeenCalledTimes(1)
    } finally {
      process.off(`unhandledRejection`, captureUnhandled)
      await collection.cleanup()
    }
  })

  it(`surfaces duplicate remote-subset owner registration through the collection lifecycle`, async () => {
    const coordinator = new SingleProcessCoordinator()
    const unhandled: Array<unknown> = []
    const sourceLoads: Array<string> = []
    const onUnhandled = (error: unknown) => unhandled.push(error)
    process.on(`unhandledRejection`, onUnhandled)
    const create = (label: string) =>
      createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `duplicate-owner-lifecycle`,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return {
                loadSubset: () => {
                  sourceLoads.push(label)
                  return true
                },
                unloadSubset: () => {},
              }
            },
          },
          persistence: { adapter: createRecordingAdapter(), coordinator },
        }),
      )
    const first = create(`first`)
    let duplicate: ReturnType<typeof create> | undefined

    try {
      first.startSyncImmediate()
      await first.stateWhenReady()
      await vi.waitFor(() =>
        expect(
          (
            coordinator as unknown as {
              remoteSubsetOwners: Map<string, RemoteSubsetOwner>
            }
          ).remoteSubsetOwners.size,
        ).toBe(1),
      )
      duplicate = create(`duplicate`)
      duplicate.startSyncImmediate()
      const readinessError = await duplicate.stateWhenReady().then(
        () => undefined,
        (error: unknown) => error,
      )
      await flushAsyncWork()

      expect(readinessError).toMatchObject({
        name: `DuplicateRemoteSubsetOwnerError`,
        collectionId: `duplicate-owner-lifecycle`,
      })
      expect(duplicate.status).toBe(`error`)
      expect(sourceLoads).toEqual([])
      expect(unhandled).toEqual([])
    } finally {
      process.off(`unhandledRejection`, onUnhandled)
      await duplicate?.cleanup()
      await first.cleanup()
    }
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

  it(`rejects an incomplete coordinator before starting a rich sync source`, async () => {
    type SourceParams = Parameters<SyncConfig<Todo, string>[`sync`]>[0]

    const adapter = createRecordingAdapter()
    const applyCommittedTx = adapter.applyCommittedTx
    let adapterApplies = 0
    adapter.applyCommittedTx = (...args) => {
      adapterApplies++
      return applyCommittedTx(...args)
    }
    let sourceCalls = 0
    let legacyCalls = 0
    let sourceParams: SourceParams | undefined
    let collectionConstructed = false
    let visible = false
    let configurationError: { name: string; message: string } | null = null
    let collection: Collection<Todo, string> | undefined

    const incompleteCoordinator = {
      getNodeId: () => `incomplete-rich-sync`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => false,
      ensureLeadership: () => Promise.resolve(),
      requestEnsurePersistedIndex: () => Promise.resolve(),
      // Remote subset routing is complete so this fixture isolates the
      // required committed-transaction method named by the assertion.
      requestEnsureRemoteSubset: () => Promise.resolve(),
      requestReleaseRemoteSubset: () => Promise.resolve(),
      registerRemoteSubsetOwner: () => () => {},
      requestApplyLocalMutations: () => {
        legacyCalls++
        return Promise.resolve({
          type: `rpc:applyLocalMutations:res` as const,
          rpcId: `legacy`,
          ok: true as const,
          term: 1,
          seq: 1,
          latestRowVersion: 1,
          acceptedMutationIds: [],
        })
      },
    } as unknown as PersistedCollectionCoordinator

    try {
      try {
        const options = persistedCollectionOptions<Todo, string>({
          id: `incomplete-rich-sync`,
          getKey: (todo) => todo.id,
          sync: {
            sync: (params) => {
              sourceCalls++
              sourceParams = params
              params.markReady()
            },
          },
          persistence: { adapter, coordinator: incompleteCoordinator },
        })
        collection = createCollection(options)
        collectionConstructed = true
      } catch (error) {
        const resolvedError =
          error instanceof Error ? error : new Error(String(error))
        configurationError = {
          name: resolvedError.name,
          message: resolvedError.message,
        }
      }

      if (collection) {
        collection.startSyncImmediate()
        await vi.waitFor(() => expect(sourceParams).toBeDefined())
        sourceParams!.begin()
        sourceParams!.metadata?.collection.set(`resume`, { offset: 7 })
        sourceParams!.truncate()
        sourceParams!.write({
          type: `insert`,
          value: { id: `rich`, title: `Visible before rejection` },
          metadata: { source: `remote` },
        })
        await Promise.resolve(sourceParams!.commit()).catch(() => undefined)
        visible = collection.has(`rich`)
      }
    } finally {
      await collection?.cleanup()
    }

    expect({
      configurationError,
      sourceCalls,
      collectionConstructed,
      visible,
      adapterApplies,
      legacyCalls,
    }).toEqual({
      configurationError: {
        name: `InvalidPersistedCollectionCoordinatorError`,
        message:
          'Invalid persisted collection coordinator: missing required "requestApplyCommittedTx" method',
      },
      sourceCalls: 0,
      collectionConstructed: false,
      visible: false,
      adapterApplies: 0,
      legacyCalls: 0,
    })
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
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
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
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
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

  it(`does not deliver coordinator work accepted before lifecycle replacement into the new owner`, async () => {
    const id = `queued-coordinator-lifecycle`
    const adapter = createRecordingAdapter()
    const oldReloadEntered = createEventGate()
    const releaseOldReload = createEventGate()
    const replacementHydrationEntered = createEventGate()
    const releaseReplacementHydration = createEventGate()
    let baselineCalls = 0
    overrideBaselineRows(adapter, async () => {
      baselineCalls++
      if (baselineCalls === 2) {
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
    })
    let subsetCalls = 0
    adapter.loadSubset = async () => {
      subsetCalls++
      if (subsetCalls === 1) {
        oldReloadEntered.resolve()
        await releaseOldReload.promise
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
        baselineCalls,
        subsetCalls,
        staleVisible: collection.get(`stale`),
        staleDurable: adapter.rows.get(`stale`),
        replacementPublicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        sourceRuns: 2,
        baselineCalls: 2,
        subsetCalls: 1,
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
      if (subsetCalls === 1) {
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
        subsetCalls: 1,
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
    let baselineCalls = 0
    overrideBaselineRows(adapter, async () => {
      baselineCalls++
      if (baselineCalls === 2) {
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
    })
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
        baselineCalls,
        staleVisible: collection.get(`stale`),
        staleDurable: adapter.rows.get(`stale`),
        replacementPublicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        sourceRuns: 2,
        baselineCalls: 2,
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
    let baselineCalls = 0
    const adapter = createRecordingAdapter()
    overrideBaselineRows(adapter, async () => {
      baselineCalls++
      if (baselineCalls === 2) {
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
    })
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
              persistence: params.metadata!.persistence,
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
    let baselineCalls = 0
    overrideBaselineRows(adapter, async () => {
      baselineCalls++
      if (baselineCalls === 2) {
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
    })
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
        baselineCalls,
        staleVisible: collection.get(oldRow.id),
        staleDurable: adapter.rows.get(oldRow.id),
        replacementPublicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        baselineCalls: 2,
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
    let baselineCalls = 0
    overrideBaselineRows(adapter, async () => {
      baselineCalls++
      if (baselineCalls === 1) {
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
    })
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
        baselineCalls,
        replacementIsReady: collection.isReady(),
        replacementVisible: collection.get(`replacement`),
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        baselineCalls: 2,
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

  it.each([`fulfill`, `reject`] as const)(
    `keeps retired loopback startup inert after cleanup: %s`,
    async (outcome) => {
      const adapter = createRecordingAdapter()
      const hydrationEntered = createEventGate()
      const hydrationGate = createEventGate()
      const startupError = new Error(`retired loopback startup failed`)
      const restoreBaselineRows = overrideBaselineRows(adapter, async () => {
        hydrationEntered.resolve()
        await hydrationGate.promise
        if (outcome === `reject`) throw startupError
        return []
      })
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `retired-loopback-startup-${outcome}`,
          getKey: (row) => row.id,
          persistence: { adapter },
        }),
      )
      const readiness = collection.stateWhenReady().then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      const warnings = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const unhandled: Array<unknown> = []
      const captureUnhandled = (error: unknown) => unhandled.push(error)
      process.on(`unhandledRejection`, captureUnhandled)
      const peer = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `retired-loopback-peer-${outcome}`,
          getKey: (row) => row.id,
          persistence: { adapter: createRecordingAdapter() },
        }),
      )
      let hasPrimaryFailure = false

      try {
        await atPersistedOracleCheckpoint(
          hydrationEntered.promise,
          `retired loopback hydration entered`,
        )
        await collection.cleanup()
        const retiredStatus = collection.status

        hydrationGate.resolve()
        await flushAsyncWork()
        await flushAsyncWork()
        const readinessOutcome = await readiness
        await atPersistedOracleCheckpoint(
          peer.stateWhenReady(),
          `independent loopback peer ready`,
        )

        expect({
          retiredStatus,
          finalStatus: collection.status,
          readinessStatus: readinessOutcome.status,
          readinessErrorName:
            readinessOutcome.status === `rejected` &&
            readinessOutcome.reason instanceof Error
              ? readinessOutcome.reason.name
              : undefined,
          publicError: collection._lifecycle.getSyncError(),
          warnings: warnings.mock.calls,
          unhandled,
          peerStatus: peer.status,
        }).toEqual({
          retiredStatus: `cleaned-up`,
          finalStatus: `cleaned-up`,
          readinessStatus: `rejected`,
          readinessErrorName: `AbortError`,
          publicError: undefined,
          warnings: [],
          unhandled: [],
          peerStatus: `ready`,
        })

        // This hostile control bypasses the sync-run-owned callback. It proves
        // the status observation above would reject an unfenced late ready.
        expect(() => collection._lifecycle.markReady()).toThrowError(
          expect.objectContaining({ name: `CollectionStateError` }),
        )
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        restoreBaselineRows()
        hydrationGate.resolve()
        process.off(`unhandledRejection`, captureUnhandled)
        warnings.mockRestore()
        await cleanupPersistedOracle(
          [() => readiness, () => collection.cleanup(), () => peer.cleanup()],
          hasPrimaryFailure,
        )
      }
    },
  )

  it(`settles old source cleanup before hydrating a same-resource replacement`, async () => {
    const id = `same-resource-cleanup-settlement`
    const adapter = createRecordingAdapter()
    adapter.rows.set(`retired`, {
      id: `retired`,
      title: `must not survive old cleanup`,
    })
    const cleanupGate = createEventGate()
    let sourceCleanupSettled = false
    const create = (withCleanup: boolean) =>
      createCollection(
        persistedCollectionOptions<Todo, string>({
          id,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return withCleanup
                ? {
                    cleanup: () =>
                      cleanupGate.promise.then(() => {
                        adapter.rows.delete(`retired`)
                        sourceCleanupSettled = true
                      }),
                  }
                : undefined
            },
          },
          persistence: { adapter },
        }),
      )
    const oldCollection = create(true)
    let replacement: ReturnType<typeof create> | undefined
    let replacementReady: Promise<unknown> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        oldCollection.stateWhenReady(),
        `old same-resource owner ready`,
      )
      expect(stripVirtualProps(oldCollection.get(`retired`))).toEqual({
        id: `retired`,
        title: `must not survive old cleanup`,
      })

      const replacementStarted = oldCollection.cleanup().then(() => {
        replacement = create(false)
        replacementReady = replacement.stateWhenReady()
        return replacementReady
      })
      await flushAsyncWork()

      expect(sourceCleanupSettled).toBe(false)
      expect(replacement).toBeUndefined()

      cleanupGate.resolve()
      await atPersistedOracleCheckpoint(
        replacementStarted,
        `same-resource replacement ready after cleanup`,
      )

      expect(sourceCleanupSettled).toBe(true)
      expect(adapter.rows.has(`retired`)).toBe(false)
      expect(replacement?.get(`retired`)).toBeUndefined()
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      cleanupGate.resolve()
      await cleanupPersistedOracle(
        [
          () => replacementReady,
          () => oldCollection.cleanup(),
          () => replacement?.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it.each([`fulfill`, `reject`] as const)(
    `awaits cleanup returned after reentrant persisted source retirement: %s`,
    async (outcome) => {
      const adapter = createRecordingAdapter()
      const sourceEntered = createEventGate()
      const cleanupGate = createEventGate()
      const sourceError = new Error(`reentrant source cleanup failed`)
      let cleanupCalls = 0
      let cleanupFromReentry: Promise<void> | undefined
      let reenterCleanup = true
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `reentrant-persisted-source-cleanup-${outcome}`,
          getKey: (row) => row.id,
          sync: {
            sync: ({ collection: publicCollection, markReady }) => {
              if (!reenterCleanup) {
                markReady()
                return
              }
              reenterCleanup = false
              cleanupFromReentry = publicCollection.cleanup()
              sourceEntered.resolve()
              return {
                cleanup: () => {
                  cleanupCalls++
                  return cleanupGate.promise.then(() => {
                    if (outcome === `reject`) throw sourceError
                  })
                },
              }
            },
          },
          persistence: { adapter },
        }),
      )
      let cleanupSettled = false
      let hasPrimaryFailure = false

      try {
        collection.startSyncImmediate()
        await atPersistedOracleCheckpoint(
          sourceEntered.promise,
          `reentrant persisted source entered`,
        )
        if (!cleanupFromReentry) {
          throw new Error(`reentrant cleanup was not captured`)
        }
        void cleanupFromReentry.then(
          () => {
            cleanupSettled = true
          },
          () => {
            cleanupSettled = true
          },
        )
        await flushAsyncWork()

        expect({ cleanupCalls, cleanupSettled }).toEqual({
          cleanupCalls: 1,
          cleanupSettled: false,
        })

        cleanupGate.resolve()
        if (outcome === `reject`) {
          await expect(cleanupFromReentry).rejects.toMatchObject({
            name: `SyncCleanupError`,
            cause: sourceError,
          })
        } else {
          await expect(cleanupFromReentry).resolves.toBeUndefined()
        }
        expect(collection.status).toBe(`cleaned-up`)
        expect(cleanupCalls).toBe(1)
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        cleanupGate.resolve()
        await cleanupPersistedOracle(
          [
            () => cleanupFromReentry?.catch(() => undefined),
            () => collection.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  it(`does not register remote ownership returned by a retired source sync`, async () => {
    const id = `reentrant-retired-remote-owner`
    const adapter = createRecordingAdapter()
    const coordinator = new SingleProcessCoordinator()
    const sourceEntered = createEventGate()
    let cleanupFromReentry: Promise<void> | undefined
    let retiredSourceLoads = 0
    const oldCollection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
        getKey: (row) => row.id,
        sync: {
          sync: ({ collection: publicCollection }) => {
            cleanupFromReentry = publicCollection.cleanup()
            sourceEntered.resolve()
            return {
              loadSubset: () => {
                retiredSourceLoads++
                return true
              },
            }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let replacement: Collection<Todo, string> | undefined
    let replacementReady: Promise<unknown> | undefined
    let hasPrimaryFailure = false

    try {
      oldCollection.startSyncImmediate()
      await atPersistedOracleCheckpoint(
        sourceEntered.promise,
        `retired remote-owner source entered`,
      )
      if (!cleanupFromReentry) {
        throw new Error(`reentrant cleanup was not captured`)
      }
      await atPersistedOracleCheckpoint(
        cleanupFromReentry,
        `retired remote-owner cleanup settled`,
      )

      replacement = createCollection(
        persistedCollectionOptions<Todo, string>({
          id,
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
      replacementReady = replacement.stateWhenReady()
      await atPersistedOracleCheckpoint(
        replacementReady,
        `same-id replacement ready after retired source entry`,
      )

      expect({
        oldStatus: oldCollection.status,
        replacementStatus: replacement.status,
        retiredSourceLoads,
      }).toEqual({
        oldStatus: `cleaned-up`,
        replacementStatus: `ready`,
        retiredSourceLoads: 0,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      await cleanupPersistedOracle(
        [
          () => cleanupFromReentry,
          () => replacementReady,
          () => oldCollection.cleanup(),
          () => replacement?.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`settles every cleanup task after synchronous runtime teardown failures`, async () => {
    const id = `synchronous-runtime-cleanup-failure`
    const adapter = createRecordingAdapter()
    const coordinator = new SingleProcessCoordinator()
    const sourceCleanupGate = createEventGate()
    const firstRuntimeError = new Error(`coordinator unsubscribe failed`)
    const laterRuntimeError = new Error(`remote owner unsubscribe failed`)
    const cleanupEvents: Array<string> = []
    let subscriptionCount = 0
    let ownerCount = 0
    const subscribe = coordinator.subscribe.bind(coordinator)
    coordinator.subscribe = () => {
      const unsubscribe = subscribe()
      const fail = subscriptionCount++ === 0
      return () => {
        unsubscribe()
        cleanupEvents.push(`coordinator`)
        if (fail) throw firstRuntimeError
      }
    }
    const registerRemoteSubsetOwner =
      coordinator.registerRemoteSubsetOwner.bind(coordinator)
    coordinator.registerRemoteSubsetOwner = (collectionId, owner) => {
      const unregister = registerRemoteSubsetOwner(collectionId, owner)
      const fail = ownerCount++ === 0
      return () => {
        unregister()
        cleanupEvents.push(`remote-owner`)
        if (fail) throw laterRuntimeError
      }
    }
    let sourceCleanupCalls = 0
    const oldCollection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              cleanup: () => {
                sourceCleanupCalls++
                return sourceCleanupGate.promise
              },
              loadSubset: () => true,
            }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let replacement: Collection<Todo, string> | undefined
    let replacementReady: Promise<unknown> | undefined
    let cleanupSettled = false
    let cleanupOutcome:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; error: unknown }
        >
      | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        oldCollection.stateWhenReady(),
        `runtime-cleanup source ready`,
      )
      cleanupOutcome = oldCollection.cleanup().then(
        () => ({ status: `fulfilled` as const }),
        (error: unknown) => ({ status: `rejected` as const, error }),
      )
      void cleanupOutcome.then(() => {
        cleanupSettled = true
      })
      await flushAsyncWork()

      expect({ sourceCleanupCalls, cleanupSettled }).toEqual({
        sourceCleanupCalls: 1,
        cleanupSettled: false,
      })

      sourceCleanupGate.resolve()
      const outcome = await atPersistedOracleCheckpoint(
        cleanupOutcome,
        `runtime cleanup tasks settled`,
      )
      expect(outcome.status).toBe(`rejected`)
      if (outcome.status !== `rejected`) {
        throw new Error(`expected runtime cleanup to reject`)
      }
      expect(outcome.error).toMatchObject({ name: `SyncCleanupError` })
      const syncCleanupError = outcome.error as { cause?: unknown }
      expect(syncCleanupError.cause).toBeInstanceOf(AggregateError)
      const aggregate = syncCleanupError.cause as AggregateError
      expect(aggregate.cause).toBe(firstRuntimeError)
      expect(aggregate.errors).toEqual([firstRuntimeError, laterRuntimeError])
      expect(cleanupEvents).toEqual([`coordinator`, `remote-owner`])

      replacement = createCollection(
        persistedCollectionOptions<Todo, string>({
          id,
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
      replacementReady = replacement.stateWhenReady()
      await atPersistedOracleCheckpoint(
        replacementReady,
        `replacement ready after failed runtime cleanup`,
      )
      expect(replacement.status).toBe(`ready`)
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      sourceCleanupGate.resolve()
      await cleanupPersistedOracle(
        [
          () => cleanupOutcome,
          () => replacementReady,
          () => oldCollection.cleanup(),
          () => replacement?.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`preserves source and runtime failures when persisted cleanup has both`, async () => {
    const id = `source-and-runtime-cleanup-failures`
    const adapter = createRecordingAdapter()
    const coordinator = new SingleProcessCoordinator()
    const sourceCleanupGate = createEventGate()
    const sourceError = new Error(`source cleanup failed exactly`)
    const runtimeError = new Error(`runtime cleanup failed exactly`)
    let sourceCleanupCalls = 0
    let runtimeCleanupCalls = 0
    const subscribe = coordinator.subscribe.bind(coordinator)
    coordinator.subscribe = () => {
      const unsubscribe = subscribe()
      return () => {
        unsubscribe()
        runtimeCleanupCalls++
        throw runtimeError
      }
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              cleanup: () => {
                sourceCleanupCalls++
                return sourceCleanupGate.promise
              },
            }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let cleanupOutcome:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; error: unknown }
        >
      | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `dual-failure persisted collection ready`,
      )
      cleanupOutcome = collection.cleanup().then(
        () => ({ status: `fulfilled` as const }),
        (error: unknown) => ({ status: `rejected` as const, error }),
      )
      await flushAsyncWork()

      expect({ sourceCleanupCalls, runtimeCleanupCalls }).toEqual({
        sourceCleanupCalls: 1,
        runtimeCleanupCalls: 1,
      })

      sourceCleanupGate.reject(sourceError)
      const outcome = await atPersistedOracleCheckpoint(
        cleanupOutcome,
        `source and runtime cleanup failures settled`,
      )
      expect(outcome.status).toBe(`rejected`)
      if (outcome.status !== `rejected`) {
        throw new Error(`expected persisted cleanup to reject`)
      }
      expect(outcome.error).toMatchObject({ name: `SyncCleanupError` })
      const syncCleanupError = outcome.error as { cause?: unknown }
      expect(syncCleanupError.cause).toBeInstanceOf(AggregateError)
      const aggregate = syncCleanupError.cause as AggregateError
      expect(aggregate.cause).toBe(sourceError)
      expect(aggregate.errors).toEqual([sourceError, runtimeError])
      expect(collection.status).toBe(`cleaned-up`)
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      sourceCleanupGate.resolve()
      await cleanupPersistedOracle(
        [() => cleanupOutcome, () => collection.cleanup()],
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
    let baselineCalls = 0
    overrideBaselineRows(adapter, async () => {
      baselineCalls++
      if (baselineCalls === 1) {
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
    })
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
        baselineCalls,
        oldVisible: collection.get(`old`),
        replacementVisible: stripVirtualProps(collection.get(`replacement`)),
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        replacementStatus: `fulfilled`,
        baselineCalls: 2,
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
    let baselineCalls = 0
    let sourceRuns = 0
    overrideBaselineRows(adapter, async () => {
      baselineCalls++
      if (baselineCalls === 1) {
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
    })
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
            value: {
              id: `queued`,
              title: `belongs after replacement hydrate`,
            },
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
        baselineCalls,
        queuedVisible: collection.get(`queued`),
      }).toEqual({
        sourceRuns: 2,
        baselineCalls: 2,
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
        errorName: `PersistedCollectionDurabilityError`,
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
    const coordinator = createFailStopCoordinatorHarness(
      `terminal-pending-sibling`,
    )
    let applyCalls = 0
    coordinator.requestApplyCommittedTx = async (_collectionId, tx) => {
      applyCalls++
      if (applyCalls === 1) {
        firstPersistenceEntered.resolve()
        try {
          await firstPersistence.promise
        } catch (error) {
          throw new PersistedCollectionDurabilityError(
            `first pending persistence failed`,
            { cause: error },
          )
        }
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
        terminalName: `PersistedCollectionDurabilityError`,
        terminalCause: adapterError,
        secondStatus: `rejected`,
        secondExact: true,
        applyCalls: 1,
        firstVisible: {
          id: `a`,
          title: `first publishes before persistence`,
        },
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
        errorName: `PersistedCollectionDurabilityError`,
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
    const restoreBaselineRows = overrideBaselineRows(adapter, () =>
      Promise.reject(hydrationError),
    )
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

      restoreBaselineRows()
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

  it(`replays a hydration-buffered write before its named durability rejection`, async () => {
    const adapter = createRecordingAdapter()
    let releaseHydration: (() => void) | undefined
    adapter.loadResumeSnapshot = (_collectionId, options) => {
      const snapshot = {
        rows: [],
        keySet: { status: `consistent` as const },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }
      if (options?.includeRows === false) {
        return Promise.resolve(snapshot)
      }
      return new Promise((resolve) => {
        releaseHydration = () => resolve(snapshot)
      })
    }
    const persistenceError = Object.assign(
      new Error(`buffered persistence failed`),
      {
        code: `SQLITE_FULL`,
        path: `todos.sqlite`,
      },
    )
    let rejectPersistence: ((error: unknown) => void) | undefined
    adapter.applyCommittedTx = () =>
      new Promise<void>((_resolve, reject) => {
        rejectPersistence = reject
      })

    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `hydration-buffered-persistence-error`,
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
      void collection.stateWhenReady().catch(() => undefined)
      await vi.waitFor(() => {
        expect(releaseHydration).toBeTypeOf(`function`)
        expect(remoteCommit).toBeTypeOf(`function`)
      })
      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `buffered`, title: `Published before failure` },
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

      expect(collection.get(`buffered`)).toBeUndefined()
      expect(settled).toBe(false)
      releaseHydration!()
      await vi.waitFor(() => expect(rejectPersistence).toBeTypeOf(`function`))

      expect(stripVirtualProps(collection.get(`buffered`))).toEqual({
        id: `buffered`,
        title: `Published before failure`,
      })
      expect(settled).toBe(false)

      rejectPersistence!(persistenceError)
      const rejection = await receipt.then(
        () => undefined,
        (error: unknown) => error,
      )

      expect(rejection).not.toBe(persistenceError)
      expect(rejection).toMatchObject({
        name: `PersistedCollectionDurabilityError`,
        code: `SQLITE_FULL`,
        path: `todos.sqlite`,
        cause: persistenceError,
      })
      expect(collection.status).toBe(`error`)
      expect(collection._lifecycle.getSyncError()).toBe(rejection)
    } finally {
      releaseHydration?.()
      rejectPersistence?.(persistenceError)
      await collection.cleanup()
      warning.mockRestore()
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
    expect(adapter.loadResumeSnapshotCalls[0]?.collectionId).toBe(collection.id)
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

  it(`queues an immediate source write behind its owning hydration baseline`, async () => {
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
        id: `immediate-during-hydration`,
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
        `immediate hydration entered`,
      )
      sourceParams.begin({ immediate: true })
      sourceParams.write({
        type: `update`,
        value: { id: `shared`, title: `Newer immediate source value` },
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
      await atPersistedOracleCheckpoint(ready, `immediate hydration ready`)
      await atPersistedOracleCheckpoint(
        receipt,
        `immediate hydration source receipt`,
      )
      expect({
        publicRow: stripVirtualProps(collection.get(`shared`)),
        durableRow: adapter.rows.get(`shared`),
        status: collection.status,
      }).toEqual({
        publicRow: { id: `shared`, title: `Newer immediate source value` },
        durableRow: { id: `shared`, title: `Newer immediate source value` },
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
      const restoreBaselineRows = overrideBaselineRows(adapter, async () => {
        hydrationEntered.resolve()
        await hydration.promise
        return []
      })

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
        restoreBaselineRows()
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
    overrideBaselineRows(adapter, async () => {
      hydrationEntered.resolve()
      await hydration.promise
      return []
    })
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
    overrideBaselineRows(adapter, async () => {
      hydrationEntered.resolve()
      await hydration.promise
      return []
    })
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

  it.each([`startup`, `resume`, `reset`] as const)(
    `keeps the %s hydration ready after a buffered pre-application abort`,
    async (entry) => {
      const adapter = createRecordingAdapter()
      const hydrationEntered = createEventGate()
      const releaseHydration = createEventGate()
      const coordinator =
        entry === `reset` ? createCoordinatorHarness() : undefined
      if (coordinator) {
        coordinator.requestApplyCommittedTx = async (collectionId, tx) => {
          await adapter.applyCommittedTx(collectionId, tx)
          return {
            type: `rpc:applyCommittedTx:res`,
            rpcId: tx.txId,
            ok: true,
            term: tx.term,
            seq: tx.seq,
            latestRowVersion: tx.rowVersion,
          }
        }
      } else {
        overrideBaselineRows(adapter, async () => {
          hydrationEntered.resolve()
          await releaseHydration.promise
          return []
        })
      }
      let sourceParams!: TodoSyncParams
      let hydrateResumeBaseline: (() => Promise<void>) | undefined
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: coordinator ? `sync-present` : `buffered-abort-${entry}`,
          getKey: (row) => row.id,
          syncMode: entry === `resume` ? `on-demand` : `eager`,
          sync: {
            sync: (params) => {
              sourceParams = params
              hydrateResumeBaseline =
                params.metadata?.persistence?.hydrateBaseline
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      const aborted = new AbortController()
      let keyReads = 0
      let hydration: Promise<unknown> | undefined
      let abortedReceipt: Promise<void> | undefined
      let independentReceipt: Promise<void> | undefined
      let hasPrimaryFailure = false

      try {
        if (entry === `resume`) {
          collection.startSyncImmediate()
          await atPersistedOracleCheckpoint(
            collection.stateWhenReady(),
            `resume collection ready before baseline`,
          )
          expect(hydrateResumeBaseline).toBeTypeOf(`function`)
          hydration = hydrateResumeBaseline!()
        } else if (coordinator) {
          await atPersistedOracleCheckpoint(
            collection.stateWhenReady(),
            `reset collection ready before reload`,
          )
          const loadSubset = adapter.loadSubset.bind(adapter)
          adapter.loadSubset = async (...args) => {
            hydrationEntered.resolve()
            await releaseHydration.promise
            return loadSubset(...args)
          }
          coordinator.emit({
            type: `collection:reset`,
            schemaVersion: 1,
            resetEpoch: 1,
          })
          hydration = Promise.resolve()
        } else {
          hydration = collection.stateWhenReady()
        }
        void hydration.catch(() => undefined)
        await atPersistedOracleCheckpoint(
          hydrationEntered.promise,
          `${entry} hydration entered`,
        )

        sourceParams.begin()
        sourceParams.write({
          type: `insert`,
          value: { id: `prefix`, title: `staged before abort` },
        })
        sourceParams.write({
          type: `insert`,
          value: {
            get id() {
              keyReads++
              if (keyReads === 2) aborted.abort()
              return `aborting`
            },
            title: `cancel before core application`,
          },
        })
        abortedReceipt = Promise.resolve(
          sourceParams.commit(aborted.signal),
        ).then(() => undefined)
        void abortedReceipt.catch(() => undefined)

        sourceParams.begin()
        sourceParams.write({
          type: `insert`,
          value: { id: `independent`, title: `survives abort` },
        })
        independentReceipt = Promise.resolve(sourceParams.commit()).then(
          () => undefined,
        )
        void independentReceipt.catch(() => undefined)

        releaseHydration.resolve()
        const outcomes = await atPersistedOracleCheckpoint(
          Promise.allSettled([hydration, abortedReceipt, independentReceipt]),
          `${entry} buffered abort settled`,
        )
        const expected = foldDurabilityLedger([
          { type: `begin`, transactionId: `aborted` },
          {
            type: `write`,
            transactionId: `aborted`,
            row: { id: `prefix`, title: `staged before abort` },
          },
          { type: `abort`, transactionId: `aborted` },
          { type: `begin`, transactionId: `independent` },
          {
            type: `write`,
            transactionId: `independent`,
            row: { id: `independent`, title: `survives abort` },
          },
          { type: `commit`, transactionId: `independent` },
        ])

        expect(keyReads).toBeGreaterThanOrEqual(2)
        expect(outcomes.map((outcome) => outcome.status)).toEqual([
          `fulfilled`,
          `rejected`,
          `fulfilled`,
        ])
        if (outcomes[1].status === `rejected`) {
          expect(outcomes[1].reason).toBeInstanceOf(SyncTransactionAbortedError)
        }
        expect(collection.status).toBe(`ready`)
        expect(collection._lifecycle.getSyncError()).toBeUndefined()
        expect(collection.get(`prefix`)).toBeUndefined()
        expect(collection.get(`aborting`)).toBeUndefined()
        expect(stripVirtualProps(collection.get(`independent`))).toEqual(
          expected.committedRows.get(`independent`),
        )
        expect(adapter.rows).toEqual(expected.committedRows)
        expect(
          adapter.applyCommittedTxCalls.map(({ tx }) =>
            tx.mutations.map(({ key }) => key),
          ),
        ).toEqual([[`independent`]])
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        releaseHydration.resolve()
        aborted.abort()
        await cleanupPersistedOracle(
          [
            () => hydration?.catch(() => undefined),
            () => abortedReceipt?.catch(() => undefined),
            () => independentReceipt?.catch(() => undefined),
            () => collection.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

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

  it(`rejects immediate replay that would close a normal publication cycle`, async () => {
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
      const dependencyOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve(dependencyReceipt).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `immediate dependency rejected`,
      )
      expect(dependencyOutcome).toMatchObject({
        status: `rejected`,
        reason: { name: `InvalidPersistedCollectionConfigError` },
      })
      await expect(
        atPersistedOracleCheckpoint(
          localTransaction.isPersisted.promise,
          `user persistence rejects with unsupported reentry`,
        ),
      ).rejects.toMatchObject({ name: `InvalidPersistedCollectionConfigError` })
      await atPersistedOracleCheckpoint(
        normalReceipt,
        `parked predecessor applies after user rollback`,
      )
      expect({
        dependencyVisible: collection.has(`dependency`),
        dependencyDurable: adapter.rows.get(`dependency`),
        parkedDurable: adapter.rows.get(`parked`),
        status: collection.status,
      }).toEqual({
        dependencyVisible: false,
        dependencyDurable: undefined,
        parkedDurable: {
          id: `parked`,
          title: `waits for user persistence`,
        },
        status: `ready`,
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

  it(`queues reentrant immediate replay before its later normal sibling`, async () => {
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
    let immediateReceipt: Promise<void> | undefined
    let normalReceipt: Promise<void> | undefined
    let callbackCount = 0
    const publication = collection.subscribeChanges((changes) => {
      if (
        callbackCount === 0 &&
        changes.some((change) => change.key === `trigger`)
      ) {
        callbackCount++
        sourceParams.begin({ immediate: true })
        sourceParams.write({
          type: `update`,
          value: { id: `shared`, title: `earlier immediate` },
        })
        immediateReceipt = Promise.resolve(sourceParams.commit()).then(
          () => undefined,
        )
        void immediateReceipt.catch(() => undefined)

        sourceParams.begin()
        sourceParams.write({
          type: `update`,
          value: { id: `shared`, title: `later normal` },
        })
        normalReceipt = Promise.resolve(sourceParams.commit()).then(
          () => undefined,
        )
        void normalReceipt.catch(() => undefined)
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
      expect(immediateReceipt).toBeInstanceOf(Promise)
      expect(normalReceipt).toBeInstanceOf(Promise)
      await atPersistedOracleCheckpoint(
        immediateReceipt!,
        `core-publication immediate receipt`,
      )
      await atPersistedOracleCheckpoint(
        normalReceipt!,
        `core-publication normal receipt`,
      )

      expect({
        publicRow: stripVirtualProps(collection.get(`shared`)),
        durableRow: adapter.rows.get(`shared`),
        persistedTitles,
        status: collection.status,
      }).toEqual({
        publicRow: { id: `shared`, title: `later normal` },
        durableRow: { id: `shared`, title: `later normal` },
        persistedTitles: [`earlier immediate`, `later normal`],
        status: `ready`,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      publication.unsubscribe()
      await cleanupPersistedOracle(
        [
          () => immediateReceipt?.catch(() => undefined),
          () => normalReceipt?.catch(() => undefined),
          () => collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`publishes a FIFO source turn beneath an optimistic mutation before demand reentry`, async () => {
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
    let hasPrimaryFailure = false

    try {
      await collection.stateWhenReady()
      const local = createTransaction({
        mutationFn: async () => {
          mutationEntered.resolve()
          await allowDemand.promise
          await Promise.resolve(collection._sync.loadSubset(subset))
        },
      })
      local.mutate(() => {
        collection.insert({ id: `local`, title: `optimistic local` })
      })
      localReceipt = local.isPersisted.promise
      void localReceipt.catch(() => undefined)
      await mutationEntered.promise

      sourceParams.begin({ immediate: true })
      sourceParams.write({
        type: `insert`,
        value: { id: `remote`, title: `authoritative source` },
      })
      sourceReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      await atPersistedOracleCheckpoint(
        sourceReceipt,
        `source publication beneath optimistic mutation`,
      )

      expect({
        local: stripVirtualProps(collection.get(`local`)),
        remote: stripVirtualProps(collection.get(`remote`)),
        durableRemote: adapter.rows.get(`remote`),
        localState: local.state,
      }).toEqual({
        local: { id: `local`, title: `optimistic local` },
        remote: { id: `remote`, title: `authoritative source` },
        durableRemote: { id: `remote`, title: `authoritative source` },
        localState: `persisting`,
      })

      allowDemand.resolve()
      await atPersistedOracleCheckpoint(
        localReceipt,
        `mutation demand after source publication`,
      )
      expect({
        status: collection.status,
        upstreamLoads,
      }).toEqual({
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

  it(`queues an immediate suffix behind held durability and fails it with the prefix`, async () => {
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
      await adapter.applyCommittedTx(collectionId, tx)
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
        id: `immediate-prefix-fail-stop`,
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
        `immediate prefix fail-stop collection ready`,
      )
      sourceParams.begin({ immediate: true })
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
        `failed immediate prefix entered durability`,
      )

      sourceParams.begin({ immediate: true })
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
        `failed immediate prefix receipt`,
      )
      const suffixOutcome = await atPersistedOracleCheckpoint(
        suffixReceipt.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `failed immediate suffix receipt`,
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

  it(`preserves metadata only for rows supplied by the owning hydration`, async () => {
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
        hydratedMetadata: { source: `persisted` },
        newMetadata: undefined,
        durableMetadataMutations: [{ type: `delete`, key: `new` }],
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

  it(`rejects a source transaction that crosses a hydration cycle`, async () => {
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
      expect(() => sourceParams.commit()).toThrow(
        `cannot cross a hydration cycle`,
      )
      releaseSecond.resolve()
      await second

      expect({
        publicRow: stripVirtualProps(collection.get(`shared`)),
        durableRow: adapter.rows.get(`shared`),
        durableMetadata: adapter.rowMetadata.get(`shared`),
        status: collection.status,
      }).toEqual({
        publicRow: { id: `shared`, title: `second hydration` },
        durableRow: { id: `shared`, title: `second hydration` },
        durableMetadata: { owner: `second hydration` },
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

  it(`rejects a source transaction begun before hydration and committed after it`, async () => {
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

      expect(() => sourceParams.commit()).toThrow(
        `cannot cross a hydration cycle`,
      )
      expect({
        publicRow: stripVirtualProps(collection.get(`shared`)),
        durableRow: adapter.rows.get(`shared`),
        durableMetadata: adapter.rowMetadata.get(`shared`),
        status: collection.status,
      }).toEqual({
        publicRow: { id: `shared`, title: `hydrated value` },
        durableRow: { id: `shared`, title: `hydrated value` },
        durableMetadata: { owner: `hydration` },
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

  it(`preserves full-reload metadata only for rows supplied by that reload`, async () => {
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
    adapter.loadSubset = async () => {
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
      await adapter.applyCommittedTx(collectionId, tx)
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
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `full-reload metadata collection ready`,
      )
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
        hydratedMetadata: { source: `persisted` },
        newMetadata: undefined,
        durableMetadataMutations: [{ type: `delete`, key: `new` }],
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      hydration.resolve()
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
        startSync: true,
      })
    const owner = query()
    let sibling: ReturnType<typeof query> | undefined
    try {
      await owner.preload()
      sibling = query()
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
        startSync: true,
      })
    const owner = query()
    let sibling: ReturnType<typeof query> | undefined
    try {
      await owner.preload()
      sibling = query()
      expect(sibling.status).toBe(`ready`)
      expect(sibling.toArray.map(({ id }) => id)).toEqual([`1`])
    } finally {
      await sibling?.cleanup()
      await owner.cleanup()
      await source.cleanup()
    }
  })

  fcTest.prop(
    [
      fc
        .array(
          fc
            .record({
              type: fc.constantFrom(`acquire` as const, `release` as const),
              demand: fc.constantFrom(`one` as const, `two` as const),
            })
            .map(
              (operation) =>
                operation as
                  | { type: `acquire`; demand: `one` | `two` }
                  | { type: `release`; demand: `one` | `two` },
            ),
          { minLength: 1, maxLength: 20 },
        )
        .chain((operations) =>
          fc
            .array(fc.integer({ min: 0, max: operations.length }), {
              maxLength: 4,
            })
            .map((truncatePositions) => {
              const positions = new Set(truncatePositions)
              return operations.flatMap((operation, index) =>
                positions.has(index)
                  ? ([{ type: `truncate` as const }, operation] as const)
                  : [operation],
              )
            }),
        ),
    ],
    oraclePropertyOptions(50, `persistence.retained-demand`),
  )(
    `matches the retained exact-demand model across acquire, release, and truncate histories`,
    async (history) => {
      const adapter = createRecordingAdapter([
        { id: `1`, title: `one` },
        { id: `2`, title: `two` },
      ])
      const loadRows = adapter.loadSubset
      adapter.loadSubset = async (...args) => {
        const rows = await loadRows(...args)
        return rows.slice(0, args[1].limit)
      }
      let truncateSource: (() => void) | undefined
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `hydrated-demand-history`,
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
      for (let attempt = 0; attempt < 20 && !truncateSource; attempt++) {
        await flushAsyncWork()
      }
      expect(truncateSource).toBeTypeOf(`function`)

      const active: Record<`one` | `two`, Array<LoadSubsetOptions>> = {
        one: [],
        two: [],
      }
      const hydrated = new Set<`one` | `two`>()
      const optionsFor = (demand: `one` | `two`): LoadSubsetOptions => ({
        limit: demand === `one` ? 1 : 2,
      })

      try {
        for (const operation of history) {
          if (operation.type === `truncate`) {
            truncateSource?.()
            hydrated.clear()
            continue
          }

          const demand = operation.demand
          if (operation.type === `release`) {
            const options = active[demand].pop()
            if (!options) continue
            collection._sync.unloadSubset(options)
            if (active[demand].length === 0) hydrated.delete(demand)
            continue
          }

          const options = optionsFor(demand)
          const result = collection._sync.loadSubset(options)
          expect(result === true).toBe(hydrated.has(demand))
          if (result !== true) await result
          active[demand].push(options)
          hydrated.add(demand)
        }
      } finally {
        await collection.cleanup()
      }
    },
  )

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
      expect(collection.size).toBe(0)

      const readsBeforeReacquire = adapter.loadSubsetCalls.length
      const reacquired = collection._sync.loadSubset({ limit: 1 })
      expect(reacquired).not.toBe(true)
      await expect(Promise.resolve(reacquired)).rejects.toBe(failure)
      expect(adapter.loadSubsetCalls).toHaveLength(readsBeforeReacquire)
      expect(collection.status).toBe(`error`)
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

  it(`settles hydration-buffered source work and reconciles an overlapping retry after incremental load rejection`, async () => {
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
        durableRows: [{ id: `source`, title: `Must outlive request failure` }],
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
        status: `error`,
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

  it(`rejects a transaction begun before hydration at its write cut`, async () => {
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

      expect(() =>
        sourceParams.write({
          type: `update`,
          value: { id: baseline.id, title: `Source update` },
        }),
      ).toThrow(`cannot cross a hydration cycle`)
      expect(() => sourceParams.commit()).toThrow(
        `cannot cross a hydration cycle`,
      )
      rejectLoad.resolve()

      await expect(load).rejects.toBe(requestFailure)
      expect({
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
        publicRow: stripVirtualProps(collection.get(baseline.id)),
        durableRow: adapter.rows.get(baseline.id),
        recoverySnapshotCalls: adapter.loadResumeSnapshotCalls.filter(
          ({ includeRows }) => includeRows === true,
        ).length,
      }).toEqual({
        status: `ready`,
        publicError: undefined,
        publicRow: undefined,
        durableRow: baseline,
        recoverySnapshotCalls: 0,
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

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `terminal hydration collection initially ready`,
      )
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
    const coordinator = createFailStopCoordinatorHarness(
      `terminal-hydration-rejects-new-source-work`,
    )
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
        persistence: { adapter, coordinator },
      }),
    )
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `terminal source hydration collection initially ready`,
      )
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
        await pending

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

  it(`hydrates a multiprocess follower locally while only the elected owner acquires remote demand`, async () => {
    const adapter = createRecordingAdapter([
      { id: `persisted`, title: `Persisted follower row` },
    ])
    let releaseRemoteLoad = (): void => {}
    const remoteLoadGate = new Promise<void>((resolve) => {
      releaseRemoteLoad = resolve
    })
    let registeredOwner: RemoteSubsetOwner | undefined
    const ensureRemote = vi.fn(() => remoteLoadGate)
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `follower-node`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => false,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      requestEnsureRemoteSubset: ensureRemote,
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: (_collectionId, owner) => {
        registeredOwner = owner
        return () => {
          if (registeredOwner === owner) registeredOwner = undefined
        }
      },
    }
    const followerUpstreamLoad = vi.fn(() => Promise.resolve())
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `multiprocess-follower-subset`,
        getKey: (todo) => todo.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: followerUpstreamLoad,
              unloadSubset: vi.fn(),
            }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    const options: LoadSubsetOptions = { limit: 1 }

    try {
      collection.startSyncImmediate()
      let settled = false
      const load = Promise.resolve(collection._sync.loadSubset(options)).then(
        () => {
          settled = true
        },
      )

      await vi.waitFor(() => {
        expect(adapter.loadSubsetCalls.length).toBeGreaterThan(0)
        expect(ensureRemote).toHaveBeenCalledWith(
          `multiprocess-follower-subset`,
          options,
        )
      })
      const persistedRow = collection.get(`persisted`)
      expect({
        persistedRow: persistedRow
          ? { id: persistedRow.id, title: persistedRow.title }
          : undefined,
        followerUpstreamCalls: followerUpstreamLoad.mock.calls.length,
        registeredOwner: registeredOwner !== undefined,
        settled,
      }).toEqual({
        persistedRow: { id: `persisted`, title: `Persisted follower row` },
        followerUpstreamCalls: 0,
        registeredOwner: true,
        settled: false,
      })

      releaseRemoteLoad()
      await load
      expect({
        routedEnsures: ensureRemote.mock.calls.length,
        followerUpstreamCalls: followerUpstreamLoad.mock.calls.length,
      }).toEqual({
        routedEnsures: 1,
        followerUpstreamCalls: 0,
      })
    } finally {
      releaseRemoteLoad()
      await collection.cleanup()
    }
  })

  it.each([`abort`, `signal-abort`, `release`, `offline`] as const)(
    `handles remote ensure after %s without resurrecting cancelled demand`,
    async (action) => {
      vi.useFakeTimers()
      const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const failure = Object.assign(new Error(action), {
        name: action === `abort` ? `AbortError` : `Error`,
      })
      const ensure = vi.fn(async () => {
        throw failure
      })
      const followerUpstreamLoad = vi.fn(async () => {
        throw new Error(`follower-local source must not own remote demand`)
      })
      const coordinator: PersistedCollectionCoordinator = {
        getNodeId: () => `cancel-ensure`,
        subscribe: () => () => {},
        publish: () => {},
        isLeader: () => true,
        ensureLeadership: async () => {},
        requestEnsurePersistedIndex: async () => {},
        requestApplyCommittedTx: (_collectionId, tx) =>
          Promise.resolve({
            type: `rpc:applyCommittedTx:res`,
            rpcId: tx.txId,
            ok: true,
            term: tx.term,
            seq: tx.seq,
            latestRowVersion: tx.rowVersion,
          }),
        requestEnsureRemoteSubset: ensure,
        // This fixture isolates ensure retry/cancellation, not ownership.
        requestReleaseRemoteSubset: async () => {},
        registerRemoteSubsetOwner: () => () => {},
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
                loadSubset: followerUpstreamLoad,
              }
            },
          },
          persistence: { adapter: createRecordingAdapter(), coordinator },
        }),
      )
      const controller = new AbortController()
      const options: LoadSubsetOptions = {
        limit: 1,
        ...(action === `signal-abort` ? { signal: controller.signal } : {}),
      }
      try {
        collection.startSyncImmediate()
        const result = await Promise.resolve(
          collection._sync.loadSubset(options),
        ).then(
          () => `ready`,
          (error: unknown) => error,
        )
        if (action === `release`) collection._sync.unloadSubset(options)
        if (action === `signal-abort`) controller.abort()
        const callsBeforeRetry = ensure.mock.calls.length
        await vi.advanceTimersByTimeAsync(200)
        // The old matrix supplied an AbortError or explicitly unloaded demand,
        // but never aborted an already-queued retry. The signal row owns that
        // distinct boundary; offline is its hostile liveness control.
        expect(result).toBe(failure)
        expect(followerUpstreamLoad).not.toHaveBeenCalled()
        if (action === `offline`) {
          expect(ensure.mock.calls.length).toBeGreaterThan(callsBeforeRetry)
        } else {
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
    const offline = new Error(`offline`)

    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `retry-node`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      requestEnsureRemoteSubset: async () => {
        ensureCalls++
        if (ensureCalls === 1) {
          throw offline
        }
      },
      // This fixture isolates ensure retry behavior, not ownership.
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-retry`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { loadSubset: vi.fn() }
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

    const firstResult = await Promise.resolve(
      (collection as any)._sync.loadSubset({ limit: 1 }),
    ).then(
      () => `ready`,
      (error: unknown) => error,
    )
    await flushAsyncWork(120)

    expect(firstResult).toBe(offline)
    expect(ensureCalls).toBeGreaterThanOrEqual(2)
  })

  it(`does not route remote demand from an ownerless elected leader`, async () => {
    const ensure = vi.fn(async () => {
      throw new Error(`no remote subset owner registered`)
    })
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `ownerless-node`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      requestEnsureRemoteSubset: ensure,
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `ownerless-on-demand-source`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {}
          },
        },
        persistence: {
          adapter: createRecordingAdapter(),
          coordinator,
        },
      }),
    )

    try {
      collection.startSyncImmediate()
      await flushAsyncWork()

      await expect(
        Promise.resolve(collection._sync.loadSubset({ limit: 1 })),
      ).resolves.toBeUndefined()
      await flushAsyncWork(120)

      expect(ensure).not.toHaveBeenCalled()
    } finally {
      await collection.cleanup()
    }
  })

  it(`uses dispatch-time ownership after follower hydration becomes ownerless leader`, async () => {
    const adapter = createRecordingAdapter()
    const loadSubset = adapter.loadSubset
    let markHydrationStarted = (): void => {}
    const hydrationStarted = new Promise<void>((resolve) => {
      markHydrationStarted = resolve
    })
    let releaseHydration = (): void => {}
    const hydrationGate = new Promise<void>((resolve) => {
      releaseHydration = resolve
    })
    adapter.loadSubset = async (...args) => {
      markHydrationStarted()
      await hydrationGate
      return loadSubset(...args)
    }

    let isLeader = false
    const staleEnsure = new Error(`ownerless leader must not route demand`)
    const ensure = vi.fn(() => Promise.reject(staleEnsure))
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `transitioning-node`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => isLeader,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      requestEnsureRemoteSubset: ensure,
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `dispatch-time-ownerless-leader`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {}
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    try {
      collection.startSyncImmediate()
      await flushAsyncWork()
      const load = Promise.resolve(collection._sync.loadSubset({ limit: 1 }))
      await hydrationStarted
      isLeader = true
      releaseHydration()

      await expect(load).resolves.toBeUndefined()
      expect(ensure).not.toHaveBeenCalled()
    } finally {
      releaseHydration()
      await collection.cleanup()
    }
  })

  it(`routes follower demand without a local subset owner`, async () => {
    const ensure = vi.fn(async () => {})
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `ownerless-follower`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => false,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      requestEnsureRemoteSubset: ensure,
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
    }
    const collectionId = `ownerless-on-demand-follower`
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: collectionId,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {}
          },
        },
        persistence: {
          adapter: createRecordingAdapter(),
          coordinator,
        },
      }),
    )
    const options = { limit: 1 }

    try {
      collection.startSyncImmediate()
      await flushAsyncWork()

      await expect(
        Promise.resolve(collection._sync.loadSubset(options)),
      ).resolves.toBeUndefined()

      expect(ensure).toHaveBeenCalledTimes(1)
      expect(ensure).toHaveBeenCalledWith(collectionId, options)
    } finally {
      await collection.cleanup()
    }
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
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      // This fixture isolates follower transaction acknowledgements.
      requestEnsureRemoteSubset: async () => {},
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
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

  it.each([
    {
      boundary: `follower` as const,
      responseCode: `PERSISTENCE_ERROR` as const,
      expectedDurabilityError: true,
    },
    {
      boundary: `elected-leader` as const,
      responseCode: `PERSISTENCE_ERROR` as const,
      expectedDurabilityError: true,
    },
    {
      boundary: `follower` as const,
      responseCode: `NOT_LEADER` as const,
      expectedDurabilityError: false,
    },
    {
      boundary: `follower` as const,
      responseCode: `VALIDATION_ERROR` as const,
      expectedDurabilityError: false,
    },
    {
      boundary: `follower` as const,
      responseCode: `CONFLICT` as const,
      expectedDurabilityError: false,
    },
    {
      boundary: `follower` as const,
      responseCode: `TIMEOUT` as const,
      expectedDurabilityError: false,
    },
  ])(
    `classifies public local-mutation failure at the $boundary boundary: $responseCode`,
    async ({ boundary, responseCode, expectedDurabilityError }) => {
      const persistenceResponse =
        responseCode === `PERSISTENCE_ERROR`
          ? {
              type: `rpc:applyLocalMutations:res` as const,
              rpcId: `local-${boundary}-persistence-response`,
              ok: false as const,
              code: `PERSISTENCE_ERROR` as const,
              error: `disk write failed`,
              sourceCode: `SQLITE_IOERR_FSYNC`,
              path: [`database`, `wal`] as const,
            }
          : {
              type: `rpc:applyLocalMutations:res` as const,
              rpcId: `local-${boundary}-failure-response`,
              ok: false as const,
              code: responseCode,
              error: `mutation route changed`,
            }
      const coordinator = createCoordinatorHarness()
      coordinator.isLeader = () => boundary === `elected-leader`
      coordinator.requestApplyLocalMutations = () =>
        Promise.resolve(persistenceResponse)
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `local-mutation-${boundary}-${responseCode}`,
          getKey: (item) => item.id,
          persistence: {
            adapter: createRecordingAdapter(),
            coordinator,
          },
        }),
      )

      try {
        const tx = collection.insert({
          id: `local-failure`,
          title: `Must not persist`,
        })
        const rejection = await tx.isPersisted.promise.then(
          () => undefined,
          (error: unknown) => error,
        )

        // Earlier laws covered external-sync commit classification and a
        // successful follower mutation acknowledgement. They never varied a
        // serialized applyLocalMutations failure by route. The elected-leader
        // and non-durability rows are hostile controls for topology parity and
        // for avoiding an over-broad fail-stop classifier.
        if (expectedDurabilityError) {
          expect(rejection).toMatchObject({
            name: `PersistedCollectionDurabilityError`,
            code: `SQLITE_IOERR_FSYNC`,
            path: [`database`, `wal`],
            cause: persistenceResponse,
          })
          expect(collection.status).toBe(`error`)
          expect(collection._lifecycle.getSyncError()).toBe(rejection)
        } else {
          expect(rejection).toMatchObject({
            name: `Error`,
            message:
              `failed to apply local mutations through coordinator: ` +
              `mutation route changed`,
          })
          expect(collection._lifecycle.getSyncError()).toBeUndefined()
        }
      } finally {
        await collection.cleanup()
      }
    },
  )

  it(`installs terminal state before synchronously reporting a local coordinator durability error`, async () => {
    const coordinator = createCoordinatorHarness()
    let requestCalls = 0
    coordinator.requestApplyLocalMutations = async (
      _collectionId,
      mutations,
    ) => {
      requestCalls++
      if (requestCalls === 1) {
        return {
          type: `rpc:applyLocalMutations:res`,
          rpcId: `local-reentrant-failure`,
          ok: false,
          code: `PERSISTENCE_ERROR`,
          error: `disk write failed`,
          sourceCode: `SQLITE_IOERR_FSYNC`,
          path: [`database`, `wal`],
        }
      }
      return {
        type: `rpc:applyLocalMutations:res`,
        rpcId: `local-reentrant-success`,
        ok: true,
        term: 1,
        seq: requestCalls,
        latestRowVersion: requestCalls,
        acceptedMutationIds: mutations.map((mutation) => mutation.mutationId),
      }
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `local-terminal-before-report`,
        getKey: (item) => item.id,
        persistence: {
          adapter: createRecordingAdapter(),
          coordinator,
        },
      }),
    )
    const now = new Date()
    const reentrantRow = {
      id: `reentrant-local`,
      title: `must not reach the coordinator`,
    }
    const reentrantMutation: PendingMutation<Todo, `insert`> = {
      mutationId: `reentrant-local-mutation`,
      original: {},
      modified: reentrantRow,
      changes: reentrantRow,
      globalKey: `local-terminal-before-report:reentrant-local`,
      key: reentrantRow.id,
      type: `insert`,
      metadata: undefined,
      syncMetadata: {},
      optimistic: true,
      createdAt: now,
      updatedAt: now,
      collection,
    }
    let reentrantOutcome:
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
          reentrantOutcome = Promise.resolve(
            collection.utils.acceptMutations({
              mutations: [
                reentrantMutation as unknown as PendingMutation<
                  Record<string, unknown>
                >,
              ],
            }),
          ).then(
            () => ({ status: `fulfilled` as const }),
            (reason: unknown) => ({ status: `rejected` as const, reason }),
          )
          originalMarkError(error)
        },
      )

      const primary = collection.insert({
        id: `primary-local`,
        title: `must install terminal state`,
      })
      const primaryOutcome = await primary.isPersisted.promise.then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      const reentrant = await atPersistedOracleCheckpoint(
        reentrantOutcome!,
        `reentrant local mutation after durability error`,
      )
      const terminalError =
        primaryOutcome.status === `rejected` ? primaryOutcome.reason : undefined

      expect({
        primaryStatus: primaryOutcome.status,
        reentrantStatus: reentrant.status,
        sameTerminal:
          reentrant.status === `rejected` && reentrant.reason === terminalError,
        requestCalls,
        exactPublicError:
          collection._lifecycle.getSyncError() === terminalError,
        reentrantVisible: collection.get(reentrantRow.id),
      }).toEqual({
        primaryStatus: `rejected`,
        reentrantStatus: `rejected`,
        sameTerminal: true,
        requestCalls: 1,
        exactPublicError: true,
        reentrantVisible: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      await cleanupPersistedOracle(
        [() => reentrantOutcome, () => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`preserves lifecycle abort classification when cleanup wins a local adapter race`, async () => {
    const adapter = createRecordingAdapter()
    const successfulApply = adapter.applyCommittedTx.bind(adapter)
    const persistenceEntered = createEventGate()
    const releasePersistence = createEventGate()
    adapter.applyCommittedTx = async (...args) => {
      persistenceEntered.resolve()
      await releasePersistence.promise
      await successfulApply(...args)
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `local-cleanup-durability-race`,
        getKey: (item) => item.id,
        persistence: { adapter },
      }),
    )
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await collection.stateWhenReady()
      const transaction = collection.insert({
        id: `old-local`,
        title: `durable only in the replaced lifecycle`,
      })
      const settlement = transaction.isPersisted.promise.then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      await atPersistedOracleCheckpoint(
        persistenceEntered.promise,
        `local adapter entered before cleanup`,
      )

      await collection.cleanup()
      cleanedUp = true
      releasePersistence.resolve()
      const outcome = await atPersistedOracleCheckpoint(
        settlement,
        `old local mutation settled after cleanup`,
      )

      expect({
        status: outcome.status,
        aborted:
          outcome.status === `rejected` &&
          outcome.reason instanceof SyncTransactionAbortedError,
        durability:
          outcome.status === `rejected` &&
          outcome.reason instanceof PersistedCollectionDurabilityError,
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        status: `rejected`,
        aborted: true,
        durability: false,
        publicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releasePersistence.resolve()
      await cleanupPersistedOracle(
        [() => (cleanedUp ? undefined : collection.cleanup())],
        hasPrimaryFailure,
      )
    }
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
    const releaseCallsBefore = coordinator.remoteReleaseCalls.length
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
      await flushAsyncWork()
      await flushAsyncWork()
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
        releaseCalls: coordinator.remoteReleaseCalls.length,
        releasedExact: coordinator.remoteReleaseCalls.at(-1) === initialLease,
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
        releaseCalls: releaseCallsBefore + 1,
        releasedExact: true,
        upstreamLoads: upstreamLoadsBefore,
        unloadCount: 0,
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
    let persistenceCapability:
      | NonNullable<SyncMetadataApi<string>[`persistence`]>
      | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady, metadata }) => {
            const capability = metadata?.persistence
            if (!capability) {
              throw new Error(`Expected persisted sync capability`)
            }
            persistenceCapability = capability
            hydrateBaseline = capability.hydrateBaseline
            markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    collection.startSyncImmediate()
    await vi.waitFor(() => expect(hydrateBaseline).toBeTypeOf(`function`))
    expect(persistenceCapability).toMatchObject({
      protocol: `@tanstack/db/sync-persistence`,
      version: 1,
    })
    expect(persistenceCapability?.scanPersistedRows).toBeTypeOf(`function`)
    expect(persistenceCapability?.resumeSnapshot.certify).toBeTypeOf(`function`)
    expect(persistenceCapability?.resumeSnapshot.getKeySetEvidence).toBeTypeOf(
      `function`,
    )
    expect(
      persistenceCapability?.resumeSnapshot.expectCurrentCommit,
    ).toBeTypeOf(`function`)
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

  it.each(persistedKeySetEvidenceStatuses.map((status) => ({ status })))(
    `keeps on-demand rows independent from $status baseline evidence`,
    async ({ status }) => {
      const adapter = createRecordingAdapter([
        { id: `on-demand`, title: `On-demand row` },
      ])
      const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
      adapter.loadResumeSnapshot = async (...args) => ({
        ...(await loadResumeSnapshot(...args)),
        rows: [
          {
            key: `baseline`,
            value: { id: `baseline`, title: `Baseline row` },
          },
        ],
        keySet: { status },
      })
      let hydrateBaseline: (() => Promise<void>) | undefined
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `${status}-baseline-and-on-demand`,
          syncMode: `on-demand`,
          getKey: (item) => item.id,
          sync: {
            sync: ({ markReady, metadata }) => {
              const capability = metadata?.persistence
              if (!capability) {
                throw new Error(`Expected persisted sync capability`)
              }
              hydrateBaseline = capability.hydrateBaseline
              markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter },
        }),
      )

      try {
        collection.startSyncImmediate()
        await vi.waitFor(() => expect(hydrateBaseline).toBeTypeOf(`function`))
        await hydrateBaseline!()
        await flushAsyncWork()
        await flushAsyncWork()

        const baselineVisible = collection.has(`baseline`)
        expect(collection.has(`on-demand`)).toBe(false)
        await collection._sync.loadSubset({})

        expectOnDemandEvidenceLaw({
          status,
          route: `loadSubset`,
          baselineVisible,
          onDemandVisible: collection.has(`on-demand`),
        })
      } finally {
        await collection.cleanup()
      }
    },
  )

  it.each(persistedKeySetEvidenceStatuses.map((status) => ({ status })))(
    `keeps force reload rows independent from $status startup evidence`,
    async ({ status }) => {
      const adapter = createRecordingAdapter([
        { id: `on-demand`, title: `On-demand row` },
      ])
      const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
      adapter.loadResumeSnapshot = async (...args) => ({
        ...(await loadResumeSnapshot(...args)),
        keySet: { status },
      })
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `${status}-local-only-force-reload`,
          syncMode: `on-demand`,
          getKey: (item) => item.id,
          persistence: { adapter },
        }),
      )

      try {
        collection.startSyncImmediate()
        await vi.waitFor(() =>
          expect(adapter.loadResumeSnapshotCalls.length).toBeGreaterThan(0),
        )
        await collection.utils.forceReloadSubset!({})

        expect(adapter.loadResumeSnapshotCalls[0]?.includeRows).toBe(false)
        expectOnDemandEvidenceLaw({
          status,
          route: `forceReloadSubset`,
          // This local-only route reads startup evidence but does not expose
          // baseline hydration. Do not claim a baseline observation here.
          baselineVisible: `not-observed`,
          onDemandVisible: collection.has(`on-demand`),
        })
      } finally {
        await collection.cleanup()
      }
    },
  )

  it(`rejects an evidence-coupled on-demand hydration mutant`, () => {
    expect(() =>
      expectOnDemandEvidenceLaw({
        status: `incompatible`,
        route: `loadSubset`,
        baselineVisible: false,
        onDemandVisible: false,
      }),
    ).toThrow(`on-demand rows must not inherit baseline evidence rejection`)

    expectOnDemandEvidenceLaw({
      status: `incompatible`,
      route: `loadSubset`,
      baselineVisible: false,
      onDemandVisible: true,
    })
  })

  it(`keeps resume certification consistent after an owned no-op commit`, async () => {
    const adapter = createRecordingAdapter()
    let remoteBegin: (() => void) | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    let persistenceCapability:
      | SyncMetadataApi<string>[`persistence`]
      | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `owned-no-op-generation`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, commit, markReady, metadata }) => {
            remoteBegin = begin
            remoteCommit = commit
            persistenceCapability = metadata?.persistence
            markReady()
          },
        },
        persistence: { adapter },
      }),
    )

    try {
      collection.startSyncImmediate()
      await vi.waitFor(() =>
        expect(persistenceCapability).toMatchObject({
          protocol: `@tanstack/db/sync-persistence`,
          version: 1,
        }),
      )

      remoteBegin?.()
      persistenceCapability?.resumeSnapshot.expectCurrentCommit()
      const applied = remoteCommit?.()
      if (applied !== true) await applied

      expect(adapter.applyCommittedTxCalls).toHaveLength(0)
      await persistenceCapability?.resumeSnapshot.certify()
      expect(persistenceCapability?.resumeSnapshot.getKeySetEvidence()).toEqual(
        { status: `consistent` },
      )
    } finally {
      await collection.cleanup()
    }
  })

  it(`invalidates resume evidence when storage advances outside the owned commit generation`, async () => {
    const adapter = createRecordingAdapter()
    let durableGeneration = {
      latestTerm: 0,
      latestSeq: 0,
      latestRowVersion: 0,
      resetEpoch: 0,
    }
    const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
    adapter.loadResumeSnapshot = async (...args) => ({
      ...(await loadResumeSnapshot(...args)),
      ...durableGeneration,
    })
    const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
    adapter.applyCommittedTx = async (collectionId, tx) => {
      await applyCommittedTx(collectionId, tx)
      durableGeneration = {
        latestTerm: tx.term,
        latestSeq: tx.seq,
        latestRowVersion: Math.max(
          durableGeneration.latestRowVersion + 1,
          tx.rowVersion,
        ),
        resetEpoch: durableGeneration.resetEpoch,
      }
    }

    let remoteBegin: (() => void) | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    let remoteMetadata:
      | Parameters<SyncConfig<Todo, string>[`sync`]>[0][`metadata`]
      | undefined
    let persistenceCapability:
      | SyncMetadataApi<string>[`persistence`]
      | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `generation-fence`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, commit, markReady, metadata }) => {
            remoteBegin = begin
            remoteCommit = commit
            remoteMetadata = metadata
            persistenceCapability = metadata?.persistence
            markReady()
          },
        },
        persistence: { adapter },
      }),
    )

    try {
      collection.startSyncImmediate()
      await vi.waitFor(() =>
        expect(persistenceCapability).toMatchObject({
          protocol: `@tanstack/db/sync-persistence`,
          version: 1,
        }),
      )

      // This is not a supported writer path. It models storage advancing
      // without the runtime observing the generation that now precedes its
      // commit. The exact-generation fence must reject that uncertainty.
      durableGeneration.latestRowVersion = 5

      remoteBegin?.()
      persistenceCapability?.resumeSnapshot.expectCurrentCommit()
      remoteMetadata?.collection.set(`cursor`, `next`)
      const applied = remoteCommit?.()
      if (applied !== true) await applied

      await persistenceCapability?.resumeSnapshot.certify()
      expect(persistenceCapability?.resumeSnapshot.getKeySetEvidence()).toEqual(
        { status: `incompatible` },
      )
    } finally {
      await collection.cleanup()
    }
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

  it(`keeps retired sync controls inert after cleanup and restart`, async () => {
    const adapter = createRecordingAdapter()
    const runs: Array<TodoSyncParams> = []
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `retired-controls-after-restart`,
        getKey: (item) => item.id,
        sync: {
          sync: (params) => {
            runs.push(params)
            params.markReady()
          },
        },
        persistence: { adapter },
      }),
    )

    try {
      await collection.preload()
      expect(runs).toHaveLength(1)
      const retired = runs[0]!

      await collection.cleanup()
      const replacementReady = createEventGate()
      const unsubscribe = collection.on(`status:ready`, () =>
        replacementReady.resolve(),
      )
      collection.startSyncImmediate()
      await atPersistedOracleCheckpoint(
        replacementReady.promise,
        `replacement controls ready`,
      )
      unsubscribe()
      expect(runs).toHaveLength(2)

      retired.begin()
      retired.write({
        type: `insert`,
        value: { id: `retired`, title: `must stay retired` },
      })
      const retiredReceipt = retired.commit()
      if (retiredReceipt !== true) await retiredReceipt

      const replacement = runs[1]!
      replacement.begin()
      replacement.write({
        type: `insert`,
        value: { id: `replacement`, title: `new controls own this row` },
      })
      const replacementReceipt = replacement.commit()
      if (replacementReceipt !== true) await replacementReceipt

      expect({
        retiredPublic: collection.get(`retired`),
        retiredDurable: adapter.rows.get(`retired`),
        replacementPublic: stripVirtualProps(collection.get(`replacement`)),
        replacementDurable: adapter.rows.get(`replacement`),
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        retiredPublic: undefined,
        retiredDurable: undefined,
        replacementPublic: {
          id: `replacement`,
          title: `new controls own this row`,
        },
        replacementDurable: {
          id: `replacement`,
          title: `new controls own this row`,
        },
        status: `ready`,
        publicError: undefined,
      })
    } finally {
      await collection.cleanup()
    }
  })

  // Focused collection-reset refinement: metadata and rows must come from one
  // hydration scope. The adapter makes an interleaved v2 write possible only
  // outside that scope, so the public v1 metadata and row are the independent
  // coherence checkpoint. This fixed history does not model arbitrary resets.
  it(`keeps a collection-reset reload inside one hydration scope`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `Initial row` }])
    adapter.collectionMetadata.set(`snapshot`, `initial`)
    const coordinator = createCoordinatorHarness()
    const loadSubset = adapter.loadSubset.bind(adapter)
    let inHydrationScope = false
    let interleaveArmed = false
    let interleaveRan = false

    const runInterleavedWrite = () => {
      interleaveRan = true
      adapter.collectionMetadata.set(`snapshot`, `v2`)
      adapter.rows.set(`1`, { id: `1`, title: `v2 row` })
    }

    adapter.loadSubset = async (...args) => {
      if (interleaveArmed && !inHydrationScope && !interleaveRan) {
        runInterleavedWrite()
      }
      return loadSubset(...args)
    }
    adapter.runInHydrationScope = async (task) => {
      inHydrationScope = true
      try {
        return await task(adapter)
      } finally {
        inHydrationScope = false
        if (interleaveArmed && !interleaveRan) runInterleavedWrite()
      }
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
    adapter.collectionMetadata.set(`snapshot`, `v1`)
    adapter.rows.set(`1`, { id: `1`, title: `v1 row` })
    interleaveArmed = true

    coordinator.emit({
      type: `collection:reset`,
      schemaVersion: 1,
      resetEpoch: 1,
    })

    await vi.waitFor(() => expect(interleaveRan).toBe(true))
    expect(collection._state.syncedCollectionMetadata.get(`snapshot`)).toBe(
      `v1`,
    )
    expect(collection.get(`1`)?.title).toBe(`v1 row`)
    await collection.cleanup()
  })

  // A remote commit queued during startup must run after the local hydration
  // scope releases the shared driver. A reset racing an unscheduled startup
  // baseline may publish before or after that baseline, but must own the final
  // public snapshot and may never be overwritten by an older baseline.
  it(`does not let an unscheduled startup baseline overwrite a newer collection reset`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `old` }])
    const coordinator = createCoordinatorHarness()
    const baselineEntered = createEventGate()
    const releaseBaseline = createEventGate()
    const resetReloadEntered = createEventGate()
    const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
    const loadSubset = adapter.loadSubset.bind(adapter)
    let heldBaseline = false
    adapter.loadResumeSnapshot = async (...args) => {
      const snapshot = await loadResumeSnapshot(...args)
      if (args[1]?.includeRows && !heldBaseline) {
        heldBaseline = true
        baselineEntered.resolve()
        await releaseBaseline.promise
      }
      return snapshot
    }
    adapter.loadSubset = (...args) => {
      resetReloadEntered.resolve()
      return loadSubset(...args)
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: { sync: ({ markReady }) => markReady() },
        persistence: { adapter, coordinator },
      }),
    )
    const preload = collection.preload()
    void preload.catch(() => undefined)
    const publishedTitles: Array<string | undefined> = []
    const subscription = collection.subscribeChanges(
      () => publishedTitles.push(collection.get(`1`)?.title),
      { includeInitialState: false },
    )

    try {
      await atPersistedOracleCheckpoint(
        baselineEntered.promise,
        `unscheduled baseline entered`,
      )
      adapter.rows.set(`1`, { id: `1`, title: `new` })
      coordinator.emit({
        type: `collection:reset`,
        schemaVersion: 1,
        resetEpoch: 1,
      })
      // Give a concurrent reset its event-loop turn. Serialization may instead
      // hold it behind the baseline; both orders must converge without a
      // public new -> old reversion.
      await flushAsyncWork()
      expect([undefined, `new`]).toContain(collection.get(`1`)?.title)
      releaseBaseline.resolve()
      await atPersistedOracleCheckpoint(preload, `startup after reset`)
      await atPersistedOracleCheckpoint(
        resetReloadEntered.promise,
        `reset reload after startup`,
      )
      await vi.waitFor(() => expect(collection.get(`1`)?.title).toBe(`new`))
      const firstNew = publishedTitles.indexOf(`new`)
      expect(firstNew).toBeGreaterThanOrEqual(0)
      expect(publishedTitles.slice(firstNew)).not.toContain(`old`)
    } finally {
      releaseBaseline.resolve()
      await preload.catch(() => undefined)
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each([`contiguous-reload`, `sequence-gap`] as const)(
    `finishes queued %s after scheduled startup hydration releases its scope`,
    async (route) => {
      const adapter = createRecordingAdapter([{ id: `1`, title: `old` }])
      const coordinator = createCoordinatorHarness()
      const baselineEntered = createEventGate()
      const releaseBaseline = createEventGate()
      const nestedScopeRequested = createEventGate()
      const queuedScopes: Array<() => void> = []
      const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
      let heldBaseline = false
      let scopeActive = false

      adapter.loadResumeSnapshot = async (...args) => {
        const snapshot = await loadResumeSnapshot(...args)
        if (args[1]?.includeRows && !heldBaseline) {
          heldBaseline = true
          baselineEntered.resolve()
          await releaseBaseline.promise
        }
        return snapshot
      }

      const scopedAdapter: RecordingAdapter = { ...adapter }
      scopedAdapter.runInHydrationScope = (task) => task(scopedAdapter)
      adapter.runInHydrationScope = (task) => {
        if (scopeActive) {
          nestedScopeRequested.resolve()
          return new Promise((resolve, reject) => {
            queuedScopes.push(() => {
              void task(scopedAdapter).then(resolve, reject)
            })
          })
        }
        scopeActive = true
        return Promise.resolve()
          .then(() => task(scopedAdapter))
          .finally(() => {
            scopeActive = false
            while (queuedScopes.length > 0) queuedScopes.shift()?.()
          })
      }

      if (route === `sequence-gap`) {
        coordinator.setPullSinceResponse({
          type: `rpc:pullSince:res`,
          rpcId: `review-gap`,
          ok: true,
          latestTerm: 1,
          latestSeq: 2,
          latestRowVersion: 2,
          requiresFullReload: true,
        })
      }
      const pullSince = coordinator.pullSince!.bind(coordinator)
      let coordinatorEnteredDuringScope: boolean | undefined
      coordinator.pullSince = (...args) => {
        coordinatorEnteredDuringScope = scopeActive
        return pullSince(...args)
      }

      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `sync-present`,
          getKey: (item) => item.id,
          sync: { sync: ({ markReady }) => markReady() },
          persistence: { adapter, coordinator },
        }),
      )
      const preload = collection.preload()
      void preload.catch(() => undefined)

      try {
        await atPersistedOracleCheckpoint(
          baselineEntered.promise,
          `${route} baseline entered`,
        )
        adapter.rows.set(`1`, { id: `1`, title: `new` })
        const committed: TxCommitted =
          route === `sequence-gap`
            ? {
                type: `tx:committed`,
                term: 1,
                seq: 2,
                txId: `review-sequence-gap`,
                latestRowVersion: 2,
                requiresFullReload: false,
                changedRows: [],
                deletedKeys: [],
              }
            : {
                type: `tx:committed`,
                term: 1,
                seq: 1,
                txId: `review-contiguous-reload`,
                latestRowVersion: 1,
                requiresFullReload: true,
              }
        coordinator.emit(committed)
        releaseBaseline.resolve()
        const first = await atPersistedOracleCheckpoint(
          Promise.race([
            preload.then(() => `startup-settled` as const),
            nestedScopeRequested.promise.then(() => `nested-scope` as const),
          ]),
          `${route} startup or nested scope`,
        )
        expect(first).toBe(`startup-settled`)
        expect(collection.get(`1`)?.title).toBe(`new`)
        if (route === `sequence-gap`) {
          expect(coordinator.pullSinceCalls).toBe(1)
          expect(coordinatorEnteredDuringScope).toBe(false)
        }
      } finally {
        releaseBaseline.resolve()
        while (queuedScopes.length > 0) queuedScopes.shift()?.()
        await preload.catch(() => undefined)
        await collection.cleanup()
      }
    },
  )

  // Focused receipt-ownership refinements. A source receipt created by the
  // hydration operation belongs to its waiter even if it rejects before the
  // waiter snapshots; a receipt created after hydration work returns does not.
  // The public load result and exact rejection identity distinguish those two
  // boundaries without treating every pending source receipt as related.
  it(`propagates an operation-owned receipt rejection that settles before the hydration waiter snapshots`, async () => {
    const adapter = createRecordingAdapter()
    const hydrateLoadEntered = createDeferred()
    const allowHydrateLoad = createDeferred()
    let gateHydrationLoad = true
    adapter.loadSubset = async () => {
      if (gateHydrationLoad) {
        gateHydrationLoad = false
        hydrateLoadEntered.resolve()
        await allowHydrateLoad.promise
      }
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
        id: `sync-present-settled-receipt-boundary`,
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
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter },
      }),
    )
    let load: Promise<unknown> | undefined
    let receipt: Promise<void> | undefined
    const abortController = new AbortController()

    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      load = Promise.resolve(collection._sync.loadSubset({ limit: 1 }))
      await hydrateLoadEntered.promise

      let keyReads = 0
      const establishingRow = {
        get id() {
          keyReads++
          if (keyReads === 2) abortController.abort()
          return `establishing`
        },
        title: `Abort during buffered replay`,
      }
      remoteBegin?.()
      remoteWrite?.({ type: `insert`, value: establishingRow })
      const applied = remoteCommit?.(abortController.signal)
      if (!(applied instanceof Promise)) {
        throw new Error(`expected a buffered establishing receipt`)
      }
      receipt = applied
      void receipt.catch(() => undefined)

      allowHydrateLoad.resolve()
      const [loadResult, receiptResult] = await Promise.allSettled([
        load,
        receipt,
      ])

      expect(keyReads).toBeGreaterThanOrEqual(2)
      expect(abortController.signal.aborted).toBe(true)
      expect(receiptResult.status).toBe(`rejected`)
      expect(loadResult.status).toBe(`rejected`)
      if (
        loadResult.status === `rejected` &&
        receiptResult.status === `rejected`
      ) {
        expect(loadResult.reason).toBe(receiptResult.reason)
      }
    } finally {
      abortController.abort()
      allowHydrateLoad.resolve()
      await receipt?.catch(() => undefined)
      await load?.catch(() => undefined)
      await collection.cleanup()
    }
  })

  it(`does not adopt an unrelated source receipt created after hydration work returns`, async () => {
    const adapter = createRecordingAdapter()
    const mutationEntered = createDeferred()
    const releaseMutation = createDeferred()
    const unrelatedStarted = createDeferred<{
      abortController: AbortController
      receipt: Promise<void>
    }>()
    const trace: Array<string> = []
    let probeActive = false
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit:
      | ((signal?: AbortSignal) => true | Promise<void>)
      | undefined

    adapter.runInHydrationScope = async (task) => {
      if (!probeActive) return task(adapter)
      probeActive = false

      const result = await task(adapter)
      trace.push(`hydrate-task-returned`)

      const abortController = new AbortController()
      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `unrelated`, title: `Outside hydrate boundary` },
      })
      const receipt = remoteCommit?.(abortController.signal)
      if (!(receipt instanceof Promise)) {
        throw new Error(`expected a pending unrelated receipt`)
      }
      trace.push(`unrelated-receipt-created`)
      unrelatedStarted.resolve({ abortController, receipt })
      return result
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-unrelated-receipt-boundary`,
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
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter },
        onInsert: async () => {
          mutationEntered.resolve()
          await releaseMutation.promise
        },
      }),
    )
    let mutation: ReturnType<typeof collection.insert> | undefined
    let load: Promise<unknown> | undefined
    let unrelated:
      | { abortController: AbortController; receipt: Promise<void> }
      | undefined

    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      mutation = collection.insert({ id: `local`, title: `Persisting gate` })
      await mutationEntered.promise

      probeActive = true
      load = Promise.resolve(collection._sync.loadSubset({ limit: 1 }))
      unrelated = await unrelatedStarted.promise
      expect(trace).toEqual([
        `hydrate-task-returned`,
        `unrelated-receipt-created`,
      ])

      // Give the public load continuation the opportunity to snapshot receipts.
      await flushAsyncWork()
      unrelated.abortController.abort()
      await unrelated.receipt.catch(() => undefined)

      await expect(load).resolves.toBeUndefined()
    } finally {
      unrelated?.abortController.abort()
      releaseMutation.resolve()
      await mutation?.isPersisted.promise.catch(() => undefined)
      await load?.catch(() => undefined)
      await collection.cleanup()
    }
  })

  it(`only signals completed leader-local index work after local success`, async () => {
    const adapter = createRecordingAdapter()
    const coordinator = createCoordinatorHarness()
    const localFailure = new Error(`local index creation failed`)
    const completedLocalMarkers: Array<boolean> = []
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})

    adapter.ensureIndex = async (collectionId, signature) => {
      adapter.ensureIndexCalls.push({ collectionId, signature })
      throw localFailure
    }
    coordinator.requestEnsurePersistedIndex = async (
      _collectionId,
      _signature,
      _spec,
      completedLocalAdapter,
      localEnsureCompleted,
    ) => {
      completedLocalMarkers.push(
        completedLocalAdapter !== undefined && localEnsureCompleted === true,
      )
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `failed-local-index-bootstrap`,
        getKey: (item) => item.id,
        defaultIndexType: BasicIndex,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    collection.createIndex((row) => row.title, { name: `startup-title` })

    try {
      await collection.preload()
      expect(completedLocalMarkers).toEqual([false])
    } finally {
      await collection.cleanup()
      warn.mockRestore()
    }
  })

  it(`releases the hydration scope before invoking a coordinator that uses its own adapter`, async () => {
    const adapter = createRecordingAdapter()
    const coordinatorEntered = createDeferred()
    const breakSchedulerCycle = createDeferred()
    let hydrationScopeActive = false
    let coordinatorEnteredDuringHydration: boolean | undefined

    const publicEnsureIndex = adapter.ensureIndex.bind(adapter)
    const scopedAdapter: PersistenceAdapter = {
      ...adapter,
      ensureIndex: publicEnsureIndex,
    }
    adapter.runInHydrationScope = async (task) => {
      hydrationScopeActive = true
      try {
        return await task(scopedAdapter)
      } finally {
        hydrationScopeActive = false
      }
    }
    adapter.ensureIndex = async (...args) => {
      if (hydrationScopeActive) {
        // A public core-adapter call queues behind the active hydrate. The
        // hydrate cannot release until this coordinator call returns.
        await breakSchedulerCycle.promise
      }
      await publicEnsureIndex(...args)
    }

    const coordinator = createCoordinatorHarness()
    coordinator.requestEnsurePersistedIndex = async (
      collectionId,
      signature,
      spec,
    ) => {
      coordinatorEnteredDuringHydration = hydrationScopeActive
      coordinatorEntered.resolve()
      // Deliberately ignore the optional scoped adapter, as existing public
      // coordinator implementations are allowed to do.
      await adapter.ensureIndex(collectionId, signature, spec)
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `custom-coordinator-hydration-scope`,
        getKey: (item) => item.id,
        defaultIndexType: BasicIndex,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    collection.createIndex((row) => row.title, {
      name: `startup-title`,
    })
    const preload = Promise.resolve(collection.preload())
    void preload.catch(() => undefined)

    try {
      await coordinatorEntered.promise
      expect(coordinatorEnteredDuringHydration).toBe(false)
    } finally {
      breakSchedulerCycle.resolve()
      await preload.catch(() => undefined)
      await collection.cleanup()
    }
  })

  it(`releases crossed follower hydration scopes before leader index RPC work`, async () => {
    const bothLocalIndexesEntered = createDeferred()
    const bothCoordinatorRequestsEntered = createDeferred()
    let localIndexEntries = 0
    let coordinatorEntries = 0

    const createTabAdapter = () => {
      const adapter = createRecordingAdapter()
      const breakSchedulerCycle = createDeferred()
      let hydrationScopeActive = false
      const remoteScopeObservations: Array<boolean> = []
      const publicEnsureIndex = adapter.ensureIndex.bind(adapter)
      const scopedAdapter: PersistenceAdapter = {
        ...adapter,
        ensureIndex: async (...args) => {
          localIndexEntries++
          if (localIndexEntries === 2) bothLocalIndexesEntered.resolve()
          await bothLocalIndexesEntered.promise
          await publicEnsureIndex(...args)
        },
      }
      adapter.runInHydrationScope = async (task) => {
        hydrationScopeActive = true
        try {
          return await task(scopedAdapter)
        } finally {
          hydrationScopeActive = false
        }
      }
      adapter.ensureIndex = async (...args) => {
        remoteScopeObservations.push(hydrationScopeActive)
        coordinatorEntries++
        if (coordinatorEntries === 2) bothCoordinatorRequestsEntered.resolve()
        if (hydrationScopeActive) await breakSchedulerCycle.promise
        await publicEnsureIndex(...args)
      }
      return {
        adapter,
        breakSchedulerCycle,
        remoteScopeObservations,
      }
    }

    const tab1 = createTabAdapter()
    const tab2 = createTabAdapter()
    const coordinator1 = createCoordinatorHarness()
    const coordinator2 = createCoordinatorHarness()
    coordinator1.isLeader = () => false
    coordinator2.isLeader = () => false
    coordinator1.requestEnsurePersistedIndex = (
      collectionId,
      signature,
      spec,
    ) => tab2.adapter.ensureIndex(collectionId, signature, spec)
    coordinator2.requestEnsurePersistedIndex = (
      collectionId,
      signature,
      spec,
    ) => tab1.adapter.ensureIndex(collectionId, signature, spec)

    const createFollowerCollection = (
      id: string,
      persistence: PersistedCollectionPersistence,
    ) => {
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id,
          getKey: (item) => item.id,
          defaultIndexType: BasicIndex,
          sync: {
            sync: ({ markReady }) => {
              markReady()
            },
          },
          persistence,
        }),
      )
      collection.createIndex((row) => row.title, { name: `${id}-title` })
      return collection
    }
    const followerA = createFollowerCollection(`follower-a`, {
      adapter: tab1.adapter,
      coordinator: coordinator1,
    })
    const followerB = createFollowerCollection(`follower-b`, {
      adapter: tab2.adapter,
      coordinator: coordinator2,
    })
    const preloadA = Promise.resolve(followerA.preload())
    const preloadB = Promise.resolve(followerB.preload())
    void preloadA.catch(() => undefined)
    void preloadB.catch(() => undefined)

    try {
      await bothCoordinatorRequestsEntered.promise
      expect({
        tab1: tab1.remoteScopeObservations,
        tab2: tab2.remoteScopeObservations,
      }).toEqual({ tab1: [false], tab2: [false] })
    } finally {
      tab1.breakSchedulerCycle.resolve()
      tab2.breakSchedulerCycle.resolve()
      await Promise.all([preloadA, preloadB]).catch(() => undefined)
      await Promise.all([followerA.cleanup(), followerB.cleanup()])
    }
  })

  it(`keeps generated crossed-leadership index RPC histories outside local hydration scopes`, async () => {
    let run = 0
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          tabCount: fc.integer({ min: 2, max: 4 }),
          indexCount: fc.integer({ min: 1, max: 2 }),
          direction: fc.constantFrom(-1, 1),
        }),
        async ({ tabCount, indexCount, direction }) => {
          run++
          const allTabsAtLocalIndex = createDeferred()
          let tabsAtLocalIndex = 0
          const tabs = Array.from({ length: tabCount }, () => {
            const adapter = createRecordingAdapter()
            let hydrationScopeActive = false
            let localIndexCalls = 0
            const remoteScopeObservations: Array<boolean> = []
            const publicEnsureIndex = adapter.ensureIndex.bind(adapter)
            const scopedAdapter: PersistenceAdapter = {
              ...adapter,
              ensureIndex: async (...args) => {
                localIndexCalls++
                if (localIndexCalls === 1) {
                  tabsAtLocalIndex++
                  if (tabsAtLocalIndex === tabCount) {
                    allTabsAtLocalIndex.resolve()
                  }
                  await allTabsAtLocalIndex.promise
                }
                await publicEnsureIndex(...args)
              },
            }
            adapter.runInHydrationScope = async (task) => {
              hydrationScopeActive = true
              try {
                return await task(scopedAdapter)
              } finally {
                hydrationScopeActive = false
              }
            }
            adapter.ensureIndex = async (...args) => {
              remoteScopeObservations.push(hydrationScopeActive)
              await publicEnsureIndex(...args)
            }
            return { adapter, remoteScopeObservations }
          })

          const collections = tabs.map((tab, index) => {
            const remoteIndex = (index + direction + tabCount) % tabCount
            const coordinator = createCoordinatorHarness()
            coordinator.isLeader = () => false
            coordinator.requestEnsurePersistedIndex = (
              collectionId,
              signature,
              spec,
            ) =>
              tabs[remoteIndex]!.adapter.ensureIndex(
                collectionId,
                signature,
                spec,
              )
            const collection = createCollection(
              persistedCollectionOptions<Todo, string>({
                id: `generated-crossed-${run}-${index}`,
                getKey: (item) => item.id,
                defaultIndexType: BasicIndex,
                sync: {
                  sync: ({ markReady }) => {
                    markReady()
                  },
                },
                persistence: { adapter: tab.adapter, coordinator },
              }),
            )
            for (
              let indexOrdinal = 0;
              indexOrdinal < indexCount;
              indexOrdinal++
            ) {
              collection.createIndex(
                indexOrdinal % 2 === 0 ? (row) => row.title : (row) => row.id,
                { name: `idx-${indexOrdinal}` },
              )
            }
            return collection
          })

          try {
            await Promise.all(
              collections.map((collection) => collection.preload()),
            )
            for (const tab of tabs) {
              expect(tab.remoteScopeObservations).toEqual(
                Array.from({ length: indexCount }, () => false),
              )
            }
          } finally {
            await Promise.all(
              collections.map((collection) => collection.cleanup()),
            )
          }
        },
      ),
      { seed: 1868, numRuns: 8, endOnFailure: true },
    )
  })

  // Focused R7 causal-replay witness: after hydration releases its buffer, the
  // source receipt must replay without awaiting the persisting operation whose
  // callback is itself awaiting that receipt. Persistence reach, both public
  // settlements, and the final source row expose the otherwise hidden cycle.
  it(`replays a buffered source receipt without blocking its persisting predecessor`, async () => {
    const adapter = createRecordingAdapter()
    const hydrateLoadEntered = createDeferred()
    const allowHydrateLoad = createDeferred()
    let gateHydrationLoad = true
    const replayState = { persisted: false }

    const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
    adapter.loadResumeSnapshot = async (...args) => {
      if (args[1]?.includeRows === true && gateHydrationLoad) {
        gateHydrationLoad = false
        hydrateLoadEntered.resolve()
        await allowHydrateLoad.promise
      }
      return loadResumeSnapshot(...args)
    }
    const applyCommittedTx = adapter.applyCommittedTx
    adapter.applyCommittedTx = async (...args) => {
      replayState.persisted = true
      await applyCommittedTx(...args)
    }
    adapter.runInHydrationScope = (task) => task(adapter)

    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `update`; value: Todo }) => void)
      | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    const sourceReady = createDeferred()
    const bufferedCommitReturned = createDeferred<{
      receipt: Promise<void>
    }>()

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-buffered-causal-replay`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            remoteBegin = begin
            remoteWrite = write as (message: {
              type: `update`
              value: Todo
            }) => void
            remoteCommit = commit
            sourceReady.resolve()
            markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter },
        onInsert: async () => {
          if (!remoteBegin || !remoteWrite || !remoteCommit) {
            throw new Error(`source sync is not ready`)
          }
          remoteBegin()
          remoteWrite({
            type: `update`,
            value: { id: `source-row`, title: `Buffered during hydrate` },
          })
          const applied = remoteCommit()
          if (applied === true) {
            throw new Error(`source commit was not buffered during hydration`)
          }
          bufferedCommitReturned.resolve({ receipt: applied })
          await applied
        },
      }),
    )

    const preload = Promise.resolve(collection.preload())
    void preload.catch(() => undefined)
    let mutationPersisted: Promise<unknown> | undefined
    let bufferedReceipt: Promise<void> | undefined

    try {
      await atPersistedOracleCheckpoint(
        hydrateLoadEntered.promise,
        `buffered causal replay hydration entered`,
      )
      await atPersistedOracleCheckpoint(
        sourceReady.promise,
        `buffered causal replay source ready`,
      )

      const mutation = collection.insert({ id: `local`, title: `Pending` })
      mutationPersisted = mutation.isPersisted.promise
      void mutationPersisted.catch(() => undefined)
      const bufferedCommit = await atPersistedOracleCheckpoint(
        bufferedCommitReturned.promise,
        `buffered causal replay commit returned`,
      )
      bufferedReceipt = bufferedCommit.receipt
      void bufferedReceipt.catch(() => undefined)

      allowHydrateLoad.resolve()

      let causalCycleObserved = false
      for (
        let attempt = 0;
        attempt < 100 && !replayState.persisted;
        attempt++
      ) {
        causalCycleObserved = collection._state.pendingSyncedTransactions.some(
          (transaction) =>
            transaction.committed && transaction.applied.isPending(),
        )
        if (causalCycleObserved) break
        await Promise.resolve()
      }

      expect(causalCycleObserved).toBe(false)
      expect(replayState.persisted).toBe(true)
      await expect(
        atPersistedOracleCheckpoint(
          bufferedReceipt,
          `buffered causal replay source receipt`,
        ),
      ).resolves.toBeUndefined()
      await expect(
        atPersistedOracleCheckpoint(
          mutationPersisted,
          `buffered causal replay mutation persisted`,
        ),
      ).resolves.toBeDefined()
      await expect(
        atPersistedOracleCheckpoint(
          preload,
          `buffered causal replay preload settled`,
        ),
      ).resolves.toBeUndefined()
      expect(stripVirtualProps(collection.get(`source-row`))).toEqual({
        id: `source-row`,
        title: `Buffered during hydrate`,
      })
    } finally {
      allowHydrateLoad.resolve()
      await collection.cleanup()
    }
  })

  it(`releases the hydration scope before a gap coordinator uses its own adapter`, async () => {
    const adapter = createRecordingAdapter()
    const coordinator = createCoordinatorHarness()
    const coordinatorEntered = createDeferred()
    const breakSchedulerCycle = createDeferred()
    let hydrationScopeActive = false
    let coordinatorEnteredDuringHydration: boolean | undefined

    const pullSince = async () => ({
      latestRowVersion: 0,
      requiresFullReload: false as const,
      changedKeys: [],
      deletedKeys: [],
      deltas: [],
    })
    const publicAdapter = adapter as RecordingAdapter & {
      pullSince: typeof pullSince
    }
    const scopedAdapter = {
      ...adapter,
      pullSince,
    }
    publicAdapter.pullSince = async () => {
      if (hydrationScopeActive) await breakSchedulerCycle.promise
      return pullSince()
    }
    adapter.runInHydrationScope = async (task) => {
      hydrationScopeActive = true
      try {
        return await task(scopedAdapter)
      } finally {
        hydrationScopeActive = false
      }
    }
    coordinator.pullSince = async (_collectionId, _fromRowVersion) => {
      coordinatorEnteredDuringHydration = hydrationScopeActive
      coordinatorEntered.resolve()
      const result = await publicAdapter.pullSince()
      return {
        type: `rpc:pullSince:res`,
        rpcId: `legacy-gap-coordinator`,
        ok: true,
        latestTerm: 1,
        latestSeq: 2,
        latestRowVersion: result.latestRowVersion,
        requiresFullReload: result.requiresFullReload,
        changedKeys: result.changedKeys,
        deletedKeys: result.deletedKeys,
        deltas: result.deltas,
      }
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

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 2,
      txId: `tx-gap-legacy-coordinator`,
      latestRowVersion: 2,
      requiresFullReload: false,
      changedRows: [],
      deletedKeys: [],
    })

    try {
      await coordinatorEntered.promise
      expect(coordinatorEnteredDuringHydration).toBe(false)
    } finally {
      breakSchedulerCycle.resolve()
      await flushAsyncWork()
      await collection.cleanup()
    }
  })

  // Focused invalidation-reload refinements. Whether recovery follows a
  // sequence gap or a contiguous committed notification, metadata and rows
  // must be read inside one hydration scope. The adapter schedules v2 only
  // outside the scope; coherent public v1 state is the checkpoint.
  it(`keeps sequence-gap recovery inside one hydration scope`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `Initial row` }])
    adapter.collectionMetadata.set(`snapshot`, `initial`)
    const coordinator = createCoordinatorHarness()
    coordinator.setPullSinceResponse({
      type: `rpc:pullSince:res`,
      rpcId: `pull-gap-scope`,
      ok: true,
      latestTerm: 1,
      latestSeq: 1,
      latestRowVersion: 1,
      requiresFullReload: true,
    })
    const loadSubset = adapter.loadSubset.bind(adapter)
    let inHydrationScope = false
    let interleaveArmed = false
    let interleaveRan = false

    const runInterleavedWrite = () => {
      interleaveRan = true
      adapter.collectionMetadata.set(`snapshot`, `v2`)
      adapter.rows.set(`1`, { id: `1`, title: `v2 row` })
    }

    adapter.loadSubset = async (...args) => {
      if (interleaveArmed && !inHydrationScope && !interleaveRan) {
        runInterleavedWrite()
      }
      return loadSubset(...args)
    }
    adapter.runInHydrationScope = async (task) => {
      inHydrationScope = true
      try {
        return await task(adapter)
      } finally {
        inHydrationScope = false
        if (interleaveArmed && !interleaveRan) runInterleavedWrite()
      }
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
    adapter.collectionMetadata.set(`snapshot`, `v1`)
    adapter.rows.set(`1`, { id: `1`, title: `v1 row` })
    interleaveArmed = true

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 2,
      txId: `tx-gap-scope`,
      latestRowVersion: 2,
      requiresFullReload: false,
      changedRows: [],
      deletedKeys: [],
    })

    await vi.waitFor(() => expect(interleaveRan).toBe(true))
    expect(collection._state.syncedCollectionMetadata.get(`snapshot`)).toBe(
      `v1`,
    )
    expect(collection.get(`1`)?.title).toBe(`v1 row`)
    await collection.cleanup()
  })

  it(`keeps contiguous committed reload inside one hydration scope`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `Initial row` }])
    adapter.collectionMetadata.set(`snapshot`, `initial`)
    const coordinator = createCoordinatorHarness()
    const loadSubset = adapter.loadSubset.bind(adapter)
    let inHydrationScope = false
    let interleaveArmed = false
    let interleaveRan = false

    const runInterleavedWrite = () => {
      interleaveRan = true
      adapter.collectionMetadata.set(`snapshot`, `v2`)
      adapter.rows.set(`1`, { id: `1`, title: `v2 row` })
    }

    adapter.loadSubset = async (...args) => {
      if (interleaveArmed && !inHydrationScope && !interleaveRan) {
        runInterleavedWrite()
      }
      return loadSubset(...args)
    }
    adapter.runInHydrationScope = async (task) => {
      inHydrationScope = true
      try {
        return await task(adapter)
      } finally {
        inHydrationScope = false
        if (interleaveArmed && !interleaveRan) runInterleavedWrite()
      }
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
    adapter.collectionMetadata.set(`snapshot`, `v1`)
    adapter.rows.set(`1`, { id: `1`, title: `v1 row` })
    interleaveArmed = true

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-contiguous-reload-scope`,
      latestRowVersion: 1,
      requiresFullReload: true,
    })

    await vi.waitFor(() => expect(interleaveRan).toBe(true))
    expect(collection._state.syncedCollectionMetadata.get(`snapshot`)).toBe(
      `v1`,
    )
    expect(collection.get(`1`)?.title).toBe(`v1 row`)
    await collection.cleanup()
  })

  // Focused lifecycle-fencing witness: generation-zero startup is held across
  // cleanup and rebound, then released while generation one is still loading.
  // Zero ensure-index calls for the rebound signatures prove stale bootstrap
  // and listener work did not cross the public lifecycle boundary.
  it(`does not let stale startup install index work on a rebound lifecycle`, async () => {
    const adapter = createRecordingAdapter()
    const g0MetadataEntered = createDeferred()
    const allowG0Metadata = createDeferred()
    const g1MetadataEntered = createDeferred()
    const allowG1Metadata = createDeferred()
    let metadataCalls = 0
    const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
    adapter.loadResumeSnapshot = async (...args) => {
      if (args[1]?.includeRows === false) {
        metadataCalls++
        if (metadataCalls === 1) {
          g0MetadataEntered.resolve()
          await allowG0Metadata.promise
        } else if (metadataCalls === 2) {
          g1MetadataEntered.resolve()
          await allowG1Metadata.promise
        }
      }
      return loadResumeSnapshot(...args)
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-startup-index-generation`,
        getKey: (item) => item.id,
        defaultIndexType: BasicIndex,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: { adapter },
      }),
    )
    const stalePreload = Promise.resolve(collection.preload())
    void stalePreload.catch(() => undefined)
    let freshReady: Promise<unknown> | undefined

    try {
      await g0MetadataEntered.promise
      await collection.cleanup()

      const reboundIndex = collection.createIndex((row) => row.title, {
        name: `rebound-bootstrap`,
      })
      const reboundSignature = collection
        .getIndexMetadata()
        .find((metadata) => metadata.indexId === reboundIndex.id)?.signature
      expect(reboundSignature).toBeDefined()
      freshReady = collection.stateWhenReady()

      allowG0Metadata.resolve()
      await g1MetadataEntered.promise

      const staleBootstrapCalls = adapter.ensureIndexCalls.filter(
        (call) => call.signature === reboundSignature,
      )
      const listenerIndex = collection.createIndex((row) => row.id, {
        name: `rebound-listener`,
      })
      const listenerSignature = collection
        .getIndexMetadata()
        .find((metadata) => metadata.indexId === listenerIndex.id)?.signature
      expect(listenerSignature).toBeDefined()
      const staleListenerCalls = adapter.ensureIndexCalls.filter(
        (call) => call.signature === listenerSignature,
      )

      expect({
        staleBootstrapCalls: staleBootstrapCalls.length,
        staleListenerCalls: staleListenerCalls.length,
      }).toEqual({
        staleBootstrapCalls: 0,
        staleListenerCalls: 0,
      })

      allowG1Metadata.resolve()
      await freshReady
    } finally {
      allowG0Metadata.resolve()
      allowG1Metadata.resolve()
      await stalePreload.catch(() => undefined)
      await freshReady?.catch(() => undefined)
      await collection.cleanup()
    }
  })
})

describeUnlessOracleReplay(`persisted key and identifier helpers`, () => {
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
