/**
 * Persisted baseline work does not extend a retired sync run's authority.
 * LIFE-2/5 and HEALTH-5 remain the shared eager-source owner's laws. This
 * receiver adds their provider/persistence crossing, not a lifecycle machine.
 *
 * The retirement check is a differential law. First settle every underlying
 * accepted receipt, then retire the run while its acknowledgment or genuine
 * hydrateBaseline completion remains held. Releasing that continuation cannot
 * change the replacement's rows, readiness or health. Durable accepted rows
 * remain owed. A subsequent complete result uses the existing TrailBase
 * hydration projection's independent row judgment.
 *
 * Limits: three keys, one old run and one replacement, default rendering for
 * injected failures, local PowerSync/RxDB providers and one persistence store.
 * A delayed adapter acknowledgment does not delay application. Its reach is
 * distinct from a candidate's explicit hydrateBaseline await. No internal-work
 * bound, provider service, arbitrary concurrent mutation or I/O crash claim.
 */
import fc from 'fast-check'
import {
  expectedHydrationLifecycle,
  hydrationLifecycleRows,
} from '../../trailbase-db-collection/tests/lifecycle-hydration-oracle'
import type { HydrationLifecycleSnapshot } from '../../trailbase-db-collection/tests/lifecycle-hydration-oracle'

export type BaselineLifecycleHistory = {
  previous: number
  old: number
  replacement: number
  batchSize: number
  action:
    `cleanup` | `reload` | `source-fail` | `receipt-reject` | `stream-fail`
  initialRender: `default` | `network-first`
}
const memberships = {
  previous: fc.integer({ min: 0, max: 7 }),
  // Both providers commit an empty initial read as well as a nonempty one.
  old: fc.integer({ min: 0, max: 7 }),
  replacement: fc.integer({ min: 0, max: 7 }),
  batchSize: fc.integer({ min: 1, max: 2 }),
}
export const baselineLifecycleHistoryArb: fc.Arbitrary<BaselineLifecycleHistory> =
  fc.oneof(
    fc.record({
      ...memberships,
      action: fc.constantFrom(`cleanup` as const, `reload` as const),
      initialRender: fc.constantFrom(
        `default` as const,
        `network-first` as const,
      ),
    }),
    fc.record({
      ...memberships,
      action: fc.constantFrom(
        `source-fail` as const,
        `receipt-reject` as const,
      ),
      initialRender: fc.constant(`default` as const),
    }),
  )
export function baselineLifecycleArbitrary(streamFailure: boolean) {
  return streamFailure
    ? fc.oneof(
        baselineLifecycleHistoryArb,
        fc.record({
          ...memberships,
          action: fc.constant(`stream-fail` as const),
          initialRender: fc.constant(`default` as const),
        }),
      )
    : baselineLifecycleHistoryArb
}
export const baselineLifecycleHistories: Array<BaselineLifecycleHistory> = (
  [`cleanup`, `reload`, `source-fail`, `receipt-reject`] as const
).flatMap((action) =>
  [0, 6].map((replacement) => ({
    previous: 3,
    old: 1,
    replacement,
    batchSize: 1,
    action,
    initialRender: `default`,
  })),
)
export type BaselineLifecycleCut = HydrationLifecycleSnapshot & {
  healthError: string | null
  failureReason: string | null
}
export type BaselineLifecycleObservation = {
  before: BaselineLifecycleCut
  resumed: BaselineLifecycleCut
  replacement: HydrationLifecycleSnapshot
  afterEvent: HydrationLifecycleSnapshot
  oldPreload: string
  releases: Array<number>
  hookReleases: Array<number>
  hookAcquisitions: number
  reports: Array<string>
  providerDiagnostics: Array<{ message: string; causeIsInjected: boolean }>
  failureIdentity: boolean
  failureWhileHeld: {
    status: string
    identity: boolean
    reported: boolean
    preload: string
  }
  cleanupStartedBeforeRelease: boolean
  underlyingReceipts: number
  underlyingSettled: number
  candidateHydrateCalls: number
  candidateHydrateHeld: boolean
  baselineCompleted: boolean
  reached: Array<string>
  browserErrors?: ReadonlyArray<string>
}
export const baselineLifecycleStates = [
  `accepted-before-retirement`,
  `cleanup-held-continuation`,
  `reload-held-continuation`,
  `source-failure-held-baseline`,
  `receipt-rejection-held-baseline`,
  `empty-replacement`,
  `replacement-overlap`,
  `replacement-omits-old`,
] as const

