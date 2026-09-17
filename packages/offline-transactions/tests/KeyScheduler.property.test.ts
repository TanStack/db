import { fc } from '@fast-check/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeyScheduler } from '../src/executor/KeyScheduler'
import type { OfflineTransaction } from '../src/types'

type Command =
  | {
      type: `schedule`
      slot: number
      createdAt: number
      delay: number
      payload: number
    }
  | { type: `getNext` }
  | { type: `start` }
  | { type: `complete` }
  | { type: `fail` }
  | { type: `retry`; delay: number; payload: number }
  | { type: `bulkUpdate`; payload: number }
  | { type: `advance`; duration: number }
  | { type: `clear` }

type LedgerEntry = {
  transaction: OfflineTransaction
  sequence: number
}

type Model = {
  now: number
  nextSequence: number
  pending: Array<LedgerEntry>
  activeId?: string
  retryableId?: string
}

type Snapshot = {
  next?: {
    id: string
    payload: unknown
  }
  pending: Array<{
    id: string
    createdAt: number
    nextAttemptAt: number
    retryCount: number
    payload: unknown
  }>
  pendingCount: number
  runningCount: number
}

const BASE_TIME = Date.parse(`2026-01-01T00:00:00.000Z`)
const SEED = Number(process.env.TANSTACK_DB_OFFLINE_ORACLE_SEED ?? 1815)
const RUNS = Number(process.env.TANSTACK_DB_OFFLINE_ORACLE_RUNS ?? 150)
const PATH = process.env.TANSTACK_DB_OFFLINE_ORACLE_PATH

/*
Test card:
- Law and source: KeyScheduler is globally serial in creation order. Equal
  creation times retain scheduling order, as owned by KeyScheduler.test.ts's
  "processes transactions with identical createdAt in scheduling order" test.
- Domain and legal histories: the event table below, including retry deadline
  orderings, payload replacement, clear during either state, and reuse.
- Reference: a declarative ledger, clock, stable creation sequence, and at most
  one active transaction.
- Production path and checkpoint: KeyScheduler's executor-facing methods;
  compare after every legal event returns.
- Observed result: returned identity/payload, ordered pending records, pending
  and running counts, and current eligibility.
- Known omissions: persistence, Promise settlement, timers outside the modeled
  clock, and leadership are owned by the retained integration oracles.
- Reach/fault/replay: fixed transition/deadline witnesses, four path-specific
  fault controls, and TANSTACK_DB_OFFLINE_ORACLE_{SEED,PATH,RUNS}.

Legal event table:
- schedule/getNext may occur while idle or active
- start requires the FIFO head to be ready and no active transaction
- complete/fail require one active transaction
- retry update immediately follows fail, as TransactionExecutor invokes it
- bulk update, clock advance, and clear are legal while otherwise reachable
- clear retires active and pending work, after which the scheduler is reusable
*/

type CommandToken = {
  selector: number
  slot: number
  createdAt: number
  delay: number
  payload: number
  duration: number
}

type PlanningEntry = {
  id: string
  createdAt: number
  nextAttemptAt: number
  sequence: number
}

type PlanningState = {
  now: number
  nextSequence: number
  pending: Array<PlanningEntry>
  activeId?: string
  retryableId?: string
}

const commandToken = fc.record({
  selector: fc.nat(),
  slot: fc.integer({ min: 0, max: 4 }),
  createdAt: fc.integer({ min: 0, max: 3 }),
  delay: fc.integer({ min: 0, max: 5 }),
  payload: fc.integer({ min: -5, max: 5 }),
  duration: fc.integer({ min: 0, max: 5 }),
})

function planningOrder(state: PlanningState): Array<PlanningEntry> {
  return [...state.pending].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.sequence - right.sequence,
  )
}

function planningNext(state: PlanningState): PlanningEntry | undefined {
  if (state.activeId) return undefined
  const first = planningOrder(state)[0]
  return first && first.nextAttemptAt <= state.now ? first : undefined
}

function nextFreeSlot(state: PlanningState, preferred: number): number {
  for (let offset = 0; offset < 5; offset++) {
    const slot = (preferred + offset) % 5
    if (!state.pending.some(({ id }) => id === `tx-${slot}`)) return slot
  }
  throw new Error(`No transaction slot is available`)
}

