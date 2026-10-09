/** Release every test resource while retaining each cleanup failure. */
export async function cleanupTestActions(
  actions: Array<() => void | Promise<unknown>>,
  hasPrimaryFailure: boolean,
  label: string,
  runAction: (
    action: () => void | Promise<unknown>,
    index: number,
  ) => Promise<unknown> = async (action) => action(),
): Promise<void> {
  const failures: Array<unknown> = []
  for (const [index, action] of actions.entries()) {
    try {
      await runAction(action, index)
    } catch (error) {
      failures.push(error)
    }
  }
  if (!failures.length) return
  if (hasPrimaryFailure)
    console.warn(`${label} cleanup failed after the primary failure:`, failures)
  else throw new AggregateError(failures, `${label} cleanup failed`)
}
