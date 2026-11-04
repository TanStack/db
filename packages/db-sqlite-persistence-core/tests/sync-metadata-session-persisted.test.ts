import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import {
  describeMismatch,
  historyRegimes,
  persistedCachedLane,
  persistedConflictLane,
  persistedFlatLane,
  persistedNestedLane,
  persistedNestedSeedLane,
  persistedPeerFullLane,
  persistedPeerLane,
  persistedPeerOnDemandLane,
  persistedReadLane,
  persistedReadSeedLane,
  persistedSeedLane,
  queuedMetadataRepairHistoriesArbitrary,
  runSessionHistory,
  seedReinsertReloadReplay,
  sessionHistoryArbitrary,
} from '../../db/tests/sync-metadata-session-oracle'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
  readOracleRunConfig,
  recordOracleReplay,
} from '../../db/tests/oracle-config'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { requireExecutedHistory } from './sync-metadata-campaign-result'
import { createPersistedDriver } from './sync-metadata-session-persisted-driver'
import {
  runKeptMetadataDurabilityCampaign,
  runSeedReinsertReloadCampaign,
} from './sync-metadata-session-campaign'
import type {
  SessionAction,
  SessionLane,
} from '../../db/tests/sync-metadata-session-oracle'

/**
 * The persisted wrapper is a second production path for the sync metadata
 * session oracle. Its laws, model, grammar, and comparison are the oracle's
 * own (`packages/db/tests/sync-metadata-session-oracle.ts`). The source and
 * the wrapper are one session: a source read through the wrapper must give
 * what the same read gives on a bare Collection.
 *
 * Production path: `persistedCollectionOptions` over an in-memory adapter.
 * The source sync function receives the wrapper's sync API. A `hold` holds
 * one kind of delay. A store hold makes the adapter's next durable write
 * wait, so transactions committed after it stay deferred in the wrapper. A
 * core hold is a persisting optimistic insert of a fresh fixture key, so
 * transactions the wrapper has handed to core stay held there. `release`
 * ends either.
 *
 * Checkpoints: source reads after every action; `collection.base` only at the
 * final checkpoint, after every hold ends and the wrapper's continuations
 * drain. The wrapper hands rows to core after its durable step, so consumers
 * see them a turn or more later even with no hold. In the peer lanes the
 * holding adapter's stored rows are compared at the final checkpoint too.
 *
 * Lanes: `persisted-flat`, `persisted-nested`, `persisted-seeds`,
 * `persisted-cached` (row 1 is in storage when the run starts),
 * `persisted-conflicts` (inner writes that land ahead of enclosing ones), and
 * `persisted-nested-seeds`, which crosses seeds with nesting and the cached
 * row, `persisted-reads`, whose read hold keeps an on-demand storage
 * read in flight, `persisted-reads-seeds`, which adds seeds and the cached
 * row and may abort a buffered commit's signal, and `persisted-peers`, where another tab's source writes
 * storage and sends its notices through the persistence coordinator, with
 * `persisted-peers-full` under full row updates and
 * `persisted-peers-on-demand`, which loads on demand with a demand for every
 * row active from the start. Seeds
 * use a `DbClient` that owns the persisted Collection. Restart and resume
 * reads are outside these lanes.
 *
 * A peer is a second writer the driver plays. It writes the stored row and
 * metadata directly, takes the next stream position after this tab's
 * durable commits, and emits the `tx:committed` notice that the Browser and
 * Electron coordinators send: changed rows with their metadata, metadata
 * alone, a deleted key, or a notice that requires a full reload. A reset
 * empties storage, starts the next reset epoch, and sends
 * `collection:reset`. The model
 * makes a peer action legal only when no store hold or read hold is active,
 * so every accepted transaction of this tab is durable and the notice is the
 * next one in the stream.
 */

async function assertPersistedHistory(
  history: ReadonlyArray<SessionAction>,
  lane: SessionLane = persistedFlatLane,
): Promise<void> {
  const { mismatch } = await runSessionHistory(lane, history, () =>
    createPersistedDriver(
      lane.seeds,
      lane.cached === true,
      lane.readHold === true,
      lane.peers === true,
      lane.fullRows === true,
      lane.onDemand === true,
    ),
  )
  if (mismatch) throw new Error(describeMismatch(history, mismatch))
}

