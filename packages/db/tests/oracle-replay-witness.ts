import { appendFileSync } from 'node:fs'
import { asyncDefaultReportMessage } from 'fast-check'
import type { RunDetails } from 'fast-check'

export type OracleReplayWitness = {
  property: string
  seed: number
  path: string | undefined
  numRuns: number
  failed: boolean
}

/** Only the guarded runner supplies this channel. Constructing options is not reach. */
export function oracleReplayReporter(
  property: string,
  seed: number,
  path: string,
): {
  asyncReporter?: <T>(details: RunDetails<T>) => Promise<void>
} {
  const channel = process.env.TANSTACK_DB_ORACLE_REPLAY_WITNESS
  if (
    channel === undefined ||
    property !== process.env.TANSTACK_DB_ORACLE_PROPERTY ||
    seed !== Number(process.env.TANSTACK_DB_ORACLE_SEED) ||
    path !== process.env.TANSTACK_DB_ORACLE_PATH
  )
    return {}
  return {
    asyncReporter: async (details) => {
      // All named assertion owners use async fast-check properties.
      // Statistics sampling has no assertion reporter and cannot earn reach.
      const witness: OracleReplayWitness = {
        property,
        seed: details.seed,
        path: details.runConfiguration.path,
        numRuns: details.numRuns,
        failed: details.failed,
      }
      appendFileSync(channel, `${JSON.stringify(witness)}\n`)

      // A custom reporter replaces fast-check's throw. Preserve its public async
      // formatter and errorWithCause policy, including precondition failures.
      const message = await asyncDefaultReportMessage(details)
      if (message !== undefined) {
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
    },
  }
}
