import { DatabaseSync } from 'node:sqlite'
import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { BasicIndex, createCollection, whenSyncAccepted } from '@tanstack/db'
import { oraclePropertyOptions, oracleRuns } from '../../db/tests/oracle-config'
import {
  SQLiteCorePersistenceAdapter,
  createPersistedTableName,
  encodePersistedStorageKey,
  persistedCollectionOptions,
} from '../src'
import { runOrdinaryTransactionWorkOracle } from './ordinary-transaction-work-oracle'
import type { SQLiteDriver } from '../src'
import type { Collection, SyncConfig } from '@tanstack/db'

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

/** In-memory SQLite driver with optional statement observation and write failure. */
function createDriver(
  database: DatabaseSync,
  failTransactionRun?: (sql: string) => boolean,
  observeQuery?: (sql: string) => void,
  observeRun?: (sql: string, params: ReadonlyArray<unknown>) => void,
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
      observeRun?.(sql, params)
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
 * schema-mismatch contracts exercised by sqlite-core-adapter-oracle.test.ts.
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
 * A separate generated startup lane holds the runtime between its metadata and
 * hydration snapshots, then crosses no write, a managed public insert, and a
 * hostile raw deletion over one-to-three baseline rows. Its independent model
 * preserves every managed row but fails closed for unsupported raw loss.
 * The focused work law first executes one controlled expected-key table read to
 * prove its SQL observer can detect the forbidden membership work, then resets
 * the counters before measuring the public position and snapshot operations.
 * A second value-and-work law applies a 205-row full replacement through
 * `applyCommittedTx`. It compares exact durable rows, row metadata, key evidence,
 * resume metadata, and applied position after return while bounding driver
 * query/run calls. A later-batch fault must roll the whole replacement back.
 * Duplicate-key and delete histories retain their ordered sequential meaning.
 *
 * Known omissions: this narrow fixture supplies the same-connection
 * concurrency seam that the serialized copy-on-commit CLI harness cannot. It
 * does not claim native host execution or judge whether a consumer such as
 * Electric may use the certified cursor; those remain separate driver-contract
 * and Electric recovery owners. The work bound is a driver-call measure in
 * node:sqlite, not an elapsed-time or browser OPFS latency guarantee.
 */
describe(`SQLite resume snapshots`, () => {
  // A physical cache ID is a catalog entry, not a string prefix. Public
  // Collection IDs are arbitrary nonempty strings, including one that starts
  // with the internal physical-ID prefix. An eager Collection never claims a
  // managed generation; its ordinary durable row must still be readable.
  it.each([
    {
      label: `CLI-safe prefix`,
      collectionId: `tanstack-db-cache:user-eager-collection`,
    },
    {
      label: `older NUL prefix`,
      collectionId: `\u0000tanstack-db-cache:user-eager-collection`,
    },
  ])(
    `keeps an eager Collection ID with the $label usable`,
    async ({ collectionId }) => {
      const database = new DatabaseSync(`:memory:`)
      let primaryFailure: unknown
      try {
        const adapter = new SQLiteCorePersistenceAdapter({
          driver: createDriver(database),
        })
        const row = { id: `row`, title: `Eager row` }
        await adapter.applyCommittedTx(collectionId, {
          txId: `eager-source`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [{ type: `insert`, key: row.id, value: row }],
        })
        expect(
          (await adapter.loadResumeSnapshot(collectionId)).rows.map(
            ({ value }) => value,
          ),
        ).toEqual([row])
        const collection = createCollection(
          persistedCollectionOptions<typeof row, string>({
            id: collectionId,
            syncMode: `eager`,
            getKey: (value) => value.id,
            persistence: { adapter },
          }),
        )
        try {
          await collection.preload()
          expect(collection.get(row.id)).toMatchObject(row)
        } finally {
          await collection.cleanup()
        }
      } catch (error) {
        primaryFailure = error
        throw error
      } finally {
        closeDatabasePreservingPrimary(database, primaryFailure)
      }
    },
  )

  // A persisted cache generation has one distinct storage ID. Advancing the
  // current generation preserves an existing run's source-backed storage while a recovering run
  // starts with empty, uncertified storage. The model has disjoint row maps
  // and one head pointer. A stale claim can branch privately without moving
  // that pointer; only the run claiming the head may advance it.
  // This driver checks both snapshots after the atomic rotation and rejects a
  // late write admitted under the claim that moved away from the old map.
  it(`rotates an on-demand cache into empty uncertified storage`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    try {
      const adapter = new SQLiteCorePersistenceAdapter({
        driver: createDriver(database),
      })
      const collectionId = `on-demand-cache-generation`
      const oldRow = { id: `old`, title: `Old source row` }
      await adapter.applyCommittedTx(collectionId, {
        txId: `seed`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: oldRow.id, value: oldRow }],
      })

      const claim = await adapter.claimCacheGeneration(collectionId)
      expect(claim.storageCollectionId).not.toBe(collectionId)
      const warmClaim = await adapter.claimCacheGeneration(collectionId)
      expect(warmClaim.storageCollectionId).toBe(claim.storageCollectionId)
      const readClaimed = (storageId: string, claimId: string) =>
        adapter.loadResumeSnapshot(storageId, {
          cacheGenerationClaimId: claimId,
        })
      expect(
        (await readClaimed(claim.storageCollectionId, claim.claimId)).rows,
      ).toEqual([])
      const resetMarker = { kind: `reset`, updatedAt: 1 }
      const rotated = await adapter.rotateCacheGeneration(
        collectionId,
        claim.claimId,
        { key: `electric:resume`, value: resetMarker },
      )
      expect(rotated.storageCollectionId).not.toBe(claim.storageCollectionId)

      const oldSnapshot = await adapter.loadResumeSnapshot(collectionId)
      const initialSnapshot = await readClaimed(
        claim.storageCollectionId,
        warmClaim.claimId,
      )
      const newSnapshot = await readClaimed(
        rotated.storageCollectionId,
        rotated.claimId,
      )
      const nextClaim = await adapter.claimCacheGeneration(collectionId)
      expect(oldSnapshot.rows.map(({ value }) => value)).toEqual([oldRow])
      expect(initialSnapshot.rows).toEqual([])
      expect(newSnapshot.rows).toEqual([])
      expect(newSnapshot.keySet).toEqual({ status: `incompatible` })
      expect(newSnapshot.collectionMetadata).toEqual([
        { key: `electric:resume`, value: resetMarker },
      ])
      await expect(
        adapter.loadResumeSnapshot(rotated.storageCollectionId),
      ).rejects.toThrow(`Persisted cache claim is required`)
      await expect(
        adapter.applyCommittedTx(rotated.storageCollectionId, {
          txId: `unclaimed-write`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            { type: `insert`, key: `unclaimed`, value: { id: `unclaimed` } },
          ],
        }),
      ).rejects.toThrow(`Persisted cache claim is required`)
      expect(nextClaim.storageCollectionId).toBe(rotated.storageCollectionId)

      // An existing run keeps its old generation. Its source-backed writes
      // remain separate from the recovering run's new uncertified cache.
      await adapter.applyCommittedTx(warmClaim.storageCollectionId, {
        txId: `warm-source-write`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: warmClaim.claimId,
        mutations: [
          {
            type: `insert`,
            key: `warm`,
            value: { id: `warm`, title: `Still source backed` },
          },
        ],
      })
      expect(
        (await readClaimed(rotated.storageCollectionId, rotated.claimId)).rows,
      ).toEqual([])

      // A writer from the previous library version knows only the public
      // Collection ID. It may still change that legacy cache, but it cannot
      // change either new-format generation or add rows to the current one.
      await adapter.applyCommittedTx(collectionId, {
        txId: `legacy-late-write`,
        term: 1,
        seq: 2,
        rowVersion: 2,
        mutations: [
          {
            type: `insert`,
            key: `legacy-late`,
            value: { id: `legacy-late`, title: `Legacy writer` },
          },
        ],
      })
      expect(
        (await readClaimed(rotated.storageCollectionId, rotated.claimId)).rows,
      ).toEqual([])
      await expect(
        adapter.applyCommittedTx(rotated.storageCollectionId, {
          txId: `unclaimed-new-write`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `unclaimed`,
              value: { id: `unclaimed`, title: `No claim` },
            },
          ],
        }),
      ).rejects.toThrow(`Persisted cache claim is required`)
      const freshRow = { id: `fresh`, title: `Demanded source row` }
      await adapter.applyCommittedTx(rotated.storageCollectionId, {
        txId: `fresh-subset-write`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: claim.claimId,
        mutations: [{ type: `insert`, key: freshRow.id, value: freshRow }],
      })
      const partialSnapshot = await readClaimed(
        rotated.storageCollectionId,
        rotated.claimId,
      )
      expect(partialSnapshot.rows.map(({ value }) => value)).toEqual([freshRow])
      expect(partialSnapshot.keySet).toEqual({ status: `incompatible` })

      await expect(
        adapter.applyCommittedTx(claim.storageCollectionId, {
          txId: `late-old-write`,
          term: 1,
          seq: 2,
          rowVersion: 2,
          cacheGenerationClaimId: claim.claimId,
          mutations: [
            {
              type: `insert`,
              key: `late`,
              value: { id: `late`, title: `Must stay outside new generation` },
            },
          ],
        }),
      ).rejects.toThrow(`Persisted cache claim`)

      // A complete replacement can certify the new head for later runs.
      // A warm run still claiming the old generation may itself lose source
      // authority, but that loss says nothing about the certified head. Its
      // replacement must stay private to that run instead of retiring the
      // other run's valid cache.
      await adapter.applyCommittedTx(rotated.storageCollectionId, {
        txId: `certify-new-head`,
        term: 1,
        seq: 2,
        rowVersion: 2,
        cacheGenerationClaimId: claim.claimId,
        truncate: true,
        mutations: [{ type: `insert`, key: freshRow.id, value: freshRow }],
      })
      expect(
        (await readClaimed(rotated.storageCollectionId, rotated.claimId))
          .keySet,
      ).toEqual({ status: `consistent` })
      const secondRecovery = await adapter.rotateCacheGeneration(
        collectionId,
        warmClaim.claimId,
        { key: `electric:resume`, value: { kind: `reset`, updatedAt: 2 } },
      )
      expect(secondRecovery.storageCollectionId).not.toBe(
        rotated.storageCollectionId,
      )
      expect(
        (
          await readClaimed(rotated.storageCollectionId, rotated.claimId)
        ).rows.map(({ value }) => value),
      ).toEqual([freshRow])
      expect(
        (
          await readClaimed(
            secondRecovery.storageCollectionId,
            secondRecovery.claimId,
          )
        ).rows,
      ).toEqual([])
      const latestClaim = await adapter.claimCacheGeneration(collectionId)
      expect(latestClaim.storageCollectionId).toBe(rotated.storageCollectionId)
      await adapter.applyCommittedTx(secondRecovery.storageCollectionId, {
        txId: `private-source-write`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: warmClaim.claimId,
        mutations: [
          {
            type: `insert`,
            key: `private`,
            value: { id: `private`, title: `Private source row` },
          },
        ],
      })
      expect(
        (
          await readClaimed(rotated.storageCollectionId, latestClaim.claimId)
        ).rows.map(({ value }) => value),
      ).toEqual([freshRow])

      // A later rotation by the actual head owner allocates past the private
      // branch, then becomes the head seen by future runs.
      const thirdRecovery = await adapter.rotateCacheGeneration(
        collectionId,
        claim.claimId,
        { key: `electric:resume`, value: { kind: `reset`, updatedAt: 3 } },
      )
      expect(thirdRecovery.storageCollectionId).not.toBe(
        secondRecovery.storageCollectionId,
      )
      const finalClaim = await adapter.claimCacheGeneration(collectionId)
      expect(finalClaim.storageCollectionId).toBe(
        thirdRecovery.storageCollectionId,
      )
      expect(
        database
          .prepare(
            `SELECT generation, retired FROM cache_generation
             WHERE logical_id = ? ORDER BY generation`,
          )
          .all(collectionId),
      ).toMatchObject([
        // The old generation was collected when its final claim rotated.
        { generation: 1, retired: 1 },
        { generation: 2, retired: 1 },
        { generation: 3, retired: 0 },
      ])
      await adapter.releaseCacheGenerationClaim(finalClaim.claimId)
      await adapter.releaseCacheGenerationClaim(latestClaim.claimId)
      await adapter.releaseCacheGenerationClaim(nextClaim.claimId)
      await adapter.releaseCacheGenerationClaim(warmClaim.claimId)
      await adapter.releaseCacheGenerationClaim(claim.claimId)
      // The current head remains available for new runs after all claims
      // release. A later checkpoint tests retirement of the old row table.
      const currentAfterCleanup =
        await adapter.claimCacheGeneration(collectionId)
      expect(currentAfterCleanup.storageCollectionId).toBe(
        thirdRecovery.storageCollectionId,
      )
      await adapter.releaseCacheGenerationClaim(currentAfterCleanup.claimId)
      // Releasing a claim removes durable read authority too. The caller
      // supplies the claim it used at admission, and SQLite checks it inside
      // the read transaction before returning even an empty snapshot.
      await expect(
        adapter.loadResumeSnapshot(thirdRecovery.storageCollectionId, {
          cacheGenerationClaimId: claim.claimId,
        }),
      ).rejects.toThrow(`Persisted cache claim`)
      await expect(
        adapter.loadSubset(
          thirdRecovery.storageCollectionId,
          {},
          {
            cacheGenerationClaimId: claim.claimId,
          },
        ),
      ).rejects.toThrow(`Persisted cache claim`)
      await expect(
        adapter.scanRows(thirdRecovery.storageCollectionId, undefined, {
          cacheGenerationClaimId: claim.claimId,
        }),
      ).rejects.toThrow(`Persisted cache claim`)
      await expect(
        adapter.loadCollectionMetadata(thirdRecovery.storageCollectionId, {
          cacheGenerationClaimId: claim.claimId,
        }),
      ).rejects.toThrow(`Persisted cache claim`)
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  // Claim revocation may race a durable read after its preliminary check.
  // A held registration lookup puts the revocation between that check and
  // the read transaction. The independent law permits no row or metadata to
  // return after revocation; the in-transaction check is the comparison cut.
  it(`rejects a cache read when its claim is revoked before the read transaction`, async () => {
    const database = new DatabaseSync(`:memory:`)
    const driver = createDriver(database)
    const registrationEntered = deferred()
    const releaseRegistration = deferred()
    let holdRegistration = false
    const gatedDriver: SQLiteDriver = {
      ...driver,
      query: async (sql, params) => {
        if (holdRegistration && sql.includes(`FROM collection_registry`)) {
          holdRegistration = false
          registrationEntered.resolve()
          await releaseRegistration.promise
        }
        return driver.query(sql, params)
      },
    }
    const writer = new SQLiteCorePersistenceAdapter({ driver })
    const reader = new SQLiteCorePersistenceAdapter({ driver: gatedDriver })
    let read: ReturnType<typeof reader.loadResumeSnapshot> | undefined
    let primaryFailure: unknown
    try {
      const claim = await writer.claimCacheGeneration(`revoked-cache-read`)
      await writer.applyCommittedTx(claim.storageCollectionId, {
        txId: `seed-row`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: claim.claimId,
        mutations: [{ type: `insert`, key: `row`, value: { id: `row` } }],
      })
      holdRegistration = true
      read = reader.loadResumeSnapshot(claim.storageCollectionId, {
        cacheGenerationClaimId: claim.claimId,
      })
      void read.catch(() => undefined)
      await reachCheckpoint(registrationEntered.promise, `registration lookup`)
      await writer.releaseCacheGenerationClaim(claim.claimId)
      releaseRegistration.resolve()
      await expect(read).rejects.toThrow(`Persisted cache claim`)
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      releaseRegistration.resolve()
      await Promise.allSettled([read])
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  // A retired generation is a cache, not an archive. Its last claim is the
  // only remaining reason to retain its rows. The model has two independent
  // row maps: releasing the final old claim empties only the retired map,
  // while the current generation keeps its source rows and stays claimable.
  // The real SQLite row counts are the comparison checkpoint; a public
  // Collection snapshot alone would miss an unbounded durable leak.
  it(`reclaims retired cache rows after their last claim releases`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    try {
      const adapter = new SQLiteCorePersistenceAdapter({
        driver: createDriver(database),
      })
      const logicalId = `retired-cache-collection`
      const first = await adapter.claimCacheGeneration(logicalId)
      const warm = await adapter.claimCacheGeneration(logicalId)
      await adapter.applyCommittedTx(first.storageCollectionId, {
        txId: `old-row`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: first.claimId,
        mutations: [{ type: `insert`, key: `old`, value: { id: `old` } }],
      })
      const current = await adapter.rotateCacheGeneration(
        logicalId,
        first.claimId,
      )
      await adapter.applyCommittedTx(current.storageCollectionId, {
        txId: `current-row`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: current.claimId,
        mutations: [
          { type: `insert`, key: `current`, value: { id: `current` } },
        ],
      })
      const oldTable = createPersistedTableName(first.storageCollectionId, `c`)
      const countOld = () =>
        (
          database
            .prepare(`SELECT COUNT(*) AS count FROM "${oldTable}"`)
            .get() as {
            count: number
          }
        ).count
      expect(countOld()).toBe(1)
      await adapter.releaseCacheGenerationClaim(warm.claimId)
      expect(
        database
          .prepare(`SELECT name FROM sqlite_master WHERE name = ?`)
          .get(oldTable),
      ).toBeUndefined()
      expect(
        (
          await adapter.loadResumeSnapshot(current.storageCollectionId, {
            cacheGenerationClaimId: current.claimId,
          })
        ).rows.map(({ key }) => key),
      ).toEqual([`current`])
      const next = await adapter.claimCacheGeneration(logicalId)
      expect(next.storageCollectionId).toBe(current.storageCollectionId)
      await adapter.releaseCacheGenerationClaim(next.claimId)
      await adapter.releaseCacheGenerationClaim(current.claimId)
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  // Schema registration can pause before its first CREATE TABLE while another
  // adapter collects the retired generation. A late registration may finish
  // only by rejecting and removing its own empty table and metadata; it must
  // not resurrect SQLite storage after the last claim has gone away. The
  // gate is at the real adapter's DDL boundary, not at its final read result.
  it(`does not resurrect a collected table after held registration resumes`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    const driver = createDriver(database)
    const createEntered = deferred()
    const releaseCreate = deferred()
    let holdCreate = false
    let oldTable = ``
    const gatedDriver: SQLiteDriver = {
      ...driver,
      exec: async (sql) => {
        if (
          holdCreate &&
          sql.includes(`CREATE TABLE IF NOT EXISTS`) &&
          sql.includes(oldTable)
        ) {
          holdCreate = false
          createEntered.resolve()
          await releaseCreate.promise
        }
        return driver.exec(sql)
      },
    }
    const writer = new SQLiteCorePersistenceAdapter({ driver })
    const reader = new SQLiteCorePersistenceAdapter({ driver: gatedDriver })
    let read: ReturnType<typeof reader.loadResumeSnapshot> | undefined
    try {
      const logicalId = `held-registration-collection`
      const rotating = await writer.claimCacheGeneration(logicalId)
      const warm = await writer.claimCacheGeneration(logicalId)
      oldTable = createPersistedTableName(rotating.storageCollectionId, `c`)
      await writer.applyCommittedTx(rotating.storageCollectionId, {
        txId: `old`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: rotating.claimId,
        mutations: [{ type: `insert`, key: `old`, value: { id: `old` } }],
      })
      await writer.rotateCacheGeneration(logicalId, rotating.claimId)
      holdCreate = true
      read = reader.loadResumeSnapshot(rotating.storageCollectionId, {
        cacheGenerationClaimId: warm.claimId,
      })
      void read.catch(() => undefined)
      await reachCheckpoint(createEntered.promise, `held registration DDL`)
      await writer.releaseCacheGenerationClaim(warm.claimId)
      releaseCreate.resolve()
      await expect(read).rejects.toThrow(`collected before registration`)
      expect(
        database
          .prepare(`SELECT name FROM sqlite_master WHERE name = ?`)
          .get(oldTable),
      ).toBeUndefined()
      expect(
        database
          .prepare(
            `SELECT collection_id FROM collection_version WHERE collection_id = ?`,
          )
          .get(rotating.storageCollectionId),
      ).toBeUndefined()
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      releaseCreate.resolve()
      await Promise.allSettled([read])
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  // Claim validation can finish before schema registration even begins. If
  // the last claim releases in that interval, a second catalog lookup finds
  // no generation row. The request still carries managed-cache identity; it
  // must remove any table it creates before rejecting the later read.
  it(`does not lose managed identity before a held registration lookup`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    const driver = createDriver(database)
    const lookupEntered = deferred()
    const releaseLookup = deferred()
    let holdLookup = false
    const gatedDriver: SQLiteDriver = {
      ...driver,
      query: async (sql, params) => {
        if (
          holdLookup &&
          sql.includes(
            `SELECT physical_id FROM cache_generation WHERE physical_id = ?`,
          )
        ) {
          holdLookup = false
          lookupEntered.resolve()
          await releaseLookup.promise
        }
        return driver.query(sql, params)
      },
    }
    const writer = new SQLiteCorePersistenceAdapter({ driver })
    const reader = new SQLiteCorePersistenceAdapter({ driver: gatedDriver })
    let read: ReturnType<typeof reader.loadResumeSnapshot> | undefined
    try {
      const logicalId = `held-managed-catalog-lookup`
      const rotating = await writer.claimCacheGeneration(logicalId)
      const warm = await writer.claimCacheGeneration(logicalId)
      await writer.applyCommittedTx(rotating.storageCollectionId, {
        txId: `old`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: rotating.claimId,
        mutations: [{ type: `insert`, key: `old`, value: { id: `old` } }],
      })
      await writer.rotateCacheGeneration(logicalId, rotating.claimId)
      const oldTable = createPersistedTableName(
        rotating.storageCollectionId,
        `c`,
      )
      holdLookup = true
      read = reader.loadResumeSnapshot(rotating.storageCollectionId, {
        cacheGenerationClaimId: warm.claimId,
      })
      void read.catch(() => undefined)
      await reachCheckpoint(lookupEntered.promise, `managed catalog lookup`)
      await writer.releaseCacheGenerationClaim(warm.claimId)
      releaseLookup.resolve()
      await expect(read).rejects.toThrow()
      expect(
        database
          .prepare(`SELECT name FROM sqlite_master WHERE name = ?`)
          .get(oldTable),
      ).toBeUndefined()
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      releaseLookup.resolve()
      await Promise.allSettled([read])
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  // A paused run cannot keep retired bytes forever. In the model, a claim is
  // usable only before its expiry cut; a new run collects an expired retired
  // generation without touching the current head. The old run may then make
  // a private empty generation for fresh demanded source snapshots, but it
  // cannot reclaim the expired rows or retire the head used by another run.
  it(`expires a paused claim and recovers privately without displacing the current cache`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    let now = 1_000
    try {
      const adapter = new SQLiteCorePersistenceAdapter({
        driver: createDriver(database),
        cacheGenerationClaimTtlMs: 100,
        now: () => now,
      })
      const logicalId = `expired-cache-claim`
      const old = await adapter.claimCacheGeneration(logicalId)
      const paused = await adapter.claimCacheGeneration(logicalId)
      await adapter.applyCommittedTx(old.storageCollectionId, {
        txId: `old`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: old.claimId,
        mutations: [{ type: `insert`, key: `old`, value: { id: `old` } }],
      })
      const head = await adapter.rotateCacheGeneration(logicalId, old.claimId)
      const headTable = createPersistedTableName(head.storageCollectionId, `c`)
      await adapter.applyCommittedTx(head.storageCollectionId, {
        txId: `head`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: head.claimId,
        mutations: [{ type: `insert`, key: `head`, value: { id: `head` } }],
      })
      now = 1_090
      expect(
        await adapter.renewCacheGenerationClaim(
          head.storageCollectionId,
          head.claimId,
        ),
      ).toBe(1_190)
      now = 1_110
      const next = await adapter.claimCacheGeneration(logicalId)
      expect(next.storageCollectionId).toBe(head.storageCollectionId)
      await expect(
        adapter.loadResumeSnapshot(old.storageCollectionId, {
          cacheGenerationClaimId: paused.claimId,
        }),
      ).rejects.toThrow(`Persisted cache claim`)
      const oldTable = createPersistedTableName(old.storageCollectionId, `c`)
      expect(
        database
          .prepare(`SELECT name FROM sqlite_master WHERE name = ?`)
          .get(oldTable),
      ).toBeUndefined()
      const privateRecovery = await adapter.rotateCacheGeneration(
        logicalId,
        paused.claimId,
      )
      expect(privateRecovery.storageCollectionId).not.toBe(
        head.storageCollectionId,
      )
      expect(
        (await adapter.claimCacheGeneration(logicalId)).storageCollectionId,
      ).toBe(head.storageCollectionId)
      await adapter.applyCommittedTx(privateRecovery.storageCollectionId, {
        txId: `fresh-subset`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: privateRecovery.claimId,
        mutations: [{ type: `insert`, key: `fresh`, value: { id: `fresh` } }],
      })
      expect(
        (
          database
            .prepare(`SELECT COUNT(*) AS count FROM "${headTable}"`)
            .get() as {
            count: number
          }
        ).count,
      ).toBe(1)
      expect(
        (
          await adapter.loadResumeSnapshot(
            privateRecovery.storageCollectionId,
            { cacheGenerationClaimId: privateRecovery.claimId },
          )
        ).rows.map(({ key }) => key),
      ).toEqual([`fresh`])
      await adapter.releaseCacheGenerationClaim(privateRecovery.claimId)
      const advanced = await adapter.rotateCacheGeneration(
        logicalId,
        head.claimId,
        undefined,
        head.storageCollectionId,
      )
      expect(
        database
          .prepare(
            `SELECT generation FROM cache_generation WHERE physical_id = ?`,
          )
          .get(advanced.storageCollectionId),
      ).toMatchObject({ generation: 3 })
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  // Expiry revokes this run's authority, not another run's ability to claim
  // the current cache. Recovery must use private empty storage even when the
  // expired claim remembered the current storage ID.
  it(`keeps the current cache claimable when its expired claimant recovers`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    let now = 1_000
    try {
      const adapter = new SQLiteCorePersistenceAdapter({
        driver: createDriver(database),
        cacheGenerationClaimTtlMs: 100,
        now: () => now,
      })
      const logicalId = `expired-head-recovery`
      const old = await adapter.claimCacheGeneration(logicalId)
      await adapter.applyCommittedTx(old.storageCollectionId, {
        txId: `old`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: old.claimId,
        mutations: [{ type: `insert`, key: `old`, value: { id: `old` } }],
      })
      now = 1_101
      expect(
        await adapter.renewCacheGenerationClaim(
          old.storageCollectionId,
          old.claimId,
        ),
      ).toBeUndefined()
      const repaired = await adapter.rotateCacheGeneration(
        logicalId,
        old.claimId,
        undefined,
        old.storageCollectionId,
      )
      const next = await adapter.claimCacheGeneration(logicalId)
      expect(next.storageCollectionId).toBe(old.storageCollectionId)
      expect(repaired.storageCollectionId).not.toBe(old.storageCollectionId)
      expect(
        (
          await adapter.loadResumeSnapshot(next.storageCollectionId, {
            cacheGenerationClaimId: next.claimId,
          })
        ).rows.map(({ key }) => key),
      ).toEqual([`old`])
      await expect(
        adapter.loadResumeSnapshot(old.storageCollectionId, {
          cacheGenerationClaimId: old.claimId,
        }),
      ).rejects.toThrow(`Persisted cache claim`)
      await adapter.releaseCacheGenerationClaim(next.claimId)
      await adapter.releaseCacheGenerationClaim(repaired.claimId)
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  // A peer's live claim does not extend an expired run's authority. The model
  // grants each run its own expiring claim even when both share one generation.
  // Stream-position, replay, and index work must use the initiating claim at
  // the SQLite transaction cut. The warm peer must still be able to use the
  // same generation, so rejecting every operation is not a valid repair.
  it(`rejects coordinator work from an expired claimant while its peer remains live`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    let now = 1_000
    try {
      const adapter = new SQLiteCorePersistenceAdapter({
        driver: createDriver(database),
        cacheGenerationClaimTtlMs: 100,
        now: () => now,
      })
      const claim = await adapter.claimCacheGeneration(`coordinator-claim`)
      const id = claim.storageCollectionId
      const claimCtx = { cacheGenerationClaimId: claim.claimId }
      await adapter.applyCommittedTx(id, {
        txId: `seed`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: claim.claimId,
        mutations: [{ type: `insert`, key: `row`, value: { id: `row` } }],
      })
      await adapter.ensureIndex(
        id,
        `existing`,
        { expressionSql: [`json_extract(value, '$.id')`] },
        claimCtx,
      )
      now = 1_050
      const peer = await adapter.claimCacheGeneration(`coordinator-claim`)
      const peerCtx = { cacheGenerationClaimId: peer.claimId }
      now = 1_101
      expect(adapter.getCacheGenerationNow()).toBe(now)
      await expect(adapter.getStreamPosition(id, claimCtx)).rejects.toThrow(
        `Persisted cache claim`,
      )
      await expect(adapter.pullSince(id, 0, claimCtx)).rejects.toThrow(
        `Persisted cache claim`,
      )
      await expect(
        adapter.ensureIndex(
          id,
          `late`,
          { expressionSql: [`json_extract(value, '$.id')`] },
          claimCtx,
        ),
      ).rejects.toThrow(`Persisted cache claim`)
      await expect(
        adapter.markIndexRemoved(id, `existing`, claimCtx),
      ).rejects.toThrow(`Persisted cache claim`)
      await expect(adapter.getStreamPosition(id)).rejects.toThrow(
        `Persisted cache claim`,
      )

      expect(await adapter.getStreamPosition(id, peerCtx)).toMatchObject({
        latestTerm: 1,
        latestSeq: 1,
      })
      expect(await adapter.pullSince(id, 0, peerCtx)).toMatchObject({
        changedKeys: [`row`],
      })
      await adapter.ensureIndex(
        id,
        `peer`,
        { expressionSql: [`json_extract(value, '$.id')`] },
        peerCtx,
      )
      await adapter.markIndexRemoved(id, `peer`, peerCtx)
      expect(
        database
          .prepare(
            `SELECT signature, removed FROM persisted_index_registry
             WHERE collection_id = ? ORDER BY signature`,
          )
          .all(id),
      ).toEqual([
        { signature: `existing`, removed: 0 },
        { signature: `peer`, removed: 1 },
      ])
      await adapter.releaseCacheGenerationClaim(peer.claimId)
      await expect(adapter.getStreamPosition(id, peerCtx)).rejects.toThrow(
        `Persisted cache claim`,
      )
      const next = await adapter.claimCacheGeneration(`coordinator-claim`)
      expect(next.storageCollectionId).toBe(id)
      expect(
        await adapter.getStreamPosition(id, {
          cacheGenerationClaimId: next.claimId,
        }),
      ).toMatchObject({ latestRowVersion: 1 })
      await adapter.releaseCacheGenerationClaim(next.claimId)
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  // Index events are a public route to durable work. Two Collection instances
  // start on one persisted cache generation with the same index. When the
  // first run's claim expires, removing its public index cannot remove the
  // physical index still owned by the warm run. Removing the warm run's index
  // afterward must succeed, so the boundary is the initiating claim rather
  // than a blanket ban on index changes to a retired generation.
  it(`keeps a warm peer's SQLite index after an expired Collection removes its index`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    let now = Date.now()
    const logicalId = `peer-index-after-expiry`
    const adapter = new SQLiteCorePersistenceAdapter({
      driver: createDriver(database),
      cacheGenerationClaimTtlMs: 10_000,
      now: () => now,
    })
    const createIndexedCollection = () => {
      const sourceStarted = deferred()
      const collection = createCollection(
        persistedCollectionOptions<{ id: string; title: string }, string>({
          id: logicalId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          defaultIndexType: BasicIndex,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              sourceStarted.resolve()
              return { restartAfterScopedRecovery: () => {} }
            },
          },
          persistence: { adapter },
        }),
      )
      const index = collection.createIndex((row) => row.title, {
        name: `shared-title`,
      })
      const signature = collection
        .getIndexMetadata()
        .find((metadata) => metadata.indexId === index.id)?.signature
      if (!signature) throw new Error(`Missing index signature`)
      collection.startSyncImmediate()
      return { collection, index, signature, sourceStarted }
    }
    let first: ReturnType<typeof createIndexedCollection> | undefined
    let peer: ReturnType<typeof createIndexedCollection> | undefined
    try {
      first = createIndexedCollection()
      await reachCheckpoint(first.sourceStarted.promise, `first indexed source`)
      const originalClaim = database
        .prepare(
          `SELECT claim_id, physical_id, expires_at_ms
           FROM cache_generation_claim WHERE logical_id = ?`,
        )
        .get(logicalId) as {
        claim_id: string
        physical_id: string
        expires_at_ms: number
      }

      now += 5_000
      peer = createIndexedCollection()
      await reachCheckpoint(peer.sourceStarted.promise, `peer indexed source`)
      expect(peer.signature).toBe(first.signature)
      const peerClaim = database
        .prepare(
          `SELECT claim_id, physical_id, expires_at_ms
           FROM cache_generation_claim
           WHERE logical_id = ? AND claim_id <> ?`,
        )
        .get(logicalId, originalClaim.claim_id) as {
        claim_id: string
        physical_id: string
        expires_at_ms: number
      }
      expect(peerClaim.physical_id).toBe(originalClaim.physical_id)
      const indexState = () =>
        database
          .prepare(
            `SELECT removed FROM persisted_index_registry
             WHERE collection_id = ? AND signature = ?`,
          )
          .get(originalClaim.physical_id, first!.signature) as
          { removed: number } | undefined
      expect(indexState()).toEqual({ removed: 0 })

      now += 6_000
      expect(now).toBeGreaterThan(originalClaim.expires_at_ms)
      expect(now).toBeLessThan(peerClaim.expires_at_ms)
      first.collection.removeIndex(first.index)
      await vi.waitFor(() => {
        const moved = database
          .prepare(
            `SELECT physical_id FROM cache_generation_claim
             WHERE logical_id = ? AND claim_id <> ?`,
          )
          .get(logicalId, peerClaim.claim_id) as
          { physical_id: string } | undefined
        expect(moved?.physical_id).toBeDefined()
        expect(moved?.physical_id).not.toBe(originalClaim.physical_id)
      })
      expect(indexState()).toEqual({ removed: 0 })

      peer.collection.removeIndex(peer.index)
      await vi.waitFor(() => expect(indexState()).toEqual({ removed: 1 }))
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      try {
        await first?.collection.cleanup()
        await peer?.collection.cleanup()
      } catch (error) {
        primaryFailure ??= error
      }
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  // Startup metadata belongs to the cache claim that admitted its SQLite
  // snapshot. If that claim expires while the snapshot is in flight, the
  // returned metadata cannot authorize the source run. This driver holds the
  // real SQLite metadata query after its transaction-time claim check, moves
  // the adapter clock past expiry, then releases the query. The source must
  // start under fresh cache authority without observing the old resume value.
  it(`does not publish startup metadata read under an expired cache claim`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    let now = Date.now()
    const baseDriver = createDriver(database)
    const metadataReadEntered = deferred()
    const releaseMetadataRead = deferred()
    let holdMetadataRead = false
    const driver: SQLiteDriver = {
      ...baseDriver,
      transaction: (transaction) =>
        baseDriver.transaction((transactionDriver) =>
          transaction({
            ...transactionDriver,
            query: async <T>(sql: string, params?: ReadonlyArray<unknown>) => {
              const rows = await transactionDriver.query<T>(sql, params)
              if (
                holdMetadataRead &&
                sql.includes(`FROM collection_metadata`)
              ) {
                holdMetadataRead = false
                metadataReadEntered.resolve()
                await releaseMetadataRead.promise
              }
              return rows
            },
          }),
        ),
    }
    const adapter = new SQLiteCorePersistenceAdapter({
      driver,
      cacheGenerationClaimTtlMs: 10_000,
      now: () => now,
    })
    const logicalId = `expired-startup-metadata`
    let collection: Collection<{ id: string }, string> | undefined
    try {
      const seed = await adapter.claimCacheGeneration(logicalId)
      await adapter.applyCommittedTx(seed.storageCollectionId, {
        txId: `seed-resume`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: seed.claimId,
        mutations: [],
        collectionMetadataMutations: [
          { type: `set`, key: `resume`, value: `old-resume` },
        ],
      })
      expect(
        (
          await adapter.loadResumeSnapshot(seed.storageCollectionId, {
            includeRows: false,
            cacheGenerationClaimId: seed.claimId,
          })
        ).collectionMetadata,
      ).toContainEqual({ key: `resume`, value: `old-resume` })
      await adapter.releaseCacheGenerationClaim(seed.claimId)

      const sourceResumeValues: Array<unknown> = []
      const sourceStarted = deferred()
      collection = createCollection(
        persistedCollectionOptions<{ id: string }, string>({
          id: logicalId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (source) => {
              sourceResumeValues.push(source.metadata?.collection.get(`resume`))
              source.markReady()
              sourceStarted.resolve()
              return { restartAfterScopedRecovery: () => {} }
            },
          },
          persistence: { adapter },
        }),
      )
      holdMetadataRead = true
      collection.startSyncImmediate()
      await reachCheckpoint(
        metadataReadEntered.promise,
        `managed startup metadata snapshot`,
      )
      expect(sourceResumeValues).toEqual([])
      now += 11_000
      releaseMetadataRead.resolve()
      await reachCheckpoint(
        sourceStarted.promise,
        `source startup after expired metadata read`,
      )
      await vi.waitFor(() => expect(collection?.status).toBe(`ready`))
      expect(sourceResumeValues).toEqual([undefined])
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      releaseMetadataRead.resolve()
      try {
        await collection?.cleanup()
      } catch (error) {
        primaryFailure ??= error
      }
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  // The adapter-level expiry law must reach the real persisted wrapper. A
  // source commit after a long pause is admitted before any timer callback;
  // it must reject without publishing under the expired claim. The same sync
  // run then writes a fresh source result into new storage. This receiving
  // witness checks SQLite rows as well as the public Collection snapshot.
  it(`reloads source writes into a new SQLite generation after claim expiry`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    let now = Date.now()
    const logicalId = `expired-sqlite-source`
    const adapter = new SQLiteCorePersistenceAdapter({
      driver: createDriver(database),
      cacheGenerationClaimTtlMs: 10_000,
      now: () => now,
    })
    let source!: Parameters<SyncConfig<{ id: string }, string>[`sync`]>[0]
    const collection = createCollection(
      persistedCollectionOptions<{ id: string }, string>({
        id: logicalId,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
            // This controlled source has no delayed provider callbacks.
            return { restartAfterScopedRecovery: () => {} }
          },
        },
        persistence: { adapter },
      }),
    )
    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      await source.metadata!.persistence!.hydrateBaseline()
      const oldHead = database
        .prepare(
          `SELECT physical_id FROM cache_generation
           WHERE logical_id = ? AND retired = 0`,
        )
        .get(logicalId) as { physical_id: string }
      now += 11_000
      source.begin()
      source.write({ type: `insert`, value: { id: `expired` } })
      const oldReceipt = source.commit()
      if (oldReceipt === true) throw new Error(`source receipt was not tracked`)
      await expect(oldReceipt).rejects.toThrow()
      await vi.waitFor(() => {
        const claim = database
          .prepare(
            `SELECT physical_id FROM cache_generation_claim
             WHERE logical_id = ?`,
          )
          .get(logicalId) as { physical_id: string } | undefined
        expect(claim?.physical_id).toBeDefined()
        expect(claim?.physical_id).not.toBe(oldHead.physical_id)
      })
      expect(
        database
          .prepare(
            `SELECT physical_id FROM cache_generation
             WHERE logical_id = ? AND retired = 0`,
          )
          .get(logicalId),
      ).toMatchObject(oldHead)
      await collection._sync.loadSubset({ limit: 0 })
      expect(collection.get(`expired`)).toBeUndefined()
      source.begin()
      source.write({ type: `insert`, value: { id: `fresh` } })
      await whenSyncAccepted(source.commit())
      expect(collection.get(`fresh`)).toMatchObject({ id: `fresh` })
      const claims = database
        .prepare(
          `SELECT physical_id, claim_id FROM cache_generation_claim
           WHERE logical_id = ?`,
        )
        .all(logicalId) as Array<{ physical_id: string; claim_id: string }>
      expect(claims).toHaveLength(1)
      expect(
        (
          await adapter.scanRows(claims[0]!.physical_id, undefined, {
            cacheGenerationClaimId: claims[0]!.claim_id,
          })
        ).map(({ key }) => key),
      ).toEqual([`fresh`])
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      try {
        await collection.cleanup()
      } catch (error) {
        primaryFailure ??= error
      }
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  // A recovering on-demand sync run must advance the current persisted cache
  // generation before it accepts further source commits. The old generation
  // remains available to an existing claim, but no new run may inherit its
  // stale row. The independent expectation is two disjoint durable row maps:
  // old={stale}, current={fresh}, with the current key set uncertified. This
  // production driver enters through the persisted wrapper capability, then
  // checks SQLite snapshots after recovery and one source sync transaction.
  // The reset marker belongs to the new generation: without it, a later run
  // could mistake the partial cache for a resumable baseline.
  it(`moves scoped recovery to a new persisted cache generation`, async () => {
    type Row = { id: string; title: string }
    const database = new DatabaseSync(`:memory:`)
    const adapter = new SQLiteCorePersistenceAdapter({
      driver: createDriver(database),
    })
    let collection: Collection<Row, string> | undefined
    let seedClaimId: string | undefined
    let currentClaimId: string | undefined
    let primaryFailure: unknown
    try {
      const collectionId = `scoped-generation-boundary`
      const staleRow: Row = { id: `stale`, title: `Old cached row` }
      const seedClaim = await adapter.claimCacheGeneration(collectionId)
      seedClaimId = seedClaim.claimId
      await adapter.applyCommittedTx(seedClaim.storageCollectionId, {
        txId: `seed-stale-row`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: seedClaim.claimId,
        mutations: [{ type: `insert`, key: staleRow.id, value: staleRow }],
      })

      let source: Parameters<SyncConfig<Row, string>[`sync`]>[0] | undefined
      const sourceReady = deferred()
      collection = createCollection(
        persistedCollectionOptions<Row, string>({
          id: collectionId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
              sourceReady.resolve()
              return {
                loadSubset: async () => {},
                restartAfterScopedRecovery: () => {},
              }
            },
          },
          persistence: { adapter },
        }),
      )
      collection.startSyncImmediate()
      await reachCheckpoint(sourceReady.promise, `on-demand source start`)
      const capability = source?.metadata?.persistence
      expect(capability?.startScopedRecovery).toBeTypeOf(`function`)
      const resetMarker = { kind: `reset`, updatedAt: 3 }
      await capability!.startScopedRecovery!({
        key: `electric:resume`,
        value: resetMarker,
      })

      const currentClaim = await adapter.claimCacheGeneration(collectionId)
      currentClaimId = currentClaim.claimId
      expect(currentClaim.storageCollectionId).not.toBe(
        seedClaim.storageCollectionId,
      )
      const freshRow: Row = { id: `fresh`, title: `Demanded source row` }
      source!.begin()
      source!.write({ type: `insert`, value: freshRow })
      await whenSyncAccepted(source!.commit())

      const oldSnapshot = await adapter.loadResumeSnapshot(
        seedClaim.storageCollectionId,
        { cacheGenerationClaimId: seedClaim.claimId },
      )
      const currentSnapshot = await adapter.loadResumeSnapshot(
        currentClaim.storageCollectionId,
        { cacheGenerationClaimId: currentClaim.claimId },
      )
      expect(oldSnapshot.rows.map(({ value }) => value)).toEqual([staleRow])
      expect(currentSnapshot.rows.map(({ value }) => value)).toEqual([freshRow])
      expect(currentSnapshot.keySet).toEqual({ status: `incompatible` })
      expect(currentSnapshot.collectionMetadata).toContainEqual({
        key: `electric:resume`,
        value: resetMarker,
      })
      expect(collection.get(`stale`)).toBeUndefined()
      expect(collection.get(`fresh`)).toMatchObject(freshRow)
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      const cleanupFailures: Array<unknown> = []
      try {
        await collection?.cleanup()
      } catch (error) {
        cleanupFailures.push(error)
      }
      try {
        if (currentClaimId !== undefined) {
          await adapter.releaseCacheGenerationClaim(currentClaimId)
        }
        if (seedClaimId !== undefined) {
          await adapter.releaseCacheGenerationClaim(seedClaimId)
        }
      } catch (error) {
        cleanupFailures.push(error)
      }
      if (primaryFailure instanceof Error && cleanupFailures.length > 0) {
        Object.defineProperty(primaryFailure, `cleanupFailures`, {
          value: cleanupFailures,
          enumerable: true,
        })
      }
      closeDatabasePreservingPrimary(
        database,
        primaryFailure ??
          (cleanupFailures.length > 0
            ? new AggregateError(cleanupFailures, `Recovery cleanup failed`)
            : undefined),
      )
    }
  })

  const startupHistoryArbitrary = fc.record({
    baselineSize: fc.integer({ min: 1, max: 3 }),
    transition: fc.constantFrom(
      `none` as const,
      `managed-insert` as const,
      `raw-delete` as const,
    ),
  })

  type StartupRow = { id: string; title: string }
  const expectStartupRows = (
    actual: Array<StartupRow>,
    expected: Array<StartupRow>,
  ) => expect(actual).toEqual(expected)

  const assertStartupHistory = async (history: {
    baselineSize: number
    transition: `none` | `managed-insert` | `raw-delete`
  }) => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    let releaseInitialSnapshot = () => {}
    let collection:
      Collection<{ id: string; title: string }, string> | undefined
    try {
      const driver = createDriver(database)
      const collectionId = `generated-local-startup`
      const adapter = new SQLiteCorePersistenceAdapter({ driver })
      const baselineRows = Array.from(
        { length: history.baselineSize },
        (_, index) => ({
          id: `baseline-${index}`,
          title: `baseline-${index}`,
        }),
      )
      await adapter.applyCommittedTx(collectionId, {
        txId: `seed`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        truncate: true,
        mutations: baselineRows.map((row) => ({
          type: `insert` as const,
          key: row.id,
          value: row,
        })),
      })

      const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
      const reachedInitialSnapshot = deferred()
      const reachedHydrationSnapshot = deferred()
      const initialSnapshotRelease = deferred()
      releaseInitialSnapshot = initialSnapshotRelease.resolve
      let snapshotCalls = 0
      const runInHydrationScope = adapter.runInHydrationScope.bind(adapter)
      adapter.runInHydrationScope = (task) =>
        runInHydrationScope((scopedAdapter) =>
          task({
            ...scopedAdapter,
            loadResumeSnapshot: async (...args) => {
              const snapshot = await scopedAdapter.loadResumeSnapshot(...args)
              snapshotCalls++
              if (snapshotCalls === 1) {
                reachedInitialSnapshot.resolve()
                await initialSnapshotRelease.promise
              } else if (snapshotCalls === 2) {
                reachedHydrationSnapshot.resolve()
              }
              return snapshot
            },
          }),
        )

      collection = createCollection(
        persistedCollectionOptions<{ id: string; title: string }, string>({
          id: collectionId,
          startSync: false,
          getKey: (row) => row.id,
          persistence: { adapter },
        }),
      )
      collection.startSyncImmediate()
      await reachCheckpoint(
        reachedInitialSnapshot.promise,
        `generated local startup metadata snapshot`,
      )

      const managedRow = {
        id: `managed`,
        title: `managed-during-startup`,
      }
      let managedPersistence: Promise<unknown> | undefined
      let managedPersistenceSettled = false
      if (history.transition === `managed-insert`) {
        managedPersistence = collection.insert(managedRow).isPersisted.promise
        void managedPersistence.then(
          () => {
            managedPersistenceSettled = true
          },
          () => {
            managedPersistenceSettled = true
          },
        )
        for (let attempt = 0; attempt < 20; attempt++) {
          await Promise.resolve()
        }
        expect(managedPersistenceSettled).toBe(false)
      } else if (history.transition === `raw-delete`) {
        const tableName = createPersistedTableName(collectionId, `c`)
        await driver.run(`DELETE FROM "${tableName}" WHERE key = ?`, [
          encodePersistedStorageKey(baselineRows[0]!.id),
        ])
      }

      releaseInitialSnapshot()
      await managedPersistence
      await collection.stateWhenReady()
      await reachCheckpoint(
        reachedHydrationSnapshot.promise,
        `generated local startup hydration snapshot`,
      )
      const visibleRows = Array.from(collection.values(), ({ id, title }) => ({
        id,
        title,
      })).sort((left, right) => left.id.localeCompare(right.id))
      const expectedRows =
        history.transition === `raw-delete`
          ? []
          : [
              ...baselineRows,
              ...(history.transition === `managed-insert` ? [managedRow] : []),
            ].sort((left, right) => left.id.localeCompare(right.id))

      expectStartupRows(visibleRows, expectedRows)
      if (history.transition === `managed-insert`) {
        const durableRows = (await loadResumeSnapshot(collectionId)).rows
          .map(({ value }) => value)
          .sort((left, right) =>
            String(left.id).localeCompare(String(right.id)),
          )
        expect(durableRows).toEqual(expectedRows)
      }
      if (history.transition === `raw-delete`) {
        expect((await loadResumeSnapshot(collectionId)).keySet).toEqual({
          status: `incompatible`,
        })
      }
    } catch (error) {
      primaryFailure = error
    } finally {
      releaseInitialSnapshot()
      try {
        await collection?.cleanup()
      } catch (cleanupError) {
        if (primaryFailure === undefined) primaryFailure = cleanupError
      }
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  }

  it(`rejects a startup answer that suppresses the older baseline after a managed generation advance`, () => {
    const baseline = { id: `baseline-0`, title: `baseline-0` }
    const managed = { id: `managed`, title: `managed-during-startup` }
    expect(() => expectStartupRows([managed], [baseline, managed])).toThrow()
  })

  it(`fixed startup corpus reaches every baseline size and transition`, () => {
    const histories = fc.sample(startupHistoryArbitrary, {
      seed: 1659,
      numRuns: 12,
    })
    expect(new Set(histories.map(({ baselineSize }) => baselineSize))).toEqual(
      new Set([1, 2, 3]),
    )
    expect(new Set(histories.map(({ transition }) => transition))).toEqual(
      new Set([`none`, `managed-insert`, `raw-delete`]),
    )
  })

  fcTest.prop([startupHistoryArbitrary], {
    seed: 1659,
    numRuns: oracleRuns(12),
  })(
    `preserves local-only startup histories across managed generation advancement (fixed)`,
    assertStartupHistory,
  )

  fcTest.prop(
    [startupHistoryArbitrary],
    oraclePropertyOptions(12, `sqlite-resume.startup-generation`),
  )(
    `preserves local-only startup histories across managed generation advancement (random or replayed)`,
    assertStartupHistory,
  )

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

  it(`writes a cold replacement with exact values and bounded database calls`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    try {
      let databaseCalls = 0
      let maxReplacementBoundParameters = 0
      const driver = createDriver(
        database,
        undefined,
        () => databaseCalls++,
        (_sql, params) => {
          databaseCalls++
          maxReplacementBoundParameters = Math.max(
            maxReplacementBoundParameters,
            params.length,
          )
        },
      )
      const adapter = new SQLiteCorePersistenceAdapter({ driver })
      const collectionId = `cold-replacement-work`
      await adapter.applyCommittedTx(collectionId, {
        txId: `previous-generation`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          { type: `insert`, key: `old`, value: { id: `old`, title: `old` } },
        ],
        collectionMetadataMutations: [
          { type: `set`, key: `electric:resume`, value: { offset: `old` } },
        ],
      })

      const rows = Array.from({ length: 205 }, (_, index) => {
        const id = `row-${String(index).padStart(3, `0`)}`
        return { id, title: `Title ${index}` }
      })
      databaseCalls = 0
      maxReplacementBoundParameters = 0
      await adapter.applyCommittedTx(collectionId, {
        txId: `cold-replacement`,
        term: 1,
        seq: 2,
        rowVersion: 2,
        truncate: true,
        mutations: rows.map((row) => ({
          type: `update` as const,
          key: row.id,
          value: row,
          metadataChanged: true,
          metadata: { source: `row-write` },
        })),
        rowMetadataMutations: [
          ...rows
            .filter((_, index) => index % 2 === 0)
            .map((row) => ({
              type: `set` as const,
              key: row.id,
              value: { source: `electric`, operation: `insert` },
            })),
          { type: `delete`, key: rows[0]!.id },
          { type: `set`, key: `absent`, value: { ignored: true } },
        ],
        collectionMetadataMutations: [
          { type: `set`, key: `electric:resume`, value: { offset: `2_0` } },
        ],
      })
      const replacementCalls = databaseCalls

      const snapshot = await adapter.loadResumeSnapshot(collectionId)
      const expectedRows = rows.map((row, index) => ({
        key: row.id,
        value: row,
        metadata:
          index === 0
            ? undefined
            : index % 2 === 0
              ? { source: `electric`, operation: `insert` }
              : { source: `row-write` },
      }))
      const byKey = (
        left: { key: string | number },
        right: { key: string | number },
      ) => String(left.key).localeCompare(String(right.key))
      // A durable snapshot has no row-order contract. Challenge the comparison
      // with a valid alternate scan order while retaining every row and value.
      const rowsInAlternateScanOrder = [...snapshot.rows].reverse()
      expect(rowsInAlternateScanOrder.sort(byKey)).toEqual(
        expectedRows.sort(byKey),
      )
      expect(snapshot.collectionMetadata).toEqual([
        { key: `electric:resume`, value: { offset: `2_0` } },
      ])
      expect(snapshot.keySet).toEqual({ status: `consistent` })
      expect(snapshot.latestTerm).toBe(1)
      expect(snapshot.latestSeq).toBe(2)
      expect(snapshot.latestRowVersion).toBe(2)
      expect(
        await driver.query<{ key: string }>(
          `SELECT key FROM collection_expected_keys WHERE collection_id = ? ORDER BY key`,
          [collectionId],
        ),
      ).toEqual(rows.map((row) => ({ key: encodePersistedStorageKey(row.id) })))
      expect(
        await driver.query<{ tx_id: string }>(
          `SELECT tx_id FROM applied_tx WHERE collection_id = ? ORDER BY seq`,
          [collectionId],
        ),
      ).toEqual([
        { tx_id: `previous-generation` },
        { tx_id: `cold-replacement` },
      ])
      // The host-dependent cost is a database call, not the in-process timing.
      expect(replacementCalls).toBeLessThanOrEqual(40)
      expect(maxReplacementBoundParameters).toBe(500)
    } catch (error) {
      primaryFailure = error
    } finally {
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  it(`rolls back every cold replacement chunk when a later chunk fails`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    try {
      const collectionId = `cold-replacement-rollback`
      const tableName = createPersistedTableName(collectionId, `c`)
      let bulkRowInserts = 0
      let injectFailure = false
      const driver = createDriver(database, (sql) => {
        if (
          !injectFailure ||
          !sql.includes(`INSERT INTO "${tableName}"`) ||
          !sql.includes(`), (`)
        ) {
          return false
        }
        bulkRowInserts++
        return bulkRowInserts === 2
      })
      const adapter = new SQLiteCorePersistenceAdapter({ driver })
      await adapter.applyCommittedTx(collectionId, {
        txId: `seed`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `old`,
            value: { id: `old` },
            metadataChanged: true,
            metadata: { source: `previous-generation` },
          },
        ],
        collectionMetadataMutations: [
          { type: `set`, key: `electric:resume`, value: { offset: `old` } },
        ],
      })
      const before = await observeCachedSchemaState(
        adapter,
        driver,
        collectionId,
      )
      const beforeSnapshot = await adapter.loadResumeSnapshot(collectionId)
      injectFailure = true
      await expect(
        adapter.applyCommittedTx(collectionId, {
          txId: `failed-replacement`,
          term: 1,
          seq: 2,
          rowVersion: 2,
          truncate: true,
          mutations: Array.from({ length: 205 }, (_, index) => ({
            type: `update` as const,
            key: `row-${index}`,
            value: { id: `row-${index}` },
          })),
          collectionMetadataMutations: [
            { type: `set`, key: `electric:resume`, value: { offset: `2_0` } },
          ],
        }),
      ).rejects.toThrow(`injected transaction failure`)
      injectFailure = false
      expect(bulkRowInserts).toBe(2)
      expect(
        await observeCachedSchemaState(adapter, driver, collectionId),
      ).toEqual(before)
      expect(await adapter.loadResumeSnapshot(collectionId)).toEqual(
        beforeSnapshot,
      )
    } catch (error) {
      primaryFailure = error
    } finally {
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  it(`keeps ordered duplicate and delete histories on the sequential path`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    try {
      const driver = createDriver(database)
      const adapter = new SQLiteCorePersistenceAdapter({ driver })
      await adapter.applyCommittedTx(`duplicate-replacement`, {
        txId: `duplicate`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        truncate: true,
        mutations: [
          { type: `insert`, key: `same`, value: { id: `same`, first: true } },
          { type: `update`, key: `same`, value: { last: true } },
        ],
      })
      const duplicate = await adapter.loadResumeSnapshot(
        `duplicate-replacement`,
      )
      expect(duplicate.rows).toEqual([
        {
          key: `same`,
          value: { id: `same`, first: true, last: true },
          metadata: undefined,
        },
      ])
      expect(duplicate.keySet).toEqual({ status: `consistent` })

      await adapter.applyCommittedTx(`delete-replacement`, {
        txId: `delete`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        truncate: true,
        mutations: [
          { type: `insert`, key: `removed`, value: { id: `removed` } },
          { type: `delete`, key: `removed`, value: { id: `removed` } },
          { type: `insert`, key: `kept`, value: { id: `kept` } },
        ],
      })
      const deleted = await adapter.loadResumeSnapshot(`delete-replacement`)
      expect(deleted.rows).toEqual([
        { key: `kept`, value: { id: `kept` }, metadata: undefined },
      ])
      expect(deleted.keySet).toEqual({ status: `consistent` })
      const tombstoneTable = createPersistedTableName(`delete-replacement`, `t`)
      expect(
        await driver.query<{ key: string }>(
          `SELECT key FROM "${tombstoneTable}" ORDER BY key`,
        ),
      ).toEqual([{ key: encodePersistedStorageKey(`removed`) }])
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

  it(`rejects a resume snapshot from a cached adapter after another adapter resets the schema`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    try {
      const driver = createDriver(database)
      const collectionId = `cached-schema-snapshot`
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
      })
      await staleV1.loadResumeSnapshot(collectionId)

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

      await expect(staleV1.loadResumeSnapshot(collectionId)).rejects.toThrow(
        `Schema version mismatch`,
      )
      expect(await currentV2.loadResumeSnapshot(collectionId)).toMatchObject({
        rows: [{ key: 2, value: { id: 2 } }],
        collectionMetadata: [{ key: `cursor`, value: `v2` }],
      })
    } catch (error) {
      primaryFailure = error
    } finally {
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  it(`rejects cached row readers after another adapter resets the schema`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    try {
      const driver = createDriver(database)
      const collectionId = `cached-schema-row-readers`
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
      })
      await staleV1.loadSubset(collectionId, {})

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
      })

      const staleReads = await Promise.allSettled([
        staleV1.loadSubset(collectionId, {}),
        staleV1.scanRows(collectionId),
        staleV1.pullSince(collectionId, 0),
      ])
      expect(staleReads.map(({ status }) => status)).toEqual([
        `rejected`,
        `rejected`,
        `rejected`,
      ])
      expect(await currentV2.loadSubset(collectionId, {})).toMatchObject([
        { key: 2, value: { id: 2 } },
      ])
    } catch (error) {
      primaryFailure = error
    } finally {
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  it(`rejects cached collection-metadata reads after another adapter resets the schema`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    try {
      const driver = createDriver(database)
      const collectionId = `cached-schema-metadata-reader`
      const staleV1 = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 1,
      })
      await staleV1.applyCommittedTx(collectionId, {
        txId: `seed-v1`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [],
        collectionMetadataMutations: [
          { type: `set`, key: `cursor`, value: `v1` },
        ],
      })
      await staleV1.loadSubset(collectionId, {})

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
        mutations: [],
        collectionMetadataMutations: [
          { type: `set`, key: `cursor`, value: `v2` },
        ],
      })

      await expect(
        staleV1.loadCollectionMetadata(collectionId),
      ).rejects.toThrow(`Schema version mismatch`)
      expect(await currentV2.loadCollectionMetadata(collectionId)).toEqual([
        { key: `cursor`, value: `v2` },
      ])
    } catch (error) {
      primaryFailure = error
    } finally {
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  it(`rejects cached index lifecycle writes after another adapter resets the schema`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    try {
      const driver = createDriver(database)
      const collectionId = `cached-schema-index-writers`
      const staleV1 = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 1,
      })
      await staleV1.loadSubset(collectionId, {})

      const currentV2 = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 2,
      })
      await currentV2.loadSubset(collectionId, {})
      await currentV2.ensureIndex(collectionId, `v2-index`, {
        expressionSql: [`json_extract(value, '$.id')`],
      })

      const staleWrites = await Promise.allSettled([
        staleV1.ensureIndex(collectionId, `stale-v1-index`, {
          expressionSql: [`json_extract(value, '$.legacy')`],
        }),
        staleV1.markIndexRemoved(collectionId, `v2-index`),
      ])
      expect(staleWrites.map(({ status }) => status)).toEqual([
        `rejected`,
        `rejected`,
      ])

      const currentIndexes = await driver.query<{
        signature: string
        removed: number
      }>(
        `SELECT signature, removed
         FROM persisted_index_registry
         WHERE collection_id = ?
         ORDER BY signature`,
        [collectionId],
      )
      expect(currentIndexes).toEqual([{ signature: `v2-index`, removed: 0 }])
    } catch (error) {
      primaryFailure = error
    } finally {
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })
})

// The ordinary committed-transaction work law extends this SQLite owner.
runOrdinaryTransactionWorkOracle()

// The selected upgrade policy is an explicit schema reset. Frozen old bytes
// include an ordinary record that the new decoder would reinterpret as a tag.
// At the first new-schema read, this collection must be empty and all its old
// registry/physical indexes gone. Another collection must survive. Re-seeding
// then preserves the marker record, and a same-schema reopen must retain it.
// This reset/re-seed history does not claim lossless old-byte migration.
it(`resets ambiguous legacy values and obsolete indexes before reading a new schema`, async () => {
  const database = new DatabaseSync(`:memory:`)
  let primaryFailure: unknown
  try {
    const driver = createDriver(database)
    const collectionId = `legacy-marker-reset`
    const table = createPersistedTableName(collectionId, `c`)
    const old = new SQLiteCorePersistenceAdapter({ driver, schemaVersion: 1 })
    for (const id of [collectionId, `unrelated-cache`]) {
      await old.applyCommittedTx(id, {
        txId: `seed`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          { type: `insert`, key: `old`, value: { id: `old`, stamp: 1 } },
        ],
      })
      for (const signature of [
        `old-native-signature`,
        `current-native-signature`,
      ]) {
        await old.ensureIndex(id, signature, { expressionSql: [`row_version`] })
      }
    }
    const marker = {
      __tanstack_db_persisted_type__: `string`,
      value: `ordinary`,
    }
    database
      .prepare(`UPDATE "${table}" SET value = ?`)
      .run(JSON.stringify({ id: `old`, marker }))
    const indexes = database
      .prepare(
        `SELECT index_name FROM persisted_index_registry WHERE collection_id = ?`,
      )
      .all(collectionId) as Array<{ index_name: string }>
    expect(indexes).toHaveLength(2)
    const next = new SQLiteCorePersistenceAdapter({
      driver,
      schemaVersion: 2,
      schemaMismatchPolicy: `reset`,
    })
    expect(await next.loadSubset(collectionId, {})).toEqual([])
    expect(
      database
        .prepare(
          `SELECT * FROM persisted_index_registry WHERE collection_id = ?`,
        )
        .all(collectionId),
    ).toEqual([])
    for (const { index_name } of indexes) {
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
          )
          .all(index_name),
      ).toEqual([])
    }
    expect(
      database
        .prepare(
          `SELECT * FROM persisted_index_registry WHERE collection_id = ?`,
        )
        .all(`unrelated-cache`),
    ).toHaveLength(2)
    expect(
      (await old.loadSubset(`unrelated-cache`, {})).map(({ key }) => key),
    ).toEqual([`old`])
    await next.applyCommittedTx(collectionId, {
      txId: `reseed`,
      term: 2,
      seq: 1,
      rowVersion: 1,
      mutations: [{ type: `insert`, key: `new`, value: { id: `new`, marker } }],
    })
    await next.ensureIndex(collectionId, `replacement`, {
      expressionSql: [`row_version`],
    })
    const reopened = new SQLiteCorePersistenceAdapter({
      driver,
      schemaVersion: 2,
    })
    expect(
      (await reopened.loadSubset(collectionId, {})).map(({ value }) => value),
    ).toEqual([{ id: `new`, marker }])
    expect(
      database
        .prepare(
          `SELECT signature FROM persisted_index_registry WHERE collection_id = ?`,
        )
        .all(collectionId),
    ).toEqual([{ signature: `replacement` }])
  } catch (error) {
    primaryFailure = error
  } finally {
    closeDatabasePreservingPrimary(database, primaryFailure)
  }
})
