import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createOptimisticAction } from '../../src/optimistic-action.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe.js'
import { createTransaction } from '../../src/transactions.js'
import { expectAssertionFailure } from '../expected-failure.js'
import { evaluateReferenceExpression } from '../reference-expression.js'
import {
  oracleRandomParameters,
  readOracleRunConfig,
} from '../oracle-config.js'
import { TraceAssertionError } from '../trace-runner.js'
import type {
  LoadSubsetOptions,
  LoadSubsetRequestResult,
  LoadSubsetResult,
  SyncAppliedReceipt,
} from '../../src/types.js'

type PersistedLoadRow = {
  id: string
  projectId: string
}

type OptimisticDerivedRow = {
  id: string
  value: string
}

type ExactDemand = {
  values: ReadonlyArray<number>
  orderField: `rank` | `score`
  direction: `asc` | `desc`
  nulls: `first` | `last`
  stringSort: `lexical` | `locale`
  offset: number
  limit: number | undefined
  cursorBoundary: number | undefined
}

type ConcurrentExactScenario = {
  trace: ReadonlyArray<ExactDemand>
  settlementOrder: `forward` | `reverse`
}

const rankRef = new PropRef<number>([`rank`])
const scoreRef = new PropRef<number>([`score`])

function requirePendingAppliedReceipt(
  receipt: LoadSubsetRequestResult,
): Promise<void | LoadSubsetResult> {
  if (receipt === true) {
    throw new Error(`Expected an asynchronous subset load`)
  }
  return receipt
}

const exactDemandArbitrary: fc.Arbitrary<ExactDemand> = fc
  .record({
    values: fc.uniqueArray(fc.integer({ min: -3, max: 3 }), {
      minLength: 1,
      maxLength: 5,
    }),
    orderField: fc.constantFrom(`rank` as const, `score` as const),
    direction: fc.constantFrom(`asc` as const, `desc` as const),
    nulls: fc.constantFrom(`first` as const, `last` as const),
    stringSort: fc.constantFrom(`lexical` as const, `locale` as const),
    offset: fc.integer({ min: 0, max: 4 }),
    limit: fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined }),
    cursorBoundary: fc.option(fc.integer({ min: -3, max: 3 }), {
      nil: undefined,
    }),
  })
  .map((demand) => ({
    ...demand,
    values: [...demand.values].sort((left, right) => left - right),
  }))

function exactDemandFingerprint(demand: ExactDemand): string {
  return JSON.stringify(demand)
}

const exactDemandTraceArbitrary = fc
  .uniqueArray(exactDemandArbitrary, {
    minLength: 1,
    maxLength: 6,
    selector: exactDemandFingerprint,
  })
  .chain((pool) =>
    fc
      .array(fc.integer({ min: 0, max: pool.length - 1 }), {
        minLength: 1,
        maxLength: 20,
      })
      .map((indices) => indices.map((index) => pool[index]!)),
  )

const concurrentExactScenarioArbitrary: fc.Arbitrary<ConcurrentExactScenario> =
  exactDemandTraceArbitrary.map((trace) => ({
    trace,
    settlementOrder: trace.length % 2 === 0 ? `forward` : `reverse`,
  }))

function toLoadSubsetOptions(demand: ExactDemand): LoadSubsetOptions {
  const orderRef = demand.orderField === `rank` ? rankRef : scoreRef
  return {
    where: new Func(`in`, [scoreRef, new Value([...demand.values])]),
    orderBy: [
      {
        expression: orderRef,
        compareOptions: {
          direction: demand.direction,
          nulls: demand.nulls,
          stringSort: demand.stringSort,
        },
      },
    ],
    offset: demand.offset,
    limit: demand.limit,
    cursor:
      demand.cursorBoundary === undefined
        ? undefined
        : {
            whereFrom: new Func(demand.direction === `asc` ? `gt` : `lt`, [
              orderRef,
              new Value(demand.cursorBoundary),
            ]),
            whereCurrent: new Func(`eq`, [
              orderRef,
              new Value(demand.cursorBoundary),
            ]),
            lastKey: demand.cursorBoundary,
          },
  }
}

