/**
 * A Collection may retire only after every subscriber, preload and persisting
 * transaction has released it for gcTime. A startup without subscribers, or a
 * settled preload, additionally establishes a 50ms handoff deadline. A real
 * last unsubscribe removes that handoff constraint. These are the promises in
 * BaseCollectionConfig.gcTime; pending rollback preserves the existing deadline
 * by the maintainer's decision in the PR 2258 review evaluation.
 *
 * Eligibility and delivery differ: elapsed time can make cleanup eligible, but
 * only a host idle opportunity with time (or a timed-out opportunity) retires
 * it. An idle opportunity from an obsolete deadline has no special authority.
 * Explicit cleanup ignores every hold. Non-positive/non-finite gcTime disables
 * automatic retirement. Exact provider scheduling latency is not promised.
 * The public retention law forbids early retirement; it does not require the
 * first usable idle callback to retire the Collection. This controlled fixture
 * additionally checks the current appointment-driven delivery at its nominated
 * usable idle cuts. The reducer's exact retirement cut describes that fixture,
 * not a new general host-liveness promise.
 * Cleanup clears rows at cleanup start. Explicit cleanup also clears them while
 * a transaction persists. Public status retires only after adapter cleanup settles,
 * as specified by Collection.cleanup() and the glossary's cleanup boundary.
 *
 * The reference keeps only logical holds, their last release, and the absolute
 * handoff deadline. It imports no production lifecycle or scheduler. `ready`
 * below means the controlled source called markReady, not subscription status.
 * A legal next unsubscribe distinguishes subscriber multiplicity; settlement
 * distinguishes pending from persisting and one transaction from its sibling;
 * an idle delivery distinguishes a handoff deadline from an ordinary delay.
 * `cleanup-start` and `cleanup-settle` split the public cleanup operation at
 * the glossary's cleanup-start and cleanup-settlement boundaries. `cleanup`
 * keeps the same operation atomic for drivers whose adapter stops at once.
 * `cleaningUp` is the model's projection of that held adapter interval.
 * An idle action with cleanupPending starts that interval instead of publishing
 * retirement. Adapter success or rejection ends it through cleanup-settle.
 * The mutation receiving driver uses `mutate` to admit an optimistic transaction
 * with its own independently computed row projection; `insert` is the original
 * fresh-key admission shorthand. Both have the same lifetime rule.
 * A pending manual transaction has no GC hold. Its caller can retain the
 * Collection with a subscription. This owner checks that retained path and the
 * ordinary delay after unsubscribe; it excludes restart and owes no optimistic
 * restoration across cleanup under the maintainer's PR 2258 decision.
 *
 * The Node property and native-browser receiver use this same reducer and
 * public-observation checker. Neither actual callbacks nor queue state compute
 * expected eligibility. The controlled driver can hold idle opportunities; the
 * native receiver must prove that the browser supplied the queued opportunity.
 */
export type GcAction =
  | { kind: `subscribe` }
  | { kind: `unsubscribe` }
  | { kind: `insert`; commit: boolean }
  | { kind: `mutate`; commit: boolean }
  | { kind: `commit`; slot: number }
  | { kind: `settle`; slot: number; outcome: `complete` | `fail` }
  | { kind: `rollback`; slot: number }
  | { kind: `preload` }
  | { kind: `ready` }
  | { kind: `preload-failure` }
  | { kind: `advance`; elapsedMs: number }
  | {
      kind: `idle`
      hasTime: boolean
      didTimeout: boolean
      cleanupPending?: boolean
    }
  | { kind: `cleanup` }
  | { kind: `cleanup-start` }
  | { kind: `cleanup-settle` }

export type GcModel = {
  gcTime: number
  now: number
  subscribers: number
  preload: boolean
  ready: boolean
  transactions: Array<`pending` | `persisting` | `completed` | `failed`>
  handoffUntil: number
  releasedAt: number
  retired: boolean
  // Cleanup's synchronous row discard precedes its public retirement.
  cleaningUp: boolean
}

export function createGcModel(gcTime: number, ready = true): GcModel {
  return {
    gcTime,
    now: 0,
    subscribers: 0,
    preload: false,
    ready,
    transactions: [],
    handoffUntil: 50,
    releasedAt: 0,
    retired: false,
    cleaningUp: false,
  }
}

export function gcHeld(model: GcModel): boolean {
  return (
    model.cleaningUp ||
    model.subscribers > 0 ||
    model.preload ||
    model.transactions.includes(`persisting`)
  )
}

export function gcDeadline(model: GcModel): number {
  if (gcHeld(model) || model.gcTime <= 0 || !Number.isFinite(model.gcTime))
    return Infinity
  return Math.max(model.releasedAt + model.gcTime, model.handoffUntil)
}

