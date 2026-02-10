import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createBetterSqlite3Driver,
  createNodeSQLitePersistenceAdapter,
} from '@tanstack/db-node-sqlite-persisted-collection'
import { runSQLiteCoreAdapterContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-core-adapter-contract'
import {
  createElectronPersistenceMainHost,
  createElectronRendererPersistenceAdapter,
} from '../src'
import {
  createElectronRuntimeBridgeInvoke,
  isElectronFullE2EEnabled,
} from './e2e/electron-process-client'
import type {
  SQLiteCoreAdapterContractTodo,
  SQLiteCoreAdapterHarnessFactory,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-core-adapter-contract'
import type { ElectronPersistenceInvoke } from '../src'

const createHarness: SQLiteCoreAdapterHarnessFactory = (options) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-electron-contract-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const runFullE2E = isElectronFullE2EEnabled()
  const requestTimeoutMs = runFullE2E ? 45_000 : 2_000
  const driver = createBetterSqlite3Driver({
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
    const mainAdapter = createNodeSQLitePersistenceAdapter<
      Record<string, unknown>,
      string | number
    >({
      driver,
      ...options,
    })
    const host = createElectronPersistenceMainHost({
      getAdapter: () => mainAdapter,
    })
    invoke = async (_channel, request) => host.handleRequest(request)
    cleanupInvoke = () => {}
  }

  const rendererAdapter = createElectronRendererPersistenceAdapter<
    SQLiteCoreAdapterContractTodo,
    string
  >({
    invoke,
    timeoutMs: requestTimeoutMs,
  })

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
