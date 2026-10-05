import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import {
  LoadSubsetOperationAbortedError,
  SyncQueueInvariantError,
} from '../../src/errors.js'
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
  SyncAppliedReceipt,
} from '../../src/types.js'

/**
 * # When are two loadSubset demands the same, applied, or canceled?
 *
 * Exact demand identity includes predicate values, order terms and comparison
 * options, offset, limit, and cursor boundary. Equal demands share one physical
 * acquisition; distinct demands do not. Rejection reaches every waiter, then
 * leaves the demand retryable.
 * `refetch` starts fresh work for the same request data. Requests with separate
 * abort signals cannot share in-flight work.
 *
 * A separate application law says acquisition settlement is not enough. Loaded
 * rows must cross the Collection publication boundary before readiness settles.
 * Abort before that boundary rejects and suppresses the rows. Abort after
 * publication is too late and the applied rows remain visible.
 *
 * The identity model uses canonical plain records and an independent SQL
 * expression evaluator. The application driver uses real transactions, sync
 * receipts, optimistic work, and live queries. Keeping these nodes separate
 * prevents a correct key function from hiding a broken settlement boundary.
 *
 * Authority: the exact-request and applied-settlement contracts in
 * `packages/db/src/query/live/ARCHITECTURE.md` (Demand grouping and ownership,
 * Source cancellation and applied settlement). The plain-record fingerprint
 * models equality of request data, not source coverage or row ownership.
 * The identity driver uses a controlled adapter; its result does not establish
 * that an external provider honors an abort or returns complete ordered rows.
 */

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
): Promise<void> {
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
  fc.record({
    trace: exactDemandTraceArbitrary,
    settlementOrder: fc.constantFrom(`forward` as const, `reverse` as const),
  })

// Each pair differs in only one request-data axis. A deduper that drops that
// axis would wrongly reuse the first acquisition at the second request.
const exactDemandAxisPairs: ReadonlyArray<
  readonly [axis: string, first: ExactDemand, second: ExactDemand]
> = (() => {
  const first: ExactDemand = {
    values: [1, 2],
    orderField: `rank`,
    direction: `asc`,
    nulls: `last`,
    stringSort: `lexical`,
    offset: 0,
    limit: 2,
    cursorBoundary: undefined,
  }
  return [
    [`predicate values`, first, { ...first, values: [1, 3] }],
    [`order field`, first, { ...first, orderField: `score` }],
    [`direction`, first, { ...first, direction: `desc` }],
    [`null placement`, first, { ...first, nulls: `first` }],
    [`string sort`, first, { ...first, stringSort: `locale` }],
    [`offset`, first, { ...first, offset: 1 }],
    [`limit`, first, { ...first, limit: undefined }],
    [`cursor boundary`, first, { ...first, cursorBoundary: 1 }],
  ]
})()

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
  const promisesByDemand = new Map<string, Promise<void>>()
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

type RejectedWaiterScenario = {
  demand: ExactDemand
  failures: number
  waiters: number
  failureKind: `error` | `undefined`
}

const rejectedWaiterScenarioArbitrary = fc.record({
  demand: exactDemandArbitrary,
  failures: fc.integer({ min: 1, max: 3 }),
  waiters: fc.integer({ min: 2, max: 4 }),
  failureKind: fc.constantFrom(`error` as const, `undefined` as const),
})

async function expectExactWaitersShareRejection({
  demand,
  failures,
  waiters,
  failureKind,
}: RejectedWaiterScenario): Promise<void> {
  const transports: Array<ReturnType<typeof createDeferred<void>>> = []
  const observed: Array<Promise<unknown>> = []
  const dedupe = new DeduplicatedLoadSubset({
    loadSubset: () => {
      const deferred = createDeferred<void>()
      transports.push(deferred)
      observed.push(Promise.allSettled([deferred.promise]))
      return deferred.promise
    },
  })
  let previous: LoadSubsetRequestResult | undefined
  try {
    for (let attempt = 0; attempt <= failures; attempt++) {
      const callers: Array<LoadSubsetRequestResult> = []
      const settlements: Array<`fulfilled` | `rejected`> = []
      for (let waiter = 0; waiter < waiters; waiter++) {
        const result = dedupe.loadSubset(toLoadSubsetOptions(demand))
        observed.push(
          Promise.resolve(result).then(
            () => {
              settlements.push(`fulfilled`)
            },
            () => {
              settlements.push(`rejected`)
            },
          ),
        )
        callers.push(result)
        expect(result).toBeInstanceOf(Promise)
        expect(result).toBe(callers[0])
        expect(transports).toHaveLength(attempt + 1)
      }
      expect(callers[0]).not.toBe(previous)
      previous = callers[0]
      const outcomes = Promise.allSettled(callers)
      observed.push(outcomes)
      await Promise.resolve()
      await Promise.resolve()
      expect(settlements).toEqual([])

      const transport = transports[attempt]!
      if (attempt < failures) {
        const failure =
          failureKind === `error` ? new Error(`transport failed`) : undefined
        transport.reject(failure)
        for (const outcome of await outcomes) {
          expect(outcome.status).toBe(`rejected`)
          if (outcome.status === `rejected`)
            expect(outcome.reason).toBe(failure)
        }
        expect(settlements).toEqual(Array(waiters).fill(`rejected`))
      } else {
        transport.resolve()
        expect(await outcomes).toEqual(
          Array.from({ length: waiters }, () => ({
            status: `fulfilled`,
            value: undefined,
          })),
        )
        expect(settlements).toEqual(Array(waiters).fill(`fulfilled`))
      }
    }
    expect(dedupe.loadSubset(toLoadSubsetOptions(demand))).toBe(true)
    expect(transports).toHaveLength(failures + 1)
  } finally {
    for (const transport of transports) transport.resolve()
    await Promise.all(observed)
  }
}

const { multiplier, ...replay } = readOracleRunConfig()
const exactScenarioRuns = 40 * multiplier

let collectionSequence = 0

type OracleCleanupStep = {
  label: string
  run: () => void | Promise<void>
}

// A failed law remains the cause even if one or more releases also fail. Run
// every release so an earlier cleanup failure cannot strand later resources.
async function runOracleCleanup(
  law: string,
  primaryFailure: { error: unknown } | undefined,
  steps: ReadonlyArray<OracleCleanupStep>,
): Promise<void> {
  const cleanupFailures: Array<Error> = []
  for (const { label, run } of steps) {
    try {
      await run()
    } catch (error) {
      cleanupFailures.push(
        new Error(`${label} cleanup failed`, { cause: error }),
      )
    }
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, `${law}: cleanup failed`, {
      cause: primaryFailure?.error,
    })
  }
}

