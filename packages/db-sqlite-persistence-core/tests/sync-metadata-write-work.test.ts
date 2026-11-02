import { createCollection } from '@tanstack/db'
import { expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import {
  completedSeedReinsertReloadRegime,
  keptMetadataDurabilityHistoriesArbitrary,
  seedReinsertReloadHistoryArbitrary,
} from '../../db/tests/sync-metadata-session-oracle'
import { persistedCollectionOptions } from '../src'
import type { SyncConfig } from '@tanstack/db'
import type { PersistedTx, PersistenceAdapter } from '../src'

type Row = { id: number; v: number }
type Actions = Parameters<SyncConfig<Row, number>[`sync`]>[0]

it(`measures the previous scarce branch and the constructive replacement`, () => {
  for (const seed of [-704889444, 527962096, 1, 2, 3]) {
    const old = fc.sample(seedReinsertReloadHistoryArbitrary, {
      seed,
      numRuns: 40,
    })
    const count = old.filter(
      (history) =>
        completedSeedReinsertReloadRegime(history, {
          mismatch: undefined,
          steps: history.length,
        }) === `completed kept bare seed reload`,
    ).length
    const next = fc.sample(keptMetadataDurabilityHistoriesArbitrary, {
      seed,
      numRuns: 8,
    })
    const bareImplicit = next
      .flat()
      .filter((entry) => entry.bare && !entry.metadata).length
    console.info(
      `METADATA_GENERATOR ${JSON.stringify({ seed, oldBareCompletedPremise: count, newBareImplicitHistories: bareImplicit })}`,
    )
    expect(bareImplicit).toBe(24)
  }
})

it.each([2, 100, 10_000])(
  `counts implicit keeps in an unchanged %i-row refresh`,
  async (count) => {
    const transactions: Array<PersistedTx> = []
    const adapter: PersistenceAdapter = {
      loadSubset: async () => [],
      loadResumeSnapshot: async () => ({
        rows: [],
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }),
      applyCommittedTx: async (_target, tx) => {
        transactions.push(tx)
      },
      ensureIndex: async () => {},
    }
    let source!: Actions
    const collection = createCollection(
      persistedCollectionOptions<Row, number>({
        id: `external-work-${count}`,
        getKey: (row) => row.id,
        sync: {
          sync: (actions) => {
            source = actions
            actions.markReady()
          },
        },
        persistence: { adapter },
      }),
    )
    try {
      await collection.preload()
      source.begin()
      for (let id = 0; id < count; id++)
        source.write({
          type: `insert`,
          value: { id, v: id },
          metadata: { v: id },
        })
      await source.commit()
      source.begin()
      for (let id = 0; id < count; id++)
        source.write({ type: `insert`, value: { id, v: id } })
      await source.commit()
      const latest = transactions.at(-1)!
      console.info(
        `METADATA_WORK ${JSON.stringify({ count, rowMutations: latest.mutations.length, metadataMutations: latest.rowMetadataMutations?.length ?? 0 })}`,
      )
      expect(latest.rowMetadataMutations?.length ?? 0).toBe(0)
    } finally {
      await collection.cleanup()
    }
  },
)
