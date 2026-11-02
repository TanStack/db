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
import { DbClient, collectionOptions, whenSyncAccepted } from '@tanstack/db'
import { BrowserCollectionCoordinator } from '../../browser-db-sqlite-persistence/src/browser-coordinator'
import {
  absentMarker,
  cachedMetadata,
  cachedRow,
  sessionCollectionKeys,
} from '../../db/tests/sync-metadata-session-oracle'
import {
  SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY,
  SQLiteCorePersistenceAdapter,
  eagerStorageTarget,
  managedStorageTarget,
  persistedCollectionOptions,
} from '../src'
import { createMetadataSQLiteDriver } from './sync-metadata-sqlite-driver'
import { createRecoveryRecorder } from './sync-metadata-recovery-recorder'
import type {
  RecoveryDriver,
  RecoveryPhase,
} from '../../db/tests/sync-metadata-recovery-oracle'
import type { SyncConfig } from '@tanstack/db'
import type {
  ReceiptState,
  SessionLane,
} from '../../db/tests/sync-metadata-session-oracle'

type Row = { id: number; v: unknown }
type Actions = Parameters<SyncConfig<Row, number>[`sync`]>[0]
let run = 0

/**
 * Supplies the shared model with two SQLite-backed Collections and real
 * coordinator traffic. Each authored action drains its correlated recovery
 * before comparison; returned recovery inputs contain no expected metadata.
 */
export async function createSQLiteDriver(
  lane: SessionLane,
): Promise<RecoveryDriver> {
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
  const recorder = createRecoveryRecorder()
  let heldRecovery:
    | {
        phase: RecoveryPhase
        entered: () => void
        gate: Promise<void>
        release: () => void
      }
    | undefined
  const recoveryEvents: Array<RecoveryPhase> = []
  const boundary = async (phase: RecoveryPhase) => {
    recoveryEvents.push(phase)
    if (heldRecovery?.phase === phase) {
      heldRecovery.entered()
      await heldRecovery.gate
    }
  }
  const pullSince = coordinators[0]!.pullSince!.bind(coordinators[0])
  coordinators[0]!.pullSince = async (...args) => {
    const response = await pullSince(...args)
    if (response.ok && (response.requiresFullReload || !response.deltas)) {
      recorder.delivered({
        type: `unknown-storage-observation`,
        fromRowVersion: args[1],
        latestRowVersion: response.latestRowVersion,
      })
      await boundary(`response`)
    }
    return response
  }
  const hydrate = adapters[0]!.runInHydrationScope.bind(adapters[0])
  adapters[0]!.runInHydrationScope = (task) =>
    hydrate(async (adapter) =>
      recorder.hydrate(async (read) => {
        const recovery = recorder.pendingCount() > 0
        return task({
          ...adapter,
          loadSubset: async (...args) => {
            if (recovery) await boundary(`read`)
            const rows = await adapter.loadSubset(...args)
            read()
            // Hold the captured rows before the wrapper receives and applies
            // them, while the SQLite hydration scope still owns admission.
            if (recovery) await boundary(`application`)
            return rows
          },
        })
      }),
    )
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
  const sourceTransactions: Array<{ txId: string; reload: boolean }> = []
  const sourceApply = coordinators[0]!.requestApplyCommittedTx.bind(
    coordinators[0],
  )
  coordinators[0]!.requestApplyCommittedTx = (...args) => {
    sourceTransactions.push({
      txId: args[1].txId,
      reload: args[1].truncate === true,
    })
    return sourceApply(...args)
  }
  let peerSubmitted: (() => void) | undefined
  const peerApply = coordinators[1]!.requestApplyCommittedTx.bind(
    coordinators[1],
  )
  coordinators[1]!.requestApplyCommittedTx = (...args) => {
    lastPeerTxId = args[1].txId
    peerSubmitted?.()
    peerSubmitted = undefined
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
  let sourceStopped = false
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
      for (const [index, source] of actions.entries()) {
        if (sourceStopped && index === 0) continue
        source.begin()
        try {
          await whenSyncAccepted(source.commit())
        } catch (error) {
          if (!(
            sourceStopped &&
            index === 0 &&
            error instanceof Error &&
            error.name === `AbortError`
          ))
            throw error
        }
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
    holdRecovery: (phase) => {
      if (heldRecovery) throw new Error(`a recovery hold is already armed`)
      recoveryEvents.length = 0
      let entered!: () => void
      const reached = new Promise<void>((resolve) => {
        entered = resolve
      })
      let releaseRecovery!: () => void
      const gate = new Promise<void>((resolve) => {
        releaseRecovery = resolve
      })
      heldRecovery = { phase, entered, gate, release: releaseRecovery }
      return {
        reached,
        release: () => {
          releaseRecovery()
          heldRecovery = undefined
        },
      }
    },
    recoveryEvents: () => [...recoveryEvents],
    startPeerWrite: (value) => {
      const submitted = new Promise<void>((resolve) => {
        peerSubmitted = resolve
      })
      const peer = actions[1]!
      peer.begin()
      peer.write({
        type: `insert`,
        value: { id: 2, v: value },
        metadata: { peer: value },
      })
      return {
        submitted,
        applied: Promise.resolve(whenSyncAccepted(peer.commit())).then(
          () => {},
        ),
      }
    },
    stopSource: async () => {
      while (depth) abort()
      sourceStopped = true
      const stopped = collection.cleanup()
      recorder.discard()
      await stopped
    },
    consumerCheckpoint: `final`,
    begin: () => {
      sync.begin()
      depth++
    },
    commit: async () => {
      const noticeStart = notices.length
      const transactionStart = sourceTransactions.length
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
      for (const { txId, reload } of sourceTransactions.slice(transactionStart))
        await awaitNotice(noticeStart, reload, txId)
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
      } else if (
        notice === `row` ||
        notice === `metadata` ||
        notice === `delete`
      )
        peer.begin()
      else
        throw new Error(
          `unsupported peer notice in the native metadata driver: ${notice}`,
        )
      if (notice === `metadata`) peer.metadata!.row.set(key, meta)
      else if (notice === `delete`) peer.write({ type: `delete`, key })
      else
        peer.write({
          type: `insert`,
          value: value as Row,
          ...rowMetadata(meta),
        })
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
    takeRecoveryInputs: recorder.take,
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
      heldRecovery?.release()
      heldRecovery = undefined
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
