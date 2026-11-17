/**
 * The eager live-source model and comparison already live together in
 * `../src/eager-live-source-oracle.ts`. This adapter preserves that judgment:
 * it runs the same history, records its reached states, and translates only
 * its named ConformanceViolation into an oracleProperty verdict. Production
 * exceptions remain driver errors. An AggregateError retains cleanup failures
 * separately from its primary law violation (ORC-010).
 */
import { pass, violation } from '../../db/tests/oracle-property'
import {
  ConformanceViolation,
  checkEagerLiveSourceHistory,
  describeValue,
  eagerLiveSourceConstructedHistories,
  eagerLiveSourceDataHistoryArb,
  reachStatesFor,
  resolveEagerLiveSourceHistory,
} from '../src'
import type { Observation, Verdict } from '../../db/tests/oracle-property'
import type {
  EagerLiveSourceDriver,
  EagerLiveSourceHistory,
  EagerLiveSourceReachState,
} from '../src'

export const eagerLiveSourceLaw = {
  statement: `An eager live-source adapter refines the READY, HEALTH, PUB, FID, LIFE, EVID, RETRY, RECON, and RENEW laws stated beside the independent model, at every supported delivery, wait, failure, restart, and final-cleanup checkpoint.`,
  authority: `packages/db-adapter-conformance/src/eager-live-source-oracle.ts: adapter conformance law set v18; packages/db/src/types.ts sync callbacks; docs/contributing/glossary.md Collection status and health; the dated maintainer decisions beside each model rule.`,
  limits: `Only the driver's declared capabilities and value kinds over controlled providers; no on-demand loading, mutation handlers, reload, or unclaimed real-provider/framework boundary. The shared oracle states each observation limit.`,
}

// This pinned framework checks the seeded construction's `enters`, but loses
// the association for constructions built during generated runs. Record every
// builder result instead. Builders return fresh arrays; a mapped shrink calls
// the builder again, so it records its own declarations too. These declarations
// are model input, never evidence that production entered a state.
const constructionRequirements = new WeakMap<
  EagerLiveSourceHistory,
  ReadonlyArray<EagerLiveSourceReachState>
>()

export function eagerLiveSourceRequiredStates(
  history: EagerLiveSourceHistory,
): ReadonlyArray<EagerLiveSourceReachState> {
  return constructionRequirements.get(history) ?? []
}

export function eagerLiveSourceHistories(
  driver: EagerLiveSourceDriver,
  states: ReadonlyArray<EagerLiveSourceReachState> = reachStatesFor(driver),
) {
  return {
    arbitrary: eagerLiveSourceDataHistoryArb(driver),
    states,
    constructed: eagerLiveSourceConstructedHistories(driver).flatMap(
      (construction) => {
        const enters = construction.enters.filter((state) =>
          states.includes(state),
        )
        return enters.length === 0
          ? []
          : [
              {
                ...construction,
                enters,
                build: (generated: EagerLiveSourceHistory) => {
                  const history = construction.build(generated)
                  constructionRequirements.set(history, enters)
                  return history
                },
              },
            ]
      },
    ),
  }
}

export function eagerLiveSourceOracleDriver(
  driver: EagerLiveSourceDriver,
  transform: (history: EagerLiveSourceHistory) => EagerLiveSourceHistory = (
    history,
  ) => history,
) {
  return async (
    history: EagerLiveSourceHistory,
    observe: (checkpoint: string, value: unknown) => void,
  ): Promise<void> => {
    try {
      await checkEagerLiveSourceHistory(driver, transform(history), {
        reach: (state) => observe(`reach`, state),
      })
    } catch (error) {
      const primary = error instanceof AggregateError ? error.cause : error
      if (primary instanceof ConformanceViolation) {
        observe(`step ${primary.step}`, {
          law: primary.law,
          step: primary.step,
          // A mismatch may carry an Error or another native value. The
          // shared comparison already judged it; describe only its display
          // values here. The rethrown cause retains the original objects.
          actual: describeValue(primary.actual),
          expected: describeValue(primary.expected),
        })
      }
      // The framework attaches this as the verdict's cause, preserving the
      // original failure and every secondary cleanup diagnostic.
      throw error
    }
  }
}

/** Only the shared comparison above decides a product-law violation. */
export function checkEagerLiveSourceObservations(
  _history: EagerLiveSourceHistory,
  observations: ReadonlyArray<Observation>,
  requiredStates: ReadonlyArray<EagerLiveSourceReachState>,
): Verdict {
  const mismatch = observations.find(({ checkpoint }) =>
    checkpoint.startsWith(`step `),
  )
  if (mismatch !== undefined) {
    const found = mismatch.value as {
      law: string
      step: number
      actual: unknown
      expected: unknown
    }
    return violation(
      mismatch.checkpoint,
      `${found.law} differs from the independent eager-source model`,
      found.law,
      { actual: found.actual, expected: found.expected },
    )
  }
  // Required states come from the construction declaration. Only the shared
  // production path records actual entries, so an easy declaration cannot make
  // a missing generated entry pass.
  const reached = new Set(
    observations
      .filter(({ checkpoint }) => checkpoint === `reach`)
      .map(({ value }) => value),
  )
  const missing = requiredStates.filter((state) => !reached.has(state))
  return missing.length === 0
    ? pass
    : violation(
        `required construction states`,
        `the constructed history missed ${missing.join(`, `)}`,
        `constructed reach`,
        { actual: [...reached], expected: requiredStates },
      )
}

export function eagerLiveSourceOracle(driver: EagerLiveSourceDriver) {
  return {
    law: eagerLiveSourceLaw,
    resolve: (history: EagerLiveSourceHistory) => {
      const resolved = resolveEagerLiveSourceHistory(history)
      constructionRequirements.set(
        resolved,
        eagerLiveSourceRequiredStates(history),
      )
      return resolved
    },
    // The product model stays in the shared checker. This small model retains
    // only the construction's declared obligations, independently of its trace.
    model: eagerLiveSourceRequiredStates,
    driver: eagerLiveSourceOracleDriver(driver),
    check: checkEagerLiveSourceObservations,
  }
}
