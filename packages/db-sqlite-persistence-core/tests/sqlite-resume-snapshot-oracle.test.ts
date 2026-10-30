import { DatabaseSync } from 'node:sqlite'
import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import {
  oraclePropertyOptions,
  oracleReplayRequested,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  SQLiteCorePersistenceAdapter,
  createPersistedTableName,
  encodePersistedStorageKey,
  persistedCollectionOptions,
} from '../src'
import { runOrdinaryTransactionWorkOracle } from './ordinary-transaction-work-oracle'
import {
  closeDatabasePreservingPrimary,
  createDriver,
  deferred,
  expectStartupRows,
  reachCheckpoint,
} from './sqlite-resume-snapshot-support'
import type { SQLiteDriver } from '../src'
import type { Collection } from '@tanstack/db'

describe(`SQLite resume snapshots`, () => {
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

  const startupHistoryArbitrary = fc.record({
    baselineSize: fc.integer({ min: 1, max: 3 }),
    transition: fc.constantFrom(
      `none` as const,
      `managed-insert` as const,
      `raw-delete` as const,
    ),
  })

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
        managedPersistence = collection.insert(managedRow).when(`settled`)
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

  // A resume token may continue only the baseline that established its
  // previous token. This is the storage obligation of the optional source
  // progress protocol: a discontinuity invalidates resume evidence until an
  // authoritative replacement. It does not reject committed rows or order
  // opaque tokens. The independent model judges the edges since the last
  // replacement; ordinary metadata commits cannot erase a missing edge.
  type ProgressStep = {
    kind: `advance` | `stale` | `empty` | `snapshot` | `duplicate`
    pick: number
  }
  const progressSteps = fc.array(
    fc.record<ProgressStep>({
      kind: fc.constantFrom(
        `advance`,
        `stale`,
        `empty`,
        `snapshot`,
        `duplicate`,
      ),
      pick: fc.nat(3),
    }),
    { minLength: 3, maxLength: 16 },
  )
  const progressHistory = fc.record({
    legacySchema: fc.boolean(),
    steps: progressSteps,
  })
  const runProgressCampaign = async (
    parameters: ReturnType<typeof oraclePropertyOptions>,
  ) => {
    const reach = createOracleReach(`sqlite-resume.source-progress`, [
      `discontinuous commit`,
      `matching commit after discontinuity`,
      `replacement after discontinuity`,
      `duplicate source position`,
      `legacy source progress column added`,
    ])
    await fc.assert(
      fc.asyncProperty(
        progressHistory,
        async ({ legacySchema, steps: history }) => {
          reach.beginHistory()
          const database = new DatabaseSync(`:memory:`)
          let primary: unknown
          try {
            let adapter = new SQLiteCorePersistenceAdapter({
              driver: createDriver(database),
            })
            const target = {
              kind: `eager` as const,
              collectionId: `source-progress`,
            }
            if (legacySchema) {
              await adapter.loadResumeSnapshot(target)
              database.exec(
                `ALTER TABLE collection_version DROP COLUMN source_progress_incompatible`,
              )
              adapter = new SQLiteCorePersistenceAdapter({
                driver: createDriver(database),
              })
              await adapter.loadResumeSnapshot(target)
              reach.reach(`legacy source progress column added`)
            }
            const tokens = [`initial`]
            let current = `initial`
            // Model-only path: each edge must begin where its predecessor ended.
            let edges: Array<{ from: string; to: string }> = []
            const coherent = () =>
              edges.every(
                (edge, index) =>
                  index === 0 || edge.from === edges[index - 1]!.to,
              )
            const steps: Array<ProgressStep> = [
              { kind: `snapshot`, pick: 0 },
              ...history,
            ]
            for (const [index, step] of steps.entries()) {
              const wasCoherent = coherent()
              const previous =
                step.kind === `stale` || step.kind === `duplicate`
                  ? tokens[step.pick % tokens.length]!
                  : current
              const next =
                step.kind === `empty` || step.kind === `duplicate`
                  ? current
                  : `position-${index}`
              if (step.kind === `duplicate`)
                reach.reach(`duplicate source position`)
              if (step.kind === `snapshot`) {
                if (!wasCoherent) reach.reach(`replacement after discontinuity`)
                edges = [{ from: previous, to: next }]
              } else {
                if (previous !== current && next !== current)
                  reach.reach(`discontinuous commit`)
                if (!wasCoherent && previous === current)
                  reach.reach(`matching commit after discontinuity`)
                // Re-delivering the same source position is idempotent; it
                // contributes no new edge and cannot repair an earlier gap.
                if (next !== current) edges.push({ from: previous, to: next })
              }
              // The baseline adapter ignores this proposed optional field. Keeping
              // it on a structurally assignable transaction lets the pre-edit RED
              // reach the semantic comparison instead of failing type/setup.
              const tx = {
                txId: `progress-${index}`,
                term: 1,
                seq: index + 1,
                rowVersion: index + 1,
                truncate: step.kind === `snapshot`,
                sourceProgress: { key: `source-progress`, previous },
                mutations:
                  step.kind === `empty`
                    ? []
                    : [
                        {
                          type: `insert` as const,
                          key: `row`,
                          value: { id: `row`, label: next },
                        },
                      ],
                collectionMetadataMutations: [
                  { type: `set` as const, key: `source-progress`, value: next },
                ],
              }
              await adapter.applyCommittedTx(target, tx)
              const observation = await adapter.loadResumeSnapshot(target)
              expect(
                observation.sourceProgressCompatible,
                `source progress at step ${index}: ${JSON.stringify(steps.slice(0, index + 1))}`,
              ).toBe(coherent())
              // Physical key integrity and source continuity are separate laws.
              // A broken source path must not quarantine an intact cached set.
              expect(observation.keySet).toEqual({ status: `consistent` })
              expect(
                observation.collectionMetadata.find(
                  ({ key }) => key === `source-progress`,
                )?.value,
              ).toBe(next)
              current = next
              tokens.push(next)
            }
          } catch (error) {
            primary = error
          } finally {
            closeDatabasePreservingPrimary(database, primary)
          }
        },
      ),
      parameters,
    )
    console.info(`source progress reach`, Object.fromEntries(reach.counts()))
    reach.assertReached()
  }
  it.skipIf(oracleReplayRequested())(
    `preserves source progress evidence (fixed seed)`,
    () => runProgressCampaign({ numRuns: oracleRuns(80), seed: 2281 }),
  )
  oracleReplayTest(it, `sqlite-resume.source-progress`)(
    `preserves source progress evidence (random or replayed)`,
    () =>
      runProgressCampaign(
        oraclePropertyOptions(80, `sqlite-resume.source-progress`),
      ),
  )

  // The retired-storage and managed-claim checks compare production with independent
  // models of retained generations and claim intervals. The fixed and generated
  // cases share those checks. The startup grammar is the generator whose coverage
  // the fixed startup corpus calibrates.
  declareOracle({
    check: [
      assertRetiredStorageHistory,
      assertManagedClaimReadHistory,
      runProgressCampaign,
    ],
    model: [expectedRetainedGenerations],
    grammar: [startupHistoryArbitrary, progressHistory],
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
})

// The ordinary committed-transaction work law extends this SQLite owner.
runOrdinaryTransactionWorkOracle()

// The selected upgrade policy is an explicit schema reset. Frozen old bytes
// include an ordinary record that the new decoder would reinterpret as a tag.
// At the first new-schema read, this collection must be empty and all its old
// registry/physical indexes gone. Another collection must survive. Re-seeding
// then preserves the marker record, and a same-schema reopen must retain it.
// This reset/re-seed history does not claim lossless old-byte migration.
