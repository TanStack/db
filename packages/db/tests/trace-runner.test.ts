import { describe, expect, it, vi } from 'vitest'
import { runTrace } from './trace-runner.js'
import type { TraceDriver } from './trace-runner.js'

type Context = {
  observed: number
  expected: number
}

describe(`runTrace`, () => {
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
