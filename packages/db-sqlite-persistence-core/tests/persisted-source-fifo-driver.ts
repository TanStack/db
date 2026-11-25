/**
 * Shared production driver for source FIFO. It records held publication,
 * receipt outcomes and final public/durable rows. The oracle owns all expected
 * results; this module imports no test runner and also runs in real Chromium.
 */
import { SyncTransactionAbortedError, createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../src'
import {
  describeOracleCleanupError,
  withOracleCleanup,
} from '../../db/tests/oracle-cleanup'
import type { HydrationPersistenceAdapter, PersistenceAdapter } from '../src'
import type {
  SourceFifoOrderingHistory,
  SourceFifoOrderingObservation,
} from './persisted-durability-model-oracle'
import type { Todo, TodoSyncParams } from './persisted-support'

export type SourceFifoRunResult = {
  relation: SourceFifoOrderingHistory[`relations`][number]
  events: Array<{ checkpoint: string; value: unknown }>
  reached: boolean
  receiptOutcomes: Array<{
    status: `fulfilled` | `rejected`
    name: string | null
    abortErrorInstance: boolean
  }>
  work?: {
    unrelatedRowCount: number
    snapshotCalls: number
    materializedRows: number
  }
  final: SourceFifoOrderingObservation
  cleanupErrors: Array<string>
  browserErrors?: ReadonlyArray<string>
  executionErrors?: ReadonlyArray<{
    relation: SourceFifoOrderingHistory[`relations`][number]
    message: string
  }>
}

async function atPersistedOracleCheckpoint<T>(
  promise: Promise<T>,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`Persisted oracle checkpoint timed out: ${label}`),
            ),
          5000,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
