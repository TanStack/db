import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  InvalidPersistedCollectionConfigError,
  persistedCollectionOptions,
} from '@tanstack/db-sqlite-persistence-core'
import { createNodeSQLitePersistence } from '@tanstack/node-db-sqlite-persistence'
import { IR, createCollection } from '../../db/src'
import { BetterSqlite3SQLiteDriver } from '../../node-db-sqlite-persistence/src/node-driver'
import {
  ElectronCollectionCoordinator,
  createElectronSQLitePersistence,
  exposeElectronSQLitePersistence,
} from '../src'
import {
  DEFAULT_ELECTRON_PERSISTENCE_CHANNEL,
  ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
} from '../src/protocol'
import {
  createElectronRuntimeBridgeInvoke,
  isElectronFullE2EEnabled,
} from './e2e/electron-process-client'
import type {
  ApplyCommittedTxRequest,
  ApplyLocalMutationsRequest,
  IndeterminateCommitError,
  PersistedCollectionDurabilityError,
  PersistedCollectionPersistence,
  PersistedTx,
  PersistenceAdapter,
  RemoteSubsetOwner,
  TransportedLoadSubsetOptions,
} from '@tanstack/db-sqlite-persistence-core'
import type { LoadSubsetOptions, Subscription, SyncConfig } from '../../db/src'
import type {
  ElectronPersistenceInvoke,
  ElectronPersistenceRequestEnvelope,
  ElectronPersistenceResponseEnvelope,
} from '../src/protocol'

type InvokeHarness = {
  invoke: ElectronPersistenceInvoke
  close: () => void
}

type CoordinatorInvokeHarness = {
  coordinator: ElectronCollectionCoordinator
  persistence: PersistedCollectionPersistence
  appliedTransactions: Array<PersistedTx>
  committedPayloads: Array<Record<string, unknown>>
  start: () => void
  close: () => void
}

type ElectronMainPersistence = PersistedCollectionPersistence

const electronRuntimeBridgeTimeoutMs = isElectronFullE2EEnabled()
  ? 45_000
  : 4_000

function createFilteredPersistence(
  collectionId: string,
  allowAnyCollectionId: boolean,
  persistence: ElectronMainPersistence,
): ElectronMainPersistence {
  if (allowAnyCollectionId) {
    return persistence
  }

  const baseAdapter = persistence.adapter
  const assertKnownCollection = (requestedCollectionId: string) => {
    if (requestedCollectionId !== collectionId) {
      const error = new Error(
        `Unknown electron persistence collection "${requestedCollectionId}"`,
      )
      error.name = `UnknownElectronPersistenceCollectionError`
      ;(error as Error & { code?: string }).code = `UNKNOWN_COLLECTION`
      throw error
    }
  }

  const adapter: ElectronMainPersistence[`adapter`] = {
    loadSubset: (requestedCollectionId, options, ctx) => {
      assertKnownCollection(requestedCollectionId)
      return baseAdapter.loadSubset(requestedCollectionId, options, ctx)
    },
    applyCommittedTx: (requestedCollectionId, tx) => {
      assertKnownCollection(requestedCollectionId)
      return baseAdapter.applyCommittedTx(requestedCollectionId, tx)
    },
    ensureIndex: (requestedCollectionId, signature, spec) => {
      assertKnownCollection(requestedCollectionId)
      return baseAdapter.ensureIndex(requestedCollectionId, signature, spec)
    },
    markIndexRemoved: (requestedCollectionId, signature) => {
      assertKnownCollection(requestedCollectionId)
      if (!baseAdapter.markIndexRemoved) {
        return Promise.resolve()
      }
      return baseAdapter.markIndexRemoved(requestedCollectionId, signature)
    },
  }

  return {
    coordinator: persistence.coordinator,
    adapter,
  }
}

function createInvokeHarness(
  dbPath: string,
  collectionId: string,
  allowAnyCollectionId: boolean = true,
): InvokeHarness {
  if (isElectronFullE2EEnabled()) {
    return {
      invoke: createElectronRuntimeBridgeInvoke({
        dbPath,
        collectionId,
        allowAnyCollectionId,
        timeoutMs: electronRuntimeBridgeTimeoutMs,
      }),
      close: () => {},
    }
  }

  const driver = new BetterSqlite3SQLiteDriver({ filename: dbPath })
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
  })
  const filteredPersistence = createFilteredPersistence(
    collectionId,
    allowAnyCollectionId,
    persistence,
  )

  let handler:
    | ((
        event: unknown,
        request: ElectronPersistenceRequestEnvelope,
      ) => Promise<ElectronPersistenceResponseEnvelope>)
    | undefined

  const ipcMainLike = {
    handle: (
      _channel: string,
      listener: (
        event: unknown,
        request: ElectronPersistenceRequestEnvelope,
      ) => Promise<ElectronPersistenceResponseEnvelope>,
    ) => {
      handler = listener
    },
    removeHandler: () => {},
  }
  const dispose = exposeElectronSQLitePersistence({
    ipcMain: ipcMainLike,
    persistence: filteredPersistence,
  })

  return {
    invoke: async (_channel, request) => {
      if (!handler) {
        throw new Error(`Electron IPC handler was not registered`)
      }
      return handler(undefined, request)
    },
    close: () => {
      dispose()
      driver.close()
    },
  }
}

const activeCleanupFns: Array<() => void> = []

function registerCleanup(cleanupFn: () => void): () => void {
  let cleanupPending = true
  const cleanupOnce = () => {
    if (!cleanupPending) return
    cleanupPending = false
    cleanupFn()
  }
  activeCleanupFns.push(cleanupOnce)
  return cleanupOnce
}

afterEach(() => {
  while (activeCleanupFns.length > 0) {
    const cleanupFn = activeCleanupFns.pop()
    cleanupFn?.()
  }
})

function createTempDbPath(): string {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-electron-ipc-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  activeCleanupFns.push(() => {
    rmSync(tempDirectory, { recursive: true, force: true })
  })
  return dbPath
}

function installImmediatelyGrantedWebLocks(): () => void {
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    `navigator`,
  )
  const navigatorValue = globalThis.navigator

  Object.defineProperty(globalThis, `navigator`, {
    value: {
      ...navigatorValue,
      locks: {
        request: async (
          name: string,
          optionsOrCallback:
            | { signal?: AbortSignal }
            | ((lock: { name: string }) => Promise<unknown>),
          maybeCallback?: (lock: { name: string }) => Promise<unknown>,
        ): Promise<unknown> => {
          const callback =
            typeof optionsOrCallback === `function`
              ? optionsOrCallback
              : maybeCallback!
          return callback({ name })
        },
      },
    },
    writable: true,
    configurable: true,
  })

  return () => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, `navigator`, originalNavigator)
    } else {
      Reflect.deleteProperty(globalThis, `navigator`)
    }
  }
}

