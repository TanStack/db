import { isDeepStrictEqual } from 'node:util'
import fc from 'fast-check'
import { vi } from 'vitest'
import { KeyScheduler } from '../src/executor/KeyScheduler'
import { differs, oracleProperty, pass } from '../../db/tests/oracle-property'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { BASE_TIME, createTransaction } from './key-scheduler-support'
import type { Observation } from '../../db/tests/oracle-property'
import type { OfflineTransaction } from '../src/types'

// What this oracle owns: the gap report judges these entries, and their
// reference trees within the package, by this file's tests.
declareOracle({
  owns: [`src/executor/KeyScheduler.ts`],
})

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
  | { type: `retryRemoved`; delay: number; payload: number }
  | { type: `release` }
  | { type: `bulkUpdate`; payload: number; reset: boolean }
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
 * Scheduling an ID that is already pending is a duplicate schedule: `schedule`
 * returns false, which TransactionExecutor uses during outbox replay to tell
 * newly loaded transactions from ones it already holds. The model also keeps
 * the first record, its place, payload, and retry data; that part has no
 * contract source yet and is stated as a limit.
 *
 * Model: a declarative ledger, fake clock, stable creation sequence, and active
 * ID predict scheduler observations. The model does not import scheduler state
 * or production classifiers.
 *
 * History grammar: the commands are `schedule`, `getNext`, `start`,
 * `complete`, `fail`, `release`, `bulkUpdate`, `remove`, `advance`, and
 * `clear`, named for the scheduler calls TransactionExecutor makes. A `fail`
 * is settled at once, as TransactionExecutor settles a failure: by `retry`
 * (update the record, then release it), by `complete` (a terminal removal), or
 * by `retryRemoved` (update, then remove because the outbox row is gone, then
 * release). A `release` without an update is the executor's storage-failure
 * path. A `bulkUpdate` changes every payload, and may reset every deadline to
 * now, as `resetRetryDelays` does. A schedule takes a free slot `tx-0` to
 * `tx-6`, schedules `missing`, the ID that replay snapshots name without the
 * scheduler holding it, or duplicates a pending ID, as outbox replay does.
 * At most seven IDs are pending; that is the grammar's bound, and production
 * has none. Creation time controls FIFO order and never changes after
 * scheduling; delay and clock advance control readiness; payload makes updates
 * observable. Each token picks uniformly among the legal choices, and a
 * removal choice folds four modes. Histories use 1-50 tokens plus the
 * follow-up of each failure. Slots span 0-6, creation times 0-3 seconds,
 * delays and advances 0-5 seconds, and payloads -5 through 5. The grammar
 * excludes start without eligible work, completion without active work, and
 * any command between a failure and its settlement.
 *
 * Production driver and refinement check: the driver calls the real
 * executor-facing scheduler methods and records, after every command, the next
 * eligible ID and payload, ordered pending records, counts, and active state,
 * plus what `schedule` returned, what `start` was given, and what a removal
 * returned. A retry's update is recorded before its release, so a scheduler
 * that releases on update is visible. After each production call it records
 * the command as reach, and it records situations the laws turn on: a
 * duplicate rejected with six or more pending, a duplicate of the active ID,
 * clear while active, a removal naming an unheld ID or the active ID with a
 * waiting sibling, and a blocked head with a ready sibling. A `fail` makes no
 * scheduler call and records no reach. The model computes the same records
 * from the ledger alone; the check compares them per checkpoint, each field
 * under its law: `dedupe` (whether a schedule was accepted), `fifo` (the next
 * eligible ID), `update` (payloads), `ledger` (ordered pending records and
 * counts), `serial` (the active count), and `retirement` (what a removal or
 * clear retires).
 *
 * Reach and controls: one fixed history reaches every transition. Two fixed
 * histories cross retry-deadline order, two more fix an active removal with a
 * waiting sibling and a blocked FIFO head at its retry deadline, one
 * duplicates a pending ID with another creation time and payload, one
 * schedules `missing` after a replay snapshot named it, one crosses a release,
 * a terminal failure, and a removed retry, and one resets a delayed head's
 * deadline. The declared state `duplicate schedule` is bound to the
 * scheduler's `duplicate-schedule` probe: the model predicts, from the
 * history alone, which histories duplicate a pending ID, the probe reports
 * which ones production rejected, and the two must agree in every history
 * (law `reach agreement`). A constructed history fills six slots and then
 * duplicates one, so every campaign reaches `duplicate schedule with six or
 * more pending`, which the driver records. Five calibrations prove the comparison rejects bypass, double
 * issue, stale payload, stale clear, and failed selective retirement; three
 * more reject a stale next payload, revoked work kept in the pending ledger,
 * and a wrong count; one more rejects an accepted duplicate. The property is
 * `offline.key-scheduler-fifo-ledger` on `oracleProperty`; a failure prints
 * the seed, path, and property to set to replay it, and a path replay runs
 * only the random campaign.
 *
 * Limits: persistence, caller promise settlement, leadership, and real timers
 * have separate owners. The model does not promise fairness beyond FIFO order.
 * Creation times never change after scheduling (maintainer decision,
 * 2026-11-04). The executor's promise that reloaded work can run at once
 * belongs to the outbox replay owner; this oracle owns only that a deadline
 * reset reaches every record. Keeping the first record on a duplicate schedule
 * awaits a maintainer decision.
 */