const flushAsyncWork = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0))
function createEventGate() {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
function observeSettlement(promise: Promise<void>) {
  let status = `pending`
  void promise.then(
    () => {
      status = `fulfilled`
    },
    () => {
      status = `rejected`
    },
  )
  return { read: () => ({ status }) }
}
function stripVirtualProps(value: Todo): Todo {
  const { id, title, ...fields } = value
  const clean = Object.fromEntries(
    Object.entries(fields).filter(
      ([key]) =>
        ![`$key`, `$origin`, `$collectionId`, `$hasPendingWrites`].includes(
          key,
        ),
    ),
  )
  return { id, title, ...clean }
}
async function cleanupPersistedOracle(
  actions: Array<() => unknown>,
  hasPrimaryFailure: boolean,
): Promise<Array<string>> {
  // The original driver preserves the check failure. Raw recording finishes
  // before teardown and each cleanup still receives its own bounded turn.
  try {
    await withOracleCleanup(
      async () => {},
      actions.map(
        (action, index) => () =>
          atPersistedOracleCheckpoint(
            Promise.resolve().then(action),
            `cleanup stage ${index}`,
          ),
      ),
    )
  } catch (error) {
    if (hasPrimaryFailure)
      console.warn(`Source FIFO secondary cleanup failure`, error)
    return [describeOracleCleanupError(error)]
  }
  return []
}

export type SourceFifoStore = {
  adapter: PersistenceAdapter
  read: () => Promise<{ rows: Array<Todo>; metadata: unknown }>
  close: () => void | Promise<void>
}
export type OpenSourceFifoStore = (
  id: string,
  initialRows: Array<Todo>,
  metadata: unknown,
  clock?: { now: () => number; ttl: number },
) => Promise<SourceFifoStore>
let generatedOwnershipHistoryId = 0
function sortedTodoRows(rows: Iterable<Todo>): Array<Todo> {
  return Array.from(rows).sort((left, right) => left.id.localeCompare(right.id))
}

// A failed demand owns one hydration replay queue. While the first partial
// transaction awaits its baseline, another source transaction can legally join
// that same queue. Its previously unseen key needs its own durable baseline.
async function runAppendedPartialHistory(
  olderTitle: string,
  newerTitle: string,
  unrelatedRowCount: number,
  open: OpenSourceFifoStore,
): Promise<SourceFifoRunResult> {
  const relation = `failed-hydration-appended-partial` as const
  const store = await open(
    `generated-source-fifo-append-${++generatedOwnershipHistoryId}`,
    [
      { id: `shared`, title: olderTitle, detail: `unseen durable field` },
      {
        id: `second`,
        title: olderTitle,
        detail: `second unseen durable field`,
      },
      ...Array.from({ length: unrelatedRowCount }, (_, i) => ({
        id: `unrelated-${i}`,
        title: `unrelated durable row ${i}`,
      })),
    ],
    { cached: true },
  )
  const { adapter } = store
  const readEntered = createEventGate(),
    releaseRead = createEventGate()
  const baselineEntered = createEventGate(),
    releaseBaseline = createEventGate()
  const loadFailure = new Error(`request-local FIFO read failure`)
  const writes: Array<Array<string | number>> = []
  const events: SourceFifoRunResult[`events`] = []
  const receipts: Array<Promise<void>> = []
  let sourceParams!: TodoSyncParams
  let holdRead = true,
    holdBaseline = true,
    baselinePending = false
  let baselineCalls = 0,
    baselineRows = 0,
    measuring = true
  const heldLoad = async (
    load: PersistenceAdapter[`loadSubset`],
    args: Parameters<PersistenceAdapter[`loadSubset`]>,
  ) => {
    const rows = await load(...args)
    if (holdRead) {
      holdRead = false
      readEntered.resolve()
      await releaseRead.promise
      throw loadFailure
    }
    return rows
  }
  const heldResume = async (
    load: PersistenceAdapter[`loadResumeSnapshot`],
    args: Parameters<PersistenceAdapter[`loadResumeSnapshot`]>,
  ) => {
    const snapshot = await load(...args)
    if (measuring && args[1]?.includeRows !== false) {
      baselineCalls++
      baselineRows += snapshot.rows.length
      if (holdBaseline) {
        holdBaseline = false
        baselinePending = true
        baselineEntered.resolve()
        await releaseBaseline.promise
        baselinePending = false
      }
    }
    return snapshot
  }
  const recordApply = async (
    apply: PersistenceAdapter[`applyCommittedTx`],
    args: Parameters<PersistenceAdapter[`applyCommittedTx`]>,
  ) => {
    if (args[1].mutations.length)
      writes.push([...new Set(args[1].mutations.map(({ key }) => key))])
    await apply(...args)
  }
  const decorate = (
    scope: HydrationPersistenceAdapter,
  ): HydrationPersistenceAdapter => ({
    ...scope,
    loadSubset: (...args) => heldLoad(scope.loadSubset.bind(scope), args),
    loadResumeSnapshot: (...args) =>
      heldResume(scope.loadResumeSnapshot.bind(scope), args),
    applyCommittedTx: (...args) =>
      recordApply(scope.applyCommittedTx.bind(scope), args),
  })
  const originalLoad = adapter.loadSubset.bind(adapter),
    originalResume = adapter.loadResumeSnapshot.bind(adapter),
    originalApply = adapter.applyCommittedTx.bind(adapter)
  adapter.loadSubset = (...args) => heldLoad(originalLoad, args)
  adapter.loadResumeSnapshot = (...args) => heldResume(originalResume, args)
  adapter.applyCommittedTx = (...args) => recordApply(originalApply, args)
  if (adapter.runInHydrationScope) {
    const hydrate = adapter.runInHydrationScope.bind(adapter)
    adapter.runInHydrationScope = (task) =>
      hydrate((scope) => task(decorate(scope)))
  }
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: `generated-source-fifo-append-${generatedOwnershipHistoryId}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        rowUpdateMode: `partial`,
        sync: (params) => {
          sourceParams = params
          params.markReady()
          return { loadSubset: () => true }
        },
      },
      persistence: { adapter },
    }),
  )
  const commit = () => {
    const receipt = Promise.resolve(sourceParams.commit()).then(() => undefined)
    void receipt.catch(() => undefined)
    receipts.push(receipt)
    return receipt
  }
  let read: Promise<void> | undefined, recorded: SourceFifoRunResult | undefined
  let hasPrimaryFailure = false
  try {
    await atPersistedOracleCheckpoint(
      collection.stateWhenReady(),
      `appended source ready`,
    )
    read = Promise.resolve(collection._sync.loadSubset({ limit: 1 })).then(
      () => undefined,
    )
    void read.catch(() => undefined)
    await atPersistedOracleCheckpoint(
      readEntered.promise,
      `appended source demand held`,
    )
    sourceParams.begin()
    sourceParams.write({
      type: `update`,
      value: { id: `shared`, title: `${olderTitle}/${newerTitle}` },
    })
    const first = commit(),
      firstState = observeSettlement(first)
    releaseRead.resolve()
    await atPersistedOracleCheckpoint(
      baselineEntered.promise,
      `appended source baseline held`,
    )
    sourceParams.begin()
    sourceParams.write({
      type: `update`,
      value: { id: `second`, title: `${newerTitle}/${olderTitle}` },
    })
    commit()
    const premise = {
      baselinePending: Boolean(baselinePending),
      firstReceipt: firstState.read().status,
    }
    events.push({
      checkpoint: `source appended during baseline read`,
      value: premise,
    })
    releaseBaseline.resolve()
    const readOutcome = (
      await atPersistedOracleCheckpoint(
        Promise.allSettled([read]),
        `appended source demand settled`,
      )
    )[0]
    events.push({
      checkpoint: `source FIFO subset settlement`,
      value:
        readOutcome.status === `rejected`
          ? {
              status: readOutcome.status,
              sameFailure: readOutcome.reason === loadFailure,
            }
          : { status: readOutcome.status },
    })
    const receiptOutcomes: SourceFifoRunResult[`receiptOutcomes`] = []
    for (const receipt of receipts) {
      const outcome = (
        await atPersistedOracleCheckpoint(
          Promise.allSettled([receipt]),
          `appended source receipt`,
        )
      )[0]
      receiptOutcomes.push({
        status: outcome.status,
        name:
          outcome.status === `rejected` && outcome.reason instanceof Error
            ? outcome.reason.name
            : null,
        abortErrorInstance:
          outcome.status === `rejected` &&
          outcome.reason instanceof SyncTransactionAbortedError,
      })
    }
    measuring = false
    const durable = await store.read()
    recorded = {
      relation,
      events,
      reached: premise.baselinePending && premise.firstReceipt === `pending`,
      receiptOutcomes,
      work: {
        unrelatedRowCount,
        snapshotCalls: baselineCalls,
        materializedRows: baselineRows,
      },
      final: {
        publicRows: sortedTodoRows(
          [...collection.values()].map(stripVirtualProps),
        ),
        durableRows: sortedTodoRows(durable.rows),
        publicMetadata: sourceParams.metadata?.row.get(`shared`),
        durableMetadata: durable.metadata,
        status: collection.status,
        pendingMarkers: collection._state.pendingSyncedTransactions.length,
        durableOrder: writes,
      },
      cleanupErrors: [],
    }
    return recorded
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseRead.resolve()
    releaseBaseline.resolve()
    const errors = await cleanupPersistedOracle(
      [
        () => read?.catch(() => undefined),
        ...receipts.map((receipt) => () => receipt.catch(() => undefined)),
        () => collection.cleanup(),
        () => store.close(),
      ],
      hasPrimaryFailure,
    )
    if (recorded) recorded.cleanupErrors.push(...errors)
  }
}

// Source commit order is global, including commits admitted on opposite sides
// of a queued subset read. The durable gate queues that read before the older
// commit; the read gate then admits the newer commit during active hydration.
// The failed-read variant keeps the shared baseline unseen and crosses a
// disjoint predecessor with a partial update that still owes its hidden fields.
async function runSourceFifoOrderingLaw(
  relation: SourceFifoOrderingHistory['relations'][number],
  olderTitle: string,
  newerTitle: string,
  unrelatedRowCount: number,
  open: OpenSourceFifoStore,
): Promise<SourceFifoRunResult> {
  if (relation === `failed-hydration-appended-partial`)
    return runAppendedPartialHistory(
      olderTitle,
      newerTitle,
      unrelatedRowCount,
      open,
    )
  const events: SourceFifoRunResult[`events`] = []
  let recorded: SourceFifoRunResult | undefined
  let reached = false
  const receiptOutcomes: SourceFifoRunResult[`receiptOutcomes`] = []
  let work: SourceFifoRunResult[`work`]
  const historyId = ++generatedOwnershipHistoryId
  const crossing =
    relation.startsWith(`hydration-`) ||
    relation.startsWith(`failed-hydration-`)
  const baselineAbort = relation === `hydration-baseline-read-abort`
  const loadedPartial = relation === `hydration-loaded-partial`
  const ordinaryPartial = relation === `failed-hydration-ordinary-partial`
  const multiKey = relation === `failed-hydration-multi-key-partial`
  const failedRead = relation.startsWith(`failed-hydration-`) || baselineAbort
  const aborted = relation === `hydration-independent-abort` || baselineAbort
  const restores =
    relation === `delete-reinsert` || relation === `hydration-delete-reinsert`
  const baseline: Todo = {
    id: `shared`,
    title: olderTitle,
    detail: `unseen durable field`,
  }
  const id = `generated-source-fifo-order-${historyId}`
  // Failed subset reads publish no demand rows. These untouched cache rows
  // therefore remain durable without entering the public Collection.
  const unrelatedRows =
    failedRead || loadedPartial
      ? Array.from({ length: unrelatedRowCount }, (_, index) => ({
          id: `unrelated-${index}`,
          title: `unrelated durable row ${index}`,
        }))
      : []
  const store = await open(
    id,
    [
      ...(restores || failedRead || aborted || loadedPartial ? [baseline] : []),
      ...(multiKey
        ? [
            {
              id: `second`,
              title: olderTitle,
              detail: `second unseen durable field`,
            },
          ]
        : []),
      ...unrelatedRows,
    ],
    failedRead || loadedPartial ? { cached: true } : undefined,
  )
  const { adapter } = store
  const writes: Array<Array<string | number>> = []
  const firstPersistenceEntered = createEventGate()
  const releaseFirstPersistence = createEventGate()
  const readEntered = createEventGate()
  const releaseRead = createEventGate()
  const loadFailure = new Error(`request-local FIFO read failure`)
  let holdRead = false
  let readOpen = false
  const readIsOpen = () => readOpen
  let measureBaseline = false
  let baselineSnapshotCalls = 0
  let baselineRowsRead = 0
  const abortController = new AbortController()
  const measuredResume = async (
    load: PersistenceAdapter['loadResumeSnapshot'],
    args: Parameters<PersistenceAdapter['loadResumeSnapshot']>,
  ) => {
    const snapshot = await load(...args)
    if (measureBaseline && args[1]?.includeRows !== false) {
      baselineSnapshotCalls++
      baselineRowsRead += snapshot.rows.length
      if (baselineAbort) {
        // Abort after the actual storage snapshot returned, while the source
        // transaction has not reached core acceptance. Holding the earlier
        // subset's Promise alone would miss this second await boundary.
        abortController.abort()
        reached = true
      }
    }
    return snapshot
  }
  const heldLoad = async (
    load: PersistenceAdapter['loadSubset'],
    args: Parameters<PersistenceAdapter['loadSubset']>,
  ) => {
    const rows = await load(...args)
    if (holdRead) {
      holdRead = false
      readOpen = true
      readEntered.resolve()
      await releaseRead.promise
      readOpen = false
      if (failedRead) throw loadFailure
    }
    return rows
  }
  let holdWrite = false
  const heldApply = async (
    apply: PersistenceAdapter['applyCommittedTx'],
    args: Parameters<PersistenceAdapter['applyCommittedTx']>,
  ) => {
    if (holdWrite) {
      holdWrite = false
      firstPersistenceEntered.resolve()
      await releaseFirstPersistence.promise
    }
    if (args[1].mutations.length)
      writes.push([...new Set(args[1].mutations.map(({ key }) => key))])
    await apply(...args)
  }
  // SQLite gives each scheduler loan a scoped adapter. The same read/write
  // gates decorate that loan, so the receiver holds the real operation rather
  // than replacing SQLite's scheduler or asserting after an unrelated read.
  const scoped = (
    scope: HydrationPersistenceAdapter,
  ): HydrationPersistenceAdapter => ({
    ...scope,
    loadSubset: (...args) => heldLoad(scope.loadSubset.bind(scope), args),
    loadResumeSnapshot: (...args) =>
      measuredResume(scope.loadResumeSnapshot.bind(scope), args),
    applyCommittedTx: (...args) =>
      heldApply(scope.applyCommittedTx.bind(scope), args),
  })
  const loadSubset = adapter.loadSubset.bind(adapter)
  const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
  const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
  adapter.loadSubset = (...args) => heldLoad(loadSubset, args)
  adapter.loadResumeSnapshot = (...args) =>
    measuredResume(loadResumeSnapshot, args)
  adapter.applyCommittedTx = (...args) => heldApply(applyCommittedTx, args)
  if (adapter.runInHydrationScope) {
    const hydrate = adapter.runInHydrationScope.bind(adapter)
    adapter.runInHydrationScope = (task) =>
      hydrate((scope) => task(scoped(scope)))
  }
  if (adapter.runInRegularScope) {
    const regular = adapter.runInRegularScope
    adapter.runInRegularScope = Object.assign(
      <T>(task: (scope: HydrationPersistenceAdapter) => Promise<T>) =>
        regular.call(adapter, (scope) => task(scoped(scope))) as Promise<T>,
      { afterQueuedWork: () => regular.afterQueuedWork() },
    )
  }
  let sourceParams!: TodoSyncParams
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id,
      getKey: (row) => row.id,
      syncMode: crossing ? `on-demand` : `eager`,
      sync: {
        rowUpdateMode: `partial`,
        sync: (params) => {
          sourceParams = params
          params.markReady()
          return { loadSubset: () => true }
        },
      },
      persistence: { adapter },
    }),
  )
  const receipts: Array<Promise<void>> = []
  let read: Promise<void> | undefined
  let hasPrimaryFailure = false
  const commit = (signal?: AbortSignal) => {
    const receipt = Promise.resolve(sourceParams.commit(signal)).then(
      () => undefined,
    )
    void receipt.catch(() => undefined)
    receipts.push(receipt)
    return receipt
  }
  try {
    await atPersistedOracleCheckpoint(
      collection.stateWhenReady(),
      `source FIFO ready`,
    )
    if (crossing && !failedRead)
      await atPersistedOracleCheckpoint(
        Promise.resolve(
          collection._sync.loadSubset(loadedPartial ? {} : { limit: 1 }),
        ),
        `source FIFO baseline`,
      )
    if (ordinaryPartial) {
      // No demand has read this key. Core can accept a sparse source row while
      // SQLite retains the complete older row beneath its partial update.
      sourceParams.begin()
      sourceParams.write({
        type: `update`,
        value: { id: `shared`, title: `${olderTitle}/prelude` },
      })
      await atPersistedOracleCheckpoint(commit(), `ordinary partial prelude`)
    }
    holdWrite = true
    sourceParams.begin()
    sourceParams.write({
      type: `insert`,
      value: { id: `gate`, title: `holds adapter` },
    })
    commit()
    await atPersistedOracleCheckpoint(
      firstPersistenceEntered.promise,
      `source FIFO adapter hold`,
    )

    if (crossing) {
      holdRead = true
      read = Promise.resolve(collection._sync.loadSubset({ limit: 2 })).then(
        () => undefined,
      )
      void read.catch(() => undefined)
      // Let claim admission reserve the subset turn while the first write is
      // held. The read gate below checks that the older commit is still pending.
      await flushAsyncWork()
    }
    const disjoint =
      relation === `disjoint` || failedRead || aborted || loadedPartial
    const olderKey = disjoint ? `older` : `shared`
    const newerKey = relation === `disjoint` ? `newer` : `shared`
    sourceParams.begin()
    sourceParams.write(
      restores
        ? { type: `delete`, key: olderKey }
        : { type: `insert`, value: { id: olderKey, title: olderTitle } },
    )
    const olderReceipt = commit()
    const olderState = observeSettlement(olderReceipt)
    if (crossing) {
      releaseFirstPersistence.resolve()
      await atPersistedOracleCheckpoint(
        readEntered.promise,
        `source FIFO read hold`,
      )
      events.push({
        checkpoint: `queued predecessor at subset read`,
        value: {
          status: olderState.read().status,
          writes: structuredClone(writes),
        },
      })
    }
    sourceParams.begin()
    sourceParams.write({
      type: relation === `disjoint` ? `insert` : `update`,
      value: restores
        ? baseline
        : {
            id: newerKey,
            title:
              failedRead || loadedPartial
                ? `${olderTitle}/${newerTitle}`
                : newerTitle,
          },
    })
    if (multiKey)
      sourceParams.write({
        type: `update`,
        value: { id: `second`, title: `${olderTitle}/${newerTitle}` },
      })
    commit(aborted ? abortController.signal : undefined)
    if (aborted && !baselineAbort) abortController.abort()
    if (crossing) {
      events.push({
        checkpoint: `newer source commit during held read`,
        value: {
          readOpen: readIsOpen(),
          olderStatus: olderState.read().status,
        },
      })
      if (!baselineAbort)
        reached = readIsOpen() && olderState.read().status === `pending`
    } else {
      events.push({
        checkpoint: `source FIFO held public baseline`,
        value: sortedTodoRows([...collection.values()].map(stripVirtualProps)),
      })
      reached = true
    }
    measureBaseline = true
    releaseRead.resolve()
    releaseFirstPersistence.resolve()
    if (read) {
      const result = (
        await atPersistedOracleCheckpoint(
          Promise.allSettled([read]),
          `source FIFO subset settlement`,
        )
      )[0]
      events.push({
        checkpoint: `source FIFO subset settlement`,
        value:
          result.status === `rejected`
            ? {
                status: result.status,
                sameFailure: result.reason === loadFailure,
              }
            : { status: result.status },
      })
    }
    for (const [index, receipt] of receipts.entries()) {
      const result = (
        await atPersistedOracleCheckpoint(
          Promise.allSettled([receipt]),
          `source FIFO receipt ${index}`,
        )
      )[0]
      receiptOutcomes.push({
        status: result.status,
        abortErrorInstance:
          result.status === `rejected` &&
          result.reason instanceof SyncTransactionAbortedError,
        name:
          result.status === `rejected` && result.reason instanceof Error
            ? result.reason.name
            : null,
      })
    }
    measureBaseline = false
    if (failedRead || loadedPartial) {
      work = {
        unrelatedRowCount,
        snapshotCalls: baselineSnapshotCalls,
        materializedRows: baselineRowsRead,
      }
    }
    if (baselineAbort) {
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `after-abort`, title: newerTitle },
      })
      const result = (
        await atPersistedOracleCheckpoint(
          Promise.allSettled([commit()]),
          `source FIFO post-abort use`,
        )
      )[0]
      receiptOutcomes.push({
        status: result.status,
        abortErrorInstance:
          result.status === `rejected` &&
          result.reason instanceof SyncTransactionAbortedError,
        name:
          result.status === `rejected` && result.reason instanceof Error
            ? result.reason.name
            : null,
      })
    }
    const durable = await store.read()
    recorded = {
      relation,
      events,
      reached,
      receiptOutcomes,
      work,
      final: {
        publicRows: sortedTodoRows(
          [...collection.values()].map(stripVirtualProps),
        ),
        durableRows: sortedTodoRows(durable.rows),
        status: collection.status,
        pendingMarkers: collection._state.pendingSyncedTransactions.length,
        ...(disjoint
          ? {
              durableOrder: writes,
            }
          : {}),
        ...(failedRead || loadedPartial
          ? {
              publicMetadata: sourceParams.metadata?.row.get(`shared`),
              durableMetadata: durable.metadata,
            }
          : {}),
      },
      cleanupErrors: [],
    }
    return recorded
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseRead.resolve()
    releaseFirstPersistence.resolve()
    const cleanupErrors = await cleanupPersistedOracle(
      [
        () => read?.catch(() => undefined),
        ...receipts.map((receipt) => () => receipt.catch(() => undefined)),
        () => collection.cleanup(),
        () => store.close(),
      ],
      hasPrimaryFailure,
    )
    // Keep the recorded cut beside teardown diagnostics. A later comparison
    // must still see a row/receipt mismatch when cleanup also fails.
    if (recorded) recorded.cleanupErrors.push(...cleanupErrors)
  }
}

export async function runSourceFifoHistory(
  history: SourceFifoOrderingHistory,
  open: OpenSourceFifoStore,
): Promise<Array<SourceFifoRunResult>> {
  const results: Array<SourceFifoRunResult> = []
  for (const relation of history.relations) {
    try {
      results.push(
        await runSourceFifoOrderingLaw(
          relation,
          history.titles[0],
          history.titles[1],
          history.unrelatedRowCount,
          open,
        ),
      )
    } catch (error) {
      const completed = results.at(-1)
      if (!completed) throw error
      // A later setup/transport failure cannot erase an earlier completed
      // observation. The shared checker judges this prefix before reporting
      // the secondary execution failure.
      completed.executionErrors = [
        { relation, message: describeOracleCleanupError(error) },
      ]
      return results
    }
  }
  return results
}
