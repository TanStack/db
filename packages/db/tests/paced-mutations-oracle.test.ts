import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection'
import { createPacedMutations } from '../src/paced-mutations'
import {
  debounceStrategy,
  queueStrategy,
  throttleStrategy,
} from '../src/strategies'
import { mockSyncCollectionOptionsNoInitialState } from './utils'
import type { Strategy } from '../src/strategies/types'
import type { Transaction } from '../src/transactions'

/**
 * # Which optimistic transactions does a pacing strategy persist?
 *
 * The public strategy docs promise immediate optimistic mutation, one
 * transaction per queue call, serial queue persistence, debounce after quiet,
 * and leading/trailing throttle edges. The reference below uses a virtual
 * clock and ordered call IDs. It does not use pacer-lite or its scheduler.
 *
 * The grammar consists of `mutate(id)` and `advance(ms)` actions. IDs are
 * distinct positive integers. Queue waits include zero; debounce and throttle
 * waits are positive. The clock only advances.
 * The final advance is the observation cut: persistence calls retain their
 * recorded times, and returned transaction states must agree with the model.
 * It settles every admitted call. Queue capacity counts waiting items; an
 * overflow rejects its transaction and removes its optimistic row. An explicit
 * non-leading throttle waits for its first trailing edge, including when
 * `leading` is omitted and `trailing` is true. Strategy factories
 * leave caller-owned options unchanged. A custom queue strategy may admit work
 * and return void, as the original public execute contract allowed. Omitted
 * edge combinations and failed persistence remain outside this owner's grammar.
 *
 * Model `pendingIds` combines the production active optimistic transaction's
 * mutations. Model `ready` is an ordered list of queue calls, not pacer-lite's
 * queue or its processing chain. Model `due` is a virtual clock appointment,
 * not a production timer handle.
 */
type Action = { kind: `mutate`; id: number } | { kind: `advance`; ms: number }
type Start = { at: number; ids: Array<number> }
type Position = `front` | `back`

type Case = {
  name: string
  actions: Array<Action>
  expected: Array<Start>
  sameTransaction: Array<Array<number>>
  strategy: () => Strategy
}

const origin = 1_000_000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(origin)
})

afterEach(() => {
  vi.useRealTimers()
})

// The queue's documented position policy is list insertion/removal. The first
// call starts immediately; wait separates later dequeues. This model does not
// contain a promise chain: the driver supplies immediately fulfilled writes.
function queueStarts(
  actions: Array<Action>,
  wait: number,
  addTo: Position,
  takeFrom: Position,
): Array<Start> {
  let now = 0
  let due: number | undefined
  const ready: Array<number> = []
  const starts: Array<Start> = []

  const take = () => {
    const id = takeFrom === `front` ? ready.shift() : ready.pop()
    if (id !== undefined) {
      starts.push({ at: now, ids: [id] })
      due = now + wait
    } else {
      due = undefined
    }
  }

  for (const action of actions) {
    if (action.kind === `mutate`) {
      if (addTo === `front`) ready.unshift(action.id)
      else ready.push(action.id)
      if (due === undefined) take()
      continue
    }

    const target = now + action.ms
    while (due !== undefined && due <= target) {
      now = due
      take()
    }
    now = target
  }
  return starts
}

// A quiet group persists only after no call has arrived for a full wait.
function debounceStarts(actions: Array<Action>, wait: number): Array<Start> {
  let now = 0
  let due: number | undefined
  let pendingIds: Array<number> = []
  const starts: Array<Start> = []
  for (const action of actions) {
    if (action.kind === `mutate`) {
      pendingIds.push(action.id)
      due = now + wait
      continue
    }
    const target = now + action.ms
    if (due !== undefined && due <= target) {
      starts.push({ at: due, ids: pendingIds })
      pendingIds = []
      due = undefined
    }
    now = target
  }
  return starts
}

