import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { DbClient, collectionOptions } from '../src/client.js'
import { createCollection } from '../src/collection/index.js'
import {
  absentMarker,
  createSessionModel,
  flatGrammar,
  historyRegimes,
  modelCheckpoints,
  nestedGrammar,
  persistedPeerGrammar,
  runSessionHistory,
  seedGrammar,
  sessionHistoryArbitrary,
} from './sync-metadata-session-oracle.js'
import { witnesses } from './sync-metadata-session-witness-grammar-oracle.js'
import type {
  SessionAction,
  SessionDriver,
  SessionGrammar,
  SessionModel,
} from './sync-metadata-session-oracle.js'
import type { SyncConfig } from '../src/types.js'

// Fixed boundaries of the sync metadata session. The session law itself is
// owned by sync-metadata-session-oracle.ts and its generated histories.

type Row = { id: number; v: unknown }
type SyncActions = Parameters<SyncConfig<Row, number>[`sync`]>[0]

// This tests runner ordering, rather than introducing another product model.
it(`consumes completed setup inputs before authored actions`, async () => {
  const order: Array<string> = []
  let setup = true
  const observation = createSessionModel(persistedPeerGrammar).observe()
  const driver: SessionDriver = {
    begin: () => {
      order.push(`action`)
    },
    commit: () => {},
    cancel: () => {},
    rowSet: () => {},
    rowDelete: () => {},
    insert: () => {},
    update: () => {},
    delete: () => {},
    truncate: () => {},
    collectionSet: () => {},
    collectionDelete: () => {},
    hold: () => {},
    release: () => Promise.resolve(),
    flush: () => Promise.resolve(),
    settle: () => Promise.resolve([]),
    cleanup: () => Promise.resolve(),
    observe: () => observation,
    takeRecoveryInputs: () => {
      order.push(`recovery`)
      if (!setup) return []
      setup = false
      return [
        {
          type: `unknown-storage-observation`,
          fromRowVersion: 0,
          latestRowVersion: 1,
        },
      ]
    },
  }
  const result = await runSessionHistory(
    persistedPeerGrammar,
    [{ type: `begin` }],
    () => Promise.resolve(driver),
  )
  expect(result.mismatch).toBeUndefined()
  expect(order[0]).toBe(`recovery`)
  expect(order[1]).toBe(`action`)
  expect(result.recoveryInputs).toHaveLength(1)
})

/**
 * Boundary witnesses for P11. A sync run that cleanup has ended reads nothing
 * and ignores writes; a metadata write with no open transaction throws.
 */
