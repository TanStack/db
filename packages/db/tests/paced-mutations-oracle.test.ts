import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection'
import { createDeferred } from '../src/deferred'
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
 * The held-write extension below adds successful hold/release histories for
 * debounce and throttle. It checks the documented one-pending/one-persisting
 * bound, timer eligibility, caller settlement, and retained optimistic rows.
 *
 * The ordinary timeline grammar consists of `mutate(id)` and `advance(ms)` actions. IDs are
 * distinct positive integers. Queue waits include zero; debounce and throttle
 * waits are positive. The clock only advances.
 * The final advance is the observation cut: persistence calls retain their
 * recorded times, and returned transaction states must agree with the model.
 * It settles every admitted call. Queue capacity counts waiting items; an
 * overflow rejects its transaction and removes its optimistic row. A
 * non-leading debounce waits for its quiet edge when `trailing` is omitted.
 * A non-leading throttle waits for its first trailing edge, including when
 * `leading` or `trailing` is omitted individually. Leading-only throttle
 * rejects calls dropped inside a window, including when `leading` is omitted.
 * Leading-only debounce rejects skipped calls too; disabling both edges
 * rejects every call. Strategy factories leave
 * caller-owned options unchanged. A custom queue strategy may admit work
 * and return void. A custom batch strategy may return false while retaining
 * its callback, as the original public execute contract allowed.
 * The ordinary timing grammar uses immediately fulfilled writes. Separate
 * held-write and settlement histories below cover delayed handlers, rejection,
 * and rollback. New debounce/throttle calls after cleanup remain outside this
 * owner's grammar.
 * Cleanup stops new admission and drains admitted queue work at its regular
 * wait intervals, even if a separate Collection cleanup has finished. The
 * throttle's pending trailing timer also drains after cleanup at its regular
 * edge. A pending debounce timer drains after the last call's quiet period.
 * A call after queue cleanup rejects with a disposal reason. The final cut
 * waits for every admitted receipt.
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

async function createReadyCollection<T extends { id: number } = { id: number }>(
  initial: Array<T> = [],
) {
  const collection = createCollection(
    mockSyncCollectionOptionsNoInitialState<T>({
      id: `paced-oracle`,
      getKey: (item) => item.id,
    }),
  )
  const preload = collection.preload()
  collection.utils.begin()
  for (const row of initial)
    collection.utils.write({ type: `insert`, value: row })
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
    name: `explicit non-leading debounce defaults to trailing persistence`,
    actions: debounceActions,
    expected: debounceStarts(debounceActions, 10),
    sameTransaction: [[1, 2, 3], [4]],
    strategy: () => debounceStrategy({ wait: 10, leading: false }),
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
  {
    name: `explicit non-leading throttle defaults to trailing persistence`,
    actions: nonLeadingThrottleActions,
    expected: nonLeadingThrottleStarts(nonLeadingThrottleActions, 10),
    sameTransaction: [[1, 2], [3]],
    strategy: () => throttleStrategy({ wait: 10, leading: false }),
  },
]

