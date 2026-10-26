/**
 * A Collection may retire only after every subscriber, preload and persisting
 * transaction has released it for gcTime. A startup without subscribers, or a
 * completed preload, additionally establishes a 50ms handoff deadline. A real
 * last unsubscribe removes that handoff constraint. These are the promises in
 * BaseCollectionConfig.gcTime; pending rollback preserves the existing deadline
 * by the maintainer's decision in the PR 2258 review evaluation.
 *
 * Eligibility and delivery differ: elapsed time can make cleanup eligible, but
 * only a host idle opportunity with time (or a timed-out opportunity) retires
 * it. An idle opportunity from an obsolete deadline has no special authority.
 * Explicit cleanup ignores every hold. Non-positive/non-finite gcTime disables
 * automatic retirement. Exact provider scheduling latency is not promised.
 *
 * The reference keeps only logical holds, their last release, and the absolute
 * handoff deadline. It imports no production lifecycle or scheduler. `ready`
 * below means the controlled source called markReady, not subscription status.
 * A legal next unsubscribe distinguishes subscriber multiplicity; settlement
 * distinguishes pending from persisting and one transaction from its sibling;
 * an idle delivery distinguishes a handoff deadline from an ordinary delay.
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
  | { kind: `commit`; slot: number }
  | { kind: `settle`; slot: number; outcome: `complete` | `fail` }
  | { kind: `rollback`; slot: number }
  | { kind: `preload` }
  | { kind: `ready` }
  | { kind: `advance`; elapsedMs: number }
  | { kind: `idle`; hasTime: boolean; didTimeout: boolean }
  | { kind: `cleanup` }

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
  }
}

export function gcHeld(model: GcModel): boolean {
  return (
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
  if (model.retired) return false
  switch (action.kind) {
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
    case `advance`:
      model.now += action.elapsedMs
      break
    case `idle`:
      if (
        (action.hasTime || action.didTimeout) &&
        model.now >= gcDeadline(model)
      )
        model.retired = true
      break
    case `cleanup`:
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

// Check the actual status and every active optimistic row at the same cut.
// A completed insert is not durable in this no-confirmation source; only
// pending/persisting rows are promised, and explicit cleanup discards them.
export function checkGcObservation(
  model: GcModel,
  actual: GcObservation,
  checkpoint: string,
): void {
  const fail = (message: string): never => {
    throw new Error(`${checkpoint} at ${model.now}ms: ${message}`)
  }
  if (actual.retired !== model.retired)
    fail(`retired expected ${model.retired}, got ${actual.retired}`)
  if (actual.transactionStates.join() !== model.transactions.join())
    fail(`transaction phases disagree`)
  if (model.retired) return
  for (const [slot, state] of model.transactions.entries()) {
    if (
      (state === `pending` || state === `persisting`) &&
      !actual.visibleKeys.includes(slot + 1)
    )
      fail(`active optimistic row ${slot + 1} is missing`)
  }
}