// With explicit leading and trailing edges, one call starts each window and
// calls during that window share the next trailing transaction.
function throttleStarts(actions: Array<Action>, wait: number): Array<Start> {
  let now = 0
  let due: number | undefined
  let pendingIds: Array<number> = []
  const starts: Array<Start> = []
  for (const action of actions) {
    if (action.kind === `mutate`) {
      if (due === undefined) {
        starts.push({ at: now, ids: [action.id] })
        due = now + wait
      } else {
        pendingIds.push(action.id)
      }
      continue
    }
    const target = now + action.ms
    while (due !== undefined && due <= target) {
      now = due
      if (pendingIds.length > 0) {
        starts.push({ at: now, ids: pendingIds })
        due += wait
      } else {
        due = undefined
      }
      pendingIds = []
    }
    now = target
  }
  return starts
}

// A non-leading window starts on the first call after an idle edge. Calls in
// that window share the trailing transaction, even if calls continue steadily.
function nonLeadingThrottleStarts(
  actions: Array<Action>,
  wait: number,
): Array<Start> {
  let now = 0
  let due: number | undefined
  let pendingIds: Array<number> = []
  const starts: Array<Start> = []
  for (const action of actions) {
    if (action.kind === `mutate`) {
      pendingIds.push(action.id)
      due ??= now + wait
      continue
    }
    const target = now + action.ms
    while (due !== undefined && due <= target) {
      now = due
      starts.push({ at: now, ids: pendingIds })
      pendingIds = []
      due = undefined
    }
    now = target
  }
  return starts
}

async function createReadyCollection() {
  const collection = createCollection(
    mockSyncCollectionOptionsNoInitialState<{ id: number }>({
      id: `paced-oracle`,
      getKey: (item) => item.id,
    }),
  )
  const preload = collection.preload()
  collection.utils.begin()
  collection.utils.commit()
  collection.utils.markReady()
  await preload
  return collection
}

// Keep the violated law as the primary cause if cleanup also fails. Release
// every resource even when an earlier cleanup step throws.
async function withCleanup<T>(
  strategy: Strategy,
  collection: { cleanup: () => Promise<void> },
  run: () => Promise<T>,
  release?: () => Promise<void>,
): Promise<T> {
  const outcome = await Promise.resolve()
    .then(run)
    .then(
      (value) => ({ ok: true, value }) as const,
      (error: unknown) => ({ ok: false, error }) as const,
    )
  const cleanupErrors: Array<unknown> = []
  try {
    await release?.()
  } catch (error) {
    cleanupErrors.push(error)
  }
  try {
    strategy.cleanup()
  } catch (error) {
    cleanupErrors.push(error)
  }
  try {
    await collection.cleanup()
  } catch (error) {
    cleanupErrors.push(error)
  }

  if (!outcome.ok) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, `Oracle cleanup also failed`, {
        cause: outcome.error,
      })
    }
    throw outcome.error
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `Oracle cleanup failed`)
  }
  return outcome.value
}

function observeReceipt<T extends object>(transaction: Transaction<T>) {
  const receipt: {
    outcome: `pending` | `fulfilled` | `rejected`
    returnedSame?: boolean
    error?: unknown
  } = { outcome: `pending` }
  void transaction.isPersisted.promise.then(
    (resolved) => {
      receipt.outcome = `fulfilled`
      receipt.returnedSame = resolved === transaction
    },
    (error: unknown) => {
      receipt.outcome = `rejected`
      receipt.error = error
    },
  )
  return receipt
}

type Observation = {
  starts: Array<Start>
  sameTransaction: Array<Array<number>>
  states: Array<string>
  optimistic: Array<number | undefined>
  persistence: Array<{
    id: number
    outcome: string
    returnedSame: boolean | undefined
  }>
}

