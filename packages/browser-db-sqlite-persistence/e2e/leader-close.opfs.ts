/**
 * Host driver for the #2085 source-Collection law in
 * `leader-close-oracle.opfs.spec.ts`. A real Chromium page closes after its
 * OPFS adapter commits a follower RPC but before the leader answers. This
 * controls the response boundary; it does not stand in for Electric delivery.
 */
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '../src'
import type { Collection, SyncConfig } from '@tanstack/db'

type Row = { id: string; title: string }
type SourceParams = Parameters<SyncConfig<Row, string>['sync']>[0]
type ReceiptOutcome =
  | { status: `fulfilled` }
  | { status: `rejected`; errorName: string; message: string }
type Observation = {
  phase: `starting` | `ready` | `failed`
  failure?: string
  isLeader: boolean
  collectionStatus: string
  publicIds: Array<string>
  liveIds: Array<string>
  liveStatus: string
  publicEventKeys: Array<string>
  liveEventKeys: Array<string>
  authoredTxIds: Record<string, string>
  syncRuns: number
  heldAtCommitBoundary: boolean
  reconciliationRequested: boolean
  firstOutcome?: ReceiptOutcome
}
type Probe = {
  observe: () => Observation
  startSourceCommit: (id: string) => void
  commitNext: (id: string) => Promise<ReceiptOutcome>
  durableState: () => Promise<{
    ids: Array<string>
    cursor: string | null
    rowVersion: number
  }>
  durableTxIds: () => Promise<Array<string>>
  releaseReconciliation: () => void
  cleanup: () => Promise<Array<string>>
}

declare global {
  interface Window {
    __leaderCloseProbe?: Probe
  }
}

const parameters = new URL(location.href).searchParams
const databaseId = parameters.get(`databaseId`)
const role = parameters.get(`role`)
const hold = parameters.get(`hold`)
if (
  !databaseId ||
  (role !== `leader` && role !== `follower` && role !== `passive`) ||
  (hold !== `none` &&
    hold !== `before` &&
    hold !== `after` &&
    hold !== `after-peer` &&
    hold !== `after-notify`)
) {
  throw new Error(`Invalid leader-close oracle parameters`)
}

let phase: Observation[`phase`] = `starting`
let failure: string | undefined
let source: SourceParams | undefined
let collection: Collection<Row, string> | undefined
let coordinator: BrowserCollectionCoordinator | undefined
let adapter:
  ReturnType<typeof createBrowserWASQLitePersistence>[`adapter`] | undefined
let database:
  Awaited<ReturnType<typeof openBrowserWASQLiteOPFSDatabase>> | undefined
let heldAtCommitBoundary = false
let reconciliationRequested = false
let releaseReconciliation = () => {}
const reconciliationRelease = new Promise<void>((resolve) => {
  releaseReconciliation = resolve
})
let firstOutcome: ReceiptOutcome | undefined
let syncRuns = 0
const publicEventKeys: Array<string> = []
const liveEventKeys: Array<string> = []
const authoredTxIds: Record<string, string> = {}
let publicSubscription: { unsubscribe: () => void } | undefined
let observeLive = (): { liveIds: Array<string>; liveStatus: string } => ({
  liveIds: [],
  liveStatus: `unavailable`,
})
let cleanupLive = async (): Promise<void> => {}

function asOutcome(error: unknown): ReceiptOutcome {
  return {
    status: `rejected`,
    errorName: error instanceof Error ? error.name : `NonError`,
    message: error instanceof Error ? error.message : String(error),
  }
}

function issueSourceCommit(id: string): Promise<ReceiptOutcome> {
  if (!source)
    return Promise.resolve(asOutcome(new Error(`source unavailable`)))
  try {
    source.begin()
    source.write({ type: `insert`, value: { id, title: id } })
    source.metadata?.collection.set(`probe:cursor`, id)
    return Promise.resolve(source.commit()).then(
      () => ({ status: `fulfilled` }),
      (error: unknown) => asOutcome(error),
    )
  } catch (error) {
    return Promise.resolve(asOutcome(error))
  }
}

