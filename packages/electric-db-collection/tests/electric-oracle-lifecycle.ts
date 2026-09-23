/**
 * Bound oracle observation without changing provider semantics.
 *
 * A deadline reports a missing semantic checkpoint. It does not cancel work;
 * callers still own and release their SDK stream and HTTP provider. Cleanup is
 * exhaustive: every registered resource gets one attempt. A primary test error
 * remains primary, while cleanup failures stay visible as warnings; without a
 * primary error, the first cleanup failure rejects after later releases run.
 */
export async function atCheckpoint<T>(
  promise: Promise<T>,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`Electric oracle checkpoint timed out: ${label}`)),
          2000,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function withElectricCleanup<T>(
  run: () => T | Promise<T>,
  cleanups: Array<() => void | Promise<void>>,
): Promise<T> {
  let outcome: { ok: true; value: T } | { ok: false; error: unknown }
  try {
    outcome = { ok: true, value: await run() }
  } catch (error) {
    outcome = { ok: false, error }
  }
  const failures: Array<unknown> = []
  for (const cleanup of cleanups) {
    try {
      await atCheckpoint(Promise.resolve().then(cleanup), `cleanup`)
    } catch (error) {
      failures.push(error)
    }
  }
  if (!outcome.ok) {
    for (const error of failures)
      console.warn(
        `Electric oracle cleanup failed after a primary error`,
        error,
      )
    throw outcome.error
  }
  if (failures.length) {
    for (const error of failures.slice(1))
      console.warn(`Electric oracle secondary cleanup failure`, error)
    throw failures[0]
  }
  return outcome.value
}
