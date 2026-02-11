import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SingleProcessCoordinator,
  createCloudflareDOSQLiteDriver,
  createCloudflareDOSQLitePersistence,
  resolveCloudflareDOSchemaMismatchPolicy,
} from '../src'
import { runRuntimePersistenceContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract'
import { createBetterSqliteDoStorageHarness } from './helpers/better-sqlite-do-storage'
import type {
  RuntimePersistenceContractTodo,
  RuntimePersistenceDatabaseHarness,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract'

function createRuntimeDatabaseHarness(): RuntimePersistenceDatabaseHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-cf-do-persistence-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const activeStorageHarnesses = new Set<
    ReturnType<typeof createBetterSqliteDoStorageHarness>
  >()

  return {
    createDriver: () => {
      const storageHarness = createBetterSqliteDoStorageHarness({
        filename: dbPath,
      })
      activeStorageHarnesses.add(storageHarness)
      return createCloudflareDOSQLiteDriver({
        sql: storageHarness.sql,
      })
    },
    cleanup: () => {
      for (const storageHarness of activeStorageHarnesses) {
        try {
          storageHarness.close()
        } catch {
          // ignore cleanup errors from already-closed handles
        }
      }
      activeStorageHarnesses.clear()
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
}

runRuntimePersistenceContractSuite(`cloudflare durable object runtime helpers`, {
  createDatabaseHarness: createRuntimeDatabaseHarness,
  createAdapter: (driver) =>
    createCloudflareDOSQLitePersistence<RuntimePersistenceContractTodo, string>({
      driver,
    }).adapter,
  createPersistence: (driver, coordinator) =>
    createCloudflareDOSQLitePersistence<RuntimePersistenceContractTodo, string>({
      driver,
      coordinator,
    }),
  createCoordinator: () => new SingleProcessCoordinator(),
})

describe(`cloudflare durable object persistence helpers`, () => {
  it(`defaults coordinator to SingleProcessCoordinator`, () => {
    const runtimeHarness = createRuntimeDatabaseHarness()
    const driver = runtimeHarness.createDriver()

    try {
      const persistence = createCloudflareDOSQLitePersistence({
        driver,
      })
      expect(persistence.coordinator).toBeInstanceOf(SingleProcessCoordinator)
    } finally {
      runtimeHarness.cleanup()
    }
  })

  it(`maps local mode to throw schema mismatch policy`, () => {
    expect(resolveCloudflareDOSchemaMismatchPolicy(`local`)).toBe(
      `sync-absent-error`,
    )
  })

  it(`maps sync mode to reset schema mismatch policy`, () => {
    expect(resolveCloudflareDOSchemaMismatchPolicy(`sync`)).toBe(
      `sync-present-reset`,
    )
  })
})
