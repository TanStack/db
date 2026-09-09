import { describe, expect, it } from 'vitest'
import { createCollection, createEffect } from '../src/index.js'
import { createDeferred } from '../src/deferred.js'
import { flushPromises } from './utils.js'

// One disposal attempt has one outcome, even when abort/release callbacks
// reenter it. Counting physical releases alone misses divergent caller results.
const scenarios = ([`abort`, `release`] as const).flatMap((reentry) =>
  [false, true].flatMap((pendingHandler) =>
    ([`success`, `error`, `undefined`] as const).map((outcome) => ({
      reentry,
      pendingHandler,
      outcome,
    })),
  ),
)

describe(`Effect disposal outcome oracle`, () => {
  it.each(scenarios)(
    `joins all callers to one attempt: %j`,
    async ({ reentry, pendingHandler, outcome }) => {
      const failure = new Error(`release failed`)
      const handler = createDeferred<void>()
      let nested: Promise<void> | undefined
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
      try {
        await flushPromises()
        const outer = effect.dispose()
        // Observe every promise before any assertion can throw.
        const results = Promise.allSettled([outer, nested!, effect.dispose()])
        let settled = false
        void results.then(() => {
          settled = true
        })
        expect(nested).toBeDefined()
        expect(effect.disposed).toBe(true)
        expect(source.subscriberCount).toBe(0)
        expect(releases).toBe(1)
        if (pendingHandler) {
          await flushPromises()
          expect(settled).toBe(false)
        }
        handler.resolve()
        const observed = await results
        for (const result of observed) {
          expect(result.status).toBe(
            outcome === `success` ? `fulfilled` : `rejected`,
          )
          if (result.status === `rejected`) {
            if (outcome === `error`) expect(result.reason).toBe(failure)
            else expect(result.reason).toMatchObject({ message: `undefined` })
          }
          expect(result).toEqual(observed[0])
        }
        // A settled failed attempt does not make the source lease retryable.
        await effect.dispose()
        expect(releases).toBe(1)
      } finally {
        handler.resolve()
        await Promise.allSettled([nested, effect.dispose()])
        await source.cleanup()
      }
    },
  )
})
