/** Browser transport preserves product observations before cleanup diagnostics.
 * Error object identity does not cross the page boundary. Name, message, stack
 * and separate aggregate/cause diagnostics do; no error-identity law is claimed.
 */
import type { Observation } from '../../db/tests/oracle-property'

export type QueryReceivingResult = {
  trace: Array<Observation>
  failure?: {
    name: string
    message: string
    stack?: string
    cause?: string
    secondary: ReadonlyArray<string>
  }
}
export async function recordQueryHistory(
  run: (observe: (checkpoint: string, value: unknown) => void) => Promise<void>,
): Promise<QueryReceivingResult> {
  const trace: Array<Observation> = []
  try {
    await run((checkpoint, value) => trace.push({ checkpoint, value }))
    return { trace }
  } catch (error) {
    return {
      trace,
      failure: {
        name: error instanceof Error ? error.name : 'NonError',
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack
          ? { stack: error.stack }
          : {}),
        ...(error instanceof Error && error.cause !== undefined
          ? { cause: String(error.cause) }
          : {}),
        secondary:
          error instanceof AggregateError
            ? Array.from(error.errors, String)
            : [],
      },
    }
  }
}
export function deliverQueryHistory(
  result: QueryReceivingResult & { browserErrors: ReadonlyArray<string> },
  observe: (checkpoint: string, value: unknown) => void,
): void {
  // Product facts arrive first. The shared check chooses their mismatch before
  // detached browser errors or a later cleanup error can replace it.
  for (const o of result.trace) observe(o.checkpoint, o.value)
  observe('browserErrors', result.browserErrors)
  if (result.failure) {
    const error = new Error(result.failure.message, {
      cause: { ...result.failure, browserErrors: result.browserErrors },
    })
    error.name = result.failure.name
    throw error
  }
}