function applyPlanningCommand(
  state: PlanningState,
  nextCommand: Command,
): void {
  if (nextCommand.type === `schedule`) {
    state.pending.push({
      id: `tx-${nextCommand.slot}`,
      createdAt: BASE_TIME + nextCommand.createdAt * 1000,
      nextAttemptAt: state.now + nextCommand.delay * 1000,
      sequence: state.nextSequence++,
    })
  } else if (nextCommand.type === `start`) {
    state.activeId = planningNext(state)!.id
  } else if (nextCommand.type === `complete`) {
    state.pending = state.pending.filter(({ id }) => id !== state.activeId)
    state.activeId = undefined
  } else if (nextCommand.type === `fail`) {
    state.retryableId = state.activeId
    state.activeId = undefined
  } else if (nextCommand.type === `retry`) {
    const entry = state.pending.find(({ id }) => id === state.retryableId)!
    entry.nextAttemptAt = state.now + nextCommand.delay * 1000
    state.retryableId = undefined
  } else if (nextCommand.type === `advance`) {
    state.now += nextCommand.duration * 1000
  } else if (nextCommand.type === `clear`) {
    state.pending = []
    state.activeId = undefined
    state.retryableId = undefined
  }
}

function buildLegalHistory(tokens: Array<CommandToken>): Array<Command> {
  const state: PlanningState = {
    now: BASE_TIME,
    nextSequence: 0,
    pending: [],
  }
  const history: Array<Command> = []

  for (const token of tokens) {
    const choices: Array<Command> = [
      { type: `getNext` },
      { type: `bulkUpdate`, payload: token.payload },
      { type: `advance`, duration: token.duration },
      { type: `clear` },
    ]

    if (state.pending.length < 5) {
      choices.push({
        type: `schedule`,
        slot: nextFreeSlot(state, token.slot),
        createdAt: token.createdAt,
        delay: token.delay,
        payload: token.payload,
      })
    }
    if (planningNext(state)) choices.push({ type: `start` })
    if (state.activeId) {
      choices.push({ type: `complete` }, { type: `fail` })
    }

    const nextCommand = choices[token.selector % choices.length]!
    history.push(nextCommand)
    applyPlanningCommand(state, nextCommand)

    if (nextCommand.type === `fail`) {
      const retry: Command = {
        type: `retry`,
        delay: token.delay,
        payload: token.payload,
      }
      history.push(retry)
      applyPlanningCommand(state, retry)
    }
  }

  return history
}

const legalHistory = fc
  .array(commandToken, { minLength: 1, maxLength: 50 })
  .map(buildLegalHistory)

function createTransaction(
  id: string,
  createdAt: number,
  nextAttemptAt: number,
  payload: number,
): OfflineTransaction {
  return {
    id,
    mutationFnName: `syncData`,
    mutations: [],
    keys: [],
    idempotencyKey: `idempotency-${id}`,
    createdAt: new Date(createdAt),
    retryCount: 0,
    nextAttemptAt,
    metadata: { payload },
    version: 1,
  }
}

function cloneTransaction(transaction: OfflineTransaction): OfflineTransaction {
  return {
    ...transaction,
    createdAt: new Date(transaction.createdAt),
    mutations: [...transaction.mutations],
    keys: [...transaction.keys],
    metadata: transaction.metadata ? { ...transaction.metadata } : undefined,
    lastError: transaction.lastError ? { ...transaction.lastError } : undefined,
  }
}

function ordered(model: Model): Array<LedgerEntry> {
  return [...model.pending].sort(
    (left, right) =>
      left.transaction.createdAt.getTime() -
        right.transaction.createdAt.getTime() || left.sequence - right.sequence,
  )
}

function expectedNext(model: Model): OfflineTransaction | undefined {
  if (model.activeId) return undefined
  const first = ordered(model)[0]?.transaction
  return first && first.nextAttemptAt <= model.now ? first : undefined
}

function snapshot(
  scheduler: KeyScheduler,
  observedNext: OfflineTransaction | undefined,
): Snapshot {
  return {
    next: observedNext
      ? {
          id: observedNext.id,
          payload: observedNext.metadata?.payload,
        }
      : undefined,
    pending: scheduler.getAllPendingTransactions().map((transaction) => ({
      id: transaction.id,
      createdAt: transaction.createdAt.getTime(),
      nextAttemptAt: transaction.nextAttemptAt,
      retryCount: transaction.retryCount,
      payload: transaction.metadata?.payload,
    })),
    pendingCount: scheduler.getPendingCount(),
    runningCount: scheduler.getRunningCount(),
  }
}

function expectedSnapshot(model: Model): Snapshot {
  const next = expectedNext(model)
  return {
    next: next
      ? {
          id: next.id,
          payload: next.metadata?.payload,
        }
      : undefined,
    pending: ordered(model).map(({ transaction }) => ({
      id: transaction.id,
      createdAt: transaction.createdAt.getTime(),
      nextAttemptAt: transaction.nextAttemptAt,
      retryCount: transaction.retryCount,
      payload: transaction.metadata?.payload,
    })),
    pendingCount: model.pending.length,
    runningCount: model.activeId ? 1 : 0,
  }
}

