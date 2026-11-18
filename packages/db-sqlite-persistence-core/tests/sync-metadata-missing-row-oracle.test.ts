// @vitest-environment node
import { oracleProperty } from '../../db/tests/oracle-property'
import {
  missingRowMetadataBatch,
  missingRowMetadataCases,
  missingRowMetadataRepeatsArbitrary,
  persistedPeerFullGrammar,
  persistedPeerGrammar,
  persistedPeerOnDemandGrammar,
  runSessionHistory,
} from '../../db/tests/sync-metadata-session-oracle'
import { createPersistedDriver } from './sync-metadata-session-persisted-driver'
import { createSQLiteDriver } from './sync-metadata-session-sqlite-driver'
import {
  checkSessionRuns,
  completedSessionRuns,
  observeSessionRun,
  sessionRunCalibrations,
} from './sync-metadata-session-runs'
import type { OwedSessionRun } from './sync-metadata-session-runs'

/**
 * Both receivers use the session oracle's D16/D9/D18 model and comparison.
 * A nested delete leaves source metadata for a missing durable row. The outer
 * update recreates only its row unless it explicitly writes metadata. Reads
 * and durable metadata are compared at each completed commit, then after a
 * named peer notice. Core holds vary application without delaying durability.
 * This is one sync run; restart and intermediate SQL statements are outside it.
 *
 * History: the number of times the missing row's metadata is written. Its
 * plan is the constructive batch of `missingRowMetadataCases`, which holds
 * every case, so every generated history is the construction that enters
 * every declared state: each case on each production path, completed without
 * a mismatch and with every authored action run.
 */
const productionPaths = [
  persistedPeerGrammar,
  persistedPeerFullGrammar,
  persistedPeerOnDemandGrammar,
]
const state = (productionPathName: string, name: string) =>
  `${productionPathName}: ${name}`
const states = productionPaths.flatMap((productionPath) =>
  missingRowMetadataCases.map(({ name }) => state(productionPath.name, name)),
)
type Batch = ReturnType<typeof missingRowMetadataBatch>
const owedRuns = (batch: Batch): Array<OwedSessionRun> =>
  productionPaths.flatMap((productionPath) =>
    batch.map(({ name, history }) => ({
      path: productionPath.name,
      name,
      actions: history.length,
    })),
  )

for (const [host, property] of [
  [`persisted`, `sync-metadata-session.persisted-missing-row-metadata`],
  [`sqlite`, `sync-metadata-session.sqlite-missing-row-metadata`],
] as const) {
  oracleProperty<number, Array<OwedSessionRun>, Batch>({
    id: property,
    law: {
      statement: `Metadata written while a row is missing in this run stays local unless explicitly written: an enclosing update that recreates the row after an inner delete commits first keeps it without storing it, named writes replace it, unknown writes follow D15, and source deletes and truncates clear it. Source reads and durable metadata agree with the session model at every checkpoint (${host} receiver).`,
      authority: `Sync metadata session oracle decisions D9, D11, D15, D16 and D18 (packages/db/tests/sync-metadata-session-oracle.ts).`,
      limits: `One sync run per history over the three peer production paths; restart and intermediate SQL statements are outside it.`,
    },
    owns:
      host === `sqlite`
        ? [`src/persisted.ts`, `src/sqlite-core-adapter.ts`]
        : [`src/persisted.ts`],
    histories: {
      arbitrary: missingRowMetadataRepeatsArbitrary,
      runs: 8,
      fixedSeeds: [2220037],
      states,
      constructed: [
        {
          name: `every missing-row case on every production path`,
          enters: states,
          build: (repeats) => repeats,
        },
      ],
    },
    resolve: missingRowMetadataBatch,
    model: owedRuns,
    driver: async (batch, observe) => {
      for (const productionPath of productionPaths)
        for (const { name, history } of batch)
          await observeSessionRun(
            observe,
            { path: productionPath.name, name, actions: history.length },
            history,
            () =>
              runSessionHistory(productionPath, history, () =>
                host === `sqlite`
                  ? createSQLiteDriver(productionPath)
                  : createPersistedDriver(
                      true,
                      true,
                      false,
                      true,
                      productionPath.fullRows,
                      productionPath.onDemand,
                    ),
              ),
          )
    },
    check: (_batch, observations, owed) => checkSessionRuns(observations, owed),
    reached: (_batch, trace) =>
      completedSessionRuns(trace).map((run) => state(run.path, run.name)),
    calibrations: sessionRunCalibrations(),
    timeout: 240_000,
  })
}