const property = `sync-metadata-session.persisted-flat`
const fixedSeed = 2_220_011
const requestedReplayProperty = readOracleRunConfig().replayProperty

describe(`sync metadata session oracle through the persisted wrapper`, () => {
  it.each([false, true])(
    `keeps a held cursor visible after a later commit (store hold: %s)`,
    async (holdStore) => {
      await assertPersistedHistory([
        { type: `hold`, store: holdStore },
        { type: `begin` },
        { type: `collectionSet`, key: `cursor` },
        { type: `commit` },
        { type: `begin` },
        { type: `upsert`, key: 1, metadata: false },
        { type: `commit` },
      ])
    },
  )

  // The reported path: once the wrapper has handed transactions to core and
  // core holds them, a read after a third transaction loses the earliest
  // write. A store hold keeps them in the wrapper's staging instead; that
  // neighbour passes on 30175be48.
  it.each([false, true])(
    `keeps a held write visible after a third transaction (store hold: %s)`,
    async (holdStore) => {
      await assertPersistedHistory([
        { type: `hold`, store: holdStore },
        { type: `begin` },
        { type: `upsert`, key: 1, metadata: true },
        { type: `commit` },
        { type: `begin` },
        { type: `commit` },
        { type: `begin` },
        { type: `collectionSet`, key: `cursor` },
        { type: `commit` },
      ])
    },
  )

  // A source insert equal to a seeded row is still an insert: the source never
  // wrote the row, so it names the row's metadata and clears the seed's.
  it(`clears a seed's metadata when the source inserts an equal row`, async () => {
    await assertPersistedHistory(
      [
        { type: `seed`, key: 1 },
        { type: `begin` },
        { type: `reinsert`, key: 1, metadata: false },
      ],
      persistedSeedLane,
    )
  })

  // An equal re-insert keeps metadata as an update does, without writing it,
  // so the latest seed still governs the row's metadata after it commits.
  it(`lets a later seed replace metadata that an accepted re-insert kept`, async () => {
    await assertPersistedHistory(
      [
        { type: `begin` },
        { type: `seed`, key: 1, bare: true },
        { type: `upsert`, key: 1, metadata: false },
        { type: `reinsert`, key: 1, metadata: false },
        { type: `seed`, key: 1 },
        { type: `commit` },
        { type: `seed`, key: 1, bare: true },
      ],
      persistedSeedLane,
    )
  })

  // The same holds when the re-insert commits ahead of the enclosing
  // transaction whose row it re-inserted and lands on a seeded row.
  it(`lets a later seed replace metadata that an inner re-insert kept`, async () => {
    await assertPersistedHistory(
      [
        { type: `begin` },
        { type: `seed`, key: 2 },
        { type: `upsert`, key: 2, metadata: false },
        { type: `begin` },
        { type: `reinsert`, key: 2, metadata: false },
        { type: `commit` },
        { type: `seed`, key: 2, bare: true },
      ],
      persistedNestedSeedLane,
    )
  })

  // A persisted cache row is a seed (decision C), so a later DbClient seed
  // replaces its metadata until the source writes the metadata.
  it(`lets a later seed replace a cached row's metadata`, async () => {
    await assertPersistedHistory(
      [
        { type: `begin` },
        { type: `upsert`, key: 1, metadata: false },
        { type: `seed`, key: 1, bare: true },
      ],
      persistedNestedSeedLane,
    )
  })

  // An update without metadata keeps metadata, so the insert before it still
  // decides the row's metadata. When an inner transaction commits ahead and
  // changes the row that insert lands on, the insert clears the metadata.
  it(`rejudges an enclosing re-insert that a later update kept`, async () => {
    await assertPersistedHistory(
      [
        { type: `begin` },
        { type: `upsert`, key: 1, metadata: false },
        { type: `reinsert`, key: 1, metadata: false },
        { type: `upsert`, key: 1, metadata: false },
        { type: `begin` },
        { type: `upsert`, key: 1, metadata: true },
        { type: `commit` },
      ],
      persistedNestedSeedLane,
    )
  })

  // Every insert without metadata in an enclosing transaction is re-judged
  // when an inner one commits ahead: an earlier re-insert that now lands on a
  // different row clears metadata, and a later equal re-insert keeps that.
  it(`rejudges every enclosing re-insert of a key, not only the last`, async () => {
    await assertPersistedHistory(
      [
        { type: `begin` },
        { type: `insertOverSeed`, key: 1, metadata: false },
        { type: `commit` },
        { type: `begin` },
        { type: `reinsert`, key: 1, metadata: false },
        { type: `reinsert`, key: 1, metadata: false },
        { type: `begin` },
        { type: `upsert`, key: 1, metadata: true },
        { type: `commit` },
      ],
      persistedNestedSeedLane,
    )
  })

  // An enclosing insert that cleared metadata can become an equal re-insert
  // of the row an inner transaction committed ahead; it then keeps the
  // metadata a seed supplied beneath.
  it(`lets an enclosing clear become an equal re-insert after an inner commit`, async () => {
    await assertPersistedHistory(
      [
        { type: `begin` },
        { type: `insertOverSeed`, key: 1, metadata: false },
        { type: `reinsert`, key: 1, metadata: false },
        { type: `begin` },
        { type: `reinsert`, key: 1, metadata: false },
        { type: `seed`, key: 1 },
        { type: `commit` },
      ],
      persistedNestedSeedLane,
    )
  })

  // A later seed beneath an open re-insert does not change its kind, but an
  // inner update that merges over that seed and commits ahead does: the
  // re-insert then lands on a different row and clears metadata (decision 10).
  it(`lets an inner update merged over a later seed change an enclosing re-insert`, async () => {
    await assertPersistedHistory(
      [
        { type: `begin` },
        { type: `upsert`, key: 1, metadata: true },
        { type: `reinsert`, key: 1, metadata: false },
        { type: `begin` },
        { type: `seed`, key: 1, bare: true },
        { type: `upsert`, key: 1, metadata: false },
        { type: `commit` },
      ],
      persistedNestedSeedLane,
    )
  })

  // An inner transaction reads the open writes of the transactions it began
  // inside: one session reads all its open writes.
  it(`reads an enclosing transaction's write inside a nested transaction`, async () => {
    await assertPersistedHistory(
      [{ type: `begin` }, { type: `rowSet`, key: 1 }, { type: `begin` }],
      persistedNestedLane,
    )
  })

  // An inner transaction's equal re-insert keeps the row's metadata. When it
  // commits ahead of the outer transaction whose row it re-inserted, it lands
  // where that row is absent; it is still the re-insert it was written as.
  it(`keeps an inner re-insert's metadata when it commits ahead of the row it re-inserted`, async () => {
    await assertPersistedHistory(
      [
        { type: `begin` },
        { type: `rowSet`, key: 1 },
        { type: `commit` },
        { type: `begin` },
        { type: `upsert`, key: 1, metadata: false },
        { type: `begin` },
        { type: `reinsert`, key: 1, metadata: false },
        { type: `commit` },
      ],
      persistedConflictLane,
    )
  })

  // An insert without metadata clears the row's metadata, even inside the
  // transaction that set it (2026-10-05 rules).
  it(`reads an insert's implicit metadata clear in the open transaction`, async () => {
    await assertPersistedHistory([
      { type: `begin` },
      { type: `rowSet`, key: 2 },
      { type: `upsert`, key: 2, metadata: false },
    ])
  })

  it(`reaches held and open-over-held reads in the fixed campaign`, () => {
    const counts = new Map<string, number>()
    for (const history of fc.sample(
      sessionHistoryArbitrary(persistedFlatLane),
      {
        numRuns: oracleRuns(50),
        seed: fixedSeed,
      },
    ))
      for (const regime of historyRegimes(persistedFlatLane, history))
        counts.set(regime, (counts.get(regime) ?? 0) + 1)
    for (const regime of [
      `read with two held transactions`,
      `open transaction over a held transaction`,
      `store hold`,
      `core hold`,
    ])
      expect(counts.get(regime) ?? 0, regime).toBeGreaterThan(5)
  })

  if (requestedReplayProperty === undefined) {
    fcTest.prop([sessionHistoryArbitrary(persistedFlatLane)], {
      numRuns: oracleRuns(50),
      seed: fixedSeed,
    })(
      `keeps the session law on flat histories (fixed)`,
      assertPersistedHistory,
      120_000,
    )
    fcTest.prop(
      [sessionHistoryArbitrary(persistedFlatLane)],
      oraclePropertyOptions(50, property),
    )(
      `keeps the session law on flat histories (random)`,
      assertPersistedHistory,
      120_000,
    )
  } else if (requestedReplayProperty === property) {
    fcTest.prop(
      [sessionHistoryArbitrary(persistedFlatLane)],
      oraclePropertyOptions(50, property),
    )(
      `replays persisted flat session histories`,
      assertPersistedHistory,
      120_000,
    )
  }
})

