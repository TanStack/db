import { expect, it, vi } from 'vitest'
import { atCheckpoint, withElectricCleanup } from './electric-oracle-lifecycle'

/**
 * Calibration for Electric oracle ownership. The cases prove that a timeout is
 * only an observation failure, that later resources still release, and that
 * cleanup cannot replace a primary semantic failure. Provider properties rely
 * on these rules when a held stream or local HTTP server misbehaves.
 */

it(`tries every Electric oracle resource and retains primary and secondary failures`, async () => {
  const primary = new Error(`primary`)
  const secondary = new Error(`secondary`)
  const released: Array<string> = []
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  try {
    await expect(
      withElectricCleanup(() => {
        throw primary
      }, [
        () => {
          released.push(`stream`)
          throw secondary
        },
        () => {
          released.push(`http`)
        },
        () => {
          released.push(`spy`)
        },
      ]),
    ).rejects.toBe(primary)
    expect(released).toEqual([`stream`, `http`, `spy`])
    expect(warning).toHaveBeenCalledWith(
      `Electric oracle cleanup failed after a primary error`,
      secondary,
    )
  } finally {
    warning.mockRestore()
  }
})

it(`reports cleanup-only failures after trying later resources`, async () => {
  const failure = new Error(`cleanup`)
  const released = vi.fn()
  await expect(
    withElectricCleanup(
      () => 1,
      [
        () => {
          throw failure
        },
        released,
      ],
    ),
  ).rejects.toBe(failure)
  expect(released).toHaveBeenCalledTimes(1)
})

it(`reports a missing semantic checkpoint without claiming cancellation`, async () => {
  vi.useFakeTimers()
  try {
    let resolve!: () => void
    const pending = new Promise<void>((done) => {
      resolve = done
    })
    const observed = expect(
      atCheckpoint(pending, `held delivery`),
    ).rejects.toThrow(`Electric oracle checkpoint timed out: held delivery`)
    await vi.advanceTimersByTimeAsync(2000)
    await observed
    expect(vi.getTimerCount()).toBe(0)
    resolve()
    await pending
  } finally {
    vi.useRealTimers()
  }
})

it(`tries later resources when an earlier cleanup misses its checkpoint`, async () => {
  vi.useFakeTimers()
  let resolve!: () => void
  const pending = new Promise<void>((done) => {
    resolve = done
  })
  const later = vi.fn()
  try {
    const observed = expect(
      withElectricCleanup(() => 1, [() => pending, later]),
    ).rejects.toThrow(`Electric oracle checkpoint timed out: cleanup`)
    // The run result and cleanup setup each pass through a Promise checkpoint.
    await vi.advanceTimersByTimeAsync(2000)
    await observed
    expect(later).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    resolve()
    await pending
  } finally {
    resolve()
    vi.useRealTimers()
  }
})
