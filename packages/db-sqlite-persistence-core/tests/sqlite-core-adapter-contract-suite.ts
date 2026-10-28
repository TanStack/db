/**
 * The shared SQLite core adapter contract. Each host package runs it through
 * its contract test file, and so does the sqlite3 CLI runtime test. The
 * reset/resume lineage and reset calibration tests are owned by
 * sqlite-core-adapter-oracle.test.ts; this suite registers them at their
 * original position, so every consumer keeps the same test names and order.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { IR, createCollection } from '@tanstack/db'
import {
  SQLiteCorePersistenceAdapter,
  createPersistedTableName,
  persistedCollectionOptions,
} from '../src'
import { harnessScope } from './contracts/harness-scope'
import { runSQLiteResetResumeOracleTests } from './sqlite-core-adapter-oracle.test'
import { createHarness } from './sqlite-core-adapter-support'
import type { CommittedTxAnchor, PersistedTx, PersistenceAdapter } from '../src'
import type { SyncConfig } from '@tanstack/db'
import type {
  SQLiteCoreAdapterHarnessFactory,
  Todo,
} from './sqlite-core-adapter-support'

function holdAndRejectFirstSubsetLoad(
  adapter: PersistenceAdapter,
  failure: Error,
): { entered: Promise<void>; release: () => void } {
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let loadCalls = 0
  const intercept =
    (loadSubset: PersistenceAdapter[`loadSubset`]) =>
    async (...args: Parameters<PersistenceAdapter[`loadSubset`]>) => {
      loadCalls++
      if (loadCalls === 1) {
        enter()
        await held
        throw failure
      }
      return loadSubset(...args)
    }

  const runInHydrationScope = adapter.runInHydrationScope?.bind(adapter)
  if (runInHydrationScope) {
    adapter.runInHydrationScope = (task) =>
      runInHydrationScope((scopedAdapter) =>
        task({
          ...scopedAdapter,
          loadSubset: intercept(scopedAdapter.loadSubset),
        }),
      )
  } else {
    adapter.loadSubset = intercept(adapter.loadSubset.bind(adapter))
  }

  return { entered, release }
}

export function runSQLiteCoreAdapterContractSuite(
  suiteName: string = `SQLiteCorePersistenceAdapter`,
  harnessFactory: SQLiteCoreAdapterHarnessFactory = createHarness,
): void {
  const scope = harnessScope(harnessFactory)
  const registerContractHarness = scope.create

  describe(suiteName, () => {
    afterEach(scope.cleanup)
    /**
     * A Web Lock successor may be cold: its observed term is zero even when
     * earlier no-write owners existed. The durable leader_term ledger, rather
     * than the caller's memory, is the independent lower bound for each new
     * term. Reservation itself does not advance the row version or create an
     * applied transaction. This driver exercises the real SQLite adapter and
     * observes both returned positions and the durable table after each cut.
     */
    it(`reserves distinct durable terms across empty elections`, async () => {
      const { adapter, driver } = registerContractHarness()
      if (!adapter.reserveLeadershipTerm) {
        throw new Error(`SQLite adapter has no durable term reservation`)
      }
      const reserve = adapter.reserveLeadershipTerm.bind(adapter)
      const collectionId = `cold-successor-terms`
      const observeDurableTerm = async () =>
        driver.query<{ latest_term: number }>(
          `SELECT latest_term FROM leader_term WHERE collection_id = ?`,
          [collectionId],
        )
      expect(
        await reserve({ kind: `eager`, collectionId: collectionId }, 0),
      ).toEqual({
        latestTerm: 1,
        latestSeq: 0,
        latestRowVersion: 0,
      })
      expect(await observeDurableTerm()).toEqual([{ latest_term: 1 }])
      expect(
        await reserve({ kind: `eager`, collectionId: collectionId }, 0),
      ).toEqual({
        latestTerm: 2,
        latestSeq: 0,
        latestRowVersion: 0,
      })
      expect(await observeDurableTerm()).toEqual([{ latest_term: 2 }])
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `term-two-write`,
          term: 2,
          seq: 1,
          rowVersion: 1,
          mutations: [],
        },
      )
      expect(
        await reserve({ kind: `eager`, collectionId: collectionId }, 0),
      ).toEqual({
        latestTerm: 3,
        latestSeq: 0,
        latestRowVersion: 1,
      })
      expect(await observeDurableTerm()).toEqual([{ latest_term: 3 }])
      expect(
        await reserve({ kind: `eager`, collectionId: collectionId }, 8),
      ).toEqual({
        latestTerm: 9,
        latestSeq: 0,
        latestRowVersion: 1,
      })
      expect(await observeDurableTerm()).toEqual([{ latest_term: 9 }])
    })

    /**
     * Exact-ID reconciliation has one equality lookup under the writer lock.
     * The query plan must seek by both collection and transaction ID; a plan
     * that only seeks by collection grows with retained transaction count.
     * A real SQLite plan is the work observation, independent of elapsed time.
     */
    it(`indexes exact transaction ID lookup within a collection`, async () => {
      const { adapter, driver } = registerContractHarness()
      await adapter.loadResumeSnapshot({
        kind: `eager`,
        collectionId: `plan-index`,
      })
      const plan = await driver.query<{ detail: string }>(
        `EXPLAIN QUERY PLAN
         SELECT term, seq, row_version FROM applied_tx
         WHERE collection_id = ? AND tx_id = ? LIMIT 2`,
        [`plan-index`, `target`],
      )
      expect(plan.map(({ detail }) => detail).join(` | `)).toMatch(
        /idx_applied_tx_collection_tx_id.*collection_id=\?.*tx_id=\?/,
      )
    })

    /**
     * An unanswered source transaction may be acknowledged by its exact
     * durable ID, or applied when no durable write followed its pre-send
     * anchor. A different write, reset, or pruned ID cannot authorize late
     * application: opaque source cursors and same-key values may be newer.
     *
     * The reference below comes from the authored durable history, not the
     * adapter's SQL. Each scenario uses a real SQLite collection. The check
     * observes the result, complete rows, cursor, row version, and exact log
     * IDs after reconciliation; a successful duplicate write would fail the
     * ledger and version comparison even if its final row matched. Each txId
     * identifies one immutable source payload; reusing an ID for different
     * content is outside this source-transaction grammar.
     * The CLI harness starts a sqlite3 process for each SQL command, so these
     * seven histories need more than Vitest's default timeout under parallel CI.
     */
    it(`reconciles only a certified source transaction against SQLite`, async () => {
      const { adapter, driver } = registerContractHarness()
      if (!adapter.reconcileCommittedTx) {
        throw new Error(`SQLite adapter has no reconciliation operation`)
      }
      const reconcile = adapter.reconcileCommittedTx.bind(adapter)
      const anchor: CommittedTxAnchor = {
        latestRowVersion: 0,
        resetEpoch: 0,
      }
      const tx = (
        txId: string,
        term: number,
        seq: number,
        rowVersion: number,
        title: string,
      ): PersistedTx => ({
        txId,
        term,
        seq,
        rowVersion,
        mutations: [
          {
            type: `insert`,
            key: `same-key`,
            value: {
              id: `same-key`,
              title,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
            },
          },
        ],
        collectionMetadataMutations: [
          { type: `set`, key: `probe:cursor`, value: title },
        ],
      })
      const observe = async (collectionId: string) => {
        const snapshot = await adapter.loadResumeSnapshot({
          kind: `eager`,
          collectionId: collectionId,
        })
        const log = await driver.query<{ tx_id: string }>(
          `SELECT tx_id FROM applied_tx WHERE collection_id = ? ORDER BY row_version`,
          [collectionId],
        )
        return {
          title: (snapshot.rows[0]?.value as Todo | undefined)?.title ?? null,
          cursor:
            (snapshot.collectionMetadata.find(
              ({ key }) => key === `probe:cursor`,
            )?.value as string | undefined) ?? null,
          rowVersion: snapshot.latestRowVersion,
          txIds: log.map(({ tx_id }) => tx_id),
        }
      }

      const appliedId = `source-id-present`
      const crossing = tx(`crossing`, 1, 1, 1, `crossing`)
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: appliedId },
        crossing,
      )
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: appliedId },
        tx(`peer`, 1, 2, 2, `newer`),
      )
      expect(
        await reconcile(
          { kind: `eager`, collectionId: appliedId },
          tx(`crossing`, 2, 1, 2, `crossing`),
          anchor,
        ),
      ).toEqual({
        kind: `already-applied`,
        committed: { term: 1, seq: 1, rowVersion: 1 },
        latestRowVersion: 2,
      })
      expect(await observe(appliedId)).toEqual({
        title: `newer`,
        cursor: `newer`,
        rowVersion: 2,
        txIds: [`crossing`, `peer`],
      })

      const absentId = `source-id-absent`
      expect(
        await reconcile(
          { kind: `eager`, collectionId: absentId },
          tx(`crossing`, 2, 1, 1, `crossing`),
          anchor,
        ),
      ).toEqual({
        kind: `applied-now`,
        committed: { term: 2, seq: 1, rowVersion: 1 },
        latestRowVersion: 1,
      })
      expect(await observe(absentId)).toEqual({
        title: `crossing`,
        cursor: `crossing`,
        rowVersion: 1,
        txIds: [`crossing`],
      })

      const intervenedId = `source-intervened`
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: intervenedId },
        tx(`peer`, 2, 1, 1, `newer`),
      )
      expect(
        await reconcile(
          { kind: `eager`, collectionId: intervenedId },
          tx(`crossing`, 2, 2, 2, `stale`),
          anchor,
        ),
      ).toEqual({ kind: `unknown` })
      expect(await observe(intervenedId)).toEqual({
        title: `newer`,
        cursor: `newer`,
        rowVersion: 1,
        txIds: [`peer`],
      })

      const prunedId = `source-pruned`
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: prunedId },
        crossing,
      )
      await driver.run(`DELETE FROM applied_tx WHERE collection_id = ?`, [
        prunedId,
      ])
      expect(
        await reconcile(
          { kind: `eager`, collectionId: prunedId },
          tx(`crossing`, 2, 1, 2, `stale`),
          anchor,
        ),
      ).toEqual({ kind: `unknown` })
      expect(await observe(prunedId)).toEqual({
        title: `crossing`,
        cursor: `crossing`,
        rowVersion: 1,
        txIds: [],
      })

      const resetId = `source-reset`
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: resetId },
        crossing,
      )
      const resetAdapter = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 2,
        schemaMismatchPolicy: `sync-present-reset`,
      })
      await resetAdapter.loadSubset(
        { kind: `eager`, collectionId: resetId },
        {},
      )
      expect(
        await resetAdapter.reconcileCommittedTx(
          { kind: `eager`, collectionId: resetId },
          tx(`crossing`, 2, 1, 1, `stale`),
          anchor,
        ),
      ).toEqual({ kind: `unknown` })
      const resetSnapshot = await resetAdapter.loadResumeSnapshot({
        kind: `eager`,
        collectionId: resetId,
      })
      expect({
        ids: resetSnapshot.rows.map(({ key }) => key),
        resetEpoch: resetSnapshot.resetEpoch,
        rowVersion: resetSnapshot.latestRowVersion,
      }).toEqual({ ids: [], resetEpoch: 1, rowVersion: 0 })

      const staleId = `source-old-id`
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: staleId },
        crossing,
      )
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: staleId },
        tx(`peer`, 1, 2, 2, `newer`),
      )
      expect(
        await reconcile(
          { kind: `eager`, collectionId: staleId },
          tx(`crossing`, 2, 1, 3, `crossing`),
          {
            latestRowVersion: 1,
            resetEpoch: 0,
          },
        ),
      ).toEqual({ kind: `unknown` })
      expect(await observe(staleId)).toEqual({
        title: `newer`,
        cursor: `newer`,
        rowVersion: 2,
        txIds: [`crossing`, `peer`],
      })

      const malformedId = `source-missing-anchor`
      await expect(async () =>
        reconcile(
          { kind: `eager`, collectionId: malformedId },
          tx(`crossing`, 2, 1, 1, `unsafe`),
          undefined as unknown as CommittedTxAnchor,
        ),
      ).rejects.toThrow(/valid durable anchor/)
      expect(await observe(malformedId)).toEqual({
        title: null,
        cursor: null,
        rowVersion: 0,
        txIds: [],
      })
    }, 30_000)

    /**
     * A cache claim belongs to one physical generation. The reference history
     * keeps the old claim live after rotation, rejects each live claim on the
     * other physical generation, then expires the old one while the new
     * generation remains live. Exact-ID reconciliation and term reservation
     * may use the old generation before expiry; afterward neither operation
     * may advance its durable log. The new claim remains independently usable.
     * This driver observes the returned result and both durable ledgers at
     * each cut, so checking only a rejected promise cannot mask a late write.
     */
    it(`fences reconciliation and term reservation when a cache claim expires`, async () => {
      const { adapter, driver } = registerContractHarness()
      if (
        !adapter.claimCacheGeneration ||
        !adapter.rotateCacheGeneration ||
        !adapter.reconcileCommittedTx ||
        !adapter.reserveLeadershipTerm
      ) {
        throw new Error(`SQLite adapter lacks managed cache operations`)
      }
      const logicalId = `claim-reconciliation`
      const oldClaim = await adapter.claimCacheGeneration(logicalId)
      const oldId = oldClaim.storageCollectionId
      const rotatingClaim = await adapter.claimCacheGeneration(logicalId)
      const newClaim = await adapter.rotateCacheGeneration(
        logicalId,
        rotatingClaim.claimId,
        undefined,
        oldId,
      )
      const newId = newClaim.storageCollectionId
      expect(newId).not.toBe(oldId)
      const candidate = (claimId: string, txId: string): PersistedTx => ({
        txId,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: claimId,
        mutations: [],
      })
      const anchor: CommittedTxAnchor = {
        latestRowVersion: 0,
        resetEpoch: 0,
      }
      const observeLedger = async (collectionId: string) => ({
        terms: await driver.query<{ latest_term: number }>(
          `SELECT latest_term FROM leader_term WHERE collection_id = ?`,
          [collectionId],
        ),
        transactions: await driver.query<{ tx_id: string }>(
          `SELECT tx_id FROM applied_tx WHERE collection_id = ?`,
          [collectionId],
        ),
      })

      // Both claims are live here. Existence and expiry alone do not confer
      // authority over the other physical generation.
      for (const [targetId, wrongClaimId] of [
        [oldId, newClaim.claimId],
        [newId, oldClaim.claimId],
      ] as const) {
        await expect(
          adapter.reserveLeadershipTerm(
            {
              kind: `managed`,
              storageCollectionId: targetId,
              claimId: wrongClaimId,
            },
            0,
            {
              cacheGenerationClaimId: wrongClaimId,
            },
          ),
        ).rejects.toThrow(/cache claim is no longer active/)
        await expect(
          adapter.reconcileCommittedTx(
            {
              kind: `managed`,
              storageCollectionId: targetId,
              claimId: wrongClaimId,
            },
            candidate(wrongClaimId, `wrong-generation`),
            anchor,
          ),
        ).rejects.toThrow(/cache claim is no longer active/)
        expect(await observeLedger(targetId)).toEqual({
          terms: [],
          transactions: [],
        })
      }

      expect(
        await adapter.reserveLeadershipTerm(
          {
            kind: `managed`,
            storageCollectionId: oldId,
            claimId: oldClaim.claimId,
          },
          0,
          {
            cacheGenerationClaimId: oldClaim.claimId,
          },
        ),
      ).toMatchObject({ latestTerm: 1, latestRowVersion: 0 })
      expect(
        await adapter.reconcileCommittedTx(
          {
            kind: `managed`,
            storageCollectionId: oldId,
            claimId: oldClaim.claimId,
          },
          candidate(oldClaim.claimId, `old-commit`),
          anchor,
        ),
      ).toMatchObject({ kind: `applied-now` })
      expect(await observeLedger(oldId)).toEqual({
        terms: [{ latest_term: 1 }],
        transactions: [{ tx_id: `old-commit` }],
      })

      await driver.run(
        `UPDATE cache_generation_claim SET expires_at_ms = 0 WHERE claim_id = ?`,
        [oldClaim.claimId],
      )
      await expect(
        adapter.reconcileCommittedTx(
          {
            kind: `managed`,
            storageCollectionId: oldId,
            claimId: oldClaim.claimId,
          },
          candidate(oldClaim.claimId, `late-commit`),
          { latestRowVersion: 1, resetEpoch: 0 },
        ),
      ).rejects.toThrow(/cache claim is no longer active/)
      await expect(
        adapter.reserveLeadershipTerm(
          {
            kind: `managed`,
            storageCollectionId: oldId,
            claimId: oldClaim.claimId,
          },
          1,
          {
            cacheGenerationClaimId: oldClaim.claimId,
          },
        ),
      ).rejects.toThrow(/cache claim is no longer active/)
      expect(await observeLedger(oldId)).toEqual({
        terms: [{ latest_term: 1 }],
        transactions: [{ tx_id: `old-commit` }],
      })

      expect(
        await adapter.reserveLeadershipTerm(
          {
            kind: `managed`,
            storageCollectionId: newId,
            claimId: newClaim.claimId,
          },
          0,
          {
            cacheGenerationClaimId: newClaim.claimId,
          },
        ),
      ).toMatchObject({ latestTerm: 1, latestRowVersion: 0 })
      expect(
        await adapter.reconcileCommittedTx(
          {
            kind: `managed`,
            storageCollectionId: newId,
            claimId: newClaim.claimId,
          },
          candidate(newClaim.claimId, `new-commit`),
          anchor,
        ),
      ).toMatchObject({ kind: `applied-now` })
      expect(await observeLedger(newId)).toEqual({
        terms: [{ latest_term: 1 }],
        transactions: [{ tx_id: `new-commit` }],
      })
    })

    it(`applies transactions idempotently with row versions and tombstones`, async () => {
      const { adapter, driver } = registerContractHarness()
      const collectionId = `todos`

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
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
                title: `Initial`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 10,
              },
            },
          ],
        },
      )
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `tx-1-replay`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `1`,
              value: {
                id: `1`,
                title: `Initial`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 10,
              },
            },
          ],
        },
      )

      const txRows = await driver.query<{ count: number }>(
        `SELECT COUNT(*) AS count
       FROM applied_tx
       WHERE collection_id = ?`,
        [collectionId],
      )
      expect(txRows[0]?.count).toBe(1)

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `tx-2`,
          term: 1,
          seq: 2,
          rowVersion: 2,
          mutations: [
            {
              type: `update`,
              key: `1`,
              value: {
                id: `1`,
                title: `Updated`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 11,
              },
            },
          ],
        },
      )

      const updated = await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {
          where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(`1`)]),
        },
      )
      expect(updated).toEqual([
        {
          key: `1`,
          value: {
            id: `1`,
            title: `Updated`,
            createdAt: `2026-01-01T00:00:00.000Z`,
            score: 11,
          },
        },
      ])

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `tx-3`,
          term: 1,
          seq: 3,
          rowVersion: 3,
          mutations: [
            {
              type: `delete`,
              key: `1`,
              value: {
                id: `1`,
                title: `Updated`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 11,
              },
            },
          ],
        },
      )

      const remainingRows = await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
      expect(remainingRows).toEqual([])

      const tombstoneTable = createPersistedTableName(collectionId, `t`)
      const tombstoneRows = await driver.query<{
        key: string
        row_version: number
      }>(`SELECT key, row_version FROM "${tombstoneTable}"`)
      expect(tombstoneRows).toHaveLength(1)
      expect(tombstoneRows[0]?.row_version).toBe(3)
    })

    it(`reconstructs a seeded baseline before releasing a partial source update after subset failure`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `partial-source-after-subset-failure`
      const baseline: Todo = {
        id: `1`,
        title: `Persisted baseline`,
        createdAt: `2026-01-01T00:00:00.000Z`,
        score: 10,
      }
      const expected: Todo = { ...baseline, title: `Source update` }
      const cacheClaim = await adapter.claimCacheGeneration?.(collectionId)
      if (!cacheClaim) throw new Error(`Expected managed cache claim`)
      expect(cacheClaim.storageCollectionId).not.toBe(collectionId)
      await adapter.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: cacheClaim.storageCollectionId,
          claimId: cacheClaim.claimId,
        },
        {
          txId: `seed-partial-source-baseline`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          cacheGenerationClaimId: cacheClaim.claimId,
          mutations: [{ type: `insert`, key: baseline.id, value: baseline }],
        },
      )

      const subsetFailure = new Error(`controlled incremental subset failure`)
      const subsetLoad = holdAndRejectFirstSubsetLoad(adapter, subsetFailure)

      let source!: Parameters<SyncConfig<Todo, string>[`sync`]>[0]
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          sync: {
            rowUpdateMode: `partial`,
            sync: (params) => {
              source = params
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter },
        }),
      )
      const project = (row: Todo | undefined) =>
        row && {
          id: row.id,
          title: row.title,
          createdAt: row.createdAt,
          score: row.score,
        }

      let load: Promise<void> | undefined
      let receipt: Promise<void> | undefined
      try {
        await collection.stateWhenReady()
        load = Promise.resolve(collection._sync.loadSubset({ limit: 1 })).then(
          () => undefined,
        )
        void load.catch(() => undefined)
        await subsetLoad.entered

        source.begin()
        source.write({
          type: `update`,
          value: { id: baseline.id, title: expected.title } as Todo,
        })
        receipt = Promise.resolve(source.commit()).then(() => undefined)
        let receiptStatus: `pending` | `fulfilled` | `rejected` = `pending`
        void receipt.then(
          () => {
            receiptStatus = `fulfilled`
          },
          () => {
            receiptStatus = `rejected`
          },
        )
        expect(receiptStatus).toBe(`pending`)

        subsetLoad.release()
        await expect(load).rejects.toBe(subsetFailure)
        await receipt
        const durableBeforeRetry = await adapter.loadSubset(
          {
            kind: `managed`,
            storageCollectionId: cacheClaim.storageCollectionId,
            claimId: cacheClaim.claimId,
          },
          {},
          { cacheGenerationClaimId: cacheClaim.claimId },
        )
        expect({
          receiptStatus,
          status: collection.status,
          publicError: collection._lifecycle.getSyncError(),
          publicBeforeRetry: project(collection.get(baseline.id)),
          durableBeforeRetry: durableBeforeRetry.map(({ value }) => value),
        }).toEqual({
          receiptStatus: `fulfilled`,
          status: `ready`,
          publicError: undefined,
          publicBeforeRetry: expected,
          durableBeforeRetry: [expected],
        })
        expect(
          await adapter.loadSubset(
            { kind: `eager`, collectionId: collectionId },
            {},
          ),
        ).toEqual([])

        await collection._sync.loadSubset({ limit: 1 })
        expect({
          publicAfterRetry: project(collection.get(baseline.id)),
          status: collection.status,
          publicError: collection._lifecycle.getSyncError(),
        }).toEqual({
          publicAfterRetry: expected,
          status: `ready`,
          publicError: undefined,
        })
      } finally {
        subsetLoad.release()
        await load?.catch(() => undefined)
        await receipt?.catch(() => undefined)
        await collection.cleanup()
        await adapter.releaseCacheGenerationClaim?.(cacheClaim.claimId)
      }
    })

    it.each([`delete`, `insert`] as const)(
      `settles a buffered complete %s across subset failure and retry`,
      async (operation) => {
        const { adapter } = registerContractHarness()
        const collectionId = `complete-${operation}-after-subset-failure`
        const row: Todo = {
          id: `1`,
          title: `${operation} row`,
          createdAt: `2026-01-02T00:00:00.000Z`,
          score: 11,
        }
        const cacheClaim = await adapter.claimCacheGeneration?.(collectionId)
        if (!cacheClaim) throw new Error(`Expected managed cache claim`)
        expect(cacheClaim.storageCollectionId).not.toBe(collectionId)
        if (operation === `delete`) {
          await adapter.applyCommittedTx(
            {
              kind: `managed`,
              storageCollectionId: cacheClaim.storageCollectionId,
              claimId: cacheClaim.claimId,
            },
            {
              txId: `seed-delete-baseline`,
              term: 1,
              seq: 1,
              rowVersion: 1,
              cacheGenerationClaimId: cacheClaim.claimId,
              mutations: [{ type: `insert`, key: row.id, value: row }],
            },
          )
        }

        const subsetFailure = new Error(
          `controlled ${operation} subset failure`,
        )
        const subsetLoad = holdAndRejectFirstSubsetLoad(adapter, subsetFailure)

        let source!: Parameters<SyncConfig<Todo, string>[`sync`]>[0]
        const collection = createCollection(
          persistedCollectionOptions<Todo, string>({
            id: collectionId,
            getKey: (value) => value.id,
            syncMode: `on-demand`,
            sync: {
              rowUpdateMode: `partial`,
              sync: (params) => {
                source = params
                params.markReady()
                return { loadSubset: () => true }
              },
            },
            persistence: { adapter },
          }),
        )

        let load: Promise<void> | undefined
        let receipt: Promise<void> | undefined
        try {
          await collection.stateWhenReady()
          load = Promise.resolve(
            collection._sync.loadSubset({ limit: 1 }),
          ).then(() => undefined)
          void load.catch(() => undefined)
          await subsetLoad.entered

          source.begin()
          source.write(
            operation === `delete`
              ? { type: `delete`, key: row.id }
              : { type: `insert`, value: row },
          )
          receipt = Promise.resolve(source.commit()).then(() => undefined)
          let receiptStatus: `pending` | `fulfilled` | `rejected` = `pending`
          void receipt.then(
            () => {
              receiptStatus = `fulfilled`
            },
            () => {
              receiptStatus = `rejected`
            },
          )
          expect(receiptStatus).toBe(`pending`)

          subsetLoad.release()
          await expect(load).rejects.toBe(subsetFailure)
          await receipt
          const expectedRows = operation === `delete` ? [] : [row]
          expect({
            receiptStatus,
            publicRows: [...collection.values()].map((value) => ({
              id: value.id,
              title: value.title,
              createdAt: value.createdAt,
              score: value.score,
            })),
            durableRows: (
              await adapter.loadSubset(
                {
                  kind: `managed`,
                  storageCollectionId: cacheClaim.storageCollectionId,
                  claimId: cacheClaim.claimId,
                },
                {},
                {
                  cacheGenerationClaimId: cacheClaim.claimId,
                },
              )
            ).map(({ value }) => value),
            status: collection.status,
            publicError: collection._lifecycle.getSyncError(),
          }).toEqual({
            receiptStatus: `fulfilled`,
            publicRows: expectedRows,
            durableRows: expectedRows,
            status: `ready`,
            publicError: undefined,
          })
          expect(
            await adapter.loadSubset(
              { kind: `eager`, collectionId: collectionId },
              {},
            ),
          ).toEqual([])

          await collection._sync.loadSubset({ limit: 1 })
          expect({
            publicRows: [...collection.values()].map((value) => ({
              id: value.id,
              title: value.title,
              createdAt: value.createdAt,
              score: value.score,
            })),
            status: collection.status,
            publicError: collection._lifecycle.getSyncError(),
          }).toEqual({
            publicRows: expectedRows,
            status: `ready`,
            publicError: undefined,
          })
        } finally {
          subsetLoad.release()
          await load?.catch(() => undefined)
          await receipt?.catch(() => undefined)
          await collection.cleanup()
          await adapter.releaseCacheGenerationClaim?.(cacheClaim.claimId)
        }
      },
    )

    it(`rolls back partially applied mutations when transaction fails`, async () => {
      const { adapter, driver } = registerContractHarness()
      const collectionId = `atomicity`

      await expect(
        adapter.applyCommittedTx(
          { kind: `eager`, collectionId: collectionId },
          {
            txId: `atomicity-1`,
            term: 1,
            seq: 1,
            rowVersion: 1,
            mutations: [
              {
                type: `insert`,
                key: `1`,
                value: {
                  id: `1`,
                  title: `First`,
                  createdAt: `2026-01-01T00:00:00.000Z`,
                  score: 1,
                },
              },
              {
                type: `insert`,
                key: `2`,
                value: {
                  id: `2`,
                  title: `Second`,
                  createdAt: `2026-01-01T00:00:00.000Z`,
                  score: 2,
                  // Trigger serialization failure after the first mutation executes.
                  unsafeDate: new Date(Number.NaN),
                } as unknown as Todo,
              },
            ],
          },
        ),
      ).rejects.toThrow()

      const rows = await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
      expect(rows).toEqual([])

      const txRows = await driver.query<{ count: number }>(
        `SELECT COUNT(*) AS count
       FROM applied_tx
       WHERE collection_id = ?`,
        [collectionId],
      )
      expect(txRows[0]?.count).toBe(0)
    })

    it(`persists row metadata and collection metadata atomically`, async () => {
      const { adapter, driver } = registerContractHarness()
      const collectionId = `metadata-roundtrip`

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `metadata-1`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `1`,
              value: {
                id: `1`,
                title: `Tracked`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 1,
              },
              metadata: {
                queryCollection: {
                  owners: {
                    q1: true,
                  },
                },
              },
              metadataChanged: true,
            },
          ],
          collectionMetadataMutations: [
            {
              type: `set`,
              key: `electric:resume`,
              value: {
                kind: `resume`,
                offset: `10_0`,
                handle: `handle-1`,
                shapeId: `shape-1`,
                updatedAt: 1,
              },
            },
          ],
        },
      )

      const rows = await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
      expect(rows).toEqual([
        {
          key: `1`,
          value: {
            id: `1`,
            title: `Tracked`,
            createdAt: `2026-01-01T00:00:00.000Z`,
            score: 1,
          },
          metadata: {
            queryCollection: {
              owners: {
                q1: true,
              },
            },
          },
        },
      ])

      const collectionMetadata = await adapter.loadCollectionMetadata?.({
        kind: `eager`,
        collectionId: collectionId,
      })
      expect(collectionMetadata).toEqual([
        {
          key: `electric:resume`,
          value: {
            kind: `resume`,
            offset: `10_0`,
            handle: `handle-1`,
            shapeId: `shape-1`,
            updatedAt: 1,
          },
        },
      ])

      await expect(
        adapter.applyCommittedTx(
          { kind: `eager`, collectionId: collectionId },
          {
            txId: `metadata-2`,
            term: 1,
            seq: 2,
            rowVersion: 2,
            mutations: [
              {
                type: `insert`,
                key: `2`,
                value: {
                  id: `2`,
                  title: `Bad`,
                  createdAt: `2026-01-01T00:00:00.000Z`,
                  score: 2,
                },
              },
            ],
            collectionMetadataMutations: [
              {
                type: `set`,
                key: `broken`,
                value: {
                  invalid: new Date(Number.NaN),
                },
              },
            ],
          },
        ),
      ).rejects.toThrow()

      const rowsAfterFailure = await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
      expect(rowsAfterFailure).toEqual(rows)

      const metadataRows = await driver.query<{ key: string }>(
        `SELECT key
         FROM collection_metadata
         WHERE collection_id = ?`,
        [collectionId],
      )
      expect(metadataRows).toEqual([{ key: `electric:resume` }])
    })

    it(`persists truncate transactions while preserving explicit collection metadata`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `truncate-metadata-roundtrip`

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-1`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `1`,
              value: {
                id: `1`,
                title: `Before truncate`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 1,
              },
              metadata: {
                owner: `before`,
              },
              metadataChanged: true,
            },
          ],
          collectionMetadataMutations: [
            {
              type: `set`,
              key: `electric:resume`,
              value: {
                kind: `resume`,
                offset: `10_0`,
                handle: `handle-1`,
                shapeId: `shape-1`,
                updatedAt: 1,
              },
            },
          ],
        },
      )

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `truncate-2`,
          term: 1,
          seq: 2,
          rowVersion: 2,
          truncate: true,
          mutations: [
            {
              type: `insert`,
              key: `2`,
              value: {
                id: `2`,
                title: `After truncate`,
                createdAt: `2026-01-02T00:00:00.000Z`,
                score: 2,
              },
              metadata: {
                owner: `after`,
              },
              metadataChanged: true,
            },
          ],
          collectionMetadataMutations: [
            {
              type: `set`,
              key: `electric:resume`,
              value: {
                kind: `reset`,
                updatedAt: 2,
              },
            },
          ],
        },
      )

      expect(
        await adapter.loadSubset(
          { kind: `eager`, collectionId: collectionId },
          {},
        ),
      ).toEqual([
        {
          key: `2`,
          value: {
            id: `2`,
            title: `After truncate`,
            createdAt: `2026-01-02T00:00:00.000Z`,
            score: 2,
          },
          metadata: {
            owner: `after`,
          },
        },
      ])

      expect(
        await adapter.loadCollectionMetadata?.({
          kind: `eager`,
          collectionId: collectionId,
        }),
      ).toEqual([
        {
          key: `electric:resume`,
          value: {
            kind: `reset`,
            updatedAt: 2,
          },
        },
      ])
    })

    it(`supports pushdown operators with correctness-preserving fallback`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `todos`

      const rows: Array<Todo> = [
        {
          id: `1`,
          title: `Task Alpha`,
          createdAt: `2026-01-01T00:00:00.000Z`,
          score: 10,
        },
        {
          id: `2`,
          title: `Task Beta`,
          createdAt: `2026-01-02T00:00:00.000Z`,
          score: 20,
        },
        {
          id: `3`,
          title: `Other`,
          createdAt: `2026-01-03T00:00:00.000Z`,
          score: 15,
        },
        {
          id: `4`,
          title: `Task Gamma`,
          createdAt: `2026-01-04T00:00:00.000Z`,
          score: 25,
        },
      ]

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-1`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: rows.map((row) => ({
            type: `insert` as const,
            key: row.id,
            value: row,
          })),
        },
      )

      const filtered = await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {
          where: new IR.Func(`and`, [
            new IR.Func(`or`, [
              new IR.Func(`like`, [
                new IR.PropRef([`title`]),
                new IR.Value(`%Task%`),
              ]),
              new IR.Func(`in`, [new IR.PropRef([`id`]), new IR.Value([`3`])]),
            ]),
            new IR.Func(`eq`, [
              new IR.Func(`date`, [new IR.PropRef([`createdAt`])]),
              new IR.Value(`2026-01-02`),
            ]),
          ]),
          orderBy: [
            {
              expression: new IR.PropRef([`score`]),
              compareOptions: {
                direction: `desc`,
                nulls: `last`,
              },
            },
          ],
        },
      )

      expect(filtered).toEqual([
        {
          key: `2`,
          value: {
            id: `2`,
            title: `Task Beta`,
            createdAt: `2026-01-02T00:00:00.000Z`,
            score: 20,
          },
        },
      ])

      const withInEmpty = await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {
          where: new IR.Func(`in`, [
            new IR.PropRef([`id`]),
            new IR.Value([] as Array<string>),
          ]),
        },
      )
      expect(withInEmpty).toEqual([])
    })

    // At loadSubset completion, persisted fallback ordering must use the exact
    // custom comparator, then direction and public-key tie order. A lexical
    // fallback fails every cell below.
    it.each([
      {
        case: `ascending`,
        direction: `asc` as const,
        compare: (left: string, right: string) => right.localeCompare(left),
        expected: [`zeta`, `middle`, `alpha`],
      },
      {
        case: `descending`,
        direction: `desc` as const,
        compare: (left: string, right: string) => right.localeCompare(left),
        expected: [`alpha`, `middle`, `zeta`],
      },
      {
        case: `comparator-equal key order`,
        direction: `asc` as const,
        compare: () => 0,
        expected: [`zeta`, `alpha`, `middle`],
      },
    ])(
      `applies custom string collation during persisted subset ordering ($case)`,
      async ({ case: caseName, direction, compare, expected }) => {
        const { adapter } = registerContractHarness()
        const collectionId = `custom-collation-order-${caseName}`

        await adapter.applyCommittedTx(
          { kind: `eager`, collectionId: collectionId },
          {
            txId: `seed-custom-collation`,
            term: 1,
            seq: 1,
            rowVersion: 1,
            mutations: [`zeta`, `alpha`, `middle`].map((title, index) => ({
              type: `insert` as const,
              key: String(index),
              value: { id: String(index), title, createdAt: ``, score: index },
            })),
          },
        )

        const rows = await adapter.loadSubset(
          { kind: `eager`, collectionId: collectionId },
          {
            orderBy: [
              {
                expression: new IR.PropRef([`title`]),
                compareOptions: {
                  direction,
                  nulls: `last`,
                  stringSort: `custom`,
                  compare,
                },
              },
            ],
          },
        )

        expect(rows.map(({ value }) => value.title)).toEqual(expected)
      },
    )

    it(`supports datetime/strftime predicate compilation for ISO date fields`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `date-pushdown`

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-date`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `1`,
              value: {
                id: `1`,
                title: `Start`,
                createdAt: `2026-01-02T00:00:00.000Z`,
                score: 1,
              },
            },
            {
              type: `insert`,
              key: `2`,
              value: {
                id: `2`,
                title: `Other`,
                createdAt: `2026-01-03T00:00:00.000Z`,
                score: 2,
              },
            },
          ],
        },
      )

      const rows = await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {
          where: new IR.Func(`and`, [
            new IR.Func(`eq`, [
              new IR.Func(`strftime`, [
                new IR.Value(`%Y-%m-%d`),
                new IR.Func(`datetime`, [new IR.PropRef([`createdAt`])]),
              ]),
              new IR.Value(`2026-01-02`),
            ]),
            new IR.Func(`eq`, [
              new IR.Func(`date`, [new IR.PropRef([`createdAt`])]),
              new IR.Value(`2026-01-02`),
            ]),
          ]),
        },
      )

      expect(rows.map((row) => row.key)).toEqual([`1`])
    })

    it(`persists bigint/date values and evaluates typed predicates`, async () => {
      const { adapter } = registerContractHarness()
      const typedAdapter = adapter as unknown as PersistenceAdapter
      const collectionId = `typed-values`
      const firstBigInt = BigInt(`9007199254740992`)
      const secondBigInt = BigInt(`9007199254740997`)

      await typedAdapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-typed-values`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `1`,
              value: {
                id: `1`,
                title: `Alpha`,
                createdAt: new Date(`2026-01-02T00:00:00.000Z`),
                largeViewCount: firstBigInt,
              },
            },
            {
              type: `insert`,
              key: `2`,
              value: {
                id: `2`,
                title: `Beta`,
                createdAt: new Date(`2026-01-03T00:00:00.000Z`),
                largeViewCount: secondBigInt,
              },
            },
          ],
        },
      )

      const bigintRows = await typedAdapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {
          where: new IR.Func(`gt`, [
            new IR.PropRef([`largeViewCount`]),
            new IR.Value(BigInt(`9007199254740993`)),
          ]),
        },
      )
      expect(bigintRows.map((row) => row.key)).toEqual([`2`])

      const dateRows = await typedAdapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {
          where: new IR.Func(`gt`, [
            new IR.PropRef([`createdAt`]),
            new IR.Value(new Date(`2026-01-02T12:00:00.000Z`)),
          ]),
        },
      )
      expect(dateRows.map((row) => row.key)).toEqual([`2`])

      const restoredRows = await typedAdapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {
          where: new IR.Func(`eq`, [
            new IR.Func(`date`, [new IR.PropRef([`createdAt`])]),
            new IR.Value(`2026-01-02`),
          ]),
        },
      )
      const firstRow = restoredRows[0]?.value
      expect(firstRow?.createdAt).toBeInstanceOf(Date)
      expect(firstRow?.largeViewCount).toBe(firstBigInt)
    })

    it(`handles cursor whereCurrent/whereFrom requests`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `todos`

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-cursor`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `a`,
              value: {
                id: `a`,
                title: `A`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 10,
              },
            },
            {
              type: `insert`,
              key: `b`,
              value: {
                id: `b`,
                title: `B`,
                createdAt: `2026-01-02T00:00:00.000Z`,
                score: 10,
              },
            },
            {
              type: `insert`,
              key: `c`,
              value: {
                id: `c`,
                title: `C`,
                createdAt: `2026-01-03T00:00:00.000Z`,
                score: 12,
              },
            },
            {
              type: `insert`,
              key: `d`,
              value: {
                id: `d`,
                title: `D`,
                createdAt: `2026-01-04T00:00:00.000Z`,
                score: 13,
              },
            },
          ],
        },
      )

      const rows = await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {
          orderBy: [
            {
              expression: new IR.PropRef([`score`]),
              compareOptions: {
                direction: `asc`,
                nulls: `last`,
              },
            },
          ],
          limit: 1,
          cursor: {
            whereCurrent: new IR.Func(`eq`, [
              new IR.PropRef([`score`]),
              new IR.Value(10),
            ]),
            whereFrom: new IR.Func(`gt`, [
              new IR.PropRef([`score`]),
              new IR.Value(10),
            ]),
          },
        },
      )

      expect(rows.map((row) => row.key)).toEqual([`a`, `b`, `c`])
    })

    it(`ensures and removes persisted indexes with registry tracking`, async () => {
      const { adapter, driver } = registerContractHarness()
      const collectionId = `todos`
      const signature = `idx-title`

      await adapter.ensureIndex(
        { kind: `eager`, collectionId: collectionId },
        signature,
        {
          expressionSql: [`json_extract(value, '$.title')`],
        },
      )
      await adapter.ensureIndex(
        { kind: `eager`, collectionId: collectionId },
        signature,
        {
          expressionSql: [`json_extract(value, '$.title')`],
        },
      )

      const registryRows = await driver.query<{
        removed: number
        index_name: string
      }>(
        `SELECT removed, index_name
       FROM persisted_index_registry
       WHERE collection_id = ? AND signature = ?`,
        [collectionId, signature],
      )
      expect(registryRows).toHaveLength(1)
      expect(registryRows[0]?.removed).toBe(0)

      const createdIndexName = registryRows[0]?.index_name
      const sqliteMasterBefore = await driver.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
        [createdIndexName],
      )
      expect(sqliteMasterBefore).toHaveLength(1)

      if (!adapter.markIndexRemoved) {
        throw new Error(
          `Adapter must implement markIndexRemoved for this contract suite`,
        )
      }
      await adapter.markIndexRemoved(
        { kind: `eager`, collectionId: collectionId },
        signature,
      )

      const registryRowsAfter = await driver.query<{ removed: number }>(
        `SELECT removed
       FROM persisted_index_registry
       WHERE collection_id = ? AND signature = ?`,
        [collectionId, signature],
      )
      expect(registryRowsAfter[0]?.removed).toBe(1)

      const sqliteMasterAfter = await driver.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
        [createdIndexName],
      )
      expect(sqliteMasterAfter).toHaveLength(0)
    })

    it(`rebuilds a physical index when the normalized spec changes`, async () => {
      const { adapter, driver } = registerContractHarness()
      const collectionId = `todos`
      const signature = `idx-upgraded-expression`

      await adapter.ensureIndex(
        { kind: `eager`, collectionId: collectionId },
        signature,
        {
          expressionSql: [`json_extract(value, '$.title')`],
        },
      )

      const registryRows = await driver.query<{ index_name: string }>(
        `SELECT index_name
         FROM persisted_index_registry
         WHERE collection_id = ? AND signature = ?`,
        [collectionId, signature],
      )
      const indexName = registryRows[0]?.index_name
      expect(indexName).toBeTruthy()

      await adapter.ensureIndex(
        { kind: `eager`, collectionId: collectionId },
        signature,
        {
          expressionSql: [`json_extract(value, '$.score')`],
        },
      )

      const sqliteMasterRows = await driver.query<{ sql: string }>(
        `SELECT sql
         FROM sqlite_master
         WHERE type = 'index' AND name = ?`,
        [indexName],
      )
      expect(sqliteMasterRows).toHaveLength(1)
      expect(sqliteMasterRows[0]?.sql).toContain(
        `json_extract(value, '$.score')`,
      )
      expect(sqliteMasterRows[0]?.sql).not.toContain(
        `json_extract(value, '$.title')`,
      )
    })

    it(`enforces schema mismatch policies`, async () => {
      const baseHarness = registerContractHarness({
        schemaVersion: 1,
        schemaMismatchPolicy: `reset`,
      })
      const collectionId = `todos`
      await baseHarness.adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-schema`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `1`,
              value: {
                id: `1`,
                title: `Before mismatch`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 1,
              },
            },
          ],
        },
      )

      const strictAdapter = new SQLiteCorePersistenceAdapter({
        driver: baseHarness.driver,
        schemaVersion: 2,
        schemaMismatchPolicy: `sync-absent-error`,
      })
      await expect(
        strictAdapter.loadSubset(
          { kind: `eager`, collectionId: collectionId },
          {},
        ),
      ).rejects.toThrow(/Schema version mismatch/)

      const resetAdapter = new SQLiteCorePersistenceAdapter({
        driver: baseHarness.driver,
        schemaVersion: 2,
        schemaMismatchPolicy: `sync-present-reset`,
      })
      const resetRows = await resetAdapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
      expect(resetRows).toEqual([])
    })

    runSQLiteResetResumeOracleTests(harnessFactory)

    it(`returns pullSince deltas and requiresFullReload when threshold is exceeded`, async () => {
      const { adapter } = registerContractHarness({
        pullSinceReloadThreshold: 1,
      })
      const collectionId = `todos`

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-pull`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `1`,
              value: {
                id: `1`,
                title: `One`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 1,
              },
            },
            {
              type: `insert`,
              key: `2`,
              value: {
                id: `2`,
                title: `Two`,
                createdAt: `2026-01-02T00:00:00.000Z`,
                score: 2,
              },
            },
          ],
        },
      )
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-pull-2`,
          term: 1,
          seq: 2,
          rowVersion: 2,
          mutations: [
            {
              type: `delete`,
              key: `1`,
              value: {
                id: `1`,
                title: `One`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 1,
              },
            },
          ],
        },
      )

      const delta = await adapter.pullSince({ kind: `eager`, collectionId }, 1)
      if (delta.requiresFullReload) {
        throw new Error(`Expected key-level delta, received full reload`)
      }
      expect(delta.changedKeys).toEqual([])
      expect(delta.deletedKeys).toEqual([`1`])
      expect(delta.deltas).toEqual([
        {
          txId: `seed-pull-2`,
          latestRowVersion: 2,
          changedRows: [],
          deletedKeys: [`1`],
          rowMetadataMutations: [],
          collectionMetadataMutations: [],
        },
      ])

      const fullReload = await adapter.pullSince(
        { kind: `eager`, collectionId },
        0,
      )
      expect(fullReload.requiresFullReload).toBe(true)
    })

    it(`scans persisted rows with metadata and replays metadata-only deltas`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `scan-and-replay`

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `scan-seed-1`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `1`,
              value: {
                id: `1`,
                title: `Tracked`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 1,
              },
              metadata: {
                queryCollection: {
                  owners: {
                    q1: true,
                  },
                },
              },
              metadataChanged: true,
            },
          ],
        },
      )

      const scannedRows = await adapter.scanRows?.(
        { kind: `eager`, collectionId: collectionId },
        {
          metadataOnly: true,
        },
      )
      expect(scannedRows).toEqual([
        {
          key: `1`,
          value: {
            id: `1`,
            title: `Tracked`,
            createdAt: `2026-01-01T00:00:00.000Z`,
            score: 1,
          },
          metadata: {
            queryCollection: {
              owners: {
                q1: true,
              },
            },
          },
        },
      ])

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `scan-seed-2`,
          term: 1,
          seq: 2,
          rowVersion: 2,
          mutations: [],
          rowMetadataMutations: [
            {
              type: `set`,
              key: `1`,
              value: {
                queryCollection: {
                  owners: {
                    q2: true,
                  },
                },
              },
            },
          ],
          collectionMetadataMutations: [
            {
              type: `set`,
              key: `electric:resume`,
              value: {
                kind: `reset`,
                updatedAt: 2,
              },
            },
          ],
        },
      )

      const replayDelta = await adapter.pullSince(
        { kind: `eager`, collectionId },
        1,
      )
      if (replayDelta.requiresFullReload) {
        throw new Error(`Expected replay delta, received full reload`)
      }

      expect(replayDelta.deltas).toEqual([
        {
          txId: `scan-seed-2`,
          latestRowVersion: 2,
          changedRows: [],
          deletedKeys: [],
          rowMetadataMutations: [
            {
              type: `set`,
              key: `1`,
              value: {
                queryCollection: {
                  owners: {
                    q2: true,
                  },
                },
              },
            },
          ],
          collectionMetadataMutations: [
            {
              type: `set`,
              key: `electric:resume`,
              value: {
                kind: `reset`,
                updatedAt: 2,
              },
            },
          ],
        },
      ])
    })

    it(`keeps numeric and string keys distinct in storage`, async () => {
      const { driver } = registerContractHarness()
      const adapter = new SQLiteCorePersistenceAdapter({
        driver,
      })
      const collectionId = `mixed-keys`

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `mixed-1`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: 1,
              value: {
                id: 1,
                title: `Numeric`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 1,
              },
            },
            {
              type: `insert`,
              key: `1`,
              value: {
                id: `1`,
                title: `String`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 2,
              },
            },
          ],
        },
      )

      const rows = await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
      expect(rows).toHaveLength(2)
      expect(rows.some((row) => row.key === 1)).toBe(true)
      expect(rows.some((row) => row.key === `1`)).toBe(true)
    })

    it(`stores hostile collection ids safely via deterministic table mapping`, async () => {
      const { adapter, driver } = registerContractHarness()
      const hostileCollectionId = `todos"; DROP TABLE applied_tx; --`

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: hostileCollectionId },
        {
          txId: `hostile-1`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `safe`,
              value: {
                id: `safe`,
                title: `Safe`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 1,
              },
            },
          ],
        },
      )

      const registryRows = await driver.query<{ table_name: string }>(
        `SELECT table_name
       FROM collection_registry
       WHERE collection_id = ?`,
        [hostileCollectionId],
      )
      expect(registryRows).toHaveLength(1)
      expect(registryRows[0]?.table_name).toMatch(/^c_[a-z2-7]+_[0-9a-z]+$/)

      const loadedRows = await adapter.loadSubset(
        { kind: `eager`, collectionId: hostileCollectionId },
        {},
      )
      expect(loadedRows).toHaveLength(1)
      expect(loadedRows[0]?.key).toBe(`safe`)
    })

    it(`deduplicates concurrent ensureCollectionReady calls for the same collection`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `concurrent-startup`

      const [rowsA, rowsB] = await Promise.all([
        adapter.loadSubset({ kind: `eager`, collectionId: collectionId }, {}),
        adapter.loadSubset({ kind: `eager`, collectionId: collectionId }, {}),
      ])

      expect(rowsA).toEqual([])
      expect(rowsB).toEqual([])

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `concurrent-startup-seed`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `1`,
              value: {
                id: `1`,
                title: `Seeded`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 1,
              },
            },
          ],
        },
      )

      const loadedRows = await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
      expect(loadedRows).toHaveLength(1)
      expect(loadedRows[0]?.key).toBe(`1`)
    })

    it(`prunes applied_tx rows by sequence threshold`, async () => {
      const { adapter, driver } = registerContractHarness({
        appliedTxPruneMaxRows: 2,
      })
      const collectionId = `pruning`

      for (let seq = 1; seq <= 4; seq++) {
        await adapter.applyCommittedTx(
          { kind: `eager`, collectionId: collectionId },
          {
            txId: `prune-${seq}`,
            term: 1,
            seq,
            rowVersion: seq,
            mutations: [
              {
                type: `insert`,
                key: `k-${seq}`,
                value: {
                  id: `k-${seq}`,
                  title: `Row ${seq}`,
                  createdAt: `2026-01-01T00:00:00.000Z`,
                  score: seq,
                },
              },
            ],
          },
        )
      }

      const appliedRows = await driver.query<{ seq: number }>(
        `SELECT seq
       FROM applied_tx
       WHERE collection_id = ?
       ORDER BY seq ASC`,
        [collectionId],
      )
      expect(appliedRows.map((row) => row.seq)).toEqual([3, 4])
    })

    it(`prunes applied_tx rows by age threshold when configured`, async () => {
      const { adapter, driver } = registerContractHarness({
        appliedTxPruneMaxAgeSeconds: 1,
      })
      const collectionId = `pruning-by-age`

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `age-1`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `old`,
              value: {
                id: `old`,
                title: `Old`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 1,
              },
            },
          ],
        },
      )

      await driver.run(
        `UPDATE applied_tx
       SET applied_at = 0
       WHERE collection_id = ? AND seq = 1`,
        [collectionId],
      )

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `age-2`,
          term: 1,
          seq: 2,
          rowVersion: 2,
          mutations: [
            {
              type: `insert`,
              key: `new`,
              value: {
                id: `new`,
                title: `New`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 2,
              },
            },
          ],
        },
      )

      const appliedRows = await driver.query<{ seq: number }>(
        `SELECT seq
       FROM applied_tx
       WHERE collection_id = ?
       ORDER BY seq ASC`,
        [collectionId],
      )
      expect(appliedRows.map((row) => row.seq)).toEqual([2])
    })

    it(`supports large IN lists within the driver's binding cap`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `large-in`

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-large-in`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `2`,
              value: {
                id: `2`,
                title: `Two`,
                createdAt: `2026-01-02T00:00:00.000Z`,
                score: 2,
              },
            },
            {
              type: `insert`,
              key: `4`,
              value: {
                id: `4`,
                title: `Four`,
                createdAt: `2026-01-04T00:00:00.000Z`,
                score: 4,
              },
            },
          ],
        },
      )

      const largeIds = Array.from(
        { length: 1200 },
        (_value, index) => `miss-${index}`,
      )
      largeIds[100] = `2`
      largeIds[1100] = `4`

      const rows = await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {
          where: new IR.Func(`in`, [
            new IR.PropRef([`id`]),
            new IR.Value(largeIds),
          ]),
          orderBy: [
            {
              expression: new IR.PropRef([`id`]),
              compareOptions: {
                direction: `asc`,
                nulls: `last`,
              },
            },
          ],
        },
      )

      expect(rows.map((row) => row.key)).toEqual([`2`, `4`])
    })

    it(`falls back to in-memory filtering when SQL json path pushdown is unsupported`, async () => {
      const { driver } = registerContractHarness()
      const adapter = new SQLiteCorePersistenceAdapter({
        driver,
      })
      const collectionId = `fallback-where`

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-fallback`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `1`,
              value: {
                id: `1`,
                title: `Keep`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 1,
                [`meta-field`]: `alpha`,
              },
            },
            {
              type: `insert`,
              key: `2`,
              value: {
                id: `2`,
                title: `Drop`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 2,
                [`meta-field`]: `beta`,
              },
            },
          ],
        },
      )

      const rows = await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {
          where: new IR.Func(`eq`, [
            new IR.PropRef([`meta-field`]),
            new IR.Value(`alpha`),
          ]),
        },
      )

      expect(rows.map((row) => row.key)).toEqual([`1`])
    })

    it(`supports alias-qualified refs during in-memory fallback filtering`, async () => {
      const { driver } = registerContractHarness()
      const adapter = new SQLiteCorePersistenceAdapter({
        driver,
      })
      const collectionId = `fallback-alias-qualified-ref`

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-alias-fallback`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `1`,
              value: {
                id: `1`,
                title: `Keep`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 1,
                [`meta-field`]: `alpha`,
              },
            },
            {
              type: `insert`,
              key: `2`,
              value: {
                id: `2`,
                title: `Drop`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 2,
                [`meta-field`]: `beta`,
              },
            },
          ],
        },
      )

      // `meta-field` makes SQL pushdown unsupported, so filter correctness comes
      // from the in-memory evaluator. The explicit source alias is the only
      // signal that the leading `todos` segment is qualification.
      const rows = await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {
          where: new IR.Func(`eq`, [
            new IR.PropRef([`todos`, `meta-field`], `todos`),
            new IR.Value(`alpha`),
          ]),
        },
      )

      expect(rows.map((row) => row.key)).toEqual([`1`])
    })

    it(`does not guess that a legacy fallback path is an alias`, async () => {
      const { driver } = registerContractHarness()
      const adapter = new SQLiteCorePersistenceAdapter({ driver })
      const collectionId = `fallback-legacy-nested-ref`

      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-legacy-nested-fallback`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `nested-match`,
              value: {
                profile: { [`meta-field`]: `alpha` },
                [`meta-field`]: `flat-other`,
              },
            },
            {
              type: `insert`,
              key: `flat-only`,
              value: { [`meta-field`]: `alpha` },
            },
          ],
        },
      )

      const rows = await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {
          where: new IR.Func(`eq`, [
            new IR.PropRef([`profile`, `meta-field`]),
            new IR.Value(`alpha`),
          ]),
        },
      )

      expect(rows.map((row) => row.key)).toEqual([`nested-match`])
    })

    it(`compiles serialized expression index specs used by phase-2 metadata`, async () => {
      const { adapter, driver } = registerContractHarness()
      const collectionId = `serialized-index`
      const signature = `serialized-title`

      await adapter.ensureIndex(
        { kind: `eager`, collectionId: collectionId },
        signature,
        {
          expressionSql: [
            JSON.stringify({
              type: `ref`,
              path: [`title`],
            }),
          ],
        },
      )

      const registryRows = await driver.query<{ index_name: string }>(
        `SELECT index_name
       FROM persisted_index_registry
       WHERE collection_id = ? AND signature = ?`,
        [collectionId, signature],
      )
      const indexName = registryRows[0]?.index_name
      expect(indexName).toBeTruthy()

      const sqliteMasterRows = await driver.query<{ sql: string }>(
        `SELECT sql
       FROM sqlite_master
       WHERE type = 'index' AND name = ?`,
        [indexName],
      )
      expect(sqliteMasterRows).toHaveLength(1)
      expect(sqliteMasterRows[0]?.sql).toContain(
        `json_extract(value, '$.title')`,
      )
    })

    it(`rejects unsafe raw SQL fragments in index specs`, async () => {
      const { adapter } = registerContractHarness()

      await expect(
        adapter.ensureIndex(
          { kind: `eager`, collectionId: `unsafe-index` },
          `unsafe`,
          {
            expressionSql: [
              `json_extract(value, '$.title'); DROP TABLE applied_tx`,
            ],
          },
        ),
      ).rejects.toThrow(/Invalid persisted index SQL fragment/)
    })
  })
}