/**
 * Each lane's fixed campaign and the states it must reach (ORC-015). The
 * conflict lane runs more histories: an insert over a different row needs an
 * outer insert, an inner write to the same row, and the inner commit.
 */
const extraLanes: Array<{
  lane: SessionLane
  property: string
  seed: number
  runs: number
  reach: Array<string>
}> = [
  {
    lane: persistedNestedLane,
    property: `sync-metadata-session.persisted-nested`,
    seed: 2_220_012,
    runs: 50,
    reach: [`nested commit`, `nested commit during a hold`, `store hold`],
  },
  {
    lane: persistedSeedLane,
    property: `sync-metadata-session.persisted-seeds`,
    seed: 2_220_013,
    runs: 50,
    reach: [`seed`, `store hold`],
  },
  {
    lane: persistedCachedLane,
    property: `sync-metadata-session.persisted-cached`,
    seed: 2_220_015,
    runs: 80,
    reach: [
      `source insert over a seeded row`,
      `source update over a seeded row`,
      `store hold`,
    ],
  },
  {
    lane: persistedConflictLane,
    property: `sync-metadata-session.persisted-conflicts`,
    seed: 2_220_014,
    runs: 150,
    reach: [
      `inner write to an enclosing row`,
      `insert replaces a different row`,
      `duplicate source insert`,
      `store hold`,
    ],
  },
  // Writes while a storage read is in flight follow the same laws: the
  // wrapper buffers their transactions until the read ends.
  {
    lane: persistedReadLane,
    property: `sync-metadata-session.persisted-reads`,
    seed: 2_220_017,
    runs: 150,
    reach: [
      `write during a storage read`,
      `storage read of a stored row`,
      `nested commit`,
      `store hold`,
    ],
  },
  // A transaction committed during a read and abandoned before the wrapper
  // hands it to core never wrote its rows, so a seed beneath it still holds
  // them (decision 21). Abandoning a seeded row's writer is rare here; a
  // replay pins it.
  {
    lane: persistedReadSeedLane,
    property: `sync-metadata-session.persisted-reads-seeds`,
    seed: 2_220_021,
    runs: 150,
    reach: [`write during a storage read`, `abort after commit`, `seed`],
  },
  // Another tab's source writes reach this tab through its notices: a named
  // write is a source write that lands beneath open transactions and over
  // seeds (decision 11); a full reload keeps a held seed and makes every
  // changed stored row a source write (decisions 13 and 15).
  {
    lane: persistedPeerLane,
    property: `sync-metadata-session.persisted-peers`,
    seed: 2_220_018,
    runs: 150,
    reach: [
      `peer row notice`,
      `peer metadata notice`,
      `peer delete notice`,
      `peer reload notice`,
      `named peer write over a held seed`,
      `full reload over a held seed`,
      `peer write during an open insert`,
      `peer write during a hold`,
    ],
  },
  // The peer lane under full row updates: an update replaces its row, so
  // storage must not keep a seed's fields beneath it (decision 17).
  {
    lane: persistedPeerFullLane,
    property: `sync-metadata-session.persisted-peers-full`,
    seed: 2_220_019,
    runs: 150,
    reach: [
      `peer row notice`,
      `peer metadata notice`,
      `peer delete notice`,
      `peer reload notice`,
      `named peer write over a held seed`,
      `full reload over a held seed`,
      `peer write during an open insert`,
      `peer write during a hold`,
      `accepted update drops a field`,
    ],
  },
  // The peer lane on demand: a reset is a source truncate that keeps the
  // seeds this tab holds (decisions 19 and 20). Metadata of a missing row is
  // rare here; a replay pins a reset over it.
  {
    lane: persistedPeerOnDemandLane,
    property: `sync-metadata-session.persisted-peers-on-demand`,
    seed: 2_220_020,
    runs: 150,
    reach: [
      `peer row notice`,
      `peer reload notice`,
      `peer reset notice`,
      `named peer write over a held seed`,
      `full reload over a held seed`,
      `reset over a held seed`,
      `reset that rewrites its rows`,
      `peer write during a hold`,
    ],
  },
  // A seed's metadata still governs a row whose metadata an accepted
  // re-insert kept, here also when the re-insert committed ahead of the
  // enclosing transaction whose row it re-inserted.
  {
    lane: persistedNestedSeedLane,
    property: `sync-metadata-session.persisted-nested-seeds`,
    seed: 2_220_016,
    runs: 300,
    reach: [
      `seed under a kept re-insert`,
      `inner write to an enclosing row`,
      `insert replaces a different row`,
      `duplicate source insert`,
      `store hold`,
    ],
  },
]

