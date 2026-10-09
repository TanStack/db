/**
 * Real Electric receiving driver for the source receipt law in
 * electric-leader-close.opfs.spec.ts. The follower uses the installed Electric
 * SDK; a separate manual source Collection only owns the first writer term.
 * The leader holds after SQLite commits the SDK's crossing row and before its
 * RPC reply. Closing that page supplies the browser lifecycle event.
 */
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import { electricCollectionOptions } from '../../electric-db-collection/src/electric'
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '../src'
import type { ElectricCollectionUtils } from '../../electric-db-collection/src/electric'

type Item = { id: string; label: string }
export type ElectricLeaderCloseObservation = {
  phase: 'starting' | 'ready' | 'failed'
  failure?: string
  isLeader: boolean
  status: string
  publicRows: Array<Item>
  liveRows: Array<Item>
  liveStatus: string
  heldAfterDurability: boolean
  crossingTxId?: string
  crossingTxIds: Array<string>
  crossingResumeMutation?: unknown
  crossingRpcError?: string
  crossingReceiptStatus?: 'pending' | 'fulfilled' | 'rejected'
  crossingReceiptError?: string
  syncRuns: number
  reconciliationRequested: boolean
  reconciliationSucceeded: boolean
  reconciledTxIds: Array<string>
  appliedKeys: Array<string>
}
type DurableState = { rows: Array<Item>; resume: unknown }
type Probe = {
  observe: () => ElectricLeaderCloseObservation
  durableState: () => Promise<DurableState>
  durableTxIds: () => Promise<Array<string>>
  cleanup: () => Promise<Array<string>>
}

declare global {
  interface Window {
    __electricLeaderCloseProbe?: Probe
  }
}

const parameters = new URL(location.href).searchParams
const databaseId = parameters.get('databaseId')
const collectionId = parameters.get('collectionId')
const table = parameters.get('table')
const role = parameters.get('role')
if (
  !databaseId ||
  !collectionId ||
  !table ||
  (role !== 'leader' && role !== 'follower')
) {
  throw new Error('Invalid Electric leader-close parameters')
}

let phase: ElectricLeaderCloseObservation['phase'] = 'starting'
let failure: string | undefined
let heldAfterDurability = false
let crossingTxId: string | undefined
const crossingTxIds: Array<string> = []
let crossingResumeMutation: unknown
let crossingRpcError: string | undefined
let crossingReceiptStatus: 'pending' | 'fulfilled' | 'rejected' | undefined
let crossingReceiptError: string | undefined
let syncRuns = 0
let reconciliationRequested = false
let reconciliationSucceeded = false
const reconciledTxIds: Array<string> = []
const appliedKeys: Array<string> = []
let isLeader = () => false
let observeRows = () => ({
  status: 'unavailable',
  publicRows: [] as Array<Item>,
  liveRows: [] as Array<Item>,
  liveStatus: 'unavailable',
})
let observeDurable = async (): Promise<DurableState> => ({
  rows: [],
  resume: undefined,
})
let readTxIds = async (): Promise<Array<string>> => []
const cleanupTasks: Array<() => Promise<void> | void> = []
let cleaned = false

function sortedRows(rows: Iterable<Item>): Array<Item> {
  return Array.from(rows, ({ id, label }) => ({ id, label })).sort((a, b) =>
    a.id.localeCompare(b.id),
  )
}

