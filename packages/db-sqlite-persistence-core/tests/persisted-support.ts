import { describe, expect, it, vi } from 'vitest'
import { fc } from '@fast-check/vitest'
import { IR, createCollection } from '@tanstack/db'
import {
  PersistedCollectionDurabilityError,
  SingleProcessCoordinator,
  persistedCollectionOptions,
} from '../src'
import { oracleReplayTest } from '../../db/tests/oracle-config.js'
import { cleanupTestActions } from './test-cleanup'
import type { LoadSubsetOptions, SyncConfig } from '@tanstack/db'
import type {
  CollectionReset,
  PersistedCollectionCoordinator,
  PersistedStorageTarget,
  PersistenceAdapter,
  ProtocolEnvelope,
  PullSinceResponse,
  TxCommitted,
} from '../src'

export async function atPersistedOracleCheckpoint<T>(
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

export async function cleanupPersistedOracle(
  actions: Array<() => void | Promise<unknown>>,
  hasPrimaryFailure: boolean,
): Promise<void> {
  await cleanupTestActions(
    actions,
    hasPrimaryFailure,
    `Persisted oracle`,
    (action, index) =>
      atPersistedOracleCheckpoint(
        Promise.resolve().then(action),
        `cleanup stage ${index}`,
        250,
      ),
  )
}

export type Todo = {
  id: string
  title: string
  detail?: string
  payload?: { rank: number }
  values?: Array<string | null>
}

export type TodoSyncParams = Parameters<SyncConfig<Todo, string>[`sync`]>[0]

export function expectExactSnapshot(
  actual: ReadonlyMap<string, Todo>,
  expected: ReadonlyMap<string, Todo>,
): void {
  expect(Array.from(actual.keys()).sort()).toEqual(
    Array.from(expected.keys()).sort(),
  )
  for (const [key, row] of expected) expect(actual.get(key)).toStrictEqual(row)
}

export type RecordingAdapter = PersistenceAdapter & {
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

// This fixture records the addressed storage name; it does not decide whether
// the target's managed claim is valid. The SQLite owner judges that boundary.
export function recordedStorageId(target: PersistedStorageTarget): string {
  return target.kind === `eager`
    ? target.collectionId
    : target.storageCollectionId
}

export function createRecordingAdapter(
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
        collectionId: recordedStorageId(collectionId),
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
        collectionId: recordedStorageId(collectionId),
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
      adapter.loadCollectionMetadataCalls.push(recordedStorageId(collectionId))
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
        collectionId: recordedStorageId(collectionId),
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
      adapter.ensureIndexCalls.push({
        collectionId: recordedStorageId(collectionId),
        signature,
      })
      return Promise.resolve()
    },
    markIndexRemoved: (collectionId, signature) => {
      adapter.markIndexRemovedCalls.push({
        collectionId: recordedStorageId(collectionId),
        signature,
      })
      return Promise.resolve()
    },
  }

  return adapter
}