/**
 * Shrunk peer-lane counterexamples, replayed through the same model, driver,
 * and comparison as the campaigns. Each reached a defect that the fixed and
 * random campaigns rarely generate: a held seed that a reload must keep, a
 * row that held transactions wrote, metadata of a missing row, a write over a
 * seed that must store the seed's row, a seed's metadata that a later seed
 * replaced, a row a held delete already removed, and a full reload's staged
 * writes beneath an open re-insert, and a notice whose row keeps a held
 * row's value while dropping its other fields: the campaigns almost never
 * hold an absent row's insert when such a notice arrives. Recorded in
 * docs/contributing/oracle-reviews/2026-10-22-sync-metadata-session.md.
 */
const peerReplays: Array<[string, Array<SessionAction>]> = [
  [
    `a notice whose row keeps a held row's value still replaces it`,
    [
      { type: `hold` },
      { type: `begin` },
      { type: `upsert`, key: 2, metadata: true },
      { type: `commit` },
      { type: `peer`, key: 2, notice: `row`, keepsValue: true },
    ],
  ],
  [
    `a reload keeps a seed accepted during a hold`,
    [
      { type: `hold` },
      { type: `seed`, key: 2 },
      { type: `peer`, key: 1, notice: `row` },
    ],
  ],
  [
    `a notice for a row held transactions wrote reloads it`,
    [
      { type: `hold` },
      { type: `begin` },
      { type: `upsert`, key: 2, metadata: true },
      { type: `commit` },
      { type: `peer`, key: 2, notice: `row` },
    ],
  ],
  [
    `a reload keeps metadata of a missing row`,
    [
      { type: `begin` },
      { type: `rowSet`, key: 2 },
      { type: `commit` },
      { type: `peer`, key: 1, notice: `row` },
    ],
  ],
  [
    `a write over a seed stores the seed's row`,
    [
      { type: `seed`, key: 1, narrow: true, bare: true },
      { type: `begin` },
      { type: `seed`, key: 2 },
      { type: `upsert`, key: 1, metadata: true },
      { type: `commit` },
      { type: `peer`, key: 2, notice: `row` },
    ],
  ],
  [
    `a reload after a named notice keeps a later seed's metadata`,
    [
      { type: `seed`, key: 2, narrow: true },
      { type: `begin` },
      { type: `upsert`, key: 2, metadata: false },
      { type: `commit` },
      { type: `seed`, key: 2 },
      { type: `peer`, key: 1, notice: `row` },
    ],
  ],
  [
    `a reload does not delete a row a held delete removed`,
    [
      { type: `peer`, key: 2, notice: `row` },
      { type: `hold` },
      { type: `begin` },
      { type: `peer`, key: 2, notice: `delete` },
      { type: `rowSet`, key: 2 },
      { type: `commit` },
      { type: `peer`, key: 1, notice: `reload` },
    ],
  ],
  [
    `a reload after a reset deletes a held row that storage lacks`,
    [
      { type: `peer`, key: 1, notice: `reset` },
      { type: `begin` },
      { type: `upsert`, key: 2, metadata: true },
      { type: `hold`, store: false },
      { type: `commit` },
      { type: `peer`, key: 2, notice: `delete` },
    ],
  ],
  [
    `a named notice after a full reload keeps another row's seed metadata`,
    [
      { type: `peer`, key: 1, notice: `reload` },
      { type: `seed`, key: 2 },
      { type: `begin` },
      { type: `upsert`, key: 2, metadata: false },
      { type: `commit` },
      { type: `peer`, key: 1, notice: `row`, keepsValue: true },
    ],
  ],
  [
    `an equal re-insert of a row a reset wrote back keeps its metadata`,
    [
      { type: `peer`, key: 1, notice: `reset`, rewrites: true },
      { type: `begin` },
      { type: `reinsert`, key: 1, metadata: false },
    ],
  ],
  [
    `a held reload's writes stay beneath an open re-insert`,
    [
      { type: `seed`, key: 2, bare: true },
      { type: `begin` },
      { type: `reinsert`, key: 1, metadata: false },
      { type: `hold` },
      { type: `peer`, key: 2, notice: `reload` },
    ],
  ],
]