window.__electricLeaderCloseProbe = {
  observe: () => ({
    phase,
    ...(failure ? { failure } : {}),
    isLeader: isLeader(),
    ...observeRows(),
    heldAfterDurability,
    ...(crossingTxId ? { crossingTxId } : {}),
    crossingTxIds: [...crossingTxIds],
    ...(crossingResumeMutation ? { crossingResumeMutation } : {}),
    ...(crossingRpcError ? { crossingRpcError } : {}),
    ...(crossingReceiptStatus ? { crossingReceiptStatus } : {}),
    ...(crossingReceiptError ? { crossingReceiptError } : {}),
    syncRuns,
    reconciliationRequested,
    reconciliationSucceeded,
    reconciledTxIds: [...reconciledTxIds],
    appliedKeys: [...appliedKeys],
  }),
  durableState: () => observeDurable(),
  durableTxIds: () => readTxIds(),
  cleanup: async () => {
    if (cleaned) return []
    cleaned = true
    const failures: Array<string> = []
    for (const task of cleanupTasks) {
      try {
        await task()
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
    return failures
  },
}

try {
  const database = await openBrowserWASQLiteOPFSDatabase({
    databaseName: databaseId + '.sqlite',
  })
  cleanupTasks.unshift(async () => database.close?.())
  const coordinator = new BrowserCollectionCoordinator({ dbName: databaseId })
  cleanupTasks.unshift(() => coordinator.dispose())
  isLeader = () => coordinator.isLeader(collectionId)

  const originalRequest = coordinator.requestApplyCommittedTx.bind(coordinator)
  coordinator.requestApplyCommittedTx = (requestedId, tx, scopedAdapter) => {
    const crossing = tx.mutations.some(
      (mutation) => mutation.key === 'crossing',
    )
    if (crossing) {
      crossingTxId ??= tx.txId
      crossingTxIds.push(tx.txId)
      const resumeMutation = tx.collectionMetadataMutations?.find(
        (mutation) =>
          mutation.type === 'set' && mutation.key === 'electric:resume',
      )
      if (resumeMutation?.type === 'set') {
        crossingResumeMutation ??= resumeMutation.value
      }
    }
    const result = originalRequest(requestedId, tx, scopedAdapter)
    if (crossing) {
      void result.then(
        () => undefined,
        (error: unknown) => {
          crossingRpcError = error instanceof Error ? error.name : String(error)
        },
      )
    }
    return result
  }
  const originalReconcile = coordinator.reconcileCommittedTx.bind(coordinator)
  coordinator.reconcileCommittedTx = async (
    requestedId,
    tx,
    anchor,
    scopedAdapter,
  ) => {
    reconciliationRequested = true
    const response = await originalReconcile(
      requestedId,
      tx,
      anchor,
      scopedAdapter,
    )
    if (response.ok) {
      reconciliationSucceeded = true
      reconciledTxIds.push(tx.txId)
    }
    return response
  }

  const persistence = createBrowserWASQLitePersistence({
    database,
    coordinator,
  })
  let collectionAdapter = persistence.adapter
  observeDurable = async () => {
    const snapshot = await collectionAdapter.loadResumeSnapshot(collectionId)
    return {
      rows: sortedRows(snapshot.rows.map(({ value }) => value as Item)),
      resume: snapshot.collectionMetadata.find(
        ({ key }) => key === 'electric:resume',
      )?.value,
    }
  }
  readTxIds = async () => {
    const rows = await database.execute<{ tx_id: string }>(
      'SELECT tx_id FROM applied_tx WHERE collection_id = ? ORDER BY row_version',
      [collectionId],
    )
    return rows.map(({ tx_id }) => tx_id)
  }

  if (role === 'leader') {
    const options = persistedCollectionOptions<Item, string | number>({
      id: collectionId,
      getKey: (item) => item.id,
      sync: { sync: ({ markReady }) => markReady() },
      persistence,
      schemaVersion: 1,
    })
    collectionAdapter = options.persistence.adapter
    const originalRegular =
      collectionAdapter.runInRegularScope?.bind(collectionAdapter)
    if (!originalRegular) throw new Error('regular scope unavailable')
    collectionAdapter.runInRegularScope = (task) =>
      originalRegular((scopedAdapter) =>
        task({
          ...scopedAdapter,
          applyCommittedTx: async (requestedId, tx) => {
            appliedKeys.push(
              ...tx.mutations.map((mutation) => String(mutation.key)),
            )
            await scopedAdapter.applyCommittedTx(requestedId, tx)
            if (tx.mutations.some((mutation) => mutation.key === 'crossing')) {
              heldAfterDurability = true
              await new Promise<void>(() => {})
            }
          },
        }),
      )
    const collection = createCollection(options)
    cleanupTasks.unshift(() => collection.cleanup())
    observeRows = () => ({
      status: collection.status,
      publicRows: sortedRows(collection.values()),
      liveRows: [],
      liveStatus: 'unavailable',
    })
    await collection.preload()
  } else {
    const electric = electricCollectionOptions<Item>({
      id: collectionId,
      shapeOptions: {
        url: location.origin + '/electric/v1/shape',
        params: { table: 'public.' + table },
      },
      syncMode: 'eager',
      getKey: (item) => item.id,
    })
    const sourceSync = electric.sync
    const observedSourceSync = {
      ...sourceSync,
      sync: (params: Parameters<typeof sourceSync.sync>[0]) => {
        syncRuns++
        let includesCrossing = false
        return sourceSync.sync({
          ...params,
          begin: () => {
            includesCrossing = false
            return params.begin()
          },
          write: (message) => {
            if (message.type !== 'delete' && message.value.id === 'crossing') {
              includesCrossing = true
            }
            return params.write(message)
          },
          commit: (signal) => {
            const crossing = includesCrossing
            includesCrossing = false
            const applied = params.commit(signal)
            if (crossing) {
              crossingReceiptStatus = applied === true ? 'fulfilled' : 'pending'
              if (applied !== true) {
                void applied.then(
                  () => {
                    crossingReceiptStatus = 'fulfilled'
                  },
                  (error: unknown) => {
                    crossingReceiptStatus = 'rejected'
                    crossingReceiptError =
                      error instanceof Error ? error.name : String(error)
                  },
                )
              }
            }
            return applied
          },
        })
      },
    }
    const options = persistedCollectionOptions<
      Item,
      string | number,
      never,
      ElectricCollectionUtils<Item>
    >({
      ...electric,
      sync: observedSourceSync,
      persistence,
      schemaVersion: 1,
    })
    collectionAdapter = options.persistence.adapter
    const collection = createCollection(options)
    cleanupTasks.unshift(() => collection.cleanup())
    const live = createLiveQueryCollection((q) => q.from({ item: collection }))
    const liveSubscription = live.subscribeChanges(() => undefined)
    cleanupTasks.unshift(() => live.cleanup())
    cleanupTasks.unshift(() => liveSubscription.unsubscribe())
    observeRows = () => ({
      status: collection.status,
      publicRows: sortedRows(collection.values()),
      liveRows: sortedRows(live.values()),
      liveStatus: live.status,
    })
    await collection.preload()
    await live.preload()
  }
  phase = 'ready'
} catch (error) {
  failure =
    error instanceof Error
      ? error.name + ': ' + error.message + '\n' + (error.stack ?? '')
      : String(error)
  phase = 'failed'
}
