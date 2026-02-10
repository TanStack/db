import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createBetterSqlite3Driver,
  createNodeSQLitePersistenceAdapter,
} from '@tanstack/db-node-sqlite-persisted-collection'
import {
  DEFAULT_ELECTRON_PERSISTENCE_CHANNEL,
  ElectronPersistenceMainRegistry,
  ElectronPersistenceRpcError,
  ElectronPersistenceTimeoutError,
  createElectronNodeSQLiteMainRegistry,
  createElectronRendererPersistence,
  createElectronRendererPersistenceAdapter,
  registerElectronPersistenceMainIpcHandler,
} from '../src'
import type {
  ElectronPersistenceInvoke,
  ElectronPersistenceRequest,
  ElectronPersistenceResponse,
} from '../src'

type Todo = {
  id: string
  title: string
  score: number
}

type MainRuntime = {
  host: ReturnType<ElectronPersistenceMainRegistry[`createHost`]>
  close: () => void
}

function createMainRuntime(dbPath: string, collectionId: string): MainRuntime {
  const driver = createBetterSqlite3Driver({ filename: dbPath })
  const adapter = createNodeSQLitePersistenceAdapter<
    Record<string, unknown>,
    string | number
  >({
    driver,
  })

  const registry = new ElectronPersistenceMainRegistry()
  registry.registerCollection(collectionId, adapter)

  return {
    host: registry.createHost(),
    close: () => {
      driver.close()
      registry.clear()
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
  it(`round-trips reads and writes through main-process host`, async () => {
    const dbPath = createTempDbPath()
    const runtime = createMainRuntime(dbPath, `todos`)
    activeCleanupFns.push(() => runtime.close())

    const invoke: ElectronPersistenceInvoke = async (channel, request) => {
      expect(channel).toBe(DEFAULT_ELECTRON_PERSISTENCE_CHANNEL)
      return runtime.host.handleRequest(request)
    }

    const rendererAdapter = createElectronRendererPersistenceAdapter<
      Todo,
      string
    >({
      invoke,
    })

    await rendererAdapter.applyCommittedTx(`todos`, {
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

    const rows = await rendererAdapter.loadSubset(`todos`, {})
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

  it(`persists data across main-process restarts`, async () => {
    const dbPath = createTempDbPath()

    const runtimeA = createMainRuntime(dbPath, `todos`)
    const invokeA: ElectronPersistenceInvoke = (_channel, request) =>
      runtimeA.host.handleRequest(request)
    const rendererAdapterA = createElectronRendererPersistenceAdapter<
      Todo,
      string
    >({
      invoke: invokeA,
    })

    await rendererAdapterA.applyCommittedTx(`todos`, {
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
    runtimeA.close()

    const runtimeB = createMainRuntime(dbPath, `todos`)
    activeCleanupFns.push(() => runtimeB.close())
    const invokeB: ElectronPersistenceInvoke = (_channel, request) =>
      runtimeB.host.handleRequest(request)
    const rendererAdapterB = createElectronRendererPersistenceAdapter<
      Todo,
      string
    >({
      invoke: invokeB,
    })

    const rows = await rendererAdapterB.loadSubset(`todos`, {})
    expect(rows.map((row) => row.key)).toEqual([`persisted`])
    expect(rows[0]?.value.title).toBe(`Survives restart`)
  })

  it(`returns deterministic timeout errors`, async () => {
    const neverInvoke: ElectronPersistenceInvoke = async () =>
      await new Promise<ElectronPersistenceResponse>(() => {})

    const rendererAdapter = createElectronRendererPersistenceAdapter<
      Todo,
      string
    >({
      invoke: neverInvoke,
      timeoutMs: 5,
    })

    await expect(
      rendererAdapter.loadSubset(`todos`, {}),
    ).rejects.toBeInstanceOf(ElectronPersistenceTimeoutError)
  })

  it(`returns structured remote errors for unknown collections`, async () => {
    const dbPath = createTempDbPath()
    const runtime = createMainRuntime(dbPath, `known`)
    activeCleanupFns.push(() => runtime.close())

    const invoke: ElectronPersistenceInvoke = (_channel, request) =>
      runtime.host.handleRequest(request)
    const rendererAdapter = createElectronRendererPersistenceAdapter<
      Todo,
      string
    >({
      invoke,
    })

    await expect(
      rendererAdapter.loadSubset(`missing`, {}),
    ).rejects.toMatchObject({
      name: `ElectronPersistenceRpcError`,
      code: `UNKNOWN_COLLECTION`,
    })

    await expect(
      rendererAdapter.loadSubset(`missing`, {}),
    ).rejects.toBeInstanceOf(ElectronPersistenceRpcError)
  })

  it(`wires renderer persistence helper with default and custom coordinator`, () => {
    const invoke: ElectronPersistenceInvoke = (_channel, request) =>
      Promise.resolve({
        v: 1,
        requestId: request.requestId,
        method: request.method,
        ok: true,
        result: null,
      }) as Promise<ElectronPersistenceResponse>

    const persistenceWithDefault = createElectronRendererPersistence({
      invoke,
    })
    expect(persistenceWithDefault.coordinator).toBeTruthy()

    const customCoordinator = persistenceWithDefault.coordinator
    const persistenceWithCustom = createElectronRendererPersistence({
      invoke,
      coordinator: customCoordinator,
    })
    expect(persistenceWithCustom.coordinator).toBe(customCoordinator)
  })

  it(`registers and unregisters electron ipc handlers`, async () => {
    let registeredChannel: string | undefined
    let registeredHandler:
      | ((
          event: unknown,
          request: ElectronPersistenceRequest,
        ) => Promise<ElectronPersistenceResponse>)
      | undefined
    const removedChannels: Array<string> = []

    const fakeIpcMain = {
      handle: (
        channel: string,
        handler: (
          event: unknown,
          request: ElectronPersistenceRequest,
        ) => Promise<ElectronPersistenceResponse>,
      ) => {
        registeredChannel = channel
        registeredHandler = handler
      },
      removeHandler: (channel: string) => {
        removedChannels.push(channel)
      },
    }

    const host = {
      handleRequest: (
        request: ElectronPersistenceRequest,
      ): Promise<ElectronPersistenceResponse> => {
        switch (request.method) {
          case `loadSubset`:
            return Promise.resolve({
              v: 1,
              requestId: request.requestId,
              method: request.method,
              ok: true,
              result: [],
            })
          case `pullSince`:
            return Promise.resolve({
              v: 1,
              requestId: request.requestId,
              method: request.method,
              ok: true,
              result: {
                latestRowVersion: 0,
                requiresFullReload: true,
              },
            })
          default:
            return Promise.resolve({
              v: 1,
              requestId: request.requestId,
              method: request.method,
              ok: true,
              result: null,
            })
        }
      },
    }

    const dispose = registerElectronPersistenceMainIpcHandler({
      ipcMain: fakeIpcMain,
      host,
    })

    expect(registeredChannel).toBe(DEFAULT_ELECTRON_PERSISTENCE_CHANNEL)
    expect(registeredHandler).toBeDefined()

    const response = await registeredHandler?.(undefined, {
      v: 1,
      requestId: `req-1`,
      collectionId: `todos`,
      method: `ensureIndex`,
      payload: {
        signature: `sig`,
        spec: {
          expressionSql: [`json_extract(value, '$.id')`],
        },
      },
    })

    expect(response).toMatchObject({
      ok: true,
      requestId: `req-1`,
      method: `ensureIndex`,
    })

    dispose()
    expect(removedChannels).toEqual([DEFAULT_ELECTRON_PERSISTENCE_CHANNEL])
  })

  it(`reuses node adapter logic through helper registry`, async () => {
    const dbPath = createTempDbPath()
    const driver = createBetterSqlite3Driver({ filename: dbPath })
    activeCleanupFns.push(() => {
      driver.close()
    })

    const registry = createElectronNodeSQLiteMainRegistry([
      {
        collectionId: `todos`,
        adapterOptions: {
          driver,
        },
      },
    ])
    activeCleanupFns.push(() => {
      registry.clear()
    })
    const host = registry.createHost()

    const invoke: ElectronPersistenceInvoke = (_channel, request) =>
      host.handleRequest(request)
    const rendererAdapter = createElectronRendererPersistenceAdapter<
      Todo,
      string
    >({
      invoke,
    })

    await rendererAdapter.applyCommittedTx(`todos`, {
      txId: `tx-helper-1`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        {
          type: `insert`,
          key: `helper`,
          value: {
            id: `helper`,
            title: `Node helper`,
            score: 9,
          },
        },
      ],
    })

    const rows = await rendererAdapter.loadSubset(`todos`, {})
    expect(rows).toHaveLength(1)
    expect(rows[0]?.key).toBe(`helper`)
  })
})
