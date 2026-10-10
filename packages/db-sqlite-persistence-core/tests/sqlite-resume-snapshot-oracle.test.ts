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
  timeoutMs = 1_000,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Did not reach checkpoint: ${checkpoint}`)),
          timeoutMs,
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
  secondaryFailures: ReadonlyArray<unknown> = [],
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
    const cleanupFailures = [
      ...secondaryFailures,
      ...(cleanupFailure !== undefined ? [cleanupFailure] : []),
    ]
    if (cleanupFailures.length > 0) {
      Object.defineProperty(failure, `cleanupFailures`, {
        value: cleanupFailures,
        enumerable: true,
      })
    }
    throw failure
  }
  if (secondaryFailures.length === 0 && cleanupFailure !== undefined) {
    throw cleanupFailure
  }
  if (secondaryFailures.length > 0) {
    throw new AggregateError(
      [
        ...secondaryFailures,
        ...(cleanupFailure !== undefined ? [cleanupFailure] : []),
      ],
      `SQLite resume snapshot cleanup failed`,
    )
  }
}

async function observeCachedSchemaState(
  adapter: SQLiteCorePersistenceAdapter,
  driver: SQLiteDriver,
  collectionId: string,
): Promise<CachedSchemaState> {
  const snapshot = await adapter.loadResumeSnapshot({
    kind: `eager`,
    collectionId: collectionId,
  })
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
 * A managed cache claim must still be live inside the read transaction before
 * any generation-specific durable access. A claim expires at its expiry time;
 * a later-acquired live peer claim does not inherit the earlier claim's expiry.
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
 * uses a controlled clock and one shared real SQLite connection for claim races.
 * It does not claim native host execution or judge whether a consumer such as
 * Electric may use the certified cursor; those remain separate driver-contract
 * and Electric recovery owners. The work bound is a driver-call measure in
 * node:sqlite, not an elapsed-time or browser OPFS latency guarantee.
 */
describe(`SQLite resume snapshots`, () => {
  // A storage target states whether the caller owns an eager Collection or a
  // claimed cache generation. The independent rule is simple: collection of a
  // generation ends that claim's authority, so its target cannot read or write
  // even after SQLite removes the catalog row that identified the physical ID.
  // The same string may still name an eager Collection when the caller chooses
  // that target explicitly. This fixed history drives real SQLite through
  // claim, write, rotation, collection, and late adapter operations. At
  // each rejected-operation checkpoint, no old table or registry may reappear.
  it(`keeps a collected managed target from becoming eager storage`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    try {
      const adapter = new SQLiteCorePersistenceAdapter({
        driver: createDriver(database),
      })
      const claim = await adapter.claimCacheGeneration(
        `target-after-collection`,
      )
      const managed = {
        kind: `managed` as const,
        storageCollectionId: claim.storageCollectionId,
        claimId: claim.claimId,
      }
      const oldTable = createPersistedTableName(claim.storageCollectionId, `c`)
      const oldTombstones = createPersistedTableName(
        claim.storageCollectionId,
        `t`,
      )
      const footprint = () => {
        const catalog = [
          `collection_registry`,
          `persisted_index_registry`,
          `applied_tx`,
          `collection_version`,
          `collection_expected_keys`,
          `collection_metadata`,
          `leader_term`,
          `collection_reset_epoch`,
        ]
        return {
          tables: database
            .prepare(
              `SELECT name FROM sqlite_master WHERE name IN (?, ?) ORDER BY name`,
            )
            .all(oldTable, oldTombstones),
          catalog: catalog.map((table) => ({
            table,
            count: (
              database
                .prepare(
                  `SELECT COUNT(*) AS count FROM ${table} WHERE collection_id = ?`,
                )
                .get(claim.storageCollectionId) as { count: number }
            ).count,
          })),
          generations: database
            .prepare(`SELECT * FROM cache_generation WHERE physical_id = ?`)
            .all(claim.storageCollectionId),
          claims: database
            .prepare(
              `SELECT * FROM cache_generation_claim WHERE physical_id = ?`,
            )
            .all(claim.storageCollectionId),
        }
      }
      await adapter.applyCommittedTx(managed, {
        txId: `seed`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: `seed`, value: { id: `seed` } }],
      })
      expect((await adapter.loadResumeSnapshot(managed)).rows).toMatchObject([
        { key: `seed`, value: { id: `seed` } },
      ])
      await adapter.rotateCacheGeneration(
        `target-after-collection`,
        claim.claimId,
      )

      const collectedFootprint = footprint()
      expect(collectedFootprint.tables).toEqual([])
      expect(collectedFootprint.catalog.every(({ count }) => count === 0)).toBe(
        true,
      )
      expect(collectedFootprint.generations).toEqual([])
      expect(collectedFootprint.claims).toEqual([])
      // A JavaScript caller can still pass an old bare ID. It must not be
      // silently promoted to an eager target after the catalog row is gone.
      await expect(
        adapter.loadResumeSnapshot(claim.storageCollectionId as never),
      ).rejects.toThrow(`explicit eager or managed storage target`)
      await expect(
        adapter.applyCommittedTx(claim.storageCollectionId as never, {
          txId: `bare-late`,
          term: 2,
          seq: 1,
          rowVersion: 2,
          mutations: [{ type: `insert`, key: `bare`, value: { id: `bare` } }],
        }),
      ).rejects.toThrow(`explicit eager or managed storage target`)
      await expect(
        adapter.loadResumeSnapshot(`ordinary-bare-id` as never),
      ).rejects.toThrow(`explicit eager or managed storage target`)
      await expect(
        adapter.applyCommittedTx(`ordinary-bare-id` as never, {
          txId: `ordinary-bare`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [],
        }),
      ).rejects.toThrow(`explicit eager or managed storage target`)
      await expect(
        adapter.loadResumeSnapshot({
          kind: `managed`,
          storageCollectionId: claim.storageCollectionId,
        } as never),
      ).rejects.toThrow(
        `requires a storageCollectionId and persisted cache claim`,
      )
      await expect(
        adapter.loadResumeSnapshot({
          kind: `eager`,
          collectionId: claim.storageCollectionId,
          claimId: claim.claimId,
        } as never),
      ).rejects.toThrow(`cannot carry a persisted cache claim`)
      const lateTx = {
        txId: `late`,
        term: 2,
        seq: 1,
        rowVersion: 2,
        mutations: [
          { type: `insert` as const, key: `late`, value: { id: `late` } },
        ],
      }
      const lateOperations: Array<() => Promise<unknown>> = [
        () => adapter.loadSubset(managed, {}),
        () => adapter.loadResumeSnapshot(managed),
        () => adapter.loadCollectionMetadata(managed),
        () => adapter.scanRows(managed),
        () => adapter.getStreamPosition(managed),
        () => adapter.pullSince(managed, 0),
        () => adapter.applyCommittedTx(managed, lateTx),
        () =>
          adapter.reconcileCommittedTx(managed, lateTx, {
            latestRowVersion: 1,
            resetEpoch: 0,
          }),
        () =>
          adapter.ensureIndex(managed, `late-index`, {
            expressionSql: [`json_extract(value, '$.id')`],
          }),
        () => adapter.markIndexRemoved(managed, `late-index`),
        () => adapter.reserveLeadershipTerm(managed, 1),
      ]
      for (const operation of lateOperations) {
        await expect(operation()).rejects.toThrow(`no longer active`)
        expect(footprint()).toEqual(collectedFootprint)
      }
      const reopened = new SQLiteCorePersistenceAdapter({
        driver: createDriver(database),
      })
      await expect(reopened.loadResumeSnapshot(managed)).rejects.toThrow(
        `no longer active`,
      )
      await expect(reopened.applyCommittedTx(managed, lateTx)).rejects.toThrow(
        `no longer active`,
      )

      // Explicit eager reuse is a different legal operation with the same
      // bytes. The managed target's rejection must not reserve every prefix.
      const eager = {
        kind: `eager` as const,
        collectionId: claim.storageCollectionId,
      }
      await reopened.applyCommittedTx(eager, {
        txId: `eager`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: `eager`, value: { id: `eager` } }],
      })
      expect(
        (await reopened.loadResumeSnapshot(eager)).rows.map(({ key }) => key),
      ).toEqual([`eager`])
      await expect(reopened.loadResumeSnapshot(managed)).rejects.toThrow(
        `no longer active`,
      )
      await expect(reopened.applyCommittedTx(managed, lateTx)).rejects.toThrow(
        `no longer active`,
      )
      expect(
        (await reopened.loadResumeSnapshot(eager)).rows.map(({ key }) => key),
      ).toEqual([`eager`])
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

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
        await adapter.applyCommittedTx(
          { kind: `eager`, collectionId: collectionId },
          {
            txId: `eager-source`,
            term: 1,
            seq: 1,
            rowVersion: 1,
            mutations: [{ type: `insert`, key: row.id, value: row }],
          },
        )
        expect(
          (
            await adapter.loadResumeSnapshot({
              kind: `eager`,
              collectionId: collectionId,
            })
          ).rows.map(({ value }) => value),
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
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [{ type: `insert`, key: oldRow.id, value: oldRow }],
        },
      )

      const claim = await adapter.claimCacheGeneration(collectionId)
      expect(claim.storageCollectionId).not.toBe(collectionId)
      const warmClaim = await adapter.claimCacheGeneration(collectionId)
      expect(warmClaim.storageCollectionId).toBe(claim.storageCollectionId)
      const readClaimed = (storageId: string, claimId: string) =>
        adapter.loadResumeSnapshot(
          { kind: `managed`, storageCollectionId: storageId, claimId: claimId },
          {
            cacheGenerationClaimId: claimId,
          },
        )
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

      const oldSnapshot = await adapter.loadResumeSnapshot({
        kind: `eager`,
        collectionId: collectionId,
      })
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
        adapter.loadResumeSnapshot({
          kind: `eager`,
          collectionId: rotated.storageCollectionId,
        }),
      ).rejects.toThrow(`Persisted cache claim is required`)
      await expect(
        adapter.applyCommittedTx(
          { kind: `eager`, collectionId: rotated.storageCollectionId },
          {
            txId: `unclaimed-write`,
            term: 1,
            seq: 1,
            rowVersion: 1,
            mutations: [
              { type: `insert`, key: `unclaimed`, value: { id: `unclaimed` } },
            ],
          },
        ),
      ).rejects.toThrow(`Persisted cache claim is required`)
      expect(nextClaim.storageCollectionId).toBe(rotated.storageCollectionId)

      // An existing run keeps its old generation. Its source-backed writes
      // remain separate from the recovering run's new uncertified cache.
      await adapter.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: warmClaim.storageCollectionId,
          claimId: warmClaim.claimId,
        },
        {
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
        },
      )
      expect(
        (await readClaimed(rotated.storageCollectionId, rotated.claimId)).rows,
      ).toEqual([])

      // A writer from the previous library version knows only the public
      // Collection ID. It may still change that legacy cache, but it cannot
      // change either new-format generation or add rows to the current one.
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
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
        },
      )
      expect(
        (await readClaimed(rotated.storageCollectionId, rotated.claimId)).rows,
      ).toEqual([])
      await expect(
        adapter.applyCommittedTx(
          { kind: `eager`, collectionId: rotated.storageCollectionId },
          {
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
          },
        ),
      ).rejects.toThrow(`Persisted cache claim is required`)
      const freshRow = { id: `fresh`, title: `Demanded source row` }
      await adapter.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: rotated.storageCollectionId,
          claimId: claim.claimId,
        },
        {
          txId: `fresh-subset-write`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: claim.claimId,
          mutations: [{ type: `insert`, key: freshRow.id, value: freshRow }],
        },
      )
      const partialSnapshot = await readClaimed(
        rotated.storageCollectionId,
        rotated.claimId,
      )
      expect(partialSnapshot.rows.map(({ value }) => value)).toEqual([freshRow])
      expect(partialSnapshot.keySet).toEqual({ status: `incompatible` })

      await expect(
        adapter.applyCommittedTx(
          {
            kind: `managed`,
            storageCollectionId: claim.storageCollectionId,
            claimId: claim.claimId,
          },
          {
            txId: `late-old-write`,
            term: 1,
            seq: 2,
            rowVersion: 2,
            cacheGenerationClaimId: claim.claimId,
            mutations: [
              {
                type: `insert`,
                key: `late`,
                value: {
                  id: `late`,
                  title: `Must stay outside new generation`,
                },
              },
            ],
          },
        ),
      ).rejects.toThrow(`Persisted cache claim`)

      // A complete replacement can certify the new head for later runs.
      // A warm run still claiming the old generation may itself lose source
      // authority, but that loss says nothing about the certified head. Its
      // replacement must stay private to that run instead of retiring the
      // other run's valid cache.
      await adapter.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: rotated.storageCollectionId,
          claimId: claim.claimId,
        },
        {
          txId: `certify-new-head`,
          term: 1,
          seq: 2,
          rowVersion: 2,
          cacheGenerationClaimId: claim.claimId,
          truncate: true,
          mutations: [{ type: `insert`, key: freshRow.id, value: freshRow }],
        },
      )
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
      await adapter.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: secondRecovery.storageCollectionId,
          claimId: warmClaim.claimId,
        },
        {
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
        },
      )
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
        adapter.loadResumeSnapshot(
          {
            kind: `managed`,
            storageCollectionId: thirdRecovery.storageCollectionId,
            claimId: claim.claimId,
          },
          {
            cacheGenerationClaimId: claim.claimId,
          },
        ),
      ).rejects.toThrow(`Persisted cache claim`)
      await expect(
        adapter.loadSubset(
          {
            kind: `managed`,
            storageCollectionId: thirdRecovery.storageCollectionId,
            claimId: claim.claimId,
          },
          {},
          {
            cacheGenerationClaimId: claim.claimId,
          },
        ),
      ).rejects.toThrow(`Persisted cache claim`)
      await expect(
        adapter.scanRows(
          {
            kind: `managed`,
            storageCollectionId: thirdRecovery.storageCollectionId,
            claimId: claim.claimId,
          },
          undefined,
          {
            cacheGenerationClaimId: claim.claimId,
          },
        ),
      ).rejects.toThrow(`Persisted cache claim`)
      await expect(
        adapter.loadCollectionMetadata(
          {
            kind: `managed`,
            storageCollectionId: thirdRecovery.storageCollectionId,
            claimId: claim.claimId,
          },
          {
            cacheGenerationClaimId: claim.claimId,
          },
        ),
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
      await writer.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: claim.storageCollectionId,
          claimId: claim.claimId,
        },
        {
          txId: `seed-row`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: claim.claimId,
          mutations: [{ type: `insert`, key: `row`, value: { id: `row` } }],
        },
      )
      holdRegistration = true
      read = reader.loadResumeSnapshot(
        {
          kind: `managed`,
          storageCollectionId: claim.storageCollectionId,
          claimId: claim.claimId,
        },
        {
          cacheGenerationClaimId: claim.claimId,
        },
      )
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
      await adapter.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: first.storageCollectionId,
          claimId: first.claimId,
        },
        {
          txId: `old-row`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: first.claimId,
          mutations: [{ type: `insert`, key: `old`, value: { id: `old` } }],
        },
      )
      const current = await adapter.rotateCacheGeneration(
        logicalId,
        first.claimId,
      )
      await adapter.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: current.storageCollectionId,
          claimId: current.claimId,
        },
        {
          txId: `current-row`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: current.claimId,
          mutations: [
            { type: `insert`, key: `current`, value: { id: `current` } },
          ],
        },
      )
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
          await adapter.loadResumeSnapshot(
            {
              kind: `managed`,
              storageCollectionId: current.storageCollectionId,
              claimId: current.claimId,
            },
            {
              cacheGenerationClaimId: current.claimId,
            },
          )
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

  // Retired storage is reachable from live cache claims; the current head is
  // always reachable even after its last claim expires. The independent model
  // treats release as removal and expiry as a half-open time cut. A collection
  // operation is the GC checkpoint: wall-clock passage alone does no SQLite
  // work. The bounded grammar makes three generations, varies zero/two rows,
  // and independently releases, expires, or renews claims on both retired
  // generations. Cuts immediately before and at each renewed expiry enforce
  // half-open claim lifetimes. It excludes concurrent writes and a fourth
  // rotation. The comparison checks exact retained row, tombstone, resume,
  // and key contents; physical tables and native indexes; every
  // generation-scoped catalog; and surviving claim identities.
  type RetiredStorageHistory = {
    oldClaim: `release` | `expire` | `renew`
    middleClaim: `release` | `expire` | `renew`
    rowCount: 0 | 2
    checkAtMs: 1_170 | 1_190 | 1_209 | 1_210 | 1_229 | 1_230
  }
  const expectedRetainedGenerations = (
    history: RetiredStorageHistory,
  ): ReadonlyArray<number> => [
    ...(history.oldClaim === `renew` && history.checkAtMs < 1_210 ? [0] : []),
    ...(history.middleClaim === `renew` && history.checkAtMs < 1_230
      ? [1]
      : []),
    2,
  ]
  const assertRetiredStorageHistory = async (
    history: RetiredStorageHistory,
  ): Promise<void> => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    let now = 1_000
    try {
      const adapter = new SQLiteCorePersistenceAdapter({
        driver: createDriver(database),
        cacheGenerationClaimTtlMs: 100,
        now: () => now,
      })
      const logicalId = `bounded-retired-storage`
      const first = await adapter.claimCacheGeneration(logicalId)
      now = 1_020
      const oldPeer = await adapter.claimCacheGeneration(logicalId)
      const generations = [first]
      const seedStorage = async (
        generation: number,
        claim: typeof first,
      ): Promise<string> => {
        const rows = Array.from({ length: history.rowCount }, (_, index) => ({
          id: `g${generation}-row-${index}`,
        }))
        await adapter.applyCommittedTx(
          {
            kind: `managed`,
            storageCollectionId: claim.storageCollectionId,
            claimId: claim.claimId,
          },
          {
            txId: `g${generation}-seed`,
            term: generation + 1,
            seq: 1,
            rowVersion: 1,
            cacheGenerationClaimId: claim.claimId,
            truncate: true,
            mutations: [
              ...rows.map((row) => ({
                type: `insert` as const,
                key: row.id,
                value: row,
              })),
              {
                type: `delete` as const,
                key: `g${generation}-gone`,
                value: { id: `g${generation}-gone` },
              },
            ],
            collectionMetadataMutations: [
              { type: `set`, key: `resume`, value: `g${generation}-cursor` },
            ],
          },
        )
        const signature = `g${generation}-index`
        await adapter.ensureIndex(
          {
            kind: `managed`,
            storageCollectionId: claim.storageCollectionId,
            claimId: claim.claimId,
          },
          signature,
          { expressionSql: [`row_version`] },
          { cacheGenerationClaimId: claim.claimId },
        )
        const index = database
          .prepare(
            `SELECT index_name FROM persisted_index_registry
             WHERE collection_id = ? AND signature = ?`,
          )
          .get(claim.storageCollectionId, signature) as { index_name: string }
        return index.index_name
      }
      const indexes = [await seedStorage(0, first)]
      const seededContents: Array<{
        rows: Array<Record<string, unknown>>
        tombstones: Array<Record<string, unknown>>
        metadata: Array<Record<string, unknown>>
        expectedKeys: Array<Record<string, unknown>>
      }> = []
      const captureContents = (physicalId: string) => ({
        rows: database
          .prepare(
            `SELECT key, value, metadata, row_version FROM "${createPersistedTableName(physicalId, `c`)}" ORDER BY key`,
          )
          .all() as Array<Record<string, unknown>>,
        tombstones: database
          .prepare(
            `SELECT key, value, row_version, deleted_at FROM "${createPersistedTableName(physicalId, `t`)}" ORDER BY key`,
          )
          .all() as Array<Record<string, unknown>>,
        metadata: database
          .prepare(
            `SELECT key, value FROM collection_metadata WHERE collection_id = ? ORDER BY key`,
          )
          .all(physicalId) as Array<Record<string, unknown>>,
        expectedKeys: database
          .prepare(
            `SELECT key FROM collection_expected_keys WHERE collection_id = ? ORDER BY key`,
          )
          .all(physicalId) as Array<Record<string, unknown>>,
      })
      seededContents.push(captureContents(first.storageCollectionId))
      now = 1_040
      const middle = await adapter.rotateCacheGeneration(
        logicalId,
        first.claimId,
      )
      generations.push(middle)
      now = 1_060
      const middlePeer = await adapter.claimCacheGeneration(logicalId)
      indexes.push(await seedStorage(1, middle))
      seededContents.push(captureContents(middle.storageCollectionId))
      now = 1_080
      const current = await adapter.rotateCacheGeneration(
        logicalId,
        middle.claimId,
      )
      generations.push(current)
      indexes.push(await seedStorage(2, current))
      seededContents.push(captureContents(current.storageCollectionId))

      now = 1_110
      if (history.oldClaim === `release`) {
        await adapter.releaseCacheGenerationClaim(oldPeer.claimId)
      } else if (history.oldClaim === `renew`) {
        expect(
          await adapter.renewCacheGenerationClaim(
            oldPeer.storageCollectionId,
            oldPeer.claimId,
          ),
        ).toBe(1_210)
      }
      now = 1_130
      if (history.middleClaim === `release`) {
        await adapter.releaseCacheGenerationClaim(middlePeer.claimId)
      } else if (history.middleClaim === `renew`) {
        expect(
          await adapter.renewCacheGenerationClaim(
            middlePeer.storageCollectionId,
            middlePeer.claimId,
          ),
        ).toBe(1_230)
      }
      now = history.checkAtMs
      // Any collection operation may sweep. The new claim also proves that
      // collection of retired storage cannot displace the current head.
      const checkpointClaim = await adapter.claimCacheGeneration(logicalId)
      expect(checkpointClaim.storageCollectionId).toBe(
        current.storageCollectionId,
      )
      const retained = new Set(expectedRetainedGenerations(history))
      const expectedClaims = [
        ...(history.oldClaim === `renew` && now < 1_210
          ? [
              {
                claimId: oldPeer.claimId,
                physicalId: first.storageCollectionId,
              },
            ]
          : []),
        ...(history.middleClaim === `renew` && now < 1_230
          ? [
              {
                claimId: middlePeer.claimId,
                physicalId: middle.storageCollectionId,
              },
            ]
          : []),
        ...(now < 1_180
          ? [
              {
                claimId: current.claimId,
                physicalId: current.storageCollectionId,
              },
            ]
          : []),
        {
          claimId: checkpointClaim.claimId,
          physicalId: current.storageCollectionId,
        },
      ].sort((left, right) => left.claimId.localeCompare(right.claimId))
      const actualClaims = database
        .prepare(
          `SELECT claim_id AS claimId, physical_id AS physicalId
           FROM cache_generation_claim WHERE logical_id = ? ORDER BY claim_id`,
        )
        .all(logicalId)
      expect(actualClaims).toEqual(expectedClaims)
      const scopedCatalogs = [
        `cache_generation`,
        `collection_registry`,
        `collection_version`,
        `collection_reset_epoch`,
        `applied_tx`,
        `collection_metadata`,
        `collection_expected_keys`,
        `persisted_index_registry`,
        `leader_term`,
      ]
      for (const [generation, claim] of generations.entries()) {
        const physicalId = claim.storageCollectionId
        const shouldExist = retained.has(generation)
        const rowTable = createPersistedTableName(physicalId, `c`)
        const tombstoneTable = createPersistedTableName(physicalId, `t`)
        for (const name of [
          rowTable,
          tombstoneTable,
          `${rowTable}_row_version_idx`,
          `${tombstoneTable}_row_version_idx`,
          indexes[generation]!,
        ]) {
          expect(
            database
              .prepare(`SELECT name FROM sqlite_master WHERE name = ?`)
              .get(name),
            `generation ${generation}: physical ${name}`,
          ).toEqual(shouldExist ? { name } : undefined)
        }
        for (const catalog of scopedCatalogs) {
          const column =
            catalog === `cache_generation` ? `physical_id` : `collection_id`
          const count = database
            .prepare(
              `SELECT COUNT(*) AS count FROM ${catalog} WHERE ${column} = ?`,
            )
            .get(physicalId) as { count: number }
          expect(count.count, `generation ${generation}: ${catalog}`).toBe(
            shouldExist
              ? catalog === `collection_expected_keys`
                ? history.rowCount
                : 1
              : 0,
          )
        }
        if (shouldExist) {
          expect(captureContents(physicalId)).toEqual(
            seededContents[generation],
          )
        }
      }
      await adapter.releaseCacheGenerationClaim(checkpointClaim.claimId)
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  }
  it.each([
    { oldClaim: `renew`, middleClaim: `renew`, rowCount: 2, checkAtMs: 1_170 },
    {
      oldClaim: `release`,
      middleClaim: `renew`,
      rowCount: 0,
      checkAtMs: 1_170,
    },
    {
      oldClaim: `renew`,
      middleClaim: `release`,
      rowCount: 2,
      checkAtMs: 1_190,
    },
    {
      oldClaim: `expire`,
      middleClaim: `expire`,
      rowCount: 0,
      checkAtMs: 1_190,
    },
    { oldClaim: `renew`, middleClaim: `renew`, rowCount: 2, checkAtMs: 1_209 },
    { oldClaim: `renew`, middleClaim: `renew`, rowCount: 2, checkAtMs: 1_210 },
    { oldClaim: `renew`, middleClaim: `renew`, rowCount: 2, checkAtMs: 1_229 },
    { oldClaim: `renew`, middleClaim: `renew`, rowCount: 2, checkAtMs: 1_230 },
  ] as const)(
    `collects only unclaimed retired storage after $oldClaim and $middleClaim`,
    assertRetiredStorageHistory,
  )
  const retiredStorageHistory = fc.record({
    oldClaim: fc.constantFrom<RetiredStorageHistory[`oldClaim`]>(
      `release`,
      `expire`,
      `renew`,
    ),
    middleClaim: fc.constantFrom<RetiredStorageHistory[`middleClaim`]>(
      `release`,
      `expire`,
      `renew`,
    ),
    rowCount: fc.constantFrom<RetiredStorageHistory[`rowCount`]>(0, 2),
    checkAtMs: fc.constantFrom<RetiredStorageHistory[`checkAtMs`]>(
      1_170,
      1_190,
      1_209,
      1_210,
      1_229,
      1_230,
    ),
  })
  fcTest.prop([retiredStorageHistory], {
    seed: 2069,
    numRuns: oracleRuns(24),
  })(`checks retired storage reachability (fixed)`, assertRetiredStorageHistory)
  fcTest.prop(
    [retiredStorageHistory],
    oraclePropertyOptions(24, `sqlite-resume.retired-storage`),
  )(
    `checks retired storage reachability (random or replayed)`,
    assertRetiredStorageHistory,
  )

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
      await writer.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: rotating.storageCollectionId,
          claimId: rotating.claimId,
        },
        {
          txId: `old`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: rotating.claimId,
          mutations: [{ type: `insert`, key: `old`, value: { id: `old` } }],
        },
      )
      await writer.rotateCacheGeneration(logicalId, rotating.claimId)
      holdCreate = true
      read = reader.loadResumeSnapshot(
        {
          kind: `managed`,
          storageCollectionId: rotating.storageCollectionId,
          claimId: warm.claimId,
        },
        {
          cacheGenerationClaimId: warm.claimId,
        },
      )
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
      await writer.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: rotating.storageCollectionId,
          claimId: rotating.claimId,
        },
        {
          txId: `old`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: rotating.claimId,
          mutations: [{ type: `insert`, key: `old`, value: { id: `old` } }],
        },
      )
      await writer.rotateCacheGeneration(logicalId, rotating.claimId)
      const oldTable = createPersistedTableName(
        rotating.storageCollectionId,
        `c`,
      )
      holdLookup = true
      read = reader.loadResumeSnapshot(
        {
          kind: `managed`,
          storageCollectionId: rotating.storageCollectionId,
          claimId: warm.claimId,
        },
        {
          cacheGenerationClaimId: warm.claimId,
        },
      )
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

  // A claim moved to a new physical generation no longer authorizes schema
  // reset in the old one. The other run's live claim retains its old rows and
  // metadata even when the stale run entered registration while its claim was
  // valid. This authored two-run history pauses the real adapter's registry
  // lookup, moves only one claim, then compares the remaining run's durable
  // schema, row, transaction ID, and reset epoch after the stale read rejects.
  it(`preserves a warm generation when a stale registration would reset its schema`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    const driver = createDriver(database)
    const registrationEntered = deferred()
    const releaseRegistration = deferred()
    let holdRegistration = false
    const gatedDriver: SQLiteDriver = {
      ...driver,
      query: async (sql, params) => {
        if (
          holdRegistration &&
          sql.includes(`SELECT table_name,`) &&
          sql.includes(`FROM collection_registry`)
        ) {
          holdRegistration = false
          registrationEntered.resolve()
          await releaseRegistration.promise
        }
        return driver.query(sql, params)
      },
    }
    const writer = new SQLiteCorePersistenceAdapter({
      driver,
      schemaVersion: 1,
    })
    const staleReader = new SQLiteCorePersistenceAdapter({
      driver: gatedDriver,
      schemaVersion: 2,
      schemaMismatchPolicy: `sync-present-reset`,
    })
    let read: ReturnType<typeof staleReader.loadResumeSnapshot> | undefined
    try {
      const logicalId = `stale-schema-reset`
      const moving = await writer.claimCacheGeneration(logicalId)
      const warm = await writer.claimCacheGeneration(logicalId)
      const oldId = moving.storageCollectionId
      const oldTable = createPersistedTableName(oldId, `c`)
      await writer.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: oldId,
          claimId: moving.claimId,
        },
        {
          txId: `warm-row`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: moving.claimId,
          mutations: [{ type: `insert`, key: `row`, value: { id: `row` } }],
        },
      )

      holdRegistration = true
      read = staleReader.loadResumeSnapshot(
        {
          kind: `managed`,
          storageCollectionId: oldId,
          claimId: moving.claimId,
        },
        {
          cacheGenerationClaimId: moving.claimId,
        },
      )
      void read.catch(() => undefined)
      await reachCheckpoint(
        registrationEntered.promise,
        `stale registry lookup`,
      )
      const current = await writer.rotateCacheGeneration(
        logicalId,
        moving.claimId,
      )
      expect(current.storageCollectionId).not.toBe(oldId)
      releaseRegistration.resolve()
      await expect(read).rejects.toThrow(`Persisted cache claim`)

      expect(
        database
          .prepare(
            `SELECT schema_version FROM collection_registry WHERE collection_id = ?`,
          )
          .get(oldId),
      ).toEqual({ schema_version: 1 })
      expect(database.prepare(`SELECT key FROM "${oldTable}"`).all()).toEqual([
        { key: encodePersistedStorageKey(`row`) },
      ])
      expect(
        database
          .prepare(`SELECT tx_id FROM applied_tx WHERE collection_id = ?`)
          .all(oldId),
      ).toEqual([{ tx_id: `warm-row` }])
      expect(
        database
          .prepare(
            `SELECT reset_epoch FROM collection_reset_epoch WHERE collection_id = ?`,
          )
          .get(oldId),
      ).toEqual({ reset_epoch: 0 })
      expect(
        (
          await writer.loadResumeSnapshot(
            {
              kind: `managed`,
              storageCollectionId: oldId,
              claimId: warm.claimId,
            },
            {
              cacheGenerationClaimId: warm.claimId,
            },
          )
        ).rows.map(({ key }) => key),
      ).toEqual([`row`])
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      releaseRegistration.resolve()
      await Promise.allSettled([read])
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  })

  // A fresh rotated generation can contain resume metadata before its first
  // table registration. If one claim moves during that first lookup, the
  // former claimant cannot choose the old generation's schema. Otherwise the
  // remaining run's next read treats the unauthorized schema as a mismatch
  // and deletes its resume metadata. The model retains that metadata through
  // the stale rejection and the warm run's subsequent read.
  it(`preserves a warm generation's resume metadata across stale first registration`, async () => {
    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    const driver = createDriver(database)
    const registrationEntered = deferred()
    const releaseRegistration = deferred()
    let holdRegistration = false
    const gatedDriver: SQLiteDriver = {
      ...driver,
      query: async (sql, params) => {
        if (
          holdRegistration &&
          sql.includes(`SELECT table_name,`) &&
          sql.includes(`FROM collection_registry`)
        ) {
          holdRegistration = false
          registrationEntered.resolve()
          await releaseRegistration.promise
        }
        return driver.query(sql, params)
      },
    }
    const writer = new SQLiteCorePersistenceAdapter({
      driver,
      schemaVersion: 1,
    })
    const staleReader = new SQLiteCorePersistenceAdapter({
      driver: gatedDriver,
      schemaVersion: 2,
      schemaMismatchPolicy: `sync-present-reset`,
    })
    let read: ReturnType<typeof staleReader.loadResumeSnapshot> | undefined
    try {
      const logicalId = `stale-first-registration`
      const first = await writer.claimCacheGeneration(logicalId)
      const moving = await writer.rotateCacheGeneration(
        logicalId,
        first.claimId,
        { key: `resume`, value: `must-survive` },
      )
      const warm = await writer.claimCacheGeneration(logicalId)
      const oldId = moving.storageCollectionId

      holdRegistration = true
      read = staleReader.loadResumeSnapshot(
        {
          kind: `managed`,
          storageCollectionId: oldId,
          claimId: moving.claimId,
        },
        {
          cacheGenerationClaimId: moving.claimId,
        },
      )
      void read.catch(() => undefined)
      await reachCheckpoint(
        registrationEntered.promise,
        `first registry lookup`,
      )
      const current = await writer.rotateCacheGeneration(
        logicalId,
        moving.claimId,
      )
      expect(current.storageCollectionId).not.toBe(oldId)
      releaseRegistration.resolve()
      await expect(read).rejects.toThrow(`Persisted cache claim`)

      expect(
        database
          .prepare(
            `SELECT schema_version FROM collection_registry WHERE collection_id = ?`,
          )
          .get(oldId),
      ).toBeUndefined()
      expect(
        (
          await writer.loadResumeSnapshot(
            {
              kind: `managed`,
              storageCollectionId: oldId,
              claimId: warm.claimId,
            },
            {
              cacheGenerationClaimId: warm.claimId,
            },
          )
        ).collectionMetadata,
      ).toEqual([{ key: `resume`, value: `must-survive` }])
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      releaseRegistration.resolve()
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
      await adapter.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: old.storageCollectionId,
          claimId: old.claimId,
        },
        {
          txId: `old`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: old.claimId,
          mutations: [{ type: `insert`, key: `old`, value: { id: `old` } }],
        },
      )
      const head = await adapter.rotateCacheGeneration(logicalId, old.claimId)
      const headTable = createPersistedTableName(head.storageCollectionId, `c`)
      await adapter.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: head.storageCollectionId,
          claimId: head.claimId,
        },
        {
          txId: `head`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: head.claimId,
          mutations: [{ type: `insert`, key: `head`, value: { id: `head` } }],
        },
      )
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
        adapter.loadResumeSnapshot(
          {
            kind: `managed`,
            storageCollectionId: old.storageCollectionId,
            claimId: paused.claimId,
          },
          {
            cacheGenerationClaimId: paused.claimId,
          },
        ),
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
      await adapter.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: privateRecovery.storageCollectionId,
          claimId: privateRecovery.claimId,
        },
        {
          txId: `fresh-subset`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: privateRecovery.claimId,
          mutations: [{ type: `insert`, key: `fresh`, value: { id: `fresh` } }],
        },
      )
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
            {
              kind: `managed`,
              storageCollectionId: privateRecovery.storageCollectionId,
              claimId: privateRecovery.claimId,
            },
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
      await adapter.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: old.storageCollectionId,
          claimId: old.claimId,
        },
        {
          txId: `old`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: old.claimId,
          mutations: [{ type: `insert`, key: `old`, value: { id: `old` } }],
        },
      )
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
          await adapter.loadResumeSnapshot(
            {
              kind: `managed`,
              storageCollectionId: next.storageCollectionId,
              claimId: next.claimId,
            },
            {
              cacheGenerationClaimId: next.claimId,
            },
          )
        ).rows.map(({ key }) => key),
      ).toEqual([`old`])
      await expect(
        adapter.loadResumeSnapshot(
          {
            kind: `managed`,
            storageCollectionId: old.storageCollectionId,
            claimId: old.claimId,
          },
          {
            cacheGenerationClaimId: old.claimId,
          },
        ),
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

  // Scoped recovery may start rotation while this run still owns the current
  // cache, then its claim may expire before SQLite decides ownership.
  // The independent rule uses authority at the rotation transaction: the
  // recovering run gets private empty storage, while a live peer and future
  // claimants retain the original head. This history holds the real adapter's
  // rotation before its transaction, then crosses expiry. After a fresh subset
  // load settles, public rows and both claimed SQLite snapshots must match
  // those two independent storage routes. An empty source subset cannot make
  // the recovering run's old cached row authoritative again. The
  // controlled source supplies the recovery decision; provider classification
  // of malformed metadata is a separate receiving obligation.
  it(`keeps a warm peer's cache when scoped recovery crosses claim expiry`, async () => {
    type Row = { id: string; title: string }
    const database = new DatabaseSync(`:memory:`)
    const logicalId = `resume-loss-then-expiry`
    let now = Date.now()
    const adapter = new SQLiteCorePersistenceAdapter({
      driver: createDriver(database),
      cacheGenerationClaimTtlMs: 10_000,
      now: () => now,
    })
    const rotationEntered = deferred()
    const releaseRotation = deferred()
    const rotate = adapter.rotateCacheGeneration.bind(adapter)
    adapter.rotateCacheGeneration = async (...args) => {
      rotationEntered.resolve()
      await releaseRotation.promise
      return rotate(...args)
    }
    const oldRow: Row = { id: `old`, title: `Warm cached row` }
    const freshRow: Row = { id: `fresh`, title: `Fresh source row` }
    const warmResume = {
      kind: `resume`,
      requiresTagState: false,
      offset: `10_0`,
      handle: `warm-handle`,
      shapeId: `warm-shape`,
      updatedAt: 1,
    }
    const resetMarker = { kind: `reset`, updatedAt: 2 }
    let recoveringSource: Parameters<SyncConfig<Row, string>[`sync`]>[0]
    let freshDemand = false
    const recoveringStarted = deferred()
    const warmStarted = deferred()
    const createPeer = (recovering: boolean) =>
      createCollection(
        persistedCollectionOptions<Row, string>({
          id: logicalId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (source) => {
              if (recovering) recoveringSource = source
              source.markReady()
              if (recovering) recoveringStarted.resolve()
              else warmStarted.resolve()
              return {
                restartAfterScopedRecovery: () => {},
                loadSubset: async () => {
                  if (recovering && freshDemand) {
                    source.begin()
                    source.write({ type: `insert`, value: freshRow })
                    await source.commit()
                  }
                },
              }
            },
          },
          persistence: { adapter },
        }),
      )
    let recovering: Collection<Row, string> | undefined
    let warm: Collection<Row, string> | undefined
    let recovery: Promise<void> | undefined
    let laterClaimId: string | undefined
    let primaryFailure: unknown
    try {
      const seed = await adapter.claimCacheGeneration(logicalId)
      await adapter.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: seed.storageCollectionId,
          claimId: seed.claimId,
        },
        {
          txId: `old-source-row`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: seed.claimId,
          mutations: [{ type: `insert`, key: oldRow.id, value: oldRow }],
          collectionMetadataMutations: [
            { type: `set`, key: `electric:resume`, value: warmResume },
          ],
        },
      )
      await adapter.releaseCacheGenerationClaim(seed.claimId)

      recovering = createPeer(true)
      recovering.startSyncImmediate()
      await reachCheckpoint(
        recoveringStarted.promise,
        `recovering source start`,
      )
      const initialClaim = database
        .prepare(
          `SELECT claim_id, physical_id, expires_at_ms
           FROM cache_generation_claim WHERE logical_id = ?`,
        )
        .get(logicalId) as {
        claim_id: string
        physical_id: string
        expires_at_ms: number
      }
      warm = createPeer(false)
      warm.startSyncImmediate()
      await reachCheckpoint(warmStarted.promise, `warm source start`)
      await warm._sync.loadSubset({})
      expect(warm.get(oldRow.id)).toMatchObject(oldRow)
      const warmClaim = database
        .prepare(
          `SELECT claim_id, physical_id FROM cache_generation_claim
           WHERE logical_id = ? AND claim_id <> ?`,
        )
        .get(logicalId, initialClaim.claim_id) as {
        claim_id: string
        physical_id: string
      }
      expect(warmClaim.physical_id).toBe(initialClaim.physical_id)

      now += 9_000
      const warmExpiresAt = await adapter.renewCacheGenerationClaim(
        warmClaim.physical_id,
        warmClaim.claim_id,
      )
      expect(warmExpiresAt).toBeGreaterThan(initialClaim.expires_at_ms)
      recovery = recoveringSource!.metadata!.persistence!.startScopedRecovery!({
        key: `electric:resume`,
        value: resetMarker,
      })
      void recovery.catch(() => undefined)
      await reachCheckpoint(rotationEntered.promise, `held cache rotation`)
      now += 2_000
      expect(now).toBeGreaterThan(initialClaim.expires_at_ms)
      expect(now).toBeLessThan(warmExpiresAt!)
      releaseRotation.resolve()
      await reachCheckpoint(recovery, `private scoped recovery`)

      const recoveringClaim = database
        .prepare(
          `SELECT physical_id FROM cache_generation_claim WHERE claim_id = ?`,
        )
        .get(initialClaim.claim_id) as { physical_id: string }
      const head = database
        .prepare(
          `SELECT physical_id FROM cache_generation
           WHERE logical_id = ? AND retired = 0`,
        )
        .get(logicalId) as { physical_id: string }
      expect(recoveringClaim.physical_id).not.toBe(initialClaim.physical_id)
      expect(head.physical_id).toBe(initialClaim.physical_id)

      await recovering._sync.loadSubset({})
      expect(Array.from(recovering.values())).toEqual([])
      expect(
        (
          await adapter.loadResumeSnapshot(
            {
              kind: `managed`,
              storageCollectionId: recoveringClaim.physical_id,
              claimId: initialClaim.claim_id,
            },
            {
              cacheGenerationClaimId: initialClaim.claim_id,
            },
          )
        ).rows,
      ).toEqual([])

      freshDemand = true
      await recovering._sync.loadSubset({})
      const laterClaim = await adapter.claimCacheGeneration(logicalId)
      laterClaimId = laterClaim.claimId
      expect(laterClaim.storageCollectionId).toBe(initialClaim.physical_id)
      expect(Array.from(recovering.values(), ({ id }) => id)).toEqual([
        freshRow.id,
      ])
      expect(Array.from(warm.values(), ({ id }) => id)).toEqual([oldRow.id])
      const privateSnapshot = await adapter.loadResumeSnapshot(
        {
          kind: `managed`,
          storageCollectionId: recoveringClaim.physical_id,
          claimId: initialClaim.claim_id,
        },
        { cacheGenerationClaimId: initialClaim.claim_id },
      )
      const warmSnapshot = await adapter.loadResumeSnapshot(
        {
          kind: `managed`,
          storageCollectionId: warmClaim.physical_id,
          claimId: warmClaim.claim_id,
        },
        { cacheGenerationClaimId: warmClaim.claim_id },
      )
      expect(privateSnapshot.rows.map(({ key }) => key)).toEqual([freshRow.id])
      expect(privateSnapshot.collectionMetadata).toEqual([
        { key: `electric:resume`, value: resetMarker },
      ])
      expect(warmSnapshot.rows.map(({ key }) => key)).toEqual([oldRow.id])
      expect(warmSnapshot.collectionMetadata).toEqual([
        { key: `electric:resume`, value: warmResume },
      ])
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      releaseRotation.resolve()
      const cleanupFailures: Array<unknown> = []
      const cleanupTimeoutMs = primaryFailure === undefined ? 1_000 : 200
      if (recovery) {
        try {
          await reachCheckpoint(recovery, `recovery cleanup`, cleanupTimeoutMs)
        } catch (error) {
          cleanupFailures.push(error)
        }
      }
      for (const release of [
        () => recovering?.cleanup(),
        () => warm?.cleanup(),
        () =>
          laterClaimId
            ? adapter.releaseCacheGenerationClaim(laterClaimId)
            : undefined,
      ]) {
        try {
          const settling = release()
          if (settling) {
            await reachCheckpoint(settling, `peer cleanup`, cleanupTimeoutMs)
          }
        } catch (error) {
          cleanupFailures.push(error)
        }
      }
      closeDatabasePreservingPrimary(database, primaryFailure, cleanupFailures)
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
      const claimTarget = {
        kind: `managed` as const,
        storageCollectionId: id,
        claimId: claim.claimId,
      }
      await adapter.applyCommittedTx(
        { kind: `managed`, storageCollectionId: id, claimId: claim.claimId },
        {
          txId: `seed`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: claim.claimId,
          mutations: [{ type: `insert`, key: `row`, value: { id: `row` } }],
        },
      )
      await adapter.ensureIndex(
        claimTarget,
        `existing`,
        { expressionSql: [`json_extract(value, '$.id')`] },
        claimCtx,
      )
      now = 1_050
      const peer = await adapter.claimCacheGeneration(`coordinator-claim`)
      const peerCtx = { cacheGenerationClaimId: peer.claimId }
      const peerTarget = {
        kind: `managed` as const,
        storageCollectionId: id,
        claimId: peer.claimId,
      }
      now = 1_101
      expect(adapter.getCacheGenerationNow()).toBe(now)
      await expect(
        adapter.getStreamPosition(claimTarget, claimCtx),
      ).rejects.toThrow(`Persisted cache claim`)
      await expect(adapter.pullSince(claimTarget, 0, claimCtx)).rejects.toThrow(
        `Persisted cache claim`,
      )
      await expect(
        adapter.ensureIndex(
          claimTarget,
          `late`,
          { expressionSql: [`json_extract(value, '$.id')`] },
          claimCtx,
        ),
      ).rejects.toThrow(`Persisted cache claim`)
      await expect(
        adapter.markIndexRemoved(claimTarget, `existing`, claimCtx),
      ).rejects.toThrow(`Persisted cache claim`)
      await expect(
        adapter.getStreamPosition({ kind: `eager`, collectionId: id }),
      ).rejects.toThrow(`Persisted cache claim`)

      expect(
        await adapter.getStreamPosition(peerTarget, peerCtx),
      ).toMatchObject({
        latestTerm: 1,
        latestSeq: 1,
      })
      expect(await adapter.pullSince(peerTarget, 0, peerCtx)).toMatchObject({
        changedKeys: [`row`],
      })
      await adapter.ensureIndex(
        peerTarget,
        `peer`,
        { expressionSql: [`json_extract(value, '$.id')`] },
        peerCtx,
      )
      await adapter.markIndexRemoved(peerTarget, `peer`, peerCtx)
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
      await expect(
        adapter.getStreamPosition(peerTarget, peerCtx),
      ).rejects.toThrow(`Persisted cache claim`)
      const next = await adapter.claimCacheGeneration(`coordinator-claim`)
      expect(next.storageCollectionId).toBe(id)
      expect(
        await adapter.getStreamPosition(
          { kind: `managed`, storageCollectionId: id, claimId: next.claimId },
          {
            cacheGenerationClaimId: next.claimId,
          },
        ),
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

  // The Collection's current index declaration is the independent authority
  // for the final physical index. A cache rotation may ask SQLite to create an
  // index, then the Collection may remove that declaration before DDL enters
  // SQLite. The removal may finish first, and a re-add may occur while the
  // reconciliation removal is held. These are real-SQLite receiving cuts for
  // the controlled reverse-order histories in persisted-oracle.test.ts. The
  // public declaration and SQLite's registry plus sqlite_master are compared
  // after recovery. Holds control call order, not SQLite's DDL implementation.
  for (const readdDuringReconciliation of [false, true]) {
    it(
      readdDuringReconciliation
        ? `restores a SQLite index re-added during late-ensure reconciliation`
        : `removes a late SQLite index after its Collection declaration is removed`,
      async () => {
        const database = new DatabaseSync(`:memory:`)
        let primaryFailure: unknown
        const logicalId = `late-native-index-removal`
        const baseDriver = createDriver(database)
        let transactionTail = Promise.resolve()
        // One DatabaseSync handle cannot run nested transactions. The host's
        // transaction queue preserves the deliberate order of these real DDL
        // operations without introducing a fixture-only SQLite failure.
        const driver: SQLiteDriver = {
          ...baseDriver,
          transaction: async (work) => {
            const previous = transactionTail
            let release!: () => void
            transactionTail = new Promise<void>((resolve) => {
              release = resolve
            })
            await previous
            try {
              return await baseDriver.transaction(work)
            } finally {
              release()
            }
          },
        }
        const nativeAdapter = new SQLiteCorePersistenceAdapter({
          driver,
        })
        const ensureEntered = deferred()
        const releaseEnsure = deferred()
        const removalSettled = deferred()
        const secondRemovalEntered = deferred()
        const releaseSecondRemoval = deferred()
        const readdEnsureSettled = deferred()
        let initialStorageId = ``
        let heldEnsure = false
        let rotatedRemovals = 0
        let rotatedEnsures = 0
        const adapter = new Proxy(nativeAdapter, {
          get(target, property) {
            if (property === `ensureIndex`) {
              return async (...args: Parameters<typeof target.ensureIndex>) => {
                const storage = args[0]
                let rotatedEnsureNumber = 0
                if (
                  storage.kind === `managed` &&
                  initialStorageId !== `` &&
                  storage.storageCollectionId !== initialStorageId
                ) {
                  rotatedEnsureNumber = ++rotatedEnsures
                  if (!heldEnsure) {
                    heldEnsure = true
                    ensureEntered.resolve()
                    await releaseEnsure.promise
                  }
                }
                await target.ensureIndex(...args)
                if (rotatedEnsureNumber === 2) readdEnsureSettled.resolve()
              }
            }
            if (property === `markIndexRemoved`) {
              return async (
                ...args: Parameters<typeof target.markIndexRemoved>
              ) => {
                const storage = args[0]
                if (
                  storage.kind === `managed` &&
                  storage.storageCollectionId !== initialStorageId &&
                  ++rotatedRemovals === 2 &&
                  readdDuringReconciliation
                ) {
                  secondRemovalEntered.resolve()
                  await releaseSecondRemoval.promise
                }
                await target.markIndexRemoved(...args)
                removalSettled.resolve()
              }
            }
            const value: unknown = Reflect.get(target, property, target)
            return typeof value === `function` ? value.bind(target) : value
          },
        })
        let recover!: () => Promise<void>
        const collection = createCollection(
          persistedCollectionOptions<{ id: string; title: string }, string>({
            id: logicalId,
            syncMode: `on-demand`,
            getKey: (row) => row.id,
            defaultIndexType: BasicIndex,
            sync: {
              sync: (params) => {
                recover = params.metadata!.persistence!.startScopedRecovery!
                params.markReady()
                return { restartAfterScopedRecovery: (gate) => gate }
              },
            },
            persistence: { adapter },
          }),
        )
        const index = collection.createIndex((row) => row.title)
        const signature = collection
          .getIndexMetadata()
          .find((metadata) => metadata.indexId === index.id)?.signature
        if (!signature) throw new Error(`Missing index signature`)
        let recovery: Promise<void> | undefined
        try {
          await collection.stateWhenReady()
          const originalClaim = database
            .prepare(
              `SELECT physical_id FROM cache_generation_claim WHERE logical_id = ?`,
            )
            .get(logicalId) as { physical_id: string }
          initialStorageId = originalClaim.physical_id
          recovery = recover()
          await reachCheckpoint(
            ensureEntered.promise,
            `rotated SQLite index ensure`,
          )
          expect(collection.removeIndex(index)).toBe(true)
          expect(collection.getIndexMetadata()).toEqual([])
          await reachCheckpoint(
            removalSettled.promise,
            `SQLite index removal before late ensure`,
          )
          releaseEnsure.resolve()
          if (readdDuringReconciliation) {
            await reachCheckpoint(
              secondRemovalEntered.promise,
              `SQLite reconciliation removal before index re-add`,
            )
            const current = collection.createIndex((row) => row.title)
            expect(
              collection
                .getIndexMetadata()
                .find((metadata) => metadata.indexId === current.id)?.signature,
            ).toBe(signature)
            await reachCheckpoint(
              readdEnsureSettled.promise,
              `SQLite re-add before reconciliation removal`,
            )
            releaseSecondRemoval.resolve()
          }
          await reachCheckpoint(recovery, `index reconciliation after rotation`)
          const currentClaim = database
            .prepare(
              `SELECT physical_id FROM cache_generation_claim WHERE logical_id = ?`,
            )
            .get(logicalId) as { physical_id: string }
          expect(currentClaim.physical_id).not.toBe(initialStorageId)
          await vi.waitFor(() => {
            const currentIndex = database
              .prepare(
                `SELECT index_name, removed FROM persisted_index_registry
             WHERE collection_id = ? AND signature = ?`,
              )
              .get(currentClaim.physical_id, signature) as
              { index_name: string; removed: number } | undefined
            if (!currentIndex)
              throw new Error(`Missing rotated SQLite index row`)
            expect(currentIndex.removed).toBe(readdDuringReconciliation ? 0 : 1)
            expect(
              database
                .prepare(
                  `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
                )
                .all(currentIndex.index_name),
            ).toHaveLength(readdDuringReconciliation ? 1 : 0)
          })
          expect(collection.getIndexMetadata()).toHaveLength(
            readdDuringReconciliation ? 1 : 0,
          )
        } catch (error) {
          primaryFailure = error
          throw error
        } finally {
          releaseEnsure.resolve()
          releaseSecondRemoval.resolve()
          try {
            await Promise.allSettled([recovery])
            await collection.cleanup()
          } catch (error) {
            primaryFailure ??= error
          }
          closeDatabasePreservingPrimary(database, primaryFailure)
        }
      },
    )
  }

  // A resume snapshot may pass its preliminary claim check and then wait to
  // enter SQLite's read transaction. The independent claim rule compares the
  // transaction's clock cut with that claim's expiry: a live claim reads its
  // requested rows and metadata; an expired claim rejects without a snapshot.
  // A later-acquired peer claim remains live in both histories and must keep
  // the same durable rows and metadata. The grammar varies zero-to-three rows
  // to distinguish empty from partial snapshots, and row inclusion to expose
  // unwanted row reads. Peer acquisition time varies an independent expiry;
  // the peer stays live throughout this bounded grammar. The read clock cut
  // distinguishes live, exactly expired, and later reads for the first claim.
  // Both claims address one physical ID. A peer acquired after the read, or
  // expired before its own read, is not a legal history here. The six fixed
  // histories reconstruct both row-inclusion options at exact expiry.
  // Holding the real transaction before its claim query makes the second
  // check, rather than the wrapper's later publication guard, the checkpoint.
  type ManagedClaimReadHistory = {
    elapsedMs: number
    includeRows: boolean
    peerDelayMs: number
    rowCount: number
  }
  const assertManagedClaimReadHistory = async ({
    elapsedMs,
    includeRows,
    peerDelayMs,
    rowCount,
  }: ManagedClaimReadHistory): Promise<void> => {
    // The independent model uses half-open claim intervals. The peer's
    // interval starts later, so the first claim may expire while it stays live.
    const startAtMs = 1_000
    const claimTtlMs = 100
    const firstExpiresAtMs = startAtMs + claimTtlMs
    const peerClaimsAtMs = startAtMs + peerDelayMs
    const peerExpiresAtMs = peerClaimsAtMs + claimTtlMs
    const readAtMs = firstExpiresAtMs + elapsedMs
    const firstClaimCanRead = readAtMs < firstExpiresAtMs
    expect(peerClaimsAtMs).toBeLessThan(firstExpiresAtMs)
    expect(readAtMs).toBeGreaterThanOrEqual(peerClaimsAtMs)
    expect(readAtMs).toBeLessThan(peerExpiresAtMs)
    const rows = Array.from({ length: rowCount }, (_, index) => ({
      id: `retained-${index}`,
      title: `Warm peer row ${index}`,
    }))
    const expectedFirstRows = includeRows ? rows : []

    const database = new DatabaseSync(`:memory:`)
    let primaryFailure: unknown
    let now = startAtMs
    const baseDriver = createDriver(database)
    const transactionEntered = deferred()
    const releaseTransaction = deferred()
    let holdTransaction = false
    let observeHeldRead = false
    let metadataReads = 0
    let rowReads = 0
    const heldStatements: Array<{
      type: `query` | `run` | `exec`
      sql: string
      params?: ReadonlyArray<unknown>
    }> = []
    let rowTable = ``
    let observedStorageId = ``
    const driver: SQLiteDriver = {
      ...baseDriver,
      transaction: (operation) =>
        baseDriver.transaction(async (transactionDriver) => {
          if (holdTransaction) {
            holdTransaction = false
            transactionEntered.resolve()
            await releaseTransaction.promise
          }
          return operation({
            ...transactionDriver,
            query: (sql, params) => {
              if (observeHeldRead) {
                heldStatements.push({ type: `query`, sql, params })
                if (sql.includes(`FROM collection_metadata`)) metadataReads++
                if (sql.includes(rowTable)) rowReads++
              }
              return transactionDriver.query(sql, params)
            },
            run: (sql, params) => {
              if (observeHeldRead) {
                heldStatements.push({ type: `run`, sql, params })
              }
              return transactionDriver.run(sql, params)
            },
            exec: (sql) => {
              if (observeHeldRead) heldStatements.push({ type: `exec`, sql })
              return transactionDriver.exec(sql)
            },
          })
        }),
    }
    const adapter = new SQLiteCorePersistenceAdapter({
      driver,
      cacheGenerationClaimTtlMs: claimTtlMs,
      now: () => now,
    })
    let read: ReturnType<typeof adapter.loadResumeSnapshot> | undefined
    try {
      const logicalId = `held-resume-second-check`
      const first = await adapter.claimCacheGeneration(logicalId)
      const storageId = first.storageCollectionId
      observedStorageId = storageId
      // The model does not use the adapter's returned expiry to decide whether
      // this read is legal.
      expect(first.expiresAtMs).toBe(firstExpiresAtMs)
      rowTable = createPersistedTableName(storageId, `c`)
      const resume = { offset: `warm-peer-offset` }
      await adapter.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: storageId,
          claimId: first.claimId,
        },
        {
          txId: `seed`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: first.claimId,
          mutations: rows.map((row) => ({
            type: `insert` as const,
            key: row.id,
            value: row,
          })),
          collectionMetadataMutations: [
            { type: `set`, key: `resume`, value: resume },
          ],
        },
      )
      now = peerClaimsAtMs
      const warm = await adapter.claimCacheGeneration(logicalId)
      expect(warm.storageCollectionId).toBe(storageId)
      expect(warm.claimId).not.toBe(first.claimId)
      expect(warm.expiresAtMs).toBe(peerExpiresAtMs)

      holdTransaction = true
      observeHeldRead = true
      read = adapter.loadResumeSnapshot(
        {
          kind: `managed`,
          storageCollectionId: storageId,
          claimId: first.claimId,
        },
        {
          includeRows,
          cacheGenerationClaimId: first.claimId,
        },
      )
      void read.catch(() => undefined)
      await reachCheckpoint(
        transactionEntered.promise,
        `resume transaction before its claim check`,
      )
      now = readAtMs
      releaseTransaction.resolve()
      const generationStatements = () =>
        heldStatements.filter(
          ({ sql, params }) =>
            sql.includes(rowTable) ||
            sql.includes(observedStorageId) ||
            params?.includes(observedStorageId),
        )
      if (!firstClaimCanRead) {
        await expect(read).rejects.toThrow(
          `Persisted cache claim is no longer active`,
        )
        expect(generationStatements()).toHaveLength(1)
        expect(generationStatements()[0]).toMatchObject({ type: `query` })
        expect(generationStatements()[0]?.sql).toContain(
          `cache_generation_claim`,
        )
        expect(metadataReads).toBe(0)
        expect(rowReads).toBe(0)
      } else {
        const snapshot = await read
        expect(generationStatements()[0]).toMatchObject({ type: `query` })
        expect(generationStatements()[0]?.sql).toContain(
          `cache_generation_claim`,
        )
        expect(snapshot.rows.map(({ value }) => value)).toEqual(
          expectedFirstRows,
        )
        expect(snapshot.collectionMetadata).toEqual([
          { key: `resume`, value: resume },
        ])
        expect(metadataReads).toBeGreaterThan(0)
        if (includeRows) {
          expect(rowReads).toBeGreaterThan(0)
        } else {
          expect(rowReads).toBe(0)
        }
      }
      observeHeldRead = false
      const peerSnapshot = await adapter.loadResumeSnapshot(
        {
          kind: `managed`,
          storageCollectionId: storageId,
          claimId: warm.claimId,
        },
        {
          cacheGenerationClaimId: warm.claimId,
        },
      )
      expect(peerSnapshot.rows.map(({ value }) => value)).toEqual(rows)
      expect(peerSnapshot.collectionMetadata).toEqual([
        { key: `resume`, value: resume },
      ])
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      releaseTransaction.resolve()
      await Promise.allSettled([read])
      closeDatabasePreservingPrimary(database, primaryFailure)
    }
  }

  it.each([
    { clockCut: `before expiry`, elapsedMs: -1, includeRows: false },
    { clockCut: `before expiry`, elapsedMs: -1, includeRows: true },
    { clockCut: `at expiry`, elapsedMs: 0, includeRows: false },
    { clockCut: `at expiry`, elapsedMs: 0, includeRows: true },
    { clockCut: `after expiry`, elapsedMs: 1, includeRows: false },
    { clockCut: `after expiry`, elapsedMs: 1, includeRows: true },
  ])(
    `checks a cache claim $clockCut inside a resume transaction with includeRows=$includeRows`,
    ({ elapsedMs, includeRows }) =>
      assertManagedClaimReadHistory({
        elapsedMs,
        includeRows,
        peerDelayMs: 50,
        rowCount: 1,
      }),
  )

  const managedClaimReadHistory = fc.record({
    elapsedMs: fc.constantFrom(-9, -1, 0, 1, 9),
    includeRows: fc.boolean(),
    peerDelayMs: fc.integer({ min: 10, max: 80 }),
    rowCount: fc.integer({ min: 0, max: 3 }),
  })
  fcTest.prop([managedClaimReadHistory], {
    seed: 2056,
    numRuns: oracleRuns(30),
  })(
    `checks generated managed-claim read histories (fixed)`,
    assertManagedClaimReadHistory,
  )
  fcTest.prop(
    [managedClaimReadHistory],
    oraclePropertyOptions(30, `sqlite-resume.managed-claim-read`),
  )(
    `checks generated managed-claim read histories (random or replayed)`,
    assertManagedClaimReadHistory,
  )

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
      await adapter.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: seed.storageCollectionId,
          claimId: seed.claimId,
        },
        {
          txId: `seed-resume`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: seed.claimId,
          mutations: [],
          collectionMetadataMutations: [
            { type: `set`, key: `resume`, value: `old-resume` },
          ],
        },
      )
      expect(
        (
          await adapter.loadResumeSnapshot(
            {
              kind: `managed`,
              storageCollectionId: seed.storageCollectionId,
              claimId: seed.claimId,
            },
            {
              includeRows: false,
              cacheGenerationClaimId: seed.claimId,
            },
          )
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

  // The SQLite claim rule and the wrapper recovery rule meet at startup.
  // One run pauses before dispatching its real SQLite resume read; a later peer claims the
  // same physical generation and remains live when the first claim expires.
  // The model has two independent authorities: the peer may keep the old row
  // and cursor, while the expired run must bind private storage and settle a
  // demand only from a fresh source row. The held read entry is outside a
  // write transaction so the peer can make its legal later claim. The real
  // SQLite adapter then supplies the rejection; the separate transaction
  // oracle owns its later in-transaction claim check.
  // This receiving history does not model arbitrary browser scheduling.
  it(`composes SQLite startup claim rejection with private subset recovery`, async () => {
    type Row = { id: string; title: string }
    const database = new DatabaseSync(`:memory:`)
    const baseDriver = createDriver(database)
    const readEntered = deferred()
    const releaseRead = deferred()
    let holdRead = false
    let now = 1_000
    // Keep the real renewal timer outside this controlled-clock history.
    // Only the test's virtual time jump may expire the held claim.
    const claimTtlMs = 1_000_000
    const firstAdapter = new SQLiteCorePersistenceAdapter({
      driver: baseDriver,
      cacheGenerationClaimTtlMs: claimTtlMs,
      now: () => now,
    })
    const sqliteReadRejections: Array<string> = []
    const realHydrationScope =
      firstAdapter.runInHydrationScope.bind(firstAdapter)
    firstAdapter.runInHydrationScope = (task) =>
      realHydrationScope((hydrationAdapter) =>
        task({
          ...hydrationAdapter,
          loadResumeSnapshot: async (...args) => {
            if (holdRead) {
              holdRead = false
              readEntered.resolve()
              await releaseRead.promise
            }
            try {
              return await hydrationAdapter.loadResumeSnapshot(...args)
            } catch (error) {
              sqliteReadRejections.push(String(error))
              throw error
            }
          },
        }),
      )
    const peerAdapter = new SQLiteCorePersistenceAdapter({
      driver: baseDriver,
      cacheGenerationClaimTtlMs: claimTtlMs,
      now: () => now,
    })
    const logicalId = `composed-startup-claim-rejection`
    const old: Row = { id: `old`, title: `Peer row` }
    const fresh: Row = { id: `fresh`, title: `New source row` }
    let expired: Collection<Row, string> | undefined
    let peer: Collection<Row, string> | undefined
    let seedClaimId: string | undefined
    let firstSource: Parameters<SyncConfig<Row, string>[`sync`]>[0] | undefined
    const firstSourceStarted = deferred()
    const sourceLoads: Array<boolean | undefined> = []
    let primaryFailure: unknown
    try {
      const seed = await peerAdapter.claimCacheGeneration(logicalId)
      seedClaimId = seed.claimId
      await peerAdapter.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: seed.storageCollectionId,
          claimId: seed.claimId,
        },
        {
          txId: `seed-old`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: seed.claimId,
          mutations: [{ type: `insert`, key: old.id, value: old }],
          collectionMetadataMutations: [
            { type: `set`, key: `resume`, value: `old-cursor` },
          ],
        },
      )
      await peerAdapter.releaseCacheGenerationClaim(seed.claimId)
      seedClaimId = undefined

      expired = createCollection(
        persistedCollectionOptions<Row, string>({
          id: logicalId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              firstSource = params
              expect(params.metadata?.collection.get(`resume`)).toBeUndefined()
              params.markReady()
              firstSourceStarted.resolve()
              return {
                restartAfterScopedRecovery: () => {},
                loadSubset: async (options) => {
                  sourceLoads.push(options.refetch)
                  params.begin()
                  params.write({ type: `insert`, value: fresh })
                  await whenSyncAccepted(params.commit())
                },
              }
            },
          },
          persistence: { adapter: firstAdapter },
        }),
      )
      holdRead = true
      expired.startSyncImmediate()
      await reachCheckpoint(readEntered.promise, `first SQLite claim read`)
      expect(firstSource).toBeUndefined()

      now = 501_000
      peer = createCollection(
        persistedCollectionOptions<Row, string>({
          id: logicalId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              params.markReady()
              return {
                restartAfterScopedRecovery: () => {},
                loadSubset: async () => {},
              }
            },
          },
          persistence: { adapter: peerAdapter },
        }),
      )
      peer.startSyncImmediate()
      await peer.stateWhenReady()
      await peer._sync.loadSubset({ limit: 1 })
      expect(peer.get(old.id)).toMatchObject(old)

      now = 1_001_001
      releaseRead.resolve()
      await reachCheckpoint(
        firstSourceStarted.promise,
        `source after claim loss`,
      )
      await expired.stateWhenReady()
      const headAfterStartup = database
        .prepare(
          `SELECT physical_id FROM cache_generation
           WHERE logical_id = ? AND retired = 0`,
        )
        .get(logicalId) as { physical_id: string }
      expect(headAfterStartup.physical_id).toBe(seed.storageCollectionId)
      expect(sqliteReadRejections).toHaveLength(1)
      expect(sqliteReadRejections[0]).toContain(
        `Persisted cache claim is no longer active`,
      )
      expect(expired.get(old.id)).toBeUndefined()
      await expired._sync.loadSubset({ limit: 1 })
      // This is the first demand against empty private storage, so it is an
      // ordinary source load. The fresh row and private durable destination,
      // not a refetch flag, establish the recovery obligation.
      expect(sourceLoads).toEqual([undefined])
      expect(expired.get(old.id)).toBeUndefined()
      expect(expired.get(fresh.id)).toMatchObject(fresh)
      expect(peer.get(old.id)).toMatchObject(old)
      expect(peer.get(fresh.id)).toBeUndefined()

      const head = database
        .prepare(
          `SELECT physical_id FROM cache_generation
           WHERE logical_id = ? AND retired = 0`,
        )
        .get(logicalId) as { physical_id: string }
      expect(head.physical_id).toBe(seed.storageCollectionId)
      const claims = database
        .prepare(
          `SELECT physical_id, claim_id FROM cache_generation_claim
           WHERE logical_id = ? ORDER BY physical_id`,
        )
        .all(logicalId) as Array<{ physical_id: string; claim_id: string }>
      const peerClaim = claims.find(
        ({ physical_id }) => physical_id === seed.storageCollectionId,
      )
      const privateClaim = claims.find(
        ({ physical_id }) => physical_id !== seed.storageCollectionId,
      )
      expect(peerClaim).toBeDefined()
      expect(privateClaim).toBeDefined()
      expect(
        await peerAdapter.loadResumeSnapshot(
          {
            kind: `managed`,
            storageCollectionId: seed.storageCollectionId,
            claimId: peerClaim!.claim_id,
          },
          {
            cacheGenerationClaimId: peerClaim!.claim_id,
          },
        ),
      ).toMatchObject({
        rows: [{ key: old.id, value: old }],
        collectionMetadata: [{ key: `resume`, value: `old-cursor` }],
      })
      expect(
        (
          await firstAdapter.loadResumeSnapshot(
            {
              kind: `managed`,
              storageCollectionId: privateClaim!.physical_id,
              claimId: privateClaim!.claim_id,
            },
            {
              cacheGenerationClaimId: privateClaim!.claim_id,
            },
          )
        ).rows.map(({ value }) => value),
      ).toEqual([fresh])
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      releaseRead.resolve()
      const cleanupFailures: Array<unknown> = []
      for (const cleanup of [
        () => expired?.cleanup(),
        () => peer?.cleanup(),
        () =>
          seedClaimId
            ? peerAdapter.releaseCacheGenerationClaim(seedClaimId)
            : undefined,
      ]) {
        try {
          await cleanup()
        } catch (error) {
          cleanupFailures.push(error)
        }
      }
      closeDatabasePreservingPrimary(database, primaryFailure, cleanupFailures)
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
          await adapter.scanRows(
            {
              kind: `managed`,
              storageCollectionId: claims[0]!.physical_id,
              claimId: claims[0]!.claim_id,
            },
            undefined,
            {
              cacheGenerationClaimId: claims[0]!.claim_id,
            },
          )
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
      await adapter.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: seedClaim.storageCollectionId,
          claimId: seedClaim.claimId,
        },
        {
          txId: `seed-stale-row`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: seedClaim.claimId,
          mutations: [{ type: `insert`, key: staleRow.id, value: staleRow }],
        },
      )

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
        {
          kind: `managed`,
          storageCollectionId: seedClaim.storageCollectionId,
          claimId: seedClaim.claimId,
        },
        { cacheGenerationClaimId: seedClaim.claimId },
      )
      const currentSnapshot = await adapter.loadResumeSnapshot(
        {
          kind: `managed`,
          storageCollectionId: currentClaim.storageCollectionId,
          claimId: currentClaim.claimId,
        },
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
      closeDatabasePreservingPrimary(database, primaryFailure, cleanupFailures)
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
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
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
        },
      )

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
        const durableRows = (
          await loadResumeSnapshot({
            kind: `eager`,
            collectionId: collectionId,
          })
        ).rows
          .map(({ value }) => value)
          .sort((left, right) =>
            String(left.id).localeCompare(String(right.id)),
          )
        expect(durableRows).toEqual(expectedRows)
      }
      if (history.transition === `raw-delete`) {
        expect(
          (
            await loadResumeSnapshot({
              kind: `eager`,
              collectionId: collectionId,
            })
          ).keySet,
        ).toEqual({
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
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            { type: `insert`, key: 1, value: { id: 1, name: `one` } },
          ],
        },
      )

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
      const position = await adapter.getStreamPosition({
        kind: `eager`,
        collectionId: collectionId,
      })
      const leadershipClaim = observeWork()

      resetWork()
      const consistent = await adapter.loadResumeSnapshot(
        { kind: `eager`, collectionId: collectionId },
        {
          includeRows: false,
        },
      )
      const consistentSnapshot = observeWork()

      await driver.run(`DELETE FROM "${tableName}"`)
      resetWork()
      const incompatible = await adapter.loadResumeSnapshot(
        { kind: `eager`, collectionId: collectionId },
        {
          includeRows: false,
        },
      )
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

      await adapter.loadResumeSnapshot(
        { kind: `eager`, collectionId: collectionId },
        { includeRows: false },
      )
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
        (
          await adapter.loadResumeSnapshot(
            { kind: `eager`, collectionId: collectionId },
            { includeRows: false },
          )
        ).keySet,
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
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
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
        },
      )

      const initial = await adapter.loadResumeSnapshot({
        kind: `eager`,
        collectionId: collectionId,
      })
      expect(initial.keySet).toEqual({ status: `consistent` })
      expect(initial.rows.map(({ key }) => key)).toEqual([1, 2])
      expect(initial.collectionMetadata).toEqual([
        { key: `cursor`, value: `10_0` },
      ])

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `normal-update`,
          term: 1,
          seq: 2,
          rowVersion: 2,
          mutations: [
            { type: `update`, key: 1, value: { id: 1, name: `updated-one` } },
          ],
        },
      )
      const updated = await adapter.loadResumeSnapshot({
        kind: `eager`,
        collectionId: collectionId,
      })
      expect(updated.rows.find(({ key }) => key === 1)?.value).toEqual({
        id: 1,
        name: `updated-one`,
      })
      expect(updated.keySet).toEqual({ status: `consistent` })

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `normal-delete`,
          term: 1,
          seq: 3,
          rowVersion: 3,
          mutations: [
            { type: `delete`, key: 2, value: { id: 2, name: `two` } },
          ],
        },
      )
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `normal-delete`,
          term: 1,
          seq: 3,
          rowVersion: 3,
          mutations: [
            { type: `delete`, key: 2, value: { id: 2, name: `two` } },
          ],
        },
      )
      const deleted = await adapter.loadResumeSnapshot({
        kind: `eager`,
        collectionId: collectionId,
      })
      expect(deleted.rows.map(({ key }) => key)).toEqual([1])
      expect(deleted.keySet).toEqual({ status: `consistent` })

      rejectCollectionInsert = true
      await expect(
        adapter.applyCommittedTx(
          { kind: `eager`, collectionId: collectionId },
          {
            txId: `rolled-back-insert`,
            term: 1,
            seq: 4,
            rowVersion: 4,
            mutations: [{ type: `insert`, key: 3, value: { id: 3 } }],
          },
        ),
      ).rejects.toThrow(`injected transaction failure`)
      rejectCollectionInsert = false
      const rolledBack = await adapter.loadResumeSnapshot({
        kind: `eager`,
        collectionId: collectionId,
      })
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

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `restore-second-row`,
          term: 1,
          seq: 5,
          rowVersion: 5,
          mutations: [
            { type: `insert`, key: 2, value: { id: 2, name: `two` } },
          ],
        },
      )

      await driver.run(`DELETE FROM "${tableName}" WHERE key = ?`, [
        database
          .prepare(`SELECT key FROM "${tableName}" ORDER BY key LIMIT 1`)
          .get()!.key,
      ])
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `metadata-after-loss`,
          term: 1,
          seq: 6,
          rowVersion: 6,
          mutations: [],
          collectionMetadataMutations: [
            { type: `set`, key: `cursor`, value: `11_0` },
          ],
        },
      )
      expect(
        (
          await adapter.loadResumeSnapshot({
            kind: `eager`,
            collectionId: collectionId,
          })
        ).keySet,
      ).toEqual({
        status: `incompatible`,
      })

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `full-replacement`,
          term: 1,
          seq: 7,
          rowVersion: 7,
          truncate: true,
          mutations: [
            { type: `insert`, key: 1, value: { id: 1, name: `one` } },
            { type: `insert`, key: 2, value: { id: 2, name: `two` } },
          ],
        },
      )
      expect(
        (
          await adapter.loadResumeSnapshot({
            kind: `eager`,
            collectionId: collectionId,
          })
        ).keySet,
      ).toEqual({
        status: `consistent`,
      })

      await driver.run(
        `UPDATE "${tableName}" SET key = key || '-replacement' WHERE rowid = (SELECT MIN(rowid) FROM "${tableName}")`,
      )
      const substituted = await adapter.loadResumeSnapshot({
        kind: `eager`,
        collectionId: collectionId,
      })
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
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
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
        },
      )

      const rows = Array.from({ length: 205 }, (_, index) => {
        const id = `row-${String(index).padStart(3, `0`)}`
        return { id, title: `Title ${index}` }
      })
      databaseCalls = 0
      maxReplacementBoundParameters = 0
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
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
        },
      )
      const replacementCalls = databaseCalls

      const snapshot = await adapter.loadResumeSnapshot({
        kind: `eager`,
        collectionId: collectionId,
      })
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
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
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
        },
      )
      const before = await observeCachedSchemaState(
        adapter,
        driver,
        collectionId,
      )
      const beforeSnapshot = await adapter.loadResumeSnapshot({
        kind: `eager`,
        collectionId: collectionId,
      })
      injectFailure = true
      await expect(
        adapter.applyCommittedTx(
          { kind: `eager`, collectionId: collectionId },
          {
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
          },
        ),
      ).rejects.toThrow(`injected transaction failure`)
      injectFailure = false
      expect(bulkRowInserts).toBe(2)
      expect(
        await observeCachedSchemaState(adapter, driver, collectionId),
      ).toEqual(before)
      expect(
        await adapter.loadResumeSnapshot({
          kind: `eager`,
          collectionId: collectionId,
        }),
      ).toEqual(beforeSnapshot)
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
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: `duplicate-replacement` },
        {
          txId: `duplicate`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          truncate: true,
          mutations: [
            { type: `insert`, key: `same`, value: { id: `same`, first: true } },
            { type: `update`, key: `same`, value: { last: true } },
          ],
        },
      )
      const duplicate = await adapter.loadResumeSnapshot({
        kind: `eager`,
        collectionId: `duplicate-replacement`,
      })
      expect(duplicate.rows).toEqual([
        {
          key: `same`,
          value: { id: `same`, first: true, last: true },
          metadata: undefined,
        },
      ])
      expect(duplicate.keySet).toEqual({ status: `consistent` })

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: `delete-replacement` },
        {
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
        },
      )
      const deleted = await adapter.loadResumeSnapshot({
        kind: `eager`,
        collectionId: `delete-replacement`,
      })
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

      const migratedLegacySnapshot = await migrated.loadResumeSnapshot({
        kind: `eager`,
        collectionId: collectionId,
      })
      expect(migratedLegacySnapshot.keySet).toEqual({ status: `unknown` })
      expect(migratedLegacySnapshot.rows).toEqual([
        {
          key: `legacy-row`,
          value: { id: `legacy-row`, n: 0 },
          metadata: { source: `legacy` },
        },
      ])
      await migrated.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `legacy-insert`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [{ type: `insert`, key: 1, value: { id: 1, n: 1 } }],
        },
      )
      expect(
        (
          await migrated.loadResumeSnapshot({
            kind: `eager`,
            collectionId: collectionId,
          })
        ).keySet,
      ).toEqual({
        status: `unknown`,
      })

      await migrated.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `legacy-replacement`,
          term: 1,
          seq: 2,
          rowVersion: 2,
          truncate: true,
          mutations: [{ type: `insert`, key: 1, value: { id: 1, n: 2 } }],
        },
      )
      expect(
        (
          await migrated.loadResumeSnapshot({
            kind: `eager`,
            collectionId: collectionId,
          })
        ).keySet,
      ).toEqual({
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
      await original.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [{ type: `insert`, key: 1, value: { id: 1 } }],
          collectionMetadataMutations: [
            { type: `set`, key: `cursor`, value: `old` },
          ],
        },
      )

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
      const staleLoad = staleAdapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
      await reachCheckpoint(
        staleRead.promise,
        `stale schema-v1 registry read before competing reset`,
      )

      const winner = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 2,
      })
      await winner.loadSubset({ kind: `eager`, collectionId: collectionId }, {})
      await winner.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `recovery-write`,
          term: 2,
          seq: 1,
          rowVersion: 1,
          mutations: [{ type: `insert`, key: 2, value: { id: 2 } }],
          collectionMetadataMutations: [
            { type: `set`, key: `cursor`, value: `new` },
          ],
        },
      )

      releaseStaleRead.resolve()
      await staleLoad
      const snapshot = await winner.loadResumeSnapshot({
        kind: `eager`,
        collectionId: collectionId,
      })
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
      await original.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [{ type: `insert`, key: 1, value: { id: 1 } }],
        },
      )

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
      const staleLoad = staleV2.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
      await reachCheckpoint(
        staleRead.promise,
        `stale schema-v1 registry read before schema-v3 reset`,
      )

      const winnerV3 = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 3,
      })
      await winnerV3.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
      await winnerV3.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `winner-write`,
          term: 3,
          seq: 1,
          rowVersion: 1,
          mutations: [{ type: `insert`, key: 3, value: { id: 3 } }],
          collectionMetadataMutations: [
            { type: `set`, key: `cursor`, value: `v3` },
          ],
        },
      )

      releaseStaleRead.resolve()
      await expect(staleLoad).rejects.toThrow(
        `Schema version changed concurrently`,
      )
      const snapshot = await winnerV3.loadResumeSnapshot({
        kind: `eager`,
        collectionId: collectionId,
      })
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
      await staleV1.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-v1`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [{ type: `insert`, key: 1, value: { id: 1 } }],
          collectionMetadataMutations: [
            { type: `set`, key: `cursor`, value: `v1` },
          ],
        },
      )

      const currentV2 = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 2,
      })
      await currentV2.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
      await currentV2.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-v2`,
          term: 2,
          seq: 1,
          rowVersion: 1,
          mutations: [{ type: `insert`, key: 2, value: { id: 2 } }],
          collectionMetadataMutations: [
            { type: `set`, key: `cursor`, value: `v2` },
          ],
        },
      )
      const before = await observeCachedSchemaState(
        currentV2,
        driver,
        collectionId,
      )

      let lateWriteError: unknown
      try {
        await staleV1.applyCommittedTx(
          { kind: `eager`, collectionId: collectionId },
          {
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
          },
        )
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
      await staleV1.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-v1`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [{ type: `insert`, key: 1, value: { id: 1 } }],
        },
      )
      await staleV1.loadResumeSnapshot({
        kind: `eager`,
        collectionId: collectionId,
      })

      const currentV2 = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 2,
      })
      await currentV2.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
      await currentV2.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-v2`,
          term: 2,
          seq: 1,
          rowVersion: 1,
          mutations: [{ type: `insert`, key: 2, value: { id: 2 } }],
          collectionMetadataMutations: [
            { type: `set`, key: `cursor`, value: `v2` },
          ],
        },
      )

      await expect(
        staleV1.loadResumeSnapshot({
          kind: `eager`,
          collectionId: collectionId,
        }),
      ).rejects.toThrow(`Schema version mismatch`)
      expect(
        await currentV2.loadResumeSnapshot({
          kind: `eager`,
          collectionId: collectionId,
        }),
      ).toMatchObject({
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
      await staleV1.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-v1`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [{ type: `insert`, key: 1, value: { id: 1 } }],
        },
      )
      await staleV1.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )

      const currentV2 = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 2,
      })
      await currentV2.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
      await currentV2.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-v2`,
          term: 2,
          seq: 1,
          rowVersion: 1,
          mutations: [{ type: `insert`, key: 2, value: { id: 2 } }],
        },
      )

      const staleReads = await Promise.allSettled([
        staleV1.loadSubset({ kind: `eager`, collectionId: collectionId }, {}),
        staleV1.scanRows({ kind: `eager`, collectionId: collectionId }),
        staleV1.pullSince({ kind: `eager`, collectionId: collectionId }, 0),
      ])
      expect(staleReads.map(({ status }) => status)).toEqual([
        `rejected`,
        `rejected`,
        `rejected`,
      ])
      expect(
        await currentV2.loadSubset(
          { kind: `eager`, collectionId: collectionId },
          {},
        ),
      ).toMatchObject([{ key: 2, value: { id: 2 } }])
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
      await staleV1.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-v1`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [],
          collectionMetadataMutations: [
            { type: `set`, key: `cursor`, value: `v1` },
          ],
        },
      )
      await staleV1.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )

      const currentV2 = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 2,
      })
      await currentV2.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
      await currentV2.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-v2`,
          term: 2,
          seq: 1,
          rowVersion: 1,
          mutations: [],
          collectionMetadataMutations: [
            { type: `set`, key: `cursor`, value: `v2` },
          ],
        },
      )

      await expect(
        staleV1.loadCollectionMetadata({
          kind: `eager`,
          collectionId: collectionId,
        }),
      ).rejects.toThrow(`Schema version mismatch`)
      expect(
        await currentV2.loadCollectionMetadata({
          kind: `eager`,
          collectionId: collectionId,
        }),
      ).toEqual([{ key: `cursor`, value: `v2` }])
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
      await staleV1.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )

      const currentV2 = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 2,
      })
      await currentV2.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
      await currentV2.ensureIndex(
        { kind: `eager`, collectionId: collectionId },
        `v2-index`,
        {
          expressionSql: [`json_extract(value, '$.id')`],
        },
      )

      const staleWrites = await Promise.allSettled([
        staleV1.ensureIndex(
          { kind: `eager`, collectionId: collectionId },
          `stale-v1-index`,
          {
            expressionSql: [`json_extract(value, '$.legacy')`],
          },
        ),
        staleV1.markIndexRemoved(
          { kind: `eager`, collectionId: collectionId },
          `v2-index`,
        ),
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
      await old.applyCommittedTx(
        { kind: `eager`, collectionId: id },
        {
          txId: `seed`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            { type: `insert`, key: `old`, value: { id: `old`, stamp: 1 } },
          ],
        },
      )
      for (const signature of [
        `old-native-signature`,
        `current-native-signature`,
      ]) {
        await old.ensureIndex({ kind: `eager`, collectionId: id }, signature, {
          expressionSql: [`row_version`],
        })
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
    expect(
      await next.loadSubset({ kind: `eager`, collectionId: collectionId }, {}),
    ).toEqual([])
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
      (
        await old.loadSubset(
          { kind: `eager`, collectionId: `unrelated-cache` },
          {},
        )
      ).map(({ key }) => key),
    ).toEqual([`old`])
    await next.applyCommittedTx(
      { kind: `eager`, collectionId: collectionId },
      {
        txId: `reseed`,
        term: 2,
        seq: 1,
        rowVersion: 1,
        mutations: [
          { type: `insert`, key: `new`, value: { id: `new`, marker } },
        ],
      },
    )
    await next.ensureIndex(
      { kind: `eager`, collectionId: collectionId },
      `replacement`,
      {
        expressionSql: [`row_version`],
      },
    )
    const reopened = new SQLiteCorePersistenceAdapter({
      driver,
      schemaVersion: 2,
    })
    expect(
      (
        await reopened.loadSubset(
          { kind: `eager`, collectionId: collectionId },
          {},
        )
      ).map(({ value }) => value),
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
