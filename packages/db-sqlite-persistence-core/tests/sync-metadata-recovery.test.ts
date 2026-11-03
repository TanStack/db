// @vitest-environment node
import { fc } from '@fast-check/vitest'
import { it } from 'vitest'
import {
  recoveryInterruptions,
  recoveryPhases,
  recoverySchedulesArbitrary,
  runRecoverySchedule,
} from '../../db/tests/sync-metadata-recovery-oracle'
import { persistedPeerOnDemandLane } from '../../db/tests/sync-metadata-session-oracle'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
  recordOracleReplay,
} from '../../db/tests/oracle-config'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { requireExecutedHistory } from './sync-metadata-campaign-result'
import { createSQLiteDriver } from './sync-metadata-session-sqlite-driver'

const property = `sync-metadata-session.sqlite-recovery-schedules`
const requested = readOracleRunConfig().replayProperty
for (const campaign of [`fixed`, `random`] as const) {
  if (
    requested !== undefined &&
    (requested !== property || campaign === `fixed`)
  )
    continue
  it(`preserves metadata across held recovery boundaries (${campaign})`, async () => {
    const states = recoveryPhases.flatMap((phase) =>
      recoveryInterruptions.flatMap((interruption) =>
        [false, true].map((bare) => `${phase}/${interruption}/${bare}`),
      ),
    )
    const reach = createOracleReach(property, states)
    const result = await fc.check(
      fc.asyncProperty(recoverySchedulesArbitrary, async (batch) => {
        for (const schedule of batch) {
          reach.beginHistory()
          const observation = await runRecoverySchedule(schedule, () =>
            createSQLiteDriver(persistedPeerOnDemandLane),
          )
          if (
            !observation.events.includes(schedule.phase) ||
            observation.checkpoints < 7
          )
            throw new Error(
              `recovery schedule did not compare its declared cut`,
            )
          reach.reach(
            `${schedule.phase}/${schedule.interruption}/${schedule.bare}`,
          )
        }
      }),
      campaign === `fixed`
        ? { numRuns: oracleRuns(8), seed: 2220035 }
        : oraclePropertyOptions(8, property),
    )
    recordOracleReplay(property, result)
    requireExecutedHistory(property, result)
    if (result.failed)
      throw new Error(
        `${result.error}\nseed=${result.seed} path=${result.counterexamplePath}`,
      )
    reach.assertReached()
    console.info(
      `ORACLE_REACH ${JSON.stringify({ property, campaign, seed: result.seed, runs: result.numRuns, counts: Object.fromEntries(reach.counts()) })}`,
    )
  }, 120_000)
}
