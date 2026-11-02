// @vitest-environment node
/**
 * The sync metadata session oracle's seed/re-insert/reload law crosses real
 * SQLite and coordinator boundaries here. The law, model, legal histories,
 * and comparison are imported from sync-metadata-session-oracle.ts. This
 * driver supplies two persisted Collections, two production coordinators over
 * Node's BroadcastChannel/Web Locks, and one node:sqlite database. Each
 * Collection has its own adapter; their shared physical database supplies the
 * shared scheduler premise.
 *
 * A peer's named notice comes from its real source commit. For a full reload,
 * that source takes a durable snapshot, changes the requested row, and commits
 * a snapshot transaction. This preserves every other durable row and causes
 * production to announce requiresFullReload. The receiver records the actual
 * notice and waits for SQL/message quiescence before the shared comparison.
 * Neither this driver nor the peer invents an expected metadata value.
 *
 * Limits: one process, one SQLite database, two Collections of one ID, no
 * transport loss or leadership turnover, and core holds only. This is a real
 * SQLite/coordinator receiving witness, not a Chromium OPFS or Electron claim.
 */
import { DatabaseSync } from 'node:sqlite'
import { it } from 'vitest'
import { DbClient, collectionOptions, whenSyncAccepted } from '@tanstack/db'
import { BrowserCollectionCoordinator } from '../../browser-db-sqlite-persistence/src/browser-coordinator'
import {
  absentMarker,
  cachedMetadata,
  cachedRow,
  describeMismatch,
  persistedPeerFullLane,
  persistedPeerLane,
  persistedPeerOnDemandLane,
  runSessionHistory,
  seedReinsertReloadReplay,
  sessionCollectionKeys,
} from '../../db/tests/sync-metadata-session-oracle'
import {
  oracleReplayTest,
  readOracleRunConfig,
} from '../../db/tests/oracle-config'
import {
  SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY,
  SQLiteCorePersistenceAdapter,
  eagerStorageTarget,
  managedStorageTarget,
  persistedCollectionOptions,
} from '../src'
import { createMetadataSQLiteDriver } from './sync-metadata-sqlite-driver'
import {
  runKeptMetadataDurabilityCampaign,
  runSeedReinsertReloadCampaign,
} from './sync-metadata-session-campaign'
import type { SyncConfig } from '@tanstack/db'
import type {
  ReceiptState,
  SessionAction,
  SessionDriver,
  SessionLane,
  SessionRecoveryInput,
} from '../../db/tests/sync-metadata-session-oracle'

type Row = { id: number; v: unknown }
type Actions = Parameters<SyncConfig<Row, number>[`sync`]>[0]
let run = 0

/**
 * Supplies the shared model with two SQLite-backed Collections and real
 * coordinator traffic. Each authored action drains its correlated recovery
 * before comparison; returned recovery inputs contain no expected metadata.
 */
