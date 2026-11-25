/**
 * # Who owns work returned by PowerSync load hooks?
 *
 * Eager onLoad gates the initial SQLite read. A throwing or rejected hook fails
 * initial loading; a successful hook admits that read. onLoadSubset instead
 * belongs to its acquisition attempt: failure rejects that attempt and leaves
 * the ready source's health unchanged. A successful subset load waits for its
 * rows' applied receipts, including when optimistic work holds their visibility.
 *
 * Cleanup owns every hook already entered. It waits for a pending hook and
 * invokes the cleanup callback it later returns once. Releasing a subset while
 * its hook is pending also owns that eventual callback and admits no rows.
 * An asynchronous returned cleanup remains owned until it settles.
 *
 * Authority: native EagerSyncHooks/OnDemandSyncHooks, the glossary's cleanup,
 * acquisition release and applied settlement contracts. These histories do not
 * model remote Sync Streams, transport health, a permanently unsettled user
 * promise, failing cleanup callbacks, reload or concurrent subset owners.
 */
import fc from 'fast-check'
import { startupRows } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'

export type HookHistory = {
  mode: `eager` | `on-demand`
  completion: `sync` | `async` | `throw` | `reject`
  retirement: `settled` | `cleanup-pending` | `release-pending`
  asynchronousCleanup: boolean
  holdApplied: boolean
  rows: number
  coordinate: number
}

// Pending retirement needs a pending successful hook; a failure owns no
// returned cleanup. Applied settlement is a subset law, so only an active
// successful on-demand attempt can hold the optimistic publication boundary.
export function legalHookHistory(h: HookHistory): HookHistory {
  const retirement =
    h.mode === `eager` && h.retirement === `release-pending`
      ? `cleanup-pending`
      : h.retirement
  const completion = retirement === `settled` ? h.completion : `async`
  const success = completion === `sync` || completion === `async`
  return {
    ...h,
    retirement,
    completion,
    asynchronousCleanup: success && h.asynchronousCleanup,
    holdApplied:
      h.mode === `on-demand` &&
      retirement === `settled` &&
      success &&
      h.holdApplied,
  }
}
export const hookHistoryArb = fc
  .record({
    mode: fc.constantFrom(`eager` as const, `on-demand` as const),
    completion: fc.constantFrom(
      `sync` as const,
      `async` as const,
      `throw` as const,
      `reject` as const,
    ),
    retirement: fc.constantFrom(
      `settled` as const,
      `cleanup-pending` as const,
      `release-pending` as const,
    ),
    asynchronousCleanup: fc.boolean(),
    holdApplied: fc.boolean(),
    rows: fc.integer({ min: 0, max: 7 }),
    coordinate: fc.nat({ max: 100_000 }),
  })
  .map(legalHookHistory, (h) => h as HookHistory)

export const hookStates = [
  `eager:sync`,
  `eager:async`,
  `eager:throw`,
  `eager:reject`,
  `eager:cleanup-pending`,
  `on-demand:sync`,
  `on-demand:async`,
  `on-demand:throw`,
  `on-demand:reject`,
  `on-demand:cleanup-pending`,
  `on-demand:release-pending`,
  `applied-held`,
  `asynchronous-cleanup`,
  `empty-source`,
  `nonempty-source`,
] as const
export type HookState = (typeof hookStates)[number]
export type HookObservation = {
  cleanupErrors?: ReadonlyArray<string>
  browserErrors?: ReadonlyArray<string>
  entered: boolean
  load: string
  loadErrorMatches: boolean
  statusAfterHook: string
  errorAfterHook: boolean
  rowsAfterHook: Array<StartupRow>
  rowsAtFulfillment: Array<StartupRow>
  cleanupCalls: number
  cleanupWaitedForHook: boolean
  cleanupWaitedForReturnedCleanup: boolean
  appliedReceiptHeld: boolean
  loadPendingAtAppliedHold: boolean
  finalStatus: string
  finalRows: Array<StartupRow>
  watcherReleases: Array<number>
  reached: Array<HookState>
}

// Hook ownership depends on the authored outcome and retirement, rather than
// the adapter's demand records or trigger revisions. The source row mask is
// independent input; callback count is one token returned by a successful hook.
export function hookLifecycleModel(h: HookHistory) {
  const successful = h.completion === `sync` || h.completion === `async`
  return {
    successful,
    rows: startupRows(h.rows, 2),
    cleanupCalls: successful ? 1 : 0,
    load: successful ? `fulfilled` : `rejected`,
    statusAfterHook: h.mode === `eager` && !successful ? `error` : `ready`,
    errorAfterHook: !successful && h.mode === `eager`,
  }
}
export function hookLifecycleViolations(
  h: HookHistory,
  a: HookObservation,
): Array<string> {
  const m = hookLifecycleModel(h)
  const errors: Array<string> = (a.browserErrors ?? []).map(
    (message) => `browser error: ${message}`,
  )
  const same = (left: unknown, right: unknown) =>
    JSON.stringify(left) === JSON.stringify(right)
  if (!a.entered) errors.push(`hook never entered`)
  if (h.retirement === `settled`) {
    if (a.load !== m.load) errors.push(`hook load outcome differs`)
    if (!m.successful && !a.loadErrorMatches)
      errors.push(`hook rejection lost its cause`)
    if (
      a.statusAfterHook !== m.statusAfterHook ||
      a.errorAfterHook !== m.errorAfterHook
    )
      errors.push(`hook failure crossed the wrong readiness/health boundary`)
    const rows = m.successful ? m.rows : []
    if (!same(a.rowsAfterHook, rows)) errors.push(`rows after hook differ`)
    if (m.successful && !same(a.rowsAtFulfillment, rows))
      errors.push(`load fulfilled before its rows applied`)
  } else {
    if (a.rowsAfterHook.length) errors.push(`retired hook published rows`)
    if (h.retirement === `cleanup-pending` && !a.cleanupWaitedForHook)
      errors.push(`cleanup settled before its pending hook`)
  }
  if (a.cleanupCalls !== m.cleanupCalls)
    errors.push(`returned cleanup ownership differs`)
  if (h.asynchronousCleanup && !a.cleanupWaitedForReturnedCleanup)
    errors.push(`cleanup abandoned asynchronous returned cleanup`)
  if (h.holdApplied && (!a.appliedReceiptHeld || !a.loadPendingAtAppliedHold))
    errors.push(`subset load escaped its actual held applied receipt`)
  if (a.finalStatus !== `cleaned-up` || a.finalRows.length)
    errors.push(`final cleanup snapshot differs`)
  if (
    !a.watcherReleases.length ||
    a.watcherReleases.some((count) => count !== 1)
  )
    errors.push(`change watcher ownership differs`)
  return errors
}
