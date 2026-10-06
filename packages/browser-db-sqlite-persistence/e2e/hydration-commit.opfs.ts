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
 * exact owning-scope exit, peer readiness, durable reads, and reopen. Cleanup
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
  rowReads: number
  cycleCalls: number
  held: {
    receipts: Array<Receipt>
    rows: Array<Row>
    ordinary: Receipt
    interleavedSql: Array<string>
  } | null
  receipts: Array<Receipt>
  sourceStatus: string
  peerStatus: string
  ordinaryReceipt: Receipt
  owningScopeExited: boolean
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
    let holdRead = false
    let readHeld = false
    const interleavedSql: Array<string> = []
    let rowReads = 0
    let activeScope: HydrationPersistenceAdapter | undefined
    let heldScope: HydrationPersistenceAdapter | undefined
    let owningScopeExited = phase === `after-ready`
    const liveScopes = new Set<HydrationPersistenceAdapter>()
    const persistence = createBrowserWASQLitePersistence({
      database: {
        execute: async <T>(sql: string, bindings?: ReadonlyArray<unknown>) => {
          if (readHeld) interleavedSql.push(sql)
          const result = await database.execute<T>(sql, bindings)
          if (sql.includes(`SELECT key, value, metadata, row_version FROM`)) {
            rowReads++
            if (holdRead) {
              holdRead = false
              heldScope = activeScope
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
    if (baseline) await seed(`a`, { id: `baseline`, value: 0 }, adapter)
    await seed(`b`, { id: `peer-baseline`, value: 22 }, bAdapter)
    const runScope = adapter.runInHydrationScope!.bind(adapter)
    adapter.runInHydrationScope = (task) =>
      runScope(async (scoped) => {
        activeScope = scoped
        liveScopes.add(scoped)
        try {
          return await task(scoped)
        } finally {
          liveScopes.delete(scoped)
          activeScope = undefined
          if (scoped === heldScope) {
            owningScopeExited = true
            scopeExited.resolve()
          }
        }
      })
    const nested = new Set<string>()
    const request = resolved.coordinator!.requestApplyCommittedTx.bind(
      resolved.coordinator!,
    )
    resolved.coordinator!.requestApplyCommittedTx = async (id, tx, scoped) => {
      const nestedHere =
        id === `a` && scoped !== undefined && liveScopes.has(scoped)
      if (nestedHere) nested.add(tx.txId)
      try {
        return await request(id, tx, scoped)
      } finally {
        if (nestedHere) nested.delete(tx.txId)
      }
    }
    const apply = adapter.applyCommittedTx.bind(adapter)
    adapter.applyCommittedTx = (id, tx) => {
      const result = apply(id, tx)
      if (id === `a` && nested.has(tx.txId)) {
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
    if (phase === `subscription`) sourceHistory()
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
    // Drain promise reactions while the provider gate is still held. The hold,
    // rather than elapsed time, supplies the no-settlement premise.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const held =
      phase === `after-ready`
        ? null
        : {
            receipts: [...receiptStates],
            rows: publicRows(a),
            ordinary: ordinaryReceipt,
            interleavedSql: [...interleavedSql],
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
      // A same-run ordinary commit challenges leaked scoped adapters.
      commit(() =>
        source.write({ type: `insert`, value: { id: `tail`, value: 9 } }),
      )
      await receiptPromises.at(-1)
      const durable = await adapter.loadSubset(`a`, {})
      durableRows = durable
        .map(({ value }) => value as Row)
        .sort((x, y) => x.id.localeCompare(y.id))
      durableRowMetadata = durable
        .filter(({ metadata }) => metadata !== undefined)
        .map(({ key, metadata }) => ({ key, metadata }))
      durableMetadata = await adapter.loadCollectionMetadata!(`a`)
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
      rowReads,
      cycleCalls,
      held,
      receipts: receiptStates,
      sourceStatus: a.status,
      peerStatus: b.status,
      ordinaryReceipt,
      owningScopeExited,
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
