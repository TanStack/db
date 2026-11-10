/**
 * Preserve the reference checker's original hostile-search sensitivity.
 *
 * Each control below keeps its pre-conversion seed, 600-history search ceiling,
 * native history arbitrary, driver configuration, and whole-law predicate.
 * `fc.sample` returns the same generated candidates as a successful `fc.check`
 * with those parameters. We run the existing independent model, production
 * driver and semantic comparison on that ordered stream, stopping only when
 * the named law rejects the mutant. Other conformance laws do not discharge
 * the control, and errors outside the comparison remain errors.
 *
 * These are checker calibrations, not a product campaign or a second oracle.
 * The native oracleProperty calibrations remain supplemental in the companion
 * oracle file. Sampling preserves the search before shrinking; these controls
 * do not claim a shrunk counterexample. The guarded product campaigns retain
 * shrinking and seed/path replay.
 */
import fc from 'fast-check'
import { describe, it } from 'vitest'
import {
  ConformanceViolation,
  checkEagerLiveSourceHistory,
  eagerLiveSourceHistoryArb,
  namesLaw,
} from '../src'
import { referenceDriver } from './reference-adapter'
import type { EagerLiveSourceDriver } from '../src'
import type { ReferenceMutant } from './reference-adapter'

const seed = 2118
const runs = 600
const timeout = 120_000

async function rejectWithNamedLaw(
  driver: EagerLiveSourceDriver,
  law: string | RegExp,
): Promise<void> {
  const histories = fc.sample(eagerLiveSourceHistoryArb(driver), {
    seed,
    numRuns: runs,
  })
  const seen = new Set<string>()
  for (const history of histories) {
    try {
      await checkEagerLiveSourceHistory(driver, history)
    } catch (error) {
      // Do not turn an AggregateError, fixture fault or cleanup failure into a
      // successful calibration. The old control required this exact class.
      if (!(error instanceof ConformanceViolation)) throw error
      if (namesLaw(law, error.law)) return
      seen.add(error.law)
    }
  }
  throw new Error(
    `No history in the ${runs}-candidate seed-${seed} search rejected the mutant with ${law}; observed laws: ${[...seen].join(`, `)}`,
  )
}

describe(`eager live-source reference calibration searches`, () => {
  const mutants: Array<[ReferenceMutant, string | RegExp]> = [
    [`ready-before-delivery`, `READY-2 (status)`],
    [`wraps-loading-failure`, `READY-4 (health error cause)`],
    [`failure-clears-rows`, `HEALTH-1 (rows)`],
    [`transient-is-fatal`, `HEALTH-1 (health error)`],
    [`delivery-error-is-fatal`, `HEALTH-1 (health error)`],
    [`never-recovers`, `HEALTH-2 (health failureReason)`],
    [`transient-fails-loading`, `RETRY-1 (status)`],
    [`splits-batch`, `PUB-1 (publication)`],
    [`drops-deletes`, `PUB-3/FID-4 (rows)`],
    // It merges a later delivery, so it also applies one that must be
    // rejected for a duplicate key.
    [`snapshot-merges`, /PUB-7 \(rows\)|PUB-4 \(rows\)/],
    [`leaks-subscription`, `LIFE-2/LIFE-10 (releases per subscription)`],
    [`restart-replays-rows`, `LIFE-2/LIFE-5 (rows)`],
    [`swallows-prompt-failure`, `READY-4 (status)`],
    [`ready-at-restart`, `LIFE-2/LIFE-5 (status)`],
    [`keeps-failed-source`, `LIFE-10 (open provider subscriptions)`],
    [`double-release`, `LIFE-10 (releases per subscription)`],
    [`detached-rejection`, `HEALTH-5`],
    [`logs-failure`, `HEALTH-5`],
    // Its early fulfillment also answers a wait for a retired run's txid
    // before the new run is ready.
    [`wait-off-by-one`, /EVID-1 \(awaitTxId \d+\)|EVID-2 \(awaitTxId \d+\)/],
    [`retired-evidence-before-ready`, `EVID-2 (awaitTxId 0)`],
    [`forgets-retired-evidence`, /EVID-2 \(awaitTxId \d+\)/],
    // The pattern's first alternative is only a prefix of the law, so this
    // calibration also checks that a pattern names a law only when it matches
    // all of it: a leftmost match would find `EVID-2` and name nothing.
    [`leaks-waits-after-fail`, /EVID-2|EVID-2 \(awaitTxId \d+\)/],
    [`wait-ignores-timeout`, /EVID-3 \(awaitTxId \d+\)/],
    [`disconnect-fails`, `RECON-1 (health error)`],
    [`renew-resubscribes`, `RENEW-1 (open provider subscriptions)`],
    [`drops-buffered`, `READY-10/PUB-9 (rows)`],
    // It applies buffered batches before the rows, also before a delivery
    // that must write nothing.
    [`buffer-before-rows`, /READY-10\/PUB-9 \(rows\)|PUB-4 \(rows\)/],
    [`replays-per-batch`, `PUB-5/PUB-9 (publication)`],
    [`ready-before-buffer`, `READY-10 (rows when ready)`],
    [`shows-buffered`, `READY-10/PUB-9 (rows)`],
    [`merges-updates`, `FID-1 (fields)`],
    [`dates-as-strings`, `FID-1 (values)`],
    [`bigints-as-numbers`, `FID-1 (values)`],
    [`drops-nulls`, `FID-1 (values)`],
    [`loses-negative-zero`, `FID-1 (values)`],
    [`typed-booleans-as-numbers`, `FID-1 (values)`],
    [`commits-malformed-prefix`, `PUB-4 (rows)`],
    [`ignores-malformed`, `PUB-4 (status)`],
    [`relabels-inserts`, `PUB-2 (change events)`],
  ]
  it.each(mutants)(
    `rejects the %s mutant with the original %s predicate`,
    async (mutant, law) => {
      await rejectWithNamedLaw(referenceDriver(mutant), law)
    },
    timeout,
  )

  it(
    `rejects reversed per-change publication within the original search`,
    async () => {
      await rejectWithNamedLaw(
        referenceDriver(`reverses-batch`, { perChange: true }),
        `PUB-1 (publication)`,
      )
    },
    timeout,
  )

  const outage = { reportAfter: 3, clientValues: true, reportsRejected: true }
  const outageMutants: Array<[ReferenceMutant, string | RegExp]> = [
    [`stale-outage-value`, `HEALTH-1 (health failureReason)`],
    [`replaces-outage-value`, `RETRY-1 (health failureReason)`],
    [`reports-outage-early`, `HEALTH-1 (health failureReason)`],
    [`outage-count-survives-delivery`, `HEALTH-1 (health failureReason)`],
    [`empty-response-keeps-count`, `HEALTH-1 (health failureReason)`],
    [`empty-response-recovers`, `RETRY-1 (health failureReason)`],
    [`rejected-delivery-fails`, `PUB-4 (health error)`],
    [`wraps-loading-failure`, `READY-4 (health error cause)`],
  ]
  it.each(outageMutants)(
    `rejects the outage %s mutant with the original %s predicate`,
    async (mutant, law) => {
      await rejectWithNamedLaw(referenceDriver(mutant, { outage }), law)
    },
    timeout,
  )
})