async function runProduction(
  testCase: Case,
  check: (actual: Observation) => void,
): Promise<Observation> {
  const collection = await createReadyCollection()
  const strategy = testCase.strategy()
  const starts: Array<Start> = []
  const optimistic: Array<number | undefined> = []
  const transactions = new Map<number, Transaction<{ id: number }>>()
  const persistence = new Map<
    Transaction<{ id: number }>,
    { id: number; outcome: string; returnedSame: boolean | undefined }
  >()
  const mutate = createPacedMutations<number, { id: number }>({
    onMutate: (id) => collection.insert({ id }),
    mutationFn: ({ transaction }) => {
      starts.push({
        at: Date.now() - origin,
        ids: transaction.mutations.map((mutation) => {
          const id = mutation.changes.id
          if (typeof id !== `number`) throw new Error(`Missing mutation ID`)
          return id
        }),
      })
      return Promise.resolve()
    },
    strategy,
  })

  return withCleanup(strategy, collection, async () => {
    for (const action of testCase.actions) {
      if (action.kind === `mutate`) {
        const transaction = mutate(action.id)
        transactions.set(action.id, transaction)
        if (!persistence.has(transaction)) {
          const observation = {
            id: action.id,
            outcome: `pending`,
            returnedSame: undefined as boolean | undefined,
          }
          persistence.set(transaction, observation)
          void transaction.isPersisted.promise.then(
            (resolved) => {
              observation.outcome = `fulfilled`
              observation.returnedSame = resolved === transaction
            },
            () => {
              observation.outcome = `rejected`
            },
          )
        }
        optimistic.push(collection.get(action.id)?.id)
      } else {
        await vi.advanceTimersByTimeAsync(action.ms)
      }
    }
    await vi.advanceTimersByTimeAsync(0)
    const groups = new Map<Transaction<{ id: number }>, Array<number>>()
    for (const [id, transaction] of transactions) {
      const group = groups.get(transaction)
      if (group) group.push(id)
      else groups.set(transaction, [id])
    }
    const actual = {
      starts,
      sameTransaction: [...groups.values()],
      states: [...transactions.values()].map(
        (transaction) => transaction.state,
      ),
      optimistic,
      persistence: [...persistence.values()],
    }
    check(actual)
    return actual
  })
}

const queueActions: Array<Action> = [
  { kind: `mutate`, id: 1 },
  { kind: `mutate`, id: 2 },
  { kind: `mutate`, id: 3 },
  { kind: `advance`, ms: 10 },
  { kind: `mutate`, id: 4 },
  { kind: `advance`, ms: 20 },
]

const zeroWaitQueueActions: Array<Action> = [
  { kind: `mutate`, id: 1 },
  { kind: `mutate`, id: 2 },
  { kind: `mutate`, id: 3 },
  { kind: `advance`, ms: 0 },
]

const debounceActions: Array<Action> = [
  { kind: `mutate`, id: 1 },
  { kind: `advance`, ms: 8 },
  { kind: `mutate`, id: 2 },
  { kind: `advance`, ms: 9 },
  { kind: `mutate`, id: 3 },
  { kind: `advance`, ms: 10 },
  { kind: `mutate`, id: 4 },
  { kind: `advance`, ms: 10 },
]

const throttleActions: Array<Action> = [
  { kind: `mutate`, id: 1 },
  { kind: `advance`, ms: 4 },
  { kind: `mutate`, id: 2 },
  { kind: `advance`, ms: 5 },
  { kind: `mutate`, id: 3 },
  { kind: `advance`, ms: 1 },
  { kind: `mutate`, id: 4 },
  { kind: `advance`, ms: 10 },
]

const nonLeadingThrottleActions: Array<Action> = [
  { kind: `mutate`, id: 1 },
  { kind: `advance`, ms: 4 },
  { kind: `mutate`, id: 2 },
  { kind: `advance`, ms: 6 },
  { kind: `mutate`, id: 3 },
  { kind: `advance`, ms: 10 },
]

