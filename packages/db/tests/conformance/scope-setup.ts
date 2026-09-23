// A setup callback can fail after it has acquired a native framework scope.
// Keep success ownership with its caller; release only failed setup here.
export function withScopeSetup<T>(body: () => T, dispose: () => void): T {
  try {
    return body()
  } catch (primary) {
    try {
      dispose()
    } catch (secondary) {
      throw new AggregateError(
        [primary, secondary],
        `Scope setup and cleanup failed`,
        {
          cause: primary,
        },
      )
    }
    throw primary
  }
}
