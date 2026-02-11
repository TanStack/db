import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SingleProcessCoordinator,
  createCloudflareDOCollectionRegistry,
  createCloudflareDOSQLiteDriver,
  createCloudflareDOSQLitePersistence,
  createCloudflareDOSQLitePersistenceAdapter,
  initializeCloudflareDOCollections,
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

  it(`throws on schema mismatch in local mode`, async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), `db-cf-do-schema-local-`))
    const dbPath = join(tempDirectory, `state.sqlite`)
    const collectionId = `todos`
    const firstStorageHarness = createBetterSqliteDoStorageHarness({
      filename: dbPath,
    })
    const firstAdapter = createCloudflareDOSQLitePersistenceAdapter({
      driver: {
        sql: firstStorageHarness.sql,
      },
      mode: `local`,
      schemaVersion: 1,
    })

    try {
      await firstAdapter.applyCommittedTx(collectionId, {
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
              title: `before mismatch`,
              score: 1,
            },
          },
        ],
      })
    } finally {
      firstStorageHarness.close()
    }

    const secondStorageHarness = createBetterSqliteDoStorageHarness({
      filename: dbPath,
    })
    const secondAdapter = createCloudflareDOSQLitePersistenceAdapter({
      driver: {
        sql: secondStorageHarness.sql,
      },
      mode: `local`,
      schemaVersion: 2,
    })

    try {
      await expect(secondAdapter.loadSubset(collectionId, {})).rejects.toThrow(
        `Schema version mismatch`,
      )
    } finally {
      secondStorageHarness.close()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })

  it(`resets on schema mismatch in sync mode`, async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), `db-cf-do-schema-sync-`))
    const dbPath = join(tempDirectory, `state.sqlite`)
    const collectionId = `todos`
    const firstStorageHarness = createBetterSqliteDoStorageHarness({
      filename: dbPath,
    })
    const firstAdapter = createCloudflareDOSQLitePersistenceAdapter({
      driver: {
        sql: firstStorageHarness.sql,
      },
      mode: `sync`,
      schemaVersion: 1,
    })

    try {
      await firstAdapter.applyCommittedTx(collectionId, {
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
              title: `before reset`,
              score: 1,
            },
          },
        ],
      })
    } finally {
      firstStorageHarness.close()
    }

    const secondStorageHarness = createBetterSqliteDoStorageHarness({
      filename: dbPath,
    })
    const secondAdapter = createCloudflareDOSQLitePersistenceAdapter({
      driver: {
        sql: secondStorageHarness.sql,
      },
      mode: `sync`,
      schemaVersion: 2,
    })

    try {
      const rows = await secondAdapter.loadSubset(collectionId, {})
      expect(rows).toEqual([])
    } finally {
      secondStorageHarness.close()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })

  it(`initializes configured collections and throws for unknown collection IDs`, async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), `db-cf-do-init-`))
    const dbPath = join(tempDirectory, `state.sqlite`)
    const storageHarness = createBetterSqliteDoStorageHarness({
      filename: dbPath,
    })

    const registry = createCloudflareDOCollectionRegistry({
      sql: storageHarness.sql,
      collections: [
        {
          collectionId: `todos`,
          mode: `local`,
        },
      ],
    })

    try {
      await initializeCloudflareDOCollections(registry)
      await expect(
        initializeCloudflareDOCollections(registry, [`missing`]),
      ).rejects.toThrow(`Unknown Cloudflare DO collection`)
    } finally {
      storageHarness.close()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })

  it(`infers mode from sync presence when mode is omitted`, async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), `db-cf-do-schema-infer-`))
    const dbPath = join(tempDirectory, `state.sqlite`)
    const collectionId = `todos`
    const firstStorageHarness = createBetterSqliteDoStorageHarness({
      filename: dbPath,
    })
    const firstPersistence = createCloudflareDOSQLitePersistence<RuntimePersistenceContractTodo, string>(
      {
        driver: {
          sql: firstStorageHarness.sql,
        },
        schemaVersion: 1,
      },
    )

    try {
      await firstPersistence.adapter.applyCommittedTx(collectionId, {
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
              title: `before mismatch`,
              score: 1,
            },
          },
        ],
      })
    } finally {
      firstStorageHarness.close()
    }

    const secondStorageHarness = createBetterSqliteDoStorageHarness({
      filename: dbPath,
    })
    const secondPersistence = createCloudflareDOSQLitePersistence<RuntimePersistenceContractTodo, string>(
      {
        driver: {
          sql: secondStorageHarness.sql,
        },
        schemaVersion: 2,
      },
    )
    try {
      const syncAbsentPersistence =
        secondPersistence.resolvePersistenceForMode?.(`sync-absent`) ??
        secondPersistence
      await expect(
        syncAbsentPersistence.adapter.loadSubset(collectionId, {}),
      ).rejects.toThrow(`Schema version mismatch`)

      const syncPresentPersistence =
        secondPersistence.resolvePersistenceForMode?.(`sync-present`) ??
        secondPersistence
      const rows = await syncPresentPersistence.adapter.loadSubset(
        collectionId,
        {},
      )
      expect(rows).toEqual([])
    } finally {
      secondStorageHarness.close()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })
})
