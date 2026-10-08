/**
 * Receiving witness for persisted-oracle.test.ts's source durability laws.
 * Chromium OPFS supplies the actual scheduler, worker, SQL and durable state.
 * Startup/subscription/after-ready histories cross default/browser coordinators,
 * empty/populated storage and a single insert/rich replacement history. Three
 * Collections have distinct schemas: A commits within hydration, B hydrates
 * behind it, and already-ready C requests ordinary durability during A's hold.
 *
 * The spec computes rows/metadata from the declared history, independently of
 * this driver. A real row SELECT supplies the held-read premise. Its exact
 * scope is retained only as a diagnostic identity, never used for storage.
 * Coordinator instrumentation associates each nested transaction with the
 * supplied live scope before detecting a scheduled public-adapter call. Thus
 * an unrelated regular operation overlapping hydration is not called a cycle.
 * All calls still reach production unchanged.
 *
 * Comparison cuts are held read, actual nested routing, and completed receipts,
 * exact owning-scope exit (16 held-read histories), peer readiness, durable
 * reads, and reopen. Eight after-ready controls have no held owning scope. Cleanup
 * copies the primary observation first and records each secondary failure;
 * page disposal owns remaining JS resources if the production cycle is red.
 * Other browsers, multi-tab election, physical I/O failures, arbitrary fairness
 * storms and cancellation remain with their existing owners.
 */
import { createCollection } from '../../db/src/index'
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '../src/index'
import type { Collection, SyncConfig } from '../../db/src/index'
import type { HydrationPersistenceAdapter } from '../../db-sqlite-persistence-core/src/index'

