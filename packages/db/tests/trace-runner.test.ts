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
})