function releasePersistingMutation(
  persistence: ReturnType<typeof createDeferred<void>>,
  settlement?: Promise<unknown>,
): void {
  persistence.resolve()
  // A broken applied-settlement path can leave optimistic transaction
  // settlement pending forever. Collection teardown must proceed; observing
  // rejection prevents an abandoned promise from becoming an unrelated error.
  void settlement?.catch(() => undefined)
}

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
  let settlement: Promise<unknown> | undefined
  let cleanupLive: (() => Promise<void>) | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    if (persisting) {
      transaction.mutate(() => source.insert({ id: `other`, projectId: `p2` }))
    }
    const live = createLiveQueryCollection((query) =>
      query.from({ row: source }).where(({ row }) => eq(row.projectId, `p1`)),
    )
    cleanupLive = () => live.cleanup()
    if (persisting) expect(transaction.state).toBe(`persisting`)
    const ready = live.toArrayWhenReady()
    if (persisting) {
      let settled = false
      void ready.then(
        () => {
          settled = true
        },
        () => undefined,
      )
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
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `applied load reaches live-query readiness`,
      primaryFailure,
      [
        {
          label: `optimistic persistence`,
          run: () => {
            if (persisting) {
              releasePersistingMutation(persistence, settlement)
            }
          },
        },
        { label: `live query`, run: () => cleanupLive?.() },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
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
  const persistence = createDeferred<void>()
  let settlement: Promise<unknown> | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    source.startSyncImmediate()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    if (gate === `parked`) {
      transaction.mutate(() => source.insert({ id: `local`, projectId: `p2` }))
    }
    if (gate === `parked`) expect(transaction.state).toBe(`persisting`)
    const receipt = source._sync.loadSubset({})
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
    void pending
      .then(
        () => {
          settled = true
          visibleWhenSettled = source.get(`remote`)?.id === `remote`
        },
        () => undefined,
      )
      .catch(() => undefined)

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
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `subset receipt follows applied publication`,
      primaryFailure,
      [
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
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
  const persistence = createDeferred<void>()
  let settlement: Promise<unknown> | undefined
  let cleanupLive: (() => Promise<void>) | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    source.startSyncImmediate()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    transaction.mutate(() => source.insert({ id: `other`, projectId: `p2` }))
    publishUnrelated()
    const live = createLiveQueryCollection((query) =>
      query.from({ row: source }).where(({ row }) => eq(row.projectId, `p1`)),
    )
    cleanupLive = () => live.cleanup()
    expect(transaction.state).toBe(`persisting`)
    const ready = live.toArrayWhenReady()
    let settled = false
    void ready.then(
      () => {
        settled = true
      },
      () => undefined,
    )
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
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `parked stream remains behind applied subset`,
      primaryFailure,
      [
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        { label: `live query`, run: () => cleanupLive?.() },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
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
  const persistence = createDeferred<void>()
  let settlement: Promise<unknown> | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    source.startSyncImmediate()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    transaction.mutate(() => source.insert({ id: `other`, projectId: `p2` }))
    publishUnrelated()
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
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `subset completion follows applied rows`,
      primaryFailure,
      [
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
  }
}

async function expectConcurrentStreamCommitStaysParked(
  cancelBeforePersistence = false,
) {
  let publishUnrelated!: () => void
  let publishSubset!: () => void
  let rejectPendingSubset: ((reason: unknown) => void) | undefined
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
            new Promise<void>((resolve, reject) => {
              const fulfill = () => {
                rejectPendingSubset = undefined
                resolve()
              }
              const fail = (reason: unknown) => {
                rejectPendingSubset = undefined
                reject(reason)
              }
              rejectPendingSubset = fail
              publishSubset = () => {
                try {
                  begin()
                  write({
                    type: `insert`,
                    value: { id: `r1`, projectId: `p1` },
                  })
                  const applied = commit()
                  if (applied === true) {
                    fulfill()
                  } else {
                    void applied.then(fulfill, fail)
                  }
                } catch (error) {
                  fail(error)
                }
              }
            }),
        }
      },
    },
  })
  const persistence = createDeferred<void>()
  let settlement: Promise<unknown> | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    source.startSyncImmediate()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    transaction.mutate(() => source.insert({ id: `other`, projectId: `p2` }))
    const load = requirePendingAppliedReceipt(source._sync.loadSubset({}))
    void load.catch(() => undefined)
    publishUnrelated()
    publishSubset()
    let settled = false
    void load.then(
      () => {
        settled = true
      },
      () => undefined,
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(source.get(`unrelated`)).toBeUndefined()
    expect(source.get(`r1`)).toBeUndefined()
    if (cancelBeforePersistence) {
      await source.cleanup()
      await expect(load).rejects.toMatchObject({ name: `AbortError` })
      return
    }
    persistence.resolve()
    await transaction.isPersisted.promise
    await load
    expect(source.get(`unrelated`)).toEqual(
      expect.objectContaining({ id: `unrelated`, projectId: `p2` }),
    )
    expect(source.get(`r1`)).toEqual(
      expect.objectContaining({ id: `r1`, projectId: `p1` }),
    )
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `concurrent stream commit remains parked`,
      primaryFailure,
      [
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        {
          label: `controlled subset transport`,
          run: () =>
            rejectPendingSubset?.(
              new DOMException(`Oracle fixture released`, `AbortError`),
            ),
        },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
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
      // Source contract: accepted rows apply, but a caller that aborted sees
      // `AbortError`.
      if (signal?.aborted) throw new LoadSubsetOperationAbortedError()
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
  const persistence = createDeferred<void>()
  const controller = new AbortController()
  let settlement: Promise<unknown> | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    source.startSyncImmediate()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    transaction.mutate(() => source.insert({ id: `local`, projectId: `p2` }))
    const first = requirePendingAppliedReceipt(
      source._sync.loadSubset({ signal: controller.signal }),
    )
    if (abortPhase === `while-parked`) {
      await committed.promise
    }
    controller.abort()
    persistence.resolve()
    await transaction.isPersisted.promise
    // An accepted transaction always applies, so the row publishes when the
    // mutation settles. A caller that aborted still sees `AbortError`.
    if (abortPhase === `while-parked`)
      await expect(first).rejects.toMatchObject({ name: `AbortError` })
    else await first
    expect(transportCalls).toBe(1)
    if (abortPhase === `while-parked`)
      expect(source.get(`row`)).toEqual(expect.objectContaining({ id: `row` }))
    else expect(source.get(`row`)).toBeUndefined()

    const retry = source._sync.loadSubset({})
    if (retry !== true) await retry
    expect(transportCalls).toBe(2)
    expect(source.get(`row`)).toEqual(expect.objectContaining({ id: `row` }))
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `aborted receipt remains retryable`,
      primaryFailure,
      [
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
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
  const persistence = createDeferred<void>()
  let settlement: Promise<unknown> | undefined
  let unsubscribe: (() => void) | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    source.startSyncImmediate()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    transaction.mutate(() =>
      source.insert({ id: `local`, projectId: `pending` }),
    )
    const subscription = source.subscribeChanges((changes) => {
      if (changes.some((change) => change.key === `row`)) {
        controller.abort()
      }
    })
    unsubscribe = () => subscription.unsubscribe()
    const load = requirePendingAppliedReceipt(
      source._sync.loadSubset({ signal: controller.signal }),
    )
    persistence.resolve()
    await transaction.isPersisted.promise
    await expect(load).resolves.toBeUndefined()
    expect(controller.signal.aborted).toBe(true)
    expect(source.get(`row`)).toEqual(expect.objectContaining({ id: `row` }))
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `abort during publication retains applied rows`,
      primaryFailure,
      [
        { label: `change subscription`, run: () => unsubscribe?.() },
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
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
  const persistence = createDeferred<void>()
  let settlement: Promise<unknown> | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    await source.preload()
    await Promise.resolve()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    transaction.mutate(() =>
      source.insert({ id: `local`, projectId: `pending` }),
    )
    expect(transaction.state).toBe(`persisting`)
    begin()
    write({ type: `update`, value: { id: `first`, projectId: `new` } })
    const accepted = commit()
    const acceptedTransaction = source._state.pendingSyncedTransactions.at(-1)!
    expect(source._state.pendingSyncedTransactions).toHaveLength(1)
    begin()
    write({ type: `update`, value: { id: `second`, projectId: `new` } })
    expect(source._state.pendingSyncedTransactions).toHaveLength(2)

    // Only the accepted transaction publishes in a drain, so only its key is
    // suppressed; the open one holds no suppression to release.
    source._state.capturePreSyncVisibleState()
    expect(source._state.recentlySyncedKeys).toEqual(new Set([`first`]))

    // Only the open last transaction can be canceled.
    expect(() =>
      source._state.cancelPendingSyncedTransaction(acceptedTransaction),
    ).toThrow(SyncQueueInvariantError)
    const controller = new AbortController()
    controller.abort()
    const canceled = commit(controller.signal)
    expect(source._state.pendingSyncedTransactions).toHaveLength(1)
    expect(source._state.recentlySyncedKeys).toEqual(new Set([`first`]))
    expect(source._state.preSyncVisibleState.has(`second`)).toBe(false)
    expect(source._state.preSyncVisibleState.has(`first`)).toBe(true)
    await expect(canceled).rejects.toMatchObject({ name: `AbortError` })
    expect(accepted).not.toBe(true)
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `canceled receipt releases only its suppression`,
      primaryFailure,
      [
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
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
  const persistence = createDeferred<void>()
  let settlement: Promise<unknown> | undefined
  let settlements = 0

  let primaryFailure: { error: unknown } | undefined
  try {
    source.startSyncImmediate()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    transaction.mutate(() => source.insert({ id: `local`, projectId: `p2` }))
    const load = requirePendingAppliedReceipt(source._sync.loadSubset({}))
    void load.catch(() => undefined)
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
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `cleanup rejects abandoned demand once`,
      primaryFailure,
      [
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
  }
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
  const persistence = createDeferred<void>()
  let settlement: Promise<unknown> | undefined
  let cleanupDerived: (() => Promise<void>) | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    const derived = createLiveQueryCollection({
      query: (query) =>
        query
          .from({ row: source })
          .select(({ row }) => ({ id: row.id, value: row.value })),
      getKey: (row) => row.id,
      startSync: true,
    })
    cleanupDerived = () => derived.cleanup()
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
    settlement = transaction.isPersisted.promise
    begin()
    write({ type: `insert`, value: { id: `synced`, value: `synced` } })
    commit()

    try {
      expect([...derived.keys()].sort()).toEqual([`optimistic`, `synced`])
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `derived sync during optimistic mutation`,
      primaryFailure,
      [
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        { label: `derived collection`, run: () => cleanupDerived?.() },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
  }
}

describe(`exact loadSubset demand oracle`, () => {
  it.each(exactDemandAxisPairs)(
    `distinguishes a change to %s in completed and concurrent demands`,
    async (_axis, first, second) => {
      assertCompletedExactDemandTrace([first, second, first])
      await assertConcurrentExactDemandTrace({
        trace: [first, second, first],
        settlementOrder: `reverse`,
      })
    },
  )

  it(`refetch starts fresh work for the same exact demand`, () => {
    let starts = 0
    const dedupe = new DeduplicatedLoadSubset({
      loadSubset: () => {
        starts++
        return true
      },
    })
    const options = toLoadSubsetOptions(exactDemandAxisPairs[0]![1])

    expect(dedupe.loadSubset(options)).toBe(true)
    expect(dedupe.loadSubset(options)).toBe(true)
    expect(starts).toBe(1)

    expect(dedupe.loadSubset({ ...options, refetch: true })).toBe(true)
    expect(starts).toBe(2)
    expect(dedupe.loadSubset(options)).toBe(true)
    expect(starts).toBe(2)
  })

  it(`starts separate acquisitions for independently cancelable exact demands`, async () => {
    const acquisitions: Array<ReturnType<typeof createDeferred<void>>> = []
    const dedupe = new DeduplicatedLoadSubset({
      loadSubset: () => {
        const acquisition = createDeferred<void>()
        acquisitions.push(acquisition)
        return acquisition.promise
      },
    })
    const options = toLoadSubsetOptions(exactDemandAxisPairs[0]![1])
    const first = dedupe.loadSubset({
      ...options,
      signal: new AbortController().signal,
    })
    const second = dedupe.loadSubset({
      ...options,
      signal: new AbortController().signal,
    })

    expect(acquisitions).toHaveLength(2)
    expect(first).not.toBe(second)
    for (const acquisition of acquisitions) acquisition.resolve()
    await Promise.all([first, second])
  })

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
    await expectExactWaitersShareRejection({
      demand: {
        values: [1, 2],
        orderField: `rank`,
        direction: `asc`,
        nulls: `last`,
        stringSort: `lexical`,
        offset: 0,
        limit: 2,
        cursorBoundary: undefined,
      },
      failures: 1,
      waiters: 2,
      failureKind: `error`,
    })
  })

  fcTest.prop([rejectedWaiterScenarioArbitrary], {
    numRuns: exactScenarioRuns,
    seed: 703027,
    examples: [
      [
        {
          demand: {
            values: [1, 2],
            orderField: `rank`,
            direction: `asc`,
            nulls: `last`,
            stringSort: `lexical`,
            offset: 0,
            limit: 2,
            cursorBoundary: undefined,
          },
          failures: 3,
          waiters: 4,
          failureKind: `undefined`,
        },
      ],
    ],
  })(
    `retries failed exact demand histories through fresh success for a fixed seed`,
    expectExactWaitersShareRejection,
  )

  fcTest.prop(
    [rejectedWaiterScenarioArbitrary],
    oracleRandomParameters(
      exactScenarioRuns,
      replay,
      `load-subset.rejected-waiter`,
    ),
  )(
    `retries failed exact demand histories through fresh success for a random or replayed seed`,
    expectExactWaitersShareRejection,
  )
})

describe(`loadSubset application and cancellation`, () => {
  it(`releases a pending mutation and source despite a cleanup fault`, async () => {
    const primary = new TraceAssertionError(
      4,
      new Error(`subset receipt settled before publication`),
    )
    const persistence = createDeferred<void>()
    const stillPending = createDeferred<void>()
    const cleanupFault = new Error(`subscription release failed`)
    const released: Array<string> = []
    let receiptSettled = false
    let receiptSettledAtCleanup = false
    void stillPending.promise.then(
      () => {
        receiptSettled = true
      },
      () => undefined,
    )

    let failure: unknown
    try {
      await runOracleCleanup(
        `subset receipt follows applied publication`,
        { error: primary },
        [
          {
            label: `persistence gate`,
            run: () => {
              released.push(`persistence gate`)
              releasePersistingMutation(persistence, stillPending.promise)
            },
          },
          {
            label: `subscription`,
            run: () => {
              released.push(`subscription`)
              throw cleanupFault
            },
          },
          {
            label: `source collection`,
            run: () => {
              released.push(`source collection`)
            },
          },
        ],
      )
    } catch (error) {
      failure = error
    } finally {
      receiptSettledAtCleanup = receiptSettled
      stillPending.resolve()
    }

    await persistence.promise
    expect(released).toEqual([
      `persistence gate`,
      `subscription`,
      `source collection`,
    ])
    expect(receiptSettledAtCleanup).toBe(false)
    expect(failure).toBeInstanceOf(AggregateError)
    const aggregate = failure as AggregateError
    expect(aggregate.cause).toBe(primary)
    expect(primary.checkpoint).toBe(4)
    expect(aggregate.errors).toEqual([
      new Error(`subscription cleanup failed`, { cause: cleanupFault }),
    ])
  })

  it(`keeps the violated law and checkpoint when two cleanup steps fail`, async () => {
    const primary = new TraceAssertionError(
      3,
      new Error(`loaded row absent at readiness`),
    )
    const firstCleanup = new Error(`release failed`)
    const secondCleanup = new Error(`collection cleanup failed`)
    const releases: Array<string> = []

    let failure: unknown
    try {
      await runOracleCleanup(
        `applied load reaches live-query readiness`,
        { error: primary },
        [
          {
            label: `acquisition`,
            run: () => {
              releases.push(`acquisition`)
              throw firstCleanup
            },
          },
          {
            label: `live query`,
            run: () => {
              releases.push(`live query`)
              throw secondCleanup
            },
          },
          {
            label: `source collection`,
            run: () => {
              releases.push(`source collection`)
            },
          },
        ],
      )
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(AggregateError)
    const aggregate = failure as AggregateError
    expect(aggregate.message).toContain(
      `applied load reaches live-query readiness`,
    )
    expect(aggregate.cause).toBe(primary)
    expect(primary.checkpoint).toBe(3)
    expect(aggregate.errors).toHaveLength(2)
    expect(aggregate.errors[0]).toMatchObject({
      message: `acquisition cleanup failed`,
      cause: firstCleanup,
    })
    expect(aggregate.errors[1]).toMatchObject({
      message: `live query cleanup failed`,
      cause: secondCleanup,
    })
    expect(releases).toEqual([`acquisition`, `live query`, `source collection`])
  })

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

  it(`rejects the controlled subset transport when its applied receipt is canceled`, async () => {
    await expectConcurrentStreamCommitStaysParked(true)
  })

  it.each([`before-commit`, `while-parked`] as const)(
    `rejects an aborted demand and keeps its accepted rows when aborted %s`,
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
