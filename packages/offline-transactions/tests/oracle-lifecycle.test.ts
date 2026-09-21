import { expect, it, vi } from 'vitest'
import { atOracleCheckpoint, cleanupOfflineOracle } from './oracle-lifecycle'

/**
 * Calibration for offline-oracle ownership. These cases hold or fail cleanup
 * stages to prove deadlines do not claim cancellation, later releases still
 * run, and secondary cleanup errors cannot hide the scenario's primary error.
 */

it(`retains a cleanup error as secondary and still releases later resources`, async () => {
  const secondary = new Error(`cleanup failed`)
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  const release = vi.fn()
  try {
    await expect(
      cleanupOfflineOracle(
        [
          () => {
            throw secondary
          },
          release,
        ],
        true,
      ),
    ).resolves.toBeUndefined()
    expect(release).toHaveBeenCalledOnce()
    expect(warning).toHaveBeenCalledWith(
      `Offline oracle cleanup failed after the primary failure:`,
      [secondary],
    )
  } finally {
    warning.mockRestore()
  }
})

it(`bounds a lost completion checkpoint and attempts every cleanup stage`, async () => {
  vi.useFakeTimers()
  const release = vi.fn()
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  try {
    const never = new Promise<void>(() => {})
    const checkpoint = atOracleCheckpoint(never, `provider entered`).catch(
      (error: unknown) => error,
    )
    const cleanup = cleanupOfflineOracle([() => never, release], true)
    await vi.advanceTimersByTimeAsync(1001)
    expect(release).toHaveBeenCalledOnce()
    expect(await checkpoint).toMatchObject({
      message: `Offline oracle checkpoint timed out: provider entered`,
    })
    await cleanup
    expect(warning).toHaveBeenCalledOnce()
  } finally {
    warning.mockRestore()
    vi.useRealTimers()
  }
})

it(`reports cleanup-only failures after attempting later resources`, async () => {
  const failure = new Error(`cleanup failed`)
  const release = vi.fn()
  await expect(
    cleanupOfflineOracle(
      [
        () => {
          throw failure
        },
        release,
      ],
      false,
    ),
  ).rejects.toMatchObject({ errors: [failure] })
  expect(release).toHaveBeenCalledOnce()
})