function assertCompletedExactDemandTrace(
  trace: ReadonlyArray<ExactDemand>,
): void {
  let starts = 0
  const completed = new Set<string>()
  let expectedStart: LoadSubsetOptions | undefined
  const dedupe = new DeduplicatedLoadSubset({
    loadSubset: (options) => {
      expect(options).toEqual(expectedStart)
      starts++
      return true
    },
  })

  for (const demand of trace) {
    const startsBefore = starts
    expectedStart = toLoadSubsetOptions(demand)
    const result = dedupe.loadSubset(expectedStart)
    const fingerprint = exactDemandFingerprint(demand)
    expect(result).toBe(true)
    expect(starts - startsBefore).toBe(completed.has(fingerprint) ? 0 : 1)
    completed.add(fingerprint)
  }
}

async function assertConcurrentExactDemandTrace({
  trace,
  settlementOrder,
}: ConcurrentExactScenario): Promise<void> {
  const transports: Array<{
    deferred: ReturnType<typeof createDeferred<void>>
    promise: Promise<void>
  }> = []
  const promisesByDemand = new Map<string, Promise<void | LoadSubsetResult>>()
  const dedupe = new DeduplicatedLoadSubset({
    loadSubset: () => {
      const deferred = createDeferred<void>()
      const transport = { deferred, promise: deferred.promise }
      transports.push(transport)
      return transport.promise
    },
  })

  const callers = trace.map((demand) => {
    const fingerprint = exactDemandFingerprint(demand)
    const startsBefore = transports.length
    const result = dedupe.loadSubset(toLoadSubsetOptions(demand))
    if (!(result instanceof Promise)) {
      throw new Error(`A new in-flight demand must return a promise`)
    }
    const existing = promisesByDemand.get(fingerprint)
    if (existing) {
      expect(transports).toHaveLength(startsBefore)
      expect(result).toBe(existing)
    } else {
      expect(transports).toHaveLength(startsBefore + 1)
      promisesByDemand.set(fingerprint, result)
    }
    return result
  })

  const observed = Promise.allSettled(callers)
  const settlement =
    settlementOrder === `forward` ? transports : [...transports].reverse()
  for (const transport of settlement) transport.deferred.resolve()
  expect((await observed).every(({ status }) => status === `fulfilled`)).toBe(
    true,
  )

  const startsAfterSettlement = transports.length
  for (const demand of trace) {
    expect(dedupe.loadSubset(toLoadSubsetOptions(demand))).toBe(true)
  }
  expect(transports).toHaveLength(startsAfterSettlement)

  dedupe.reset()
  const restarted = dedupe.loadSubset(toLoadSubsetOptions(trace[0]!))
  expect(restarted).toBeInstanceOf(Promise)
  expect(transports).toHaveLength(startsAfterSettlement + 1)
  transports.at(-1)!.deferred.resolve()
  await restarted
}

async function expectExactWaitersShareRejection(): Promise<void> {
  const deferred = createDeferred<void>()
  void deferred.promise.catch(() => undefined)
  const dedupe = new DeduplicatedLoadSubset({
    loadSubset: () => deferred.promise,
  })
  const demand: ExactDemand = {
    values: [1, 2],
    orderField: `rank`,
    direction: `asc`,
    nulls: `last`,
    stringSort: `lexical`,
    offset: 0,
    limit: 2,
    cursorBoundary: undefined,
  }

  const first = dedupe.loadSubset(toLoadSubsetOptions(demand))
  const second = dedupe.loadSubset(toLoadSubsetOptions(demand))
  expect(first).toBeInstanceOf(Promise)
  expect(second).toBe(first)

  const outcomes = Promise.allSettled([first, second])
  deferred.reject(new Error(`transport failed`))
  expect((await outcomes).map(({ status }) => status)).toEqual([
    `rejected`,
    `rejected`,
  ])

  const retry = dedupe.loadSubset(toLoadSubsetOptions(demand))
  expect(retry).toBeInstanceOf(Promise)
  await expect(retry).rejects.toThrow(`transport failed`)
}