export function overrideBaselineRows(
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

export type CoordinatorHarness = PersistedCollectionCoordinator & {
  emit: (
    payload: TxCommitted | CollectionReset,
    senderId?: string,
    collectionId?: string,
  ) => void
  pullSinceCalls: number
  setPullSinceResponse: (response: PullSinceResponse) => void
}

export function createCoordinatorHarness(): CoordinatorHarness {
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
    emit: (
      payload,
      senderId = `remote-node`,
      collectionId = `sync-present`,
    ) => {
      subscriber?.({
        v: 1,
        dbName: `test-db`,
        collectionId,
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

export type FailStopCoordinatorHarness = PersistedCollectionCoordinator & {
  emit: (payload: unknown, senderId?: string, storageId?: string) => void
  publishCalls: Array<ProtocolEnvelope<unknown>>
  remoteEnsureCalls: Array<LoadSubsetOptions>
  remoteReleaseCalls: Array<LoadSubsetOptions>
  unsubscribeCalls: number
}

export function createFailStopCoordinatorHarness(
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
    emit: (payload, senderId = `remote-fail-stop-peer`, storageId) => {
      subscriber?.({
        v: 1,
        dbName: `test-db`,
        collectionId: storageId ?? collectionId,
        senderId,
        ts: Date.now(),
        payload,
      })
    },
  }
  return harness
}

export const stripVirtualProps = <T extends Record<string, any> | undefined>(
  value: T,
): T => {
  if (!value || typeof value !== `object`) return value
  const {
    $hasPendingWrites: _hasPendingWrites,
    $synced: _synced,
    $origin: _origin,
    $key: _key,
    $collectionId: _collectionId,
    ...rest
  } = value as Record<string, unknown>
  return rest as T
}

export async function flushAsyncWork(delayMs: number = 0): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

export function createDeferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

export function createEventGate(): {
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

export function observeSettlement(promise: Promise<void>): {
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

export function expectHydrationReceiptsPending(
  receipts: Array<ReturnType<typeof observeSettlement>>,
) {
  expect(
    receipts.map((receipt) => receipt.read()),
    `each receipt must wait for its own durable/visible boundary`,
  ).toEqual(receipts.map(() => ({ status: `pending` })))
}

export function createNoopAdapter(): PersistenceAdapter {
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

export async function createTerminalFailureHarness(
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

  expect(collection.status).toBe(`crashed`)
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

export const hydrationScopeModes = [
  `none`,
  `same-adapter`,
  `distinct-adapter`,
] as const

export function expectPendingKeyMembershipWork(
  actual: number,
  pendingOwners: number,
  partialWrites: number,
): void {
  expect(
    actual,
    `one key-membership lookup per pending owner and partial write`,
  ).toBe(pendingOwners * partialWrites)
}

export async function runRejectedHydrationBufferWitness(
  id: string,
  rows: ReadonlyArray<Todo>,
  options: {
    commitAfterHydrationFailure?: boolean
    scopeMode?: (typeof hydrationScopeModes)[number]
  } = {},
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

  const routing = configureHydrationScope(adapter, options.scopeMode ?? `none`)
  let remoteBegin: (() => void) | undefined
  let remoteWrite:
    ((message: { type: `insert`; value: Todo }) => void) | undefined
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
      status: `crashed`,
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
    expect(routing?.violations() ?? []).toEqual([])
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

// The core optimistic-history law drops a refused insert at settlement;
// accepted source transactions remain authoritative. The independent
// single-row source reference state starts empty. Each accepted source turn
// changes only its named key.
// Cross first-turn insert/delete with commitment before/after refusal, then
// apply the opposite turn. Compare at mutation settlement and each receipt,
// before a later source turn can hide a ghost.
// A failed transaction contributes no lasting local attribution. A source
// row that survives its rejection has remote public origin at publication,
// whether the source turn was accepted before or after the rejection.
export const refusalHistories = ([`before`, `after`] as const).flatMap(
  (timing) =>
    ([`delete`, `insert`] as const).map((firstWrite) => ({
      timing,
      firstWrite,
    })),
)

// The public optional API admits all three paths. Keep the no-scope and
// same-adapter histories when adding a distinguishable loan; their receipt and
// replay laws do not depend on a scheduler being present.
export function configureHydrationScope(
  adapter: PersistenceAdapter,
  mode: (typeof hydrationScopeModes)[number],
) {
  if (mode === `distinct-adapter`) return installHydrationRoutingProbe(adapter)
  if (mode === `same-adapter`)
    adapter.runInHydrationScope = (task) => task(adapter)
  return undefined
}

// This is a controlled ownership probe, not a scheduler model. Each invocation
// lends a fresh adapter. A call records both its route and whether its loan is
// still live. Forwarding wrong calls permits teardown while retaining the
// reached routing violation. The browser receiver proves the actual cycle.
export function installHydrationRoutingProbe(adapter: PersistenceAdapter) {
  const direct = adapter.applyCommittedTx.bind(adapter)
  const calls: Array<{
    route: `public` | `scoped`
    scope: number | undefined
    live: boolean
    collectionId: string
  }> = []
  const active = new Set<number>()
  let sequence = 0
  adapter.applyCommittedTx = (collectionId, tx) => {
    calls.push({
      route: `public`,
      scope: [...active].at(-1),
      live: active.size === 0,
      collectionId: recordedStorageId(collectionId),
    })
    return direct(collectionId, tx)
  }
  adapter.runInHydrationScope = async (task) => {
    const scope = ++sequence
    active.add(scope)
    const scopedAdapter: PersistenceAdapter = {
      ...adapter,
      applyCommittedTx: (collectionId, tx) => {
        calls.push({
          route: `scoped`,
          scope,
          live: active.has(scope),
          collectionId: recordedStorageId(collectionId),
        })
        return direct(collectionId, tx)
      },
    }
    try {
      return await task(scopedAdapter)
    } finally {
      active.delete(scope)
    }
  }
  return { calls, violations: () => calls.filter((call) => !call.live) }
}

export const itUnlessAnyOracleReplay = oracleReplayTest(it)

export function createLocalCoordinatorHarness() {
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

/**
 * A notification is scoped to the physical cache generation that received
 * it. A peer may deliver an old-generation commit or reset while rotation holds the
 * wrapper's apply mutex; processing begins only after the new generation
 * binds. The model discards that old version at the generation boundary,
 * then requires the next new-generation notice to request reacquisition of
 * the active subset. The old generation may have a lower or higher row version than
 * the new notice, so physical identity rather than version order decides
 * authority. The history grammar varies an absent, commit, or reset old
 * notice; row versions on both sides; and an absent or present new notice.
 * No old notice and no new notice are work-count controls. This driver holds
 * rotation, queues any old notice before the physical ID changes, and checks
 * source requests after the old callback has crossed the apply mutex. A
 * persisting optimistic mutation holds the new source snapshot's applied
 * receipt. A constrained demand already pending at the coordinator must
 * remain pending until that receipt publishes the source row. Until then,
 * the refresh acquisition remains owned and the distinct notice-only row
 * cannot become public during scoped recovery. The controlled coordinator
 * supplies the receipt wait; the wrapper's settlement and publication are
 * the observations at this boundary.
 */
export type GenerationNoticeHistory = {
  retiredNotice: `none` | `commit` | `reset`
  retiredRowVersion: 1 | 10
  newRowVersion: 1 | 3
  newNotice: boolean
}

export const assertGenerationNoticeHistory = async ({
  retiredNotice,
  retiredRowVersion,
  newRowVersion,
  newNotice,
}: GenerationNoticeHistory): Promise<void> => {
  const adapter = createRecordingAdapter([
    { id: `retired`, title: `Retired cache row` },
  ])
  const coordinator = createCoordinatorHarness()
  const logicalId = `queued-peer-rotation`
  const oldStorageId = `queued-peer-old-storage`
  const newStorageId = `queued-peer-new-storage`
  const rotationEntered = createEventGate()
  const releaseRotation = createEventGate()
  const remoteEnsures: Array<string> = []
  const remoteEnsureOptions: Array<{
    id: string
    options: LoadSubsetOptions
  }> = []
  const demandEnsureEntered = createEventGate()
  const demandOptions: LoadSubsetOptions = {
    limit: 2,
    where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(`fresh`)]),
  }
  const sourceCommitReturned = createEventGate()
  const mutationEntered = createEventGate()
  const releaseMutation = createEventGate()
  let refreshReceipt: Promise<void> | undefined
  let refreshApplied = false
  const releaseCalls: Array<{
    id: string
    options: LoadSubsetOptions
    appliedAtRelease: boolean
  }> = []
  let freshRequestOptions: LoadSubsetOptions | undefined
  let newNoticeDelivered = false
  let freshWorkStarted = false
  let wrongGenerationReads = 0
  const originalLoadResumeSnapshot = adapter.loadResumeSnapshot
  adapter.loadResumeSnapshot = async (id, context) => {
    if (recordedStorageId(id) === logicalId) {
      wrongGenerationReads++
      throw new Error(`Retired reset must not read the logical cache ID`)
    }
    const snapshot = await originalLoadResumeSnapshot(id, context)
    return {
      ...snapshot,
      latestTerm: recordedStorageId(id) === oldStorageId ? 1 : 0,
      latestSeq: recordedStorageId(id) === oldStorageId ? retiredRowVersion : 0,
      latestRowVersion:
        recordedStorageId(id) === oldStorageId ? retiredRowVersion : 0,
    }
  }
  adapter.claimCacheGeneration = async () => ({
    storageCollectionId: oldStorageId,
    claimId: `queued-peer-claim`,
    expiresAtMs: Date.now() + 60_000,
  })
  adapter.renewCacheGenerationClaim = async () => Date.now() + 60_000
  adapter.rotateCacheGeneration = async () => {
    rotationEntered.resolve()
    await releaseRotation.promise
    return {
      storageCollectionId: newStorageId,
      claimId: `queued-peer-claim`,
      expiresAtMs: Date.now() + 60_000,
    }
  }
  adapter.releaseCacheGenerationClaim = async () => {}
  coordinator.requestEnsureRemoteSubset = async (id, options) => {
    remoteEnsures.push(id)
    remoteEnsureOptions.push({ id, options })
    if (options === demandOptions) {
      demandEnsureEntered.resolve()
      await sourceCommitReturned.promise
      await refreshReceipt
      return
    }
    if (
      newNoticeDelivered &&
      !freshWorkStarted &&
      options.refetch === true &&
      options.limit === demandOptions.limit
    ) {
      freshWorkStarted = true
      freshRequestOptions = options
      source.begin()
      source.write({
        type: `insert`,
        value: { id: `fresh`, title: `Fresh source row` },
      })
      const receipt = source.commit()
      if (receipt === true) throw new Error(`Source receipt was untracked`)
      refreshReceipt = receipt
      sourceCommitReturned.resolve()
      await receipt
      refreshApplied = true
    }
  }
  coordinator.requestReleaseRemoteSubset = async (id, options) => {
    releaseCalls.push({ id, options, appliedAtRelease: refreshApplied })
  }

  let source!: TodoSyncParams
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: logicalId,
      syncMode: `on-demand`,
      getKey: (row) => row.id,
      sync: {
        sync: (params) => {
          source = params
          params.markReady()
          return {
            restartAfterScopedRecovery: async (cacheRotated) => {
              await cacheRotated
            },
            loadSubset: async () => {},
            unloadSubset: async () => {},
          }
        },
      },
      persistence: { adapter, coordinator },
      onInsert: async () => {
        mutationEntered.resolve()
        await releaseMutation.promise
      },
    }),
  )
  let mutation: ReturnType<typeof collection.insert> | undefined
  let recovery: Promise<void> | undefined
  let demand: Promise<void> | undefined
  const publishedFreshTitles: Array<string | undefined> = []
  const publication = collection.subscribeChanges(
    (changes) => {
      if (changes.some((change) => change.key === `fresh`)) {
        publishedFreshTitles.push(collection.get(`fresh`)?.title)
      }
    },
    { includeInitialState: false },
  )
  let hasPrimaryFailure = false
  try {
    collection.startSyncImmediate()
    await collection.stateWhenReady()
    await source.metadata!.persistence!.hydrateBaseline()
    expect(collection.get(`retired`)?.title).toBe(`Retired cache row`)

    const persistence = source.metadata?.persistence
    if (!persistence?.startScopedRecovery) {
      throw new Error(`Expected scoped recovery capability`)
    }
    recovery = persistence.startScopedRecovery()
    void recovery.catch(() => undefined)
    await atPersistedOracleCheckpoint(
      rotationEntered.promise,
      `old physical cache rotation entered`,
    )
    // A queued old notice belongs to the still-subscribed old physical ID.
    if (retiredNotice !== `none`) {
      coordinator.emit(
        retiredNotice === `commit`
          ? {
              type: `tx:committed`,
              term: 1,
              seq: retiredRowVersion + 1,
              txId: `retired-generation-peer-row`,
              latestRowVersion: retiredRowVersion + 1,
              requiresFullReload: false,
              changedRows: [
                {
                  key: `retired`,
                  value: { id: `retired`, title: `Old peer row` },
                },
              ],
              deletedKeys: [],
            }
          : { type: `collection:reset`, schemaVersion: 1, resetEpoch: 1 },
        `peer`,
        oldStorageId,
      )
    }
    releaseRotation.resolve()
    await atPersistedOracleCheckpoint(recovery, `cache rotation settled`)
    // This scan enters the same apply mutex behind the old notice. Its
    // settlement is the checkpoint at which that notice can no longer
    // change the new generation's row-version observation.
    await persistence.scanPersistedRows()
    expect(wrongGenerationReads).toBe(0)
    expect(collection.status).toBe(`ready`)
    expect(collection.get(`retired`)).toBeUndefined()
    // Rotation reacquires this active subset once. The queued old notice
    // must not add another source request against the replacement cache.
    expect(remoteEnsures).toEqual([newStorageId])

    if (newNotice) {
      const pendingDemand = Promise.resolve(
        collection._sync.loadSubset(demandOptions),
      ).then(() => undefined)
      demand = pendingDemand
      void pendingDemand.catch(() => undefined)
      await atPersistedOracleCheckpoint(
        demandEnsureEntered.promise,
        `constrained demand entered source coordinator`,
      )
      expect(
        remoteEnsureOptions.filter(({ options }) => options === demandOptions),
      ).toEqual([{ id: newStorageId, options: demandOptions }])
      const demandSettlement = observeSettlement(pendingDemand)
      await flushAsyncWork()
      expect(demandSettlement.read()).toEqual({ status: `pending` })
      const ensuresBeforeNotice = remoteEnsures.length
      mutation = collection.insert({ id: `local`, title: `Pending` })
      await atPersistedOracleCheckpoint(
        mutationEntered.promise,
        `optimistic publication hold before new notice`,
      )
      newNoticeDelivered = true
      coordinator.emit(
        {
          type: `tx:committed`,
          term: 1,
          seq: newRowVersion,
          txId: `new-generation-peer-row`,
          latestRowVersion: newRowVersion,
          requiresFullReload: false,
          changedRows: [
            {
              key: `fresh`,
              value: { id: `fresh`, title: `Notice-only row` },
            },
          ],
          deletedKeys: [],
        },
        `peer`,
        newStorageId,
      )
      await atPersistedOracleCheckpoint(
        vi.waitFor(() =>
          expect(remoteEnsures.length).toBeGreaterThan(ensuresBeforeNotice),
        ),
        `new-generation source reacquisition after an old notice`,
      )
      expect(remoteEnsures.at(-1)).toBe(newStorageId)
      await atPersistedOracleCheckpoint(
        sourceCommitReturned.promise,
        `new-generation source receipt returned`,
      )
      expect(remoteEnsureOptions).toContainEqual({
        id: newStorageId,
        options: { ...demandOptions, refetch: true },
      })
      const applied = observeSettlement(refreshReceipt!)
      await flushAsyncWork()
      expect(freshRequestOptions).toBeDefined()
      expect(applied.read()).toEqual({ status: `pending` })
      expect(demandSettlement.read()).toEqual({ status: `pending` })
      expect(refreshApplied).toBe(false)
      expect(
        releaseCalls.filter(({ options }) => options === freshRequestOptions),
      ).toEqual([])
      expect(collection.get(`retired`)).toBeUndefined()
      expect(collection.get(`fresh`)).toBeUndefined()
      expect(publishedFreshTitles).toEqual([])
      releaseMutation.resolve()
      await atPersistedOracleCheckpoint<unknown>(
        mutation.isPersisted.promise,
        `optimistic publication released`,
      )
      await atPersistedOracleCheckpoint(
        vi.waitFor(() => expect(refreshApplied).toBe(true)),
        `fresh source snapshot applied`,
      )
      await atPersistedOracleCheckpoint(
        vi.waitFor(() =>
          expect(
            releaseCalls.filter(
              ({ options }) => options === freshRequestOptions,
            ),
          ).toHaveLength(1),
        ),
        `refresh acquisition released after application`,
      )
      expect(
        releaseCalls.filter(({ options }) => options === freshRequestOptions),
      ).toEqual([
        {
          id: newStorageId,
          options: freshRequestOptions,
          appliedAtRelease: true,
        },
      ])
      expect(collection.get(`fresh`)).toMatchObject({
        id: `fresh`,
        title: `Fresh source row`,
      })
      await atPersistedOracleCheckpoint(
        pendingDemand,
        `constrained demand settled`,
      )
      expect(demandSettlement.read()).toEqual({ status: `fulfilled` })
      expect(publishedFreshTitles).toEqual([`Fresh source row`])
    } else {
      await persistence.scanPersistedRows()
      expect(remoteEnsures).toEqual([newStorageId])
    }
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseRotation.resolve()
    releaseMutation.resolve()
    publication.unsubscribe()
    await cleanupPersistedOracle(
      [
        () => recovery,
        () => mutation?.isPersisted.promise.catch(() => undefined),
        () => demand?.catch(() => undefined),
        () => collection.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
}

/**
 * A follower routes demand it cannot serve to the elected owner. The owner
 * loads the rows upstream, commits them durably, and broadcasts the commit
 * before it answers the ensure request on the same channel. The follower
 * applies that broadcast asynchronously, by reading durable rows under its
 * apply mutex. Law 7 therefore owes: the follower's load settles only after
 * the broadcasts that preceded the reply have applied here, and it rejects,
 * with the runtime terminal, if applying them failed.
 *
 * The independent model knows only whether the owner's commit applies.
 * While that apply is held, no consumer of the demand has settled. If it
 * applies, the consumer settles successfully with the owner's row visible.
 * If it fails, the consumer rejects without the row, and the source is in
 * error. The model does not know how the follower queues commits.
 *
 * The grammar crosses where the owner's broadcast meets the follower with
 * whether its apply succeeds. A direct broadcast applies at once. A queued
 * broadcast arrives while another subset's hydration holds the apply mutex,
 * so it waits in the queue. A rotated history loses the cache claim after
 * the first hydration read, so the demand reacquires through the owner
 * under a new generation. An expired history lets the follower's cache
 * claim lapse while its ensure is in flight, so the owner's notice arrives
 * while the claim is expired; renewal keeps the same generation. The read
 * that applies the owner's row is the one
 * whose durable snapshot contains it; the driver holds that read to observe
 * the not-ready checkpoint, or fails it. The consumer is a live query
 * over the demanded rows or the follower's load itself. Observations, while
 * the apply is held and after it settles: whether the consumer settled, its
 * outcome, the demanded rows it sees when it settles (the query's
 * first-ready rows, or the source's rows at load settlement), and the
 * query's and source's status. A load that rejects owes the release of the
 * remote acquisition the owner granted it (LoadSubsetFn), so for the load
 * consumer the model also counts the follower's release requests for the
 * current cache generation when it settles. The coordinator
 * is a controlled double of an elected owner that broadcasts before it
 * replies, as the built-in coordinator does; the two-tab OPFS suite is the
 * receiving witness for the browser transport.
 *
 * A separate cell lets the claim lapse after the owner's row applied, so
 * the follower's renewal at the reply fails transiently. That is not claim
 * loss: the load rejects as after a failed ensure, and the demand stays
 * active and retries instead of releasing the owner's acquisition.
 *
 * Known gap (#2139): a rotated follower never ends scoped recovery, so the
 * owner's row never becomes visible in the rotated placement. Its cells are
 * pinned as failing, and the generated histories omit that placement. A
 * rotation that starts while a load waits for the owner's commits is also
 * outside this lane and tracked there.
 */
export type FollowerRemoteDemandHistory = {
  placement: `direct` | `queued` | `rotated` | `expired`
  apply: `ok` | `fails`
  // A live query over the demand, or the follower's load itself.
  consumer: `live-query` | `load`
  // The owner's row applies, then the claim lapses before the reply and
  // the follower's first renewal fails transiently.
  renewal?: `fails-at-reply`
}

export type FollowerRow = { id: string; group: string }

export function createFollowerTab(history: FollowerRemoteDemandHistory) {
  const durable: Array<FollowerRow> = []
  const applyRead = createDeferred()
  const applyReadStarted = createDeferred()
  const otherHydrationStarted = createDeferred()
  const otherHydration = createDeferred()
  let reads = 0
  let storageId = `follower-demand-cache-1`
  let loseClaim = false
  const claim = () => ({
    storageCollectionId: storageId,
    claimId: `follower-demand-claim`,
    expiresAtMs: Date.now() + 10_000,
  })
  const rotated = history.placement === `rotated`
  const expiring = history.placement === `expired`
  const renewalFailsAtReply = history.renewal === `fails-at-reply`
  let failRenewal = false
  let now = 1_000_000
  const adapter: PersistenceAdapter = {
    loadSubset: async () => {
      const read = ++reads
      const snapshot = durable.slice()
      if (snapshot.some((row) => row.id === `remote`)) {
        applyReadStarted.resolve()
        await applyRead.promise
        if (history.apply === `fails`) throw new Error(`apply read failed`)
      } else if (history.placement === `queued` && read === 2) {
        otherHydrationStarted.resolve()
        await otherHydration.promise
      }
      if (rotated && read === 1) loseClaim = true
      return snapshot.map((value) => ({ key: value.id, value }))
    },
    ...(expiring
      ? {
          getCacheGenerationNow: () => now,
          claimCacheGeneration: async () => ({
            storageCollectionId: storageId,
            claimId: `follower-demand-claim`,
            expiresAtMs: now + 10_000,
          }),
          // The claim is still held, so renewal keeps this generation.
          renewCacheGenerationClaim: async () => now + 10_000,
          rotateCacheGeneration: async () => {
            throw new Error(`an expired history must not rotate`)
          },
          releaseCacheGenerationClaim: async () => {},
        }
      : {}),
    ...(renewalFailsAtReply
      ? {
          getCacheGenerationNow: () => now,
          claimCacheGeneration: async () => ({
            storageCollectionId: storageId,
            claimId: `follower-demand-claim`,
            expiresAtMs: now + 10_000,
          }),
          // A transient storage error, not a lost claim.
          renewCacheGenerationClaim: async () => {
            if (failRenewal) {
              failRenewal = false
              throw new Error(`transient renewal failure`)
            }
            return now + 10_000
          },
          rotateCacheGeneration: async () => {
            throw new Error(`a transient renewal failure must not rotate`)
          },
          releaseCacheGenerationClaim: async () => {},
        }
      : {}),
    ...(rotated
      ? {
          claimCacheGeneration: async () => claim(),
          renewCacheGenerationClaim: async () =>
            loseClaim ? undefined : Date.now() + 10_000,
          rotateCacheGeneration: async () => {
            loseClaim = false
            storageId = `follower-demand-cache-2`
            return claim()
          },
          releaseCacheGenerationClaim: async () => {},
        }
      : {}),
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
    applyCommittedTx: async () => {},
    ensureIndex: async () => {},
  } as PersistenceAdapter
  let subscriber: ((message: ProtocolEnvelope<unknown>) => void) | undefined
  let ensures = 0
  let releases = 0
  let resetPending = false
  const coordinator: PersistedCollectionCoordinator = {
    getNodeId: () => `follower`,
    subscribe: (_collectionId, onMessage) => {
      subscriber = onMessage
      return () => {
        subscriber = undefined
      }
    },
    publish: () => {},
    isLeader: () => false,
    ensureLeadership: async () => {},
    requestEnsurePersistedIndex: async () => {},
    // The owner commits once, broadcasts, then replies; later ensures find
    // nothing new.
    requestEnsureRemoteSubset: async (collectionId) => {
      if (++ensures > 1 && !resetPending) return
      resetPending = false
      if (history.placement === `queued`) await otherHydrationStarted.promise
      // The follower's claim lapses before the owner's notice reaches it.
      if (expiring) now += 20_000
      const value = { id: `remote`, group: `a` }
      durable.push(value)
      const payload: TxCommitted = {
        type: `tx:committed`,
        term: 1,
        seq: ensures,
        txId: `owner-tx-${ensures}`,
        latestRowVersion: ensures,
        requiresFullReload: false,
        changedRows: [{ key: value.id, value }],
        deletedKeys: [],
      }
      subscriber?.({
        v: 1,
        dbName: `test-db`,
        collectionId,
        senderId: `owner`,
        ts: Date.now(),
        payload,
      })
      if (renewalFailsAtReply) {
        // Let the owner's row apply here before the claim lapses.
        for (let i = 0; i < 5; i++)
          await new Promise((resolve) => setTimeout(resolve, 0))
        now += 20_000
        failRenewal = true
      }
    },
    // Rotation legitimately releases the previous generation's
    // acquisition, so only the current generation's releases count.
    requestReleaseRemoteSubset: async (collectionId) => {
      if (!rotated || collectionId === storageId) releases++
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
    pullSince: () =>
      Promise.resolve({
        type: `rpc:pullSince:res`,
        rpcId: `follower-demand-pull`,
        ok: true,
        latestTerm: 1,
        latestSeq: 0,
        latestRowVersion: 0,
        requiresFullReload: false,
        changedKeys: [],
        deletedKeys: [],
      }),
  }
  const source = createCollection(
    persistedCollectionOptions<FollowerRow, string>({
      id: `follower-demand-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      persistence: { adapter, coordinator },
      syncMode: `on-demand`,
      sync: {
        sync: () => ({
          loadSubset: () => Promise.resolve(),
          restartAfterScopedRecovery: () => {},
        }),
      },
    }),
  )
  source.startSyncImmediate()
  return {
    source,
    applyReadStarted: applyReadStarted.promise,
    otherHydrationStarted: otherHydrationStarted.promise,
    releaseApply: () => applyRead.resolve(),
    releaseOtherHydration: () => otherHydration.resolve(),
    releases: () => releases,
    ensures: () => ensures,
    // The owner resets durable storage and announces it; it loads the
    // demanded row again on the next ensure.
    resetOwner: () => {
      durable.length = 0
      resetPending = true
      subscriber?.({
        v: 1,
        dbName: `test-db`,
        collectionId: source.id,
        senderId: `owner`,
        ts: Date.now(),
        payload: {
          type: `collection:reset`,
          schemaVersion: 1,
          resetEpoch: 1,
        },
      })
    },
  }
}

// Wait for a driver event, but turn a missing event into an observation
// rather than a timeout.
export const within = (promise: Promise<unknown>, ms = 200) =>
  Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ])

// A path replay of one of these properties runs this suite. A replay of any
// other property stands it aside.
export const describeUnlessOracleReplay = oracleReplayTest(
  describe,
  `persistence.retained-demand`,
  `persistence.generation-notice`,
  `persistence.follower-remote-demand`,
)

export const describeUnlessAnyOracleReplay = oracleReplayTest(describe)

export const generationNoticeHistory = fc.record({
  retiredNotice: fc.constantFrom<GenerationNoticeHistory[`retiredNotice`]>(
    `none`,
    `commit`,
    `reset`,
  ),
  retiredRowVersion: fc.constantFrom<
    GenerationNoticeHistory[`retiredRowVersion`]
  >(1, 10),
  newRowVersion: fc.constantFrom<GenerationNoticeHistory[`newRowVersion`]>(
    1,
    3,
  ),
  newNotice: fc.boolean(),
})