describe(`sync metadata session boundaries`, () => {
  it(`a stale sync run reads nothing and ignores writes`, async () => {
    let sync!: SyncActions
    const collection = createCollection<Row, number>({
      id: `sync-metadata-session-stale`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: (actions) => {
          sync = actions
          actions.begin()
          actions.metadata!.row.set(1, { m: 1 })
          actions.metadata!.collection.set(`cursor`, 1)
          actions.commit()
          actions.markReady()
        },
      },
    })
    await collection.preload()
    expect(sync.metadata!.collection.get(`cursor`)).toBe(1)
    const stale = sync
    await collection.cleanup()
    expect(stale.metadata!.row.get(1)).toBeUndefined()
    expect(stale.metadata!.collection.get(`cursor`)).toBeUndefined()
    expect(stale.metadata!.collection.list()).toEqual([])
    expect(() => stale.metadata!.collection.set(`cursor`, 2)).not.toThrow()
  })

  // Cleanup abandons a held seed; its receipt is internal, so the abandonment
  // must not surface as an unhandled rejection.
  it(`cleanup with a held seed leaves no unhandled rejection`, async () => {
    const unhandled: Array<unknown> = []
    const listener = (reason: unknown) => unhandled.push(reason)
    process.on(`unhandledRejection`, listener)
    let release!: () => void
    const client = new DbClient()
    const collection = client.collection(
      collectionOptions<Row, number>({
        id: `sync-metadata-session-held-seed-cleanup`,
        getKey: (row) => row.id,
        sync: {
          sync: (actions) => {
            actions.begin()
            actions.commit()
            actions.markReady()
          },
        },
        onInsert: () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      }),
    )
    try {
      await collection.preload()
      collection.insert({ id: 1000, v: 0 })
      client.hydrate({
        collections: [
          {
            collectionId: `sync-metadata-session-held-seed-cleanup`,
            rows: [{ key: 1, value: { id: 1, v: 1 }, metadata: { m: 1 } }],
          },
        ],
      })
      await collection.cleanup()
      release()
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      process.off(`unhandledRejection`, listener)
    }
    expect(unhandled).toEqual([])
  })

  it(`a metadata write with no open transaction throws`, async () => {
    let sync!: SyncActions
    const collection = createCollection<Row, number>({
      id: `sync-metadata-session-no-transaction`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: (actions) => {
          sync = actions
          actions.begin()
          actions.commit()
          actions.markReady()
        },
      },
    })
    try {
      await collection.preload()
      expect(() => sync.metadata!.row.set(1, { m: 1 })).toThrow()
      expect(() => sync.metadata!.collection.set(`cursor`, 1)).toThrow()
    } finally {
      await collection.cleanup()
    }
  })
})

