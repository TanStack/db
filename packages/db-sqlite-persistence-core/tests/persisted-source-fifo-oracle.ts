/**
 * Source sync transactions keep commit order across persistence reads. Storage
 * supplies an older baseline, including fields an on-demand Collection has not
 * read yet. A failed request-local read cannot discard a committed partial
 * update or its unseen fields. An independent aborted source transaction keeps
 * the Collection usable. README Source replay ordering and the glossary's
 * accepted/deferred sync transaction laws supply these promises.
 *
 * The same driver, source-log model, history grammar and comparison run over
 * the recording adapter and real Node SQLite. Direct's real Chromium/OPFS
 * on-demand receiver separately supplies the provider/storage crossing. These
 * histories compare held publication, receipt outcomes, final public/durable
 * rows, partial-update metadata, and the durable order of changing disjoint
 * writes. They do not judge optimistic holds, dependent aborts, truncation,
 * multi-tab coordination or native mobile hosts.
 */
import { expect } from 'vitest'
import { SyncTransactionAbortedError, createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../src'
import { oracleProperty, violation } from '../../db/tests/oracle-property'
import {
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import {
  atPersistedOracleCheckpoint,
  cleanupPersistedOracle,
  createEventGate,
  createRecordingAdapter,
  flushAsyncWork,
  observeSettlement,
  stripVirtualProps,
} from './persisted-support'
import {
  expectSourceFifoOrderingObservation,
  generatedPersistenceFixedSeeds,
  sourceFifoOrderingAxes,
  sourceFifoOrderingHistory,
} from './persisted-durability-model-oracle'
import type { HydrationPersistenceAdapter, PersistenceAdapter } from '../src'
import type { SourceFifoOrderingHistory } from './persisted-durability-model-oracle'
import type { Todo, TodoSyncParams } from './persisted-support'

export type SourceFifoStore = {
  adapter: PersistenceAdapter
  read: () => Promise<{ rows: Array<Todo>; metadata: unknown }>
  close: () => void | Promise<void>
}
export type OpenSourceFifoStore = (
  id: string,
  initialRows: Array<Todo>,
  metadata: unknown,
) => Promise<SourceFifoStore>
const openRecordingStore: OpenSourceFifoStore = (_id, rows, metadata) => {
  const adapter = createRecordingAdapter(rows)
  if (metadata !== undefined) adapter.rowMetadata.set(`shared`, metadata)
  return Promise.resolve({
    adapter,
    read: () =>
      Promise.resolve({
        rows: [...adapter.rows.values()],
        metadata: adapter.rowMetadata.get(`shared`),
      }),
    close: () => {},
  })
}
let generatedOwnershipHistoryId = 0
function sortedTodoRows(rows: Iterable<Todo>): Array<Todo> {
  return Array.from(rows).sort((left, right) => left.id.localeCompare(right.id))
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
  reach: (state: string) => void,
  open: OpenSourceFifoStore,
): Promise<void> {
  const historyId = ++generatedOwnershipHistoryId
  const crossing =
    relation.startsWith(`hydration-`) || relation === `failed-hydration-partial`
  const failedRead = relation === `failed-hydration-partial`
  const aborted = relation === `hydration-independent-abort`
  const restores =
    relation === `delete-reinsert` || relation === `hydration-delete-reinsert`
  const baseline: Todo = {
    id: `shared`,
    title: olderTitle,
    detail: `unseen durable field`,
  }
  const id = `generated-source-fifo-order-${historyId}`
  const store = await open(
    id,
    restores || failedRead || aborted ? [baseline] : [],
    failedRead ? { cached: true } : undefined,
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
    applyCommittedTx: (...args) =>
      heldApply(scope.applyCommittedTx.bind(scope), args),
  })
  const loadSubset = adapter.loadSubset.bind(adapter)
  const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
  adapter.loadSubset = (...args) => heldLoad(loadSubset, args)
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
  const abortController = new AbortController()
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
        Promise.resolve(collection._sync.loadSubset({ limit: 1 })),
        `source FIFO baseline`,
      )
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
    const disjoint = relation === `disjoint` || failedRead || aborted
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
      oracleAssertion(`queued predecessor at subset read`, () =>
        expect(olderState.read().status).toBe(`pending`),
      )
      oracleAssertion(`older source write has not reached storage`, () =>
        expect(writes).toEqual([[`gate`]]),
      )
    }
    sourceParams.begin()
    sourceParams.write({
      type: relation === `disjoint` ? `insert` : `update`,
      value: restores
        ? baseline
        : {
            id: newerKey,
            title: failedRead ? `${olderTitle}/${newerTitle}` : newerTitle,
          },
    })
    commit(aborted ? abortController.signal : undefined)
    if (aborted) abortController.abort()
    if (crossing) {
      oracleAssertion(`newer source commit during held read`, () => {
        expect(readOpen).toBe(true)
        expect(olderState.read().status).toBe(`pending`)
      })
      reach(relation)
    }
    if (!crossing) {
      oracleAssertion(`source FIFO held public baseline`, () =>
        expect(
          sortedTodoRows([...collection.values()].map(stripVirtualProps)),
        ).toEqual(
          sortedTodoRows([
            { id: `gate`, title: `holds adapter` },
            ...(restores ? [baseline] : []),
          ]),
        ),
      )
      reach(relation)
    }
    releaseRead.resolve()
    releaseFirstPersistence.resolve()
    if (read) {
      const pendingRead = read
      if (failedRead)
        await oracleAssertion(`request-local FIFO rejection`, () =>
          expect(pendingRead).rejects.toBe(loadFailure),
        )
      else
        await atPersistedOracleCheckpoint(
          pendingRead,
          `source FIFO subset settlement`,
        )
    }
    for (const [index, receipt] of receipts.entries()) {
      if (aborted && index === 2)
        await oracleAssertion(`independent FIFO source abort`, () =>
          expect(receipt).rejects.toBeInstanceOf(SyncTransactionAbortedError),
        )
      else
        await atPersistedOracleCheckpoint(
          receipt,
          `source FIFO receipt ${index}`,
        )
    }
    const durable = await store.read()
    expectSourceFifoOrderingObservation(
      {
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
        ...(failedRead
          ? {
              publicMetadata: sourceParams.metadata?.row.get(`shared`),
              durableMetadata: durable.metadata,
            }
          : {}),
      },
      sortedTodoRows(
        expectedSourceFifoOrderingRows(
          relation,
          olderTitle,
          newerTitle,
        ).values(),
      ),
      `${relation} settled`,
      failedRead ? { cached: true } : undefined,
      disjoint
        ? [[`gate`], [olderKey], ...(aborted ? [] : [[newerKey]])]
        : undefined,
    )
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseRead.resolve()
    releaseFirstPersistence.resolve()
    await cleanupPersistedOracle(
      [
        () => read?.catch(() => undefined),
        ...receipts.map((receipt) => () => receipt.catch(() => undefined)),
        () => collection.cleanup(),
        () => store.close(),
      ],
      hasPrimaryFailure,
    )
  }
}

