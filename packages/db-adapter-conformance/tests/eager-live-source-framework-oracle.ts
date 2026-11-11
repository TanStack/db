/**
 * The shared eager-source checker remains the independent judge at every
 * original checkpoint. This bridge transports its law and checkpoint to the
 * framework. Setup errors escape; cleanup diagnostics remain secondary.
 */
import { ConformanceViolation, checkEagerLiveSourceHistory } from '../src'
import type {
  EagerLiveSourceDriver,
  EagerLiveSourceHistory,
  EagerLiveSourceReachState,
} from '../src'
import type { Observation, Verdict } from '../../db/tests/oracle-property'

export type EagerHistoryResult = {
  browserErrors?: ReadonlyArray<string>
  reached: Array<EagerLiveSourceReachState>
  result?: { accepted: number; skipped: number }
  failure?: {
    law: string
    step: number
    expected: unknown
    actual: unknown
    cleanup: Array<string>
  }
}

export async function observeEagerLiveSourceHistory(
  driver: EagerLiveSourceDriver,
  history: EagerLiveSourceHistory,
  corruptValues = false,
): Promise<EagerHistoryResult> {
  const reached: Array<EagerLiveSourceReachState> = []
  const actualDriver = corruptValues
    ? {
        ...driver,
        create: () => {
          const fixture = driver.create()
          const collection = fixture.collection
          return {
            ...fixture,
            collection: {
              ...collection,
              get status() {
                return collection.status
              },
              get health() {
                return collection.health
              },
              *values() {
                for (const row of collection.values())
                  yield { ...row, value: { incorrect: true } }
              },
            },
          }
        },
      }
    : driver
  try {
    const result = await checkEagerLiveSourceHistory(actualDriver, history, {
      reach: (state) => reached.push(state),
    })
    return { reached, result }
  } catch (error) {
    const primary = error instanceof AggregateError ? error.cause : error
    if (!(primary instanceof ConformanceViolation)) throw error
    return {
      reached,
      failure: {
        law: primary.law,
        step: primary.step,
        expected: primary.expected,
        actual: primary.actual,
        cleanup:
          error instanceof AggregateError ? error.errors.map(String) : [],
      },
    }
  }
}

export function eagerLiveSourceVerdict(
  trace: ReadonlyArray<Observation>,
  required: ReadonlyArray<string>,
): Verdict {
  const completed = trace.find((entry) => entry.checkpoint === `completed`)
  const actual = completed?.value as EagerHistoryResult | undefined
  const browserErrors = actual?.browserErrors ?? []
  const secondary = browserErrors.length
    ? `; secondary browser errors: ${browserErrors.join(`; `)}`
    : ``
  if (actual?.failure) {
    const { law, step, expected, actual: observed, cleanup } = actual.failure
    return {
      kind: `violation`,
      checkpoint: `step:${step}`,
      law,
      difference: `${law} at original shared checkpoint ${step}${cleanup.length ? `; secondary cleanup: ${cleanup.join(`; `)}` : ``}${secondary}`,
      values: { expected, actual: observed },
    }
  }
  const reached = new Set(
    trace
      .filter((entry) => entry.checkpoint === `reach`)
      .map((entry) => entry.value),
  )
  const missing = required.filter((state) => !reached.has(state))
  if (missing.length)
    return {
      kind: `violation`,
      checkpoint: `reach`,
      law: `constructed builder reach`,
      difference: `generated construction omitted ${missing.join(`, `)}${secondary}`,
    }
  if (!actual?.result)
    return {
      kind: `violation`,
      checkpoint: `completed`,
      law: `eager source comparison`,
      difference: `shared comparison did not complete${secondary}`,
    }
  if (browserErrors.length)
    return {
      kind: `violation`,
      checkpoint: `browser`,
      law: `detached-browser-error`,
      difference: browserErrors.join(`; `),
    }
  return { kind: `pass` }
}
