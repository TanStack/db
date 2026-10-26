import { describe, expect, it } from 'vitest'
import { createCollection, createEffect } from '../src/index.js'
import { createDeferred } from '../src/deferred.js'
import { captureMicrotaskErrors, flushPromises } from './utils.js'
import { declareOracle } from './oracle-config.js'

/**
 * # What does concurrent effect disposal mean?
 *
 * The public Effect.dispose contract in src/query/effect.ts says that calls
 * during one cleanup attempt share its outcome and await in-flight handlers.
 * The Collection acquisition lease contract requires one release opportunity.
 * Abort and adapter-unload callbacks may call `dispose()` again while that
 * attempt is running. Each caller must remain pending until the handler
 * settles, then observe the same outcome.
 *
 * An adapter's `unloadSubset` that throws is an adapter bug (ARCHITECTURE.md).
 * The source subscription reports the thrown value uncaught, once and with
 * its own identity, and the release fails nothing. So a release failure is
 * not a disposal outcome: every caller fulfills, and the one report is the
 * only trace of the failure.
 *
 * This finite matrix crosses the two reentry sites, a pending or synchronous
 * batch handler, and a release that succeeds, throws an Error, or throws
 * `undefined`. The model is the per-caller relation above: one release, no
 * early caller settlement, one common fulfillment, and exactly the thrown
 * value reported uncaught. A design that rejects the callers, swallows the
 * failure, or reports it again from a reentrant dispose fails the comparison.
 * The controlled adapter establishes one acquisition and throws synchronously
 * on unload. This does not cover providers with asynchronous unload, multiple
 * acquisitions, a handler that awaits its own disposal, or cleanup failures
 * other than a source release.
 */
const scenarios = ([`abort`, `release`] as const).flatMap((reentry) =>
  [false, true].flatMap((pendingHandler) =>
    ([`success`, `error`, `undefined`] as const).map((outcome) => ({
      reentry,
      pendingHandler,
      outcome,
    })),
  ),
)

// The model: a release that throws reports exactly its thrown value, once.
// A success reports nothing. Callers never see the failure.
function expectedUncaughtReports(
  outcome: (typeof scenarios)[number][`outcome`],
  failure: Error,
): Array<unknown> {
  return outcome === `error`
    ? [failure]
    : outcome === `undefined`
      ? [undefined]
      : []
}

// The model: every caller of one attempt fulfills with the same outcome.
function expectCallerOutcomes(
  observed: ReadonlyArray<PromiseSettledResult<void>>,
): void {
  for (const result of observed) {
    expect(result).toEqual({ status: `fulfilled`, value: undefined })
  }
}

// The model: each reported value is the one the release threw, in order.
function expectUncaughtReports(
  errors: ReadonlyArray<unknown>,
  reported: ReadonlyArray<unknown>,
): void {
  expect(errors).toHaveLength(reported.length)
  errors.forEach((error, index) =>
    expect(Object.is(error, reported[index])).toBe(true),
  )
}

declareOracle({
  check: [expectCallerOutcomes, expectUncaughtReports],
  model: [expectedUncaughtReports],
})

describe(`Effect disposal outcome oracle`, () => {
  it.each(scenarios)(
    `joins all callers to one attempt: %j`,
    async ({ reentry, pendingHandler, outcome }) => {
      const failure = new Error(`release failed`)
      // The thrown value the model expects to see reported, if any.
      const reported = expectedUncaughtReports(outcome, failure)
      const uncaught = captureMicrotaskErrors()
      const handler = createDeferred<void>()
      let nested: Promise<void> | undefined
      let batches = 0
      let releases = 0
      const source = createCollection<{ id: number }>({
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                begin()
                write({ type: `insert`, value: { id: 1 } })
                commit()
                return true
              },
              unloadSubset: () => {
                releases++
                if (reentry === `release`) nested = effect.dispose()
                if (outcome === `error`) throw failure
                if (outcome === `undefined`) throw undefined
              },
            }
          },
        },
      })
      const effect: ReturnType<typeof createEffect> = createEffect({
        query: (q) => q.from({ row: source }),
        onBatch: (_events, { signal }) => {
          batches++
          if (reentry === `abort`)
            signal.addEventListener(
              `abort`,
              () => {
                nested = effect.dispose()
              },
              { once: true },
            )
          return pendingHandler ? handler.promise : undefined
        },
      })
      let primaryFailure: { error: unknown } | undefined
      try {
        await flushPromises()
        expect(batches).toBeGreaterThan(0)
        const outer = effect.dispose()
        const joined = effect.dispose()
        // Attach rejection observers before an assertion can interrupt the case.
        const results = Promise.allSettled([outer, nested, joined])
        expect(nested).toBeDefined()
        const callers = [outer, nested!, joined]
        // Record each caller separately: an aggregate can stay pending after
        // one caller settles too soon.
        const settled = callers.map(() => false)
        callers.forEach((caller, index) => {
          void caller.then(
            () => {
              settled[index] = true
            },
            () => {
              settled[index] = true
            },
          )
        })
        expect(effect.disposed).toBe(true)
        expect(source.subscriberCount).toBe(0)
        expect(releases).toBe(1)
        if (pendingHandler) {
          await flushPromises()
          expect([...settled]).toEqual([false, false, false])
        }
        handler.resolve()
        const observed = await results
        expectCallerOutcomes(observed)
        await flushPromises()
        expectUncaughtReports(uncaught.errors, reported)
        // A finished attempt does not make the acquisition lease retryable.
        await effect.dispose()
        await flushPromises()
        expect(releases).toBe(1)
        expect(uncaught.errors).toHaveLength(reported.length)
      } catch (error) {
        primaryFailure = { error }
      }
      handler.resolve()
      uncaught.restore()
      const cleanupFailures: Array<unknown> = []
      try {
        await Promise.allSettled([nested, effect.dispose()])
      } catch (error) {
        cleanupFailures.push(error)
      }
      try {
        await source.cleanup()
      } catch (error) {
        cleanupFailures.push(error)
      }
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          cleanupFailures,
          `Effect disposal oracle cleanup failed`,
          { cause: primaryFailure?.error },
        )
      }
      if (primaryFailure) throw primaryFailure.error
    },
  )
})
