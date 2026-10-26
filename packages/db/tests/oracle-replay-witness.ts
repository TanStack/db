import { appendFileSync } from 'node:fs'
import { asyncDefaultReportMessage, defaultReportMessage } from 'fast-check'
import type { RunDetails } from 'fast-check'

export type OracleReplayWitness = {
  property: string
  seed: number
  path: string | undefined
  numRuns: number
  failed: boolean
}

function witnessChannel(
  property: string,
  seed: number,
  path: string | undefined,
): string | undefined {
  const channel = process.env.TANSTACK_DB_ORACLE_REPLAY_WITNESS
  return channel !== undefined &&
    property === process.env.TANSTACK_DB_ORACLE_PROPERTY &&
    seed === Number(process.env.TANSTACK_DB_ORACLE_SEED) &&
    path === process.env.TANSTACK_DB_ORACLE_PATH
    ? channel
    : undefined
}

function appendWitness<T>(
  channel: string,
  property: string,
  details: RunDetails<T>,
): void {
  const witness: OracleReplayWitness = {
    property,
    seed: details.seed,
    path: details.runConfiguration.path,
    numRuns: details.numRuns,
    failed: details.failed,
  }
  appendFileSync(channel, `${JSON.stringify(witness)}\n`)
}

/**
 * Record a guarded replay witness for an owner that runs its property with
 * `fc.check`. fast-check calls reporters only from `fc.assert`, so such an
 * owner records its run details itself. It never throws: the owner keeps its
 * own failure analysis.
 */
export function recordOracleReplay<T>(
  property: string,
  details: RunDetails<T>,
): void {
  const channel = witnessChannel(
    property,
    details.seed,
    details.runConfiguration.path,
  )
  if (channel !== undefined) appendWitness(channel, property, details)
}

/**
 * Attach a witness only when the guarded runner's property, seed, and path all
 * match. Constructing fast-check options is not evidence that a property ran.
 * The reporter records fast-check's completed run details, then preserves its
 * native failure formatting and cause policy instead of turning instrumentation
 * into a second assertion engine.
 */
export function oracleReplayReporter(
  property: string,
  seed: number,
  path: string,
): {
  asyncReporter?: <T>(details: RunDetails<T>) => Promise<void>
  reporter?: <T>(details: RunDetails<T>) => void
} {
  const channel = witnessChannel(property, seed, path)
  if (channel === undefined) return {}
  const record = <T>(details: RunDetails<T>) =>
    appendWitness(channel, property, details)
  const rethrow = <T>(details: RunDetails<T>, message: string | undefined) => {
    // A custom reporter replaces fast-check's throw. Preserve its public
    // formatter and errorWithCause policy, including precondition failures.
    if (message === undefined) return
    const error = new Error(message)
    if (details.runConfiguration.errorWithCause) {
      Object.defineProperty(error, `cause`, {
        value: details.errorInstance,
        configurable: true,
        writable: true,
      })
    }
    throw error
  }
  // fast-check accepts an async reporter only for an async property. When a
  // synchronous property rejects it, the guarded runner retries in the
  // synchronous mode, which uses fast-check's synchronous formatter.
  if (process.env.TANSTACK_DB_ORACLE_REPLAY_WITNESS_MODE === `sync`) {
    return {
      reporter: (details) => {
        record(details)
        rethrow(details, defaultReportMessage(details))
      },
    }
  }
  return {
    asyncReporter: async (details) => {
      // Statistics sampling has no assertion reporter and cannot earn reach.
      record(details)
      rethrow(details, await asyncDefaultReportMessage(details))
    },
  }
}