const { multiplier, ...replay } = readOracleRunConfig()
const exactScenarioRuns = 40 * multiplier

let collectionSequence = 0

async function expectPersistingLoadIsApplied(
  persisting: boolean,
  delivery: `synchronous` | `asynchronous` = `synchronous`,
  transactionStart: `during-load` | `before-load` = `during-load`,
) {
  const rows: Array<PersistedLoadRow> = [
    { id: `r1`, projectId: `p1` },
    { id: `r2`, projectId: `p1` },
  ]
  let loadCalls = 0
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-oracle-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        if (transactionStart === `before-load`) begin()
        markReady()
        return {
          loadSubset: () => {
            loadCalls += 1
            const applyRows = () => {
              if (transactionStart === `during-load`) begin()
              for (const row of rows) {
                write({ type: `insert`, value: { ...row } })
              }
              return commit()
            }
            if (delivery === `synchronous`) {
              return applyRows()
            }
            return Promise.resolve().then(async () => {
              const applied = applyRows()
              if (applied !== true) await applied
            })
          },
        }
      },
    },
  })
  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  if (persisting) {
    transaction.mutate(() => source.insert({ id: `other`, projectId: `p2` }))
    expect(transaction.state).toBe(`persisting`)
  }
  const live = createLiveQueryCollection((query) =>
    query.from({ row: source }).where(({ row }) => eq(row.projectId, `p1`)),
  )

  try {
    const ready = live.toArrayWhenReady()
    if (persisting) {
      let settled = false
      void ready.then(() => {
        settled = true
      })
      await Promise.resolve()
      await Promise.resolve()

      expect(settled).toBe(false)
      expect(source.get(`r1`)).toBeUndefined()
      expect(source.get(`r2`)).toBeUndefined()

      persistence.resolve()
      await transaction.isPersisted.promise
    }

    const result = await ready
    expect(loadCalls).toBe(1)
    try {
      expect(result.map(({ id }) => id).sort()).toEqual([`r1`, `r2`])
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  } finally {
    if (persisting) {
      persistence.resolve()
      await transaction.isPersisted.promise
    }
    await live.cleanup()
    await source.cleanup()
  }
}

async function expectAppliedReceiptTiming(
  gate: `free` | `parked`,
  delivery: `synchronous` | `asynchronous`,
): Promise<void> {
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-timing-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: () => {
            const applyRow = () => {
              begin()
              write({
                type: `insert`,
                value: { id: `remote`, projectId: `p1` },
              })
              return commit()
            }

            return delivery === `synchronous`
              ? applyRow()
              : Promise.resolve().then(async () => {
                  const applied = applyRow()
                  if (applied !== true) await applied
                })
          },
        }
      },
    },
  })
  source.startSyncImmediate()

  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  if (gate === `parked`) {
    transaction.mutate(() => source.insert({ id: `local`, projectId: `p2` }))
    expect(transaction.state).toBe(`persisting`)
  }

  const receipt = source._sync.loadSubset({})

  try {
    if (gate === `free` && delivery === `synchronous`) {
      expect(receipt).toBe(true)
      expect(source.get(`remote`)).toEqual(
        expect.objectContaining({ id: `remote`, projectId: `p1` }),
      )
      return
    }

    const pending = requirePendingAppliedReceipt(receipt)
    let settled = false
    let visibleWhenSettled = false
    void pending.then(() => {
      settled = true
      visibleWhenSettled = source.get(`remote`)?.id === `remote`
    })

    expect(settled).toBe(false)
    expect(source.get(`remote`)).toBeUndefined()
    await Promise.resolve()
    await Promise.resolve()

    if (gate === `parked`) {
      expect(settled).toBe(false)
      expect(source.get(`remote`)).toBeUndefined()
      persistence.resolve()
      await transaction.isPersisted.promise
    }

    await pending
    expect(settled).toBe(true)
    expect(visibleWhenSettled).toBe(true)
    expect(source.get(`remote`)).toEqual(
      expect.objectContaining({ id: `remote`, projectId: `p1` }),
    )
  } finally {
    persistence.resolve()
    if (gate === `parked`) {
      await transaction.isPersisted.promise.catch(() => undefined)
    }
    await source.cleanup()
  }
}