// Under full row updates an update replaces its row, so storage keeps no
// field the update dropped: neither a seed's (decision 17 stores the row this
// tab shows) nor the stored row's own.
const peerFullReplays: Array<[string, Array<SessionAction>]> = [
  [
    `a full update over a seed stores only the update`,
    [
      { type: `seed`, key: 1 },
      { type: `begin` },
      { type: `upsert`, key: 1, metadata: false },
      { type: `commit` },
      { type: `peer`, key: 2, notice: `reload` },
    ],
  ],
  [
    `a full update drops a field the stored row had`,
    [
      { type: `begin` },
      { type: `upsert`, key: 1, metadata: true },
      { type: `commit` },
      { type: `begin` },
      { type: `upsert`, key: 1, metadata: false },
      { type: `commit` },
      { type: `peer`, key: 2, notice: `reload` },
    ],
  ],
]

// On demand, a reset keeps a held seed and truncates every other source
// object, held rows and metadata of a missing row included (decisions 19
// and 20). A notice after the reset reloads storage (the reset fence).
const peerOnDemandReplays: Array<[string, Array<SessionAction>]> = [
  [
    `a reset whose storage keeps a row keeps the row's stored metadata`,
    [
      { type: `begin` },
      { type: `upsert`, key: 2, metadata: true },
      { type: `commit` },
      { type: `peer`, key: 1, notice: `reset`, rewrites: true },
    ],
  ],
  [
    `a reset beside a held seed clears metadata of a missing row`,
    [
      { type: `seed`, key: 1 },
      { type: `begin` },
      { type: `rowSet`, key: 2 },
      { type: `commit` },
      { type: `peer`, key: 1, notice: `reset` },
    ],
  ],
  [
    `a reset keeps a held seed's source-written metadata from a later seed`,
    [
      { type: `peer`, key: 1, notice: `metadata` },
      { type: `seed`, key: 1, bare: true },
      { type: `peer`, key: 1, notice: `reset` },
      { type: `seed`, key: 1, bare: true },
    ],
  ],
  [
    `a source row write keeps a kept seed's metadata open to a later seed`,
    [
      { type: `begin` },
      { type: `seed`, key: 1, bare: true },
      { type: `peer`, key: 1, notice: `reset` },
      { type: `upsert`, key: 1, metadata: false },
      { type: `commit` },
      { type: `hold`, store: false },
      { type: `begin` },
      { type: `seed`, key: 1 },
    ],
  ],
  [
    `a reset beside a held seed deletes a held row`,
    [
      { type: `seed`, key: 1 },
      { type: `hold`, store: false },
      { type: `begin` },
      { type: `upsert`, key: 2, metadata: true },
      { type: `commit` },
      { type: `peer`, key: 1, notice: `reset` },
    ],
  ],
]

