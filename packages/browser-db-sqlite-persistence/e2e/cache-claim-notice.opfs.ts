/**
 * Browser receiver for cache-claim-notice.opfs.spec.ts. Two real Chromium
 * contexts share OPFS, Web Locks, and BroadcastChannel. The test controls one
 * subscriber callback after native delivery; it never constructs or publishes
 * a notice. The source is a small deterministic provider that keeps one
 * explicit demand pending until a fresh source receipt applies, not Electric.
 */
import { createCollection } from '@tanstack/db'
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '../src'
import type { Collection, SyncConfig } from '@tanstack/db'
import type { ProtocolEnvelope } from '@tanstack/db-sqlite-persistence-core'

type Row = { id: string; title: string }
export type Observation = {
  phase: `starting` | `ready` | `failed`
  failure?: string
  storageId?: string
  isLeader: boolean
  publicIds: Array<string>
  sourceLoads: Array<boolean | undefined>
  pendingDemand: `not-started` | `pending` | `fulfilled` | `rejected`
  pendingDemandError?: string
  refetchEntered: boolean
  heldNotices: number
  receivedPeerNotices: Array<string>
  postedPeerNotices: Array<string>
}
type DurableObservation = {
  head: string
  claims: Array<{
    physicalId: string
    ids: Array<string>
    metadata: Array<string>
  }>
}
type Probe = {
  observe: () => Observation
  demand: () => Promise<void>
  beginPendingDemand: () => void
  holdPeerNotices: () => void
  releasePeerNotices: () => void
  advanceClock: (now: number) => void
  commitPeer: () => Promise<void>
  releaseRefetch: () => void
  durable: () => Promise<DurableObservation>
  cleanup: () => Promise<Array<string>>
}
declare global {
  interface Window {
    __cacheClaimNoticeProbe?: Probe
  }
}

const parameters = new URL(location.href).searchParams
const databaseId = parameters.get(`databaseId`)
const role = parameters.get(`role`)
const initialNow = Number(parameters.get(`now`))
if (
  !databaseId ||
  (role !== `expired` && role !== `warm`) ||
  !Number.isSafeInteger(initialNow)
) {
  throw new Error(`Invalid cache-claim notice parameters`)
}

const logicalId = `cache-claim-notice`
let hostNow = initialNow
let phase: Observation[`phase`] = `starting`
let failure: string | undefined
let storageId: string | undefined
let collection: Collection<Row, string> | undefined
let coordinator: BrowserCollectionCoordinator | undefined
let database:
  Awaited<ReturnType<typeof openBrowserWASQLiteOPFSDatabase>> | undefined
let persistence: ReturnType<typeof createBrowserWASQLitePersistence> | undefined
let source: Parameters<SyncConfig<Row, string>[`sync`]>[0] | undefined
let seeded = false
let refetchEntered = false
let refreshStarted = false
let pendingDemand: Observation[`pendingDemand`] = `not-started`
let pendingDemandError: string | undefined
let pendingDemandPromise: Promise<void> | undefined
let holdNotices = false
let releaseRefetch = () => {}
const refetchRelease = new Promise<void>((resolve) => {
  releaseRefetch = resolve
})
let releaseFreshApplied = () => {}
const freshApplied = new Promise<void>((resolve) => {
  releaseFreshApplied = resolve
})
const heldNotices: Array<() => void> = []
const receivedPeerNotices: Array<string> = []
const postedPeerNotices: Array<string> = []
const sourceLoads: Array<boolean | undefined> = []
let originalPostMessage:
  typeof BroadcastChannel.prototype.postMessage | undefined

const peerNoticeId = (message: unknown): string | undefined => {
  if (typeof message !== `object` || message === null) return undefined
  const envelope = message as {
    collectionId?: string
    payload?: {
      type?: string
      changedRows?: Array<{ key?: string | number }>
    }
  }
  return envelope.payload?.type === `tx:committed` &&
    envelope.payload.changedRows?.some(({ key }) => key === `peer`)
    ? envelope.collectionId
    : undefined
}

async function commit(row: Row): Promise<void> {
  if (!source) throw new Error(`Source is unavailable`)
  source.begin()
  source.write({ type: `insert`, value: row })
  const receipt = source.commit()
  if (receipt === true) throw new Error(`Source receipt was untracked`)
  await receipt
}

