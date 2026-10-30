/**
 * Preserve an oracle's first violated law and checkpoint while fast-check
 * reduces its input (oracle rubric ORC-010). These are test-harness facts, not
 * production state. A different failure is a diagnostic, not a reproduction.
 */
export class OracleCheckpointFailure extends Error {
  constructor(
    readonly law: string,
    readonly checkpoint: string,
    cause: unknown,
  ) {
    super(`${law} at ${checkpoint}: ${String(cause)}`, { cause })
    this.name = `OracleCheckpointFailure`
  }
}

/** Mark a synchronous comparison; asynchronous driver actions remain separate. */
export function atOracleCheckpoint<T>(
  law: string,
  checkpoint: string,
  compare: () => T,
): T {
  try {
    return compare()
  } catch (error) {
    throw new OracleCheckpointFailure(law, checkpoint, error)
  }
}

interface FailureEvidence {
  fingerprint: string
  trace: string
  error: unknown
}

// Cleanup and history wrappers put the primary failure first. Never select a
// matching secondary mismatch when an earlier, different failure interrupted it.
function primaryFingerprint(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0)
    return primaryFingerprint(error.errors[0])
  if (error instanceof OracleCheckpointFailure)
    return JSON.stringify([`comparison`, error.law, error.checkpoint])
  // An initial setup/action failure must also stay red. Its exact diagnostic is
  // its fingerprint; it cannot silently become a later product-law mismatch.
  return JSON.stringify([
    `unmarked`,
    typeof error,
    error instanceof Error ? error.name : null,
    error instanceof Error ? error.message : String(error),
  ])
}

export class OracleFailureReport extends AggregateError {
  constructor(
    readonly original: FailureEvidence,
    readonly reduced: FailureEvidence,
    readonly nonReproducing: ReadonlyArray<FailureEvidence>,
  ) {
    super([], `Oracle reduction reproduced the original failure`, {
      cause: original.error,
    })
    // Fast-check retains the last reproducing error. Its final attempted
    // reduction can fail differently, so diagnostics must remain live after
    // this report was thrown. Cause and the two reproducing traces stay fixed.
    Object.defineProperties(this, {
      errors: {
        get: () => [
          original.error,
          ...(reduced.error === original.error ? [] : [reduced.error]),
          ...nonReproducing.map((failure) => failure.error),
        ],
      },
      message: {
        get: () =>
          `Oracle reduction reproduced the original failure ${original.fingerprint}` +
          `\nOriginal trace: ${original.trace}` +
          `\nReduced trace: ${reduced.trace}` +
          (nonReproducing.length
            ? `\nNon-reproducing reductions: ${nonReproducing.map((failure) => failure.fingerprint).join(`; `)}`
            : ``),
      },
    })
    this.name = `OracleFailureReport`
  }
}

/** One instance belongs to one campaign, including its shrink attempts. */
export function createOracleFailureFidelity<THistory>(
  describeHistory: (history: THistory) => string = (history) =>
    JSON.stringify(history),
) {
  let original: FailureEvidence | undefined
  let reduced: FailureEvidence | undefined
  const nonReproducing: Array<FailureEvidence> = []
  return {
    async run(
      history: THistory,
      body: () => void | Promise<void>,
    ): Promise<void> {
      // Capture before production, model stepping, or cleanup can alter inputs.
      const trace = describeHistory(history)
      try {
        await body()
      } catch (error) {
        const failure = { fingerprint: primaryFingerprint(error), trace, error }
        original ??= failure
        if (failure.fingerprint !== original.fingerprint) {
          nonReproducing.push(failure)
          // Accept only as a shrink candidate. The campaign is already red;
          // this candidate supplies no successful product comparison evidence.
          return
        }
        reduced = failure
        throw new OracleFailureReport(original, failure, nonReproducing)
      }
    },
    async assert(campaign: () => Promise<void>): Promise<void> {
      try {
        await campaign()
      } catch (error) {
        if (original === undefined || reduced === undefined) throw error
        // fast-check renders its retained error before the last rejected
        // candidate. Finalize afterwards so its seed/path diagnostic and every
        // non-reproducing reduction survive in the rendered failure as well.
        const report = new OracleFailureReport(
          original,
          reduced,
          nonReproducing,
        )
        throw new AggregateError(
          [error, report],
          `${String(error)}\n${report.message}`,
          { cause: error },
        )
      }
    },
  }
}