window.__leaderCloseProbe = {
  observe: () => ({
    phase,
    ...(failure ? { failure } : {}),
    isLeader: coordinator?.isLeader(`messages`) ?? false,
    collectionStatus: collection?.status ?? `unavailable`,
    publicIds: collection ? Array.from(collection.keys()).sort() : [],
    ...observeLive(),
    publicEventKeys: [...publicEventKeys],
    liveEventKeys: [...liveEventKeys],
    authoredTxIds: { ...authoredTxIds },
    syncRuns,
    heldAtCommitBoundary,
    reconciliationRequested,
    ...(firstOutcome ? { firstOutcome } : {}),
  }),
  startSourceCommit: (id) => {
    void issueSourceCommit(id).then((outcome) => {
      firstOutcome = outcome
    })
  },
  commitNext: issueSourceCommit,
  durableState: async () => {
    if (!adapter) throw new Error(`adapter unavailable`)
    const snapshot = await adapter.loadResumeSnapshot(`messages`)
    return {
      ids: snapshot.rows.map(({ value }) => String(value.id)).sort(),
      cursor:
        (snapshot.collectionMetadata.find(({ key }) => key === `probe:cursor`)
          ?.value as string | undefined) ?? null,
      rowVersion: snapshot.latestRowVersion,
    }
  },
  durableTxIds: async () => {
    if (!database) throw new Error(`database unavailable`)
    const rows = await database.execute<{ tx_id: string }>(
      `SELECT tx_id FROM applied_tx WHERE collection_id = ? ORDER BY row_version`,
      [`messages`],
    )
    return rows.map((row) => row.tx_id)
  },
  releaseReconciliation: () => releaseReconciliation(),
  cleanup: async () => {
    releaseReconciliation()
    const failures: Array<string> = []
    publicSubscription?.unsubscribe()
    try {
      await cleanupLive()
    } catch (error) {
      failures.push(`live-query cleanup: ${String(error)}`)
    }
    try {
      await collection?.cleanup()
    } catch (error) {
      failures.push(`Collection cleanup: ${String(error)}`)
    }
    try {
      coordinator?.dispose()
    } catch (error) {
      failures.push(`coordinator disposal: ${String(error)}`)
    }
    try {
      await database?.close?.()
    } catch (error) {
      failures.push(`database close: ${String(error)}`)
    }
    return failures
  },
}

try {
  database = await openBrowserWASQLiteOPFSDatabase({
    databaseName: `${databaseId}.sqlite`,
  })
  if (role === `leader` && hold === `after-notify`) {
    const originalPostMessage = BroadcastChannel.prototype.postMessage
    BroadcastChannel.prototype.postMessage = function (message: unknown) {
      const payload =
        message && typeof message === `object` && `payload` in message
          ? message.payload
          : undefined
      if (
        payload &&
        typeof payload === `object` &&
        `type` in payload &&
        payload.type === `rpc:applyCommittedTx:res` &&
        `ok` in payload &&
        payload.ok === true
      ) {
        heldAtCommitBoundary = true
        return
      }
      originalPostMessage.call(this, message)
    }
  }
  coordinator = new BrowserCollectionCoordinator({ dbName: databaseId })
  const originalRequest = coordinator.requestApplyCommittedTx.bind(coordinator)
  coordinator.requestApplyCommittedTx = (collectionId, tx, scopedAdapter) => {
    for (const mutation of tx.mutations) {
      authoredTxIds[String(mutation.key)] = tx.txId
    }
    return originalRequest(collectionId, tx, scopedAdapter)
  }
  if (role === `follower` && hold === `after-peer`) {
    const originalReconcile = coordinator.reconcileCommittedTx.bind(coordinator)
    coordinator.reconcileCommittedTx = async (
      collectionId,
      tx,
      anchor,
      scopedAdapter,
    ) => {
      reconciliationRequested = true
      await reconciliationRelease
      return originalReconcile(collectionId, tx, anchor, scopedAdapter)
    }
  }
  const persistence = createBrowserWASQLitePersistence({
    database,
    coordinator,
  })
  const options = persistedCollectionOptions<Row, string>({
    id: `messages`,
    getKey: (row) => row.id,
    sync: {
      sync: (params) => {
        syncRuns++
        source = params
        params.markReady()
      },
    },
    persistence,
    schemaVersion: 1,
  })
  adapter = options.persistence.adapter
  if (role === `leader`) {
    // The coordinator's ordinary route receives the scheduler's scoped
    // adapter. Intercept that exact adapter after its durable write, before
    // the RPC response, so the hold reaches the real host path.
    const originalRegular = adapter.runInRegularScope?.bind(adapter)
    if (!originalRegular) throw new Error(`regular scope unavailable`)
    adapter.runInRegularScope = (task) =>
      originalRegular((scopedAdapter) =>
        task({
          ...scopedAdapter,
          applyCommittedTx: async (collectionId, tx) => {
            if (
              hold === `before` &&
              tx.mutations.some((mutation) => mutation.key === `crossing`)
            ) {
              heldAtCommitBoundary = true
              await new Promise<void>(() => {})
            }
            await scopedAdapter.applyCommittedTx(collectionId, tx)
            if (
              (hold === `after` || hold === `after-peer`) &&
              tx.mutations.some((mutation) => mutation.key === `crossing`)
            ) {
              heldAtCommitBoundary = true
              await new Promise<void>(() => {})
            }
          },
        }),
      )
  }
  collection = createCollection(options)
  await collection.preload()
  publicSubscription = collection.subscribeChanges((changes) => {
    publicEventKeys.push(...changes.map(({ key }) => String(key)))
  })
  const mountedLive = createLiveQueryCollection((q) =>
    q.from({ row: collection! }),
  )
  const mountedSubscription = mountedLive.subscribeChanges((changes) => {
    liveEventKeys.push(...changes.map(({ key }) => String(key)))
  })
  observeLive = () => ({
    liveIds: Array.from(mountedLive.keys()).map(String).sort(),
    liveStatus: mountedLive.status,
  })
  cleanupLive = async () => {
    mountedSubscription.unsubscribe()
    await mountedLive.cleanup()
  }
  await mountedLive.preload()
  phase = `ready`
} catch (error) {
  failure =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  phase = `failed`
}