// A transaction the wrapper buffers during a read and that is abandoned
// before it is handed to core wrote nothing, so the seed beneath it holds. A
// seed that arrives after it was judged then and stays ignored (decision 22).
const readSeedReplays: Array<[string, Array<SessionAction>]> = [
  [
    `a seed that arrives after a buffered write stays ignored when it is abandoned (metadata)`,
    [
      { type: `begin` },
      { type: `hold`, read: true },
      { type: `rowSet`, key: 2 },
      { type: `commit` },
      { type: `seed`, key: 2 },
      { type: `abandon` },
      { type: `release` },
    ],
  ],
  [
    `a seed that arrives after a buffered write stays ignored when it is abandoned (row)`,
    [
      { type: `hold`, read: true },
      { type: `begin` },
      { type: `upsert`, key: 2, metadata: false },
      { type: `commit` },
      { type: `seed`, key: 2 },
      { type: `abandon` },
      { type: `release` },
    ],
  ],
  [
    `an abandoned commit leaves a seed held against a later read`,
    [
      { type: `seed`, key: 1 },
      { type: `hold`, read: true },
      { type: `begin` },
      { type: `upsert`, key: 1, metadata: false },
      { type: `commit` },
      { type: `abandon` },
      { type: `release` },
      { type: `hold`, read: true },
      { type: `release` },
    ],
  ],
]

