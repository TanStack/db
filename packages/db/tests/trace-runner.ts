type MaybePromise<T> = T | PromiseLike<T>

type ErrorWithSuppressed = Error & {
  suppressed?: Array<unknown>
}

export class TraceAssertionError extends Error {
  readonly checkpoint: number

  constructor(checkpoint: number, cause: unknown) {
    super(`Trace assertion failed at checkpoint ${checkpoint}`, { cause })
    this.name = `TraceAssertionError`
    this.checkpoint = checkpoint
  }
}

export type TraceCheckpoint = () => undefined

export type TraceDriver<TStep, TContext> = {
  setup: () => MaybePromise<TContext>
  start?: (context: TContext) => MaybePromise<void>
  apply: (
    step: TStep,
    context: TContext,
    checkpoint: TraceCheckpoint,
  ) => MaybePromise<void>
  cleanup: (context: TContext) => MaybePromise<void>
}

export type TraceProjection<TContext, TObserved, TExpected = TObserved> = {
  observe: (context: TContext) => TObserved
  recompute: (context: TContext) => TExpected
  assertEqual: (observed: TObserved, expected: TExpected) => undefined
}

type RunTraceOptions<TStep, TContext, TObserved, TExpected> = {
  steps: ReadonlyArray<TStep>
  driver: TraceDriver<TStep, TContext>
  projection: TraceProjection<TContext, TObserved, TExpected>
}

function isPromiseLike<T>(value: MaybePromise<T>): value is PromiseLike<T> {
  return (
    value !== null &&
    (typeof value === `object` || typeof value === `function`) &&
    `then` in value &&
    typeof value.then === `function`
  )
}

function attachSuppressedError(error: unknown, suppressed: unknown): void {
  if (!(error instanceof Error)) return

  try {
    const errorWithSuppressed = error as ErrorWithSuppressed
    errorWithSuppressed.suppressed = [
      ...(errorWithSuppressed.suppressed ?? []),
      suppressed,
    ]
  } catch {
    // A frozen or otherwise immutable error must still remain the primary one.
  }
}

/**
 * Drives a trace against a system and checks its observable state against an
 * independent projection after startup, after each step, and at any explicit
 * checkpoint requested by the driver.
 */
export async function runTrace<TStep, TContext, TObserved, TExpected>({
  steps,
  driver,
  projection,
}: RunTraceOptions<TStep, TContext, TObserved, TExpected>): Promise<void> {
  const setupResult = driver.setup()
  const context = isPromiseLike(setupResult) ? await setupResult : setupResult
  let checkpointIndex = 0
  const checkpoint: TraceCheckpoint = () => {
    const currentCheckpoint = checkpointIndex
    checkpointIndex += 1
    const observed = projection.observe(context)
    const expected = projection.recompute(context)
    try {
      projection.assertEqual(observed, expected)
    } catch (error) {
      if (!(error instanceof Error) || error.name !== `AssertionError`) {
        throw error
      }
      throw new TraceAssertionError(currentCheckpoint, error)
    }
    return undefined
  }

  let traceFailed = false
  let traceError: unknown
  try {
    const startResult = driver.start?.(context)
    if (isPromiseLike(startResult)) await startResult
    checkpoint()

    for (const step of steps) {
      const applyResult = driver.apply(step, context, checkpoint)
      if (isPromiseLike(applyResult)) await applyResult
      checkpoint()
    }
  } catch (error) {
    traceFailed = true
    traceError = error
  }

  try {
    const cleanupResult = driver.cleanup(context)
    if (isPromiseLike(cleanupResult)) await cleanupResult
  } catch (cleanupError) {
    if (!traceFailed) throw cleanupError
    attachSuppressedError(traceError, cleanupError)
  }

  if (traceFailed) throw traceError
}
