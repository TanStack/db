import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  SQLiteCorePersistenceAdapter,
  createPersistedTableName,
  encodePersistedStorageKey,
} from '../src'
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
  observeQuery?: (sql: string) => void,
): SQLiteDriver {
  const driver: SQLiteDriver = {
    exec: (sql) => {
      database.exec(sql)
      return Promise.resolve()
    },
    query: (sql, params = []) => {
      observeQuery?.(sql)
      return Promise.resolve(
        database
          .prepare(sql)
          .all(...params.map(toBinding))
          .map((row) => ({ ...row })) as Array<never>,
      )
    },
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
 * # Which generation does a SQLite resume snapshot certify?
 *
 * `loadResumeSnapshot` must return rows, collection metadata, applied position,
 * reset epoch, and key-set evidence from one atomic persisted generation. Raw
 * key loss makes that evidence incompatible until a full replacement establishes
 * a new baseline; concurrent schema migration may advance but never downgrade or
 * repeat the observed generation. These laws refine the shared persistence and
 * schema-mismatch contracts exercised by sqlite-core-adapter.test.ts.
 *
 * `CachedSchemaState` is the independent projection: complete rows and metadata,
 * transaction position, schema/reset lineage, and expected keys. The history
 * grammar crosses external row loss, full replacement, two legacy-schema
 * adapters, stale reads, newer-schema observation, and a cached writer racing a
 * reset. Expected membership and lineage come from the declared transition, not
 * from the adapter's SQL or internal branch structure.
 *
 * The production driver runs two real `SQLiteCorePersistenceAdapter` instances
 * over one node:sqlite database and holds the exact transaction or snapshot
 * boundary needed for each interleaving. At the settled snapshot checkpoint it
 * compares the entire projected schema state; the held boundary and reset epoch
 * are reach witnesses, while compatible reopen and recertifying truncate cases
 * prevent an oracle that merely rejects every resume.
 * The focused work law first executes one controlled expected-key table read to
 * prove its SQL observer can detect the forbidden membership work, then resets
 * the counters before measuring the public position and snapshot operations.
 *
 * Known omissions: this narrow fixture supplies the same-connection
 * concurrency seam that the serialized copy-on-commit CLI harness cannot. It
 * does not claim native host execution or judge whether a consumer such as
 * Electric may use the certified cursor; those remain separate driver-contract
 * and Electric recovery owners.
 */
describe(`SQLite resume snapshots`, () => {
  it(`reads key-set evidence without rescanning key membership`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    try {
      const collectionId = `evidence-work`
      const tableName = createPersistedTableName(collectionId, `c`)
      let keyEvidenceReads = 0
      let keyMembershipScans = 0
      const driver = createDriver(database, undefined, (sql) => {
        if (sql.includes(`key_set_evidence_available`)) keyEvidenceReads += 1
        if (sql.includes(`collection_expected_keys`)) {
          keyMembershipScans += 1
        }
      })
      const adapter = new SQLiteCorePersistenceAdapter({ driver })
      await adapter.applyCommittedTx(collectionId, {
        txId: `seed`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: 1, value: { id: 1, name: `one` } }],
      })

      const observeWork = () => ({ keyEvidenceReads, keyMembershipScans })
      const resetWork = () => {
        keyEvidenceReads = 0
        keyMembershipScans = 0
      }

      await driver.query(
        `SELECT key FROM collection_expected_keys
         WHERE collection_id = ?
         LIMIT 0`,
        [collectionId],
      )
      expect(observeWork().keyMembershipScans).toBe(1)

      resetWork()
      const position = await adapter.getStreamPosition(collectionId)
      const leadershipClaim = observeWork()

      resetWork()
      const consistent = await adapter.loadResumeSnapshot(collectionId, {
        includeRows: false,
      })
      const consistentSnapshot = observeWork()

      await driver.run(`DELETE FROM "${tableName}"`)
      resetWork()
      const incompatible = await adapter.loadResumeSnapshot(collectionId, {
        includeRows: false,
      })
      const incompatibleSnapshot = observeWork()

      expect({
        position,
        leadershipClaim,
        consistentKeySet: consistent.keySet,
        consistentSnapshot,
        incompatibleKeySet: incompatible.keySet,
        incompatibleSnapshot,
      }).toEqual({
        position: {
          latestTerm: 1,
          latestSeq: 1,
          latestRowVersion: 1,
        },
        leadershipClaim: {
          keyEvidenceReads: 0,
          keyMembershipScans: 0,
        },
        consistentKeySet: { status: `consistent` },
        consistentSnapshot: {
          keyEvidenceReads: 1,
          keyMembershipScans: 0,
        },
        incompatibleKeySet: { status: `incompatible` },
        incompatibleSnapshot: {
          keyEvidenceReads: 1,
          keyMembershipScans: 0,
        },
      })
    } catch (error) {
      primaryFailure = error
    } finally {
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  it(`does not amplify legacy writes while key-set evidence is unavailable`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    try {
      const collectionId = `legacy-write-'work`
      const tableName = createPersistedTableName(collectionId, `c`)
      const driver = createDriver(database)
      const adapter = new SQLiteCorePersistenceAdapter({ driver })

      await adapter.loadResumeSnapshot(collectionId, { includeRows: false })
      await driver.run(
        `UPDATE collection_version
         SET key_set_evidence_available = 0,
             key_set_evidence_incompatible = 0
         WHERE collection_id = ?`,
        [collectionId],
      )
      const before = await driver.query<{ count: number }>(
        `SELECT total_changes() AS count`,
      )

      await driver.run(
        `INSERT INTO "${tableName}" (key, value, metadata, row_version)
         VALUES (?, ?, NULL, 1)`,
        [encodePersistedStorageKey(`legacy`), `{}`],
      )

      const after = await driver.query<{ count: number }>(
        `SELECT total_changes() AS count`,
      )
      const version = await driver.query<{
        key_set_evidence_incompatible: number
      }>(
        `SELECT key_set_evidence_incompatible
         FROM collection_version
         WHERE collection_id = ?`,
        [collectionId],
      )
      expect((after[0]?.count ?? 0) - (before[0]?.count ?? 0)).toBe(1)
      expect(version).toEqual([{ key_set_evidence_incompatible: 0 }])

      const beforeKeyUpdate = await driver.query<{ count: number }>(
        `SELECT total_changes() AS count`,
      )
      await driver.run(`UPDATE "${tableName}" SET key = ? WHERE key = ?`, [
        encodePersistedStorageKey(`legacy-renamed`),
        encodePersistedStorageKey(`legacy`),
      ])
      const afterKeyUpdate = await driver.query<{ count: number }>(
        `SELECT total_changes() AS count`,
      )
      expect(
        (afterKeyUpdate[0]?.count ?? 0) - (beforeKeyUpdate[0]?.count ?? 0),
      ).toBe(1)

      const triggerDefinitions = await driver.query<{ sql: string }>(
        `SELECT sql
         FROM sqlite_schema
         WHERE type = 'trigger' AND tbl_name = ?`,
        [tableName],
      )
      expect(triggerDefinitions).toHaveLength(3)
      expect(triggerDefinitions.map(({ sql }) => sql).join(`\n`)).not.toContain(
        `collection_registry`,
      )
      expect(
        (await adapter.loadResumeSnapshot(collectionId, { includeRows: false }))
          .keySet,
      ).toEqual({ status: `unknown` })
    } catch (error) {
      primaryFailure = error
    } finally {
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

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
      await driver.run(
        `INSERT INTO "${tableName}" (key, value, metadata, row_version)
         VALUES (?, ?, ?, 0)`,
        [
          encodePersistedStorageKey(`legacy-row`),
          JSON.stringify({ id: `legacy-row`, n: 0 }),
          JSON.stringify({ source: `legacy` }),
        ],
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

      const migratedLegacySnapshot =
        await migrated.loadResumeSnapshot(collectionId)
      expect(migratedLegacySnapshot.keySet).toEqual({ status: `unknown` })
      expect(migratedLegacySnapshot.rows).toEqual([
        {
          key: `legacy-row`,
          value: { id: `legacy-row`, n: 0 },
          metadata: { source: `legacy` },
        },
      ])
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