describe(`sync metadata session oracle through the persisted wrapper: peer replays`, () => {
  it.each(peerReplays)(`replays: %s`, (_name, history) =>
    assertPersistedHistory(history, persistedPeerLane),
  )
  it.each(peerFullReplays)(`replays under full rows: %s`, (_name, history) =>
    assertPersistedHistory(history, persistedPeerFullLane),
  )
  // Pinned from the persisted-peers-full random campaign (seed 654774679):
  // an outer transaction inserts over a bare seed and an inner equal re-insert
  // commits first. Its implicit metadata keep writes no metadata to storage;
  // the shared model judges source reads and the later unknown-author reload
  // separately under D9, D15 and D18. This uses the campaigns' model, driver,
  // and comparison.
  it(`replays under full rows: keeps source metadata reads consistent across an inner re-insert and reload`, () =>
    assertPersistedHistory(seedReinsertReloadReplay, persistedPeerFullLane))
  it.each(peerOnDemandReplays)(`replays on demand: %s`, (_name, history) =>
    assertPersistedHistory(history, persistedPeerOnDemandLane),
  )
  it.each(readSeedReplays)(
    `replays with reads and seeds: %s`,
    (_name, history) => assertPersistedHistory(history, persistedReadSeedLane),
  )
})

// The broad peer campaigns can already generate this interaction. This constructive
// grammar measures its scarce overlap and adjacent legal histories directly;
// it uses the existing independent model, driver, and per-action comparison.
const seedReloadProperty = `sync-metadata-session.persisted-seed-reinsert-reload`
for (const campaign of [`fixed`, `random`] as const) {
  if (
    requestedReplayProperty !== undefined &&
    (requestedReplayProperty !== seedReloadProperty || campaign === `fixed`)
  )
    continue
  it(`keeps inserted metadata across peer reloads (${campaign})`, async () => {
    await runSeedReinsertReloadCampaign({
      property: seedReloadProperty,
      campaign,
      runHistory: (history, lane) =>
        runSessionHistory(lane, history, () =>
          createPersistedDriver(
            true,
            true,
            false,
            true,
            lane.fullRows === true,
            lane.onDemand === true,
          ),
        ),
    })
  }, 120_000)
}