// Moved from sync-metadata-session-oracle.property.test.ts: the model's
// checkpoints on the named witnesses, against expectations derived by hand
// from the laws. It runs no production.
describe(`sync metadata session oracle`, () => {
  it(`derives the named witnesses from the laws`, async () => {
    type Observation = ReturnType<SessionModel[`observe`]>
    const at = async (name: keyof typeof witnesses, step: number) => {
      const { grammar, history } = witnesses[name]
      return (await modelCheckpoints(grammar, history)).get(step) as Observation
    }
    // Wrong answer on 30175be48: the held cursor reads as absent.
    const held = await at(`heldCursor`, 6)
    expect(held.collection.cursor).toEqual({ s: 2 })
    expect(held.base[1]).toBe(absentMarker)
    // Wrong answer: the open transaction hides every held write.
    const open = await at(`openOverHeld`, 5)
    expect(open.rowMetadata[1]).toEqual({ s: 2 })
    expect(open.prefixList).toEqual([[`gc:a`, { s: 3 }]])
    // Wrong answer under closed nesting: the outer abort undoes the inner
    // commit, and its receipt waits for the outer commit.
    const innerCommitted = await at(`outerAbortKeepsInnerCommit`, 3)
    const insertedRow = { id: 1, v: { s: 2 }, m: { s: 2 } }
    expect(innerCommitted.rowMetadata[1]).toEqual({ s: 2 })
    expect(innerCommitted.base[1]).toEqual(insertedRow)
    expect(innerCommitted.receipts).toEqual([`applied`])
    const outerAborted = await at(`outerAbortKeepsInnerCommit`, 4)
    expect(outerAborted.rowMetadata[1]).toEqual({ s: 2 })
    expect(outerAborted.base[1]).toEqual(insertedRow)
    // Wrong answers: issue order (the inner write wins), and on 30175be48 a
    // held inner commit read over the open outer write and applied after it.
    expect((await at(`commitOrderDuringHold`, 4)).rowMetadata[1]).toEqual({
      s: 4,
    })
    expect((await at(`commitOrderDuringHold`, 5)).rowMetadata[1]).toEqual({
      s: 2,
    })
    const released = await at(`commitOrderDuringHold`, 7)
    expect(released.rowMetadata[1]).toEqual({ s: 2 })
    expect(released.receipts).toEqual([`applied`, `applied`])
    // Wrong answer on 30175be48: the outer transaction cannot write after an
    // inner one commits during a hold.
    const continued = await at(`outerContinuesAfterInnerDuringHold`, 6)
    expect(continued.rowMetadata).toEqual({ 1: { s: 3 }, 2: { s: 5 } })
    expect(continued.receipts).toEqual([`pending`, `pending`])
    // Wrong answer under closed nesting: the inner truncate waits for the
    // outer commit.
    const innerTruncated = await at(`innerTruncateAppliesAtItsCommit`, 7)
    expect(innerTruncated.base[1]).toBe(absentMarker)
    expect(innerTruncated.rowMetadata[1]).toBe(absentMarker)
    expect(innerTruncated.receipts).toEqual([`applied`, `applied`])
    expect((await at(`innerTruncateAppliesAtItsCommit`, 8)).receipts).toEqual([
      `applied`,
      `applied`,
      `pending`,
    ])
    // Wrong answers: replay makes the re-insert a duplicate and invalidates
    // the source's transaction, so only the late seed remains; or the
    // re-insert merges and keeps the late seed's field.
    const reinserted = await at(`seedUnderOpenReinsert`, 5)
    expect(reinserted.base[1]).toEqual({ id: 1, v: { s: 2 } })
    expect(reinserted.receipts).toEqual([`applied`])
    // Wrong answer: the seed's metadata replaces the source's metadata write.
    const seeded = await at(`seedUnderMetadataOnlyWrite`, 3)
    expect(seeded.rowMetadata[1]).toEqual({ s: 1 })
    expect(seeded.base[1]).toEqual({ id: 1, v: { s: 3 }, seeded: { s: 3 } })
    // Wrong answer on 30175be48: the open insert becomes an update over the
    // late seed, so the seed's metadata and other field survive it.
    const underOpen = await at(`seedUnderOpenInsert`, 2)
    expect(underOpen.rowMetadata[1]).toBe(absentMarker)
    expect(underOpen.base[1]).toEqual({ id: 1, v: { s: 2 }, seeded: { s: 2 } })
    const openCommitted = await at(`seedUnderOpenInsert`, 3)
    expect(openCommitted.rowMetadata[1]).toBe(absentMarker)
    expect(openCommitted.base[1]).toEqual({ id: 1, v: { s: 1 } })
    const afterCommit = await at(`seedAfterCommittedInsert`, 3)
    expect(afterCommit.rowMetadata[1]).toBe(absentMarker)
    expect(afterCommit.base[1]).toEqual({ id: 1, v: { s: 1 } })
    // Wrong answer on 30175be48: core counts it as an equal re-insert.
    const equalInsert = await at(`equalInsertOverSeed`, 2)
    expect(equalInsert.rowMetadata[1]).toBe(absentMarker)
    const truncated = await at(`openTruncateHidesHeldRow`, 5)
    expect(truncated.rowMetadata[1]).toBe(absentMarker)
    const deleted = await at(`openDeleteHidesHeldListEntry`, 5)
    expect(deleted.list).toEqual([])
    expect(deleted.prefixList).toEqual([])
    const boundary = await at(`prefixBoundary`, 2)
    expect(boundary.prefixList).toEqual([[`gc:`, { s: 2 }]])
    expect(boundary.list).toEqual([
      [`gc`, { s: 1 }],
      [`gc:`, { s: 2 }],
    ])
    const equalAfterFullUpdate = await at(
      `fullUpdateThenEqualInsertDuringHold`,
      8,
    )
    expect(equalAfterFullUpdate.rowMetadata[1]).toEqual({ s: 1 })
    expect(equalAfterFullUpdate.base[1]).toEqual({
      id: 1,
      v: { s: 1 },
      m: { s: 1 },
    })
    const laterSeed = await at(`laterSeedReplacesSeed`, 1)
    expect(laterSeed.rowMetadata[1]).toEqual({ s: 1 })
    expect(laterSeed.base[1]).toEqual({ id: 1, v: { s: 1 } })
    // Wrong answer on 30175be48: the late seed is dropped with its metadata.
    const lateSeed = await at(`partialUpdateThenLateSeed`, 4)
    expect(lateSeed.rowMetadata[1]).toEqual({ s: 4 })
    expect(lateSeed.base[1]).toEqual({ id: 1, v: { s: 2 }, seeded: { s: 0 } })
    // Wrong answer on 30175be48: the earlier seed's metadata survives.
    const bare = await at(`bareLaterSeedClearsMetadata`, 1)
    expect(bare.rowMetadata[1]).toBe(absentMarker)
    expect(bare.base[1]).toEqual({ id: 1, v: { s: 1 }, seeded: { s: 1 } })
    // Wrong answer on 30175be48: the insert merges over the seed as an update.
    const replacedSeed = await at(`insertOverSeedReplaces`, 3)
    expect(replacedSeed.rowMetadata[1]).toBe(absentMarker)
    expect(replacedSeed.base[1]).toEqual({ id: 1, v: { s: 2 } })
    const merged = await at(`updateOverSeed`, 3)
    expect(merged.rowMetadata[1]).toEqual({ s: 0 })
    expect(merged.base[1]).toEqual({ id: 1, v: { s: 2 }, seeded: { s: 0 } })
    const replaced = await at(`updateOverSeedFullRows`, 3)
    expect(replaced.rowMetadata[1]).toEqual({ s: 0 })
    expect(replaced.base[1]).toEqual({ id: 1, v: { s: 2 } })
  })
})

