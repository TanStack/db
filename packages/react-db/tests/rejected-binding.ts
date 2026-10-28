import type { RenderHookResult } from '@testing-library/react'

/**
 * React unmounts a root whose render throws without an error boundary, so a
 * rejected reconfiguration leaves no binding to read. The returned guard runs
 * a reconfiguration and records its rejection, whether `act` throws it or
 * rejects with it. Every later result read rethrows that rejection instead of
 * returning the unmounted hook's last committed value.
 */
export function rejectReadsAfterRenderError(
  hook: RenderHookResult<any, any>,
): <T>(reconfigure: () => T) => T {
  let rejection: { error: unknown } | undefined
  const result = hook.result
  Object.defineProperty(hook, `result`, {
    value: {
      get current() {
        if (rejection) throw rejection.error
        return result.current
      },
    },
  })
  const record = (error: unknown): never => {
    rejection ??= { error }
    throw error
  }
  return (reconfigure) => {
    try {
      const value = reconfigure()
      // React's async `act` returns a thenable, not a Promise.
      return typeof (value as { then?: unknown } | null)?.then === `function`
        ? (Promise.resolve(value).catch(record) as typeof value)
        : value
    } catch (error) {
      return record(error)
    }
  }
}
