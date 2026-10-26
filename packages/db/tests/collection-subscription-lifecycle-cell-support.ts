import { declareOracle } from './oracle-config.js'

/**
 * Acquisition-boundary cells and scenario grammar for the demand lifecycle
 * oracle. The explicit cell table names every legal phase/entry pair and gives
 * a reason for every excluded pair. The scenario tables enumerate the start,
 * failure-delivery, release, and restart cases that the drivers run.
 *
 * This module holds shared definitions only. The law is owned by
 * collection-subscription-lifecycle-oracle.test.ts. The cell witnesses and
 * their coverage audit live in collection-subscription-lifecycle-cells.test.ts.
 */

export type StartOutcome = `return` | `throw` | `resolve` | `reject`
export type StartReentry =
  | `none`
  | `abort-self`
  | `truncate`
  | `release-self`
  | `release-peer`
  | `unsubscribe`
  | `cleanup`
export type RestartReentry =
  `none` | `release-self` | `release-peer` | `unsubscribe` | `cleanup`

export const acquisitionPhases = [
  `deferred`,
  `starting`,
  `on-demand`,
  `eager`,
  `retiring`,
  `unavailable`,
] as const
export const acquisitionEntries = [
  `request`,
  `resume`,
  `markReady`,
  `markError`,
  `syncReturn`,
] as const
export type AcquisitionPhase = (typeof acquisitionPhases)[number]
export type AcquisitionEntry = (typeof acquisitionEntries)[number]
export type AcquisitionCell = `${AcquisitionPhase}:${AcquisitionEntry}`

export type AcquisitionCellDefinition =
  { kind: `covered` } | { kind: `excluded`; reason: string }

export const acquisitionCellDefinitions = {
  'deferred:request': { kind: `covered` },
  'deferred:resume': { kind: `covered` },
  'deferred:markReady': {
    kind: `excluded`,
    reason: `the sync callback has not started and cannot mark ready`,
  },
  'deferred:markError': {
    kind: `excluded`,
    reason: `the sync callback has not started and cannot mark error`,
  },
  'deferred:syncReturn': {
    kind: `excluded`,
    reason: `the deferred sync callback has no result to return`,
  },
  'starting:request': { kind: `covered` },
  'starting:resume': {
    kind: `excluded`,
    reason: `resuming the deferred gate enters this phase only once`,
  },
  'starting:markReady': { kind: `covered` },
  'starting:markError': { kind: `covered` },
  'starting:syncReturn': { kind: `covered` },
  'on-demand:request': { kind: `covered` },
  'on-demand:resume': {
    kind: `excluded`,
    reason: `an installed loader is no longer behind the deferred gate`,
  },
  'on-demand:markReady': { kind: `covered` },
  'on-demand:markError': { kind: `covered` },
  'on-demand:syncReturn': {
    kind: `excluded`,
    reason: `the sync callback already returned the installed loader`,
  },
  'eager:request': { kind: `covered` },
  'eager:resume': {
    kind: `excluded`,
    reason: `eager sync is not a deferred subset acquisition`,
  },
  'eager:markReady': {
    kind: `excluded`,
    reason: `eager readiness does not install a subset loader`,
  },
  'eager:markError': {
    kind: `excluded`,
    reason: `eager errors do not change subset acquisition availability`,
  },
  'eager:syncReturn': {
    kind: `excluded`,
    reason: `eager sync results own no subset loader contract`,
  },
  'retiring:request': { kind: `covered` },
  'retiring:resume': {
    kind: `excluded`,
    reason: `retirement is outside the deferred-start gate`,
  },
  'retiring:markReady': {
    kind: `excluded`,
    reason: `callbacks from a retiring sync run cannot restore availability`,
  },
  'retiring:markError': {
    kind: `excluded`,
    reason: `callbacks from a retiring sync run are obsolete`,
  },
  'retiring:syncReturn': {
    kind: `excluded`,
    reason: `obsolete returned resources use the resource-installation axis`,
  },
  'unavailable:request': { kind: `covered` },
  'unavailable:resume': {
    kind: `excluded`,
    reason: `recovery in the same sync run uses markReady rather than defer resume`,
  },
  'unavailable:markReady': { kind: `covered` },
  'unavailable:markError': {
    kind: `excluded`,
    reason: `a repeated error leaves acquisition unavailable`,
  },
  'unavailable:syncReturn': {
    kind: `excluded`,
    reason: `handler-less return is the transition into unavailable`,
  },
} satisfies Record<AcquisitionCell, AcquisitionCellDefinition>

/**
 * The cell table is the grammar of acquisition coverage. Its calibration test
 * in the oracle file reaches it through the cell sets derived below.
 */
declareOracle({ grammar: [acquisitionCellDefinitions] })

export const legalAcquisitionCells = new Set<AcquisitionCell>(
  Object.entries(acquisitionCellDefinitions)
    .filter(([, definition]) => definition.kind === `covered`)
    .map(([cell]) => cell as AcquisitionCell),
)
export const excludedAcquisitionCells = new Map<AcquisitionCell, string>(
  Object.entries(acquisitionCellDefinitions).flatMap(([cell, definition]) =>
    definition.kind === `excluded`
      ? [[cell as AcquisitionCell, definition.reason]]
      : [],
  ),
)

/**
 * Model-only lifecycle projection spanning attempts and accepted acquisitions:
 * `none` has no accepted work; `starting` is a tentative acquisition attempt;
 * `active` has an accepted physical acquisition and its acquisition lease;
 * `obsolete` has retired acquisition ownership; `failed-release` has attempted
 * acquisition release and must not retry it.
 */