function assertSnapshot(
  history: ReadonlyArray<Command>,
  commandIndex: number,
  actual: Snapshot,
  expected: Snapshot,
): void {
  expect(actual, JSON.stringify({ history, commandIndex })).toEqual(expected)
}

type FaultInjection = {
  commandIndex: number
  apply: (snapshot: Snapshot) => Snapshot
}

function runHistory(
  history: Array<Command>,
  fault?: FaultInjection,
): Set<Command[`type`]> {
  vi.useFakeTimers()
  vi.setSystemTime(BASE_TIME)
  const scheduler = new KeyScheduler()
  const model: Model = {
    now: BASE_TIME,
    nextSequence: 0,
    pending: [],
  }
  const coverage = new Set<Command[`type`]>()

  history.forEach((nextCommand, commandIndex) => {
    // TransactionExecutor updates a failed transaction before asking for more
    // work. Other commands in this short state are not legal lifecycle calls.
    if (model.retryableId && nextCommand.type !== `retry`) {
      throw new Error(`retry must immediately follow fail`)
    }

    if (nextCommand.type === `schedule`) {
      const id = `tx-${nextCommand.slot}`
      if (model.pending.some(({ transaction }) => transaction.id === id)) {
        throw new Error(`cannot schedule duplicate transaction ${id}`)
      }
      const transaction = createTransaction(
        id,
        BASE_TIME + nextCommand.createdAt * 1000,
        model.now + nextCommand.delay * 1000,
        nextCommand.payload,
      )
      scheduler.schedule(transaction)
      model.pending.push({
        transaction: cloneTransaction(transaction),
        sequence: model.nextSequence++,
      })
    } else if (nextCommand.type === `getNext`) {
      scheduler.getNext()
    } else if (nextCommand.type === `start`) {
      const transaction = expectedNext(model)
      if (!transaction) throw new Error(`cannot start without eligible work`)
      const observedNext = scheduler.getNext()
      expect({
        id: observedNext?.id,
        payload: observedNext?.metadata?.payload,
      }).toEqual({
        id: transaction.id,
        payload: transaction.metadata?.payload,
      })
      scheduler.markStarted(observedNext!)
      model.activeId = transaction.id
    } else if (nextCommand.type === `complete`) {
      if (!model.activeId)
        throw new Error(`cannot complete without active work`)
      const index = model.pending.findIndex(
        ({ transaction }) => transaction.id === model.activeId,
      )
      const transaction = model.pending[index]!.transaction
      scheduler.markCompleted(transaction)
      model.pending.splice(index, 1)
      model.activeId = undefined
    } else if (nextCommand.type === `fail`) {
      if (!model.activeId) throw new Error(`cannot fail without active work`)
      const transaction = model.pending.find(
        ({ transaction: candidate }) => candidate.id === model.activeId,
      )!.transaction
      scheduler.markFailed(transaction)
      model.retryableId = transaction.id
      model.activeId = undefined
    } else if (nextCommand.type === `retry`) {
      if (!model.retryableId) throw new Error(`cannot retry before a failure`)
      const entry = model.pending.find(
        ({ transaction }) => transaction.id === model.retryableId,
      )!
      const updated = {
        ...entry.transaction,
        retryCount: entry.transaction.retryCount + 1,
        nextAttemptAt: model.now + nextCommand.delay * 1000,
        metadata: { payload: nextCommand.payload },
      }
      scheduler.updateTransaction(cloneTransaction(updated))
      entry.transaction = updated
      model.retryableId = undefined
    } else if (nextCommand.type === `bulkUpdate`) {
      const updated = model.pending.map(({ transaction }) => ({
        ...transaction,
        metadata: { payload: nextCommand.payload },
      }))
      scheduler.updateTransactions(updated.map(cloneTransaction))
      for (const [index, transaction] of updated.entries()) {
        model.pending[index]!.transaction = transaction
      }
    } else if (nextCommand.type === `advance`) {
      const duration = nextCommand.duration * 1000
      vi.advanceTimersByTime(duration)
      model.now += duration
    } else {
      scheduler.clear()
      model.pending = []
      model.activeId = undefined
      model.retryableId = undefined
    }

    coverage.add(nextCommand.type)
    const observed = snapshot(scheduler, scheduler.getNext())
    const actual =
      fault?.commandIndex === commandIndex ? fault.apply(observed) : observed
    assertSnapshot(history, commandIndex, actual, expectedSnapshot(model))
  })

  return coverage
}

