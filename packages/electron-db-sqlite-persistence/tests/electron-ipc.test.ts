import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  InvalidPersistedCollectionConfigError,
  persistedCollectionOptions,
} from '@tanstack/db-sqlite-persistence-core'
import { createNodeSQLitePersistence } from '@tanstack/node-db-sqlite-persistence'
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
import type { PersistedCollectionPersistence } from '@tanstack/db-sqlite-persistence-core'
import type {
  ElectronPersistenceInvoke,
  ElectronPersistenceRequestEnvelope,
  ElectronPersistenceResponseEnvelope,
} from '../src/protocol'

type InvokeHarness = {
  invoke: ElectronPersistenceInvoke
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
    loadResumeSnapshot: (requestedCollectionId, ctx) => {
      assertKnownCollection(requestedCollectionId)
      return baseAdapter.loadResumeSnapshot(requestedCollectionId, ctx)
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
      collectionMetadataMutations: [
        {
          type: `set`,
          key: `resume:test`,
          value: { offset: `1_0` },
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

    const resumeSnapshot = await rendererPersistence.adapter.loadResumeSnapshot(
      `todos`,
      {
        includeRows: true,
      },
    )
    expect(resumeSnapshot).toEqual({
      rows: [
        {
          key: `1`,
          metadata: undefined,
          value: {
            id: `1`,
            title: `From renderer`,
            score: 10,
          },
        },
      ],
      keySet: { status: `consistent` },
      collectionMetadata: [
        {
          key: `resume:test`,
          value: { offset: `1_0` },
        },
      ],
      latestTerm: 1,
      latestSeq: 1,
      latestRowVersion: 1,
      resetEpoch: 0,
    })

    await expect(
      rendererPersistence.adapter.loadResumeSnapshot(`todos`, {
        includeRows: false,
      }),
    ).resolves.toEqual({
      ...resumeSnapshot,
      rows: [],
    })
  })

  it.each([
    { schemaV1: 1, schemaV2: 2 },
    { schemaV1: 2, schemaV2: 4 },
  ])(
    `routes coordinator writes through each collection's renderer adapter: $schemaV1/$schemaV2`,
    async ({ schemaV1, schemaV2 }) => {
      const dbPath = createTempDbPath()
      const invokeHarness = createInvokeHarness(dbPath, `unused`)
      activeCleanupFns.push(() => invokeHarness.close())
      const originalNavigator = globalThis.navigator
      Object.defineProperty(globalThis, `navigator`, {
        configurable: true,
        value: {
          ...originalNavigator,
          locks: {
            request: (
              _name: string,
              optionsOrCallback:
                | { signal?: AbortSignal }
                | ((lock: { name: string }) => Promise<unknown>),
              maybeCallback?: (lock: { name: string }) => Promise<unknown>,
            ) => {
              const callback =
                typeof optionsOrCallback === `function`
                  ? optionsOrCallback
                  : maybeCallback!
              return callback({ name: _name })
            },
          },
        },
      })

      const coordinator = new ElectronCollectionCoordinator({
        dbName: `electron-schema-routing`,
      })
      const persistence = createElectronSQLitePersistence({
        invoke: invokeHarness.invoke,
        coordinator,
      })
      const collectionV1 = `electron-schema-v1`
      const collectionV2 = `electron-schema-v2`

      try {
        const optionsV1 = persistedCollectionOptions<
          { id: string; title: string },
          string
        >({
          id: collectionV1,
          schemaVersion: schemaV1,
          getKey: (row) => row.id,
          persistence,
        })
        const optionsV2 = persistedCollectionOptions<
          { id: string; title: string },
          string
        >({
          id: collectionV2,
          schemaVersion: schemaV2,
          getKey: (row) => row.id,
          persistence,
        })
        await optionsV1.persistence.adapter.loadResumeSnapshot(collectionV1)
        await optionsV2.persistence.adapter.loadResumeSnapshot(collectionV2)

        coordinator.subscribe(collectionV1, () => {})
        coordinator.subscribe(collectionV2, () => {})
        await vi.waitFor(() => {
          expect(coordinator.isLeader(collectionV1)).toBe(true)
          expect(coordinator.isLeader(collectionV2)).toBe(true)
        })

        const [resultV1, resultV2] = await Promise.all([
          coordinator.requestApplyLocalMutations(collectionV1, [
            {
              mutationId: `mutation-v1`,
              type: `insert`,
              key: `v1`,
              value: { id: `v1`, title: `schema one` },
            },
          ]),
          coordinator.requestApplyLocalMutations(collectionV2, [
            {
              mutationId: `mutation-v2`,
              type: `insert`,
              key: `v2`,
              value: { id: `v2`, title: `schema two` },
            },
          ]),
        ])

        expect(resultV1.ok).toBe(true)
        expect(resultV2.ok).toBe(true)
        expect(
          await optionsV1.persistence.adapter.loadSubset(collectionV1, {}),
        ).toMatchObject([
          { key: `v1`, value: { id: `v1`, title: `schema one` } },
        ])
        expect(
          await optionsV2.persistence.adapter.loadSubset(collectionV2, {}),
        ).toMatchObject([
          { key: `v2`, value: { id: `v2`, title: `schema two` } },
        ])
      } finally {
        coordinator.dispose()
        Object.defineProperty(globalThis, `navigator`, {
          configurable: true,
          value: originalNavigator,
        })
      }
    },
  )

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

  it(`rejects a version-1 main response before reading its result`, async () => {
    const rendererPersistence = createElectronSQLitePersistence({
      invoke: (_channel, request) =>
        Promise.resolve({
          v: 1,
          requestId: request.requestId,
          method: request.method,
          ok: true,
          result: null,
        } as unknown as ElectronPersistenceResponseEnvelope),
    })

    await expect(
      rendererPersistence.adapter.loadResumeSnapshot(`todos`),
    ).rejects.toThrow(
      `Unexpected electron persistence protocol version "1" in response`,
    )
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

    const resumeResponse = await registeredHandler?.(undefined, {
      v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
      requestId: `req-2`,
      collectionId: `todos`,
      method: `loadResumeSnapshot`,
      payload: {
        ctx: { includeRows: false },
      },
    })
    expect(resumeResponse).toMatchObject({
      ok: true,
      requestId: `req-2`,
      method: `loadResumeSnapshot`,
      result: {
        rows: [],
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      },
    })

    const legacyVersionResponse = await registeredHandler?.(undefined, {
      v: 1,
      requestId: `req-v1`,
      collectionId: `todos`,
      method: `loadResumeSnapshot`,
      payload: {},
    })
    expect(legacyVersionResponse).toMatchObject({
      v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
      requestId: `req-v1`,
      method: `loadResumeSnapshot`,
      ok: false,
      error: {
        message: `Unsupported electron persistence protocol version "1"`,
      },
    })

    dispose()
    expect(removedChannels).toEqual([DEFAULT_ELECTRON_PERSISTENCE_CHANNEL])
  })
})