// This map is the source log folded in commit order. Persistence reads add no
// source write. A partial update retains baseline fields, even when its read
// failed; restoring an equal value after deletion still writes the key.
function expectedSourceFifoOrderingRows(
  relation: SourceFifoOrderingHistory['relations'][number],
  olderTitle: string,
  newerTitle: string,
): Map<string, Todo> {
  const restores =
    relation === `delete-reinsert` || relation === `hydration-delete-reinsert`
  const failedRead = relation === `failed-hydration-partial`
  const aborted = relation === `hydration-independent-abort`
  const olderKey =
    relation === `disjoint` || failedRead || aborted ? `older` : `shared`
  const newerKey = relation === `disjoint` ? `newer` : `shared`
  const expected = new Map<string, Todo>([
    [`gate`, { id: `gate`, title: `holds adapter` }],
  ])
  expected.set(olderKey, { id: olderKey, title: olderTitle })
  expected.set(newerKey, {
    id: newerKey,
    title:
      restores || aborted
        ? olderTitle
        : failedRead
          ? `${olderTitle}/${newerTitle}`
          : newerTitle,
    ...(restores || failedRead || aborted
      ? { detail: `unseen durable field` }
      : {}),
  })
  return expected
}

async function runGeneratedSourceFifoOrderingHistory(
  history: SourceFifoOrderingHistory,
  reach: (state: string) => void,
  open: OpenSourceFifoStore,
): Promise<void> {
  for (const relation of history.relations) {
    await runSourceFifoOrderingLaw(
      relation,
      history.titles[0],
      history.titles[1],
      reach,
      open,
    )
  }
}

export function registerSourceFifoOrderingOracle({
  property,
  owns,
  receivingPath,
  open = openRecordingStore,
}: {
  property: string
  owns: ReadonlyArray<string>
  receivingPath: string
  open?: OpenSourceFifoStore
}): void {
  const required = new WeakMap<SourceFifoOrderingHistory, string>()
  const constructed = sourceFifoOrderingAxes.flatMap((state) =>
    Array.from({ length: 5 }, (_, i) => ({
      name: `${state} construction ${i + 1}`,
      enters: [state],
      build: (h: SourceFifoOrderingHistory): SourceFifoOrderingHistory => {
        const built = {
          ...h,
          relations: [
            state,
            ...h.relations.filter((relation) => relation !== state),
          ],
        }
        required.set(built, state)
        return built
      },
    })),
  )
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `Committed source transactions apply in commit order. A storage read cannot let a later commit overtake an earlier commit. Failed request-local reads preserve the durable baseline needed by a partial source update.`,
      authority: `README.md#source-replay-ordering; glossary accepted/deferred sync transaction; Sync metadata session maintainer decisions 2026-10-22 and 2026-10-23.`,
      limits: `${receivingPath} Final public/durable rows and applied receipts; real OPFS Direct receiving has its separate source oracle. No optimistic hold, dependent abort, multi-tab coordinator, or truncate in this grammar.`,
    },
    histories: {
      arbitrary: sourceFifoOrderingHistory,
      runs: 4,
      fixedSeeds: [generatedPersistenceFixedSeeds.sourceFifoOrdering],
      states: sourceFifoOrderingAxes,
      constructed,
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: async (plan, observe) =>
      recordAssertionJudgment(`source FIFO`, plan, observe, async () => {
        const reached = new Set<string>()
        await runGeneratedSourceFifoOrderingHistory(
          plan.history,
          (state) => {
            reached.add(state)
            observe(`reach`, state)
          },
          open,
        )
        const state = required.get(plan.history)
        if (state)
          oracleAssertion(`generated construction reach`, () =>
            expect(reached.has(state)).toBe(true),
          )
      }),
    check: (plan, trace, judgment) => {
      if (judgment.kind !== `pass`) return judgment
      const state = required.get(plan.history)
      if (
        state &&
        !trace.some(
          (entry) => entry.checkpoint === `reach` && entry.value === state,
        )
      )
        return violation(
          `reach`,
          `missing ${state}`,
          `constructed history reach`,
        )
      return judgment
    },
    calibrations: constructed.map((builder) => ({
      name: `${builder.name} cannot omit its reached state`,
      history: { constructed: builder.name },
      law: `constructed history reach`,
      corrupt: (trace) => trace.filter((entry) => entry.checkpoint !== `reach`),
      // Framework reach itself rejects every constructed omission. The primary
      // driver also checks every built base using measured admission.
    })),
  })
}
