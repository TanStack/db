export type TraceCheckpoint = () => void

export type TraceDriver<TStep, TContext> = {
  setup: () => TContext | Promise<TContext>
  start?: (context: TContext) => void | Promise<void>
  apply: (
    step: TStep,
    context: TContext,
    checkpoint: TraceCheckpoint,
  ) => void | Promise<void>
  cleanup: (context: TContext) => void | Promise<void>
}

export type TraceProjection<TContext, TObserved, TExpected = TObserved> = {
  observe: (context: TContext) => TObserved
  recompute: (context: TContext) => TExpected
  assertEqual: (observed: TObserved, expected: TExpected) => void
}

type RunTraceOptions<TStep, TContext, TObserved, TExpected> = {
  steps: ReadonlyArray<TStep>
  driver: TraceDriver<TStep, TContext>
  projection: TraceProjection<TContext, TObserved, TExpected>
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
  const context = await driver.setup()
  const checkpoint = () => {
    projection.assertEqual(
      projection.observe(context),
      projection.recompute(context),
    )
  }

  try {
    await driver.start?.(context)
    checkpoint()

    for (const step of steps) {
      await driver.apply(step, context, checkpoint)
      checkpoint()
    }
  } finally {
    await driver.cleanup(context)
  }
}