async function expectAppliedLoadDoesNotFlushEarlierParkedSync() {
  const rows: Array<PersistedLoadRow> = [
    { id: `r1`, projectId: `p1` },
    { id: `r2`, projectId: `p1` },
  ]
  let publishUnrelated!: () => void
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-order-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        publishUnrelated = () => {
          begin()
          write({
            type: `insert`,
            value: { id: `unrelated`, projectId: `p2` },
          })
          commit()
        }
        markReady()
        return {
          loadSubset: () => {
            begin()
            for (const row of rows) {
              write({ type: `insert`, value: { ...row } })
            }
            return commit()
          },
        }
      },
    },
  })
  source.startSyncImmediate()

  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => source.insert({ id: `other`, projectId: `p2` }))
  expect(transaction.state).toBe(`persisting`)
  publishUnrelated()

  const live = createLiveQueryCollection((query) =>
    query.from({ row: source }).where(({ row }) => eq(row.projectId, `p1`)),
  )

  try {
    const ready = live.toArrayWhenReady()
    let settled = false
    void ready.then(() => {
      settled = true
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(source.get(`unrelated`)).toBeUndefined()

    persistence.resolve()
    await transaction.isPersisted.promise
    await expect(ready).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: `r1` }),
        expect.objectContaining({ id: `r2` }),
      ]),
    )
  } finally {
    persistence.resolve()
    await transaction.isPersisted.promise.catch(() => undefined)
    await live.cleanup()
    await source.cleanup()
  }
}

async function expectCompletionWaitsForAppliedRows() {
  let publishUnrelated!: () => void
  let transportCalls = 0
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-coverage-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        publishUnrelated = () => {
          begin()
          write({
            type: `insert`,
            value: { id: `unrelated`, projectId: `p2` },
          })
          commit()
        }
        const deduplicated = new DeduplicatedLoadSubset({
          loadSubset: () => {
            transportCalls += 1
            begin()
            write({
              type: `insert`,
              value: { id: `r1`, projectId: `p1` },
            })
            return commit()
          },
        })
        markReady()
        return { loadSubset: deduplicated.loadSubset }
      },
    },
  })
  source.startSyncImmediate()

  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => source.insert({ id: `other`, projectId: `p2` }))
  publishUnrelated()

  try {
    const first = source._sync.loadSubset({})
    expect(first).toBeInstanceOf(Promise)
    await Promise.resolve()
    await Promise.resolve()

    const concurrent = source._sync.loadSubset({})
    expect(concurrent).toBe(first)
    expect(transportCalls).toBe(1)
    expect(source.get(`r1`)).toBeUndefined()

    persistence.resolve()
    await transaction.isPersisted.promise
    await Promise.all([first, concurrent])
    expect(source.get(`r1`)).toEqual(
      expect.objectContaining({ id: `r1`, projectId: `p1` }),
    )
    expect(source._sync.loadSubset({})).toBe(true)
  } finally {
    persistence.resolve()
    await transaction.isPersisted.promise.catch(() => undefined)
    await source.cleanup()
  }
}

