import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../src/deferred'
import { createPacedMutations } from '../src/paced-mutations'
import {
  debounceStrategy,
  queueStrategy,
  throttleStrategy,
} from '../src/strategies'
import { declareOracle } from './oracle-declaration.js'
import {
  createReadyCollection,
  observeReceipt,
  origin,
  withCleanup,
} from './paced-mutations-support'
import type { Start } from './paced-mutations-support'
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

type Position = `front` | `back`

type Case = {
  name: string
  actions: Array<Action>
  expected: Array<Start>
  sameTransaction: Array<Array<number>>
  strategy: () => Strategy
}

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

// The timeline check compares one production observation with the model's
// prediction carried by its case: start times, transaction grouping, the
// optimistic rows, and settlement of every receipt.
function checkTimelineObservation(testCase: Case, actual: Observation): void {
  expect(actual.starts).toEqual(testCase.expected)
  expect(actual.sameTransaction).toEqual(testCase.sameTransaction)
  expect(actual.optimistic).toEqual(
    testCase.actions.flatMap((action) =>
      action.kind === `mutate` ? [action.id] : [],
    ),
  )
  expect(actual.states).toEqual(
    testCase.sameTransaction.flatMap((group) => group.map(() => `completed`)),
  )
  expect(actual.persistence).toEqual(
    testCase.sameTransaction.map(([id]) => ({
      id,
      outcome: `fulfilled`,
      returnedSame: true,
    })),
  )
}

declareOracle({
  check: [checkTimelineObservation, checkHeldPacing],
  model: [
    queueStarts,
    debounceStarts,
    throttleStarts,
    nonLeadingThrottleStarts,
    heldPacingTimes,
    expectedHeldStarts,
    expectedSuccessorCanceled,
  ],
})

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
  for (const testCase of cases) {
    it(testCase.name, async () => {
      await runProduction(testCase, (actual) =>
        checkTimelineObservation(testCase, actual),
      )
    })
  }
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

// The held-pacing model: the first call starts at its edge. The second starts
// at its own edge, but only once the first write has released by then.
function expectedHeldStarts(
  times: ReturnType<typeof heldPacingTimes>,
  now: number,
  firstReleased: boolean,
): Array<Start> {
  const expectedStarts: Array<Start> = [{ at: times.firstAt, ids: [1] }]
  if (now >= times.secondAt && firstReleased)
    expectedStarts.push({ at: times.secondAt, ids: [2] })
  return expectedStarts
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
    const expectedStarts = expectedHeldStarts(
      times,
      Date.now() - origin,
      firstReleased,
    )
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

// The settlement model: a pending successor is canceled by its own explicit
// rollback, or by a failed same-key predecessor. Distinct keys survive failure.
function expectedSuccessorCanceled(
  outcome: `resolve` | `reject` | `cancel-pending`,
  sameKey: boolean,
): boolean {
  return outcome === `cancel-pending` || (outcome === `reject` && sameKey)
}

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
                const successorCanceled = expectedSuccessorCanceled(
                  outcome,
                  sameKey,
                )
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
