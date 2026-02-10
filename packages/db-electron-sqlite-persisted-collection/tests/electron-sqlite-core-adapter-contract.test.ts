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
import type {
  SQLiteCoreAdapterContractTodo,
  SQLiteCoreAdapterHarnessFactory,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-core-adapter-contract'
import type { ElectronPersistenceInvoke } from '../src'

const createHarness: SQLiteCoreAdapterHarnessFactory = (options) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-electron-contract-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const driver = createBetterSqlite3Driver({ filename: dbPath })

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
  const invoke: ElectronPersistenceInvoke = async (_channel, request) =>
    host.handleRequest(request)

  const rendererAdapter = createElectronRendererPersistenceAdapter<
    SQLiteCoreAdapterContractTodo,
    string
  >({
    invoke,
    timeoutMs: 2_000,
  })

  return {
    adapter: rendererAdapter,
    driver,
    cleanup: () => {
      try {
        driver.close()
      } finally {
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    },
  }
}

runSQLiteCoreAdapterContractSuite(
  `SQLiteCorePersistenceAdapter contract over electron IPC bridge`,
  createHarness,
)
