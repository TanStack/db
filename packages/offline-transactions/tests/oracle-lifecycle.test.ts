import { expect, it, vi } from 'vitest'
import { atOracleCheckpoint, cleanupOfflineOracle } from './oracle-lifecycle'

/**
 * The offline oracle harness must retain the scenario's primary failure while
 * reporting cleanup failures separately. A checkpoint timeout records a missed
 * observation; it does not cancel the underlying operation. The fixed histories
 * below call the shared harness directly, hold or fail cleanup stages, and check
 * the reported error and release attempts after cleanup settles. They calibrate
 * test ownership, not offline transaction or provider behavior.
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
    expect(warning).toHaveBeenCalledWith(
      `Offline oracle cleanup failed after the primary failure:`,
      [
        expect.objectContaining({
          message: `Offline oracle checkpoint timed out: cleanup stage 0`,
        }),
      ],
    )
  } finally {
    warning.mockRestore()
    vi.useRealTimers()
  }
})

it(`keeps the scenario failure when cleanup also fails`, async () => {
  const primary = new Error(`scenario failed`)
  const firstCleanupFailure = new Error(`first cleanup failed`)
  const secondCleanupFailure = new Error(`second cleanup failed`)
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  const release = vi.fn()
  try {
    const scenario = async () => {
      try {
        throw primary
      } finally {
        await cleanupOfflineOracle(
          [
            () => {
              throw firstCleanupFailure
            },
            () => {
              throw secondCleanupFailure
            },
            release,
          ],
          true,
        )
      }
    }

    await expect(scenario()).rejects.toBe(primary)
    expect(release).toHaveBeenCalledOnce()
    expect(warning).toHaveBeenCalledWith(
      `Offline oracle cleanup failed after the primary failure:`,
      [firstCleanupFailure, secondCleanupFailure],
    )
  } finally {
    warning.mockRestore()
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