async function expectConcurrentStreamCommitStaysParked() {
  let publishUnrelated!: () => void
  let publishSubset!: () => void
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-concurrent-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        publishUnrelated = () => {
          begin()
          write({
            type: `insert`,
            value: { id: `unrelated`, projectId: `p2` },
          })
          commit()
        }
        markReady()
        return {
          loadSubset: () =>
            new Promise<void>((resolve) => {
              publishSubset = () => {
                begin()
                write({
                  type: `insert`,
                  value: { id: `r1`, projectId: `p1` },
                })
                const applied = commit()
                if (applied === true) {
                  resolve()
                } else {
                  void applied.then(resolve)
                }
              }
            }),
        }
      },
    },
  })
  source.startSyncImmediate()

  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => source.insert({ id: `other`, projectId: `p2` }))

  const load = requirePendingAppliedReceipt(source._sync.loadSubset({}))
  publishUnrelated()
  publishSubset()

  try {
    let settled = false
    void load.then(() => {
      settled = true
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(source.get(`unrelated`)).toBeUndefined()
    expect(source.get(`r1`)).toBeUndefined()
    persistence.resolve()
    await transaction.isPersisted.promise
    await load
    expect(source.get(`unrelated`)).toEqual(
      expect.objectContaining({ id: `unrelated`, projectId: `p2` }),
    )
    expect(source.get(`r1`)).toEqual(
      expect.objectContaining({ id: `r1`, projectId: `p1` }),
    )
  } finally {
    persistence.resolve()
    await transaction.isPersisted.promise.catch(() => undefined)
    await source.cleanup()
  }
}

async function expectLaterImmediateCommitSettlesAppliedSubset() {
  let publishLater!: () => SyncAppliedReceipt
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-priority-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({
          type: `insert`,
          value: { id: `initial`, projectId: `p0` },
        })
        void commit()
        publishLater = () => {
          begin({ immediate: true })
          write({
            type: `insert`,
            value: { id: `later`, projectId: `p2` },
          })
          return commit()
        }
        markReady()
        return {
          loadSubset: () => {
            begin()
            write({
              type: `insert`,
              value: { id: `subset`, projectId: `p1` },
            })
            return commit()
          },
        }
      },
    },
  })
  source.startSyncImmediate()

  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => source.insert({ id: `local`, projectId: `p3` }))

  const load = requirePendingAppliedReceipt(source._sync.loadSubset({}))
  const later = publishLater()

  try {
    let loadSettled = false
    let subsetVisibleWhenSettled = false
    void load.then(() => {
      loadSettled = true
      subsetVisibleWhenSettled = source.get(`subset`)?.id === `subset`
    })
    await later
    await load

    expect(loadSettled).toBe(true)
    expect(subsetVisibleWhenSettled).toBe(true)
    expect(source.get(`subset`)).toEqual(
      expect.objectContaining({ id: `subset` }),
    )
    expect(source.get(`later`)).toEqual(
      expect.objectContaining({ id: `later` }),
    )
    expect(source.get(`initial`)).toEqual(
      expect.objectContaining({ id: `initial` }),
    )

    persistence.resolve()
    await transaction.isPersisted.promise
    await Promise.all([load, later])

    expect(source.get(`subset`)).toEqual(
      expect.objectContaining({ id: `subset` }),
    )
  } finally {
    persistence.resolve()
    await transaction.isPersisted.promise.catch(() => undefined)
    await source.cleanup()
  }
}

async function expectAbortedReceiptDoesNotSettleDemand(
  abortPhase: `before-commit` | `while-parked`,
) {
  let transportCalls = 0
  const committed = createDeferred<void>()
  const deduplicated = new DeduplicatedLoadSubset({
    loadSubset: async ({ signal }) => {
      transportCalls += 1
      if (abortPhase === `before-commit`) {
        // Give cancellation a chance to revoke this request before its
        // request-scoped rows enter the collection transaction.
        await Promise.resolve()
        if (signal?.aborted) {
          return
        }
      }
      begin()
      write({
        type: `insert`,
        value: { id: `row`, projectId: `p1` },
      })
      const applied = commit(signal)
      committed.resolve()
      if (applied !== true) await applied
    },
  })
  let begin!: () => void
  let write!: (message: { type: `insert`; value: PersistedLoadRow }) => void
  let commit!: (signal?: AbortSignal) => SyncAppliedReceipt
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-abort-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return { loadSubset: deduplicated.loadSubset }
      },
    },
  })
  source.startSyncImmediate()

  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => source.insert({ id: `local`, projectId: `p2` }))
  const controller = new AbortController()
  const first = requirePendingAppliedReceipt(
    source._sync.loadSubset({ signal: controller.signal }),
  )
  if (abortPhase === `while-parked`) {
    await committed.promise
  }
  controller.abort()

  try {
    persistence.resolve()
    await transaction.isPersisted.promise
    if (abortPhase === `while-parked`) {
      await expect(first).rejects.toMatchObject({ name: `AbortError` })
    } else {
      await first
    }
    expect(transportCalls).toBe(1)
    expect(source.get(`row`)).toBeUndefined()

    const retry = source._sync.loadSubset({})
    if (retry !== true) await retry
    expect(transportCalls).toBe(2)
    expect(source.get(`row`)).toEqual(expect.objectContaining({ id: `row` }))
  } finally {
    persistence.resolve()
    await transaction.isPersisted.promise.catch(() => undefined)
    await source.cleanup()
  }
}

