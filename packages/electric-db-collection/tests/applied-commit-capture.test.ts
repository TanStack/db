import { describe, expect, it, vi } from 'vitest'
import { createAppliedCommitCaptureRegistry } from '../src/applied-commit-capture'

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe(`applied commit capture`, () => {
  it(`waits for every recorded receipt before settling`, async () => {
    const registry = createAppliedCommitCaptureRegistry()
    const capture = registry.capture()
    const first = createDeferred()
    const second = createDeferred()
    registry.record(first.promise)
    registry.record(second.promise)

    const wait = capture.wait()
    second.resolve()
    const nextTurn = new Promise<`next-turn`>((resolve) =>
      setTimeout(() => resolve(`next-turn`), 0),
    )

    await expect(
      Promise.race([wait.then(() => `settled` as const), nextTurn]),
    ).resolves.toBe(`next-turn`)
    expect(registry.activeCount).toBe(0)

    first.resolve()
    await wait
  })

  it(`seals the receipt set before waiting`, async () => {
    const registry = createAppliedCommitCaptureRegistry()
    const capture = registry.capture()
    const lateReceipt = createDeferred()

    const wait = capture.wait()
    registry.record(lateReceipt.promise)

    expect(registry.activeCount).toBe(0)
    await expect(wait).resolves.toBeUndefined()
    lateReceipt.resolve()
  })

  it.each([`first`, `second`] as const)(
    `propagates a settled %s receipt failure`,
    async (failedReceipt) => {
      const registry = createAppliedCommitCaptureRegistry()
      const capture = registry.capture()
      const first = createDeferred()
      const second = createDeferred()
      const failure = new Error(`${failedReceipt} receipt failed`)
      registry.record(first.promise)
      registry.record(second.promise)

      if (failedReceipt === `first`) {
        first.reject(failure)
        second.resolve()
      } else {
        first.resolve()
        second.reject(failure)
      }

      await expect(capture.wait()).rejects.toBe(failure)
      expect(registry.activeCount).toBe(0)
    },
  )

  it(`records one receipt for every concurrent capture`, async () => {
    const registry = createAppliedCommitCaptureRegistry()
    const firstCapture = registry.capture()
    const secondCapture = registry.capture()
    const receipt = createDeferred()
    const failure = new Error(`shared receipt failed`)
    registry.record(receipt.promise)
    receipt.reject(failure)

    const errors = await Promise.all([
      firstCapture.wait().catch((error: unknown) => error),
      secondCapture.wait().catch((error: unknown) => error),
    ])
    expect(errors).toEqual([failure, failure])
    expect(registry.activeCount).toBe(0)
  })

  it(`disposes a capture as soon as its lifetime signal aborts`, () => {
    const registry = createAppliedCommitCaptureRegistry()
    const controller = new AbortController()
    const addSpy = vi.spyOn(controller.signal, `addEventListener`)
    const removeSpy = vi.spyOn(controller.signal, `removeEventListener`)
    registry.capture(controller.signal)

    expect(registry.activeCount).toBe(1)
    expect(addSpy).toHaveBeenCalledOnce()

    controller.abort()

    expect(registry.activeCount).toBe(0)
    expect(removeSpy).toHaveBeenCalledOnce()
  })

  it(`does not retain a capture for an already-aborted lifetime`, () => {
    const registry = createAppliedCommitCaptureRegistry()
    const controller = new AbortController()
    controller.abort()
    const addSpy = vi.spyOn(controller.signal, `addEventListener`)

    registry.capture(controller.signal)

    expect(registry.activeCount).toBe(0)
    expect(addSpy).not.toHaveBeenCalled()
  })

  it.each([`wait`, `dispose`] as const)(
    `removes a capture after %s`,
    async (settlement) => {
      const registry = createAppliedCommitCaptureRegistry()
      const capture = registry.capture()

      if (settlement === `wait`) await capture.wait()
      else capture.dispose()

      expect(registry.activeCount).toBe(0)
    },
  )
})