const cases: Array<Case> = [
  ...([`front`, `back`] as const).flatMap((addTo) =>
    ([`front`, `back`] as const).map((takeFrom) => ({
      name: `queue adds ${addTo} and takes ${takeFrom}`,
      actions: queueActions,
      expected: queueStarts(queueActions, 10, addTo, takeFrom),
      sameTransaction: [[1], [2], [3], [4]],
      strategy: () =>
        queueStrategy({ wait: 10, addItemsTo: addTo, getItemsFrom: takeFrom }),
    })),
  ),
  {
    name: `zero-wait queue persists each call independently`,
    actions: zeroWaitQueueActions,
    expected: queueStarts(zeroWaitQueueActions, 0, `back`, `front`),
    sameTransaction: [[1], [2], [3]],
    strategy: () => queueStrategy({ wait: 0 }),
  },
  {
    name: `debounce persists after each quiet period`,
    actions: debounceActions,
    expected: debounceStarts(debounceActions, 10),
    sameTransaction: [[1, 2, 3], [4]],
    strategy: () =>
      debounceStrategy({ wait: 10, leading: false, trailing: true }),
  },
  {
    name: `throttle persists leading and trailing transactions`,
    actions: throttleActions,
    expected: throttleStarts(throttleActions, 10),
    sameTransaction: [[1], [2, 3], [4]],
    strategy: () =>
      throttleStrategy({ wait: 10, leading: true, trailing: true }),
  },
  {
    name: `default throttle persists leading and trailing transactions`,
    actions: throttleActions,
    expected: throttleStarts(throttleActions, 10),
    sameTransaction: [[1], [2, 3], [4]],
    strategy: () => throttleStrategy({ wait: 10 }),
  },
  {
    name: `explicit non-leading throttle waits for each trailing edge`,
    actions: nonLeadingThrottleActions,
    expected: nonLeadingThrottleStarts(nonLeadingThrottleActions, 10),
    sameTransaction: [[1, 2], [3]],
    strategy: () =>
      throttleStrategy({ wait: 10, leading: false, trailing: true }),
  },
  {
    name: `omitted leading throttle waits for each trailing edge`,
    actions: nonLeadingThrottleActions,
    expected: nonLeadingThrottleStarts(nonLeadingThrottleActions, 10),
    sameTransaction: [[1, 2], [3]],
    strategy: () => throttleStrategy({ wait: 10, trailing: true }),
  },
]

