import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { DbClient, collectionOptions, createCollection } from '@tanstack/db'
import {
  absentMarker,
  cachedMetadata,
  cachedRow,
  describeMismatch,
  historyRegimes,
  persistedCachedLane,
  persistedConflictLane,
  persistedFlatLane,
  persistedNestedLane,
  persistedNestedSeedLane,
  persistedPeerLane,
  persistedReadLane,
  persistedSeedLane,
  runSessionHistory,
  sessionCollectionKeys,
  sessionHistoryArbitrary,
} from '../../db/tests/sync-metadata-session-oracle'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from '../../db/tests/oracle-config'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { SingleProcessCoordinator, persistedCollectionOptions } from '../src'
import type { CollectionConfig, SyncConfig } from '@tanstack/db'
import type {
  PeerNotice,
  ReceiptState,
  SessionAction,
  SessionDriver,
  SessionLane,
} from '../../db/tests/sync-metadata-session-oracle'
import type { PersistedTx, PersistenceAdapter, ProtocolEnvelope } from '../src'

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
 * see them a turn or more later even with no hold.
 *
 * Lanes: `persisted-flat`, `persisted-nested`, `persisted-seeds`,
 * `persisted-cached` (row 1 is in storage when the run starts),
 * `persisted-conflicts` (inner writes that land ahead of enclosing ones), and
 * `persisted-nested-seeds`, which crosses seeds with nesting and the cached
 * row, `persisted-reads`, whose read hold keeps an on-demand storage
 * read in flight, and `persisted-peers`, where another tab's source writes
 * storage and sends its notices through the persistence coordinator. Seeds
 * use a `DbClient` that owns the persisted Collection. Restart and resume
 * reads are outside these lanes.
 *
 * A peer is a second writer the driver plays. It writes the stored row and
 * metadata directly, takes the next stream position after this tab's
 * durable commits, and emits the `tx:committed` notice that the Browser and
 * Electron coordinators send: changed rows with their metadata, metadata
 * alone, a deleted key, or a notice that requires a full reload. The model
 * makes a peer action legal only when no store hold or read hold is active,
 * so every accepted transaction of this tab is durable and the notice is the
 * next one in the stream.
 */

type Row = { id: number; v: unknown }
type SyncActions = Parameters<SyncConfig<Row, number>[`sync`]>[0]

/**
 * An in-memory adapter that can hold its next durable step. With `cached`,
 * its reads supply row 1 from a previous run's storage until this run's
 * first durable commit; the oracle observes one run. With `stores`, it keeps
 * every durable row and returns them to reads, so a storage read during the
 * run hands this tab's own rows back to the wrapper.
 */
function createHoldingAdapter(cached = false, stores = false) {
  let holdNext = false
  let releaseStore: (() => void) | undefined
  let latest = { term: 0, seq: 0, rowVersion: 0 }
  let cachedRows = cached
    ? [{ key: 1, value: cachedRow, metadata: cachedMetadata }]
    : []
  const stored = new Map<number, { value: Row; metadata?: unknown }>(
    stores && cached
      ? [[1, { value: cachedRow as Row, metadata: cachedMetadata }]]
      : [],
  )
  const storedRows = () =>
    stores ? Array.from(stored, ([key, row]) => ({ key, ...row })) : cachedRows
  // A reload restores collection metadata from storage, so storage keeps it.
  const storedCollectionMetadata = new Map<string, unknown>()
  const collectionMetadata = () =>
    Array.from(storedCollectionMetadata, ([key, value]) => ({ key, value }))
  const adapter: PersistenceAdapter = {
    loadSubset: () => Promise.resolve(storedRows()),
    loadResumeSnapshot: () =>
      Promise.resolve({
        rows: storedRows(),
        keySet: { status: `consistent` },
        collectionMetadata: collectionMetadata(),
        latestTerm: latest.term,
        latestSeq: latest.seq,
        latestRowVersion: latest.rowVersion,
        resetEpoch: 0,
      }),
    loadCollectionMetadata: () => Promise.resolve(collectionMetadata()),
    applyCommittedTx: async (_target, tx: PersistedTx) => {
      cachedRows = []
      if (holdNext) {
        holdNext = false
        await new Promise<void>((resolve) => {
          releaseStore = resolve
        })
      }
      latest = { term: tx.term, seq: tx.seq, rowVersion: tx.rowVersion }
      if (!stores) return
      if (tx.truncate) stored.clear()
      for (const mutation of tx.mutations) {
        const key = mutation.key as number
        if (mutation.type === `delete`) stored.delete(key)
        else
          stored.set(key, {
            value: (mutation.type === `update`
              ? { ...stored.get(key)?.value, ...mutation.value }
              : mutation.value) as Row,
            metadata: stored.get(key)?.metadata,
          })
      }
      for (const mutation of tx.rowMetadataMutations ?? []) {
        const row = stored.get(mutation.key as number)
        if (row)
          row.metadata = mutation.type === `delete` ? undefined : mutation.value
      }
      for (const mutation of tx.collectionMetadataMutations ?? [])
        if (mutation.type === `delete`)
          storedCollectionMetadata.delete(mutation.key)
        else storedCollectionMetadata.set(mutation.key, mutation.value)
    },
    ensureIndex: () => Promise.resolve(),
  }
  return {
    adapter,
    /** A peer's durable write at the next stream position. */
    peerWrite: (
      key: number,
      notice: PeerNotice,
      row: Row,
      metadata: unknown,
    ): typeof latest => {
      if (notice === `delete`) stored.delete(key)
      else if (notice === `metadata`) stored.get(key)!.metadata = metadata
      else stored.set(key, { value: row, metadata })
      latest = {
        term: Math.max(latest.term, 1),
        seq: latest.seq + 1,
        rowVersion: latest.rowVersion + 1,
      }
      return latest
    },
    holdNextStore: () => {
      holdNext = true
    },
    releaseStore: () => {
      holdNext = false
      releaseStore?.()
      releaseStore = undefined
    },
  }
}