type Row = { id: string; value: number }
type Phase = `startup` | `subscription` | `after-ready`
type Receipt = `pending` | `fulfilled` | `rejected`
export type HydrationCommitObservation = {
  phase: Phase
  baseline: boolean
  rich: boolean
  browserCoordinator: boolean
  sourceStorageId: string
  rowReads: number
  cycleCalls: number
  held: {
    receipts: Array<Receipt>
    rows: Array<Row>
    ordinary: Receipt
    interleavedSql: Array<string>
    peerHydrationAdmitted: boolean
    ordinaryAdmitted: boolean
  } | null
  receipts: Array<Receipt>
  sourceStatus: string
  peerStatus: string
  ordinaryReceipt: Receipt
  owningScopeExited: boolean | null
  tailScheduling: Array<`public-apply` | `regular-scope`>
  peerWorkBeforeScopeExit: Array<string>
  ordinaryCommitSqlCalls: number
  rows: Array<Row>
  durableRows: Array<Row> | null
  durableMetadata: Array<{ key: string; value: unknown }> | null
  durableRowMetadata: Array<{ key: string | number; metadata: unknown }> | null
  peerRows: Array<Row> | null
  ordinaryRows: Array<Row> | null
  schemas: Array<{ collection_id: string; schema_version: number }> | null
  reopenedRows: Array<Row> | null
  errors: Array<string>
}
declare global {
  interface Window {
    __hydrationCommitResult?: HydrationCommitObservation
    __hydrationCommitError?: string
    __hydrationCommitCleanupErrors?: Array<string>
    __hydrationCommitDone?: boolean
  }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
function publicRows(collection: Collection<Row, string>): Array<Row> {
  return [...collection.values()]
    .map(({ id, value }) => ({ id, value }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
async function run(): Promise<void> {
  const params = new URL(location.href).searchParams
  const phase = params.get(`phase`) as Phase
  if (![`startup`, `subscription`, `after-ready`].includes(phase))
    throw new Error(`Invalid phase`)
  const baseline = params.get(`baseline`) === `true`
  const rich = params.get(`rich`) === `true`
  const browserCoordinator = params.get(`coordinator`) === `browser`
  const databaseName = `hc-${crypto.randomUUID()}.sqlite`
  const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
  const cleanup: Array<() => void | Promise<unknown>> = []
  const cleanupErrors: Array<string> = []
  const releaseRead = deferred()
  let disposeCoordinator: (() => void) | undefined
  let captured: HydrationCommitObservation | undefined
  let cycleCalls = 0
  try {
    const coordinator = browserCoordinator
      ? new BrowserCollectionCoordinator({ dbName: databaseName })
      : undefined
    if (coordinator) disposeCoordinator = () => coordinator.dispose()
    const readEntered = deferred()
    const cycle = deferred()
    const sourceStarted = deferred()
    const sourceReady = deferred()
    const peerReady = deferred()
    const scopeExited = deferred()
    const peerHydrationAdmission = deferred()
    const ordinaryAdmission = deferred()
    let observeContenders = false
    let peerHydrationAdmitted = false
    let ordinaryAdmitted = false
    let scopePremiseError: Error | undefined
    let holdRead = false
    let readHeld = false
    const interleavedSql: Array<string> = []
    let rowReads = 0
    let scopeSequence = 0
    let heldScope: number | undefined
    let owningScopeExited: boolean | null =
      phase === `after-ready` ? null : false
    const liveScopes = new Map<number, HydrationPersistenceAdapter>()
    let ordinaryCommitSqlCalls = 0
    const peerWorkBeforeScopeExit: Array<string> = []
    const observePeerWork = (operation: string) => {
      if (heldScope !== undefined && liveScopes.has(heldScope)) {
        peerWorkBeforeScopeExit.push(operation)
      }
    }
    const persistence = createBrowserWASQLitePersistence({
      database: {
        execute: async <T>(sql: string, bindings?: ReadonlyArray<unknown>) => {
          if (readHeld) interleavedSql.push(sql)
          // Every ordinary apply reads its applied_tx/version state before
          // writing. Observe C at that real SQL boundary, through scope exit.
          // Election stream-position reads intentionally bypass this scheduler
          // and are not regular work (getStreamPosition's existing contract).
          if (sql.includes(`AS already_applied`) && bindings?.includes(`c`)) {
            ordinaryCommitSqlCalls++
            observePeerWork(`ordinary-commit-sql`)
          }
          const result = await database.execute<T>(sql, bindings)
          if (sql.includes(`SELECT key, value, metadata, row_version FROM`)) {
            rowReads++
            if (holdRead) {
              holdRead = false
              // Public A scopes are serialized by the real shared scheduler.
              // Key by callback invocation, since SQLite reuses its loan object.
              // An invalid premise fails here instead of waiting for a lost exit.
              if (liveScopes.size !== 1) {
                scopePremiseError = new Error(
                  `Held read requires exactly one owning callback; got ${liveScopes.size}`,
                )
                readEntered.resolve()
                throw scopePremiseError
              }
              heldScope = liveScopes.keys().next().value
              readHeld = true
              readEntered.resolve()
              await releaseRead.promise
              readHeld = false
            }
          }
          return result
        },
      },
      ...(coordinator ? { coordinator } : {}),
    })
    const resolved = persistence.resolvePersistenceForCollection!({
      collectionId: `a`,
      mode: `sync-present`,
      schemaVersion: 11,
    })
    const adapter = resolved.adapter
    // On-demand A writes its claimed physical cache ID. Keep that ID from the
    // adapter's claim result so the scheduling and durable checks observe the
    // same Collection without guessing a storage-name format.
    let sourceStorageId = `a`
    let sourceClaimId: string | undefined
    if (phase === `subscription`) {
      const claim = adapter.claimCacheGeneration?.bind(adapter)
      if (!claim) throw new Error(`On-demand A requires a managed cache claim`)
      adapter.claimCacheGeneration = async (id) => {
        const result = await claim(id)
        if (id === `a`) {
          sourceStorageId = result.storageCollectionId
          sourceClaimId = result.claimId
        }
        return result
      }
    }
    const bAdapter = persistence.resolvePersistenceForCollection!({
      collectionId: `b`,
      mode: `sync-present`,
      schemaVersion: 22,
    }).adapter
    const cAdapter = persistence.resolvePersistenceForCollection!({
      collectionId: `c`,
      mode: `sync-present`,
      schemaVersion: 33,
    }).adapter
    const seed = (id: string, row: Row, target: typeof adapter) =>
      target.applyCommittedTx(id, {
        txId: `seed-${id}`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: row.id, value: row }],
      })
    if (baseline && phase === `subscription`) {
      const claim = await adapter.claimCacheGeneration!(`a`)
      await adapter.applyCommittedTx(claim.storageCollectionId, {
        txId: `seed-a`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: claim.claimId,
        mutations: [
          {
            type: `insert`,
            key: `baseline`,
            value: { id: `baseline`, value: 0 },
          },
        ],
      })
      await adapter.releaseCacheGenerationClaim!(claim.claimId)
    } else if (baseline) {
      await seed(`a`, { id: `baseline`, value: 0 }, adapter)
    }
    await seed(`b`, { id: `peer-baseline`, value: 22 }, bAdapter)
    const runScope = adapter.runInHydrationScope!.bind(adapter)
    const pendingHydrations = new Set<Promise<unknown>>()
    adapter.runInHydrationScope = (task) => {
      const result = runScope(async (scoped) => {
        const scope = ++scopeSequence
        liveScopes.set(scope, scoped)
        try {
          return await task(scoped)
        } finally {
          liveScopes.delete(scope)
          if (scope === heldScope) {
            owningScopeExited = true
            scopeExited.resolve()
          }
        }
      })
      pendingHydrations.add(result)
      void result.then(
        () => pendingHydrations.delete(result),
        () => pendingHydrations.delete(result),
      )
      return result
    }
    // Each method enqueues synchronously before returning its promise. Observe
    // that return without awaiting completion, which is blocked by A's read.
    const bHydrate = bAdapter.runInHydrationScope!.bind(bAdapter)
    bAdapter.runInHydrationScope = (task) => {
      const result = bHydrate((scoped) => {
        observePeerWork(`peer-hydrate`)
        return task(scoped)
      })
      if (observeContenders) {
        peerHydrationAdmitted = true
        peerHydrationAdmission.resolve()
      }
      return result
    }
    const admitOrdinary = () => {
      if (observeContenders) {
        ordinaryAdmitted = true
        ordinaryAdmission.resolve()
      }
    }
    // Default coordinator uses public apply; browser leadership uses the
    // regular-scope API before its writer lock. Observe both real entry paths.
    const cApply = cAdapter.applyCommittedTx.bind(cAdapter)
    cAdapter.applyCommittedTx = (...args) => {
      const result = cApply(...args)
      admitOrdinary()
      return result
    }
    const cRegular = cAdapter.runInRegularScope!.bind(cAdapter)
    cAdapter.runInRegularScope = (task) => {
      const result = cRegular((scoped) => {
        observePeerWork(`ordinary-scope`)
        return task(scoped)
      })
      admitOrdinary()
      return result
    }
    const nested = new Set<string>()
    const tailTransactions = new Set<string>()
    let tailStarted = false
    const tailScheduling: HydrationCommitObservation[`tailScheduling`] = []
    const aRegular = adapter.runInRegularScope!.bind(adapter)
    adapter.runInRegularScope = (task) => {
      const result = aRegular(task)
      if (tailStarted && tailTransactions.size > 0)
        tailScheduling.push(`regular-scope`)
      return result
    }
    const request = resolved.coordinator!.requestApplyCommittedTx.bind(
      resolved.coordinator!,
    )
    resolved.coordinator!.requestApplyCommittedTx = async (id, tx, scoped) => {
      const nestedHere =
        id === sourceStorageId &&
        scoped !== undefined &&
        [...liveScopes.values()].includes(scoped)
      if (nestedHere) nested.add(tx.txId)
      if (id === sourceStorageId && tailStarted) tailTransactions.add(tx.txId)
      try {
        return await request(id, tx, scoped)
      } finally {
        if (nestedHere) nested.delete(tx.txId)
      }
    }
    const apply = adapter.applyCommittedTx.bind(adapter)
    adapter.applyCommittedTx = (id, tx) => {
      const result = apply(id, tx)
      if (
        id === sourceStorageId &&
        tailStarted &&
        tailTransactions.has(tx.txId)
      )
        tailScheduling.push(`public-apply`)
      if (id === sourceStorageId && nested.has(tx.txId)) {
        cycleCalls++
        cycle.resolve()
      }
      return result
    }
    const errors: Array<string> = []
    const receiptStates: Array<Receipt> = []
    const receiptPromises: Array<Promise<void>> = []
    let source!: Parameters<SyncConfig<Row, string>[`sync`]>[0]
    const commit = (edit: () => void) => {
      source.begin()
      edit()
      const index = receiptStates.push(`pending`) - 1
      const receipt = Promise.resolve(source.commit()).then(
        () => {
          receiptStates[index] = `fulfilled`
        },
        (error: unknown) => {
          receiptStates[index] = `rejected`
          errors.push(String(error))
        },
      )
      receiptPromises.push(receipt)
    }
    const sourceHistory = () => {
      commit(() =>
        source.write({ type: `insert`, value: { id: `r1`, value: 1 } }),
      )
      if (!rich) return
      commit(() => source.metadata!.collection.set(`cursor`, 7))
      commit(() => {
        source.metadata!.collection.set(`cursor`, 8)
        source.truncate()
        source.write({ type: `insert`, value: { id: `r2`, value: 2 } })
        source.metadata!.row.set(`r2`, { owner: `source` })
      })
      commit(() =>
        source.write({ type: `update`, value: { id: `r2`, value: 3 } }),
      )
      commit(() =>
        source.write({ type: `insert`, value: { id: `temporary`, value: 4 } }),
      )
      commit(() => source.write({ type: `delete`, key: `temporary` }))
    }
    let ordinarySource!: Parameters<SyncConfig<Row, string>[`sync`]>[0]
    const c = createCollection(
      persistedCollectionOptions<Row, string>({
        id: `c`,
        schemaVersion: 33,
        persistence,
        getKey: (row) => row.id,
        sync: {
          sync: (controls) => {
            ordinarySource = controls
            controls.markReady()
          },
        },
      }),
    )
    cleanup.unshift(() => c.cleanup())
    await c.preload()
    holdRead = phase === `startup`
    const a = createCollection(
      persistedCollectionOptions<Row, string>({
        id: `a`,
        schemaVersion: 11,
        persistence,
        getKey: (row) => row.id,
        startSync: true,
        syncMode: phase === `subscription` ? `on-demand` : `eager`,
        sync: {
          sync: (controls) => {
            source = controls
            if (phase === `startup`) sourceHistory()
            controls.markReady()
            sourceStarted.resolve()
            return { loadSubset: () => true }
          },
        },
      }),
    )
    cleanup.unshift(() => a.cleanup())
    a.onFirstReady(() => {
      sourceReady.resolve()
      if (phase === `after-ready`) sourceHistory()
    })
    await sourceStarted.promise
    if (phase === `subscription`) {
      await sourceReady.promise
      holdRead = true
      const subscription = a.subscribeChanges(() => {}, {
        includeInitialState: true,
      })
      cleanup.unshift(() => subscription.unsubscribe())
    }
    if (phase !== `after-ready`) await readEntered.promise
    else {
      await sourceReady.promise
      scopeExited.resolve()
    }
    if (scopePremiseError) throw scopePremiseError
    if (phase === `subscription`) sourceHistory()
    observeContenders = true
    const b = createCollection(
      persistedCollectionOptions<Row, string>({
        id: `b`,
        schemaVersion: 22,
        persistence,
        getKey: (row) => row.id,
        startSync: true,
        sync: { sync: ({ markReady }) => markReady() },
      }),
    )
    cleanup.unshift(() => b.cleanup())
    b.onFirstReady(peerReady.resolve)
    ordinarySource.begin()
    ordinarySource.write({
      type: `insert`,
      value: { id: `ordinary`, value: 33 },
    })
    let ordinaryReceipt: Receipt = `pending`
    const ordinaryDone = Promise.resolve(ordinarySource.commit()).then(
      () => {
        ordinaryReceipt = `fulfilled`
      },
      (error: unknown) => {
        ordinaryReceipt = `rejected`
        errors.push(String(error))
      },
    )
    // Both contenders have crossed their real scheduling API before the cut.
    // No task tick or SQL latency is used as evidence of admission.
    await Promise.all([
      peerHydrationAdmission.promise,
      ordinaryAdmission.promise,
    ])
    const held =
      phase === `after-ready`
        ? null
        : {
            receipts: [...receiptStates],
            rows: publicRows(a),
            ordinary: ordinaryReceipt,
            interleavedSql: [...interleavedSql],
            peerHydrationAdmitted,
            ordinaryAdmitted,
          }
    releaseRead.resolve()
    await Promise.race([
      cycle.promise,
      Promise.all([
        sourceReady.promise,
        ...receiptPromises,
        peerReady.promise,
        ordinaryDone,
        scopeExited.promise,
      ]),
    ])
    let durableRows: Array<Row> | null = null
    let durableMetadata: Array<{ key: string; value: unknown }> | null = null
    let durableRowMetadata: Array<{
      key: string | number
      metadata: unknown
    }> | null = null
    let peerRows: Array<Row> | null = null
    let ordinaryRows: Array<Row> | null = null
    let schemas: HydrationCommitObservation[`schemas`] = null
    const reopenedRows: Array<Row> | null = null
    if (cycleCalls === 0) {
      // Truncate can trigger a follow-up subset hydrate. Join all public A
      // invocations already requested by the source history before issuing an
      // ordinary tail; the originally held callback alone is not quiescence.
      while (pendingHydrations.size > 0) {
        await Promise.all([...pendingHydrations])
      }
      // Record the tail at the coordinator's ordinary scheduling boundary. Rows
      // alone cannot distinguish a cached, expired loan from ordinary routing.
      tailStarted = true
      commit(() =>
        source.write({ type: `insert`, value: { id: `tail`, value: 9 } }),
      )
      await receiptPromises.at(-1)
      tailStarted = false
      const sourceClaimContext = sourceClaimId
        ? { cacheGenerationClaimId: sourceClaimId }
        : undefined
      const durable = await adapter.loadSubset(
        sourceStorageId,
        {},
        sourceClaimContext,
      )
      durableRows = durable
        .map(({ value }) => value as Row)
        .sort((x, y) => x.id.localeCompare(y.id))
      durableRowMetadata = durable
        .filter(({ metadata }) => metadata !== undefined)
        .map(({ key, metadata }) => ({ key, metadata }))
      durableMetadata = await adapter.loadCollectionMetadata!(
        sourceStorageId,
        sourceClaimContext,
      )
      peerRows = (await bAdapter.loadSubset(`b`, {})).map(
        ({ value }) => value as Row,
      )
      ordinaryRows = (await cAdapter.loadSubset(`c`, {})).map(
        ({ value }) => value as Row,
      )
      schemas = [
        ...(await database.execute<{
          collection_id: string
          schema_version: number
        }>(
          `SELECT collection_id, schema_version FROM collection_registry ORDER BY collection_id`,
        )),
      ]
    }
    captured = structuredClone({
      phase,
      baseline,
      rich,
      browserCoordinator,
      sourceStorageId,
      rowReads,
      cycleCalls,
      held,
      receipts: receiptStates,
      sourceStatus: a.status,
      peerStatus: b.status,
      ordinaryReceipt,
      owningScopeExited,
      tailScheduling,
      peerWorkBeforeScopeExit,
      ordinaryCommitSqlCalls,
      rows: publicRows(a),
      durableRows,
      durableMetadata,
      durableRowMetadata,
      peerRows,
      ordinaryRows,
      schemas,
      reopenedRows,
      errors,
    })
    window.__hydrationCommitResult = captured
    if (cycleCalls === 0) {
      await a.cleanup()
      if (phase === `subscription`) {
        // A partial on-demand cache does not certify offline Collection
        // restore. A fresh claim still proves the current physical rows were
        // durably stored after the first sync run releases its claim.
        const freshClaim = await adapter.claimCacheGeneration!(`a`)
        try {
          captured.reopenedRows = (
            await adapter.loadSubset(
              freshClaim.storageCollectionId,
              {},
              {
                cacheGenerationClaimId: freshClaim.claimId,
              },
            )
          )
            .map(({ value }) => value as Row)
            .sort((x, y) => x.id.localeCompare(y.id))
        } finally {
          await adapter.releaseCacheGenerationClaim!(freshClaim.claimId)
        }
      } else {
        const reopened = createCollection(
          persistedCollectionOptions<Row, string>({
            id: `a`,
            schemaVersion: 11,
            persistence,
            getKey: (row) => row.id,
            syncMode: `eager`,
          }),
        )
        cleanup.unshift(() => reopened.cleanup())
        await reopened.preload()
        captured.reopenedRows = publicRows(reopened)
      }
      window.__hydrationCommitResult = structuredClone(captured)
    }
  } catch (error) {
    window.__hydrationCommitError = String(error)
  } finally {
    releaseRead.resolve()
    // A real cycle prevents Collection teardown; closing the worker and the
    // isolated Playwright page releases it. Other cleanup failures cannot
    // replace the already-copied primary observation or skip database close.
    if (params.get(`cleanupFault`) === `true`) {
      cleanup.unshift(() => {
        throw new Error(`injected first cleanup failure`)
      })
      cleanup.push(() => {
        throw new Error(`injected last cleanup failure`)
      })
    }
    for (const action of cleanup) {
      if (cycleCalls > 0) break
      try {
        await action()
      } catch (error) {
        cleanupErrors.push(String(error))
      }
    }
    try {
      disposeCoordinator?.()
    } catch (error) {
      cleanupErrors.push(String(error))
    }
    try {
      await database.close?.()
    } catch (error) {
      cleanupErrors.push(String(error))
    }
    window.__hydrationCommitCleanupErrors = cleanupErrors
    window.__hydrationCommitDone = true
  }
}
void run().catch((error: unknown) => {
  window.__hydrationCommitError = String(error)
  window.__hydrationCommitDone = true
})
