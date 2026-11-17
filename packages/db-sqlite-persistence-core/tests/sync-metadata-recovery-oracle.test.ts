// @vitest-environment node
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  RecoveryComparisonError,
  recoveryInterruptions,
  recoveryPhases,
  recoverySchedulesOf,
  recoveryValueArbitrary,
  runRecoverySchedule,
} from '../../db/tests/sync-metadata-recovery-oracle'
import { persistedPeerOnDemandGrammar } from '../../db/tests/sync-metadata-session-oracle'
import { createSQLiteDriver } from './sync-metadata-session-sqlite-driver'
import type { Observation } from '../../db/tests/oracle-property'
import type { RecoverySchedule } from '../../db/tests/sync-metadata-recovery-oracle'

/**
 * The recovery oracle (`sync-metadata-recovery-oracle.ts`) holds a recovery
 * at its response, storage-read, or application boundary, interrupts it with
 * a seed, a peer write, or cleanup, and compares source reads and durable
 * metadata with the session model at every held and completed cut (D15,
 * D9/D18; cleanup invalidates the sync run). `runRecoverySchedule` throws
 * the first cut whose reads or metadata differ from the model, and returns
 * the recovery events it saw and how many cuts it compared.
 *
 * History: one payload value. Its plan is the constructive batch of all 18
 * schedules (phase × interruption × seed metadata), so every generated history
 * is the construction that enters every declared state. A schedule reaches
 * its state when it passed every cut, saw its own phase, and compared at
 * least seven cuts: fewer means the schedule did not compare its declared cut.
 */
const property = `sync-metadata-session.sqlite-recovery-schedules`
const stateOf = (schedule: RecoverySchedule) =>
  `${schedule.phase}/${schedule.interruption}/${schedule.bare}`
const states = recoveryPhases.flatMap((phase) =>
  recoveryInterruptions.flatMap((interruption) =>
    [false, true].map((bare) => `${phase}/${interruption}/${bare}`),
  ),
)
type ScheduleRun = {
  schedule: string
  failure: string | null
  sawPhase: boolean
  checkpoints: number
}
const scheduleRuns = (observations: ReadonlyArray<Observation>) =>
  observations
    .filter((observation) => observation.checkpoint === `schedule`)
    .map((observation) => observation.value as ScheduleRun)
const comparedItsCut = (run: ScheduleRun) =>
  run.sawPhase && run.checkpoints >= 7

oracleProperty<number, Array<string>, Array<RecoverySchedule>>({
  id: property,
  law: {
    statement: `A recovery held at its response, storage-read, or application boundary and interrupted by a seed, a peer write, or cleanup keeps source reads and durable metadata equal to the session model at every held and completed cut; recovery and cleanup write no metadata.`,
    authority: `Sync metadata session oracle decisions D9, D15 and D18 and the glossary's sync run invalidation (packages/db/tests/sync-metadata-recovery-oracle.ts).`,
    limits: `One recovery, two rows, on-demand SQLite, a seed, peer write or cleanup at one held boundary. No expiry, generation rotation, restart, leadership turnover, Chromium OPFS or Electron IPC claim follows.`,
  },
  owns: [`src/persisted.ts`, `src/sqlite-core-adapter.ts`],
  histories: {
    arbitrary: recoveryValueArbitrary,
    runs: 8,
    fixedSeeds: [2220035],
    states,
    constructed: [
      {
        name: `every recovery schedule`,
        enters: states,
        build: (value) => value,
      },
    ],
  },
  resolve: recoverySchedulesOf,
  model: (batch) => batch.map(stateOf),
  driver: async (batch, observe) => {
    for (const schedule of batch) {
      let run: ScheduleRun
      try {
        const outcome = await runRecoverySchedule(schedule, () =>
          createSQLiteDriver(persistedPeerOnDemandGrammar),
        )
        run = {
          schedule: stateOf(schedule),
          failure: null,
          sawPhase: outcome.events.includes(schedule.phase),
          checkpoints: outcome.checkpoints,
        }
      } catch (error) {
        // Only the schedule's first differing cut is the observation the law
        // judges. A setup, timing or cleanup failure (an AggregateError with
        // cleanup failures, or any other cause) surfaces as itself.
        if (
          error instanceof AggregateError ||
          !(error instanceof Error) ||
          !(error.cause instanceof RecoveryComparisonError)
        )
          throw error
        run = {
          schedule: stateOf(schedule),
          failure: error.message,
          sawPhase: false,
          checkpoints: 0,
        }
      }
      observe(`schedule`, run)
    }
  },
  check: (_batch, observations, owed) => {
    const runs = scheduleRuns(observations)
    for (const [index, run] of runs.entries()) {
      if (run.schedule !== owed[index])
        return violation(
          `schedule`,
          `schedule ${index} is not the schedule the plan owes there`,
          `every owed schedule is observed`,
          { actual: run.schedule, expected: owed[index] ?? null },
        )
      if (run.failure !== null)
        return violation(
          `schedule`,
          run.failure,
          `recovery preserves the session model's reads and metadata`,
        )
      if (!comparedItsCut(run))
        return violation(
          `schedule`,
          `recovery schedule ${run.schedule} did not compare its declared cut`,
          `recovery compares its declared cut`,
          {
            actual: { sawPhase: run.sawPhase, checkpoints: run.checkpoints },
            expected: { sawPhase: true, checkpoints: `at least 7` },
          },
        )
    }
    if (runs.length < owed.length)
      return violation(
        `schedules`,
        `${owed.length - runs.length} owed schedules were not observed`,
        `every owed schedule is observed`,
        { actual: runs.length, expected: owed.length },
      )
    return pass
  },
  reached: (_batch, trace) =>
    scheduleRuns(trace)
      .filter((run) => run.failure === null && comparedItsCut(run))
      .map((run) => run.schedule),
  calibrations: [
    {
      name: `a schedule that did not compare its declared cut`,
      law: `recovery compares its declared cut`,
      corrupt: (trace) => {
        const at = trace.findIndex((entry) => entry.checkpoint === `schedule`)
        if (at < 0) return undefined
        return trace.map((entry, index) =>
          index === at
            ? {
                ...entry,
                value: { ...(entry.value as ScheduleRun), checkpoints: 6 },
              }
            : entry,
        )
      },
    },
  ],
  timeout: 120_000,
})
