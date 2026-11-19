import { createCollection } from '@tanstack/db'
import { expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import {
  keptMetadataDurabilityHistoriesArbitrary,
  modelCheckpoints,
  persistedPeerFullGrammar,
  persistedPeerGrammar,
  persistedPeerOnDemandGrammar,
  queuedMetadataRepairHistoriesArbitrary,
} from '../../db/tests/sync-metadata-session-oracle'
import { persistedCollectionOptions } from '../src'
import type { SyncConfig } from '@tanstack/db'
import type { PersistedTx, PersistenceAdapter } from '../src'

type Row = { id: number; v: number }
type Actions = Parameters<SyncConfig<Row, number>[`sync`]>[0]

// Calibrate the grammar against its declared premises, not only entry labels.
// Deleting a notice, seed or explicit write must fail even if labels survive.
it(`constructs every declared metadata premise as a legal history`, async () => {
  const expected = new Set<string>()
  for (const write of [`update`, `reinsert`, `inner-reinsert`])
    for (const bare of [false, true])
      for (const metadata of [false, true])
        for (const notice of [`none`, `row`, `reload`])
          expected.add(`${write}/${bare}/${metadata}/${notice}`)
  for (const seed of [-704889444, 527962096, 1, 2, 3]) {
    for (const batch of fc.sample(queuedMetadataRepairHistoriesArbitrary, {
      seed,
      numRuns: 8,
    })) {
      expect(new Set(batch.map(({ bare, held }) => `${bare}/${held}`))).toEqual(
        new Set([`false/false`, `false/true`, `true/false`, `true/true`]),
      )
      expect(batch).toHaveLength(4)
      for (const { bare, held, history } of batch) {
        expect(history.find((action) => action.type === `seed`)?.bare).toBe(
          bare,
        )
        expect(
          history.some((action) => action.type === `hold` && action.store),
        ).toBe(held)
        expect(history.some((action) => action.type === `release`)).toBe(held)
        expect(
          history.filter((action) => action.type === `commit`),
        ).toHaveLength(2)
        expect(history.some((action) => action.type === `rowSet`)).toBe(true)
        expect(
          (await modelCheckpoints(persistedPeerGrammar, history)).size,
        ).toBe(history.length)
      }
    }
    for (const batch of fc.sample(keptMetadataDurabilityHistoriesArbitrary, {
      seed,
      numRuns: 8,
    })) {
      expect(
        new Set(
          batch.map(
            (entry) =>
              `${entry.write}/${entry.bare}/${entry.metadata}/${entry.notice}`,
          ),
        ),
      ).toEqual(expected)
      expect(batch).toHaveLength(expected.size)
      for (const entry of batch) {
        const { history, write, bare, metadata, notice } = entry
        const seeds = history.filter((action) => action.type === `seed`)
        expect(seeds).toHaveLength(1)
        expect(seeds[0]!.bare).toBe(bare)
        const peers = history.filter((action) => action.type === `peer`)
        expect(peers.map((action) => action.notice)).toEqual(
          notice === `none` ? [] : [notice],
        )
        const explicit = history.filter(
          (action) =>
            action.type === `rowSet` ||
            (action.type === `reinsert` && action.metadata),
        )
        expect(explicit.length > 0).toBe(metadata)
        const reinserts = history.filter((action) => action.type === `reinsert`)
        expect(reinserts.length > 0).toBe(write !== `update`)
        const prefix = history.slice(
          0,
          history.findIndex((action) => action.type === `commit`),
        )
        const depth = prefix.filter((action) => action.type === `begin`).length
        expect(depth).toBe(write === `inner-reinsert` ? 2 : 1)
        for (const productionPath of [
          persistedPeerGrammar,
          persistedPeerFullGrammar,
          persistedPeerOnDemandGrammar,
        ])
          expect((await modelCheckpoints(productionPath, history)).size).toBe(
            history.length,
          )
      }
    }
  }
}, 120_000)

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