async function expectAbortDuringPublicationDoesNotCancelReceipt() {
  const controller = new AbortController()
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-publication-abort-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: ({ signal }) => {
            begin()
            write({
              type: `insert`,
              value: { id: `row`, projectId: `p1` },
            })
            return commit(signal)
          },
        }
      },
    },
  })
  source.startSyncImmediate()

  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => source.insert({ id: `local`, projectId: `pending` }))
  const subscription = source.subscribeChanges((changes) => {
    if (changes.some((change) => change.key === `row`)) {
      controller.abort()
    }
  })
  const load = requirePendingAppliedReceipt(
    source._sync.loadSubset({ signal: controller.signal }),
  )

  try {
    persistence.resolve()
    await transaction.isPersisted.promise
    await expect(load).resolves.toBeUndefined()
    expect(controller.signal.aborted).toBe(true)
    expect(source.get(`row`)).toEqual(expect.objectContaining({ id: `row` }))
  } finally {
    subscription.unsubscribe()
    persistence.resolve()
    await transaction.isPersisted.promise.catch(() => undefined)
    await source.cleanup()
  }
}

async function expectCanceledReceiptReleasesOnlyItsSuppression() {
  let begin!: () => void
  let write!: (message: { type: `update`; value: PersistedLoadRow }) => void
  let commit!: (signal?: AbortSignal) => SyncAppliedReceipt
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-cancel-suppression-${collectionSequence++}`,
    getKey: (row) => row.id,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        begin()
        write({ type: `update`, value: { id: `first`, projectId: `old` } })
        write({ type: `update`, value: { id: `second`, projectId: `old` } })
        commit()
        params.markReady()
      },
    },
  })
  await source.preload()
  await Promise.resolve()
  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => source.insert({ id: `local`, projectId: `pending` }))
  expect(transaction.state).toBe(`persisting`)
  try {
    begin()
    write({ type: `update`, value: { id: `first`, projectId: `new` } })
    const canceled = commit()
    const canceledTransaction = source._state.pendingSyncedTransactions.at(-1)!
    expect(source._state.pendingSyncedTransactions).toHaveLength(1)
    begin()
    write({ type: `update`, value: { id: `second`, projectId: `new` } })
    expect(source._state.pendingSyncedTransactions).toHaveLength(2)

    source._state.capturePreSyncVisibleState()
    expect(source._state.recentlySyncedKeys).toEqual(
      new Set([`first`, `second`]),
    )

    source._state.cancelPendingSyncedTransaction(canceledTransaction)
    expect(source._state.pendingSyncedTransactions).toHaveLength(1)
    expect(source._state.recentlySyncedKeys).toEqual(new Set([`second`]))
    expect(source._state.preSyncVisibleState.has(`first`)).toBe(false)
    expect(source._state.preSyncVisibleState.has(`second`)).toBe(true)
    if (canceled !== true) {
      await expect(canceled).rejects.toMatchObject({ name: `AbortError` })
    }
  } finally {
    persistence.resolve()
    await transaction.isPersisted.promise.catch(() => undefined)
    await source.cleanup()
  }
}

async function expectCleanupRejectsDemandOnce() {
  let receipt!: Promise<void>
  let transportCalls = 0
  const deduplicated = new DeduplicatedLoadSubset({
    loadSubset: () => {
      transportCalls += 1
      begin()
      write({
        type: `insert`,
        value: { id: `row`, projectId: `p1` },
      })
      const applied = commit()
      if (transportCalls === 1) {
        if (applied === true) {
          throw new Error(`Expected the subset transaction to remain parked`)
        }
        receipt = applied
      }
      return applied
    },
  })
  let begin!: () => void
  let write!: (message: { type: `insert`; value: PersistedLoadRow }) => void
  let commit!: () => SyncAppliedReceipt
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-cleanup-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: deduplicated.loadSubset,
          cleanup: () => deduplicated.reset(),
        }
      },
    },
  })
  source.startSyncImmediate()

  const persistence = createDeferred<void>()
  const transaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  transaction.mutate(() => source.insert({ id: `local`, projectId: `p2` }))
  const load = requirePendingAppliedReceipt(source._sync.loadSubset({}))
  let settlements = 0
  void receipt.then(
    () => {
      settlements += 1
    },
    () => {
      settlements += 1
    },
  )

  await source.cleanup()
  await expect(load).rejects.toMatchObject({ name: `AbortError` })
  await expect(receipt).rejects.toMatchObject({ name: `AbortError` })
  expect(settlements).toBe(1)

  persistence.resolve()
  await transaction.isPersisted.promise.catch(() => undefined)
  await Promise.resolve()
  expect(settlements).toBe(1)

  // Restarting installs fresh sync controls. Reacquisition must both perform
  // transport work and publish its rows; stale callbacks cannot prove either.
  source.startSyncImmediate()
  const retry = source._sync.loadSubset({})
  if (retry !== true) await retry
  expect(transportCalls).toBe(2)
  expect(source.get(`row`)).toEqual(expect.objectContaining({ id: `row` }))

  await source.cleanup()
}

async function expectDerivedSyncDuringOptimisticMutation(): Promise<void> {
  let begin!: () => void
  let write!: (message: { type: `insert`; value: OptimisticDerivedRow }) => void
  let commit!: () => void
  const source = createCollection<OptimisticDerivedRow>({
    id: `optimistic-derived-source-${collectionSequence++}`,
    getKey: (row) => row.id,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
      },
    },
  })
  const derived = createLiveQueryCollection({
    query: (query) =>
      query
        .from({ row: source })
        .select(({ row }) => ({ id: row.id, value: row.value })),
    getKey: (row) => row.id,
    startSync: true,
  })
  const persistence = createDeferred<void>()
  // Query collections currently expose read-side virtual properties in their
  // insert input type even though the runtime accepts the plain selected row.
  const insertDerived = derived.insert.bind(derived) as unknown as (
    row: OptimisticDerivedRow,
  ) => ReturnType<typeof derived.insert>
  const insertOptimistically = createOptimisticAction<OptimisticDerivedRow>({
    onMutate: insertDerived,
    mutationFn: () => persistence.promise,
  })

  await derived.preload()
  const transaction = insertOptimistically({
    id: `optimistic`,
    value: `optimistic`,
  })
  try {
    begin()
    write({ type: `insert`, value: { id: `synced`, value: `synced` } })
    commit()

    try {
      expect([...derived.keys()].sort()).toEqual([`optimistic`, `synced`])
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  } finally {
    persistence.resolve()
    await transaction.isPersisted.promise
    await derived.cleanup()
    await source.cleanup()
  }
}

describe(`exact loadSubset demand oracle`, () => {
  it(`uses SQL unknown for nullish comparisons in the independent model`, () => {
    const missing = new PropRef<number | null>([`missing`])

    expect(
      evaluateReferenceExpression(
        new Func(`lte`, [missing, new Value(null)]),
        {},
      ),
    ).toBeNull()
    expect(
      evaluateReferenceExpression(new Func(`lt`, [missing, new Value(0)]), {}),
    ).toBeNull()
  })

  it(`generates repeated, cursor, empty, and unbounded exact demands`, () => {
    const traces = fc.sample(exactDemandTraceArbitrary, {
      seed: 1656,
      numRuns: 200,
    })
    const demands = traces.flat()

    expect(
      traces.some(
        (trace) =>
          new Set(trace.map(exactDemandFingerprint)).size < trace.length,
      ),
    ).toBe(true)
    expect(
      demands.some(({ cursorBoundary }) => cursorBoundary !== undefined),
    ).toBe(true)
    expect(demands.some(({ limit }) => limit === 0)).toBe(true)
    expect(demands.some(({ limit }) => limit === undefined)).toBe(true)
    expect(new Set(demands.map(({ offset }) => offset)).size).toBeGreaterThan(1)
  })

  fcTest.prop([exactDemandTraceArbitrary], {
    numRuns: exactScenarioRuns,
    seed: 1657,
  })(
    `starts each completed exact demand once for a fixed seed`,
    assertCompletedExactDemandTrace,
  )

  fcTest.prop(
    [exactDemandTraceArbitrary],
    oracleRandomParameters(
      exactScenarioRuns,
      replay,
      `load-subset.exact-completion`,
    ),
  )(
    `starts each completed exact demand once for a random or replayed seed`,
    assertCompletedExactDemandTrace,
  )

  fcTest.prop([concurrentExactScenarioArbitrary], {
    numRuns: exactScenarioRuns,
    seed: 1661,
  })(
    `shares only identical in-flight demands for a fixed seed`,
    assertConcurrentExactDemandTrace,
  )

  fcTest.prop(
    [concurrentExactScenarioArbitrary],
    oracleRandomParameters(
      exactScenarioRuns,
      replay,
      `load-subset.exact-inflight`,
    ),
  )(
    `shares only identical in-flight demands for a random or replayed seed`,
    assertConcurrentExactDemandTrace,
  )

  it(`reports one rejection to every exact waiter and then retries`, async () => {
    await expectExactWaitersShareRejection()
  })
})

describe(`loadSubset application and cancellation`, () => {
  it(`applies loaded rows when no mutation is persisting`, async () => {
    await expectPersistingLoadIsApplied(false)
  })

  it(`applies loaded rows before resolving readiness behind a persisting mutation`, async () => {
    await expectPersistingLoadIsApplied(true)
  })

  it(`applies asynchronously delivered rows before resolving readiness`, async () => {
    await expectPersistingLoadIsApplied(true, `asynchronous`)
  })

  it(`applies a transaction opened before its subset demand`, async () => {
    await expectPersistingLoadIsApplied(true, `synchronous`, `before-load`)
  })

  it.each([
    [`free`, `synchronous`],
    [`free`, `asynchronous`],
    [`parked`, `synchronous`],
    [`parked`, `asynchronous`],
  ] as const)(
    `preserves applied-receipt timing with a %s gate and %s delivery`,
    expectAppliedReceiptTiming,
  )

  it(`does not flush earlier parked sync work to apply a subset load`, async () => {
    await expectAppliedLoadDoesNotFlushEarlierParkedSync()
  })

  it(`settles a demand only after its rows apply`, async () => {
    await expectCompletionWaitsForAppliedRows()
  })

  it(`keeps an unrelated stream commit parked during a subset acquisition`, async () => {
    await expectConcurrentStreamCommitStaysParked()
  })

  it(`settles a subset receipt after a later immediate commit applies it`, async () => {
    await expectLaterImmediateCommitSettlesAppliedSubset()
  })

  it.each([`before-commit`, `while-parked`] as const)(
    `does not settle a demand when its parked receipt is aborted %s`,
    expectAbortedReceiptDoesNotSettleDemand,
  )

  it(`ignores an abort raised after application starts publishing`, async () => {
    await expectAbortDuringPublicationDoesNotCancelReceipt()
  })

  it(`releases only a canceled receipt's event suppression`, async () => {
    await expectCanceledReceiptReleasesOnlyItsSuppression()
  })

  it(`rejects an abandoned demand once`, async () => {
    await expectCleanupRejectsDemandOnce()
  })

  it(`publishes synced source rows while a derived mutation persists`, async () => {
    await expectAssertionFailure(expectDerivedSyncDuringOptimisticMutation, {
      checkpoint: 0,
      classify: ({ actual, expected }) =>
        Array.isArray(actual) &&
        actual.join(`,`) === `optimistic` &&
        Array.isArray(expected) &&
        expected.join(`,`) === `optimistic,synced`,
    })()
  })
})
