/**
 * # Does a complete eager reload replace retained rows?
 *
 * A reload keeps the previous public rows until its new sync run supplies a
 * complete result. That result determines the new keyed rows and values,
 * including deletions. Authority: the glossary's reload/snapshot contract,
 * source-health-oracle.test.ts's opt-in snapshot law, and READY-3/PUB-7 of the
 * eager-source contract. The adapter chooses replacement; core never infers it
 * merely from reload. This receiving grammar reuses the startup owner's
 * independent complete-result set judgment, without a second replacement model.
 *
 * Unwrapped receivers matter: persistence independently selects a snapshot and
 * would mask a broken retained-row predicate. The provider changes between SDK
 * subscriptions, so later change events cannot repair an omitted-row defect.
 * A disjoint optimistic insert may persist during delivery. Its settlement
 * drops its unconfirmed row (optimistic-history-oracle.ts). The law permits
 * either core-legal application schedule while that transaction persists.
 *
 * Limits: three source keys, numeric values, one fresh load or one reload, one
 * disjoint optimistic insert, and real local SDK reads. No remote replication,
 * persistence durability, arbitrary concurrent mutations, or every intermediate
 * publication claim. Drivers record before-source and fulfillment cuts.
 */
import fc from 'fast-check'
import {
  expectedPersistedStartup,
  sortedStartupRows,
  startupRows,
} from './persisted-startup-oracle'
import type { StartupRow } from './persisted-startup-oracle'

export type EagerReloadHistory = {
  start: `fresh` | `reload`
  previous: number
  next: number
  mutation: boolean
}

// Fresh startup has no accepted baseline. Reload can retain an empty or
// nonempty baseline; every next subset is legal, including empty and overlap.
// Removing reload loses omissions from retained rows. Removing mutation loses
// the ordinary-commit versus snapshot scheduling boundary on an empty baseline.
// Full records preserve the three equally weighted lanes and permit the
// framework to validate/shrink fixed and constructed histories without context.
const reloadSuffix = {
  next: fc.integer({ min: 0, max: 7 }),
  mutation: fc.boolean(),
}
export const eagerReloadHistoryArb: fc.Arbitrary<EagerReloadHistory> = fc.oneof(
  fc.record({
    start: fc.constant(`fresh` as const),
    previous: fc.constant(0),
    ...reloadSuffix,
  }),
  fc.record({
    start: fc.constant(`reload` as const),
    previous: fc.constant(0),
    ...reloadSuffix,
  }),
  fc.record({
    start: fc.constant(`reload` as const),
    previous: fc.integer({ min: 1, max: 7 }),
    ...reloadSuffix,
  }),
)

export const eagerReloadHistories: Array<EagerReloadHistory> = [
  { start: `fresh` as const, previous: 0 },
  ...[0, 1, 3].map((previous) => ({ start: `reload` as const, previous })),
].flatMap((prefix) =>
  [0, 2, 3].flatMap((next) =>
    [false, true].map((mutation) => ({ ...prefix, next, mutation })),
  ),
)

export const eagerReloadStates = [
  `fresh`,
  `reload-empty`,
  `reload-retained`,
  `empty-result`,
  `omitted-row`,
  `changed-overlap`,
  `persisting-mutation`,
  `no-mutation`,
  `fresh-held`,
  `reload-empty-held`,
  `reload-retained-held`,
] as const
export function eagerReloadReached(
  h: EagerReloadHistory,
): Array<(typeof eagerReloadStates)[number]> {
  const reached: Array<(typeof eagerReloadStates)[number]> = [
    h.start === `fresh`
      ? `fresh`
      : h.previous
        ? `reload-retained`
        : `reload-empty`,
    h.mutation ? `persisting-mutation` : `no-mutation`,
  ]
  if (h.next === 0) reached.push(`empty-result`)
  if (h.previous & ~h.next) reached.push(`omitted-row`)
  if (h.previous & h.next) reached.push(`changed-overlap`)
  if (h.mutation)
    reached.push(
      h.start === `fresh`
        ? `fresh-held`
        : h.previous
          ? `reload-retained-held`
          : `reload-empty-held`,
    )
  return reached
}
export type EagerReloadObservation = {
  before: Array<StartupRow>
  beforeStatus: string
  settledBeforeSource: boolean
  submittedRows: number
  submittedCommits: number
  acceptedCommits: number
  atFulfillment: Array<StartupRow>
  mutationReleasedBeforeFulfillment: boolean
  mutationSettledBeforeFulfillment: boolean
  final: Array<StartupRow>
  error?: string
}
// The same pure row judgment supplies the browser checker and the framework.
// It predicts only from authored source membership and the optimistic lane;
// no commit count or observed production schedule enters this computation.
export function eagerReloadModel(h: EagerReloadHistory) {
  return {
    initial: sortedStartupRows([
      ...startupRows(h.previous, 1),
      ...(h.mutation ? [{ id: `optimistic`, value: 99 }] : []),
    ]),
    source: expectedPersistedStartup(
      {
        previous: h.previous,
        next: h.next,
        peer: false,
        response: `after-restore`,
      },
      `collection`,
    ).rows,
    retained: startupRows(h.previous, 1),
    states: eagerReloadReached(h),
  }
}
export function eagerReloadViolations(
  h: EagerReloadHistory,
  observed: EagerReloadObservation,
  expected = eagerReloadModel(h),
): Array<string> {
  const violations: Array<string> = []
  const { initial, source: expectedRows, retained } = expected
  const equal = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b)

  if (!equal(observed.before, initial)) violations.push(`before-source rows`)
  if (observed.beforeStatus !== (h.start === `reload` ? `ready` : `loading`))
    violations.push(`before-source status`)
  if (observed.settledBeforeSource)
    violations.push(`settled before source entry`)
  if (observed.error !== undefined)
    violations.push(`source failed: ${observed.error}`)
  if (
    observed.submittedRows < expectedRows.length ||
    observed.submittedCommits === 0
  )
    violations.push(`complete source submission not reached`)
  if (observed.acceptedCommits !== observed.submittedCommits)
    violations.push(`source acceptance not reached`)
  // An optimistic overlay remains public until settlement. Releasing its
  // external persistence gate can race load fulfillment, so after release
  // either overlay presence is legal at that cut. Readiness carries acceptance,
  // not visibility: while that mutation is unsettled, an ordinary transaction
  // can leave the old baseline public, while a snapshot can already replace it.
  // Each whole source projection must fit one of those two legal schedules.
  // After settlement and applied receipts, only the complete result is legal.
  const fulfillmentSource = observed.atFulfillment.filter(
    (row) => row.id !== `optimistic`,
  )
  const overlay = observed.atFulfillment.filter(
    (row) => row.id === `optimistic`,
  )
  if (
    !equal(fulfillmentSource, expectedRows) &&
    !(
      h.mutation &&
      !observed.mutationSettledBeforeFulfillment &&
      equal(fulfillmentSource, retained)
    )
  )
    violations.push(`fulfillment source rows`)
  if (
    (!h.mutation && overlay.length > 0) ||
    (overlay.length > 0 && !equal(overlay, [{ id: `optimistic`, value: 99 }]))
  )
    violations.push(`fulfillment optimistic overlay`)
  if (
    h.mutation &&
    !observed.mutationReleasedBeforeFulfillment &&
    overlay.length !== 1
  )
    violations.push(`pending optimistic overlay disappeared`)
  if (!equal(observed.final, expectedRows)) violations.push(`final rows`)
  return violations
}
