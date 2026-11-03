import { isDeepStrictEqual } from 'node:util'
import fc from 'fast-check'
import { vi } from 'vitest'
import { KeyScheduler } from '../src/executor/KeyScheduler'
import { differs, oracleProperty, pass } from '../../db/tests/oracle-property'
import { BASE_TIME, createTransaction } from './key-scheduler-support'
import type { Observation } from '../../db/tests/oracle-property'
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
  | { type: `remove`; ids: Array<string> }
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

// retryableId is the driver-only failed transaction awaiting its retry update;
// it is not scheduler state. sequence records the insertion-order tie breaker
// for equal creation times without relying on the runtime sort implementation.

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

/**
 * # Which offline transaction may run next?
 *
 * Contract and source: the established KeyScheduler FIFO tests and
 * TransactionExecutor calling order require one globally serial queue. Equal
 * creation times retain scheduling order. A delayed FIFO head blocks younger
 * work. Failure updates retry data before releasing the active transaction,
 * without changing its place. Replay reconciliation may retire only unissued
 * IDs. Clear retires all scheduler work and leaves the scheduler reusable.
 *
 * Model: a declarative ledger, fake clock, stable creation sequence, and active
 * ID predict scheduler observations. The model does not import scheduler state
 * or production classifiers.
 *
 * History grammar: legal commands schedule, inspect, start, fulfill, reject,
 * update one or all pending records, reconcile one replay snapshot, advance
 * the clock, and clear. A reject is followed immediately by its retry update
 * and active release, matching TransactionExecutor's update-then-release order.
 * IDs are unique while pending. At most five IDs exist in generated histories.
 * Slot choice prevents duplicate pending IDs; creation time controls FIFO order;
 * delay and clock advance control readiness; payload makes updates observable.
 * The selector reaches every legal command, including removal during a run;
 * it is unbiased, so each legal command is about equally likely.
 * Histories use 1-50 tokens plus automatic retry steps. Slots span 0-4,
 * creation times 0-3 seconds, delays and advances 0-5 seconds, and payloads
 * -5 through 5. The domain includes equal creation times, zero and positive
 * delays, and negative and positive payloads.
 * The grammar excludes duplicate pending IDs, start without eligible work,
 * completion without active work, and any intervening command before retry.
 *
 * Production driver and refinement check: the driver calls the real
 * executor-facing scheduler methods and records, after every command, the next
 * eligible ID and payload, ordered pending records, counts, and active state,
 * plus what `start` was given and what a removal returned. The model computes
 * the same records from the ledger alone; the check compares them per command,
 * each field under its law: `fifo` (the next eligible ID), `update` (payloads),
 * `ledger` (ordered pending records and counts), `serial` (the active count),
 * and `retirement` (what a removal or clear retires).
 *
 * Reach and controls: one pinned history reaches every transition. Two pinned
 * histories cross retry-deadline order, and two more pin an active removal
 * with a waiting sibling and a blocked FIFO head at its retry deadline. Five
 * calibrations prove the comparison rejects bypass, double issue, stale
 * payload, stale clear, and failed selective retirement, and three more reject
 * a stale next payload, revoked work kept in the pending ledger, and a wrong
 * count. The property is `offline.key-scheduler-fifo-ledger` on
 * `oracleProperty`; a failure prints the seed, path, and property to set to
 * replay it, and a path replay runs only the random lane.
 *
 * Limits: persistence, caller promise settlement, leadership, and real timers
 * have separate owners. The model does not promise fairness beyond FIFO order.
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

// PlanningState is a generator-only projection of the ledger. It tracks just
// enough IDs and deadlines to choose legal commands. Its retryableId denotes
// the TransactionExecutor step between mutation failure and retry update; the
// scheduler has no corresponding retryable state.

const commandToken = fc.record({
  // Unbiased: fast-check biases small naturals, which picked the first few
  // choices almost always, so start, fail, and retry were rarely generated.
  selector: fc.noBias(fc.nat()),
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
  } else if (nextCommand.type === `retry`) {
    const entry = state.pending.find(({ id }) => id === state.retryableId)!
    entry.nextAttemptAt = state.now + nextCommand.delay * 1000
    state.activeId = undefined
    state.retryableId = undefined
  } else if (nextCommand.type === `advance`) {
    state.now += nextCommand.duration * 1000
  } else if (nextCommand.type === `remove`) {
    const ids = new Set(nextCommand.ids)
    state.pending = state.pending.filter(
      ({ id }) => id === state.activeId || !ids.has(id),
    )
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
    const removable = state.pending.filter(({ id }) => id !== state.activeId)
    if (removable.length > 0) {
      const mode = Math.abs(token.payload) % 4
      const ids =
        mode === 0
          ? []
          : mode === 1
            ? [removable[token.slot % removable.length]!.id]
            : mode === 2
              ? removable.map(({ id }) => id)
              : [removable[0]!.id, `missing`]
      choices.push({
        type: `remove`,
        ids,
      })
    }

    if (state.pending.length < 5) {
      choices.push({
        type: `schedule`,
        slot: nextFreeSlot(state, token.slot),
        createdAt: token.createdAt,
        delay: token.delay,
        payload: token.payload,
      })
    }
    if (state.activeId) {
      // A replay snapshot may name the active ID, a waiting sibling, and an
      // ID the scheduler does not hold.
      choices.push({
        type: `remove`,
        ids: [
          state.activeId,
          ...removable.slice(0, 1).map(({ id }) => id),
          ...(Math.abs(token.payload) % 2 === 1 ? [`missing`] : []),
        ],
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

// The tokens a command list came from, found by search and accepted only if
// they rebuild that exact list. A pinned command list is then a member of the
// generated language, and fast-check can shrink it.
function tokensOf(history: ReadonlyArray<Command>): Array<CommandToken> {
  const tokens: Array<CommandToken> = []
  for (let index = 0; index < history.length; index++) {
    const command = history[index]!
    const prefix = buildLegalHistory(tokens)
    const retry = command.type === `fail` ? history[index + 1] : undefined
    const base: CommandToken = {
      selector: 0,
      slot: command.type === `schedule` ? command.slot : 0,
      createdAt: command.type === `schedule` ? command.createdAt : 0,
      delay:
        command.type === `schedule`
          ? command.delay
          : retry?.type === `retry`
            ? retry.delay
            : 0,
      payload:
        command.type === `schedule` || command.type === `bulkUpdate`
          ? command.payload
          : retry?.type === `retry`
            ? retry.payload
            : 0,
      duration: command.type === `advance` ? command.duration : 0,
    }
    // A removal's IDs come from the token's payload and slot.
    const candidates =
      command.type === `remove`
        ? Array.from({ length: 11 * 5 }, (_, n) => ({
            ...base,
            payload: (n % 11) - 5,
            slot: Math.floor(n / 11),
          }))
        : [base]
    let found: CommandToken | undefined
    for (const candidate of candidates)
      for (let selector = 0; selector < 12 && !found; selector++) {
        const token = { ...candidate, selector }
        const built = buildLegalHistory([...tokens, token])
        if (
          isDeepStrictEqual(built.slice(prefix.length, prefix.length + 1), [
            command,
          ])
        )
          found = token
      }
    if (!found) throw new Error(`command ${index} is not legal here`)
    tokens.push(found)
    if (retry?.type === `retry`) index++
  }
  if (!isDeepStrictEqual(buildLegalHistory(tokens), history))
    throw new Error(`not a legal scheduler history`)
  return tokens
}

const legalHistory: fc.Arbitrary<Array<Command>> = fc
  // fast-check's default size keeps arrays near ten elements whatever
  // maxLength says; `medium` draws lengths across the declared 1 to 50.
  .array(commandToken, { minLength: 1, maxLength: 50, size: `medium` })
  .map(buildLegalHistory, (value) => tokensOf(value as Array<Command>))

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

// Model law: only the oldest pending transaction can become eligible. An
// active transaction or a delayed FIFO head makes the next result empty.
function expectedNext(model: Model): OfflineTransaction | undefined {
  if (model.activeId) return undefined
  const first = ordered(model)[0]?.transaction
  return first && first.nextAttemptAt <= model.now ? first : undefined
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

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
//
// The ledger replays the commands and owes, after each one, the scheduler's
// snapshot, the transaction a `start` is given, and the IDs a removal
// retires (requested pending IDs other than the active one, once each). A
// command the lifecycle does not allow is a setup error with its name: the
// grammar never generates one, so a pin or a grammar change that does is
// caught here.

type Owed = {
  snapshot: Snapshot
  started?: { id: string; payload: unknown }
  removed?: Array<string>
}
const checkpointOf = (index: number, command: Command) =>
  `${index}: ${command.type}`

function ledgerModel(history: ReadonlyArray<Command>): Map<string, Owed> {
  const model: Model = { now: BASE_TIME, nextSequence: 0, pending: [] }
  const owed = new Map<string, Owed>()
  for (const [index, command] of history.entries()) {
    const extra: Partial<Owed> = {}
    const illegal = (reason: string) => {
      throw new Error(`command ${index} (${command.type}): ${reason}`)
    }
    // TransactionExecutor updates a failed transaction before asking for
    // more work, so nothing else may come between a failure and its retry.
    if (model.retryableId && command.type !== `retry`)
      illegal(`retry must immediately follow fail`)
    if (command.type === `schedule`) {
      if (
        model.pending.some(
          ({ transaction }) => transaction.id === `tx-${command.slot}`,
        )
      )
        illegal(`tx-${command.slot} is already pending`)
      model.pending.push({
        transaction: createTransaction(
          `tx-${command.slot}`,
          BASE_TIME + command.createdAt * 1000,
          model.now + command.delay * 1000,
          command.payload,
        ),
        sequence: model.nextSequence++,
      })
    } else if (command.type === `start`) {
      const transaction = expectedNext(model) ?? illegal(`no eligible work`)
      extra.started = {
        id: transaction.id,
        payload: transaction.metadata?.payload,
      }
      model.activeId = transaction.id
    } else if (command.type === `complete`) {
      if (!model.activeId) illegal(`no active work`)
      model.pending = model.pending.filter(
        ({ transaction }) => transaction.id !== model.activeId,
      )
      model.activeId = undefined
    } else if (command.type === `fail`) {
      if (!model.activeId) illegal(`no active work`)
      model.retryableId = model.activeId
    } else if (command.type === `retry`) {
      if (!model.retryableId) illegal(`no failure to retry`)
      const entry = model.pending.find(
        ({ transaction }) => transaction.id === model.retryableId,
      )!
      entry.transaction = {
        ...entry.transaction,
        retryCount: entry.transaction.retryCount + 1,
        nextAttemptAt: model.now + command.delay * 1000,
        metadata: { payload: command.payload },
      }
      model.activeId = undefined
      model.retryableId = undefined
    } else if (command.type === `bulkUpdate`) {
      for (const entry of model.pending)
        entry.transaction = {
          ...entry.transaction,
          metadata: { payload: command.payload },
        }
    } else if (command.type === `advance`) {
      model.now += command.duration * 1000
    } else if (command.type === `remove`) {
      extra.removed = [
        ...new Set(command.ids.filter((id) => id !== model.activeId)),
      ]
      const ids = new Set(command.ids)
      model.pending = model.pending.filter(
        ({ transaction }) =>
          transaction.id === model.activeId || !ids.has(transaction.id),
      )
    } else if (command.type === `clear`) {
      model.pending = []
      model.activeId = undefined
      model.retryableId = undefined
    }
    owed.set(checkpointOf(index, command), {
      snapshot: expectedSnapshot(model),
      ...extra,
    })
  }
  return owed
}

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------
//
// The driver calls the scheduler as TransactionExecutor does, under a fake
// clock. It starts whatever `getNext` returns, fails the transaction it
// started, and builds the retry update from it; it never reads the model.

function snapshotOf(scheduler: KeyScheduler): Snapshot {
  const next = scheduler.getNext()
  return {
    next: next ? { id: next.id, payload: next.metadata?.payload } : undefined,
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

function driveScheduler(
  history: ReadonlyArray<Command>,
  observe: (checkpoint: string, value: unknown) => void,
) {
  vi.useFakeTimers()
  vi.setSystemTime(BASE_TIME)
  try {
    const scheduler = new KeyScheduler()
    let active: OfflineTransaction | undefined
    for (const [index, command] of history.entries()) {
      const extra: Partial<Owed> = {}
      if (command.type === `schedule`) {
        scheduler.schedule(
          createTransaction(
            `tx-${command.slot}`,
            BASE_TIME + command.createdAt * 1000,
            Date.now() + command.delay * 1000,
            command.payload,
          ),
        )
      } else if (command.type === `getNext`) {
        scheduler.getNext()
      } else if (command.type === `start`) {
        const next = scheduler.getNext()
        extra.started = next
          ? { id: next.id, payload: next.metadata?.payload }
          : undefined
        if (next) scheduler.markStarted(next)
        active = next && cloneTransaction(next)
      } else if (command.type === `complete`) {
        if (active) scheduler.markCompleted(active)
        active = undefined
      } else if (command.type === `retry`) {
        if (active) {
          scheduler.updateTransaction({
            ...cloneTransaction(active),
            retryCount: active.retryCount + 1,
            nextAttemptAt: Date.now() + command.delay * 1000,
            metadata: { payload: command.payload },
          })
          scheduler.markFailed(active)
        }
        active = undefined
      } else if (command.type === `bulkUpdate`) {
        scheduler.updateTransactions(
          scheduler.getAllPendingTransactions().map((transaction) => ({
            ...cloneTransaction(transaction),
            metadata: { payload: command.payload },
          })),
        )
      } else if (command.type === `advance`) {
        vi.advanceTimersByTime(command.duration * 1000)
      } else if (command.type === `remove`) {
        extra.removed = scheduler.removePendingTransactions(command.ids)
      } else if (command.type === `clear`) {
        scheduler.clear()
        active = undefined
      }
      observe(checkpointOf(index, command), {
        snapshot: snapshotOf(scheduler),
        ...extra,
      })
    }
  } finally {
    vi.useRealTimers()
  }
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

function checkLedger(
  _history: ReadonlyArray<Command>,
  trace: ReadonlyArray<Observation>,
  owed: ReturnType<typeof ledgerModel>,
) {
  for (const [checkpoint, expected] of owed) {
    const seen = trace.find((entry) => entry.checkpoint === checkpoint)
      ?.value as Owed | undefined
    if (!seen)
      return differs(
        checkpoint,
        `trace`,
        undefined,
        expected,
        `the driver recorded no "${checkpoint}"`,
      )!
    const wrong =
      differs(
        checkpoint,
        `fifo`,
        seen.started?.id,
        expected.started?.id,
        `start was given another transaction`,
      ) ??
      differs(
        checkpoint,
        `fifo`,
        seen.snapshot.next?.id,
        expected.snapshot.next?.id,
        `another transaction is next`,
      ) ??
      differs(
        checkpoint,
        `update`,
        seen.started?.payload,
        expected.started?.payload,
        `start was given a stale payload`,
      ) ??
      differs(
        checkpoint,
        `update`,
        seen.snapshot.next?.payload,
        expected.snapshot.next?.payload,
        `the next transaction has a stale payload`,
      ) ??
      differs(
        checkpoint,
        `retirement`,
        seen.removed,
        expected.removed,
        `a removal retired other IDs`,
      ) ??
      differs(
        checkpoint,
        `serial`,
        seen.snapshot.runningCount,
        expected.snapshot.runningCount,
        `the active count differs`,
      ) ??
      differs(
        checkpoint,
        `retirement`,
        seen.snapshot.pending.map(({ id }) => id).sort(),
        expected.snapshot.pending.map(({ id }) => id).sort(),
        `other transactions are pending`,
      ) ??
      differs(
        checkpoint,
        `ledger`,
        seen.snapshot,
        expected.snapshot,
        `the pending ledger differs`,
      )
    if (wrong) return wrong
  }
  return pass
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

const commandTypes = [
  `schedule`,
  `getNext`,
  `start`,
  `fail`,
  `retry`,
  `bulkUpdate`,
  `remove`,
  `advance`,
  `complete`,
  `clear`,
] as const
const schedule = (
  slot: number,
  createdAt: number,
  delay: number,
  payload: number,
): Command => ({ type: `schedule`, slot, createdAt, delay, payload })

// Corrupts the first checkpoint whose recorded value `applies` to, or none.
const corruptFirst =
  (applies: (value: Owed, checkpoint: string) => Owed | undefined) =>
  (trace: ReadonlyArray<Observation>) => {
    const at = trace.findIndex(
      ({ checkpoint, value }) =>
        applies(value as Owed, checkpoint) !== undefined,
    )
    if (at < 0) return undefined
    return trace.map((entry, index) =>
      index === at
        ? { ...entry, value: applies(entry.value as Owed, entry.checkpoint) }
        : entry,
    )
  }

oracleProperty({
  id: `offline.key-scheduler-fifo-ledger`,
  law: {
    statement: `KeyScheduler is one globally serial FIFO queue: equal creation times keep scheduling order, a delayed head blocks younger work, a failure updates retry data before releasing the active transaction without moving it, replay reconciliation retires only unissued IDs, and clear retires all work and leaves the scheduler reusable.`,
    authority: `the established KeyScheduler FIFO tests and TransactionExecutor's calling order (packages/offline-transactions/src/executor)`,
    limits: `Persistence, caller promise settlement, leadership, and real timers have separate owners; no fairness beyond FIFO order; at most five IDs.`,
    owner: `Offline execution`,
  },
  histories: {
    arbitrary: legalHistory,
    states: [],
    measured: commandTypes,
    runs: 150,
    fixedSeeds: [1815],
    pins: [
      {
        name: `every modeled transition`,
        enters: [...commandTypes],
        history: [
          schedule(0, 0, 0, 1),
          schedule(1, 0, 0, 2),
          { type: `getNext` },
          { type: `start` },
          { type: `remove`, ids: [`tx-0`, `tx-1`, `missing`] },
          { type: `fail` },
          { type: `retry`, delay: 2, payload: 3 },
          { type: `getNext` },
          { type: `bulkUpdate`, payload: 4 },
          { type: `advance`, duration: 2 },
          { type: `start` },
          { type: `complete` },
          { type: `clear` },
          schedule(0, 0, 0, 5),
        ],
      },
      {
        name: `an active removal with a waiting sibling`,
        enters: [`remove`, `complete`],
        history: [
          schedule(0, 0, 0, 1),
          schedule(1, 0, 0, 1),
          { type: `start` },
          // Request removal of both IDs while tx-0 is active: only tx-1 retires.
          { type: `remove`, ids: [`tx-0`, `tx-1`] },
          { type: `complete` },
        ],
      },
      {
        name: `a blocked FIFO head at its retry deadline`,
        enters: [`retry`, `advance`],
        history: [
          schedule(0, 0, 0, 1),
          schedule(1, 1, 0, 1),
          { type: `start` },
          { type: `fail` },
          { type: `retry`, delay: 5, payload: 1 },
          // tx-1 is ready but cannot bypass tx-0.
          { type: `getNext` },
          { type: `advance`, duration: 4 },
          // Still before the retry deadline.
          { type: `getNext` },
          { type: `advance`, duration: 1 },
          // tx-0 becomes eligible at the deadline.
          { type: `start` },
        ],
      },
      ...(
        [
          [`an earlier retry deadline than its sibling`, 5],
          [`a later retry deadline than its sibling`, 1],
        ] as const
      ).map(([name, siblingDelay]) => ({
        name,
        enters: [`retry` as const],
        history: [
          schedule(0, 0, 0, 1),
          schedule(1, 1, siblingDelay, 2),
          { type: `start` },
          { type: `fail` },
          { type: `retry`, delay: 2, payload: 3 },
          { type: `advance`, duration: 2 },
          { type: `start` },
        ] satisfies Array<Command>,
      })),
    ],
  },
  model: ledgerModel,
  reached: (history) => [...new Set(history.map(({ type }) => type))],
  driver: driveScheduler,
  check: checkLedger,
  calibrations: [
    {
      name: `a ready sibling bypasses the delayed FIFO head`,
      law: `fifo`,
      corrupt: corruptFirst((value) =>
        value.snapshot.next === undefined &&
        value.snapshot.runningCount === 0 &&
        value.snapshot.pending.length >= 2
          ? {
              ...value,
              snapshot: {
                ...value.snapshot,
                next: {
                  id: value.snapshot.pending[1]!.id,
                  payload: value.snapshot.pending[1]!.payload,
                },
              },
            }
          : undefined,
      ),
    },
    {
      name: `two transactions are active`,
      law: `serial`,
      corrupt: corruptFirst((value) =>
        value.snapshot.runningCount === 1
          ? { ...value, snapshot: { ...value.snapshot, runningCount: 2 } }
          : undefined,
      ),
    },
    {
      name: `a retried transaction starts with its old payload`,
      law: `update`,
      corrupt: (trace) => {
        const retried = trace.findIndex(({ checkpoint }) =>
          checkpoint.endsWith(`retry`),
        )
        const at = trace.findIndex(
          ({ checkpoint, value }, index) =>
            index > retried &&
            retried >= 0 &&
            checkpoint.endsWith(`start`) &&
            (value as Owed).started !== undefined,
        )
        if (at < 0) return undefined
        return trace.map((entry, index) => {
          if (index !== at) return entry
          const value = entry.value as Owed
          return {
            ...entry,
            value: {
              ...value,
              started: { ...value.started!, payload: `stale` },
            },
          }
        })
      },
    },
    {
      name: `clear keeps stale work`,
      law: `retirement`,
      corrupt: corruptFirst((value, checkpoint) =>
        checkpoint.endsWith(`clear`)
          ? {
              ...value,
              snapshot: {
                ...value.snapshot,
                pending: [
                  {
                    id: `stale`,
                    createdAt: BASE_TIME,
                    nextAttemptAt: BASE_TIME,
                    retryCount: 0,
                    payload: 1,
                  },
                ],
                pendingCount: 1,
              },
            }
          : undefined,
      ),
    },
    {
      name: `the next transaction keeps a stale payload`,
      law: `update`,
      corrupt: corruptFirst((value) =>
        value.snapshot.next
          ? {
              ...value,
              snapshot: {
                ...value.snapshot,
                next: { ...value.snapshot.next, payload: `stale` },
              },
            }
          : undefined,
      ),
    },
    {
      name: `revoked work stays in the pending ledger`,
      law: `retirement`,
      corrupt: corruptFirst((value) => {
        const revoked = value.removed?.[0]
        return revoked
          ? {
              ...value,
              snapshot: {
                ...value.snapshot,
                pending: [
                  {
                    id: revoked,
                    createdAt: BASE_TIME,
                    nextAttemptAt: BASE_TIME,
                    retryCount: 0,
                    payload: 1,
                  },
                  ...value.snapshot.pending,
                ],
                pendingCount: value.snapshot.pendingCount + 1,
              },
            }
          : undefined
      }),
    },
    {
      name: `the pending count is off by one`,
      law: `ledger`,
      corrupt: corruptFirst((value) => ({
        ...value,
        snapshot: {
          ...value.snapshot,
          pendingCount: value.snapshot.pendingCount + 1,
        },
      })),
    },
    {
      name: `a selective removal keeps the revoked work`,
      law: `retirement`,
      corrupt: corruptFirst((value) =>
        value.removed && value.removed.length > 0
          ? { ...value, removed: [] }
          : undefined,
      ),
    },
  ],
})