window.__cacheClaimNoticeProbe = {
  observe: () => ({
    phase,
    ...(failure ? { failure } : {}),
    storageId,
    isLeader: storageId ? (coordinator?.isLeader(storageId) ?? false) : false,
    publicIds: collection ? [...collection.keys()].sort() : [],
    sourceLoads: [...sourceLoads],
    pendingDemand,
    ...(pendingDemandError ? { pendingDemandError } : {}),
    refetchEntered,
    heldNotices: heldNotices.length,
    receivedPeerNotices: [...receivedPeerNotices],
    postedPeerNotices: [...postedPeerNotices],
  }),
  demand: async () => {
    if (!collection) throw new Error(`Collection is unavailable`)
    await collection._sync.loadSubset({ limit: 2 })
  },
  beginPendingDemand: () => {
    if (!collection) throw new Error(`Collection is unavailable`)
    if (pendingDemand !== `not-started`) {
      throw new Error(`Pending demand already started`)
    }
    pendingDemand = `pending`
    pendingDemandPromise = Promise.resolve(
      collection._sync.loadSubset({ limit: 1 }),
    ).then(
      () => {
        pendingDemand = `fulfilled`
      },
      (error: unknown) => {
        pendingDemand = `rejected`
        pendingDemandError = String(error)
      },
    )
  },
  holdPeerNotices: () => {
    holdNotices = true
  },
  releasePeerNotices: () => {
    holdNotices = false
    for (const deliver of heldNotices.splice(0)) deliver()
  },
  advanceClock: (now) => {
    hostNow = now
  },
  commitPeer: () => commit({ id: `peer`, title: `Peer source row` }),
  releaseRefetch: () => releaseRefetch(),
  durable: async () => {
    if (!database || !persistence) throw new Error(`Persistence unavailable`)
    const headRows = await database.execute<{ physical_id: string }>(
      `SELECT physical_id FROM cache_generation
       WHERE logical_id = ? AND retired = 0`,
      [logicalId],
    )
    const head = headRows[0]?.physical_id
    if (!head) throw new Error(`No current cache generation`)
    const claims = await database.execute<{
      physical_id: string
      claim_id: string
    }>(
      `SELECT physical_id, claim_id FROM cache_generation_claim
       WHERE logical_id = ? AND expires_at_ms > ? ORDER BY physical_id`,
      [logicalId, hostNow],
    )
    const adapter = persistence.resolvePersistenceForCollection!({
      collectionId: logicalId,
      mode: `sync-present`,
    }).adapter
    const snapshots = await Promise.all(
      claims.map(async ({ physical_id, claim_id }) => {
        const snapshot = await adapter.loadResumeSnapshot(physical_id, {
          cacheGenerationClaimId: claim_id,
        })
        return {
          physicalId: physical_id,
          ids: snapshot.rows.map(({ key }) => String(key)).sort(),
          metadata: snapshot.collectionMetadata.map(({ key }) => key).sort(),
        }
      }),
    )
    return { head, claims: snapshots }
  },
  cleanup: async () => {
    releaseRefetch()
    releaseFreshApplied()
    holdNotices = false
    for (const deliver of heldNotices.splice(0)) deliver()
    const failures: Array<string> = []
    try {
      await collection?.cleanup()
    } catch (error) {
      failures.push(`Collection: ${String(error)}`)
    }
    await pendingDemandPromise
    try {
      coordinator?.dispose()
    } catch (error) {
      failures.push(`Coordinator: ${String(error)}`)
    }
    try {
      await database?.close?.()
    } catch (error) {
      failures.push(`OPFS: ${String(error)}`)
    }
    if (originalPostMessage) {
      BroadcastChannel.prototype.postMessage = originalPostMessage
    }
    return failures
  },
}

try {
  originalPostMessage = BroadcastChannel.prototype.postMessage
  BroadcastChannel.prototype.postMessage = function (message: unknown) {
    const id = peerNoticeId(message)
    if (id) postedPeerNotices.push(id)
    return originalPostMessage!.call(this, message)
  }
  database = await openBrowserWASQLiteOPFSDatabase({
    databaseName: `${databaseId}.sqlite`,
  })
  coordinator = new BrowserCollectionCoordinator({ dbName: databaseId })
  const subscribe = coordinator.subscribe.bind(coordinator)
  coordinator.subscribe = (id, callback) =>
    subscribe(id, (message: ProtocolEnvelope<unknown>) => {
      const peerId = peerNoticeId(message)
      if (peerId) {
        receivedPeerNotices.push(peerId)
        if (holdNotices) {
          heldNotices.push(() => callback(message))
          return
        }
      }
      callback(message)
    })
  const setAdapter = coordinator.setAdapterForCollection.bind(coordinator)
  coordinator.setAdapterForCollection = (id, adapter, claimId) => {
    if (claimId) storageId = id
    setAdapter(id, adapter, claimId)
  }
  persistence = createBrowserWASQLitePersistence({
    database,
    coordinator,
    cacheGenerationClaimTtlMs: 300_000,
    now: () => hostNow,
  })
  collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id: logicalId,
      syncMode: `on-demand`,
      getKey: (row) => row.id,
      persistence,
      sync: {
        sync: (params) => {
          source = params
          params.markReady()
          return {
            restartAfterScopedRecovery: () => {},
            loadSubset: async (options) => {
              sourceLoads.push(options.refetch)
              if (role !== `expired`) return
              if (options.refetch) {
                if (!refreshStarted) {
                  refreshStarted = true
                  refetchEntered = true
                  await refetchRelease
                  await commit({ id: `fresh`, title: `Fresh source row` })
                  releaseFreshApplied()
                } else {
                  await freshApplied
                }
              } else if (options.limit === 1) {
                await freshApplied
              } else if (!seeded) {
                seeded = true
                await commit({ id: `old`, title: `Warm source row` })
              }
            },
          }
        },
      },
    }),
  )
  collection.startSyncImmediate()
  await collection.stateWhenReady()
  phase = `ready`
} catch (error) {
  failure =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  phase = `failed`
}