// Invalid actions are excluded constructively by the history interpreter.
// In particular a pending transaction cannot settle its unstarted handler.
export function gcActionLegal(model: GcModel, action: GcAction): boolean {
  if (action.kind === `cleanup`) return true
  // Old transactions can settle after their Collection retires. They must not
  // republish rows; new admission and restart remain outside this grammar.
  if (
    model.retired &&
    ![`settle`, `rollback`, `advance`, `idle`].includes(action.kind)
  )
    return false
  if (action.kind === `cleanup-settle`) return model.cleaningUp
  if (
    model.cleaningUp &&
    ![`settle`, `rollback`, `advance`, `idle`].includes(action.kind)
  )
    return false
  switch (action.kind) {
    case `preload-failure`:
      return model.preload
    case `unsubscribe`:
      return model.subscribers > 0
    case `commit`:
      return model.transactions[action.slot] === `pending`
    case `settle`:
      return model.transactions[action.slot] === `persisting`
    case `rollback`:
      return [`pending`, `persisting`].includes(
        model.transactions[action.slot] ?? ``,
      )
    default:
      return true
  }
}

export function stepGcModel(model: GcModel, action: GcAction): void {
  if (!gcActionLegal(model, action))
    throw new Error(`Illegal GC action: ${JSON.stringify(action)}`)
  const wasHeld = gcHeld(model)
  switch (action.kind) {
    case `subscribe`:
      model.subscribers++
      break
    case `unsubscribe`:
      model.subscribers--
      if (model.subscribers === 0) model.handoffUntil = 0
      break
    case `insert`:
    case `mutate`:
      model.transactions.push(action.commit ? `persisting` : `pending`)
      break
    case `commit`:
      model.transactions[action.slot] = `persisting`
      break
    case `settle`:
      model.transactions[action.slot] =
        action.outcome === `complete` ? `completed` : `failed`
      break
    case `rollback`:
      model.transactions[action.slot] = `failed`
      break
    case `preload`:
      if (model.ready) {
        model.handoffUntil = model.now + 50
        model.releasedAt = model.now
      } else model.preload = true
      break
    case `ready`:
      model.ready = true
      if (model.preload) {
        model.preload = false
        model.handoffUntil = model.now + 50
      }
      break
    case `preload-failure`:
      // Failure releases the same preload hold as success. It does not
      // establish source readiness, and this grammar ends in cleanup.
      model.preload = false
      model.handoffUntil = model.now + 50
      break
    case `advance`:
      model.now += action.elapsedMs
      break
    case `idle`:
      if (
        (action.hasTime || action.didTimeout) &&
        model.now >= gcDeadline(model)
      ) {
        if (action.cleanupPending) model.cleaningUp = true
        else model.retired = true
      }
      break
    case `cleanup`:
      model.retired = true
      model.cleaningUp = false
      break
    case `cleanup-start`:
      model.cleaningUp = true
      break
    case `cleanup-settle`:
      model.cleaningUp = false
      model.retired = true
      break
  }
  if (wasHeld && !gcHeld(model)) model.releasedAt = model.now
}

export type GcObservation = {
  retired: boolean
  visibleKeys: Array<number>
  transactionStates: Array<string>
}

// Check status and exact public membership at the same cut. Core/native sources
// supply no durable rows, so only pending/persisting inserts remain visible.
// A provider driver can supply independently established source keys; these
// never come from the observed Collection. Cleanup clears every row at its
// synchronous start, even if a transaction stays active while the adapter stops.
export function checkGcObservation(
  model: GcModel,
  actual: GcObservation,
  checkpoint: string,
  sourceKeys: ReadonlyArray<number> = [],
  // A receiving driver may independently project update/delete/merged intent.
  // This input must never come from the observed Collection or production merger.
  expectedKeys?: ReadonlyArray<number>,
): void {
  const fail = (message: string): never => {
    throw new Error(`${checkpoint} at ${model.now}ms: ${message}`)
  }
  if (actual.retired !== model.retired)
    fail(`retired expected ${model.retired}, got ${actual.retired}`)
  if (actual.transactionStates.join() !== model.transactions.join())
    fail(`transaction phases disagree`)
  if (model.retired || model.cleaningUp) {
    if (actual.visibleKeys.length)
      fail(`cleanup left visible rows: ${actual.visibleKeys.join()}`)
    return
  }
  const expected = new Set(expectedKeys ?? sourceKeys)
  if (expectedKeys === undefined)
    for (const [slot, state] of model.transactions.entries())
      if (state === `pending` || state === `persisting`) expected.add(slot + 1)
  if (
    actual.visibleKeys.length !== expected.size ||
    [...expected].some((key) => !actual.visibleKeys.includes(key))
  )
    fail(
      `visible keys expected [${[...expected].join()}], got [${actual.visibleKeys.join()}]`,
    )
}
