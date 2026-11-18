import { vi } from 'vitest'
import { useOracleClock } from '../../db/tests/oracle-property'

// The real macrotask yield, taken before any test fakes the clock.
const realImmediate = globalThis.setImmediate
// How far a checkpoint moves a controlled clock between real turns.
const VIRTUAL_STEP = 5
// Whether `useControlledClock` runs the clock. A test that fakes timers and
// moves them itself keeps checkpoints on its own clock.
let controlled = false

/**
 * Bound offline-oracle observation and exhaust test-owned cleanup.
 *
 * A checkpoint timeout says that an expected event was not observed; it does
 * not cancel the underlying operation. Cleanup therefore tries every action.
 * If the scenario already has a primary failure, cleanup failures are reported
 * without replacing it. Otherwise they form one AggregateError after all
 * resources have had a release attempt.
 */
export async function atOracleCheckpoint<T>(
  promise: Promise<T>,
  label: string,
  timeout = 1000,
): Promise<T> {
  if (controlled) return atVirtualCheckpoint(promise, label, timeout)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`Offline oracle checkpoint timed out: ${label}`)),
          timeout,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A checkpoint on the controlled clock (`useControlledClock`). The bound is
 * virtual: between real macrotask turns, which let in-memory work finish,
 * the clock moves `VIRTUAL_STEP` ms, firing the timers that come due; the
 * checkpoint fails once the clock has moved `timeout` ms. A wait that real
 * time would end only after a backoff or a timeout therefore fails at once,
 * and a loaded machine cannot slow a correct history past its bound.
 */
async function atVirtualCheckpoint<T>(
  promise: Promise<T>,
  label: string,
  timeout: number,
): Promise<T> {
  let outcome: { value: T } | { error: unknown } | undefined
  promise.then(
    (value) => (outcome = { value }),
    (error: unknown) => (outcome = { error }),
  )
  for (let elapsed = 0; ; elapsed += VIRTUAL_STEP) {
    await new Promise<void>((resolve) => realImmediate(resolve))
    if (outcome) {
      if (`error` in outcome) throw outcome.error
      return outcome.value
    }
    if (elapsed + VIRTUAL_STEP >= timeout)
      throw new Error(`Offline oracle checkpoint timed out: ${label}`)
    await vi.advanceTimersByTimeAsync(VIRTUAL_STEP)
  }
}

/**
 * Runs a history on a controlled clock (the framework's `useOracleClock`):
 * timers and `Date` are virtual, and macrotask turns (`setImmediate`) stay
 * real, so in-memory work finishes between clock steps. Returns the release,
 * which restores real timers and fails the test if its timers never went
 * quiet.
 */
export function useControlledClock(): () => void {
  // The framework's clock, which fails a test whose timers never go quiet.
  const clock = useOracleClock()
  controlled = true
  return () => {
    controlled = false
    clock.release()
  }
}

/**
 * Record unhandled process rejections until `cleanup` runs. Call `cleanup` in
 * a `finally` block.
 */
export function captureUnhandledRejections(): {
  rejections: Array<unknown>
  cleanup: () => void
} {
  const rejections: Array<unknown> = []
  const onUnhandled = (reason: unknown) => rejections.push(reason)
  process.on(`unhandledRejection`, onUnhandled)
  return {
    rejections,
    cleanup: () => {
      process.off(`unhandledRejection`, onUnhandled)
    },
  }
}

export async function cleanupOfflineOracle(
  actions: Array<() => void | Promise<unknown>>,
  hasPrimaryFailure: boolean,
): Promise<void> {
  const failures: Array<unknown> = []
  for (const [index, action] of actions.entries()) {
    try {
      await atOracleCheckpoint(
        Promise.resolve().then(action),
        `cleanup stage ${index}`,
        250,
      )
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) {
    if (hasPrimaryFailure)
      console.warn(
        `Offline oracle cleanup failed after the primary failure:`,
        failures,
      )
    else throw new AggregateError(failures, `Offline oracle cleanup failed`)
  }
}