const drainTurns = async () => {
  for (let turn = 0; turn < 20; turn++)
    await new Promise((resolve) => setTimeout(resolve, 0))
}

let run = 0

async function createPersistedDriver(
  withClient = false,
  cached = false,
  reads = false,
  peers = false,
): Promise<SessionDriver> {
  const store = createHoldingAdapter(cached, reads || peers)
  // The local coordinator persists this tab's commits through the adapter;
  // `deliver` hands it a peer's notice.
  let deliver: ((message: ProtocolEnvelope<unknown>) => void) | undefined
  const coordinator = peers
    ? Object.assign(new SingleProcessCoordinator(), {
        subscribe: (
          _collectionId: string,
          onMessage: (message: ProtocolEnvelope<unknown>) => void,
        ) => {
          deliver = onMessage
          return () => {
            deliver = undefined
          }
        },
      })
    : undefined
  const id = `sync-metadata-session-persisted-${run++}`
  let sync!: SyncActions
  let resolveMutation: (() => void) | undefined
  const client = withClient ? new DbClient() : undefined
  const options = persistedCollectionOptions<Row, number>({
    id,
    getKey: (row) => row.id,
    // A read hold needs an on-demand load to keep in flight.
    ...(reads ? { syncMode: `on-demand` as const } : {}),
    sync: {
      sync: (actions) => {
        sync = actions
        actions.begin()
        actions.commit()
        actions.markReady()
        return reads ? { loadSubset: () => true } : undefined
      },
    },
    onInsert: () =>
      new Promise<void>((resolve) => {
        resolveMutation = resolve
      }),
    persistence: { adapter: store.adapter, coordinator },
  } as CollectionConfig<Row, number> & {
    persistence: { adapter: PersistenceAdapter }
  })
  const collection = client
    ? client.collection(
        collectionOptions(options as CollectionConfig<Row, number>),
      )
    : createCollection(options)
  await collection.preload()
  await drainTurns()

  let depth = 0
  let holdCount = 0
  let blocker: { isPersisted: { promise: Promise<unknown> } } | undefined
  const receipts: Array<Promise<void>> = []
  const rejections: Array<string> = []
  const receiptStates: Array<ReceiptState> = []
  const track = (receipt: true | Promise<void>, expectAbort: boolean) => {
    if (receipt === true) return
    receipts.push(
      receipt.then(
        () => {
          if (expectAbort) rejections.push(`cancelled transaction applied`)
        },
        (error: unknown) => {
          if (
            !expectAbort ||
            !(error instanceof Error) ||
            error.name !== `AbortError`
          )
            rejections.push(
              error instanceof Error
                ? `${error.name}: ${error.message}`
                : String(error),
            )
        },
      ),
    )
  }
  const abort = () => {
    const controller = new AbortController()
    controller.abort()
    track(sync.commit(controller.signal), true)
    depth--
  }
  const metadata = () => sync.metadata!
  const read = (value: unknown) => (value === undefined ? absentMarker : value)
  let readGate: { resolve: () => void } | undefined
  let reading: Promise<unknown> | undefined
  const release = async () => {
    readGate?.resolve()
    readGate = undefined
    await reading
    reading = undefined
    store.releaseStore()
    const pending = blocker
    blocker = undefined
    resolveMutation?.()
    resolveMutation = undefined
    await pending?.isPersisted.promise
  }
  const asMetadata = (value: unknown) =>
    value === undefined ? {} : { metadata: value as Record<string, unknown> }

  return {
    consumerCheckpoint: `final`,
    begin: () => {
      sync.begin()
      depth++
    },
    commit: () => {
      const index = receiptStates.length
      const receipt = sync.commit()
      depth--
      if (receipt === true) {
        receiptStates.push(`applied`)
        return
      }
      receiptStates.push(`pending`)
      receipts.push(
        receipt.then(
          () => {
            receiptStates[index] = `applied`
          },
          () => {
            receiptStates[index] = `rejected`
          },
        ),
      )
    },
    cancel: abort,
    rowSet: (key, value) => metadata().row.set(key, value),
    rowDelete: (key) => metadata().row.delete(key),
    insert: (_key, value, rowMetadata) =>
      sync.write({
        type: `insert`,
        value: value as Row,
        ...asMetadata(rowMetadata),
      }),
    update: (_key, value, rowMetadata) =>
      sync.write({
        type: `update`,
        value: value as Row,
        ...asMetadata(rowMetadata),
      }),
    delete: (key) => sync.write({ type: `delete`, key }),
    truncate: () => sync.truncate(),
    collectionSet: (key, value) => metadata().collection.set(key, value),
    collectionDelete: (key) => metadata().collection.delete(key),
    hold: (holdStore, holdRead) => {
      if (holdRead) {
        let open!: () => void
        const gate = new Promise<void>((resolve) => {
          open = resolve
        })
        readGate = { resolve: open }
        const loadSubset = store.adapter.loadSubset
        store.adapter.loadSubset = async (...args) => {
          await gate
          store.adapter.loadSubset = loadSubset
          return loadSubset(...args)
        }
        reading = Promise.resolve(
          collection._sync.loadSubset({ limit: 100 + holdCount++ }),
        ).catch(() => undefined)
      } else if (holdStore) store.holdNextStore()
      else blocker = collection.insert({ id: 1000 + holdCount++, v: 0 })
    },
    release,
    seed: (key, row, rowMetadata) =>
      client!.hydrate({
        collections: [
          {
            collectionId: id,
            rows: [
              {
                key,
                value: row as Row,
                metadata: rowMetadata as Record<string, unknown>,
              },
            ],
          },
        ],
      }),
    peer: async (key, notice, row, metadata) => {
      const position = store.peerWrite(key, notice, row as Row, metadata)
      const named =
        notice === `row`
          ? {
              changedRows: [{ key, value: row as Record<string, unknown> }],
              deletedKeys: [],
              rowMetadataMutations: [
                { type: `set` as const, key, value: metadata },
              ],
            }
          : notice === `metadata`
            ? {
                changedRows: [],
                deletedKeys: [],
                rowMetadataMutations: [
                  { type: `set` as const, key, value: metadata },
                ],
              }
            : { changedRows: [], deletedKeys: [key] }
      deliver?.({
        v: 1,
        dbName: `sync-metadata-session`,
        collectionId: id,
        senderId: `peer-tab`,
        ts: Date.now(),
        payload: {
          type: `tx:committed`,
          term: position.term,
          seq: position.seq,
          txId: `peer-${position.seq}`,
          latestRowVersion: position.rowVersion,
          ...(notice === `reload`
            ? { requiresFullReload: true }
            : { requiresFullReload: false, ...named }),
        },
      })
      // The wrapper handles a notice under its apply lock and may reload
      // storage first. A notice it never handled leaves the peer's write
      // invisible, which the comparison reports, because every peer action
      // the model allows changes a read except a full reload that a held
      // seed keeps (decision 13).
      await drainTurns()
    },
    observe: () => ({
      rowMetadata: {
        1: read(metadata().row.get(1)),
        2: read(metadata().row.get(2)),
      },
      collection: {
        ...Object.fromEntries(
          sessionCollectionKeys.map((key) => [
            key,
            read(metadata().collection.get(key)),
          ]),
        ),
      },
      list: sorted(metadata().collection.list()),
      prefixList: sorted(metadata().collection.list(`gc:`)),
      base: {
        1: read(collection.base.get(1)),
        2: read(collection.base.get(2)),
      },
      receipts: [...receiptStates],
    }),
    flush: () => new Promise((resolve) => setTimeout(resolve, 0)),
    settle: async () => {
      await release()
      while (depth > 0) abort()
      await drainTurns()
      await Promise.all(receipts)
      await drainTurns()
      return rejections
    },
    cleanup: () => collection.cleanup(),
  }
}

function sorted(
  entries: ReadonlyArray<{ key: string; value: unknown }>,
): Array<[string, unknown]> {
  return [...entries]
    .map(({ key, value }): [string, unknown] => [key, value])
    .sort(([a], [b]) => a.localeCompare(b))
}

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
 * writes beneath an open re-insert. Recorded in
 * docs/contributing/oracle-reviews/2026-10-22-sync-metadata-session.md.
 */
const peerReplays: Array<[string, Array<SessionAction>]> = [
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

describe(`sync metadata session oracle through the persisted wrapper: peer replays`, () => {
  it.each(peerReplays)(`replays: %s`, (_name, history) =>
    assertPersistedHistory(history, persistedPeerLane),
  )
})

describe(`sync metadata session oracle through the persisted wrapper: nesting and seeds`, () => {
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
})
