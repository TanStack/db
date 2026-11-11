import { describe, it } from 'vitest'
import {
  constructRegime,
  describeMismatch,
  historyRegimes,
  persistedCachedGrammar,
  persistedConflictGrammar,
  persistedFlatGrammar,
  persistedNestedGrammar,
  persistedNestedSeedGrammar,
  persistedPeerFullGrammar,
  persistedPeerGrammar,
  persistedPeerOnDemandGrammar,
  persistedReadGrammar,
  persistedReadSeedGrammar,
  persistedSeedGrammar,
  queuedMetadataRepairBatch,
  queuedMetadataRepairInputArbitrary,
  runSessionHistory,
  seedReinsertReloadReplay,
  sessionHistoryArbitrary,
} from '../../db/tests/sync-metadata-session-oracle'
import { oracleProperty } from '../../db/tests/oracle-property'
import { createPersistedDriver } from './sync-metadata-session-persisted-driver'
import {
  registerKeptMetadataDurabilityProperty,
  registerSeedReinsertReloadProperty,
} from './sync-metadata-session-campaign-oracle'
import {
  checkSessionRuns,
  completedSessionRuns,
  observeSessionRun,
  sessionRunCalibrations,
} from './sync-metadata-session-runs'
import type {
  ConstructedRegime,
  SessionAction,
  SessionGrammar,
} from '../../db/tests/sync-metadata-session-oracle'
import type { OwedSessionRun } from './sync-metadata-session-runs'

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
 * see them a turn or more later even with no hold. In the peer production paths the
 * holding adapter's stored rows are compared at the final checkpoint too.
 *
 * Production paths: `persisted-flat`, `persisted-nested`, `persisted-seeds`,
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
 * reads are outside these production paths.
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
  productionPath: SessionGrammar = persistedFlatGrammar,
): Promise<void> {
  const { mismatch } = await runSessionHistory(productionPath, history, () =>
    createPersistedDriver(
      productionPath.seeds,
      productionPath.cached === true,
      productionPath.readHold === true,
      productionPath.peers === true,
      productionPath.fullRows === true,
      productionPath.onDemand === true,
    ),
  )
  if (mismatch) throw new Error(describeMismatch(history, mismatch))
}

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
      persistedSeedGrammar,
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
      persistedSeedGrammar,
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
      persistedNestedSeedGrammar,
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
      persistedNestedSeedGrammar,
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
      persistedNestedSeedGrammar,
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
      persistedNestedSeedGrammar,
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
      persistedNestedSeedGrammar,
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
      persistedNestedSeedGrammar,
    )
  })

  // An inner transaction reads the open writes of the transactions it began
  // inside: one session reads all its open writes.
  it(`reads an enclosing transaction's write inside a nested transaction`, async () => {
    await assertPersistedHistory(
      [{ type: `begin` }, { type: `rowSet`, key: 1 }, { type: `begin` }],
      persistedNestedGrammar,
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
      persistedConflictGrammar,
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
})

/**
 * Each production path's fixed campaign and the states it must reach (ORC-015). The
 * conflict production path runs more histories: an insert over a different row needs an
 * outer insert, an inner write to the same row, and the inner commit.
 */
const sessionProductionPaths: Array<{
  productionPath: SessionGrammar
  property: string
  seed: number
  runs: number
  reach: Array<ConstructedRegime>
  fixed?: Array<{ name: string; history: Array<SessionAction> }>
}> = [
  // The flat production path, whose raw fixed and random campaigns of 50
  // histories this property replaced with the same seed and budget.
  {
    productionPath: persistedFlatGrammar,
    property: `sync-metadata-session.persisted-flat`,
    seed: 2_220_011,
    runs: 50,
    reach: [
      `read with two held transactions`,
      `open transaction over a held transaction`,
      `store hold`,
      `core hold`,
    ],
  },
  {
    productionPath: persistedNestedGrammar,
    property: `sync-metadata-session.persisted-nested`,
    seed: 2_220_012,
    runs: 50,
    reach: [`nested commit`, `nested commit during a hold`, `store hold`],
  },
  {
    productionPath: persistedSeedGrammar,
    property: `sync-metadata-session.persisted-seeds`,
    seed: 2_220_013,
    runs: 50,
    reach: [`seed`, `store hold`],
  },
  {
    productionPath: persistedCachedGrammar,
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
    productionPath: persistedConflictGrammar,
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
    productionPath: persistedReadGrammar,
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
  // fixed history covers it.
  {
    productionPath: persistedReadSeedGrammar,
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
    productionPath: persistedPeerGrammar,
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
    // The #2317 / P8 witness, recorded as a seed and shrink path of the earlier
    // raw campaign (seed 346038028, path 36:2:4:6:10:14:16:14:14:13:13:13).
    // The native campaign draws other histories for that seed, so the
    // history itself is kept, and runs through the same model and driver.
    // #2303 (b19094596) repaired it: with that commit's persisted.ts change
    // reverted, this history fails at step 11 (`metadata.row.get`, row 2
    // `<absent>` where the model owes `{"s":3}`); with it, it passes. It now
    // guards that repair.
    fixed: [
      {
        name: `#2317 P8 source-facing metadata witness`,
        history: [
          { type: `seed`, key: 2, narrow: false, bare: true },
          { type: `begin` },
          { type: `begin` },
          { type: `rowSet`, key: 2 },
          { type: `commit` },
          { type: `upsert`, key: 2, metadata: false },
          { type: `commit` },
          { type: `commit` },
          { type: `truncate` },
          { type: `collectionDelete`, key: `cursor` },
          { type: `release` },
          { type: `peer`, key: 1, notice: `row`, keepsValue: true },
          { type: `commit` },
          { type: `peer`, key: 1, notice: `row`, keepsValue: true },
          { type: `seed`, key: 1, narrow: false, bare: true },
          { type: `collectionSet`, key: `cursor` },
          { type: `release` },
        ],
      },
    ],
  },
  // The peer production path under full row updates: an update replaces its row, so
  // storage must not keep a seed's fields beneath it (decision 17).
  {
    productionPath: persistedPeerFullGrammar,
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
  // The peer production path on demand: a reset is a source truncate that keeps the
  // seeds this tab holds (decisions 19 and 20). Metadata of a missing row is
  // rare here; a fixed history covers a reset over it.
  {
    productionPath: persistedPeerOnDemandGrammar,
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
    productionPath: persistedNestedSeedGrammar,
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
 * Shrunk counterexamples from the peer production paths, replayed through the same model, driver,
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
    assertPersistedHistory(history, persistedPeerGrammar),
  )
  it.each(peerFullReplays)(`replays under full rows: %s`, (_name, history) =>
    assertPersistedHistory(history, persistedPeerFullGrammar),
  )
  // Fixed history found by the earlier raw persisted-peers-full random campaign
  // (seed 654774679; the native campaign draws other histories for that seed):
  // an outer transaction inserts over a bare seed and an inner equal re-insert
  // commits first. Its implicit metadata keep writes no metadata to storage;
  // the shared model judges source reads and the later unknown-author reload
  // separately under D9, D15 and D18. This uses the campaigns' model, driver,
  // and comparison.
  it(`replays under full rows: keeps source metadata reads consistent across an inner re-insert and reload`, () =>
    assertPersistedHistory(seedReinsertReloadReplay, persistedPeerFullGrammar))
  it.each(peerOnDemandReplays)(`replays on demand: %s`, (_name, history) =>
    assertPersistedHistory(history, persistedPeerOnDemandGrammar),
  )
  it.each(readSeedReplays)(
    `replays with reads and seeds: %s`,
    (_name, history) =>
      assertPersistedHistory(history, persistedReadSeedGrammar),
  )
})

// The broad peer campaigns can already generate this interaction. This constructive
// grammar measures its scarce overlap and adjacent legal histories directly;
// it uses the existing independent model, driver, and per-action comparison.
const persistedSessionDriver = (productionPath: SessionGrammar) =>
  createPersistedDriver(
    true,
    true,
    false,
    true,
    productionPath.fullRows === true,
    productionPath.onDemand === true,
  )
registerSeedReinsertReloadProperty({
  property: `sync-metadata-session.persisted-seed-reinsert-reload`,
  runHistory: (history, productionPath) =>
    runSessionHistory(productionPath, history, () =>
      persistedSessionDriver(productionPath),
    ),
  owns: [`src/persisted.ts`],
})

/**
 * Each production path above, flat, nested, and seeded, is its own property
 * over the general session grammar, with the same model, persisted driver and
 * per-action comparison. Generated histories may hold
 * actions that are illegal where they fall; the runner skips them, so these
 * properties do not require every authored action to run.
 *
 * Reach: `historyRegimes` reads each declared regime from the model as the
 * history replays. Every declared regime is required in every campaign by a
 * constructed history: `constructRegime` splices that regime's prefix of
 * legal actions (`regimeConstructions` in the session oracle) in front of a
 * generated history, so the rest stays random. The regime list types each
 * entry as a `ConstructedRegime`, so a declared regime without a construction
 * does not compile, and a construction that stops entering its regime fails
 * its campaign.
 *
 * Before this property moved to the oracle framework, each fixed campaign
 * required at least five of its random histories in each regime, and the
 * random campaign required none. A required state must not depend on the
 * seed (oracle framework, declared reach), so each campaign now requires at
 * least one constructed history per regime, beside the unchanged generated
 * runs; half of a campaign's histories are constructed. The flat property
 * was two raw fast-check campaigns of 50 histories, fixed seed 2220011 and
 * random, with a sample test that required more than five fixed-seed
 * histories in each of its four regimes. It keeps its seed and budget, and
 * its constructed histories replace that sample test.
 */
for (const {
  productionPath,
  property: productionPathProperty,
  seed,
  runs,
  reach: states,
  fixed,
} of sessionProductionPaths) {
  oracleProperty<Array<SessionAction>, Array<OwedSessionRun>>({
    id: productionPathProperty,
    law: {
      statement: `A source read through the persisted wrapper gives what the same read gives on a bare Collection: on ${productionPath.name} histories, source reads after every action, consumer rows at the final checkpoint, and in the peer production paths the stored rows, agree with the session model.`,
      authority: `The sync metadata session oracle's laws and decisions (packages/db/tests/sync-metadata-session-oracle.ts header).`,
      limits: `Histories of 12 to 48 actions over two rows on one production path; restart and resume reads are outside it.`,
    },
    owns: [`src/persisted.ts`],
    histories: {
      arbitrary: sessionHistoryArbitrary(productionPath),
      runs,
      fixedSeeds: [seed],
      states,
      constructed: states.map((regime) => ({
        name: regime,
        enters: [regime],
        build: (generated) =>
          constructRegime(productionPath, regime, generated),
      })),
      ...(fixed === undefined ? {} : { fixed }),
    },
    model: (history) => [
      { path: productionPath.name, name: `history`, actions: history.length },
    ],
    driver: (history, observe) =>
      observeSessionRun(
        observe,
        { path: productionPath.name, name: `history`, actions: history.length },
        history,
        () =>
          runSessionHistory(productionPath, history, () =>
            createPersistedDriver(
              productionPath.seeds,
              productionPath.cached === true,
              productionPath.readHold === true,
              productionPath.peers === true,
              productionPath.fullRows === true,
              productionPath.onDemand === true,
            ),
          ),
      ),
    check: (_history, observations, owed) =>
      checkSessionRuns(observations, owed, { constructive: false }),
    reached: (history) =>
      [...historyRegimes(productionPath, history)].filter((regime) =>
        (states as ReadonlyArray<string>).includes(regime),
      ),
    calibrations: sessionRunCalibrations({ constructive: false }),
    timeout: 240_000,
  })
}

/**
 * Direct durability is a separate cut from this tab's metadata read. Each
 * generated batch crosses implicit keeps with explicit writes and updates
 * with flat/inner equal re-inserts, before and after named/unknown reloads.
 */
registerKeptMetadataDurabilityProperty({
  property: `sync-metadata-session.persisted-kept-metadata-durability`,
  runHistory: (history, productionPath) =>
    runSessionHistory(productionPath, history, () =>
      persistedSessionDriver(productionPath),
    ),
  owns: [`src/persisted.ts`],
  timeout: 240_000,
})

/**
 * Storage holds belong to this controlled receiver. The native schedule awaits
 * every durable commit separately and uses the same action-level comparison.
 *
 * History: the seed's narrowness and the number of inner re-inserts. Its plan
 * is the constructive batch of both seed metadata forms crossed with immediate
 * writes and writes queued behind a store hold, so every generated history is
 * the construction that enters all four declared states.
 */
const queuedRepairState = (bare: boolean, held: boolean) =>
  `${bare ? `bare` : `metadata`} seed: ${held ? `store hold` : `immediate`}`
const queuedRepairStates = [false, true].flatMap((bare) =>
  [false, true].map((held) => queuedRepairState(bare, held)),
)
type QueuedRepairBatch = ReturnType<typeof queuedMetadataRepairBatch>
const queuedRepairRuns = (batch: QueuedRepairBatch): Array<OwedSessionRun> =>
  batch.map(({ bare, held, history }) => ({
    path: persistedPeerGrammar.name,
    name: queuedRepairState(bare, held),
    actions: history.length,
  }))
oracleProperty<
  { narrow: boolean; repeats: number },
  Array<OwedSessionRun>,
  QueuedRepairBatch
>({
  id: `sync-metadata-session.persisted-queued-metadata-repair`,
  law: {
    statement: `A later explicit write repairs a wrong implicit durable keep: with both seed metadata forms, immediate or queued behind a store hold, durable metadata between queued commits and source reads agree with the session model at every checkpoint.`,
    authority: `Sync metadata session oracle decisions D9 and D18 (packages/db/tests/sync-metadata-session-oracle.ts, queuedMetadataRepairHistoriesArbitrary).`,
    limits: `The controlled persisted receiver on the peer production path; key 1 only.`,
  },
  owns: [`src/persisted.ts`],
  histories: {
    arbitrary: queuedMetadataRepairInputArbitrary,
    runs: 8,
    fixedSeeds: [2220031],
    states: queuedRepairStates,
    constructed: [
      {
        name: `both seed metadata forms, immediate and behind a store hold`,
        enters: queuedRepairStates,
        build: (input) => input,
      },
    ],
  },
  resolve: queuedMetadataRepairBatch,
  model: queuedRepairRuns,
  driver: async (batch, observe) => {
    for (const { bare, held, history } of batch)
      await observeSessionRun(
        observe,
        {
          path: persistedPeerGrammar.name,
          name: queuedRepairState(bare, held),
          actions: history.length,
        },
        history,
        () =>
          runSessionHistory(persistedPeerGrammar, history, () =>
            createPersistedDriver(true, true, false, true),
          ),
      )
  },
  check: (_batch, observations, owed) => checkSessionRuns(observations, owed),
  reached: (_batch, trace) =>
    completedSessionRuns(trace).map((run) => run.name),
  calibrations: sessionRunCalibrations(),
  timeout: 120_000,
})