describe(`paced mutation timeline oracle`, () => {
  it(`drains admitted queue writes after Collection cleanup`, async () => {
    const collection = await createReadyCollection()
    const strategy = queueStrategy({ wait: 10 })
    const starts: Array<number> = []
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: ({ transaction }) => {
        const id = transaction.mutations[0].changes.id
        if (typeof id !== `number`) throw new Error(`Missing mutation ID`)
        starts.push(id)
        return Promise.resolve()
      },
      strategy,
    })
    const first = mutate(1)
    const second = mutate(2)
    const firstReceipt = observeReceipt(first)
    const secondReceipt = observeReceipt(second)
    strategy.cleanup()
    await collection.cleanup()
    expect(starts).toEqual([1])
    await vi.advanceTimersByTimeAsync(0)
    expect(starts).toEqual([1])
    await vi.advanceTimersByTimeAsync(10)
    expect(starts).toEqual([1, 2])
    expect([firstReceipt.outcome, secondReceipt.outcome]).toEqual([
      `fulfilled`,
      `fulfilled`,
    ])
  })

  it(`rejects a mutation after queue cleanup with a disposal reason`, async () => {
    const collection = await createReadyCollection()
    const strategy = queueStrategy({ wait: 10 })
    let starts = 0
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: () => {
        starts++
        return Promise.resolve()
      },
      strategy,
    })
    await withCleanup(strategy, collection, async () => {
      const admitted = mutate(1)
      const admittedReceipt = observeReceipt(admitted)
      strategy.cleanup()
      const transaction = mutate(2)
      const receipt = observeReceipt(transaction)
      expect(collection.get(1)?.id).toBe(1)
      expect(collection.get(2)).toBeUndefined()
      await vi.advanceTimersByTimeAsync(20)
      expect(starts).toBe(1)
      expect(admittedReceipt).toMatchObject({
        outcome: `fulfilled`,
        returnedSame: true,
      })
      expect(transaction.state).toBe(`failed`)
      expect(collection.get(2)).toBeUndefined()
      expect(receipt).toMatchObject({
        outcome: `rejected`,
        error: { name: `QueueDisposedError` },
      })
    })
  })

  for (const leading of [true, undefined] as const) {
    it(`drops a within-window throttle call when trailing is false and leading is ${String(leading)}`, async () => {
      const collection = await createReadyCollection()
      const strategy = throttleStrategy({ wait: 10, leading, trailing: false })
      const starts: Array<Start> = []
      const mutate = createPacedMutations<number, { id: number }>({
        onMutate: (id) => collection.insert({ id }),
        mutationFn: ({ transaction }) => {
          const id = transaction.mutations[0].changes.id
          if (typeof id !== `number`) throw new Error(`Missing mutation ID`)
          starts.push({ at: Date.now() - origin, ids: [id] })
          return Promise.resolve()
        },
        strategy,
      })
      await withCleanup(strategy, collection, async () => {
        const first = mutate(1)
        const firstReceipt = observeReceipt(first)
        await vi.advanceTimersByTimeAsync(4)
        expect(starts).toEqual([{ at: 0, ids: [1] }])
        expect(firstReceipt).toMatchObject({
          outcome: `fulfilled`,
          returnedSame: true,
        })

        const dropped = mutate(2)
        const droppedReceipt = observeReceipt(dropped)
        await vi.advanceTimersByTimeAsync(0)
        expect(starts).toEqual([{ at: 0, ids: [1] }])
        expect(dropped.state).toBe(`failed`)
        expect(collection.get(2)).toBeUndefined()
        expect(droppedReceipt).toMatchObject({
          outcome: `rejected`,
          error: { name: `ThrottleCallDroppedError` },
        })

        await vi.advanceTimersByTimeAsync(10)
        const next = mutate(3)
        const nextReceipt = observeReceipt(next)
        await vi.advanceTimersByTimeAsync(0)
        expect(starts).toEqual([
          { at: 0, ids: [1] },
          { at: 14, ids: [3] },
        ])
        expect(nextReceipt).toMatchObject({
          outcome: `fulfilled`,
          returnedSame: true,
        })
      })
    })
  }

  it(`rejects every optimistic call when both throttle edges are disabled`, async () => {
    const collection = await createReadyCollection()
    const strategy = throttleStrategy({
      wait: 10,
      leading: false,
      trailing: false,
    })
    let starts = 0
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: () => {
        starts++
        return Promise.resolve()
      },
      strategy,
    })
    await withCleanup(strategy, collection, async () => {
      for (const id of [1, 2]) {
        const transaction = mutate(id)
        const receipt = observeReceipt(transaction)
        await vi.advanceTimersByTimeAsync(10)
        expect(transaction.state).toBe(`failed`)
        expect(collection.get(id)).toBeUndefined()
        expect(receipt).toMatchObject({
          outcome: `rejected`,
          error: { name: `ThrottleCallDroppedError` },
        })
      }
      expect(starts).toBe(0)
    })
  })

  for (const { name, strategyFactory, errorName } of [
    {
      name: `throttle`,
      strategyFactory: () =>
        throttleStrategy({ wait: 10, leading: true, trailing: false }),
      errorName: `ThrottleCallDroppedError`,
    },
    {
      name: `debounce`,
      strategyFactory: () =>
        debounceStrategy({ wait: 10, leading: true, trailing: false }),
      errorName: `DebounceCallDroppedError`,
    },
  ]) {
    it(`a dropped ${name} update preserves the prior same-row write`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptionsNoInitialState<{ id: number; value: number }>({
          id: `paced-${name}-same-row`,
          getKey: (item) => item.id,
        }),
      )
      const preload = collection.preload()
      collection.utils.begin()
      collection.utils.commit()
      collection.utils.markReady()
      await preload
      const strategy = strategyFactory()
      const starts: Array<number> = []
      let releaseFirst: (() => void) | undefined
      const mutate = createPacedMutations<
        number,
        { id: number; value: number }
      >({
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
          starts.push(value)
          if (value === 1)
            return new Promise<void>((resolve) => {
              releaseFirst = resolve
            })
          return Promise.resolve()
        },
        strategy,
      })
      await withCleanup(
        strategy,
        collection,
        async () => {
          const first = mutate(1)
          const firstReceipt = observeReceipt(first)
          await vi.advanceTimersByTimeAsync(4)
          expect(first.state).toBe(`persisting`)
          const dropped = mutate(2)
          const droppedReceipt = observeReceipt(dropped)
          await vi.advanceTimersByTimeAsync(0)
          expect(droppedReceipt).toMatchObject({
            outcome: `rejected`,
            error: { name: errorName },
          })
          expect(collection.get(1)?.value).toBe(1)
          releaseFirst?.()
          await vi.advanceTimersByTimeAsync(0)
          expect(starts).toEqual([1])
          expect(firstReceipt).toMatchObject({
            outcome: `fulfilled`,
            returnedSame: true,
          })
        },
        async () => {
          releaseFirst?.()
          await vi.advanceTimersByTimeAsync(0)
        },
      )
    })
  }

  it(`drains an admitted trailing throttle write after cleanup at its regular edge`, async () => {
    const collection = await createReadyCollection()
    const strategy = throttleStrategy({
      wait: 10,
      leading: false,
      trailing: true,
    })
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
      expect(collection.get(1)?.id).toBe(1)
      await vi.advanceTimersByTimeAsync(4)
      strategy.cleanup()
      await collection.cleanup()
      await vi.advanceTimersByTimeAsync(5)
      expect(starts).toEqual([])
      expect(transaction.state).toBe(`pending`)
      expect(receipt.outcome).toBe(`pending`)
      await vi.advanceTimersByTimeAsync(1)
      expect(starts).toEqual([10])
      expect(transaction.state).toBe(`completed`)
      expect(receipt).toMatchObject({
        outcome: `fulfilled`,
        returnedSame: true,
      })
    })
  })

  it(`drains a pending debounce write after cleanup at its quiet edge`, async () => {
    const collection = await createReadyCollection()
    const strategy = debounceStrategy({ wait: 10 })
    const starts: Array<Start> = []
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
    await withCleanup(strategy, collection, async () => {
      const transaction = mutate(1)
      const receipt = observeReceipt(transaction)
      expect(collection.get(1)?.id).toBe(1)
      await vi.advanceTimersByTimeAsync(4)
      expect(mutate(2)).toBe(transaction)
      expect(collection.get(2)?.id).toBe(2)
      await vi.advanceTimersByTimeAsync(4)
      strategy.cleanup()
      await collection.cleanup()
      await vi.advanceTimersByTimeAsync(5)
      expect(starts).toEqual([])
      expect(transaction.state).toBe(`pending`)
      expect(receipt.outcome).toBe(`pending`)
      await vi.advanceTimersByTimeAsync(1)
      expect(starts).toEqual([{ at: 14, ids: [1, 2] }])
      expect(transaction.state).toBe(`completed`)
      expect(receipt).toMatchObject({
        outcome: `fulfilled`,
        returnedSame: true,
      })
    })
  })

  it(`drains a second leading debounce transaction when trailing is omitted`, async () => {
    const collection = await createReadyCollection()
    const strategy = debounceStrategy({ wait: 10, leading: true })
    const starts: Array<Start> = []
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
    await withCleanup(strategy, collection, async () => {
      const first = mutate(1)
      const firstReceipt = observeReceipt(first)
      await vi.advanceTimersByTimeAsync(4)
      expect(starts).toEqual([{ at: 0, ids: [1] }])
      expect(firstReceipt.outcome).toBe(`fulfilled`)
      const second = mutate(2)
      const secondReceipt = observeReceipt(second)
      expect(collection.get(2)?.id).toBe(2)
      await vi.advanceTimersByTimeAsync(4)
      strategy.cleanup()
      await collection.cleanup()
      await vi.advanceTimersByTimeAsync(5)
      expect(starts).toEqual([{ at: 0, ids: [1] }])
      expect(second.state).toBe(`pending`)
      expect(secondReceipt.outcome).toBe(`pending`)
      await vi.advanceTimersByTimeAsync(1)
      expect(starts).toEqual([
        { at: 0, ids: [1] },
        { at: 14, ids: [2] },
      ])
      expect(secondReceipt).toMatchObject({
        outcome: `fulfilled`,
        returnedSame: true,
      })
    })
  })

  it(`rejects a debounce call dropped inside a leading-only window`, async () => {
    const collection = await createReadyCollection()
    const strategy = debounceStrategy({
      wait: 10,
      leading: true,
      trailing: false,
    })
    const starts: Array<number> = []
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: ({ transaction }) => {
        const id = transaction.mutations[0].changes.id
        if (typeof id !== `number`) throw new Error(`Missing mutation ID`)
        starts.push(id)
        return Promise.resolve()
      },
      strategy,
    })
    await withCleanup(strategy, collection, async () => {
      const first = mutate(1)
      const firstReceipt = observeReceipt(first)
      await vi.advanceTimersByTimeAsync(4)
      expect(starts).toEqual([1])
      expect(firstReceipt.outcome).toBe(`fulfilled`)
      const dropped = mutate(2)
      const droppedReceipt = observeReceipt(dropped)
      await vi.advanceTimersByTimeAsync(0)
      expect(dropped.state).toBe(`failed`)
      expect(collection.get(2)).toBeUndefined()
      expect(droppedReceipt).toMatchObject({
        outcome: `rejected`,
        error: { name: `DebounceCallDroppedError` },
      })
      await vi.advanceTimersByTimeAsync(10)
      const next = mutate(3)
      const nextReceipt = observeReceipt(next)
      await vi.advanceTimersByTimeAsync(0)
      expect(starts).toEqual([1, 3])
      expect(nextReceipt).toMatchObject({
        outcome: `fulfilled`,
        returnedSame: true,
      })
    })
  })

  for (const leading of [false, undefined] as const) {
    it(`rejects debounce calls when both edges are disabled and leading is ${String(leading)}`, async () => {
      const collection = await createReadyCollection()
      const strategy = debounceStrategy({ wait: 10, leading, trailing: false })
      let starts = 0
      const mutate = createPacedMutations<number, { id: number }>({
        onMutate: (id) => collection.insert({ id }),
        mutationFn: () => {
          starts++
          return Promise.resolve()
        },
        strategy,
      })
      await withCleanup(strategy, collection, async () => {
        for (const id of [1, 2]) {
          const transaction = mutate(id)
          const receipt = observeReceipt(transaction)
          await vi.advanceTimersByTimeAsync(10)
          expect(transaction.state).toBe(`failed`)
          expect(collection.get(id)).toBeUndefined()
          expect(receipt).toMatchObject({
            outcome: `rejected`,
            error: { name: `DebounceCallDroppedError` },
          })
        }
        expect(starts).toBe(0)
      })
    })
  }

  for (const trailing of [true, false] as const) {
    it(`starts the first leading throttle call at epoch zero with trailing ${String(trailing)}`, async () => {
      vi.setSystemTime(0)
      const collection = await createReadyCollection()
      const strategy = throttleStrategy({ wait: 10, leading: true, trailing })
      const starts: Array<number> = []
      const mutate = createPacedMutations<number, { id: number }>({
        onMutate: (id) => collection.insert({ id }),
        mutationFn: () => {
          starts.push(Date.now())
          return Promise.resolve()
        },
        strategy,
      })
      await withCleanup(strategy, collection, async () => {
        const transaction = mutate(1)
        const receipt = observeReceipt(transaction)
        await vi.advanceTimersByTimeAsync(0)
        expect(starts).toEqual([0])
        expect(receipt).toMatchObject({
          outcome: `fulfilled`,
          returnedSame: true,
        })
      })
    })
  }

  it(`keeps queue wait spacing while draining after cleanup`, async () => {
    const collection = await createReadyCollection()
    const strategy = queueStrategy({ wait: 10 })
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
      const first = mutate(1)
      const second = mutate(2)
      const firstReceipt = observeReceipt(first)
      const secondReceipt = observeReceipt(second)
      strategy.cleanup()
      strategy.cleanup()
      await vi.advanceTimersByTimeAsync(0)
      expect(starts, `starts before wait`).toEqual([0])
      expect(second.state).toBe(`pending`)
      expect(secondReceipt.outcome).toBe(`pending`)
      expect(collection.get(2)?.id).toBe(2)
      await vi.advanceTimersByTimeAsync(10)
      expect(starts).toEqual([0, 10])
      expect([first.state, second.state]).toEqual([`completed`, `completed`])
      expect([firstReceipt.outcome, secondReceipt.outcome]).toEqual([
        `fulfilled`,
        `fulfilled`,
      ])
    })
  })

  for (const getItemsFrom of [`front`, `back`] as const) {
    it(`drains admitted queue work in ${getItemsFrom} order after cleanup`, async () => {
      const collection = await createReadyCollection()
      const strategy = queueStrategy({ wait: 10, getItemsFrom })
      const started: Array<number> = []
      let releaseFirst: (() => void) | undefined
      const mutate = createPacedMutations<number, { id: number }>({
        onMutate: (id) => collection.insert({ id }),
        mutationFn: ({ transaction }) => {
          const id = transaction.mutations[0].changes.id
          if (typeof id !== `number`) throw new Error(`Missing mutation ID`)
          started.push(id)
          if (id === 1) {
            return new Promise<void>((resolve) => {
              releaseFirst = resolve
            })
          }
          return Promise.resolve()
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
          const firstReceipt = observeReceipt(first)
          const secondReceipt = observeReceipt(second)
          const thirdReceipt = observeReceipt(third)
          await vi.advanceTimersByTimeAsync(0)
          expect(started).toEqual([1])
          strategy.cleanup()
          strategy.cleanup()
          await vi.advanceTimersByTimeAsync(20)
          expect(started).toEqual([1])
          expect(second.state).toBe(`pending`)
          expect(collection.get(2)?.id).toBe(2)
          expect(collection.get(3)?.id).toBe(3)

          releaseFirst?.()
          await vi.advanceTimersByTimeAsync(0)
          expect(started, `admitted work after cleanup`).toEqual(
            getItemsFrom === `front` ? [1, 2, 3] : [1, 3, 2],
          )
          expect([first.state, second.state, third.state]).toEqual([
            `completed`,
            `completed`,
            `completed`,
          ])
          expect([
            firstReceipt.outcome,
            secondReceipt.outcome,
            thirdReceipt.outcome,
          ]).toEqual([`fulfilled`, `fulfilled`, `fulfilled`])
          await vi.advanceTimersByTimeAsync(10)
          expect(started, `no write after drain`).toEqual(
            getItemsFrom === `front` ? [1, 2, 3] : [1, 3, 2],
          )

          expect(() =>
            strategy.execute(() => {
              throw new Error(`Disposed queue ran a new callback`)
            }),
          ).toThrowError(`Queue has been cleaned up`)
        },
        async () => {
          releaseFirst?.()
          await vi.advanceTimersByTimeAsync(0)
        },
      )
    })
  }

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

  it(`keeps a false-returning custom batch transaction pending until its callback`, async () => {
    const collection = await createReadyCollection()
    let timer: ReturnType<typeof setTimeout> | undefined
    const strategy: Strategy = {
      _type: `batch`,
      execute: (fn) => {
        timer = setTimeout(() => fn(), 10)
        return false
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
      expect(transaction.state, `custom batch admission`).toBe(`pending`)
      expect(collection.get(1)?.id).toBe(1)
      await vi.advanceTimersByTimeAsync(10)
      expect(starts).toEqual([10])
      expect(receipt).toMatchObject({
        outcome: `fulfilled`,
        returnedSame: true,
      })
    })
  })

  it(`uses captured debounce options when reporting a dropped call`, async () => {
    const collection = await createReadyCollection()
    const options = { wait: 10, leading: true, trailing: false }
    const strategy = debounceStrategy(options)
    const starts: Array<number> = []
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: ({ transaction }) => {
        const id = transaction.mutations[0].changes.id
        if (typeof id !== `number`) throw new Error(`Missing mutation ID`)
        starts.push(id)
        return Promise.resolve()
      },
      strategy,
    })

    await withCleanup(strategy, collection, async () => {
      const first = mutate(1)
      const firstReceipt = observeReceipt(first)
      await vi.advanceTimersByTimeAsync(4)
      expect(firstReceipt.outcome).toBe(`fulfilled`)
      options.trailing = true
      const dropped = mutate(2)
      const droppedReceipt = observeReceipt(dropped)
      await vi.advanceTimersByTimeAsync(0)
      expect(dropped.state).toBe(`failed`)
      expect(collection.get(2)).toBeUndefined()
      expect(droppedReceipt).toMatchObject({
        outcome: `rejected`,
        error: { name: `DebounceCallDroppedError` },
      })
      await vi.advanceTimersByTimeAsync(10)
      expect(starts).toEqual([1])
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

/**
 * Debounce/throttle promise one pending and one persisting transaction in
 * docs/guides/mutations.md, "Key Design". Timer eligibility alone cannot start
 * a second write. Successful settlement must release admitted work, preserving
 * its optimistic rows and returned receipt until its own write settles.
 *
 * This bounded extension crosses both strategies, leading/non-leading/default
 * admission, and release one tick before, at, one tick after, or ten ticks after
 * the second edge. It controls mutationFn promises through the real manager.
 * It does not model server ordering, rejected writes, cleanup during a hold,
 * same-key rebasing, or arbitrary call bursts. Later tests challenge bursts.
 */
type HeldPacingCase = {
  kind: `debounce` | `throttle`
  leading: boolean | undefined
  trailing: true | undefined
  releaseOffset: number
}

// A two-call schedule needs only two independent prerequisites for its second
// start: the documented time edge and the first write's release. Their maximum
// is the earliest lawful start; it does not reproduce a production scheduler.
// Immediate handoff at that time is the repair policy evaluated here. The guide
// specifies serialization, not an explicit upper latency bound. Original-code
// REDs start before this lower bound and do not depend on that proposed policy.
// `releaseAt` is handler settlement, not Collection publication or server sync.
function heldPacingTimes({
  kind,
  leading,
  trailing,
  releaseOffset,
}: HeldPacingCase) {
  const startsLeading = leading ?? (kind === `throttle` && trailing !== true)
  const firstAt = startsLeading ? 0 : 10
  const secondCallAt = firstAt + 1
  const eligibleAt =
    kind === `throttle` && startsLeading ? firstAt + 10 : secondCallAt + 10
  const releaseAt = eligibleAt + releaseOffset
  return {
    firstAt,
    secondCallAt,
    eligibleAt,
    releaseAt,
    secondAt: Math.max(eligibleAt, releaseAt),
  }
}

async function checkHeldPacing(testCase: HeldPacingCase): Promise<void> {
  const times = heldPacingTimes(testCase)
  const collection = await createReadyCollection()
  const factory =
    testCase.kind === `debounce` ? debounceStrategy : throttleStrategy
  const strategy = factory({
    wait: 10,
    leading: testCase.leading,
    trailing: testCase.trailing,
  })
  const starts: Array<Start> = []
  const releases = new Map<number, () => void>()
  const active = new Set<number>()
  const concurrency: Array<number> = []
  const transactions: Array<Transaction<{ id: number }>> = []
  const receipts: Array<ReturnType<typeof observeReceipt>> = []
  let draining = false
  const mutate = createPacedMutations<number, { id: number }>({
    strategy,
    onMutate: (id) => collection.insert({ id }),
    mutationFn: async ({ transaction }) => {
      const ids = transaction.mutations.map((mutation) => mutation.modified.id)
      starts.push({ at: Date.now() - origin, ids })
      const id = transaction.mutations[0].modified.id
      active.add(id)
      concurrency.push(active.size)
      if (!draining)
        await new Promise<void>((resolve) => releases.set(id, resolve))
      active.delete(id)
    },
  })

  // At each named cut, compare calls, states, receipts, and the complete public
  // snapshot. The source never echoes successful writes, so settled optimistic
  // inserts disappear. The successor must remain visible until its own release.
  const check = (
    label: string,
    firstReleased: boolean,
    secondReleased = false,
  ) => {
    const now = Date.now() - origin
    const expectedStarts = [{ at: times.firstAt, ids: [1] }]
    if (now >= times.secondAt && firstReleased)
      expectedStarts.push({ at: times.secondAt, ids: [2] })
    expect(concurrency, `${label}: single persistence`).toEqual(
      expectedStarts.map(() => 1),
    )
    expect(starts, `${label}: execution trace`).toEqual(expectedStarts)
    expect(
      transactions.map((tx) => tx.state),
      `${label}: transaction states`,
    ).toEqual([
      firstReleased ? `completed` : `persisting`,
      secondReleased
        ? `completed`
        : expectedStarts.length === 2
          ? `persisting`
          : `pending`,
    ])
    expect(
      receipts.map((receipt) => receipt.outcome),
      `${label}: receipt settlement`,
    ).toEqual([
      firstReleased ? `fulfilled` : `pending`,
      secondReleased ? `fulfilled` : `pending`,
    ])
    for (const receipt of receipts)
      if (receipt.outcome === `fulfilled`)
        expect(receipt.returnedSame, label).toBe(true)
    expect([...collection.keys()].sort(), `${label}: optimistic rows`).toEqual([
      ...(firstReleased ? [] : [1]),
      ...(secondReleased ? [] : [2]),
    ])
  }

  await withCleanup(
    strategy,
    collection,
    async () => {
      const first = mutate(1)
      transactions.push(first)
      receipts.push(observeReceipt(first))
      expect(collection.get(1)?.id, `first admission optimism`).toBe(1)
      await vi.advanceTimersByTimeAsync(times.secondCallAt)
      const second = mutate(2)
      transactions.push(second)
      receipts.push(observeReceipt(second))
      expect(transactions[1], `separate pending transaction`).not.toBe(
        transactions[0],
      )
      check(`second admission`, false)
      await vi.advanceTimersByTimeAsync(
        times.eligibleAt - 1 - times.secondCallAt,
      )
      check(`before timer edge`, false)

      // Release-before and release-after are neighboring histories: a lock that
      // forgets timer eligibility fails one, and a timer-only design fails the other.
      if (times.releaseAt < times.eligibleAt) {
        releases.get(1)!()
        await vi.advanceTimersByTimeAsync(0)
        check(`release before edge`, true)
        await vi.advanceTimersByTimeAsync(1)
      } else {
        await vi.advanceTimersByTimeAsync(1)
        check(`timer edge while held`, false)
        await vi.advanceTimersByTimeAsync(times.releaseAt - times.eligibleAt)
        check(`before release`, false)
        releases.get(1)!()
        await vi.advanceTimersByTimeAsync(0)
      }
      check(`after first release and eligibility`, true)
      releases.get(2)!()
      await vi.advanceTimersByTimeAsync(0)
      check(`after second release`, true, true)
      await vi.advanceTimersByTimeAsync(20)
      check(`after drain`, true, true)
    },
    async () => {
      draining = true
      for (const release of releases.values()) release()
      await vi.advanceTimersByTimeAsync(40)
      // A failed assertion may leave intentionally held work. Release it without
      // waiting indefinitely if the wrong design never invokes its callback.
      for (const transaction of transactions)
        if (
          transaction.state === `pending` ||
          transaction.state === `persisting`
        )
          transaction.rollback({ isSecondaryRollback: true })
      await vi.advanceTimersByTimeAsync(0)
    },
  )
}

describe(`paced persistence hold/release oracle`, () => {
  for (const kind of [`debounce`, `throttle`] as const)
    for (const leading of [true, false, undefined])
      for (const trailing of [true, undefined] as const)
        for (const releaseOffset of [-1, 0, 1, 10])
          it(`${kind} leading ${String(leading)} trailing ${String(trailing)} release offset ${releaseOffset} preserves serial persistence and settlement`, async () => {
            await checkHeldPacing({ kind, leading, trailing, releaseOffset })
          })
})

// Serialization must compose with timing rather than replace it. A delayed
// throttle start moves its next spacing boundary. A new debounce call moves
// the quiet boundary even if an earlier edge became eligible during the hold.
// These three-call histories distinguish a bare manager lock from that law.
describe(`paced persistence timing after a hold`, () => {
  for (const kind of [`debounce`, `throttle`] as const) {
    it(`${kind} preserves its next time boundary around a delayed write`, async () => {
      const collection = await createReadyCollection()
      const strategy =
        kind === `debounce`
          ? debounceStrategy({ wait: 10, leading: false, trailing: true })
          : throttleStrategy({ wait: 10, leading: true, trailing: true })
      const starts: Array<Start> = []
      let releaseFirst: (() => void) | undefined
      const receipts: Array<ReturnType<typeof observeReceipt>> = []
      const mutate = createPacedMutations<number, { id: number }>({
        strategy,
        onMutate: (id) => collection.insert({ id }),
        mutationFn: ({ transaction }) => {
          const ids = transaction.mutations.map(
            (mutation) => mutation.modified.id,
          )
          starts.push({ at: Date.now() - origin, ids })
          return ids[0] === 1
            ? new Promise<void>((resolve) => {
                releaseFirst = resolve
              })
            : Promise.resolve()
        },
      })
      await withCleanup(
        strategy,
        collection,
        async () => {
          const first = mutate(1)
          receipts.push(observeReceipt(first))
          await vi.advanceTimersByTimeAsync(kind === `debounce` ? 11 : 1)
          const second = mutate(2)
          receipts.push(observeReceipt(second))
          if (kind === `debounce`) {
            await vi.advanceTimersByTimeAsync(11)
            // t22: a new call invalidates the old t21 quiet edge; now due at t32.
            const third = mutate(3)
            receipts.push(observeReceipt(third))
            expect(third, `one pending transaction while held`).toBe(second)
            await vi.advanceTimersByTimeAsync(1)
            releaseFirst!()
            await vi.advanceTimersByTimeAsync(0)
            expect(starts, `release before renewed quiet edge`).toEqual([
              { at: 10, ids: [1] },
            ])
            expect(second.state).toBe(`pending`)
            expect([...collection.keys()].sort()).toEqual([2, 3])
            await vi.advanceTimersByTimeAsync(8)
            expect(starts, `one tick before renewed quiet edge`).toEqual([
              { at: 10, ids: [1] },
            ])
            await vi.advanceTimersByTimeAsync(1)
            expect(starts, `renewed quiet edge`).toEqual([
              { at: 10, ids: [1] },
              { at: 32, ids: [2, 3] },
            ])
          } else {
            await vi.advanceTimersByTimeAsync(14)
            // t15: actual execution, rather than the blocked t10 appointment,
            // starts the documented ten-tick minimum spacing for the next write.
            releaseFirst!()
            await vi.advanceTimersByTimeAsync(0)
            expect(starts, `delayed second write`).toEqual([
              { at: 0, ids: [1] },
              { at: 15, ids: [2] },
            ])
            await vi.advanceTimersByTimeAsync(1)
            const third = mutate(3)
            receipts.push(observeReceipt(third))
            expect(collection.get(3)?.id).toBe(3)
            await vi.advanceTimersByTimeAsync(8)
            expect(starts, `one tick before actual-start spacing`).toHaveLength(
              2,
            )
            expect(third.state).toBe(`pending`)
            await vi.advanceTimersByTimeAsync(1)
            expect(starts, `actual-start spacing edge`).toEqual([
              { at: 0, ids: [1] },
              { at: 15, ids: [2] },
              { at: 25, ids: [3] },
            ])
          }
          expect(
            receipts.map((receipt) => receipt.outcome),
            `all admitted callers settle`,
          ).toEqual([`fulfilled`, `fulfilled`, `fulfilled`])
          expect(receipts.every((receipt) => receipt.returnedSame)).toBe(true)
          await vi.advanceTimersByTimeAsync(20)
          expect(starts, `no duplicate callback after drain`).toHaveLength(
            kind === `debounce` ? 2 : 3,
          )
        },
        async () => {
          releaseFirst?.()
          await vi.advanceTimersByTimeAsync(40)
        },
      )
    })
  }
})

// A leading-only timer may admit work after its old window while persistence
// is still held. A later within-window dropped call must reject only itself,
// as the existing dropped-call contract requires. Serializing writes exposes
// this admission boundary because the admitted transaction stays pending.
describe(`paced pending admission isolation`, () => {
  for (const factory of [debounceStrategy, throttleStrategy])
    it(`${factory.name} rejects only the skipped call while an admitted successor waits`, async () => {
      const collection = await createReadyCollection()
      const strategy = factory({
        wait: 10,
        leading: true,
        trailing: false,
      })
      const starts: Array<number> = []
      let releaseFirst: (() => void) | undefined
      const mutate = createPacedMutations<number, { id: number }>({
        strategy,
        onMutate: (id) => collection.insert({ id }),
        mutationFn: ({ transaction }) => {
          const id = transaction.mutations[0].modified.id
          starts.push(id)
          return id === 1
            ? new Promise<void>((resolve) => {
                releaseFirst = resolve
              })
            : Promise.resolve()
        },
      })
      await withCleanup(
        strategy,
        collection,
        async () => {
          const first = mutate(1)
          const firstReceipt = observeReceipt(first)
          await vi.advanceTimersByTimeAsync(11)
          const admitted = mutate(2)
          const admittedReceipt = observeReceipt(admitted)
          await vi.advanceTimersByTimeAsync(1)
          const dropped = mutate(3)
          const droppedReceipt = observeReceipt(dropped)
          await vi.advanceTimersByTimeAsync(0)
          expect(
            dropped,
            `dropped call cannot own the admitted receipt`,
          ).not.toBe(admitted)
          expect(
            droppedReceipt,
            `within-window admission rejection`,
          ).toMatchObject({
            outcome: `rejected`,
            error: {
              name:
                factory === debounceStrategy
                  ? `DebounceCallDroppedError`
                  : `ThrottleCallDroppedError`,
            },
          })
          expect(admittedReceipt.outcome, `admitted receipt retained`).toBe(
            `pending`,
          )
          expect(admitted.state, `admitted successor waits`).toBe(`pending`)
          expect(
            [...collection.keys()].sort(),
            `only skipped optimism removed`,
          ).toEqual([1, 2])
          expect(starts, `one persisting transaction`).toEqual([1])
          releaseFirst!()
          await vi.advanceTimersByTimeAsync(0)
          expect(starts, `admitted successor drains`).toEqual([1, 2])
          expect([firstReceipt.outcome, admittedReceipt.outcome]).toEqual([
            `fulfilled`,
            `fulfilled`,
          ])
        },
        async () => {
          releaseFirst?.()
          await vi.advanceTimersByTimeAsync(30)
        },
      )
    })
})

/**
 * Settlement keeps the ordinary Transaction rollback contract. A failed prior
 * write rolls back pending same-key work; distinct-key work can still persist.
 * An explicitly rolled-back pending transaction never calls mutationFn. These
 * laws come from Transaction.rollback and the optimistic-history owner; pacing
 * must not revive canceled work or strand an independent admitted successor.
 *
 * This grammar crosses both factories, leading/non-leading, same/distinct key,
 * and first success/rejection or pending rollback. The model uses the authored
 * key relationship and outcome, never production's conflict classifier.
 */
describe(`paced settlement and pending ownership oracle`, () => {
  for (const factory of [debounceStrategy, throttleStrategy])
    for (const leading of [true, false])
      for (const sameKey of [true, false])
        for (const outcome of [`resolve`, `reject`, `cancel-pending`] as const)
          it(`${factory.name} leading ${leading} same key ${sameKey} with ${outcome} preserves transaction settlement`, async () => {
            const collection = await createReadyCollection([
              { id: 1, value: 0 },
              { id: 2, value: 0 },
            ])
            const strategy = factory({ wait: 10, leading, trailing: true })
            const firstWrite = createDeferred<void>()
            const secondWrite = createDeferred<void>()
            const failure = new Error(`controlled persistence failure`)
            const canceled = new Error(`pending transaction canceled`)
            const starts: Array<number> = []
            const mutate = createPacedMutations<
              { id: number; value: number },
              { id: number; value: number }
            >({
              strategy,
              onMutate: ({ id, value }) =>
                collection.update(id, (draft) => {
                  draft.value = value
                }),
              mutationFn: ({ transaction }) => {
                const value = transaction.mutations[0].modified.value
                starts.push(value)
                return value === 1 ? firstWrite.promise : secondWrite.promise
              },
            })
            await withCleanup(
              strategy,
              collection,
              async () => {
                const first = mutate({ id: 1, value: 1 })
                const firstReceipt = observeReceipt(first)
                await vi.advanceTimersByTimeAsync(leading ? 1 : 11)
                const key = sameKey ? 1 : 2
                const second = mutate({ id: key, value: 2 })
                const secondReceipt = observeReceipt(second)
                if (outcome === `cancel-pending`)
                  second.rollback({
                    error: canceled,
                    isSecondaryRollback: true,
                  })
                await vi.advanceTimersByTimeAsync(30)
                expect(starts, `held first write`).toEqual([1])
                expect(firstReceipt.outcome).toBe(`pending`)
                expect(
                  secondReceipt.outcome,
                  `pending admission or explicit cancellation`,
                ).toBe(outcome === `cancel-pending` ? `rejected` : `pending`)
                expect(
                  collection.get(key)?.value,
                  `optimistic successor while held`,
                ).toBe(outcome === `cancel-pending` ? (sameKey ? 1 : 0) : 2)
                if (outcome === `reject`) firstWrite.reject(failure)
                else firstWrite.resolve()
                await vi.advanceTimersByTimeAsync(0)
                const successorCanceled =
                  outcome === `cancel-pending` ||
                  (outcome === `reject` && sameKey)
                expect(starts, `only uncanceled successor persists`).toEqual(
                  successorCanceled ? [1] : [1, 2],
                )
                expect(firstReceipt.outcome).toBe(
                  outcome === `reject` ? `rejected` : `fulfilled`,
                )
                if (outcome === `reject`)
                  expect(firstReceipt.error).toBe(failure)
                expect(second.state).toBe(
                  successorCanceled ? `failed` : `persisting`,
                )
                expect(secondReceipt.outcome).toBe(
                  successorCanceled ? `rejected` : `pending`,
                )
                expect(
                  collection.get(key)?.value,
                  `successor after first settlement`,
                ).toBe(successorCanceled ? 0 : 2)
                if (outcome === `cancel-pending`)
                  expect(secondReceipt.error).toBe(canceled)
                secondWrite.resolve()
                await vi.advanceTimersByTimeAsync(20)
                expect(
                  secondReceipt.outcome,
                  `terminal successor receipt`,
                ).toBe(successorCanceled ? `rejected` : `fulfilled`)
                if (!successorCanceled)
                  expect(secondReceipt.returnedSame).toBe(true)
                expect(
                  [...collection.values()].map(({ id, value }) => ({
                    id,
                    value,
                  })),
                ).toEqual([
                  { id: 1, value: 0 },
                  { id: 2, value: 0 },
                ])
                const next = mutate({ id: 2, value: 3 })
                const nextReceipt = observeReceipt(next)
                await vi.advanceTimersByTimeAsync(20)
                expect(
                  starts,
                  `manager remains usable after settlement`,
                ).toEqual(successorCanceled ? [1, 3] : [1, 2, 3])
                expect(nextReceipt).toMatchObject({
                  outcome: `fulfilled`,
                  returnedSame: true,
                })
              },
              async () => {
                firstWrite.resolve()
                secondWrite.resolve()
                await vi.advanceTimersByTimeAsync(50)
              },
            )
          })
})

/**
 * A manual rollback settles the public receipt before the held mutation
 * handler has returned. It cannot cancel an already-started backend write.
 * The one-writing-at-a-time promise therefore waits for the old handler's
 * actual completion before starting a distinct-key successor. This three-path
 * grammar covers debounce, throttle, and queue. The model's active-handler
 * count stays one until the first controlled promise resolves; the driver
 * observes that count, receipts, and optimism at rollback and handler release.
 */
describe(`paced persistence after manual rollback`, () => {
  for (const [name, createStrategy] of [
    [
      `debounce`,
      () => debounceStrategy({ wait: 10, leading: true, trailing: true }),
    ],
    [
      `throttle`,
      () => throttleStrategy({ wait: 10, leading: true, trailing: true }),
    ],
    [`queue`, () => queueStrategy({ wait: 10 })],
  ] as const)
    it(`${name} waits for the rolled-back handler to finish before starting another`, async () => {
      const collection = await createReadyCollection()
      const strategy = createStrategy()
      const firstWrite = createDeferred<void>()
      const secondWrite = createDeferred<void>()
      const canceled = new Error(`manual rollback`)
      const starts: Array<number> = []
      const active = new Set<number>()
      const concurrency: Array<number> = []
      const mutate = createPacedMutations<number, { id: number }>({
        strategy,
        onMutate: (id) => collection.insert({ id }),
        mutationFn: async ({ transaction }) => {
          const id = transaction.mutations[0].modified.id
          starts.push(id)
          active.add(id)
          concurrency.push(active.size)
          await (id === 1 ? firstWrite.promise : secondWrite.promise)
          active.delete(id)
        },
      })
      await withCleanup(
        strategy,
        collection,
        async () => {
          const first = mutate(1)
          const firstReceipt = observeReceipt(first)
          await vi.advanceTimersByTimeAsync(1)
          const second = mutate(2)
          const secondReceipt = observeReceipt(second)
          await vi.advanceTimersByTimeAsync(20)
          expect(starts).toEqual([1])
          first.rollback({ error: canceled, isSecondaryRollback: true })
          await vi.advanceTimersByTimeAsync(0)
          expect(firstReceipt).toMatchObject({
            outcome: `rejected`,
            error: canceled,
          })
          expect(
            secondReceipt.outcome,
            `successor waits for handler completion`,
          ).toBe(`pending`)
          expect(starts, `no overlapping backend handler`).toEqual([1])
          expect([...collection.keys()]).toEqual([2])
          firstWrite.resolve()
          await vi.advanceTimersByTimeAsync(0)
          expect(starts, `successor begins after handler return`).toEqual([
            1, 2,
          ])
          expect(concurrency, `one active backend handler`).toEqual([1, 1])
          secondWrite.resolve()
          await vi.advanceTimersByTimeAsync(0)
          expect(secondReceipt).toMatchObject({
            outcome: `fulfilled`,
            returnedSame: true,
          })
        },
        async () => {
          firstWrite.resolve()
          secondWrite.resolve()
          await vi.advanceTimersByTimeAsync(30)
        },
      )
    })
})

/**
 * A synchronous onMutate may call its own paced mutation function. The outer
 * call already owns the leading edge, so the nested call joins its pending
 * transaction. Both optimistic rows must be applied before the one handler
 * starts. A later timer must not invoke that completed transaction twice.
 */
describe(`paced admission reentry`, () => {
  for (const factory of [debounceStrategy, throttleStrategy])
    it(`${factory.name} admits a nested mutation without a second leading write`, async () => {
      const collection = await createReadyCollection()
      const strategy = factory({ wait: 10, leading: true, trailing: true })
      const starts: Array<Array<number>> = []
      let nested: Transaction<{ id: number }> | undefined
      const mutate = createPacedMutations<number, { id: number }>({
        strategy,
        onMutate: (id) => {
          collection.insert({ id })
          if (id === 1) nested = mutate(2)
        },
        mutationFn: ({ transaction }) => {
          starts.push(
            transaction.mutations.map((mutation) => mutation.modified.id),
          )
          return Promise.resolve()
        },
      })
      await withCleanup(strategy, collection, async () => {
        const outer = mutate(1)
        const outerReceipt = observeReceipt(outer)
        expect(nested, `nested admission reached`).toBe(outer)
        expect([...collection.keys()].sort()).toEqual([1, 2])
        await vi.advanceTimersByTimeAsync(0)
        expect(starts, `one merged leading write`).toEqual([[1, 2]])
        expect(outerReceipt).toMatchObject({
          outcome: `fulfilled`,
          returnedSame: true,
        })
        await vi.advanceTimersByTimeAsync(20)
        expect(starts, `no stale trailing callback`).toEqual([[1, 2]])
        const next = mutate(3)
        const nextReceipt = observeReceipt(next)
        await vi.advanceTimersByTimeAsync(20)
        expect(starts, `later admission still works`).toEqual([[1, 2], [3]])
        expect(nextReceipt).toMatchObject({
          outcome: `fulfilled`,
          returnedSame: true,
        })
      })
    })
})
