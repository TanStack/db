import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InvalidPersistedCollectionConfigError } from '@tanstack/db-sqlite-persisted-collection-core'
import { createNodeSQLitePersistence } from '@tanstack/db-node-sqlite-persisted-collection'
import { BetterSqlite3SQLiteDriver } from '../../db-node-sqlite-persisted-collection/src/node-driver'
import {
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
import type { PersistedCollectionPersistence } from '@tanstack/db-sqlite-persisted-collection-core'
import type {
  ElectronPersistenceInvoke,
  ElectronPersistenceRequestEnvelope,
  ElectronPersistenceResponseEnvelope,
} from '../src/protocol'

type Todo = {
  id: string
  title: string
  score: number
}

type InvokeHarness = {
  invoke: ElectronPersistenceInvoke
  close: () => void
}

type ElectronMainPersistence = PersistedCollectionPersistence<
  Record<string, unknown>,
  string | number
>

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
  const persistence = createNodeSQLitePersistence<
    Record<string, unknown>,
    string | number
  >({
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

    const rendererPersistence = createElectronSQLitePersistence<Todo, string>({
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
      const rendererPersistence = createElectronSQLitePersistence<Todo, string>(
        {
          invoke,
          timeoutMs: electronRuntimeBridgeTimeoutMs,
        },
      )

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
    const rendererPersistenceA = createElectronSQLitePersistence<Todo, string>({
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
    const rendererPersistenceB = createElectronSQLitePersistence<Todo, string>({
      invoke: invokeHarnessB.invoke,
      timeoutMs: electronRuntimeBridgeTimeoutMs,
    })
    const rows = await rendererPersistenceB.adapter.loadSubset(`todos`, {})
    expect(rows[0]?.value.title).toBe(`Survives restart`)
  })

  it(`returns deterministic timeout errors`, async () => {
    const neverInvoke: ElectronPersistenceInvoke = async () =>
      await new Promise<ElectronPersistenceResponseEnvelope>(() => {})

    const rendererPersistence = createElectronSQLitePersistence<Todo, string>({
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
    const rendererPersistence = createElectronSQLitePersistence<Todo, string>({
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
    const persistence = createNodeSQLitePersistence<
      Record<string, unknown>,
      string | number
    >({
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