describe(`KeyScheduler generated lifecycle`, () => {
  afterEach(() => vi.useRealTimers())

  it(`matches the FIFO retry ledger after every legal event`, () => {
    fc.assert(
      fc.property(legalHistory, (history) => {
        runHistory(history)
      }),
      {
        seed: SEED,
        numRuns: RUNS,
        ...(PATH ? { path: PATH } : {}),
      },
    )
  })

  it(`executes every modeled transition in a fixed replay`, () => {
    const history: Array<Command> = [
      { type: `schedule`, slot: 0, createdAt: 0, delay: 0, payload: 1 },
      { type: `schedule`, slot: 1, createdAt: 0, delay: 0, payload: 2 },
      { type: `getNext` },
      { type: `start` },
      { type: `fail` },
      { type: `retry`, delay: 2, payload: 3 },
      { type: `getNext` },
      { type: `bulkUpdate`, payload: 4 },
      { type: `advance`, duration: 2 },
      { type: `start` },
      { type: `complete` },
      { type: `clear` },
      { type: `schedule`, slot: 0, createdAt: 0, delay: 0, payload: 5 },
    ]
    expect(runHistory(history)).toEqual(
      new Set<Command[`type`]>([
        `schedule`,
        `getNext`,
        `start`,
        `fail`,
        `retry`,
        `bulkUpdate`,
        `advance`,
        `complete`,
        `clear`,
      ]),
    )
  })

  it.each([
    [
      `an earlier retry deadline than its sibling`,
      [
        { type: `schedule`, slot: 0, createdAt: 0, delay: 0, payload: 1 },
        { type: `schedule`, slot: 1, createdAt: 1, delay: 5, payload: 2 },
        { type: `start` },
        { type: `fail` },
        { type: `retry`, delay: 2, payload: 3 },
        { type: `advance`, duration: 2 },
        { type: `start` },
      ],
    ],
    [
      `a later retry deadline than its sibling`,
      [
        { type: `schedule`, slot: 0, createdAt: 0, delay: 0, payload: 1 },
        { type: `schedule`, slot: 1, createdAt: 1, delay: 1, payload: 2 },
        { type: `start` },
        { type: `fail` },
        { type: `retry`, delay: 2, payload: 3 },
        { type: `advance`, duration: 2 },
        { type: `start` },
      ],
    ],
  ] satisfies Array<[string, Array<Command>]>)(
    `covers %s`,
    (_name, history) => {
      runHistory(history)
    },
  )

  it(`rejects bypassing the delayed FIFO head on its scheduler path`, () => {
    const history: Array<Command> = [
      { type: `schedule`, slot: 0, createdAt: 0, delay: 0, payload: 1 },
      { type: `schedule`, slot: 1, createdAt: 1, delay: 0, payload: 2 },
      { type: `start` },
      { type: `fail` },
      { type: `retry`, delay: 5, payload: 3 },
    ]

    expect(() =>
      runHistory(history, {
        commandIndex: 4,
        apply: (actual) => ({
          ...actual,
          next: { id: `tx-1`, payload: 2 },
        }),
      }),
    ).toThrow()
  })

  it(`rejects permitting two active transactions on its scheduler path`, () => {
    const history: Array<Command> = [
      { type: `schedule`, slot: 0, createdAt: 0, delay: 0, payload: 1 },
      { type: `start` },
    ]

    expect(() =>
      runHistory(history, {
        commandIndex: 1,
        apply: (actual) => ({ ...actual, runningCount: 2 }),
      }),
    ).toThrow()
  })

  it(`rejects losing an updated payload on its scheduler path`, () => {
    const history: Array<Command> = [
      { type: `schedule`, slot: 0, createdAt: 0, delay: 0, payload: 1 },
      { type: `start` },
      { type: `fail` },
      { type: `retry`, delay: 0, payload: 9 },
    ]

    expect(() =>
      runHistory(history, {
        commandIndex: 3,
        apply: (actual) => ({
          ...actual,
          next: actual.next ? { ...actual.next, payload: 1 } : undefined,
        }),
      }),
    ).toThrow()
  })

  it(`rejects retaining stale work after clear on its scheduler path`, () => {
    const history: Array<Command> = [
      { type: `schedule`, slot: 0, createdAt: 0, delay: 0, payload: 1 },
      { type: `start` },
      { type: `clear` },
    ]

    expect(() =>
      runHistory(history, {
        commandIndex: 2,
        apply: (actual) => ({
          ...actual,
          pending: [
            {
              id: `tx-0`,
              createdAt: BASE_TIME,
              nextAttemptAt: BASE_TIME,
              retryCount: 0,
              payload: 1,
            },
          ],
          pendingCount: 1,
        }),
      }),
    ).toThrow()
  })
})
