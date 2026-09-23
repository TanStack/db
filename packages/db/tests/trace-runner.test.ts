import { describe, expect, it, vi } from 'vitest'
import { runTrace } from './trace-runner.js'
import type { TraceDriver } from './trace-runner.js'

type Context = {
  observed: number
  expected: number
}

describe(`runTrace`, () => {
  it.each([`truncate`, `reverse`] as const)(
    `does not invoke a setter that would %s cleanup evidence`,
    async (mode) => {
      const primary = new Error(`primary`)
      const earlier = new Error(`earlier`)
      const secondary = new Error(`cleanup`)
      let stored = [earlier]
      const setter = vi.fn((values: Array<Error>) => {
        stored = values
        if (mode === `truncate`) stored.pop()
        else stored.reverse()
      })
      Object.defineProperty(primary, `suppressed`, {
        configurable: true,
        get: () => stored,
        set: setter,
      })
      await expect(
        runTrace({
          steps: [],
          driver: {
            setup: () => undefined,
            start: () => {
              throw primary
            },
            apply: () => undefined,
            cleanup: () => {
              throw secondary
            },
          },
          projection: {
            observe: () => undefined,
            recompute: () => undefined,
            assertEqual: () => undefined,
          },
        }),
      ).rejects.toBe(primary)
      expect(setter).not.toHaveBeenCalled()
      expect(
        Object.getOwnPropertyDescriptor(primary, `suppressed`)?.value,
      ).toEqual([earlier, secondary])
    },
  )

  it(`retains cleanup when an error silently refuses suppressed evidence`, async () => {
    const primary = new Error(`primary`)
    Object.defineProperty(primary, `suppressed`, {
      get: () => [],
      set: () => undefined,
    })
    const secondary = new Error(`cleanup`)
    const error = await runTrace({
      steps: [],
      driver: {
        setup: () => undefined,
        start: () => {
          throw primary
        },
        apply: () => undefined,
        cleanup: () => {
          throw secondary
        },
      },
      projection: {
        observe: () => undefined,
        recompute: () => undefined,
        assertEqual: () => undefined,
      },
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toEqual([primary, secondary])
    expect((error as AggregateError).cause).toBe(primary)
  })

  const primaryCases = [
    { kind: `mutable`, create: () => new Error(`primary`) },
    { kind: `frozen`, create: () => Object.freeze(new Error(`primary`)) },
    { kind: `string`, create: () => `primary` },
    { kind: `undefined`, create: () => undefined },
  ]
  const failureCases = primaryCases.flatMap((primary) =>
    ([`start`, `apply`, `observe`, `recompute`] as const).flatMap((stage) =>
      [false, true].flatMap((asyncCleanup) =>
        [false, true].map((cleanupFails) => ({
          ...primary,
          stage,
          asyncCleanup,
          cleanupFails,
        })),
      ),
    ),
  )

  it.each(failureCases)(
    `retains $kind primary at $stage with async=$asyncCleanup failing-cleanup=$cleanupFails`,
    async ({ kind, create, stage, asyncCleanup, cleanupFails }) => {
      const primary = create()
      const secondary = new Error(`cleanup`)
      const cleanup = vi.fn(() => {
        if (asyncCleanup) {
          return cleanupFails ? Promise.reject(secondary) : Promise.resolve()
        }
        if (cleanupFails) throw secondary
        return undefined
      })
      const throwAt = (point: typeof stage) => {
        if (stage === point) throw primary
      }
      let caught = false
      const error = await runTrace({
        steps: [0],
        driver: {
          setup: () => undefined,
          start: () => throwAt(`start`),
          apply: () => throwAt(`apply`),
          cleanup,
        },
        projection: {
          observe: () => throwAt(`observe`),
          recompute: () => throwAt(`recompute`),
          assertEqual: () => undefined,
        },
      }).catch((failure: unknown) => {
        caught = true
        return failure
      })
      expect(caught).toBe(true)
      expect(cleanup).toHaveBeenCalledOnce()
      if (!cleanupFails || kind === `mutable`) {
        expect(error).toBe(primary)
        if (cleanupFails) {
          expect(
            (error as Error & { suppressed: Array<unknown> }).suppressed,
          ).toEqual([secondary])
        }
      } else {
        expect(error).toBeInstanceOf(AggregateError)
        const compound = error as AggregateError
        expect(compound.cause).toBe(primary)
        expect(compound.errors).toEqual([primary, secondary])
      }
    },
  )

  it(`appends cleanup evidence without losing earlier suppressed failures`, async () => {
    const earlier = new Error(`earlier`)
    const primary = Object.assign(new Error(`primary`), {
      suppressed: [earlier],
    })
    const secondary = new Error(`later`)
    await expect(
      runTrace({
        steps: [],
        driver: {
          setup: () => undefined,
          start: () => {
            throw primary
          },
          apply: () => undefined,
          cleanup: () => {
            throw secondary
          },
        },
        projection: {
          observe: () => undefined,
          recompute: () => undefined,
          assertEqual: () => undefined,
        },
      }),
    ).rejects.toBe(primary)
    expect(primary.suppressed).toEqual([earlier, secondary])
  })
  it(`checks after startup, explicit checkpoints, and every step`, async () => {
    const checkpoints: Array<number> = []
    const cleanup = vi.fn()
    const driver: TraceDriver<number, Context> = {
      setup: () => ({ observed: 0, expected: 0 }),
      start: (context) => {
        context.observed = 1
        context.expected = 1
      },
      apply: (step, context, checkpoint) => {
        context.observed += step
        context.expected += step
        if (step === 2) checkpoint()
      },
      cleanup,
    }

    await runTrace({
      steps: [2, 3],
      driver,
      projection: {
        observe: (context) => context.observed,
        recompute: (context) => context.expected,
        assertEqual: (observed, expected) => {
          expect(observed).toBe(expected)
          checkpoints.push(observed)
        },
      },
    })

    expect(checkpoints).toEqual([1, 3, 3, 6])
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it(`cleans up when a checkpoint fails`, async () => {
    const cleanup = vi.fn()

    await expect(
      runTrace({
        steps: [1],
        driver: {
          setup: () => ({ observed: 0, expected: 1 }),
          apply: () => undefined,
          cleanup,
        },
        projection: {
          observe: (context) => context.observed,
          recompute: (context) => context.expected,
          assertEqual: (observed, expected) => {
            expect(observed).toBe(expected)
          },
        },
      }),
    ).rejects.toThrow()

    expect(cleanup).toHaveBeenCalledOnce()
  })

  it(`checks synchronous steps before queued microtasks run`, async () => {
    await expect(
      runTrace({
        steps: [1],
        driver: {
          setup: () => ({ observed: 0, expected: 0 }),
          apply: (step, context) => {
            context.expected = step
            queueMicrotask(() => {
              context.observed = step
            })
          },
          cleanup: () => undefined,
        },
        projection: {
          observe: (context) => context.observed,
          recompute: (context) => context.expected,
          assertEqual: (observed, expected) => {
            expect(observed).toBe(expected)
          },
        },
      }),
    ).rejects.toThrow()
  })

  it(`preserves the trace failure when cleanup also fails`, async () => {
    const cleanupError = new Error(`cleanup failed`)

    const run = runTrace({
      steps: [],
      driver: {
        setup: () => ({ observed: 0, expected: 1 }),
        apply: () => undefined,
        cleanup: () => {
          throw cleanupError
        },
      },
      projection: {
        observe: (context) => context.observed,
        recompute: (context) => context.expected,
        assertEqual: (observed, expected) => {
          expect(observed).toBe(expected)
        },
      },
    })

    const traceFailure = await run.catch((error: unknown) => error)
    expect(traceFailure).toMatchObject({
      name: `TraceAssertionError`,
      checkpoint: 0,
      cause: { name: `AssertionError` },
    })
    expect(
      (traceFailure as Error & { suppressed?: Array<unknown> }).suppressed,
    ).toEqual([cleanupError])
  })

  it(`does not wrap observation errors as assertion failures`, async () => {
    const observationError = new Error(`observation failed`)

    await expect(
      runTrace({
        steps: [],
        driver: {
          setup: () => undefined,
          apply: () => undefined,
          cleanup: () => undefined,
        },
        projection: {
          observe: () => {
            throw observationError
          },
          recompute: () => undefined,
          assertEqual: () => undefined,
        },
      }),
    ).rejects.toBe(observationError)
  })

  it(`does not wrap runtime errors from assertion callbacks`, async () => {
    const runtimeError = new TypeError(`assertion callback failed`)

    await expect(
      runTrace({
        steps: [],
        driver: {
          setup: () => undefined,
          apply: () => undefined,
          cleanup: () => undefined,
        },
        projection: {
          observe: () => undefined,
          recompute: () => undefined,
          assertEqual: () => {
            throw runtimeError
          },
        },
      }),
    ).rejects.toBe(runtimeError)
  })

  it(`throws cleanup failures when the trace succeeds`, async () => {
    const cleanupError = new Error(`cleanup failed`)

    await expect(
      runTrace({
        steps: [],
        driver: {
          setup: () => ({ observed: 0, expected: 0 }),
          apply: () => undefined,
          cleanup: () => {
            throw cleanupError
          },
        },
        projection: {
          observe: (context) => context.observed,
          recompute: (context) => context.expected,
          assertEqual: (observed, expected) => {
            expect(observed).toBe(expected)
          },
        },
      }),
    ).rejects.toBe(cleanupError)
  })
})