async function waitForLeadership(
  coordinator: ElectronCollectionCoordinator,
  collectionId: string,
): Promise<void> {
  const deadline = Date.now() + electronRuntimeBridgeTimeoutMs
  while (Date.now() < deadline) {
    if (coordinator.isLeader(collectionId)) return
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Electron coordinator did not acquire leadership`)
}

function electronSubsetWithNestedValue(value: unknown): LoadSubsetOptions {
  return {
    where: new IR.Func(`in`, [
      new IR.PropRef([`todos`, `status`]),
      new IR.Value([`kept`, value]),
    ]),
  }
}

function createElectronCoordinatorTestAdapter(): PersistenceAdapter {
  return {
    loadSubset: () => Promise.resolve([]),
    applyCommittedTx: () => Promise.resolve(),
    ensureIndex: () => Promise.resolve(),
  }
}

function createCoordinatorInvokeHarness(
  dbPath: string,
  dbName: string,
): CoordinatorInvokeHarness {
  const invokeHarness = createInvokeHarness(dbPath, `todos`)
  const coordinator = new ElectronCollectionCoordinator({ dbName })
  const appliedTransactions: Array<PersistedTx> = []
  const committedPayloads: Array<Record<string, unknown>> = []
  const persistence = createElectronSQLitePersistence({
    coordinator,
    invoke: async (channel, request) => {
      if (request.method === `applyCommittedTx`) {
        appliedTransactions.push(structuredClone(request.payload.tx))
      }
      return invokeHarness.invoke(channel, request)
    },
    timeoutMs: electronRuntimeBridgeTimeoutMs,
  })
  const close = registerCleanup(() => {
    try {
      coordinator.dispose()
    } finally {
      invokeHarness.close()
    }
  })

  return {
    coordinator,
    persistence,
    appliedTransactions,
    committedPayloads,
    start: () => {
      coordinator.subscribe(`todos`, (message) => {
        const payload = message.payload as Record<string, unknown>
        if (payload.type === `tx:committed`) {
          committedPayloads.push(payload)
        }
      })
    },
    close,
  }
}

describe(`electron sqlite persistence bridge`, () => {
  it(`round-trips reads and writes through main process`, async () => {
    const dbPath = createTempDbPath()
    const invokeHarness = createInvokeHarness(dbPath, `todos`)
    activeCleanupFns.push(() => invokeHarness.close())

    const rendererPersistence = createElectronSQLitePersistence({
      invoke: async (channel, request) => {
        expect(channel).toBe(DEFAULT_ELECTRON_PERSISTENCE_CHANNEL)
        return invokeHarness.invoke(channel, request)
      },
      timeoutMs: electronRuntimeBridgeTimeoutMs,
    })

    await rendererPersistence.adapter.applyCommittedTx(`todos`, {
      txId: `tx-1`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        {
          type: `insert`,
          key: `1`,
          value: {
            id: `1`,
            title: `From renderer`,
            score: 10,
          },
        },
      ],
    })

    const rows = await rendererPersistence.adapter.loadSubset(`todos`, {})
    expect(rows).toEqual([
      {
        key: `1`,
        value: {
          id: `1`,
          title: `From renderer`,
          score: 10,
        },
      },
    ])
  })

  it(`persists data across main process restarts`, async () => {
    const dbPath = createTempDbPath()

    if (isElectronFullE2EEnabled()) {
      const invoke = createElectronRuntimeBridgeInvoke({
        dbPath,
        collectionId: `todos`,
        timeoutMs: electronRuntimeBridgeTimeoutMs,
      })
      const rendererPersistence = createElectronSQLitePersistence({
        invoke,
        timeoutMs: electronRuntimeBridgeTimeoutMs,
      })

      await rendererPersistence.adapter.applyCommittedTx(`todos`, {
        txId: `tx-restart-1`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `persisted`,
            value: {
              id: `persisted`,
              title: `Survives restart`,
              score: 42,
            },
          },
        ],
      })

      const rows = await rendererPersistence.adapter.loadSubset(`todos`, {})
      expect(rows[0]?.value.title).toBe(`Survives restart`)
      return
    }

    const invokeHarnessA = createInvokeHarness(dbPath, `todos`)
    const rendererPersistenceA = createElectronSQLitePersistence({
      invoke: invokeHarnessA.invoke,
      timeoutMs: electronRuntimeBridgeTimeoutMs,
    })
    await rendererPersistenceA.adapter.applyCommittedTx(`todos`, {
      txId: `tx-restart-1`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        {
          type: `insert`,
          key: `persisted`,
          value: {
            id: `persisted`,
            title: `Survives restart`,
            score: 42,
          },
        },
      ],
    })
    invokeHarnessA.close()

    const invokeHarnessB = createInvokeHarness(dbPath, `todos`)
    activeCleanupFns.push(() => invokeHarnessB.close())
    const rendererPersistenceB = createElectronSQLitePersistence({
      invoke: invokeHarnessB.invoke,
      timeoutMs: electronRuntimeBridgeTimeoutMs,
    })
    const rows = await rendererPersistenceB.adapter.loadSubset(`todos`, {})
    expect(rows[0]?.value.title).toBe(`Survives restart`)
  })

  it(`preserves coordinator row metadata updates across restarts`, async () => {
    const dbPath = createTempDbPath()
    registerCleanup(installImmediatelyGrantedWebLocks())
    const metadataSetHarness = createCoordinatorInvokeHarness(
      dbPath,
      `electron-metadata-set`,
    )

    await metadataSetHarness.persistence.adapter.applyCommittedTx(`todos`, {
      txId: `seed-row`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        {
          type: `insert`,
          key: `todo-1`,
          value: { id: `todo-1`, title: `Before` },
        },
      ],
    })
    metadataSetHarness.appliedTransactions.length = 0
    metadataSetHarness.start()
    await waitForLeadership(metadataSetHarness.coordinator, `todos`)

    const setResponse =
      await metadataSetHarness.coordinator.requestApplyLocalMutations(`todos`, [
        {
          mutationId: `metadata-set`,
          type: `update`,
          key: `todo-1`,
          value: { id: `todo-1`, title: `After set` },
          metadataChanged: true,
          metadata: { source: `local`, revision: 2 },
        },
      ])
    const setScannedRows =
      await metadataSetHarness.persistence.adapter.scanRows?.(`todos`)
    const setAppliedTransaction = metadataSetHarness.appliedTransactions[0]
    const setCommittedPayload = metadataSetHarness.committedPayloads[0]

    expect({
      response:
        setResponse.ok === true
          ? {
              ok: setResponse.ok,
              acceptedMutationIds: setResponse.acceptedMutationIds,
            }
          : setResponse,
      appliedTransactionCount: metadataSetHarness.appliedTransactions.length,
      appliedMutation: setAppliedTransaction?.mutations[0],
      appliedRowMetadataMutations:
        setAppliedTransaction?.rowMetadataMutations ?? null,
      committedPayloadCount: metadataSetHarness.committedPayloads.length,
      committedType: setCommittedPayload?.type,
      committedRowMetadataMutations:
        setCommittedPayload?.rowMetadataMutations ?? null,
      committedChangedRows: setCommittedPayload?.changedRows,
      committedDeletedKeys: setCommittedPayload?.deletedKeys,
      scannedRows: setScannedRows,
    }).toEqual({
      response: {
        ok: true,
        acceptedMutationIds: [`metadata-set`],
      },
      appliedTransactionCount: 1,
      appliedMutation: {
        type: `update`,
        key: `todo-1`,
        value: { id: `todo-1`, title: `After set` },
        metadataChanged: true,
        metadata: { source: `local`, revision: 2 },
      },
      appliedRowMetadataMutations: [
        {
          type: `set`,
          key: `todo-1`,
          value: { source: `local`, revision: 2 },
        },
      ],
      committedPayloadCount: 1,
      committedType: `tx:committed`,
      committedRowMetadataMutations: [
        {
          type: `set`,
          key: `todo-1`,
          value: { source: `local`, revision: 2 },
        },
      ],
      committedChangedRows: [
        {
          key: `todo-1`,
          value: { id: `todo-1`, title: `After set` },
        },
      ],
      committedDeletedKeys: [],
      scannedRows: [
        {
          key: `todo-1`,
          value: { id: `todo-1`, title: `After set` },
          metadata: { source: `local`, revision: 2 },
        },
      ],
    })

    metadataSetHarness.close()

    const metadataDeleteHarness = createCoordinatorInvokeHarness(
      dbPath,
      `electron-metadata-delete`,
    )
    expect(
      await metadataDeleteHarness.persistence.adapter.scanRows?.(`todos`),
    ).toEqual([
      {
        key: `todo-1`,
        value: { id: `todo-1`, title: `After set` },
        metadata: { source: `local`, revision: 2 },
      },
    ])

    metadataDeleteHarness.start()
    await waitForLeadership(metadataDeleteHarness.coordinator, `todos`)
    const deleteResponse =
      await metadataDeleteHarness.coordinator.requestApplyLocalMutations(
        `todos`,
        [
          {
            mutationId: `metadata-delete`,
            type: `update`,
            key: `todo-1`,
            value: { id: `todo-1`, title: `After delete` },
            metadataChanged: true,
          },
        ],
      )
    const deleteScannedRows =
      await metadataDeleteHarness.persistence.adapter.scanRows?.(`todos`)
    const deleteAppliedTransaction =
      metadataDeleteHarness.appliedTransactions[0]
    const deleteCommittedPayload = metadataDeleteHarness.committedPayloads[0]

    expect({
      response:
        deleteResponse.ok === true
          ? {
              ok: deleteResponse.ok,
              acceptedMutationIds: deleteResponse.acceptedMutationIds,
            }
          : deleteResponse,
      appliedTransactionCount: metadataDeleteHarness.appliedTransactions.length,
      appliedMutation: deleteAppliedTransaction?.mutations[0],
      appliedRowMetadataMutations:
        deleteAppliedTransaction?.rowMetadataMutations ?? null,
      committedPayloadCount: metadataDeleteHarness.committedPayloads.length,
      committedType: deleteCommittedPayload?.type,
      committedRowMetadataMutations:
        deleteCommittedPayload?.rowMetadataMutations ?? null,
      committedChangedRows: deleteCommittedPayload?.changedRows,
      committedDeletedKeys: deleteCommittedPayload?.deletedKeys,
      scannedRows: deleteScannedRows,
    }).toEqual({
      response: {
        ok: true,
        acceptedMutationIds: [`metadata-delete`],
      },
      appliedTransactionCount: 1,
      appliedMutation: {
        type: `update`,
        key: `todo-1`,
        value: { id: `todo-1`, title: `After delete` },
        metadataChanged: true,
        metadata: undefined,
      },
      appliedRowMetadataMutations: [{ type: `delete`, key: `todo-1` }],
      committedPayloadCount: 1,
      committedType: `tx:committed`,
      committedRowMetadataMutations: [{ type: `delete`, key: `todo-1` }],
      committedChangedRows: [
        {
          key: `todo-1`,
          value: { id: `todo-1`, title: `After delete` },
        },
      ],
      committedDeletedKeys: [],
      scannedRows: [
        {
          key: `todo-1`,
          value: { id: `todo-1`, title: `After delete` },
          metadata: undefined,
        },
      ],
    })

    metadataDeleteHarness.close()

    const reopenedInvokeHarness = createInvokeHarness(dbPath, `todos`)
    const closeReopenedHarness = registerCleanup(reopenedInvokeHarness.close)
    const reopenedPersistence = createElectronSQLitePersistence({
      invoke: reopenedInvokeHarness.invoke,
      timeoutMs: electronRuntimeBridgeTimeoutMs,
    })
    expect(await reopenedPersistence.adapter.scanRows?.(`todos`)).toEqual([
      {
        key: `todo-1`,
        value: { id: `todo-1`, title: `After delete` },
        metadata: undefined,
      },
    ])
    closeReopenedHarness()
  })

  it(`routes a rich source transaction through the Electron owner and durable reopen`, async () => {
    type Todo = { id: string; title: string }
    type SourceParams = Parameters<SyncConfig<Todo, string>[`sync`]>[0]

    const dbPath = createTempDbPath()
    registerCleanup(installImmediatelyGrantedWebLocks())
    const ownerHarness = createCoordinatorInvokeHarness(
      dbPath,
      `electron-rich-source`,
    )

    await ownerHarness.persistence.adapter.applyCommittedTx(`todos`, {
      txId: `stale-seed`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        {
          type: `insert`,
          key: `stale`,
          value: { id: `stale`, title: `Must be truncated` },
        },
      ],
    })
    ownerHarness.appliedTransactions.length = 0
    ownerHarness.start()
    await waitForLeadership(ownerHarness.coordinator, `todos`)

    let sourceParams: SourceParams | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `todos`,
        getKey: (todo) => todo.id,
        sync: {
          sync: (params) => {
            sourceParams = params
            params.markReady()
          },
        },
        persistence: ownerHarness.persistence,
      }),
    )

    try {
      await collection.stateWhenReady()
      sourceParams!.begin()
      sourceParams!.metadata?.collection.set(`resume`, { offset: 9 })
      sourceParams!.truncate()
      sourceParams!.write({
        type: `insert`,
        value: { id: `fresh`, title: `Durable through owner` },
        metadata: { source: `electron-sync` },
      })
      const receipt = sourceParams!.commit()
      if (receipt !== true) await receipt

      expect(collection.has(`stale`)).toBe(false)
      expect(collection.get(`fresh`)).toMatchObject({
        id: `fresh`,
        title: `Durable through owner`,
      })
      expect(ownerHarness.appliedTransactions).toHaveLength(1)
      expect(ownerHarness.appliedTransactions[0]).toMatchObject({
        truncate: true,
        mutations: [
          {
            type: `update`,
            key: `fresh`,
            value: { id: `fresh`, title: `Durable through owner` },
          },
        ],
        rowMetadataMutations: [
          {
            type: `set`,
            key: `fresh`,
            value: { source: `electron-sync` },
          },
        ],
        collectionMetadataMutations: [
          { type: `set`, key: `resume`, value: { offset: 9 } },
        ],
      })
      expect(ownerHarness.committedPayloads).toHaveLength(1)
      expect(ownerHarness.committedPayloads[0]).toMatchObject({
        type: `tx:committed`,
        requiresFullReload: true,
      })
    } finally {
      await collection.cleanup()
    }

    ownerHarness.close()

    const reopenedInvokeHarness = createInvokeHarness(dbPath, `todos`)
    const closeReopenedHarness = registerCleanup(reopenedInvokeHarness.close)
    const reopenedPersistence = createElectronSQLitePersistence({
      invoke: reopenedInvokeHarness.invoke,
      timeoutMs: electronRuntimeBridgeTimeoutMs,
    })
    expect(await reopenedPersistence.adapter.scanRows?.(`todos`)).toEqual([
      {
        key: `fresh`,
        value: { id: `fresh`, title: `Durable through owner` },
        metadata: { source: `electron-sync` },
      },
    ])
    expect(
      await reopenedPersistence.adapter.loadCollectionMetadata?.(`todos`),
    ).toEqual([{ key: `resume`, value: { offset: 9 } }])
    closeReopenedHarness()
  })

  it(
    `does not retry a committed transaction after the writer callback starts`,
    { timeout: 10_000 },
    async () => {
      registerCleanup(installImmediatelyGrantedWebLocks())
      const persistenceError = new Error(`irreversible apply failed`)
      let applyCalls = 0
      const coordinator = new ElectronCollectionCoordinator({
        dbName: `electron-writer-callback-failure`,
        adapter: {
          loadSubset: () => Promise.resolve([]),
          applyCommittedTx: () => {
            applyCalls++
            return Promise.reject(persistenceError)
          },
          ensureIndex: () => Promise.resolve(),
        },
      })
      registerCleanup(() => coordinator.dispose())
      coordinator.subscribe(`todos`, () => {})
      await waitForLeadership(coordinator, `todos`)

      await expect(
        coordinator.requestApplyCommittedTx(`todos`, {
          txId: `irreversible-effect`,
          term: 0,
          seq: 0,
          rowVersion: 0,
          mutations: [],
        }),
      ).rejects.toMatchObject({
        name: `PersistedCollectionDurabilityError`,
        cause: persistenceError,
      } satisfies Partial<PersistedCollectionDurabilityError>)
      expect(applyCalls).toBe(1)
    },
  )

  it(`fails indeterminate instead of retrying a committed mutation across leaders`, async () => {
    const bEffects: Array<PersistedTx> = []
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-requester-takeover`,
      adapter: {
        loadSubset: () => Promise.resolve([]),
        applyCommittedTx: (_collectionId, tx) => {
          bEffects.push(tx)
          return Promise.resolve()
        },
        ensureIndex: () => Promise.resolve(),
      },
    })
    registerCleanup(() => coordinator.dispose())
    const internals = coordinator as unknown as {
      nodeId: string
      onChannelMessage: (message: unknown) => void
      acquireLeadership: () => Promise<void>
    }
    internals.acquireLeadership = async () => {}
    const heartbeat = (leaderId: string, term: number) => ({
      v: 1,
      dbName: `electron-requester-takeover`,
      collectionId: `todos`,
      senderId: leaderId,
      ts: Date.now(),
      payload: {
        type: `leader:heartbeat`,
        term,
        leaderId,
        latestSeq: 0,
        latestRowVersion: 0,
      },
    })
    internals.onChannelMessage(heartbeat(`electron-leader-a`, 4))
    const transportError = new Error(`leader A response was lost`)
    const aEffects: Array<PersistedTx> = []
    let aPublications = 0
    let bPublications = 0
    let transportCalls = 0
    const failedTransport = vi.fn(
      (_collectionId: string, request: ApplyCommittedTxRequest) => {
        transportCalls++
        if (transportCalls === 1) {
          aEffects.push(structuredClone(request.tx))
          aPublications++
          internals.onChannelMessage(heartbeat(`electron-leader-b`, 5))
          return Promise.reject(transportError)
        }
        bEffects.push(structuredClone(request.tx))
        bPublications++
        return Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: request.rpcId,
          ok: true,
          term: 5,
          seq: 1,
          latestRowVersion: 1,
        })
      },
    )
    Object.defineProperty(coordinator, `sendRPCOnce`, {
      value: failedTransport,
      configurable: true,
    })

    vi.useFakeTimers()
    try {
      const outcomePromise = coordinator
        .requestApplyCommittedTx(`todos`, {
          txId: `requester-takeover`,
          term: 0,
          seq: 0,
          rowVersion: 0,
          mutations: [
            {
              type: `insert`,
              key: `takeover`,
              value: { id: `takeover` },
            },
          ],
        })
        .then(
          (response) => ({ response }),
          (error: unknown) => ({ error }),
        )

      await vi.advanceTimersByTimeAsync(1_000)
      const outcome = await outcomePromise

      expect(outcome).toEqual({
        error: expect.objectContaining({
          name: `IndeterminateCommitError`,
          code: `INDETERMINATE_COMMIT`,
          collectionId: `todos`,
          requestType: `rpc:applyCommittedTx:req`,
          previousLeaderId: `electron-leader-a`,
          previousTerm: 4,
          currentLeaderId: `electron-leader-b`,
          currentTerm: 5,
          cause: transportError,
        } satisfies Partial<IndeterminateCommitError>),
      })
      expect(failedTransport).toHaveBeenCalledTimes(1)
      expect(aEffects).toHaveLength(1)
      expect(aPublications).toBe(1)
      expect(aEffects[0]?.txId).toBe(`requester-takeover`)
      expect(bEffects).toEqual([])
      expect(bPublications).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it(`fails indeterminate instead of retrying a committed transaction without an initial leader route`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-unknown-leader-committed`,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    registerCleanup(() => coordinator.dispose())
    const transportError = new Error(`unknown leader response was lost`)
    const attemptedTransactions: Array<PersistedTx> = []
    const failedTransport = vi.fn(
      (_collectionId: string, request: ApplyCommittedTxRequest) => {
        attemptedTransactions.push(structuredClone(request.tx))
        if (attemptedTransactions.length === 1) {
          return Promise.reject(transportError)
        }
        return Promise.resolve({
          type: `rpc:applyCommittedTx:res` as const,
          rpcId: request.rpcId,
          ok: true as const,
          term: 1,
          seq: 1,
          latestRowVersion: 1,
        })
      },
    )
    Object.defineProperty(coordinator, `sendRPCOnce`, {
      value: failedTransport,
      configurable: true,
    })

    const outcome = await coordinator
      .requestApplyCommittedTx(`todos`, {
        txId: `electron-unknown-leader-committed`,
        term: 0,
        seq: 0,
        rowVersion: 0,
        mutations: [
          {
            type: `insert`,
            key: `electron-unknown-leader-committed`,
            value: { id: `electron-unknown-leader-committed` },
          },
        ],
      })
      .then(
        (response) => ({ response }),
        (error: unknown) => ({ error }),
      )

    expect(outcome).toEqual({
      error: expect.objectContaining({
        name: `IndeterminateCommitError`,
        code: `INDETERMINATE_COMMIT`,
        collectionId: `todos`,
        requestType: `rpc:applyCommittedTx:req`,
        previousLeaderId: null,
        previousTerm: null,
        currentLeaderId: null,
        currentTerm: null,
        cause: transportError,
      } satisfies Partial<IndeterminateCommitError>),
    })
    expect(failedTransport).toHaveBeenCalledTimes(1)
    expect(attemptedTransactions).toEqual([
      {
        txId: `electron-unknown-leader-committed`,
        term: 0,
        seq: 0,
        rowVersion: 0,
        mutations: [
          {
            type: `insert`,
            key: `electron-unknown-leader-committed`,
            value: { id: `electron-unknown-leader-committed` },
          },
        ],
      },
    ])
  })

  it(`fails indeterminate instead of retrying local mutations across leaders`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-local-requester-takeover`,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    registerCleanup(() => coordinator.dispose())
    const internals = coordinator as unknown as {
      onChannelMessage: (message: unknown) => void
      acquireLeadership: () => Promise<void>
    }
    internals.acquireLeadership = async () => {}
    const heartbeat = (leaderId: string, term: number) => ({
      v: 1,
      dbName: `electron-local-requester-takeover`,
      collectionId: `todos`,
      senderId: leaderId,
      ts: Date.now(),
      payload: {
        type: `leader:heartbeat`,
        term,
        leaderId,
        latestSeq: 0,
        latestRowVersion: 0,
      },
    })
    internals.onChannelMessage(heartbeat(`electron-local-leader-a`, 7))
    const transportError = new Error(`leader A local response was lost`)
    const aEffects: Array<unknown> = []
    const bEffects: Array<unknown> = []
    let aPublications = 0
    let bPublications = 0
    let transportCalls = 0
    const failedTransport = vi.fn(
      (_collectionId: string, request: ApplyLocalMutationsRequest) => {
        transportCalls++
        if (transportCalls === 1) {
          aEffects.push(structuredClone(request.mutations))
          aPublications++
          internals.onChannelMessage(heartbeat(`electron-local-leader-b`, 8))
          return Promise.reject(transportError)
        }
        bEffects.push(structuredClone(request.mutations))
        bPublications++
        return Promise.resolve({
          type: `rpc:applyLocalMutations:res`,
          rpcId: request.rpcId,
          ok: true,
          term: 8,
          seq: 1,
          latestRowVersion: 1,
          acceptedMutationIds: request.mutations.map(
            (mutation) => mutation.mutationId,
          ),
        })
      },
    )
    Object.defineProperty(coordinator, `sendRPCOnce`, {
      value: failedTransport,
      configurable: true,
    })

    const outcome = await coordinator
      .requestApplyLocalMutations(`todos`, [
        {
          mutationId: `electron-local-takeover`,
          type: `insert`,
          key: `electron-local-takeover`,
          value: { id: `electron-local-takeover` },
        },
      ])
      .then(
        (response) => ({ response }),
        (error: unknown) => ({ error }),
      )

    expect(outcome).toEqual({
      error: expect.objectContaining({
        name: `IndeterminateCommitError`,
        code: `INDETERMINATE_COMMIT`,
        collectionId: `todos`,
        requestType: `rpc:applyLocalMutations:req`,
        previousLeaderId: `electron-local-leader-a`,
        previousTerm: 7,
        currentLeaderId: `electron-local-leader-b`,
        currentTerm: 8,
        cause: transportError,
      } satisfies Partial<IndeterminateCommitError>),
    })
    expect(failedTransport).toHaveBeenCalledTimes(1)
    expect(aEffects).toHaveLength(1)
    expect(aPublications).toBe(1)
    expect(bEffects).toEqual([])
    expect(bPublications).toBe(0)
  })

  it(`fails indeterminate instead of retrying local mutations without an initial leader route`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-unknown-leader-local`,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    registerCleanup(() => coordinator.dispose())
    const transportError = new Error(`unknown leader response was lost`)
    const attemptedMutations: Array<ApplyLocalMutationsRequest[`mutations`]> =
      []
    const failedTransport = vi.fn(
      (_collectionId: string, request: ApplyLocalMutationsRequest) => {
        attemptedMutations.push(structuredClone(request.mutations))
        if (attemptedMutations.length === 1) {
          return Promise.reject(transportError)
        }
        return Promise.resolve({
          type: `rpc:applyLocalMutations:res` as const,
          rpcId: request.rpcId,
          ok: true as const,
          term: 1,
          seq: 1,
          latestRowVersion: 1,
          acceptedMutationIds: request.mutations.map(
            (mutation) => mutation.mutationId,
          ),
        })
      },
    )
    Object.defineProperty(coordinator, `sendRPCOnce`, {
      value: failedTransport,
      configurable: true,
    })

    const outcome = await coordinator
      .requestApplyLocalMutations(`todos`, [
        {
          mutationId: `electron-unknown-leader-local`,
          type: `insert`,
          key: `electron-unknown-leader-local`,
          value: { id: `electron-unknown-leader-local` },
        },
      ])
      .then(
        (response) => ({ response }),
        (error: unknown) => ({ error }),
      )

    expect(outcome).toEqual({
      error: expect.objectContaining({
        name: `IndeterminateCommitError`,
        code: `INDETERMINATE_COMMIT`,
        collectionId: `todos`,
        requestType: `rpc:applyLocalMutations:req`,
        previousLeaderId: null,
        previousTerm: null,
        currentLeaderId: null,
        currentTerm: null,
        cause: transportError,
      } satisfies Partial<IndeterminateCommitError>),
    })
    expect(failedTransport).toHaveBeenCalledTimes(1)
    expect(attemptedMutations).toEqual([
      [
        {
          mutationId: `electron-unknown-leader-local`,
          type: `insert`,
          key: `electron-unknown-leader-local`,
          value: { id: `electron-unknown-leader-local` },
        },
      ],
    ])
  })

  it(`binds committed transaction owners to each resolved collection adapter`, async () => {
    registerCleanup(installImmediatelyGrantedWebLocks())
    const requests: Array<ElectronPersistenceRequestEnvelope> = []
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-per-collection-adapters`,
    })
    registerCleanup(() => coordinator.dispose())
    const persistence = createElectronSQLitePersistence({
      coordinator,
      invoke: (_channel, request) => {
        requests.push(structuredClone(request))
        if (request.method === `getStreamPosition`) {
          return Promise.resolve({
            v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
            requestId: request.requestId,
            method: request.method,
            ok: true,
            result: {
              latestTerm: 0,
              latestSeq: 0,
              latestRowVersion: 0,
            },
          })
        }
        if (request.method === `applyCommittedTx`) {
          return Promise.resolve({
            v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
            requestId: request.requestId,
            method: request.method,
            ok: true,
            result: null,
          })
        }
        throw new Error(`unexpected method ${request.method}`)
      },
    })

    persistence.resolvePersistenceForCollection?.({
      collectionId: `alpha`,
      mode: `sync-present`,
      schemaVersion: 1,
    })
    persistence.resolvePersistenceForCollection?.({
      collectionId: `beta`,
      mode: `sync-present`,
      schemaVersion: 2,
    })
    coordinator.subscribe(`alpha`, () => {})
    coordinator.subscribe(`beta`, () => {})
    await waitForLeadership(coordinator, `alpha`)
    await waitForLeadership(coordinator, `beta`)

    await coordinator.requestApplyCommittedTx(`alpha`, {
      txId: `alpha-tx`,
      term: 0,
      seq: 0,
      rowVersion: 0,
      mutations: [],
    })
    await coordinator.requestApplyCommittedTx(`beta`, {
      txId: `beta-tx`,
      term: 0,
      seq: 0,
      rowVersion: 0,
      mutations: [],
    })

    expect(
      requests
        .filter((request) => request.method === `applyCommittedTx`)
        .map((request) => ({
          collectionId: request.collectionId,
          resolution: request.resolution,
          txId: request.payload.tx.txId,
        })),
    ).toEqual([
      {
        collectionId: `alpha`,
        resolution: { mode: `sync-present`, schemaVersion: 1 },
        txId: `alpha-tx`,
      },
      {
        collectionId: `beta`,
        resolution: { mode: `sync-present`, schemaVersion: 2 },
        txId: `beta-tx`,
      },
    ])
  })

  it(`coalesces and replays the exact committed success on the same leader`, async () => {
    registerCleanup(installImmediatelyGrantedWebLocks())
    let releaseApply = (): void => {}
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve
    })
    let applyCalls = 0
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-committed-envelope-replay`,
      adapter: {
        loadSubset: () => Promise.resolve([]),
        applyCommittedTx: async () => {
          applyCalls++
          await applyGate
        },
        ensureIndex: () => Promise.resolve(),
      },
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.subscribe(`todos`, () => {})
    await waitForLeadership(coordinator, `todos`)

    const handleApplyCommittedTx = (
      coordinator as unknown as {
        handleApplyCommittedTx: (
          collectionId: string,
          request: ApplyCommittedTxRequest,
        ) => Promise<unknown>
      }
    ).handleApplyCommittedTx.bind(coordinator)
    const request: ApplyCommittedTxRequest = {
      type: `rpc:applyCommittedTx:req`,
      rpcId: `first-rpc`,
      envelopeId: `stable-envelope`,
      tx: {
        txId: `stable-tx`,
        term: 0,
        seq: 0,
        rowVersion: 0,
        mutations: [],
      },
    }

    const first = handleApplyCommittedTx(`todos`, request)
    const duplicate = handleApplyCommittedTx(`todos`, {
      ...request,
      rpcId: `duplicate-rpc`,
    })
    await Promise.resolve()
    expect(applyCalls).toBe(1)
    releaseApply()
    expect(await Promise.all([first, duplicate])).toMatchObject([
      { ok: true, rpcId: `first-rpc` },
      { ok: true, rpcId: `duplicate-rpc` },
    ])

    await expect(
      handleApplyCommittedTx(`todos`, {
        ...request,
        rpcId: `replay-rpc`,
      }),
    ).resolves.toMatchObject({ ok: true, rpcId: `replay-rpc` })
    expect(applyCalls).toBe(1)
  })

  it(`replays the exact local-mutation success on the same leader`, async () => {
    registerCleanup(installImmediatelyGrantedWebLocks())
    let applyCalls = 0
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-local-envelope-replay`,
      adapter: {
        loadSubset: () => Promise.resolve([]),
        applyCommittedTx: () => {
          applyCalls++
          return Promise.resolve()
        },
        ensureIndex: () => Promise.resolve(),
      },
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.subscribe(`todos`, () => {})
    await waitForLeadership(coordinator, `todos`)

    const handleApplyLocalMutations = (
      coordinator as unknown as {
        handleApplyLocalMutations: (
          collectionId: string,
          request: ApplyLocalMutationsRequest,
        ) => Promise<unknown>
      }
    ).handleApplyLocalMutations.bind(coordinator)
    const request: ApplyLocalMutationsRequest = {
      type: `rpc:applyLocalMutations:req`,
      rpcId: `first-local-rpc`,
      envelopeId: `stable-local-envelope`,
      mutations: [
        {
          mutationId: `stable-local-mutation`,
          type: `insert`,
          key: `stable-local-row`,
          value: { id: `stable-local-row` },
        },
      ],
    }

    const first = await handleApplyLocalMutations(`todos`, request)
    const replay = await handleApplyLocalMutations(`todos`, {
      ...request,
      rpcId: `replayed-local-rpc`,
    })

    expect([first, replay]).toEqual([
      {
        type: `rpc:applyLocalMutations:res`,
        rpcId: `first-local-rpc`,
        ok: true,
        term: 1,
        seq: 1,
        latestRowVersion: 1,
        acceptedMutationIds: [`stable-local-mutation`],
      },
      {
        type: `rpc:applyLocalMutations:res`,
        rpcId: `replayed-local-rpc`,
        ok: true,
        term: 1,
        seq: 1,
        latestRowVersion: 1,
        acceptedMutationIds: [`stable-local-mutation`],
      },
    ])
    expect(applyCalls).toBe(1)
  })

  it(`classifies Electron durability failures on local and follower routes`, async () => {
    registerCleanup(installImmediatelyGrantedWebLocks())
    const persistenceError = Object.assign(new Error(`electron disk failed`), {
      code: `SQLITE_IOERR`,
      path: [`electron`, `todos`],
    })
    const adapter = createElectronCoordinatorTestAdapter()
    adapter.applyCommittedTx = vi.fn().mockRejectedValue(persistenceError)
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-durability-classification`,
      adapter,
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.subscribe(`todos`, () => {})
    await waitForLeadership(coordinator, `todos`)

    const responses: Array<unknown> = []
    const internals = coordinator as unknown as {
      channel: { postMessage: (message: unknown) => void }
      handleRPCRequest: (
        collectionId: string,
        request: ApplyLocalMutationsRequest | ApplyCommittedTxRequest,
        requesterId: string,
      ) => Promise<void>
    }
    internals.channel.postMessage = (message) => {
      responses.push((message as { payload: unknown }).payload)
    }

    await internals.handleRPCRequest(
      `todos`,
      {
        type: `rpc:applyLocalMutations:req`,
        rpcId: `remote-local-failure-rpc`,
        envelopeId: `remote-local-failure-envelope`,
        mutations: [],
      },
      `remote-electron-follower`,
    )
    await internals.handleRPCRequest(
      `todos`,
      {
        type: `rpc:applyCommittedTx:req`,
        rpcId: `remote-committed-failure-rpc`,
        envelopeId: `remote-committed-failure-envelope`,
        tx: {
          txId: `remote-committed-failure`,
          term: 0,
          seq: 0,
          rowVersion: 0,
          mutations: [],
        },
      },
      `remote-electron-follower`,
    )

    expect(responses).toEqual([
      {
        type: `rpc:applyLocalMutations:res`,
        rpcId: `remote-local-failure-rpc`,
        ok: false,
        code: `PERSISTENCE_ERROR`,
        error: expect.stringContaining(persistenceError.message),
        sourceCode: `SQLITE_IOERR`,
        path: [`electron`, `todos`],
      },
      {
        type: `rpc:applyCommittedTx:res`,
        rpcId: `remote-committed-failure-rpc`,
        ok: false,
        code: `PERSISTENCE_ERROR`,
        error: expect.stringContaining(persistenceError.message),
        sourceCode: `SQLITE_IOERR`,
        path: [`electron`, `todos`],
      },
    ])

    await expect(
      coordinator.requestApplyLocalMutations(`todos`, []),
    ).rejects.toMatchObject({
      name: `PersistedCollectionDurabilityError`,
      code: `SQLITE_IOERR`,
      path: [`electron`, `todos`],
      cause: persistenceError,
    } satisfies Partial<PersistedCollectionDurabilityError>)
    await expect(
      coordinator.requestApplyCommittedTx(`todos`, {
        txId: `local-committed-failure`,
        term: 0,
        seq: 0,
        rowVersion: 0,
        mutations: [],
      }),
    ).rejects.toMatchObject({
      name: `PersistedCollectionDurabilityError`,
      code: `SQLITE_IOERR`,
      path: [`electron`, `todos`],
      cause: persistenceError,
    } satisfies Partial<PersistedCollectionDurabilityError>)
    expect(adapter.applyCommittedTx).toHaveBeenCalledTimes(4)
  })

  it(`preserves a held committed apply without retaining or publishing after disposal`, async () => {
    registerCleanup(installImmediatelyGrantedWebLocks())
    let applyEntered = false
    let releaseApply = (): void => {}
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve
    })
    const durableTransactions: Array<PersistedTx> = []
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-dispose-held-committed`,
      adapter: {
        loadSubset: () => Promise.resolve([]),
        applyCommittedTx: async (_collectionId, tx) => {
          applyEntered = true
          await applyGate
          durableTransactions.push(structuredClone(tx))
        },
        ensureIndex: () => Promise.resolve(),
      },
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.subscribe(`todos`, () => {})
    await waitForLeadership(coordinator, `todos`)

    const internals = coordinator as unknown as {
      handleApplyCommittedTx: (
        collectionId: string,
        request: ApplyCommittedTxRequest,
      ) => Promise<unknown>
      appliedCommittedTxEnvelopes: Map<string, unknown>
      inFlightCommittedTxEnvelopes: Map<string, unknown>
    }
    const outcomePromise = internals
      .handleApplyCommittedTx(`todos`, {
        type: `rpc:applyCommittedTx:req`,
        rpcId: `held-committed-rpc`,
        envelopeId: `held-committed-envelope`,
        tx: {
          txId: `held-committed-tx`,
          term: 0,
          seq: 0,
          rowVersion: 0,
          mutations: [],
        },
      })
      .then(
        (response) => ({ response }),
        (error: unknown) => ({ error }),
      )

    try {
      await vi.waitFor(() => expect(applyEntered).toBe(true))
      coordinator.dispose()
      releaseApply()
      const outcome = await outcomePromise

      expect(outcome).toEqual({
        response: {
          type: `rpc:applyCommittedTx:res`,
          rpcId: `held-committed-rpc`,
          ok: true,
          term: 1,
          seq: 1,
          latestRowVersion: 1,
        },
      })
      expect(durableTransactions).toHaveLength(1)
      expect(durableTransactions[0]?.txId).toBe(`held-committed-tx`)
      expect({
        completed: internals.appliedCommittedTxEnvelopes.size,
        inFlight: internals.inFlightCommittedTxEnvelopes.size,
      }).toEqual({ completed: 0, inFlight: 0 })
    } finally {
      releaseApply()
      coordinator.dispose()
    }
  })

  it(`preserves a held local apply without retaining or publishing after disposal`, async () => {
    registerCleanup(installImmediatelyGrantedWebLocks())
    let applyEntered = false
    let releaseApply = (): void => {}
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve
    })
    const durableTransactions: Array<PersistedTx> = []
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-dispose-held-local`,
      adapter: {
        loadSubset: () => Promise.resolve([]),
        applyCommittedTx: async (_collectionId, tx) => {
          applyEntered = true
          await applyGate
          durableTransactions.push(structuredClone(tx))
        },
        ensureIndex: () => Promise.resolve(),
      },
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.subscribe(`todos`, () => {})
    await waitForLeadership(coordinator, `todos`)

    const internals = coordinator as unknown as {
      handleApplyLocalMutations: (
        collectionId: string,
        request: ApplyLocalMutationsRequest,
      ) => Promise<unknown>
      appliedEnvelopeIds: Map<string, unknown>
    }
    const outcomePromise = internals
      .handleApplyLocalMutations(`todos`, {
        type: `rpc:applyLocalMutations:req`,
        rpcId: `held-local-rpc`,
        envelopeId: `held-local-envelope`,
        mutations: [
          {
            mutationId: `held-local-mutation`,
            type: `insert`,
            key: `held-local-row`,
            value: { id: `held-local-row` },
          },
        ],
      })
      .then(
        (response) => ({ response }),
        (error: unknown) => ({ error }),
      )

    try {
      await vi.waitFor(() => expect(applyEntered).toBe(true))
      coordinator.dispose()
      releaseApply()
      const outcome = await outcomePromise

      expect(outcome).toEqual({
        response: {
          type: `rpc:applyLocalMutations:res`,
          rpcId: `held-local-rpc`,
          ok: true,
          term: 1,
          seq: 1,
          latestRowVersion: 1,
          acceptedMutationIds: [`held-local-mutation`],
        },
      })
      expect(durableTransactions).toHaveLength(1)
      expect(durableTransactions[0]?.mutations).toEqual([
        {
          type: `insert`,
          key: `held-local-row`,
          value: { id: `held-local-row` },
        },
      ])
      expect(internals.appliedEnvelopeIds.size).toBe(0)
    } finally {
      releaseApply()
      coordinator.dispose()
    }
  })

  it(`validates remote-subset values before Electron leader completion`, async () => {
    registerCleanup(installImmediatelyGrantedWebLocks())
    const leader = new ElectronCollectionCoordinator({
      dbName: `electron-subset-wire-leader`,
      adapter: {
        loadSubset: () => Promise.resolve([]),
        applyCommittedTx: () => Promise.resolve(),
        ensureIndex: () => Promise.resolve(),
      },
    })
    registerCleanup(() => leader.dispose())
    leader.subscribe(`todos`, () => {})
    await waitForLeadership(leader, `todos`)

    const invalid = electronSubsetWithNestedValue(() => {})
    await expect(
      leader.requestEnsureRemoteSubset(`todos`, invalid),
    ).rejects.toMatchObject({
      name: `RemoteSubsetWireValueError`,
      path: `options.where.args[1].value[1]`,
    })
  })

  it(`validates remote-subset values before Electron follower transport`, async () => {
    const follower = new ElectronCollectionCoordinator({
      dbName: `electron-subset-wire-follower`,
    })
    registerCleanup(() => follower.dispose())
    follower.isLeader = () => false
    const followerInternals = follower as unknown as {
      channel: { postMessage: (message: unknown) => void }
    }
    let subsetPosts = 0
    followerInternals.channel.postMessage = (message) => {
      const payload = (message as { payload?: { type?: string } }).payload
      if (payload?.type === `rpc:ensureRemoteSubset:req`) subsetPosts++
      structuredClone(message)
    }
    const outcome = await follower
      .requestEnsureRemoteSubset(
        `todos`,
        electronSubsetWithNestedValue(() => {}),
      )
      .then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      )
    expect({ outcome, subsetPosts }).toMatchObject({
      outcome: {
        ok: false,
        error: {
          name: `RemoteSubsetWireValueError`,
          path: `options.where.args[1].value[1]`,
        },
      },
      subsetPosts: 0,
    })
  })

  it(`rejects a sparse function argument at its exact Electron wire path`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-subset-wire-hole`,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.isLeader = () => true
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

  it(`holds same-stack Electron subset reentry behind the original owner load`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-subset-same-stack`,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.isLeader = () => true
    const options: LoadSubsetOptions = { limit: 1 }
    let releaseLoad = (): void => {}
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
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
      await vi.waitFor(() => expect(duplicate).toBeDefined())
      const duplicateResult = duplicate!.then(() => {
        duplicateSettled = true
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

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

  it(`compacts a terminal same-stack Electron release after the real owner load finishes`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-subset-terminal-release`,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.isLeader = () => true
    const options: LoadSubsetOptions = { limit: 1 }
    let releaseLoad = (): void => {}
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    let release: Promise<void> | undefined
    const events: Array<string> = []
    const owner = Object.assign(
      vi.fn(() => {
        events.push(`load`)
        release = coordinator.requestReleaseRemoteSubset(`todos`, options)
        return loadGate
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
    const internals = coordinator as unknown as {
      outboundRemoteSubsetAcquisitions: Map<string, unknown>
      inboundRemoteSubsetAcquisitions: Map<string, Record<string, unknown>>
    }

    try {
      let releaseSettled = false
      const load = coordinator.requestEnsureRemoteSubset(`todos`, options)
      await vi.waitFor(() => expect(release).toBeDefined())
      const terminalRelease = release!.then(() => {
        releaseSettled = true
      })
      await Promise.resolve()
      expect({ events: [...events], releaseSettled }).toEqual({
        events: [`load`],
        releaseSettled: false,
      })

      releaseLoad()
      await Promise.all([load, terminalRelease])
      const [terminal] = internals.inboundRemoteSubsetAcquisitions.values()
      expect({
        events,
        outbound: internals.outboundRemoteSubsetAcquisitions.size,
        inbound: internals.inboundRemoteSubsetAcquisitions.size,
        terminalKeys: Object.keys(terminal ?? {}).sort(),
      }).toEqual({
        events: [`load`, `unload`],
        outbound: 0,
        inbound: 1,
        terminalKeys: [
          `acquisitionId`,
          `collectionId`,
          `released`,
          `requesterId`,
        ],
      })
    } finally {
      releaseLoad()
      unregisterOwner()
      coordinator.dispose()
    }
  })

  it(`releases a transferred Electron lease whose initial load rejected`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-subset-rejected-transfer`,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.isLeader = () => true
    const loadError = new Error(`electron transferred load failed`)
    const ownerErrors: Array<unknown> = []
    const owner = Object.assign(
      vi.fn((_options: TransportedLoadSubsetOptions) =>
        Promise.reject(loadError),
      ),
      {
        unloadSubset: vi.fn(
          (_options: TransportedLoadSubsetOptions) => undefined,
        ),
        onError: (error: unknown) => ownerErrors.push(error),
      },
    )
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const options: LoadSubsetOptions = { offset: 20 }
    const unhandled: Array<unknown> = []
    const onUnhandled = (error: unknown) => unhandled.push(error)
    process.on(`unhandledRejection`, onUnhandled)
    const internals = coordinator as unknown as {
      inboundRemoteSubsetAcquisitions: Map<string, Record<string, unknown>>
    }

    try {
      const ensureError = await coordinator
        .requestEnsureRemoteSubset(`todos`, options)
        .then(
          () => undefined,
          (error: unknown) => error,
        )
      await coordinator.requestReleaseRemoteSubset(`todos`, options)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const [terminal] = internals.inboundRemoteSubsetAcquisitions.values()

      expect(ensureError).toBe(loadError)
      expect(owner).toHaveBeenCalledTimes(1)
      expect(owner.unloadSubset).toHaveBeenCalledTimes(1)
      expect(owner.unloadSubset.mock.calls[0]?.[0]).toBe(
        owner.mock.calls[0]?.[0],
      )
      expect(ownerErrors).toEqual([loadError])
      expect(unhandled).toEqual([])
      expect({
        inbound: internals.inboundRemoteSubsetAcquisitions.size,
        terminalKeys: Object.keys(terminal ?? {}).sort(),
      }).toEqual({
        inbound: 1,
        terminalKeys: [
          `acquisitionId`,
          `collectionId`,
          `released`,
          `requesterId`,
        ],
      })
    } finally {
      process.off(`unhandledRejection`, onUnhandled)
      unregisterOwner()
      coordinator.dispose()
    }
  })

  it(`keeps an Electron release tombstone when a transferred load rejects concurrently`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-subset-concurrent-rejected-transfer`,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.isLeader = () => true
    const loadError = new Error(`electron concurrent transferred load failed`)
    let rejectLoad = (_error: unknown): void => {}
    const loadGate = new Promise<void>((_resolve, reject) => {
      rejectLoad = reject
    })
    const ownerErrors: Array<unknown> = []
    const owner = Object.assign(
      vi.fn((_options: TransportedLoadSubsetOptions) => loadGate),
      {
        unloadSubset: vi.fn(
          (_options: TransportedLoadSubsetOptions) => undefined,
        ),
        onError: (error: unknown) => ownerErrors.push(error),
      },
    )
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const options: LoadSubsetOptions = { offset: 21 }
    const unhandled: Array<unknown> = []
    const onUnhandled = (error: unknown) => unhandled.push(error)
    process.on(`unhandledRejection`, onUnhandled)
    const internals = coordinator as unknown as {
      nodeId: string
      outboundRemoteSubsetAcquisitions: Map<string, { acquisitionId: string }>
      inboundRemoteSubsetAcquisitions: Map<string, Record<string, unknown>>
      handleEnsureRemoteSubset: (
        collectionId: string,
        request: {
          type: `rpc:ensureRemoteSubset:req`
          rpcId: string
          acquisitionId: string
          options: TransportedLoadSubsetOptions
        },
        requesterId: string,
      ) => Promise<{ ok: boolean }>
    }

    try {
      const ensure = coordinator
        .requestEnsureRemoteSubset(`todos`, options)
        .then(
          () => ({ status: `fulfilled` as const }),
          (error: unknown) => ({ status: `rejected` as const, error }),
        )
      await vi.waitFor(() => expect(owner).toHaveBeenCalledTimes(1))
      const [outbound] = internals.outboundRemoteSubsetAcquisitions.values()
      const release = coordinator
        .requestReleaseRemoteSubset(`todos`, options)
        .then(
          () => ({ status: `fulfilled` as const }),
          (error: unknown) => ({ status: `rejected` as const, error }),
        )
      rejectLoad(loadError)
      const outcomes = await Promise.all([ensure, release])
      const duplicate = await internals
        .handleEnsureRemoteSubset(
          `todos`,
          {
            type: `rpc:ensureRemoteSubset:req`,
            rpcId: `delayed-electron-duplicate`,
            acquisitionId: outbound!.acquisitionId,
            options: owner.mock.calls[0]![0],
          },
          internals.nodeId,
        )
        .then(
          (response) => ({ status: `fulfilled` as const, response }),
          (error: unknown) => ({ status: `rejected` as const, error }),
        )
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const [terminal] = internals.inboundRemoteSubsetAcquisitions.values()

      expect(outcomes).toEqual([
        { status: `rejected`, error: loadError },
        { status: `fulfilled` },
      ])
      expect(duplicate).toEqual({
        status: `fulfilled`,
        response: expect.objectContaining({ ok: true }),
      })
      expect(owner).toHaveBeenCalledTimes(1)
      expect(owner.unloadSubset).toHaveBeenCalledTimes(1)
      expect(ownerErrors).toEqual([loadError])
      expect(unhandled).toEqual([])
      expect({
        inbound: internals.inboundRemoteSubsetAcquisitions.size,
        terminalKeys: Object.keys(terminal ?? {}).sort(),
      }).toEqual({
        inbound: 1,
        terminalKeys: [
          `acquisitionId`,
          `collectionId`,
          `released`,
          `requesterId`,
        ],
      })
    } finally {
      rejectLoad(loadError)
      process.off(`unhandledRejection`, onUnhandled)
      unregisterOwner()
      coordinator.dispose()
    }
  })

  it(`posts only the validated remote-subset wire domain from Electron`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-subset-wire-projection`,
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.isLeader = () => false

    const shared = { label: `shared` }
    const cycle: Record<string, unknown> = { label: `cycle` }
    cycle.self = cycle
    const options: LoadSubsetOptions = {
      where: new IR.Func(`eq`, [
        new IR.PropRef([`todos`, `payload`]),
        new IR.Value({
          date: new Date(`2026-09-16T12:34:56.000Z`),
          regexp: /wire/giu,
          bytes: new Uint8Array([0, 127, 255]),
          map: new Map([[shared, cycle]]),
          set: new Set([shared, cycle]),
          first: shared,
          second: shared,
          cycle,
        }),
      ]),
      signal: new AbortController().signal,
      subscription: {
        on: () => () => {},
      } as unknown as Subscription,
    }
    const internals = coordinator as unknown as {
      channel: { postMessage: (message: unknown) => void }
    }
    let posted: unknown
    internals.channel.postMessage = (message) => {
      posted = structuredClone(message)
    }

    const pending = coordinator
      .requestEnsureRemoteSubset(`todos`, options)
      .catch((error: unknown) => error)
    await Promise.resolve()

    const wireOptions = (
      posted as
        | {
            payload?: {
              type?: string
              options?: LoadSubsetOptions
            }
          }
        | undefined
    )?.payload?.options
    expect(
      (posted as { payload?: { type?: string } } | undefined)?.payload?.type,
    ).toBe(`rpc:ensureRemoteSubset:req`)
    expect(wireOptions).not.toHaveProperty(`signal`)
    expect(wireOptions).not.toHaveProperty(`subscription`)
    const wireValue = (
      wireOptions?.where as unknown as
        | {
            args: Array<{
              value?: {
                date: Date
                regexp: RegExp
                bytes: Uint8Array
                map: Map<unknown, unknown>
                set: Set<unknown>
                first: unknown
                second: unknown
                cycle: Record<string, unknown>
              }
            }>
          }
        | undefined
    )?.args[1]?.value
    expect(wireValue?.date.getTime()).toBe(
      new Date(`2026-09-16T12:34:56.000Z`).getTime(),
    )
    expect(wireValue?.regexp).toEqual(/wire/giu)
    expect(Array.from(wireValue?.bytes ?? [])).toEqual([0, 127, 255])
    expect(wireValue?.first).toBe(wireValue?.second)
    expect([...wireValue!.map.keys()]).toEqual([wireValue?.first])
    expect(wireValue?.map.get(wireValue.first)).toBe(wireValue?.cycle)
    expect(wireValue?.set.has(wireValue.first)).toBe(true)
    expect(wireValue?.cycle.self).toBe(wireValue?.cycle)

    coordinator.dispose()
    await pending
  })

  it(`loads and releases exact Electron remote-subset acquisitions`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-subset-owner-routing`,
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.isLeader = () => true

    const loads: Array<TransportedLoadSubsetOptions> = []
    const unloads: Array<TransportedLoadSubsetOptions> = []
    const owner = Object.assign(
      vi.fn((options: TransportedLoadSubsetOptions) => {
        loads.push(options)
      }),
      {
        unloadSubset: vi.fn((options: TransportedLoadSubsetOptions) => {
          unloads.push(options)
        }),
        onError: vi.fn(),
      },
    ) satisfies RemoteSubsetOwner
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const first = { limit: 2, offset: 1 }
    const sibling = { limit: 2, offset: 1 }

    try {
      await coordinator.requestEnsureRemoteSubset(`todos`, first)
      await coordinator.requestEnsureRemoteSubset(`todos`, first)
      await coordinator.requestEnsureRemoteSubset(`todos`, sibling)

      expect(loads).toEqual([
        { limit: 2, offset: 1 },
        { limit: 2, offset: 1 },
      ])

      await coordinator.requestReleaseRemoteSubset(`todos`, first)
      await coordinator.requestReleaseRemoteSubset(`todos`, first)
      expect(unloads).toEqual([{ limit: 2, offset: 1 }])

      await coordinator.requestReleaseRemoteSubset(`todos`, sibling)
      expect(unloads).toEqual([
        { limit: 2, offset: 1 },
        { limit: 2, offset: 1 },
      ])
    } finally {
      unregisterOwner()
    }
  })

  it(`scopes a reused subset options object to each Electron collection`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-subset-owner-collection-identity`,
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.isLeader = () => true
    const alpha = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const beta = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const unregisterAlpha = coordinator.registerRemoteSubsetOwner(
      `alpha`,
      alpha,
    )
    const unregisterBeta = coordinator.registerRemoteSubsetOwner(`beta`, beta)
    const shared: LoadSubsetOptions = { limit: 2, offset: 1 }

    try {
      await coordinator.requestEnsureRemoteSubset(`alpha`, shared)
      await coordinator.requestEnsureRemoteSubset(`beta`, shared)
      await coordinator.requestEnsureRemoteSubset(`alpha`, shared)

      const afterAcquire = {
        alphaLoads: alpha.mock.calls.length,
        betaLoads: beta.mock.calls.length,
      }
      await coordinator.requestReleaseRemoteSubset(`alpha`, shared)
      await coordinator.requestReleaseRemoteSubset(`beta`, shared)

      expect({
        afterAcquire,
        alphaUnloads: alpha.unloadSubset.mock.calls.length,
        betaUnloads: beta.unloadSubset.mock.calls.length,
      }).toEqual({
        afterAcquire: { alphaLoads: 1, betaLoads: 1 },
        alphaUnloads: 1,
        betaUnloads: 1,
      })
    } finally {
      unregisterAlpha()
      unregisterBeta()
    }
  })

  it(`replays after an earlier Electron leader responds behind a new heartbeat`, async () => {
    registerCleanup(installImmediatelyGrantedWebLocks())
    const dbName = `electron-subset-stale-response-${process.pid}`
    const leader = new ElectronCollectionCoordinator({
      dbName,
      adapter: {
        loadSubset: () => Promise.resolve([]),
        applyCommittedTx: () => Promise.resolve(),
        ensureIndex: () => Promise.resolve(),
      },
    })
    const follower = new ElectronCollectionCoordinator({
      dbName,
    })
    ;(
      follower as unknown as { acquireLeadership: () => Promise<void> }
    ).acquireLeadership = async () => {}
    registerCleanup(() => leader.dispose())
    registerCleanup(() => follower.dispose())
    let releaseOwner = (): void => {}
    const owner = Object.assign(
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseOwner = resolve
          }),
      ),
      { unloadSubset: vi.fn(), onError: vi.fn() },
    ) satisfies RemoteSubsetOwner
    const unregisterOwner = leader.registerRemoteSubsetOwner(`todos`, owner)
    leader.subscribe(`todos`, () => {})
    await waitForLeadership(leader, `todos`)

    const leaderInternals = leader as unknown as {
      nodeId: string
      channel: BroadcastChannel
    }
    const followerInternals = follower as unknown as {
      onChannelMessage: (message: unknown) => void
      channel: BroadcastChannel
      outboundRemoteSubsetAcquisitions: Map<
        string,
        { acquiredLeaderId: string | null }
      >
    }
    const originalLeaderPost = leaderInternals.channel.postMessage.bind(
      leaderInternals.channel,
    )
    let heldResponse: unknown
    leaderInternals.channel.postMessage = (message: unknown) => {
      const type = (message as { payload?: { type?: string } }).payload?.type
      if (type === `rpc:ensureRemoteSubset:res`) {
        heldResponse = structuredClone(message)
        return
      }
      originalLeaderPost(message)
    }
    const originalFollowerPost = followerInternals.channel.postMessage.bind(
      followerInternals.channel,
    )
    let requestPosts = 0
    followerInternals.channel.postMessage = (message: unknown) => {
      if (
        (message as { payload?: { type?: string } }).payload?.type ===
        `rpc:ensureRemoteSubset:req`
      ) {
        requestPosts++
      }
      originalFollowerPost(message)
    }

    try {
      const request = follower.requestEnsureRemoteSubset(`todos`, { limit: 1 })
      await vi.waitFor(() => expect(owner).toHaveBeenCalledTimes(1))
      followerInternals.onChannelMessage({
        v: 1,
        dbName,
        collectionId: `todos`,
        senderId: `replacement-electron-leader`,
        ts: Date.now(),
        payload: {
          type: `leader:heartbeat`,
          term: 2,
          leaderId: `replacement-electron-leader`,
          latestSeq: 0,
          latestRowVersion: 0,
        },
      })
      releaseOwner()
      await vi.waitFor(() => expect(heldResponse).toBeDefined())
      leader.isLeader = () => false
      followerInternals.onChannelMessage(heldResponse)
      await request
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      const [acquisition] =
        followerInternals.outboundRemoteSubsetAcquisitions.values()
      expect({
        requestPosts,
        acquiredLeaderId: acquisition?.acquiredLeaderId,
      }).toEqual({
        requestPosts: 2,
        acquiredLeaderId: leaderInternals.nodeId,
      })
    } finally {
      releaseOwner()
      unregisterOwner()
      leader.dispose()
      follower.dispose()
    }
  })

  it(`replays a held Electron lease after an A to B to A leader cycle`, async () => {
    const dbName = `electron-subset-a-b-a`
    const leader = new ElectronCollectionCoordinator({
      dbName,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    const follower = new ElectronCollectionCoordinator({
      dbName,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    registerCleanup(() => leader.dispose())
    registerCleanup(() => follower.dispose())
    leader.isLeader = () => true
    follower.isLeader = () => false
    let releaseFirstLoad = (): void => {}
    const firstLoadGate = new Promise<void>((resolve) => {
      releaseFirstLoad = resolve
    })
    const owner = Object.assign(
      vi.fn().mockImplementationOnce(() => firstLoadGate),
      { unloadSubset: vi.fn(), onError: vi.fn() },
    )
    const unregisterOwner = leader.registerRemoteSubsetOwner(`todos`, owner)
    const leaderInternals = leader as unknown as {
      nodeId: string
      channel: BroadcastChannel
      inboundRemoteSubsetAcquisitions: Map<string, unknown>
      releaseInboundRemoteSubsetAcquisitions: (collectionId: string) => void
    }
    const followerInternals = follower as unknown as {
      onChannelMessage: (message: unknown) => void
      channel: BroadcastChannel
      acquireLeadership: () => Promise<void>
      outboundRemoteSubsetAcquisitions: Map<
        string,
        { acquiredLeaderId: string | null }
      >
    }
    followerInternals.acquireLeadership = async () => {}
    const originalLeaderPost = leaderInternals.channel.postMessage.bind(
      leaderInternals.channel,
    )
    let heldResponse: unknown
    leaderInternals.channel.postMessage = (message) => {
      const type = (message as { payload?: { type?: string } }).payload?.type
      if (type === `rpc:ensureRemoteSubset:res` && heldResponse === undefined) {
        heldResponse = structuredClone(message)
        return
      }
      originalLeaderPost(message)
    }
    const originalFollowerPost = followerInternals.channel.postMessage.bind(
      followerInternals.channel,
    )
    let requestPosts = 0
    const wireRequests: Array<{
      acquisitionId: string
      rpcId: string
    }> = []
    followerInternals.channel.postMessage = (message) => {
      const payload = (
        message as {
          payload?: {
            type?: string
            acquisitionId?: string
            rpcId?: string
          }
        }
      ).payload
      if (payload?.type === `rpc:ensureRemoteSubset:req`) {
        requestPosts++
        wireRequests.push({
          acquisitionId: payload.acquisitionId!,
          rpcId: payload.rpcId!,
        })
      }
      originalFollowerPost(message)
    }
    const heartbeat = (leaderId: string, term: number) => ({
      v: 1,
      dbName,
      collectionId: `todos`,
      senderId: leaderId,
      ts: Date.now(),
      payload: {
        type: `leader:heartbeat`,
        term,
        leaderId,
        latestSeq: 0,
        latestRowVersion: 0,
      },
    })
    const options: LoadSubsetOptions = { limit: 1 }

    try {
      const request = follower.requestEnsureRemoteSubset(`todos`, options)
      await vi.waitFor(() => expect(owner).toHaveBeenCalledTimes(1))
      followerInternals.onChannelMessage(
        heartbeat(`replacement-electron-leader`, 2),
      )
      leaderInternals.releaseInboundRemoteSubsetAcquisitions(`todos`)
      followerInternals.onChannelMessage(heartbeat(leaderInternals.nodeId, 3))
      releaseFirstLoad()
      await vi.waitFor(() => expect(heldResponse).toBeDefined())
      followerInternals.onChannelMessage(heldResponse)
      await request
      await vi.waitFor(() => expect(owner).toHaveBeenCalledTimes(2))

      const [acquisition] =
        followerInternals.outboundRemoteSubsetAcquisitions.values()
      expect({
        requestPosts,
        loads: owner.mock.calls.length,
        unloads: owner.unloadSubset.mock.calls.length,
        inbound: leaderInternals.inboundRemoteSubsetAcquisitions.size,
        acquiredLeaderId: acquisition?.acquiredLeaderId,
      }).toEqual({
        requestPosts: 2,
        loads: 2,
        unloads: 1,
        inbound: 1,
        acquiredLeaderId: leaderInternals.nodeId,
      })
      expect(wireRequests).toHaveLength(2)
      expect(wireRequests[0]!.acquisitionId).not.toBe(``)
      expect(wireRequests[1]!.acquisitionId).toBe(
        wireRequests[0]!.acquisitionId,
      )
      expect(wireRequests[1]!.rpcId).not.toBe(wireRequests[0]!.rpcId)

      await follower.requestReleaseRemoteSubset(`todos`, options)
      expect(owner.unloadSubset).toHaveBeenCalledTimes(2)
    } finally {
      releaseFirstLoad()
      unregisterOwner()
      leader.dispose()
      follower.dispose()
    }
  })

  it(`rebinds a live Electron acquisition when its owner is replaced`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-subset-owner-replacement`,
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.isLeader = () => true
    let releaseFirstLoad = (): void => {}
    const firstLoadGate = new Promise<void>((resolve) => {
      releaseFirstLoad = resolve
    })
    const firstOwner = Object.assign(
      vi.fn(() => firstLoadGate),
      {
        unloadSubset: vi.fn(),
        onError: vi.fn(),
      },
    )
    const secondOwner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(
        (_options: TransportedLoadSubsetOptions) => undefined,
      ),
      onError: vi.fn(),
    })
    const unregisterFirst = coordinator.registerRemoteSubsetOwner(
      `todos`,
      firstOwner,
    )
    let unregisterSecond: (() => void) | undefined
    const options: LoadSubsetOptions = { limit: 1 }

    try {
      const initialAcquire = coordinator.requestEnsureRemoteSubset(
        `todos`,
        options,
      )
      await vi.waitFor(() => expect(firstOwner).toHaveBeenCalledTimes(1))
      unregisterFirst()
      unregisterSecond = coordinator.registerRemoteSubsetOwner(
        `todos`,
        secondOwner,
      )
      releaseFirstLoad()
      await initialAcquire
      await vi.waitFor(() => expect(secondOwner).toHaveBeenCalledTimes(1))

      expect(firstOwner.unloadSubset).toHaveBeenCalledTimes(1)
      await coordinator.requestReleaseRemoteSubset(`todos`, options)
      expect(secondOwner.unloadSubset).toHaveBeenCalledTimes(1)
    } finally {
      releaseFirstLoad()
      unregisterFirst()
      unregisterSecond?.()
      coordinator.dispose()
    }
  })

  it(`rebinds a live remote Electron follower lease when the same leader replaces its owner`, async () => {
    const dbName = `electron-remote-owner-replacement`
    const leader = new ElectronCollectionCoordinator({
      dbName,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    const follower = new ElectronCollectionCoordinator({
      dbName,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    registerCleanup(() => leader.dispose())
    registerCleanup(() => follower.dispose())
    leader.isLeader = () => true
    follower.isLeader = () => false
    let releaseFirstLoad = (): void => {}
    const firstLoadGate = new Promise<void>((resolve) => {
      releaseFirstLoad = resolve
    })
    const firstOwner = Object.assign(
      vi.fn(() => firstLoadGate),
      {
        unloadSubset: vi.fn(),
        onError: vi.fn(),
      },
    )
    const secondOwner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const unregisterFirst = leader.registerRemoteSubsetOwner(
      `todos`,
      firstOwner,
    )
    let unregisterSecond: (() => void) | undefined
    const options: LoadSubsetOptions = { limit: 1 }
    const followerInternals = follower as unknown as {
      channel: BroadcastChannel
    }
    const originalFollowerPost = followerInternals.channel.postMessage.bind(
      followerInternals.channel,
    )
    let requestPosts = 0
    followerInternals.channel.postMessage = (message) => {
      if (
        (message as { payload?: { type?: string } }).payload?.type ===
        `rpc:ensureRemoteSubset:req`
      ) {
        requestPosts++
      }
      originalFollowerPost(message)
    }

    try {
      const initialAcquire = follower.requestEnsureRemoteSubset(
        `todos`,
        options,
      )
      await vi.waitFor(() => expect(firstOwner).toHaveBeenCalledTimes(1))
      unregisterFirst()
      unregisterSecond = leader.registerRemoteSubsetOwner(`todos`, secondOwner)
      releaseFirstLoad()
      await initialAcquire
      await vi.waitFor(() => expect(secondOwner).toHaveBeenCalledTimes(1))

      expect({
        requestPosts,
        firstUnloads: firstOwner.unloadSubset.mock.calls.length,
      }).toEqual({ requestPosts: 1, firstUnloads: 1 })
      await follower.requestReleaseRemoteSubset(`todos`, options)
      expect(secondOwner.unloadSubset).toHaveBeenCalledTimes(1)
    } finally {
      releaseFirstLoad()
      unregisterFirst()
      unregisterSecond?.()
      leader.dispose()
      follower.dispose()
    }
  })

  it(`rebinds remote Electron demand when its replacement owner registers after release settlement`, async () => {
    const dbName = `electron-remote-owner-settled-replacement`
    const leader = new ElectronCollectionCoordinator({
      dbName,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    const follower = new ElectronCollectionCoordinator({
      dbName,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    registerCleanup(() => leader.dispose())
    registerCleanup(() => follower.dispose())
    leader.isLeader = () => true
    follower.isLeader = () => false
    const firstOwner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const secondOwner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const unregisterFirst = leader.registerRemoteSubsetOwner(
      `todos`,
      firstOwner,
    )
    let unregisterSecond: (() => void) | undefined
    const options: LoadSubsetOptions = { offset: 22 }
    const leaderInternals = leader as unknown as {
      inboundRemoteSubsetAcquisitions: Map<string, Record<string, unknown>>
    }

    try {
      await follower.requestEnsureRemoteSubset(`todos`, options)
      unregisterFirst()
      await vi.waitFor(() =>
        expect(firstOwner.unloadSubset).toHaveBeenCalledTimes(1),
      )
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      unregisterSecond = leader.registerRemoteSubsetOwner(`todos`, secondOwner)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      expect({
        firstLoads: firstOwner.mock.calls.length,
        firstUnloads: firstOwner.unloadSubset.mock.calls.length,
        secondLoads: secondOwner.mock.calls.length,
        inbound: leaderInternals.inboundRemoteSubsetAcquisitions.size,
      }).toEqual({
        firstLoads: 1,
        firstUnloads: 1,
        secondLoads: 1,
        inbound: 1,
      })

      await follower.requestReleaseRemoteSubset(`todos`, options)
      const [terminal] =
        leaderInternals.inboundRemoteSubsetAcquisitions.values()
      expect(secondOwner.unloadSubset).toHaveBeenCalledTimes(1)
      expect(secondOwner.unloadSubset.mock.calls[0]?.[0]).toBe(
        secondOwner.mock.calls[0]?.[0],
      )
      expect({
        inbound: leaderInternals.inboundRemoteSubsetAcquisitions.size,
        terminalKeys: Object.keys(terminal ?? {}).sort(),
      }).toEqual({
        inbound: 1,
        terminalKeys: [
          `acquisitionId`,
          `collectionId`,
          `released`,
          `requesterId`,
        ],
      })
    } finally {
      unregisterFirst()
      unregisterSecond?.()
      leader.dispose()
      follower.dispose()
    }
  })

  it(`reacquires the same Electron lease after leadership retirement`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-subset-leadership-return`,
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.isLeader = () => true
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const internals = coordinator as unknown as {
      releaseInboundRemoteSubsetAcquisitions: (collectionId: string) => void
    }
    const options: LoadSubsetOptions = { limit: 1 }

    try {
      await coordinator.requestEnsureRemoteSubset(`todos`, options)
      internals.releaseInboundRemoteSubsetAcquisitions(`todos`)
      await vi.waitFor(() =>
        expect(owner.unloadSubset).toHaveBeenCalledTimes(1),
      )

      await coordinator.requestEnsureRemoteSubset(`todos`, options)
      expect(owner).toHaveBeenCalledTimes(2)
      await coordinator.requestReleaseRemoteSubset(`todos`, options)
      expect(owner.unloadSubset).toHaveBeenCalledTimes(2)
    } finally {
      unregisterOwner()
      coordinator.dispose()
    }
  })

  it(`starts independent Electron lease replays without sibling head-of-line blocking`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-subset-parallel-replay`,
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.isLeader = () => true
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    await coordinator.requestEnsureRemoteSubset(`todos`, { offset: 1 })
    await coordinator.requestEnsureRemoteSubset(`todos`, { offset: 2 })

    type Acquisition = {
      collectionId: string
      options: TransportedLoadSubsetOptions
      acquiredLeaderId: string | null
    }
    const internals = coordinator as unknown as {
      nodeId: string
      collections: Map<string, { isLeader: boolean; leaderId: string | null }>
      outboundRemoteSubsetAcquisitions: Map<string, Acquisition>
      acquireRemoteSubset: (acquisition: Acquisition) => Promise<void>
      replayRemoteSubsetAcquisitions: (collectionId: string) => Promise<void>
    }
    internals.collections.set(`todos`, {
      isLeader: true,
      leaderId: internals.nodeId,
    })
    const acquisitions = [
      ...internals.outboundRemoteSubsetAcquisitions.values(),
    ]
    for (const acquisition of acquisitions) {
      acquisition.acquiredLeaderId = `retired-electron-leader`
    }
    let releaseFirstReplay = (): void => {}
    const firstReplayGate = new Promise<void>((resolve) => {
      releaseFirstReplay = resolve
    })
    const starts: Array<number | undefined> = []
    internals.acquireRemoteSubset = async (acquisition) => {
      starts.push(acquisition.options.offset)
      if (acquisition.options.offset === 1) await firstReplayGate
    }

    try {
      const replay = internals.replayRemoteSubsetAcquisitions(`todos`)
      await Promise.resolve()
      const startsBeforeFirstFinished = [...starts]
      expect(startsBeforeFirstFinished).toEqual([1, 2])
      releaseFirstReplay()
      await replay
    } finally {
      releaseFirstReplay()
      unregisterOwner()
      coordinator.dispose()
    }
  })

  it(`reports a failed Electron replay once without self-retrying`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-subset-replay-error`,
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.isLeader = () => true
    const replayError = new Error(`replacement Electron owner is not ready`)
    const ownerErrors: Array<unknown> = []
    const owner = Object.assign(
      vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(replayError),
      {
        unloadSubset: vi.fn(),
        onError: (error: unknown) => ownerErrors.push(error),
      },
    )
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const options: LoadSubsetOptions = { limit: 1 }
    await coordinator.requestEnsureRemoteSubset(`todos`, options)
    type Acquisition = {
      acquiredLeaderId: string | null
      inFlight: Promise<void> | null
    }
    const internals = coordinator as unknown as {
      nodeId: string
      collections: Map<string, { isLeader: boolean; leaderId: string | null }>
      outboundRemoteSubsetAcquisitions: Map<string, Acquisition>
      releaseInboundRemoteSubsetAcquisitions: (collectionId: string) => void
      replayRemoteSubsetAcquisitions: (collectionId: string) => Promise<void>
    }
    internals.collections.set(`todos`, {
      isLeader: true,
      leaderId: internals.nodeId,
    })
    const [acquisition] = internals.outboundRemoteSubsetAcquisitions.values()
    internals.releaseInboundRemoteSubsetAcquisitions(`todos`)
    await vi.waitFor(() => expect(owner.unloadSubset).toHaveBeenCalledTimes(1))
    acquisition!.acquiredLeaderId = `retired-electron-leader`
    const unhandled: Array<unknown> = []
    const onUnhandled = (error: unknown) => unhandled.push(error)
    process.on(`unhandledRejection`, onUnhandled)

    try {
      await internals.replayRemoteSubsetAcquisitions(`todos`)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect({
        attempts: owner.mock.calls.length - 1,
        ownerErrors,
        acquiredLeaderId: acquisition!.acquiredLeaderId,
        inFlight: acquisition!.inFlight,
        unhandled,
      }).toEqual({
        attempts: 1,
        ownerErrors: [replayError],
        acquiredLeaderId: `retired-electron-leader`,
        inFlight: null,
        unhandled: [],
      })
    } finally {
      process.off(`unhandledRejection`, onUnhandled)
      unregisterOwner()
      coordinator.dispose()
    }
  })

  it(`keeps a failed remote Electron follower replay out of its local owner lifecycle`, async () => {
    const dbName = `electron-remote-replay-error`
    const coordinator = new ElectronCollectionCoordinator({
      dbName,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.isLeader = () => false
    const internals = coordinator as unknown as {
      onChannelMessage: (message: unknown) => void
      acquireLeadership: () => Promise<void>
      sendRPC: (collectionId: string, request: unknown) => Promise<unknown>
      outboundRemoteSubsetAcquisitions: Map<
        string,
        { acquiredLeaderId: string | null; inFlight: Promise<void> | null }
      >
    }
    internals.acquireLeadership = async () => {}
    const heartbeat = (leaderId: string, term: number) =>
      internals.onChannelMessage({
        v: 1,
        dbName,
        collectionId: `todos`,
        senderId: leaderId,
        ts: Date.now(),
        payload: {
          type: `leader:heartbeat`,
          term,
          leaderId,
          latestSeq: 0,
          latestRowVersion: 0,
        },
      })
    heartbeat(`remote-electron-a`, 1)
    const ownerErrors: Array<unknown> = []
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: (error: unknown) => ownerErrors.push(error),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    internals.sendRPC = vi.fn().mockResolvedValue({
      type: `rpc:ensureRemoteSubset:res`,
      rpcId: `initial-electron`,
      ok: true,
      leaderId: `remote-electron-a`,
    })
    const options: LoadSubsetOptions = { limit: 1 }

    try {
      await coordinator.requestEnsureRemoteSubset(`todos`, options)
      const replayError = new Error(`remote Electron replay transport failed`)
      const replayRPC = vi.fn().mockRejectedValue(replayError)
      internals.sendRPC = replayRPC
      heartbeat(`remote-electron-b`, 2)
      await vi.waitFor(() => expect(replayRPC).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => {
        const [acquisition] =
          internals.outboundRemoteSubsetAcquisitions.values()
        expect(acquisition?.inFlight).toBeNull()
      })

      const [acquisition] = internals.outboundRemoteSubsetAcquisitions.values()
      expect({
        ownerErrors,
        attempts: replayRPC.mock.calls.length,
        acquiredLeaderId: acquisition?.acquiredLeaderId,
        retained: internals.outboundRemoteSubsetAcquisitions.size,
      }).toEqual({
        ownerErrors: [],
        attempts: 1,
        acquiredLeaderId: `remote-electron-a`,
        retained: 1,
      })
    } finally {
      unregisterOwner()
      coordinator.dispose()
    }
  })

  it(`expires Electron release tombstones after the existing RPC dedupe horizon`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-release-tombstone-expiry`,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.isLeader = () => true
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const now = vi.spyOn(Date, `now`)
    const internals = coordinator as unknown as {
      inboundRemoteSubsetAcquisitions: Map<string, unknown>
    }

    try {
      for (let index = 0; index < 8; index++) {
        now.mockReturnValue(index * 60_001)
        const options = { offset: index }
        await coordinator.requestEnsureRemoteSubset(`todos`, options)
        await coordinator.requestReleaseRemoteSubset(`todos`, options)
      }

      expect({
        loads: owner.mock.calls.length,
        unloads: owner.unloadSubset.mock.calls.length,
        retained: internals.inboundRemoteSubsetAcquisitions.size,
      }).toEqual({ loads: 8, unloads: 8, retained: 1 })
    } finally {
      now.mockRestore()
      unregisterOwner()
      coordinator.dispose()
    }
  })

  it(`ignores a lower-term Electron heartbeat without replaying to its stale leader`, () => {
    const dbName = `electron-stale-heartbeat`
    const coordinator = new ElectronCollectionCoordinator({
      dbName,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.isLeader = () => false
    const internals = coordinator as unknown as {
      onChannelMessage: (message: unknown) => void
      acquireLeadership: () => Promise<void>
      collections: Map<string, { leaderId: string | null; latestTerm: number }>
      replayRemoteSubsetAcquisitions: (collectionId: string) => Promise<void>
    }
    internals.acquireLeadership = async () => {}
    const replay = vi.fn(() => Promise.resolve())
    internals.replayRemoteSubsetAcquisitions = replay
    const heartbeat = (leaderId: string, term: number) =>
      internals.onChannelMessage({
        v: 1,
        dbName,
        collectionId: `todos`,
        senderId: leaderId,
        ts: Date.now(),
        payload: {
          type: `leader:heartbeat`,
          term,
          leaderId,
          latestSeq: 0,
          latestRowVersion: 0,
        },
      })

    heartbeat(`remote-electron-b`, 2)
    replay.mockClear()
    heartbeat(`retired-electron-a`, 1)
    const state = internals.collections.get(`todos`)

    expect({
      leaderId: state?.leaderId,
      latestTerm: state?.latestTerm,
      replayCalls: replay.mock.calls.length,
    }).toEqual({
      leaderId: `remote-electron-b`,
      latestTerm: 2,
      replayCalls: 0,
    })
  })

  it(`reports owner unload rejection while completing sibling Electron cleanup`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-subset-owner-unload-error`,
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.isLeader = () => true
    const unloadError = new Error(`electron owner unload failed`)
    const ownerErrors: Array<unknown> = []
    const unloadSubset = vi.fn((options: TransportedLoadSubsetOptions) =>
      options.offset === 1 ? Promise.reject(unloadError) : undefined,
    )
    const owner = Object.assign(vi.fn(), {
      unloadSubset,
      onError: (error: unknown) => ownerErrors.push(error),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    await coordinator.requestEnsureRemoteSubset(`todos`, { offset: 1 })
    await coordinator.requestEnsureRemoteSubset(`todos`, { offset: 2 })
    const unhandled: Array<unknown> = []
    const onUnhandled = (error: unknown) => unhandled.push(error)
    process.on(`unhandledRejection`, onUnhandled)
    const internals = coordinator as unknown as {
      inboundRemoteSubsetAcquisitions: Map<
        string,
        { release: Promise<void> | null }
      >
      releaseInboundRemoteSubsetAcquisitions: (collectionId: string) => void
    }

    try {
      internals.releaseInboundRemoteSubsetAcquisitions(`todos`)
      const releases = [
        ...internals.inboundRemoteSubsetAcquisitions.values(),
      ].map((acquisition) => acquisition.release!)
      const outcomes = await Promise.allSettled(releases)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      expect({
        outcomes: outcomes.map((outcome) =>
          outcome.status === `rejected` ? outcome.reason : outcome.status,
        ),
        unloadOffsets: unloadSubset.mock.calls.map(
          ([options]) => options.offset,
        ),
        ownerErrors,
        unhandled,
      }).toEqual({
        outcomes: [unloadError, `fulfilled`],
        unloadOffsets: [1, 2],
        ownerErrors: [unloadError],
        unhandled: [],
      })
    } finally {
      process.off(`unhandledRejection`, onUnhandled)
      unregisterOwner()
      coordinator.dispose()
    }
  })

  it(`reports local Electron disposal unload rejection once and completes cleanup`, async () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-subset-disposal-unload-error`,
      adapter: createElectronCoordinatorTestAdapter(),
    })
    registerCleanup(() => coordinator.dispose())
    coordinator.isLeader = () => true
    const unloadError = new Error(`electron disposal unload failed`)
    const ownerErrors: Array<unknown> = []
    const unloadSubset = vi.fn((options: TransportedLoadSubsetOptions) =>
      options.offset === 23 ? Promise.reject(unloadError) : undefined,
    )
    const owner = Object.assign(vi.fn(), {
      unloadSubset,
      onError: (error: unknown) => ownerErrors.push(error),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    await coordinator.requestEnsureRemoteSubset(`todos`, { offset: 23 })
    await coordinator.requestEnsureRemoteSubset(`todos`, { offset: 24 })
    const unhandled: Array<unknown> = []
    const onUnhandled = (error: unknown) => unhandled.push(error)
    process.on(`unhandledRejection`, onUnhandled)
    const internals = coordinator as unknown as {
      collections: Map<string, unknown>
      pendingRPCs: Map<string, unknown>
      remoteSubsetOwners: Map<string, unknown>
      outboundRemoteSubsetAcquisitions: Map<string, unknown>
      inboundRemoteSubsetAcquisitions: Map<string, unknown>
    }

    try {
      coordinator.dispose()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      expect({
        unloadOffsets: unloadSubset.mock.calls.map(
          ([options]) => options.offset,
        ),
        ownerErrors,
        unhandled,
        collections: internals.collections.size,
        pendingRPCs: internals.pendingRPCs.size,
        owners: internals.remoteSubsetOwners.size,
        outbound: internals.outboundRemoteSubsetAcquisitions.size,
        inbound: internals.inboundRemoteSubsetAcquisitions.size,
      }).toEqual({
        unloadOffsets: [23, 24],
        ownerErrors: [unloadError],
        unhandled: [],
        collections: 0,
        pendingRPCs: 0,
        owners: 0,
        outbound: 0,
        inbound: 0,
      })
    } finally {
      process.off(`unhandledRejection`, onUnhandled)
      unregisterOwner()
      coordinator.dispose()
    }
  })

  it(`rejects duplicate Electron remote-subset owners`, () => {
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `electron-subset-owner-duplicate`,
    })
    registerCleanup(() => coordinator.dispose())
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    }) satisfies RemoteSubsetOwner
    const duplicate = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    }) satisfies RemoteSubsetOwner
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )

    try {
      expect(() =>
        coordinator.registerRemoteSubsetOwner(`todos`, duplicate),
      ).toThrowError(
        expect.objectContaining({
          name: `DuplicateRemoteSubsetOwnerError`,
          collectionId: `todos`,
        }),
      )
    } finally {
      unregisterOwner()
    }
  })

  it(`does not answer a held inbound request after its Electron leader is disposed`, async () => {
    registerCleanup(installImmediatelyGrantedWebLocks())
    let applyEntered = false
    let releaseApply = (): void => {}
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve
    })
    const durableTransactions: Array<PersistedTx> = []
    const leader = new ElectronCollectionCoordinator({
      dbName: `electron-dispose-held-inbound`,
      adapter: {
        loadSubset: () => Promise.resolve([]),
        applyCommittedTx: async (_collectionId, tx) => {
          applyEntered = true
          await applyGate
          durableTransactions.push(structuredClone(tx))
        },
        ensureIndex: () => Promise.resolve(),
      },
    })
    const follower = new ElectronCollectionCoordinator({
      dbName: `electron-dispose-held-inbound`,
    })
    // This fixture isolates the leader's post-disposal response boundary. Its
    // immediate-grant lock shim cannot model a blocked follower election.
    ;(
      follower as unknown as {
        acquireLeadership: () => Promise<void>
      }
    ).acquireLeadership = async () => {}
    registerCleanup(() => leader.dispose())
    registerCleanup(() => follower.dispose())
    leader.subscribe(`todos`, () => {})
    await waitForLeadership(leader, `todos`)

    const leaderInternals = leader as unknown as {
      channel: BroadcastChannel
      appliedCommittedTxEnvelopes: Map<string, unknown>
      inFlightCommittedTxEnvelopes: Map<string, unknown>
    }
    const followerInternals = follower as unknown as {
      sendRPCOnce: (
        collectionId: string,
        request: ApplyCommittedTxRequest,
      ) => Promise<unknown>
    }
    const originalPostMessage = leaderInternals.channel.postMessage.bind(
      leaderInternals.channel,
    )
    let leaderDisposed = false
    let postAfterDispose = 0
    leaderInternals.channel.postMessage = (message: unknown) => {
      if (leaderDisposed) postAfterDispose++
      originalPostMessage(message)
    }

    const outcomePromise = followerInternals
      .sendRPCOnce(`todos`, {
        type: `rpc:applyCommittedTx:req`,
        rpcId: `held-inbound-rpc`,
        envelopeId: `held-inbound-envelope`,
        tx: {
          txId: `held-inbound-tx`,
          term: 0,
          seq: 0,
          rowVersion: 0,
          mutations: [],
        },
      })
      .then(
        (response) => ({ response }),
        (error: unknown) => ({ error }),
      )

    try {
      await vi.waitFor(() => expect(applyEntered).toBe(true))
      leaderDisposed = true
      leader.dispose()
      releaseApply()
      await vi.waitFor(() => expect(durableTransactions).toHaveLength(1))
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      expect({
        postAfterDispose,
        completed: leaderInternals.appliedCommittedTxEnvelopes.size,
        inFlight: leaderInternals.inFlightCommittedTxEnvelopes.size,
      }).toEqual({ postAfterDispose: 0, completed: 0, inFlight: 0 })

      follower.dispose()
      expect(await outcomePromise).toEqual({
        error: new Error(`coordinator disposed`),
      })
    } finally {
      releaseApply()
      leader.dispose()
      follower.dispose()
    }
  })

  it(`returns deterministic timeout errors`, async () => {
    const neverInvoke: ElectronPersistenceInvoke = async () =>
      await new Promise<ElectronPersistenceResponseEnvelope>(() => {})

    const rendererPersistence = createElectronSQLitePersistence({
      invoke: neverInvoke,
      timeoutMs: 5,
    })

    await expect(
      rendererPersistence.adapter.loadSubset(`todos`, {}),
    ).rejects.toBeInstanceOf(InvalidPersistedCollectionConfigError)
  })

  it(`returns remote errors for unknown collections`, async () => {
    const dbPath = createTempDbPath()
    const invokeHarness = createInvokeHarness(dbPath, `known`, false)
    activeCleanupFns.push(() => invokeHarness.close())
    const rendererPersistence = createElectronSQLitePersistence({
      invoke: invokeHarness.invoke,
      timeoutMs: electronRuntimeBridgeTimeoutMs,
    })

    await expect(
      rendererPersistence.adapter.loadSubset(`missing`, {}),
    ).rejects.toThrow(`Unknown electron persistence collection`)
  })

  it(`registers and unregisters ipc handlers through thin api`, async () => {
    let registeredChannel: string | undefined
    let registeredHandler:
      | ((
          event: unknown,
          request: ElectronPersistenceRequestEnvelope,
        ) => Promise<ElectronPersistenceResponseEnvelope>)
      | undefined
    const removedChannels: Array<string> = []

    const fakeIpcMain = {
      handle: (
        channel: string,
        handler: (
          event: unknown,
          request: ElectronPersistenceRequestEnvelope,
        ) => Promise<ElectronPersistenceResponseEnvelope>,
      ) => {
        registeredChannel = channel
        registeredHandler = handler
      },
      removeHandler: (channel: string) => {
        removedChannels.push(channel)
      },
    }

    const driver = new BetterSqlite3SQLiteDriver({
      filename: createTempDbPath(),
    })
    activeCleanupFns.push(() => driver.close())
    const persistence = createNodeSQLitePersistence({
      database: driver.getDatabase(),
    })

    const dispose = exposeElectronSQLitePersistence({
      ipcMain: fakeIpcMain,
      persistence,
    })

    expect(registeredChannel).toBe(DEFAULT_ELECTRON_PERSISTENCE_CHANNEL)
    expect(registeredHandler).toBeDefined()

    const response = await registeredHandler?.(undefined, {
      v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
      requestId: `req-1`,
      collectionId: `todos`,
      method: `loadSubset`,
      payload: {
        options: {},
      },
    })
    expect(response).toMatchObject({
      ok: true,
      requestId: `req-1`,
      method: `loadSubset`,
    })

    dispose()
    expect(removedChannels).toEqual([DEFAULT_ELECTRON_PERSISTENCE_CHANNEL])
  })
})
