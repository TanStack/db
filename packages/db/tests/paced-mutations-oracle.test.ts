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
 * It settles every accepted call. Queue capacity/drop behavior, omitted edge
 * defaults, options-object mutation, cleanup, and failed persistence await a
 * separate contract decision or existing lifecycle tests.
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

async function runProduction(testCase: Case): Promise<{
  starts: Array<Start>
  sameTransaction: Array<Array<number>>
  states: Array<string>
  optimistic: Array<number | undefined>
  persistence: Array<{
    id: number
    outcome: string
    returnedSame: boolean | undefined
  }>
}> {
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

  try {
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
    return {
      starts,
      sameTransaction: [...groups.values()],
      states: [...transactions.values()].map(
        (transaction) => transaction.state,
      ),
      optimistic,
      persistence: [...persistence.values()],
    }
  } finally {
    try {
      strategy.cleanup()
    } finally {
      await collection.cleanup()
    }
  }
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
]

describe(`paced mutation timeline oracle`, () => {
  for (const testCase of cases) {
    it(testCase.name, async () => {
      const actual = await runProduction(testCase)
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

    try {
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
    } finally {
      releaseFutureWrites = true
      for (const resolve of releases.values()) resolve()
      await vi.advanceTimersByTimeAsync(0)
      try {
        strategy.cleanup()
      } finally {
        await collection.cleanup()
      }
    }
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
      const actual = await runProduction({ ...lawful, strategy })
      expect(() => expect(actual.starts).toEqual(lawful.expected)).toThrow()
    }
  })
})