async function createSQLiteDriver(lane: SessionLane): Promise<SessionDriver> {
  const database = new DatabaseSync(`:memory:`)
  const { driver, drained } = createMetadataSQLiteDriver(database)
  Object.defineProperty(driver, SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY, {
    value: {},
  })
  const adapters = [
    new SQLiteCorePersistenceAdapter({ driver }),
    new SQLiteCorePersistenceAdapter({ driver }),
  ]
  const id = `metadata-items`
  const seedClaim = lane.onDemand
    ? await adapters[0]!.claimCacheGeneration(id)
    : undefined
  const target = seedClaim
    ? managedStorageTarget(seedClaim.storageCollectionId, seedClaim.claimId)
    : eagerStorageTarget(id)
  const storageId = seedClaim?.storageCollectionId ?? id
  await adapters[0]!.applyCommittedTx(target, {
    txId: `cached`,
    term: 1,
    seq: 1,
    rowVersion: 1,
    cacheGenerationClaimId: seedClaim?.claimId,
    mutations: [{ type: `insert`, key: 1, value: cachedRow }],
    rowMetadataMutations: [{ type: `set`, key: 1, value: cachedMetadata }],
  })
  const dbName = `sync-metadata-receiving-${process.pid}-${run++}`
  const coordinators = adapters.map(
    (adapter) => new BrowserCollectionCoordinator({ dbName, adapter }),
  )
  // Observe the transport's replay information, not the wrapper's decision or a
  // metadata mismatch. Without replay details this response cannot distinguish
  // earlier cached writes from this run's writes; D15 governs that information
  // gap. The model derives its effect solely from its own durable storage.
  const recoveryInputs: Array<SessionRecoveryInput> = []
  const pendingRecoveryInputs: Array<SessionRecoveryInput> = []
  const pullSince = coordinators[0]!.pullSince!.bind(coordinators[0])
  coordinators[0]!.pullSince = async (...args) => {
    const response = await pullSince(...args)
    if (response.ok && (response.requiresFullReload || !response.deltas))
      pendingRecoveryInputs.push({
        type: `unknown-storage-observation`,
        fromRowVersion: args[1],
        latestRowVersion: response.latestRowVersion,
      })
    return response
  }
  const hydrate = adapters[0]!.runInHydrationScope.bind(adapters[0])
  adapters[0]!.runInHydrationScope = (task) =>
    hydrate(async (adapter) => {
      const inputs = pendingRecoveryInputs.splice(0)
      const observation = { reads: 0 }
      const result = await task({
        ...adapter,
        loadSubset: async (...args) => {
          const rows = await adapter.loadSubset(...args)
          observation.reads++
          return rows
        },
      })
      if (inputs.length && observation.reads === 0)
        throw new Error(`recovery response completed no storage observation`)
      // The hydration task includes application. Merely receiving a response
      // that cleanup or claim recovery discards must not advance the model.
      recoveryInputs.push(...inputs)
      return result
    })
  const pendingEnsures = new Set<Promise<unknown>>()
  for (const coordinator of coordinators) {
    const request = coordinator.requestEnsureRemoteSubset.bind(coordinator)
    coordinator.requestEnsureRemoteSubset = (...args) => {
      const pending = request(...args)
      pendingEnsures.add(pending)
      const done = () => pendingEnsures.delete(pending)
      void pending.then(done, done)
      return pending
    }
  }
  let lastPeerTxId: string | undefined
  const sourceTxIds: Array<string> = []
  const sourceApply = coordinators[0]!.requestApplyCommittedTx.bind(
    coordinators[0],
  )
  coordinators[0]!.requestApplyCommittedTx = (...args) => {
    sourceTxIds.push(args[1].txId)
    return sourceApply(...args)
  }
  const peerApply = coordinators[1]!.requestApplyCommittedTx.bind(
    coordinators[1],
  )
  coordinators[1]!.requestApplyCommittedTx = (...args) => {
    lastPeerTxId = args[1].txId
    return peerApply(...args)
  }
  const notices: Array<{ reload: boolean; txId: string }> = []
  const noticeWaiters = new Set<() => void>()
  const actions: Array<Actions> = []
  let durableRows: ReadonlyArray<{
    key: string | number
    value: unknown
    metadata?: unknown
  }> = []
  const stopNotices = coordinators[0]!.subscribe(storageId, (message) => {
    const payload = message.payload as {
      type: string
      txId: string
      requiresFullReload?: boolean
    }
    if (payload.type === `tx:committed`) {
      notices.push({
        reload: payload.requiresFullReload === true,
        txId: payload.txId,
      })
      for (const wake of noticeWaiters) wake()
    }
  })
  const quiesce = async () => {
    // Each empty source commit enters the wrapper after already delivered
    // notices. Its acceptance drains that wrapper's apply lock without
    // waiting for visibility behind a core hold. No write or notice results.
    // These empty commits stutter in the model, including under two open
    // authored transactions; maxDepth bounds authored histories only.
    do {
      // An on-demand cached load may settle before its upstream ensure. Wait
      // for those actual coordinator replies before draining their receiver.
      await Promise.all([...pendingEnsures])
      for (const source of actions) {
        source.begin()
        await whenSyncAccepted(source.commit())
      }
      await adapters[0]!.runInRegularScope.afterQueuedWork()
      await drained()
    } while (pendingEnsures.size > 0)
    durableRows = await adapters[0]!.loadSubset(target, {})
  }
  const awaitNotice = (after: number, reload: boolean, txId: string) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        noticeWaiters.delete(check)
        reject(
          new Error(`the real coordinator did not deliver the expected notice`),
        )
      }, 5_000)
      const check = () => {
        if (
          !notices
            .slice(after)
            .some((entry) => entry.reload === reload && entry.txId === txId)
        )
          return
        clearTimeout(timer)
        noticeWaiters.delete(check)
        resolve()
      }
      noticeWaiters.add(check)
      check()
    })
  let resolveMutation: (() => void) | undefined
  const clients = [new DbClient(), new DbClient()]
  const collections = clients.map((client, index) =>
    client.collection(
      collectionOptions(
        persistedCollectionOptions<Row, number>({
          id,
          getKey: (row) => row.id,
          ...(lane.onDemand ? { syncMode: `on-demand` as const } : {}),
          sync: {
            rowUpdateMode: lane.fullRows ? `full` : `partial`,
            sync: (sync) => {
              actions[index] = sync
              sync.begin()
              sync.commit()
              sync.markReady()
              return lane.onDemand ? { loadSubset: () => true } : undefined
            },
          },
          onInsert: () =>
            new Promise<void>((resolve) => {
              resolveMutation = resolve
            }),
          persistence: {
            adapter: adapters[index]!,
            coordinator: coordinators[index]!,
          },
        }),
      ),
    ),
  )
  // These direct source histories have no live query to start on-demand sync.
  // Start both sources before a follower can route its first demand to its peer.
  for (const current of collections) current.startSyncImmediate()
  if (!lane.onDemand)
    await Promise.all(collections.map((collection) => collection.preload()))
  const demands = collections.map(() => ({}))
  if (lane.onDemand)
    await Promise.all(
      collections.map((collection, index) =>
        collection._sync.loadSubset(demands[index]!),
      ),
    )
  await quiesce()
  const sync = actions[0]!
  const metadata = sync.metadata!
  const collection = collections[0]!
  const receipts: Array<Promise<void>> = []
  const receiptStates: Array<ReceiptState> = []
  const rejections: Array<string> = []
  let depth = 0
  let holdCount = 0
  let blocker: { when: (state: 'settled') => Promise<unknown> } | undefined
  const release = async () => {
    resolveMutation?.()
    resolveMutation = undefined
    await blocker?.when(`settled`)
    blocker = undefined
  }
  const abort = () => {
    const controller = new AbortController()
    controller.abort()
    const receipt = sync.commit(controller.signal)
    depth--
    if (receipt !== true)
      receipts.push(
        receipt.catch((error: unknown) => {
          if (!(error instanceof Error) || error.name !== `AbortError`)
            rejections.push(String(error))
        }),
      )
  }
  const read = (value: unknown) => (value === undefined ? absentMarker : value)
  const sorted = (entries: ReadonlyArray<{ key: string; value: unknown }>) =>
    entries
      .map(({ key, value }): [string, unknown] => [key, value])
      .sort(([a], [b]) => a.localeCompare(b))
  const rowMetadata = (value: unknown) =>
    value === undefined ? {} : { metadata: value as Record<string, unknown> }
  return {
    consumerCheckpoint: `final`,
    begin: () => {
      sync.begin()
      depth++
    },
    commit: async () => {
      const noticeStart = notices.length
      const transactionStart = sourceTxIds.length
      const index = receiptStates.length
      const receipt = sync.commit()
      depth--
      receiptStates.push(receipt === true ? `applied` : `pending`)
      if (receipt !== true)
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
      // This bounded legal schedule completes the source's correlated notice
      // and any resulting recovery before the next authored action. In
      // particular, a peer write cannot enter the model ahead of a recovery
      // that actually read the pre-peer durable state. Core holds may keep the
      // applied receipt pending, so wait for acceptance rather than visibility.
      await whenSyncAccepted(receipt)
      for (const txId of sourceTxIds.slice(transactionStart))
        await awaitNotice(noticeStart, false, txId)
      await quiesce()
    },
    cancel: abort,
    rowSet: (key, value) => metadata.row.set(key, value),
    rowDelete: (key) => metadata.row.delete(key),
    insert: (_key, value, meta) =>
      sync.write({ type: `insert`, value: value as Row, ...rowMetadata(meta) }),
    update: (_key, value, meta) =>
      sync.write({ type: `update`, value: value as Row, ...rowMetadata(meta) }),
    delete: (key) => sync.write({ type: `delete`, key }),
    truncate: () => sync.truncate(),
    collectionSet: (key, value) => metadata.collection.set(key, value),
    collectionDelete: (key) => metadata.collection.delete(key),
    hold: (store, readHold) => {
      if (store || readHold)
        throw new Error(`the SQLite seed/re-insert grammar uses core holds`)
      blocker = collection.insert({ id: 1000 + holdCount++, v: 0 })
    },
    release,
    seed: (key, value, meta) =>
      clients[0]!.hydrate({
        collections: [
          {
            collectionId: id,
            rows: [
              {
                key,
                value: value as Row,
                metadata: meta as Record<string, unknown>,
              },
            ],
          },
        ],
      }),
    peer: async (key, notice, value, meta) => {
      await quiesce()
      const before = notices.length
      const peer = actions[1]!
      if (notice === `reload`) {
        const rows = await adapters[1]!.loadSubset(target, {})
        peer.begin({ snapshot: true })
        for (const row of rows)
          if (row.key !== key)
            peer.write({
              type: `insert`,
              value: row.value as Row,
              ...rowMetadata(row.metadata),
            })
      } else if (notice === `row`) peer.begin()
      else
        throw new Error(
          `unexpected peer notice in the seed/re-insert grammar: ${notice}`,
        )
      peer.write({ type: `insert`, value: value as Row, ...rowMetadata(meta) })
      await peer.commit()
      if (!lastPeerTxId)
        throw new Error(`the peer issued no durable transaction`)
      await awaitNotice(before, notice === `reload`, lastPeerTxId)
      await quiesce()
      if (
        !notices
          .slice(before)
          .some((entry) => entry.reload === (notice === `reload`))
      )
        throw new Error(
          `the real coordinator did not deliver the ${notice} notice`,
        )
      console.info(
        `SQLITE_METADATA_NOTICE ${JSON.stringify({ lane: lane.name, notice, received: notices.length - before })}`,
      )
    },
    observe: () => ({
      rowMetadata: {
        1: read(metadata.row.get(1)),
        2: read(metadata.row.get(2)),
      },
      collection: Object.fromEntries(
        sessionCollectionKeys.map((key) => [
          key,
          read(metadata.collection.get(key)),
        ]),
      ),
      list: sorted(metadata.collection.list()),
      prefixList: sorted(metadata.collection.list(`gc:`)),
      base: {
        1: read(collection.base.get(1)),
        2: read(collection.base.get(2)),
      },
      receipts: [...receiptStates],
    }),
    storedRows: () =>
      Object.fromEntries(
        [1, 2].map((key) => [
          key,
          read(durableRows.find((row) => row.key === key)?.value),
        ]),
      ),
    storedRowMetadata: () =>
      Object.fromEntries(
        [1, 2].map((key) => [
          key,
          read(durableRows.find((row) => row.key === key)?.metadata),
        ]),
      ),
    takeRecoveryInputs: () => {
      if (pendingRecoveryInputs.length)
        throw new Error(`recovery response was not applied before comparison`)
      return recoveryInputs.splice(0)
    },
    flush: quiesce,
    settle: async () => {
      await release()
      while (depth) abort()
      await quiesce()
      await Promise.all(receipts)
      await quiesce()
      return rejections
    },
    cleanup: async () => {
      await release()
      while (depth) abort()
      await Promise.all(receipts)
      if (lane.onDemand)
        for (const [index, current] of collections.entries())
          current._sync.unloadSubset(demands[index]!)
      await quiesce()
      await Promise.all(collections.map((current) => current.cleanup()))
      stopNotices()
      for (const coordinator of coordinators) coordinator.dispose()
      if (seedClaim)
        await adapters[0]!.releaseCacheGenerationClaim(seedClaim.claimId)
      await drained()
      database.close()
    },
  }
}

