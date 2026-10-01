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

type Cleanup =
  | (() => void | Promise<void>)
  | { label: string; release: () => void | Promise<void> }

// A constructor can fail after its caller has acquired other resources. The
// caller retains those resources on success and releases them on failure.
export async function withElectricSetup<T>(
  setup: () => T,
  partialCleanups: Array<Cleanup>,
): Promise<T> {
  try {
    return setup()
  } catch (error) {
    return withElectricCleanup(() => {
      throw error
    }, partialCleanups)
  }
}

export async function withElectricCleanup<T>(
  run: () => T | Promise<T>,
  cleanups: Array<Cleanup>,
): Promise<T> {
  let outcome: { ok: true; value: T } | { ok: false; error: unknown }
  try {
    outcome = { ok: true, value: await run() }
  } catch (error) {
    outcome = { ok: false, error }
  }
  const failures: Array<{ label?: string; error: unknown }> = []
  for (const cleanup of cleanups) {
    const label = typeof cleanup === `function` ? undefined : cleanup.label
    const release = typeof cleanup === `function` ? cleanup : cleanup.release
    try {
      await atCheckpoint(
        Promise.resolve().then(release),
        label === undefined ? `cleanup` : `cleanup: ${label}`,
      )
    } catch (error) {
      failures.push({ label, error })
    }
  }
  if (!outcome.ok) {
    for (const { label, error } of failures)
      console.warn(
        `Electric oracle cleanup failed after a primary error${label === undefined ? `` : `: ${label}`}`,
        error,
      )
    throw outcome.error
  }
  if (failures.length) {
    for (const { label, error } of failures.slice(1))
      console.warn(
        `Electric oracle secondary cleanup failure${label === undefined ? `` : `: ${label}`}`,
        error,
      )
    throw failures[0]!.error
  }
  return outcome.value
}