describe(`paced mutation timeline oracle`, () => {
  for (const testCase of cases) {
    it(testCase.name, async () => {
      await runProduction(testCase, (actual) => {
        expect(actual.starts).toEqual(testCase.expected)
        expect(actual.sameTransaction).toEqual(testCase.sameTransaction)
        expect(actual.optimistic).toEqual(
          testCase.actions.flatMap((action) =>
            action.kind === `mutate` ? [action.id] : [],
          ),
        )
        expect(actual.states).toEqual(
          testCase.sameTransaction.flatMap((group) =>
            group.map(() => `completed`),
          ),
        )
        expect(actual.persistence).toEqual(
          testCase.sameTransaction.map(([id]) => ({
            id,
            outcome: `fulfilled`,
            returnedSame: true,
          })),
        )
      })
    })
  }

  it(`holds later queue writes until each prior transaction settles`, async () => {
    const collection = await createReadyCollection()
    const strategy = queueStrategy({ wait: 10 })
    const started: Array<number> = []
    const releases = new Map<number, () => void>()
    let releaseFutureWrites = false
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: ({ transaction }) => {
        const id = transaction.mutations[0].changes.id
        if (typeof id !== `number`) throw new Error(`Missing mutation ID`)
        started.push(id)
        if (releaseFutureWrites || id === 3) return Promise.resolve()
        return new Promise<void>((resolve) => releases.set(id, resolve))
      },
      strategy,
    })

    await withCleanup(
      strategy,
      collection,
      async () => {
        const first = mutate(1)
        const second = mutate(2)
        const third = mutate(3)
        expect(collection.get(1)?.id).toBe(1)
        expect(collection.get(2)?.id).toBe(2)
        expect(collection.get(3)?.id).toBe(3)

        await vi.advanceTimersByTimeAsync(30)
        expect(started).toEqual([1])
        expect([first.state, second.state, third.state]).toEqual([
          `persisting`,
          `pending`,
          `pending`,
        ])

        releases.get(1)?.()
        await vi.advanceTimersByTimeAsync(0)
        expect(started).toEqual([1, 2])
        expect([first.state, second.state, third.state]).toEqual([
          `completed`,
          `persisting`,
          `pending`,
        ])

        releases.get(2)?.()
        await vi.advanceTimersByTimeAsync(0)
        expect(started).toEqual([1, 2, 3])
        for (const transaction of [first, second, third]) {
          expect(await transaction.isPersisted.promise).toBe(transaction)
        }
      },
      async () => {
        releaseFutureWrites = true
        for (const resolve of releases.values()) resolve()
        await vi.advanceTimersByTimeAsync(0)
      },
    )
  })

  for (const { maxSize, wait, expectedStarts, expectedStates } of [
    {
      maxSize: 0,
      wait: 0,
      expectedStarts: [],
      expectedStates: [`failed`, `failed`, `failed`],
    },
    {
      maxSize: 1,
      wait: 10,
      expectedStarts: [1, 2],
      expectedStates: [`persisting`, `pending`, `failed`],
    },
    {
      maxSize: 1,
      wait: 0,
      expectedStarts: [1, 2, 3],
      expectedStates: [`persisting`, `pending`, `pending`],
    },
  ]) {
    it(`queue capacity ${maxSize} at wait ${wait} rejects only overflow`, async () => {
      const collection = await createReadyCollection()
      const strategy = queueStrategy({ maxSize, wait })
      const started: Array<number> = []
      const releases: Array<() => void> = []
      const mutate = createPacedMutations<number, { id: number }>({
        onMutate: (id) => collection.insert({ id }),
        mutationFn: ({ transaction }) => {
          const id = transaction.mutations[0].changes.id
          if (typeof id !== `number`) throw new Error(`Missing mutation ID`)
          started.push(id)
          return new Promise<void>((resolve) => releases.push(resolve))
        },
        strategy,
      })

      await withCleanup(
        strategy,
        collection,
        async () => {
          const transactions = [mutate(1), mutate(2), mutate(3)]
          const receipts = transactions.map(observeReceipt)
          await vi.advanceTimersByTimeAsync(0)
          expect(transactions.map((transaction) => transaction.state)).toEqual(
            expectedStates,
          )
          for (const [index, state] of expectedStates.entries()) {
            expect(collection.get(index + 1)?.id).toBe(
              state === `failed` ? undefined : index + 1,
            )
          }
          for (const [index, state] of expectedStates.entries()) {
            if (state === `failed`) {
              expect(
                receipts[index],
                `overflow receipt at admission`,
              ).toMatchObject({
                outcome: `rejected`,
                error: { name: `QueueCapacityExceededError` },
              })
            }
          }
          await vi.advanceTimersByTimeAsync(30)
          for (let index = 0; index < expectedStarts.length; index++) {
            releases[index]?.()
            await vi.advanceTimersByTimeAsync(0)
          }
          expect(started).toEqual(expectedStarts)
          for (const [index, state] of expectedStates.entries()) {
            if (state !== `failed`) {
              expect(
                receipts[index],
                `admitted receipt after drain`,
              ).toMatchObject({
                outcome: `fulfilled`,
                returnedSame: true,
              })
            }
          }
        },
        async () => {
          for (const release of releases) release()
          await vi.advanceTimersByTimeAsync(0)
        },
      )
    })
  }

  it(`queue overflow preserves admitted same-key mutations`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptionsNoInitialState<{ id: number; value: number }>({
        id: `paced-capacity-same-key`,
        getKey: (item) => item.id,
      }),
    )
    const preload = collection.preload()
    collection.utils.begin()
    collection.utils.commit()
    collection.utils.markReady()
    await preload
    const strategy = queueStrategy({ maxSize: 1, wait: 10 })
    const started: Array<number> = []
    const releases: Array<() => void> = []
    const mutate = createPacedMutations<number, { id: number; value: number }>({
      onMutate: (value) => {
        if (value === 1) collection.insert({ id: 1, value })
        else
          collection.update(1, (draft) => {
            draft.value = value
          })
      },
      mutationFn: ({ transaction }) => {
        const value = transaction.mutations[0].changes.value
        if (typeof value !== `number`) throw new Error(`Missing value`)
        started.push(value)
        return new Promise<void>((resolve) => releases.push(resolve))
      },
      strategy,
    })
    await withCleanup(
      strategy,
      collection,
      async () => {
        const first = mutate(1)
        const second = mutate(2)
        const overflow = mutate(3)
        const firstReceipt = observeReceipt(first)
        const secondReceipt = observeReceipt(second)
        const overflowReceipt = observeReceipt(overflow)
        await vi.advanceTimersByTimeAsync(0)
        expect([first.state, second.state, overflow.state]).toEqual([
          `persisting`,
          `pending`,
          `failed`,
        ])
        expect(collection.get(1)?.value).toBe(2)
        expect(overflowReceipt, `same-key overflow receipt`).toMatchObject({
          outcome: `rejected`,
          error: { name: `QueueCapacityExceededError` },
        })
        await vi.advanceTimersByTimeAsync(10)
        releases[0]?.()
        await vi.advanceTimersByTimeAsync(0)
        expect(started).toEqual([1, 2])
        expect(firstReceipt).toMatchObject({
          outcome: `fulfilled`,
          returnedSame: true,
        })
        expect(secondReceipt.outcome).toBe(`pending`)
        expect(
          collection.get(1)?.value,
          `admitted optimistic update after first settlement`,
        ).toBe(2)
        releases[1]?.()
        await vi.advanceTimersByTimeAsync(0)
        expect(secondReceipt).toMatchObject({
          outcome: `fulfilled`,
          returnedSame: true,
        })
      },
      async () => {
        for (const release of releases) release()
        await vi.advanceTimersByTimeAsync(0)
      },
    )
  })

  it(`keeps a void-returning custom queue transaction pending until its callback`, async () => {
    const collection = await createReadyCollection()
    let timer: ReturnType<typeof setTimeout> | undefined
    const strategy: Strategy = {
      _type: `queue`,
      execute: (fn) => {
        timer = setTimeout(() => fn(), 10)
      },
      cleanup: () => {
        if (timer !== undefined) clearTimeout(timer)
      },
    }
    const starts: Array<number> = []
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: () => {
        starts.push(Date.now() - origin)
        return Promise.resolve()
      },
      strategy,
    })

    await withCleanup(strategy, collection, async () => {
      const transaction = mutate(1)
      const receipt = observeReceipt(transaction)
      expect(transaction.state, `custom queue admission`).toBe(`pending`)
      expect(collection.get(1)?.id).toBe(1)
      await vi.advanceTimersByTimeAsync(10)
      expect(starts).toEqual([10])
      expect(receipt).toMatchObject({
        outcome: `fulfilled`,
        returnedSame: true,
      })
    })
  })

  it(`strategy factories preserve frozen caller options`, () => {
    const debounceOptions = Object.freeze({ wait: 10 })
    const throttleOptions = Object.freeze({ wait: 10 })
    const queueOptions = Object.freeze({ wait: 10, maxSize: 1 })
    const debounce = debounceStrategy(debounceOptions)
    const throttle = throttleStrategy(throttleOptions)
    const queue = queueStrategy(queueOptions)
    try {
      expect(debounceOptions).toEqual({ wait: 10 })
      expect(throttleOptions).toEqual({ wait: 10 })
      expect(queueOptions).toEqual({ wait: 10, maxSize: 1 })
    } finally {
      debounce.cleanup()
      throttle.cleanup()
      queue.cleanup()
    }
  })

  it(`preserves a trace failure and cleanup failure separately`, async () => {
    const collection = await createReadyCollection()
    const cleanupCollection = vi.spyOn(collection, `cleanup`)
    const cleanupError = new Error(`strategy cleanup failed`)
    const strategy: Strategy = {
      _type: `queue`,
      execute: () => true,
      cleanup: () => {
        throw cleanupError
      },
    }
    const caught: unknown = await withCleanup(strategy, collection, () => {
      expect([{ at: 0, ids: [1] }], `final execution trace`).toEqual([
        { at: 10, ids: [1] },
      ])
      return Promise.resolve()
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(caught).toBeInstanceOf(AggregateError)
    const aggregate = caught as AggregateError
    expect(aggregate.cause).toMatchObject({ name: `AssertionError` })
    expect((aggregate.cause as Error).message).toContain(
      `final execution trace`,
    )
    expect(aggregate.errors).toEqual([cleanupError])
    expect(cleanupCollection).toHaveBeenCalledTimes(1)
  })

  it(`rejects front/back, trailing, and leading-edge mutants`, async () => {
    const wrongStrategies: Array<{
      caseName: string
      strategy: () => Strategy
    }> = [
      {
        caseName: `queue adds front and takes front`,
        strategy: () =>
          queueStrategy({
            wait: 10,
            addItemsTo: `front`,
            getItemsFrom: `back`,
          }),
      },
      {
        caseName: `debounce persists after each quiet period`,
        strategy: () =>
          debounceStrategy({ wait: 10, leading: false, trailing: false }),
      },
      {
        caseName: `throttle persists leading and trailing transactions`,
        strategy: () =>
          throttleStrategy({ wait: 10, leading: false, trailing: true }),
      },
    ]
    for (const { caseName, strategy } of wrongStrategies) {
      const lawful = cases.find((testCase) => testCase.name === caseName)
      if (!lawful) throw new Error(`Missing calibration case`)
      await expect(
        runProduction({ ...lawful, strategy }, (actual) => {
          expect(actual.starts).toEqual(lawful.expected)
        }),
      ).rejects.toMatchObject({ name: `AssertionError` })
    }
  })

  it(`rejects capacity, overflow settlement, early throttle, and option mutation mutants`, async () => {
    const capacityChecker = async (strategy: Strategy) => {
      const collection = await createReadyCollection()
      const mutate = createPacedMutations<number, { id: number }>({
        onMutate: (id) => collection.insert({ id }),
        mutationFn: () => Promise.resolve(),
        strategy,
      })
      return withCleanup(strategy, collection, () => {
        mutate(1)
        mutate(2)
        const third = mutate(3)
        expect(third.state, `overflow settlement`).toBe(`failed`)
        return Promise.resolve()
      })
    }
    await expect(
      capacityChecker(queueStrategy({ maxSize: Infinity, wait: 10 })),
    ).rejects.toMatchObject({ name: `AssertionError` })

    const falseGreen = queueStrategy({ maxSize: 1, wait: 10 })
    const originalExecute = falseGreen.execute
    falseGreen.execute = (fn) => {
      originalExecute(fn)
      return true
    }
    await expect(capacityChecker(falseGreen)).rejects.toMatchObject({
      name: `AssertionError`,
    })

    const nonLeading = cases.find(
      (testCase) =>
        testCase.name ===
        `explicit non-leading throttle waits for each trailing edge`,
    )
    if (!nonLeading) throw new Error(`Missing non-leading calibration case`)
    await expect(
      runProduction(
        {
          ...nonLeading,
          strategy: () =>
            throttleStrategy({ wait: 10, leading: true, trailing: true }),
        },
        (actual) => expect(actual.starts).toEqual(nonLeading.expected),
      ),
    ).rejects.toMatchObject({ name: `AssertionError` })

    const options: { wait: number; trailing?: boolean } = { wait: 10 }
    options.trailing = true
    expect(() => expect(options).toEqual({ wait: 10 })).toThrowError(
      expect.objectContaining({ name: `AssertionError` }),
    )
  })
})