const lanes = [
  persistedPeerLane,
  persistedPeerFullLane,
  persistedPeerOnDemandLane,
]
async function check(history: ReadonlyArray<SessionAction>, lane: SessionLane) {
  return runSessionHistory(lane, history, () => createSQLiteDriver(lane))
}
oracleReplayTest(it).each(lanes)(
  `receives the seed/re-insert/reload replay through SQLite ($name)`,
  async (lane) => {
    const result = await check(seedReinsertReloadReplay, lane)
    if (result.mismatch)
      throw new Error(
        describeMismatch(seedReinsertReloadReplay, result.mismatch),
      )
  },
)

const property = `sync-metadata-session.sqlite-seed-reinsert-reload`
const requested = readOracleRunConfig().replayProperty
for (const campaign of [`fixed`, `random`] as const) {
  if (
    requested !== undefined &&
    (requested !== property || campaign === `fixed`)
  )
    continue
  it(`receives generated seed/re-insert/reload histories through SQLite (${campaign})`, async () => {
    // The peer action asserts actual requiresFullReload delivery before the
    // shared comparison passes; the campaign runner changes no host premise.
    await runSeedReinsertReloadCampaign({
      property,
      campaign,
      runHistory: check,
    })
  }, 120_000)
}
/**
 * Direct durability is a separate cut from this tab's metadata read. Each
 * generated batch crosses implicit keeps with explicit writes and updates
 * with flat/inner equal re-inserts, before and after named/unknown reloads.
 */
const durabilityProperty = `sync-metadata-session.sqlite-kept-metadata-durability`
for (const campaign of [`fixed`, `random`] as const) {
  if (
    requested !== undefined &&
    (requested !== durabilityProperty || campaign === `fixed`)
  )
    continue
  it(`keeps tab-local and durable metadata distinct (sqlite, ${campaign})`, async () => {
    const recoveryState = `on-demand: cached prior-run version crossed without replay details`
    await runKeptMetadataDurabilityCampaign({
      property: durabilityProperty,
      campaign,
      runHistory: check,
      extraStates: [recoveryState],
      extraReached: (lane, result) =>
        lane.onDemand &&
        result.recoveryInputs.some(
          (input) => input.fromRowVersion === 0 && input.latestRowVersion >= 2,
        )
          ? [recoveryState]
          : [],
    })
  }, 240_000)
}