// This is the existing hydration owner's complete-result judgment. The
// differential prefix deliberately predicts no source batching strategy.
export function baselineLifecycleExpected(h: BaselineLifecycleHistory) {
  return expectedHydrationLifecycle({
    previous: h.previous,
    old: h.old,
    replacement: h.replacement,
    oldList: `complete`,
    resumeAt: `replacement-ready`,
    initialRender: h.initialRender,
  })
}
export function baselineLifecycleViolations(
  h: BaselineLifecycleHistory,
  actual: BaselineLifecycleObservation,
  requireHydrateAwait = false,
): Array<string> {
  const violations: Array<string> = []
  const equal = (left: unknown, right: unknown) =>
    JSON.stringify(left) === JSON.stringify(right)
  if (!actual.baselineCompleted)
    violations.push(`premise: genuine baseline did not complete`)
  if (actual.underlyingReceipts !== actual.underlyingSettled)
    violations.push(`premise: accepted receipt obligations remain unsettled`)
  if (
    requireHydrateAwait &&
    h.action !== `source-fail` &&
    (!actual.candidateHydrateHeld || actual.candidateHydrateCalls !== 1)
  )
    violations.push(
      `premise: adapter hydrateBaseline continuation was not held`,
    )
  if (h.action === `cleanup` || h.action === `reload`) {
    if (!actual.cleanupStartedBeforeRelease)
      violations.push(`premise: cleanup did not retire the held continuation`)
    const expected =
      h.action === `cleanup`
        ? {
            rows: [],
            durable: actual.before.durable,
            status: `cleaned-up`,
            healthError: null,
            failureReason: null,
          }
        : actual.before
    if (!equal(actual.resumed, expected))
      violations.push(
        `LIFE-2/LIFE-5: obsolete continuation changed retired state`,
      )
    // Cleanup ends a preload with AbortError. Reload retains the Collection's
    // shared readiness promise; the replacement's readiness fulfills it.
    if (
      actual.oldPreload !==
      (h.action === `cleanup` ? `AbortError` : `fulfilled`)
    )
      violations.push(`LIFE-5: retired preload ${actual.oldPreload}`)
  } else {
    if (
      !actual.failureIdentity ||
      actual.resumed.healthError !== `injected source failure` ||
      actual.resumed.failureReason !== null
    )
      violations.push(`READY-4: source failure identity`)
    if (actual.resumed.status !== `error`)
      violations.push(`READY-4: source failure did not end initial load`)
    const acceptedRows =
      h.action === `source-fail`
        ? hydrationLifecycleRows(h.previous, 1)
        : actual.before.rows
    if (h.action === `receipt-reject`) {
      // A failed acknowledgment does not retire source authority by itself.
      // Reconciliation may accept omission deletes before fail() observes it.
      // Source rows already applied stay; omitted saved rows may stay or leave.
      const required = hydrationLifecycleRows(h.old, 2)
      const optional = hydrationLifecycleRows(h.previous & ~h.old, 1)
      const permitted = [...required, ...optional]
      if (
        !equal(actual.resumed.rows, actual.resumed.durable) ||
        required.some(
          (row) => !actual.resumed.rows.some((seen) => equal(row, seen)),
        ) ||
        actual.resumed.rows.some(
          (row) => !permitted.some((allowed) => equal(row, allowed)),
        )
      )
        violations.push(`receipt failure: invalid accepted source prefix`)
    } else if (
      !equal(actual.resumed.rows, acceptedRows) ||
      !equal(actual.resumed.durable, actual.before.durable)
    )
      violations.push(
        `accepted obligations changed after terminal source failure`,
      )
    if (actual.oldPreload !== `injected source failure`)
      violations.push(`READY-4: failed preload ${actual.oldPreload}`)
    // Pending persisted restore can defer public failure. The adapter still
    // reports its exact error and releases the failed provider while held.
    if (h.action === `source-fail` && !actual.failureWhileHeld.reported)
      violations.push(
        `READY-4: provider failure was not reported while restore remained held`,
      )
    if (
      h.action === `stream-fail` &&
      (actual.failureWhileHeld.status !== `error` ||
        !actual.failureWhileHeld.identity ||
        actual.failureWhileHeld.preload !== `injected source failure`)
    )
      violations.push(
        `READY-4: provider failure did not end loading while baseline remained held`,
      )
  }
  const expected = baselineLifecycleExpected(h)
  if (!equal(actual.replacement, expected.ready))
    violations.push(`replacement: complete eager result`)
  if (!equal(actual.afterEvent, expected.afterEvent))
    violations.push(`afterEvent: replacement source authority`)
  if (
    actual.releases.length !== 2 ||
    actual.releases.some((count) => count !== 1)
  )
    violations.push(`LIFE-2/LIFE-10: releases ${actual.releases}`)
  if (
    actual.hookReleases.length !== actual.hookAcquisitions ||
    actual.hookReleases.some((count) => count !== 1)
  )
    violations.push(`LIFE-2: load hook releases ${actual.hookReleases}`)
  if (actual.reports.length)
    violations.push(`HEALTH-5: ${actual.reports.join(`; `)}`)
  for (const diagnostic of actual.providerDiagnostics)
    if (
      (h.action !== `source-fail` && h.action !== `receipt-reject`) ||
      !diagnostic.causeIsInjected ||
      !diagnostic.message.startsWith(`Could not start syncing process for `)
    )
      violations.push(
        `HEALTH-5: unexpected provider diagnostic ${diagnostic.message}`,
      )
  return violations
}
