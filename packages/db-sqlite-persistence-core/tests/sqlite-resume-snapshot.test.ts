import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { SQLiteCorePersistenceAdapter, createPersistedTableName } from '../src'
import type { SQLiteDriver } from '../src'

type CachedSchemaState = {
  schemaVersion: number
  resetEpoch: number
  rows: Array<{ key: string | number; value: Record<string, unknown> }>
  metadata: Array<{ key: string; value: unknown }>
  appliedTransactions: Array<{
    term: number
    seq: number
    txId: string
    rowVersion: number
  }>
  keyEvidence: {
    available: number
    incompatible: number
    expectedKeys: Array<string>
  }
}

function toBinding(value: unknown): string | number | bigint | null {
  if (value === null || value === undefined) return null
  if (typeof value === `boolean`) return value ? 1 : 0
  if (
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `bigint`
  ) {
    return value
  }
  return String(value)
}

function createDriver(
  database: DatabaseSync,
  failTransactionRun?: (sql: string) => boolean,
): SQLiteDriver {
  const driver: SQLiteDriver = {
    exec: (sql) => {
      database.exec(sql)
      return Promise.resolve()
    },
    query: (sql, params = []) =>
      Promise.resolve(
        database
          .prepare(sql)
          .all(...params.map(toBinding))
          .map((row) => ({ ...row })) as Array<never>,
      ),
    run: (sql, params = []) => {
      database.prepare(sql).run(...params.map(toBinding))
      return Promise.resolve()
    },
    transaction: async (transaction) => {
      database.exec(`BEGIN IMMEDIATE`)
      try {
        const transactionDriver: SQLiteDriver = {
          ...driver,
          run: (sql, params) =>
            failTransactionRun?.(sql)
              ? Promise.reject(new Error(`injected transaction failure`))
              : driver.run(sql, params),
        }
        const result = await transaction(transactionDriver)
        database.exec(`COMMIT`)
        return result
      } catch (error) {
        database.exec(`ROLLBACK`)
        throw error
      }
    },
  }
  return driver
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

async function reachCheckpoint(
  promise: Promise<void>,
  checkpoint: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Did not reach checkpoint: ${checkpoint}`)),
          1_000,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function closeDatabasePreservingPrimary(
  database: DatabaseSync,
  primaryFailure: unknown,
): never | void {
  let cleanupFailure: unknown
  try {
    database.close()
  } catch (error) {
    cleanupFailure = error
  }

  if (primaryFailure !== undefined) {
    const failure =
      primaryFailure instanceof Error
        ? primaryFailure
        : new Error(`SQLite resume snapshot failed`, { cause: primaryFailure })
    if (cleanupFailure !== undefined) {
      Object.defineProperty(failure, `cleanupFailures`, {
        value: [cleanupFailure],
        enumerable: true,
      })
    }
    throw failure
  }
  if (cleanupFailure !== undefined) throw cleanupFailure
}

async function observeCachedSchemaState(
  adapter: SQLiteCorePersistenceAdapter,
  driver: SQLiteDriver,
  collectionId: string,
): Promise<CachedSchemaState> {
  const snapshot = await adapter.loadResumeSnapshot(collectionId)
  const registryRows = await driver.query<{ schema_version: number }>(
    `SELECT schema_version FROM collection_registry WHERE collection_id = ?`,
    [collectionId],
  )
  const versionRows = await driver.query<{
    key_set_evidence_available: number
    key_set_evidence_incompatible: number
  }>(
    `SELECT key_set_evidence_available, key_set_evidence_incompatible
     FROM collection_version
     WHERE collection_id = ?`,
    [collectionId],
  )
  const expectedKeys = await driver.query<{ key: string }>(
    `SELECT key
     FROM collection_expected_keys
     WHERE collection_id = ?
     ORDER BY key`,
    [collectionId],
  )
  const appliedTransactions = await driver.query<{
    term: number
    seq: number
    tx_id: string
    row_version: number
  }>(
    `SELECT term, seq, tx_id, row_version
     FROM applied_tx
     WHERE collection_id = ?
     ORDER BY term, seq`,
    [collectionId],
  )

  return {
    schemaVersion: registryRows[0]?.schema_version ?? -1,
    resetEpoch: snapshot.resetEpoch,
    rows: snapshot.rows
      .map(({ key, value }) => ({ key, value }))
      .sort((left, right) => String(left.key).localeCompare(String(right.key))),
    metadata: snapshot.collectionMetadata.sort((left, right) =>
      left.key.localeCompare(right.key),
    ),
    appliedTransactions: appliedTransactions.map(
      ({ term, seq, tx_id, row_version }) => ({
        term,
        seq,
        txId: tx_id,
        rowVersion: row_version,
      }),
    ),
    keyEvidence: {
      available: versionRows[0]?.key_set_evidence_available ?? -1,
      incompatible: versionRows[0]?.key_set_evidence_incompatible ?? -1,
      expectedKeys: expectedKeys.map(({ key }) => key),
    },
  }
}

/**
 * Narrow companion to sqlite-core-adapter.test.ts for atomic snapshot and DDL
 * interleavings. That owner deliberately drives sqlite3 through a serialized
 * copy-on-commit CLI harness, which cannot expose two adapters to the same
 * in-flight connection state. This file uses node:sqlite only for that missing
 * deterministic seam; expected key membership and reset lineage remain
 * independent assertions, not a second production-shaped model.
 */
describe(`SQLite resume snapshots`, () => {
  it(`keeps raw key loss sticky until a full replacement recertifies the baseline`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    try {
      const collectionId = `resume-ledger`
      const tableName = createPersistedTableName(collectionId, `c`)
      let rejectCollectionInsert = false
      const driver = createDriver(
        database,
        (sql) =>
          rejectCollectionInsert && sql.includes(`INSERT INTO "${tableName}"`),
      )
      const adapter = new SQLiteCorePersistenceAdapter({ driver })
      await adapter.applyCommittedTx(collectionId, {
        txId: `seed`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          { type: `insert`, key: 1, value: { id: 1, name: `one` } },
          { type: `insert`, key: 2, value: { id: 2, name: `two` } },
        ],
        collectionMetadataMutations: [
          { type: `set`, key: `cursor`, value: `10_0` },
        ],
      })

      const initial = await adapter.loadResumeSnapshot(collectionId)
      expect(initial.keySet).toEqual({ status: `consistent` })
      expect(initial.rows.map(({ key }) => key)).toEqual([1, 2])
      expect(initial.collectionMetadata).toEqual([
        { key: `cursor`, value: `10_0` },
      ])

      await adapter.applyCommittedTx(collectionId, {
        txId: `normal-update`,
        term: 1,
        seq: 2,
        rowVersion: 2,
        mutations: [
          { type: `update`, key: 1, value: { id: 1, name: `updated-one` } },
        ],
      })
      const updated = await adapter.loadResumeSnapshot(collectionId)
      expect(updated.rows.find(({ key }) => key === 1)?.value).toEqual({
        id: 1,
        name: `updated-one`,
      })
      expect(updated.keySet).toEqual({ status: `consistent` })

      await adapter.applyCommittedTx(collectionId, {
        txId: `normal-delete`,
        term: 1,
        seq: 3,
        rowVersion: 3,
        mutations: [{ type: `delete`, key: 2, value: { id: 2, name: `two` } }],
      })
      await adapter.applyCommittedTx(collectionId, {
        txId: `normal-delete`,
        term: 1,
        seq: 3,
        rowVersion: 3,
        mutations: [{ type: `delete`, key: 2, value: { id: 2, name: `two` } }],
      })
      const deleted = await adapter.loadResumeSnapshot(collectionId)
      expect(deleted.rows.map(({ key }) => key)).toEqual([1])
      expect(deleted.keySet).toEqual({ status: `consistent` })

      rejectCollectionInsert = true
      await expect(
        adapter.applyCommittedTx(collectionId, {
          txId: `rolled-back-insert`,
          term: 1,
          seq: 4,
          rowVersion: 4,
          mutations: [{ type: `insert`, key: 3, value: { id: 3 } }],
        }),
      ).rejects.toThrow(`injected transaction failure`)
      rejectCollectionInsert = false
      const rolledBack = await adapter.loadResumeSnapshot(collectionId)
      expect(rolledBack.rows.map(({ key }) => key)).toEqual([1])
      expect(rolledBack.keySet).toEqual({ status: `consistent` })
      expect(
        await driver.query<{ count: number }>(
          `SELECT COUNT(*) AS count FROM collection_expected_keys WHERE collection_id = ?`,
          [collectionId],
        ),
      ).toEqual([{ count: 1 }])
      expect(
        await driver.query<{ count: number }>(
          `SELECT COUNT(*) AS count FROM applied_tx WHERE collection_id = ? AND tx_id = ?`,
          [collectionId, `normal-delete`],
        ),
      ).toEqual([{ count: 1 }])

      await adapter.applyCommittedTx(collectionId, {
        txId: `restore-second-row`,
        term: 1,
        seq: 5,
        rowVersion: 5,
        mutations: [{ type: `insert`, key: 2, value: { id: 2, name: `two` } }],
      })

      await driver.run(`DELETE FROM "${tableName}" WHERE key = ?`, [
        database
          .prepare(`SELECT key FROM "${tableName}" ORDER BY key LIMIT 1`)
          .get()!.key,
      ])
      await adapter.applyCommittedTx(collectionId, {
        txId: `metadata-after-loss`,
        term: 1,
        seq: 6,
        rowVersion: 6,
        mutations: [],
        collectionMetadataMutations: [
          { type: `set`, key: `cursor`, value: `11_0` },
        ],
      })
      expect((await adapter.loadResumeSnapshot(collectionId)).keySet).toEqual({
        status: `incompatible`,
      })

      await adapter.applyCommittedTx(collectionId, {
        txId: `full-replacement`,
        term: 1,
        seq: 7,
        rowVersion: 7,
        truncate: true,
        mutations: [
          { type: `insert`, key: 1, value: { id: 1, name: `one` } },
          { type: `insert`, key: 2, value: { id: 2, name: `two` } },
        ],
      })
      expect((await adapter.loadResumeSnapshot(collectionId)).keySet).toEqual({
        status: `consistent`,
      })

      await driver.run(
        `UPDATE "${tableName}" SET key = key || '-replacement' WHERE rowid = (SELECT MIN(rowid) FROM "${tableName}")`,
      )
      const substituted = await adapter.loadResumeSnapshot(collectionId)
      expect(substituted.rows).toHaveLength(2)
      expect(substituted.keySet).toEqual({ status: `incompatible` })
    } catch (error) {
      primaryFailure = error
    } finally {
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  it(`migrates concurrent legacy schemas and stays unknown until truncate`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let releasePending = () => {}
    let primaryFailure: unknown
    try {
      const driver = createDriver(database)
      const collectionId = `legacy-ledger`
      const tableName = createPersistedTableName(collectionId, `c`)
      const tombstoneTableName = createPersistedTableName(collectionId, `t`)
      await driver.exec(
        `CREATE TABLE collection_registry (
           collection_id TEXT PRIMARY KEY,
           table_name TEXT NOT NULL UNIQUE,
           tombstone_table_name TEXT NOT NULL UNIQUE,
           schema_version INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         )`,
      )
      await driver.run(
        `INSERT INTO collection_registry
           (collection_id, table_name, tombstone_table_name, schema_version, updated_at)
         VALUES (?, ?, ?, 1, 0)`,
        [collectionId, tableName, tombstoneTableName],
      )
      await driver.exec(
        `CREATE TABLE "${tableName}" (
           key TEXT PRIMARY KEY,
           value TEXT NOT NULL,
           metadata TEXT,
           row_version INTEGER NOT NULL
         )`,
      )
      await driver.exec(
        `CREATE TABLE "${tombstoneTableName}" (
           key TEXT PRIMARY KEY,
           value TEXT,
           row_version INTEGER NOT NULL,
           deleted_at TEXT NOT NULL
         )`,
      )
      await driver.exec(
        `CREATE TABLE collection_version (
           collection_id TEXT PRIMARY KEY,
           latest_row_version INTEGER NOT NULL
         )`,
      )
      await driver.run(
        `INSERT INTO collection_version (collection_id, latest_row_version)
         VALUES (?, 0)`,
        [collectionId],
      )

      const bothSawLegacyColumns = deferred()
      let legacyColumnReaders = 0
      const migrationRelease = deferred()
      releasePending = migrationRelease.resolve
      const createMigrationDriver = (): SQLiteDriver => ({
        ...driver,
        query: async <T>(sql: string, params?: ReadonlyArray<unknown>) => {
          const rows = await driver.query<T>(sql, params)
          if (sql.includes(`PRAGMA table_info(collection_version)`)) {
            legacyColumnReaders++
            if (legacyColumnReaders === 2) bothSawLegacyColumns.resolve()
            await migrationRelease.promise
          }
          return rows
        },
      })
      const migrated = new SQLiteCorePersistenceAdapter({
        driver: createMigrationDriver(),
      })
      const concurrentMigrated = new SQLiteCorePersistenceAdapter({
        driver: createMigrationDriver(),
      })
      const initialize = (adapter: SQLiteCorePersistenceAdapter) =>
        (
          adapter as unknown as { ensureInitialized: () => Promise<void> }
        ).ensureInitialized()
      const migrations = Promise.all([
        initialize(migrated),
        initialize(concurrentMigrated),
      ])
      await reachCheckpoint(
        bothSawLegacyColumns.promise,
        `both adapters observed the legacy collection_version schema`,
      )
      migrationRelease.resolve()
      await migrations
      const migratedColumns = await driver.query<{ name: string }>(
        `PRAGMA table_info(collection_version)`,
      )
      expect(migratedColumns.map(({ name }) => name)).toEqual(
        expect.arrayContaining([
          `key_set_evidence_available`,
          `key_set_evidence_incompatible`,
        ]),
      )

      expect((await migrated.loadResumeSnapshot(collectionId)).keySet).toEqual({
        status: `unknown`,
      })
      await migrated.applyCommittedTx(collectionId, {
        txId: `legacy-insert`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: 1, value: { id: 1, n: 1 } }],
      })
      expect((await migrated.loadResumeSnapshot(collectionId)).keySet).toEqual({
        status: `unknown`,
      })

      await migrated.applyCommittedTx(collectionId, {
        txId: `legacy-replacement`,
        term: 1,
        seq: 2,
        rowVersion: 2,
        truncate: true,
        mutations: [{ type: `insert`, key: 1, value: { id: 1, n: 2 } }],
      })
      expect((await migrated.loadResumeSnapshot(collectionId)).keySet).toEqual({
        status: `consistent`,
      })
    } catch (error) {
      primaryFailure = error
    } finally {
      releasePending()
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  it(`does not repeat a schema reset observed through a stale adapter read`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let releasePending = () => {}
    let primaryFailure: unknown
    try {
      const driver = createDriver(database)
      const collectionId = `concurrent-schema-reset`
      const original = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 1,
      })
      await original.applyCommittedTx(collectionId, {
        txId: `seed`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: 1, value: { id: 1 } }],
        collectionMetadataMutations: [
          { type: `set`, key: `cursor`, value: `old` },
        ],
      })

      const staleRead = deferred()
      const releaseStaleRead = deferred()
      releasePending = releaseStaleRead.resolve
      let intercepted = false
      const gatedDriver: SQLiteDriver = {
        ...driver,
        query: async <T>(sql: string, params?: ReadonlyArray<unknown>) => {
          const rows = await driver.query<T>(sql, params)
          if (!intercepted && sql.includes(`FROM collection_registry`)) {
            intercepted = true
            staleRead.resolve()
            await releaseStaleRead.promise
          }
          return rows
        },
      }
      const staleAdapter = new SQLiteCorePersistenceAdapter({
        driver: gatedDriver,
        schemaVersion: 2,
      })
      const staleLoad = staleAdapter.loadSubset(collectionId, {})
      await reachCheckpoint(
        staleRead.promise,
        `stale schema-v1 registry read before competing reset`,
      )

      const winner = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 2,
      })
      await winner.loadSubset(collectionId, {})
      await winner.applyCommittedTx(collectionId, {
        txId: `recovery-write`,
        term: 2,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: 2, value: { id: 2 } }],
        collectionMetadataMutations: [
          { type: `set`, key: `cursor`, value: `new` },
        ],
      })

      releaseStaleRead.resolve()
      await staleLoad
      const snapshot = await winner.loadResumeSnapshot(collectionId)
      expect(snapshot.resetEpoch).toBe(1)
      expect(snapshot.rows.map(({ key }) => key)).toEqual([2])
      expect(snapshot.collectionMetadata).toEqual([
        { key: `cursor`, value: `new` },
      ])
    } catch (error) {
      primaryFailure = error
    } finally {
      releasePending()
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  it(`refuses to downgrade a newer schema observed after a stale read`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let releasePending = () => {}
    let primaryFailure: unknown
    try {
      const driver = createDriver(database)
      const collectionId = `divergent-schema-reset`
      const original = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 1,
      })
      await original.applyCommittedTx(collectionId, {
        txId: `seed`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: 1, value: { id: 1 } }],
      })

      const staleRead = deferred()
      const releaseStaleRead = deferred()
      releasePending = releaseStaleRead.resolve
      let intercepted = false
      const staleDriver: SQLiteDriver = {
        ...driver,
        query: async <T>(sql: string, params?: ReadonlyArray<unknown>) => {
          const rows = await driver.query<T>(sql, params)
          if (!intercepted && sql.includes(`FROM collection_registry`)) {
            intercepted = true
            staleRead.resolve()
            await releaseStaleRead.promise
          }
          return rows
        },
      }
      const staleV2 = new SQLiteCorePersistenceAdapter({
        driver: staleDriver,
        schemaVersion: 2,
      })
      const staleLoad = staleV2.loadSubset(collectionId, {})
      await reachCheckpoint(
        staleRead.promise,
        `stale schema-v1 registry read before schema-v3 reset`,
      )

      const winnerV3 = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 3,
      })
      await winnerV3.loadSubset(collectionId, {})
      await winnerV3.applyCommittedTx(collectionId, {
        txId: `winner-write`,
        term: 3,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: 3, value: { id: 3 } }],
        collectionMetadataMutations: [
          { type: `set`, key: `cursor`, value: `v3` },
        ],
      })

      releaseStaleRead.resolve()
      await expect(staleLoad).rejects.toThrow(
        `Schema version changed concurrently`,
      )
      const snapshot = await winnerV3.loadResumeSnapshot(collectionId)
      expect(snapshot.resetEpoch).toBe(1)
      expect(snapshot.rows.map(({ key }) => key)).toEqual([3])
      expect(snapshot.collectionMetadata).toEqual([
        { key: `cursor`, value: `v3` },
      ])
      expect(
        await driver.query<{ schema_version: number }>(
          `SELECT schema_version FROM collection_registry WHERE collection_id = ?`,
          [collectionId],
        ),
      ).toEqual([{ schema_version: 3 }])
    } catch (error) {
      primaryFailure = error
    } finally {
      releasePending()
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  it(`rejects a committed transaction from a cached adapter after another adapter resets the schema`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    try {
      const driver = createDriver(database)
      const collectionId = `cached-schema-write`
      const staleV1 = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 1,
      })
      await staleV1.applyCommittedTx(collectionId, {
        txId: `seed-v1`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: 1, value: { id: 1 } }],
        collectionMetadataMutations: [
          { type: `set`, key: `cursor`, value: `v1` },
        ],
      })

      const currentV2 = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 2,
      })
      await currentV2.loadSubset(collectionId, {})
      await currentV2.applyCommittedTx(collectionId, {
        txId: `seed-v2`,
        term: 2,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: 2, value: { id: 2 } }],
        collectionMetadataMutations: [
          { type: `set`, key: `cursor`, value: `v2` },
        ],
      })
      const before = await observeCachedSchemaState(
        currentV2,
        driver,
        collectionId,
      )

      let lateWriteError: unknown
      try {
        await staleV1.applyCommittedTx(collectionId, {
          txId: `late-v1`,
          term: 3,
          seq: 1,
          rowVersion: 2,
          truncate: true,
          mutations: [{ type: `insert`, key: 3, value: { id: 3 } }],
          collectionMetadataMutations: [
            { type: `set`, key: `cursor`, value: `late-v1` },
            { type: `set`, key: `late`, value: true },
          ],
        })
      } catch (error) {
        lateWriteError = error
      }
      const after = await observeCachedSchemaState(
        currentV2,
        driver,
        collectionId,
      )

      expect(
        {
          error:
            lateWriteError instanceof Error
              ? { name: lateWriteError.name, message: lateWriteError.message }
              : lateWriteError,
          before,
          after,
        },
        `a cached adapter must reject at its transaction boundary without changing any durable state`,
      ).toEqual({
        error: {
          name: `InvalidPersistedCollectionConfigError`,
          message:
            `Schema version mismatch for collection "cached-schema-write": ` +
            `found 2, expected 1. Refusing to apply a committed transaction through a stale cached adapter.`,
        },
        before,
        after: before,
      })
    } catch (error) {
      primaryFailure = error
    } finally {
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })
})
