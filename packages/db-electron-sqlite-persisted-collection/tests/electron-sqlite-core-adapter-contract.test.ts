import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BetterSqlite3SQLiteDriver } from '@tanstack/db-node-sqlite-persisted-collection'
import { createSQLiteCorePersistenceAdapter } from '@tanstack/db-sqlite-persisted-collection-core'
import { runSQLiteCoreAdapterContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-core-adapter-contract'
import {
  createElectronSQLitePersistence,
  exposeElectronSQLitePersistence,
} from '../src'
import {
  createElectronRuntimeBridgeInvoke,
  isElectronFullE2EEnabled,
} from './e2e/electron-process-client'
import type {
  SQLiteCoreAdapterContractTodo,
  SQLiteCoreAdapterHarnessFactory,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-core-adapter-contract'
import type {
  ElectronPersistenceInvoke,
  ElectronPersistenceResponseEnvelope,
} from '../src/protocol'

const createHarness: SQLiteCoreAdapterHarnessFactory = (options) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-electron-contract-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const runFullE2E = isElectronFullE2EEnabled()
  const requestTimeoutMs = runFullE2E ? 45_000 : 2_000
  const driver = new BetterSqlite3SQLiteDriver({
    filename: dbPath,
    pragmas: runFullE2E
      ? [`journal_mode = DELETE`, `synchronous = NORMAL`, `foreign_keys = ON`]
      : undefined,
  })

  let invoke: ElectronPersistenceInvoke
  let cleanupInvoke: () => void = () => {}
  if (runFullE2E) {
    invoke = createElectronRuntimeBridgeInvoke({
      dbPath,
      collectionId: `todos`,
      allowAnyCollectionId: true,
      timeoutMs: requestTimeoutMs,
      adapterOptions: options,
    })
  } else {
    const mainAdapter = createSQLiteCorePersistenceAdapter<
      Record<string, unknown>,
      string | number
    >({
      driver,
      ...options,
    })
    let handler:
      | ((event: unknown, request: unknown) => Promise<unknown>)
      | undefined
    const dispose = exposeElectronSQLitePersistence({
      ipcMain: {
        handle: (_channel, listener) => {
          handler = listener as (event: unknown, request: unknown) => Promise<unknown>
        },
        removeHandler: () => {},
      },
      persistence: {
        adapter: mainAdapter,
      },
    })
    invoke = async (_channel, request) => {
      if (!handler) {
        throw new Error(`Electron IPC handler not registered`)
      }
      return handler(undefined, request) as Promise<ElectronPersistenceResponseEnvelope>
    }
    cleanupInvoke = () => dispose()
  }

  const rendererAdapter = createElectronSQLitePersistence<
    SQLiteCoreAdapterContractTodo,
    string
  >({
    invoke,
    timeoutMs: requestTimeoutMs,
  }).adapter

  return {
    adapter: rendererAdapter,
    driver,
    cleanup: () => {
      try {
        cleanupInvoke()
      } finally {
        try {
          driver.close()
        } finally {
          rmSync(tempDirectory, { recursive: true, force: true })
        }
      }
    },
  }
}

const electronContractMode = isElectronFullE2EEnabled()
  ? `real electron e2e invoke`
  : `in-process invoke`

runSQLiteCoreAdapterContractSuite(
  `SQLiteCorePersistenceAdapter contract over electron IPC bridge (${electronContractMode})`,
  createHarness,
)
