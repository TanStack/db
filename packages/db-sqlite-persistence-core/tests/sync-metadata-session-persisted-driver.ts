import {
  DbClient,
  collectionOptions,
  createCollection,
  whenSyncAccepted,
} from '@tanstack/db'
import {
  absentMarker,
  cachedMetadata,
  cachedRow,
  sessionCollectionKeys,
} from '../../db/tests/sync-metadata-session-oracle'
import { SingleProcessCoordinator, persistedCollectionOptions } from '../src'
import type { CollectionConfig, SyncConfig } from '@tanstack/db'
import type {
  PeerNotice,
  ReceiptState,
  SessionDriver,
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
  let resetEpoch = 0
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
  // Capture every completed durable transaction before another queued write
  // can replace it. The shared comparison permits identical empty commits.
  const metadataSnapshots: Array<Record<string, unknown>> = []
  const recordMetadata = () => {
    metadataSnapshots.push(
      structuredClone(
        Object.fromEntries(
          [1, 2].map((key) => {
            const value = stored.get(key)?.metadata
            return [key, value === undefined ? absentMarker : value]
          }),
        ),
      ),
    )
  }
  recordMetadata()
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
        resetEpoch,
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
      recordMetadata()
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
      rewrites = false,
    ): typeof latest => {
      if (notice === `reset`) {
        // A resetting tab that writes its rows back leaves storage as it was.
        if (!rewrites) {
          stored.clear()
          storedCollectionMetadata.clear()
        }
        resetEpoch++
        latest = { term: latest.term + 1, seq: 0, rowVersion: 0 }
        recordMetadata()
        return latest
      }
      if (notice === `delete`) stored.delete(key)
      else if (notice === `metadata`) stored.get(key)!.metadata = metadata
      else stored.set(key, { value: row, metadata })
      latest = {
        term: Math.max(latest.term, 1),
        seq: latest.seq + 1,
        rowVersion: latest.rowVersion + 1,
      }
      recordMetadata()
      return latest
    },
    resetEpoch: () => resetEpoch,
    /** The row storage holds for a key, if any. */
    storedRow: (key: number): Row | undefined => stored.get(key)?.value,
    storedRowMetadata: (key: number): unknown => stored.get(key)?.metadata,
    storedMetadataTrace: () => metadataSnapshots,
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

/**
 * Drives one persisted Collection through the shared session contract. Production
 * path options select hydration seeds, cached rows, storage holds and peer notices;
 * source reads and durable observations remain separate comparison inputs.
 */
export async function createPersistedDriver(
  withClient = false,
  cached = false,
  reads = false,
  peers = false,
  fullRows = false,
  onDemand = false,
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
    ...(reads || onDemand ? { syncMode: `on-demand` as const } : {}),
    sync: {
      ...(fullRows ? { rowUpdateMode: `full` as const } : {}),
      sync: (actions) => {
        sync = actions
        actions.begin()
        actions.commit()
        actions.markReady()
        return reads || onDemand ? { loadSubset: () => true } : undefined
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
  // Every row is demanded, so a reload or reset reads them all.
  if (onDemand) await collection._sync.loadSubset({})
  await drainTurns()

  let depth = 0
  let holdCount = 0
  // Signals of the outermost transactions committed during a read hold.
  let readCommits: Array<AbortController> = []
  let blocker: { when: (state: 'settled') => Promise<unknown> } | undefined
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
  let storageHeld = false
  const accepted: Array<Promise<unknown>> = []
  const release = async () => {
    readGate?.resolve()
    readGate = undefined
    readCommits = []
    await reading
    reading = undefined
    store.releaseStore()
    storageHeld = false
    const pending = blocker
    blocker = undefined
    resolveMutation?.()
    resolveMutation = undefined
    await pending?.when('settled')
  }
  const asMetadata = (value: unknown) =>
    value === undefined ? {} : { metadata: value as Record<string, unknown> }

  return {
    consumerCheckpoint: `final`,
    storedMetadataTrace: peers ? store.storedMetadataTrace : undefined,
    begin: () => {
      sync.begin()
      depth++
    },
    commit: () => {
      const index = receiptStates.length
      const controller = new AbortController()
      if (readGate && depth === 1) readCommits.push(controller)
      const receipt = sync.commit(controller.signal)
      accepted.push(
        Promise.resolve(whenSyncAccepted(receipt)).catch(() => undefined),
      )
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
    abandon: () => readCommits.pop()!.abort(),
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
      storageHeld = holdStore || holdRead === true
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
    peer: async (key, notice, row, metadata, rewrites) => {
      const position = store.peerWrite(
        key,
        notice,
        row as Row,
        metadata,
        rewrites,
      )
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
        payload:
          notice === `reset`
            ? {
                type: `collection:reset`,
                schemaVersion: 2,
                resetEpoch: store.resetEpoch(),
              }
            : {
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
    storedRows: () => ({
      1: read(store.storedRow(1)),
      2: read(store.storedRow(2)),
    }),
    storedRowMetadata: () => ({
      1: read(store.storedRowMetadata(1)),
      2: read(store.storedRowMetadata(2)),
    }),
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
    flush: async () => {
      // Acceptance follows durability even when a core hold delays visibility.
      // A deliberately held store/read has no completed durable cut yet.
      if (!storageHeld) await Promise.all(accepted)
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
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