// Seven slots `tx-0` to `tx-6`, and slot 7 for `missing`, the ID that replay
// snapshots name without the scheduler holding it. Production has no pending
// bound; seven is the grammar's bound, so six or more pending is reachable.
const SLOTS = 7
const MISSING_SLOT = SLOTS
const MAX_PENDING = SLOTS
const idOf = (slot: number) =>
  slot === MISSING_SLOT ? `missing` : `tx-${slot}`
const slotOf = (id: string) =>
  id === `missing` ? MISSING_SLOT : Number(id.slice(`tx-`.length))

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
  slot: fc.integer({ min: 0, max: SLOTS - 1 }),
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
  for (let offset = 0; offset < SLOTS; offset++) {
    const slot = (preferred + offset) % SLOTS
    if (!state.pending.some(({ id }) => id === `tx-${slot}`)) return slot
  }
  throw new Error(`No transaction slot is available`)
}

function applyPlanningCommand(
  state: PlanningState,
  nextCommand: Command,
): void {
  if (nextCommand.type === `schedule`) {
    if (state.pending.some(({ id }) => id === idOf(nextCommand.slot))) return
    state.pending.push({
      id: idOf(nextCommand.slot),
      createdAt: BASE_TIME + nextCommand.createdAt * 1000,
      nextAttemptAt: state.now + nextCommand.delay * 1000,
      sequence: state.nextSequence++,
    })
  } else if (nextCommand.type === `start`) {
    state.activeId = planningNext(state)!.id
  } else if (nextCommand.type === `complete`) {
    state.pending = state.pending.filter(({ id }) => id !== state.activeId)
    state.activeId = undefined
    state.retryableId = undefined
  } else if (nextCommand.type === `release`) {
    state.activeId = undefined
  } else if (nextCommand.type === `retryRemoved`) {
    state.pending = state.pending.filter(({ id }) => id !== state.retryableId)
    state.activeId = undefined
    state.retryableId = undefined
  } else if (nextCommand.type === `bulkUpdate`) {
    if (nextCommand.reset)
      for (const entry of state.pending) entry.nextAttemptAt = state.now
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
      // A reset is TransactionExecutor's resetRetryDelays: every pending
      // deadline becomes now, in one batch.
      {
        type: `bulkUpdate`,
        payload: token.payload,
        reset: token.duration % 2 === 1,
      },
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

    if (
      state.pending.length < MAX_PENDING &&
      !state.pending.some(({ id }) => id === `missing`)
    )
      choices.push({
        type: `schedule`,
        slot: MISSING_SLOT,
        createdAt: token.createdAt,
        delay: token.delay,
        payload: token.payload,
      })
    if (state.pending.length < MAX_PENDING) {
      choices.push({
        type: `schedule`,
        slot: nextFreeSlot(state, token.slot),
        createdAt: token.createdAt,
        delay: token.delay,
        payload: token.payload,
      })
    }
    if (state.pending.length > 0) {
      // Outbox replay schedules transactions the scheduler may already hold.
      const duplicated = state.pending[token.slot % state.pending.length]!
      choices.push({
        type: `schedule`,
        slot: slotOf(duplicated.id),
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
      // A release without an update is the executor's storage-failure path.
      choices.push({ type: `complete` }, { type: `fail` }, { type: `release` })
    }

    const nextCommand = choices[token.selector % choices.length]!
    history.push(nextCommand)
    applyPlanningCommand(state, nextCommand)

    // TransactionExecutor follows a failure with its retry update, a
    // terminal removal, or a retry update whose transaction is then removed.
    if (nextCommand.type === `fail`) {
      const mode = Math.abs(token.payload) % 3
      const follow: Command =
        mode === 0
          ? { type: `retry`, delay: token.delay, payload: token.payload }
          : mode === 1
            ? { type: `complete` }
            : {
                type: `retryRemoved`,
                delay: token.delay,
                payload: token.payload,
              }
      history.push(follow)
      applyPlanningCommand(state, follow)
    }
  }

  return history
}

// The tokens a command list came from, found by search and accepted only if
// they rebuild that exact list. A fixed command list is then a member of the
// generated language, and fast-check can shrink it.
function tokensOf(history: ReadonlyArray<Command>): Array<CommandToken> {
  const tokens: Array<CommandToken> = []
  for (let index = 0; index < history.length; index++) {
    const command = history[index]!
    const prefix = buildLegalHistory(tokens)
    const follow = command.type === `fail` ? history[index + 1] : undefined
    const retry =
      follow?.type === `retry` || follow?.type === `retryRemoved`
        ? follow
        : undefined
    const base: CommandToken = {
      selector: 0,
      slot: command.type === `schedule` ? command.slot : 0,
      createdAt: command.type === `schedule` ? command.createdAt : 0,
      delay:
        command.type === `schedule` ? command.delay : retry ? retry.delay : 0,
      payload:
        command.type === `schedule` || command.type === `bulkUpdate`
          ? command.payload
          : retry
            ? retry.payload
            : 0,
      duration:
        command.type === `advance`
          ? command.duration
          : command.type === `bulkUpdate` && command.reset
            ? 1
            : 0,
    }
    // A removal's IDs come from the token's payload and slot.
    // A duplicate schedule takes its ID from the token's slot among the pending.
    const candidates =
      command.type === `remove`
        ? Array.from({ length: 11 * SLOTS }, (_, n) => ({
            ...base,
            payload: (n % 11) - 5,
            slot: Math.floor(n / 11),
          }))
        : command.type === `schedule`
          ? Array.from({ length: SLOTS }, (_, slot) => ({ ...base, slot }))
          : command.type === `fail` && !retry
            ? // A terminal removal's payload only selects the follow-up.
              Array.from({ length: 11 }, (_, n) => ({
                ...base,
                payload: n - 5,
              }))
            : [base]
    // A failure is matched with its follow-up, which the same token decides.
    const wanted = follow ? [command, follow] : [command]
    let found: CommandToken | undefined
    for (const candidate of candidates)
      for (let selector = 0; selector < 16 && !found; selector++) {
        const token = { ...candidate, selector }
        const built = buildLegalHistory([...tokens, token])
        if (
          isDeepStrictEqual(
            built.slice(prefix.length, prefix.length + wanted.length),
            wanted,
          )
        )
          found = token
      }
    if (!found) throw new Error(`command ${index} is not legal here`)
    tokens.push(found)
    if (follow) index++
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
// retires (requested IDs other than the active one, once each, including IDs
// the scheduler does not hold). A
// command the lifecycle does not allow is a setup error with its name: the
// grammar never generates one, so a fixed history or a grammar change that does is
// caught here.

type Owed = {
  snapshot: Snapshot
  accepted?: boolean
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
    // TransactionExecutor settles a failed transaction before asking for
    // more work: a retry update, a terminal removal, or a retry update whose
    // transaction is then removed comes straight after the failure.
    if (
      model.retryableId &&
      command.type !== `retry` &&
      command.type !== `complete` &&
      command.type !== `retryRemoved`
    )
      illegal(`a failure must be settled before anything else`)
    if (command.type === `schedule`) {
      // Model law: a duplicate schedule of a pending ID is rejected, so the first record keeps
      // its place, creation time, and payload.
      extra.accepted = !model.pending.some(
        ({ transaction }) => transaction.id === idOf(command.slot),
      )
      if (extra.accepted)
        model.pending.push({
          transaction: createTransaction(
            idOf(command.slot),
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
      model.retryableId = undefined
    } else if (command.type === `release`) {
      if (!model.activeId) illegal(`no active work`)
      model.activeId = undefined
    } else if (command.type === `fail`) {
      if (!model.activeId) illegal(`no active work`)
      model.retryableId = model.activeId
    } else if (command.type === `retry` || command.type === `retryRemoved`) {
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
      // Between the update and the release, the transaction is still active.
      owed.set(`${index}: ${command.type} update`, {
        snapshot: expectedSnapshot(model),
      })
      if (command.type === `retryRemoved`)
        model.pending = model.pending.filter(
          ({ transaction }) => transaction.id !== model.retryableId,
        )
      model.activeId = undefined
      model.retryableId = undefined
    } else if (command.type === `bulkUpdate`) {
      for (const entry of model.pending)
        entry.transaction = {
          ...entry.transaction,
          ...(command.reset ? { nextAttemptAt: model.now } : {}),
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
      // Reach records what production did, after it did it.
      const reached = (state: string) => observe(`reach`, state)
      if (command.type === `schedule`) {
        const crowded = scheduler.getPendingCount() >= 6
        const id = idOf(command.slot)
        extra.accepted = scheduler.schedule(
          createTransaction(
            id,
            BASE_TIME + command.createdAt * 1000,
            Date.now() + command.delay * 1000,
            command.payload,
          ),
        )
        reached(`schedule`)
        if (!extra.accepted && crowded) reached(duplicateWhenCrowded)
        if (!extra.accepted && active?.id === id)
          reached(`duplicate of the active ID`)
      } else if (command.type === `getNext`) {
        const next = scheduler.getNext()
        reached(`getNext`)
        const [head, sibling] = scheduler.getAllPendingTransactions()
        if (
          !next &&
          scheduler.getRunningCount() === 0 &&
          head &&
          sibling &&
          head.nextAttemptAt > Date.now() &&
          sibling.nextAttemptAt <= Date.now()
        )
          reached(`blocked head with a ready sibling`)
      } else if (command.type === `start`) {
        const next = scheduler.getNext()
        extra.started = next
          ? { id: next.id, payload: next.metadata?.payload }
          : undefined
        if (next) {
          scheduler.markStarted(next)
          reached(`start`)
        }
        active = next && cloneTransaction(next)
      } else if (command.type === `complete`) {
        if (active) {
          scheduler.markCompleted(active)
          reached(`complete`)
        }
        active = undefined
      } else if (command.type === `release`) {
        if (active) {
          scheduler.markFailed(active)
          reached(`release`)
        }
        active = undefined
      } else if (command.type === `retry` || command.type === `retryRemoved`) {
        if (active) {
          scheduler.updateTransaction({
            ...cloneTransaction(active),
            retryCount: active.retryCount + 1,
            nextAttemptAt: Date.now() + command.delay * 1000,
            metadata: { payload: command.payload },
          })
          observe(`${index}: ${command.type} update`, {
            snapshot: snapshotOf(scheduler),
          })
          // TransactionExecutor removes a transaction whose outbox row is
          // gone, then releases it in its finally block.
          if (command.type === `retryRemoved`) scheduler.markCompleted(active)
          scheduler.markFailed(active)
          reached(command.type)
        }
        active = undefined
      } else if (command.type === `bulkUpdate`) {
        scheduler.updateTransactions(
          scheduler.getAllPendingTransactions().map((transaction) => ({
            ...cloneTransaction(transaction),
            ...(command.reset ? { nextAttemptAt: Date.now() } : {}),
            metadata: { payload: command.payload },
          })),
        )
        reached(`bulkUpdate`)
      } else if (command.type === `advance`) {
        vi.advanceTimersByTime(command.duration * 1000)
        reached(`advance`)
      } else if (command.type === `remove`) {
        const held = new Set(
          scheduler.getAllPendingTransactions().map(({ id }) => id),
        )
        if (command.ids.some((id) => !held.has(id)))
          reached(`removal names an unheld ID`)
        if (
          active &&
          command.ids.includes(active.id) &&
          command.ids.some((id) => id !== active!.id && held.has(id))
        )
          reached(`removal names the active ID and a waiting sibling`)
        extra.removed = scheduler.removePendingTransactions(command.ids)
        reached(`remove`)
      } else if (command.type === `clear`) {
        if (scheduler.getRunningCount() === 1) reached(`clear while active`)
        scheduler.clear()
        reached(`clear`)
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
        `dedupe`,
        seen.accepted,
        expected.accepted,
        `schedule reported another acceptance`,
      ) ??
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
  `retryRemoved`,
  `release`,
  `bulkUpdate`,
  `remove`,
  `advance`,
  `complete`,
  `clear`,
] as const
// Situations the laws turn on, recorded by the driver from production.
const observedStates = [
  `clear while active`,
  `duplicate of the active ID`,
  `removal names an unheld ID`,
  `removal names the active ID and a waiting sibling`,
  `blocked head with a ready sibling`,
] as const
// The driver records no reach for a failure: the scheduler sees a failure
// only through the update and release that settle it.
const executedCommands = commandTypes.filter((type) => type !== `fail`)
// A history enters this state when it duplicates a pending ID. Production
// marks it with a probe, so its reach is an agreement between model and
// production.
const duplicateSchedule = `duplicate schedule`
// The driver records a duplicate that production rejected with six or more
// transactions pending; the grammar bound is seven, and production has none.
const duplicateWhenCrowded = `duplicate schedule with six or more pending`
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
    // Reach records are not ledger records, so no corruption applies to them.
    const at = trace.findIndex(
      ({ checkpoint, value }) =>
        checkpoint !== `reach` &&
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
    statement: `KeyScheduler is one globally serial FIFO queue: equal creation times keep scheduling order, a delayed head blocks younger work, a failure updates retry data before releasing the active transaction without moving it, replay reconciliation retires only unissued IDs, clear retires all work and leaves the scheduler reusable, a removal returns the requested IDs other than the active one, which TransactionExecutor rejects, and a duplicate schedule of a pending ID returns false.`,
    authority: `the established KeyScheduler FIFO tests and TransactionExecutor's calling order (packages/offline-transactions/src/executor); for duplicate schedules, TransactionExecutor's outbox replay, which uses schedule's result to find newly loaded transactions`,
    limits: `Persistence, caller promise settlement, leadership, and real timers have separate owners; no fairness beyond FIFO order; at most seven pending IDs, a grammar bound (production has none); creation times never change after scheduling (maintainer decision, 2026-11-04), so no update changes one; the executor's promise that reloaded work can run at once belongs to the outbox replay owner; keeping the first record on a duplicate schedule awaits a maintainer decision.`,
  },
  histories: {
    arbitrary: legalHistory,
    states: [
      {
        name: duplicateSchedule,
        probe: `offline-transactions#duplicate-schedule`,
      },
      duplicateWhenCrowded,
    ],
    measured: [...commandTypes, ...observedStates],
    constructed: [
      {
        name: `six pending, then a duplicate`,
        enters: [duplicateSchedule, duplicateWhenCrowded],
        // Six schedules and a seventh that duplicates tx-0; the generated
        // tokens then continue from that state, cut so the whole history
        // stays within the grammar's 50 tokens.
        build: (generated: Array<Command>) => {
          const prefix = tokensOf([
            schedule(0, 0, 0, 1),
            schedule(1, 1, 0, 1),
            schedule(2, 2, 0, 1),
            schedule(3, 3, 0, 1),
            schedule(4, 0, 0, 1),
            schedule(5, 1, 0, 1),
            schedule(0, 2, 0, 2),
          ])
          return buildLegalHistory([
            ...prefix,
            ...tokensOf(generated).slice(0, 50 - prefix.length),
          ])
        },
      },
    ],
    runs: 150,
    fixedSeeds: [1815],
    fixed: [
      {
        name: `every executed command`,
        enters: executedCommands.filter(
          (type) => type !== `retryRemoved` && type !== `release`,
        ),
        history: [
          schedule(0, 0, 0, 1),
          schedule(1, 0, 0, 2),
          { type: `getNext` },
          { type: `start` },
          { type: `remove`, ids: [`tx-0`, `tx-1`, `missing`] },
          { type: `fail` },
          { type: `retry`, delay: 2, payload: 3 },
          { type: `getNext` },
          { type: `bulkUpdate`, payload: 4, reset: false },
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
          { type: `retry`, delay: 5, payload: 3 },
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
      {
        name: `a duplicate schedule with another creation time and payload`,
        enters: [`schedule`, duplicateSchedule, `start`],
        history: [
          schedule(0, 2, 0, 1),
          schedule(1, 1, 0, 2),
          // tx-0 again, now older and with another payload: it is ignored, so
          // tx-1 stays first and tx-0 keeps payload 1.
          schedule(0, 0, 0, 5),
          { type: `start` },
        ],
      },
      {
        name: `a release, a terminal failure, and a removed retry`,
        enters: [`release`, `complete`, `retryRemoved`],
        history: [
          schedule(0, 0, 0, 1),
          schedule(1, 1, 0, 1),
          { type: `start` },
          // A storage failure releases tx-0 without an update.
          { type: `release` },
          { type: `start` },
          // A terminal failure removes tx-0.
          { type: `fail` },
          { type: `complete` },
          { type: `start` },
          // tx-1's retry update lands, then its outbox row is gone.
          { type: `fail` },
          { type: `retryRemoved`, delay: 1, payload: 2 },
        ],
      },
      {
        name: `a bulk deadline reset makes a delayed head eligible`,
        enters: [`bulkUpdate`, `start`],
        history: [
          schedule(0, 0, 3, 1),
          { type: `getNext` },
          { type: `bulkUpdate`, payload: 1, reset: true },
          { type: `start` },
        ],
      },
      {
        name: `missing scheduled after a replay snapshot named it`,
        enters: [`remove`, `schedule`],
        history: [
          schedule(0, 0, 0, 1),
          // The snapshot names tx-0 and missing; the scheduler holds only tx-0.
          { type: `remove`, ids: [`tx-0`, `missing`] },
          schedule(MISSING_SLOT, 0, 0, 2),
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
  // The scheduler marks a duplicate schedule with a probe; the model predicts
  // it from its own ledger, so the two must agree in every history.
  predict: (history) => ({
    [duplicateSchedule]: [...ledgerModel(history).values()].some(
      ({ accepted }) => accepted === false,
    ),
  }),
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
      name: `a duplicate schedule is accepted`,
      law: `dedupe`,
      corrupt: corruptFirst((value) =>
        value.accepted === false ? { ...value, accepted: true } : undefined,
      ),
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