const describeNested = oracleReplayTest(
  describe,
  ...extraLanes.map(({ property }) => property),
)
describeNested(
  `sync metadata session oracle through the persisted wrapper: nesting and seeds`,
  () => {
    for (const {
      lane,
      property: lanePropertyName,
      seed,
      runs,
      reach: states,
    } of extraLanes) {
      const runLane = (history: Array<SessionAction>) =>
        assertPersistedHistory(history, lane)
      if (requestedReplayProperty === undefined) {
        const reach = createOracleReach(`${lanePropertyName} (fixed)`, states, {
          minimum: 5,
        })
        fcTest.prop([sessionHistoryArbitrary(lane)], {
          numRuns: oracleRuns(runs),
          seed,
        })(
          `keeps the session law on ${lane.name} histories (fixed)`,
          (history) => {
            reach.beginHistory()
            for (const regime of historyRegimes(lane, history))
              if (states.includes(regime)) reach.reach(regime)
            return runLane(history)
          },
          240_000,
        )
        it(`reaches the declared states in the ${lane.name} fixed campaign`, () =>
          reach.assertReached())
        fcTest.prop(
          [sessionHistoryArbitrary(lane)],
          oraclePropertyOptions(50, lanePropertyName),
        )(
          `keeps the session law on ${lane.name} histories (random)`,
          runLane,
          120_000,
        )
      } else if (requestedReplayProperty === lanePropertyName) {
        fcTest.prop(
          [sessionHistoryArbitrary(lane)],
          oraclePropertyOptions(50, lanePropertyName),
        )(`replays ${lane.name} session histories`, runLane, 120_000)
      }
    }
  },
)
/**
 * Direct durability is a separate cut from this tab's metadata read. Each
 * generated batch crosses implicit keeps with explicit writes and updates
 * with flat/inner equal re-inserts, before and after named/unknown reloads.
 */
const durabilityProperty = `sync-metadata-session.persisted-kept-metadata-durability`
for (const campaign of [`fixed`, `random`] as const) {
  if (
    requestedReplayProperty !== undefined &&
    (requestedReplayProperty !== durabilityProperty || campaign === `fixed`)
  )
    continue
  it(`keeps tab-local and durable metadata distinct (persisted, ${campaign})`, async () => {
    await runKeptMetadataDurabilityCampaign({
      property: durabilityProperty,
      campaign,
      runHistory: (history, lane) =>
        runSessionHistory(lane, history, () =>
          createPersistedDriver(
            true,
            true,
            false,
            true,
            lane.fullRows === true,
            lane.onDemand === true,
          ),
        ),
    })
  }, 240_000)
}

// Storage holds belong to this controlled receiver. The native schedule awaits
// every durable commit separately and uses the same action-level comparison.
const queuedRepairProperty = `sync-metadata-session.persisted-queued-metadata-repair`
for (const campaign of [`fixed`, `random`] as const) {
  if (
    requestedReplayProperty !== undefined &&
    (requestedReplayProperty !== queuedRepairProperty || campaign === `fixed`)
  )
    continue
  it(`observes durable metadata between queued commits (${campaign})`, async () => {
    const name = (bare: boolean, held: boolean) =>
      `${bare ? `bare` : `metadata`} seed: ${held ? `store hold` : `immediate`}`
    const states = [false, true].flatMap((bare) =>
      [false, true].map((held) => name(bare, held)),
    )
    const reach = createOracleReach(queuedRepairProperty, states)
    const result = await fc.check(
      fc.asyncProperty(
        queuedMetadataRepairHistoriesArbitrary,
        async (batch) => {
          for (const { bare, held, history } of batch) {
            reach.beginHistory()
            const result = await runSessionHistory(
              persistedPeerLane,
              history,
              () => createPersistedDriver(true, true, false, true),
            )
            if (result.mismatch)
              throw new Error(describeMismatch(history, result.mismatch))
            if (result.steps !== history.length)
              throw new Error(`constructive history skipped an authored action`)
            reach.reach(name(bare, held))
          }
        },
      ),
      campaign === `fixed`
        ? { numRuns: oracleRuns(8), seed: 2220031 }
        : oraclePropertyOptions(8, queuedRepairProperty),
    )
    recordOracleReplay(queuedRepairProperty, result)
    console.info(
      `ORACLE_REACH ${JSON.stringify({ property: queuedRepairProperty, campaign, seed: result.seed, runs: result.numRuns, counts: Object.fromEntries(reach.counts()) })}`,
    )
    requireExecutedHistory(queuedRepairProperty, result)
    if (result.failed)
      throw new Error(
        `${result.error}\nseed=${result.seed} path=${result.counterexamplePath}`,
      )
    reach.assertReached()
  }, 120_000)
}