export const acquisitionLifecycleStates = [
  `none`,
  `starting`,
  `active`,
  `obsolete`,
  `failed-release`,
] as const
export const acquisitionInteractionCauses = [
  `release`,
  `abort`,
  `truncate`,
  `cleanup`,
  `unsubscribe`,
] as const
export type AcquisitionLifecycleState =
  (typeof acquisitionLifecycleStates)[number]
export type AcquisitionInteractionCause =
  (typeof acquisitionInteractionCauses)[number]
export type AcquisitionInteractionCell =
  `${AcquisitionLifecycleState}:${AcquisitionInteractionCause}`
// `retire` projects the end of ownership, not necessarily acquisition release.
// During `starting`, a synchronous throw fails the attempt before acceptance.
// Cleanup invalidation cancels a returned tentative acquisition before activation
// without retaining its lease. An accepted acquisition instead releases its lease.
// Logical demand can survive this boundary, as it does during truncate replay.
// An `active` interaction ends accepted ownership through acquisition release
// or enclosing sync-run cleanup.
export type AcquisitionInteraction =
  | `no-acquisition`
  | `abort-only`
  | `retire`
  | `no-repeat-on-truncate`
  | `no-repeat-on-cleanup`
  | `no-repeat-on-unsubscribe`
export type AcquisitionInteractionCellDefinition =
  | { kind: `covered`; interaction: AcquisitionInteraction }
  | { kind: `excluded`; reason: string }

export const acquisitionInteractionCellDefinitions = {
  'none:release': {
    kind: `covered`,
    interaction: `no-acquisition`,
  },
  'none:abort': {
    kind: `covered`,
    interaction: `no-acquisition`,
  },
  'none:truncate': {
    kind: `covered`,
    interaction: `no-acquisition`,
  },
  'none:cleanup': {
    kind: `covered`,
    interaction: `no-acquisition`,
  },
  'none:unsubscribe': {
    kind: `covered`,
    interaction: `no-acquisition`,
  },
  'starting:release': { kind: `covered`, interaction: `retire` },
  'starting:abort': { kind: `covered`, interaction: `abort-only` },
  'starting:truncate': { kind: `covered`, interaction: `retire` },
  'starting:cleanup': { kind: `covered`, interaction: `retire` },
  'starting:unsubscribe': { kind: `covered`, interaction: `retire` },
  'active:release': { kind: `covered`, interaction: `retire` },
  'active:abort': {
    kind: `covered`,
    interaction: `abort-only`,
  },
  'active:truncate': { kind: `covered`, interaction: `retire` },
  'active:cleanup': { kind: `covered`, interaction: `retire` },
  'active:unsubscribe': { kind: `covered`, interaction: `retire` },
  'obsolete:release': {
    kind: `excluded`,
    reason: `the replacement owns later release; obsolete work was retired once`,
  },
  'obsolete:abort': {
    kind: `excluded`,
    reason: `obsolete work was already signaled and retired`,
  },
  'obsolete:truncate': {
    kind: `excluded`,
    reason: `another truncate retires the current replacement, not already-obsolete work`,
  },
  'obsolete:cleanup': {
    kind: `excluded`,
    reason: `sync-run cleanup retires the current sync run; obsolete work was retired once`,
  },
  'obsolete:unsubscribe': {
    kind: `excluded`,
    reason: `unsubscribe retires current ownership; obsolete work was retired once`,
  },
  'failed-release:release': {
    kind: `excluded`,
    reason: `logical release already happened; the acquisition attempt is final`,
  },
  'failed-release:abort': {
    kind: `excluded`,
    reason: `the failed physical release is already aborted`,
  },
  'failed-release:truncate': {
    kind: `covered`,
    interaction: `no-repeat-on-truncate`,
  },
  'failed-release:cleanup': {
    kind: `covered`,
    interaction: `no-repeat-on-cleanup`,
  },
  'failed-release:unsubscribe': {
    kind: `covered`,
    interaction: `no-repeat-on-unsubscribe`,
  },
} satisfies Record<
  AcquisitionInteractionCell,
  AcquisitionInteractionCellDefinition
>

export const startOutcomes = [`return`, `throw`, `resolve`, `reject`] as const
export const startReentries = [
  `none`,
  `abort-self`,
  `truncate`,
  `release-self`,
  `release-peer`,
  `unsubscribe`,
  `cleanup`,
] as const

export type StartScenario = {
  outcome: StartOutcome
  reentry: StartReentry
}

export const startScenarios: ReadonlyArray<StartScenario> =
  startOutcomes.flatMap((outcome) =>
    startReentries.map((reentry) => ({ outcome, reentry })),
  )

export const failureScenarios = ([`throw`, `reject`] as const).flatMap(
  (outcome) => startReentries.map((reentry) => ({ outcome, reentry })),
)

export const releaseScenarios = ([`return`, `throw`] as const).flatMap(
  (outcome) =>
    ([`none`, `reacquire-self`, `release-peer`, `unsubscribe`] as const).map(
      (reentry) => ({ outcome, reentry }),
    ),
)

export const restartScenarios = startOutcomes.flatMap((outcome) =>
  (
    [`none`, `release-self`, `release-peer`, `unsubscribe`, `cleanup`] as const
  ).map((reentry: RestartReentry) => ({ outcome, reentry })),
)