// Moved from sync-metadata-session-oracle.property.test.ts: a fixed-seed
// census of the grammar alone, which runs no production.
/**
 * Grammar ablation: each generated axis exists for a regime. Removing the
 * axis must remove its regime from the fixed campaign, or the axis adds
 * nothing the laws need.
 */
describe(`sync metadata session grammar ablation`, () => {
  const ablations: Array<{
    grammar: SessionGrammar
    drop: (action: SessionAction) => boolean
    regime: string
  }> = [
    {
      grammar: flatGrammar,
      drop: (x) => x.type === `hold`,
      regime: `read with two held transactions`,
    },
    {
      grammar: flatGrammar,
      drop: (x) => x.type === `truncate`,
      regime: `truncate during a hold`,
    },
    {
      grammar: flatGrammar,
      drop: (x) => x.type === `reinsert`,
      regime: `equal re-insert`,
    },
    {
      grammar: flatGrammar,
      drop: (x) => x.type === `collectionSet` && x.undefinedValue === true,
      regime: `undefined collection value`,
    },
    {
      grammar: nestedGrammar,
      drop: (x) => x.type === `cancel`,
      regime: `abort keeps an inner commit`,
    },
    {
      grammar: { ...nestedGrammar, maxDepth: 1 },
      drop: () => false,
      regime: `nested commit`,
    },
    { grammar: seedGrammar, drop: (x) => x.type === `seed`, regime: `seed` },
  ]
  it.each(ablations.map((ablation) => [ablation.regime, ablation] as const))(
    `removing the axis for %s removes that regime`,
    (_regime, { grammar, drop, regime }) => {
      const count = (filter: (action: SessionAction) => boolean) =>
        fc
          .sample(sessionHistoryArbitrary(grammar), {
            seed: 2_220_100,
            numRuns: 200,
          })
          .filter((history) =>
            historyRegimes(grammar, history.filter(filter)).has(regime),
          ).length
      const fullGrammar =
        grammar.maxDepth === 1 && regime === `nested commit`
          ? nestedGrammar
          : grammar
      const full = fc
        .sample(sessionHistoryArbitrary(fullGrammar), {
          seed: 2_220_100,
          numRuns: 200,
        })
        .filter((history) =>
          historyRegimes(fullGrammar, history).has(regime),
        ).length
      expect(full).toBeGreaterThan(10)
      expect(count((action) => !drop(action))).toBe(0)
    },
  )
})
