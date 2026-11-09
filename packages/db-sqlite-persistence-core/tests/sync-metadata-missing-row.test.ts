// @vitest-environment node
import { fc } from '@fast-check/vitest'
import { it } from 'vitest'
import {
  describeMismatch,
  missingRowMetadataCases,
  missingRowMetadataHistoriesArbitrary,
  persistedPeerFullGrammar,
  persistedPeerGrammar,
  persistedPeerOnDemandGrammar,
  runSessionHistory,
} from '../../db/tests/sync-metadata-session-oracle'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
  recordOracleReplay,
} from '../../db/tests/oracle-config'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { requireExecutedHistory } from './sync-metadata-campaign-result'
import { createPersistedDriver } from './sync-metadata-session-persisted-driver'
import { createSQLiteDriver } from './sync-metadata-session-sqlite-driver'

/**
 * Both receivers use the session oracle's D16/D9/D18 model and comparison.
 * A nested delete leaves source metadata for a missing durable row. The outer
 * update recreates only its row unless it explicitly writes metadata. Reads
 * and durable metadata are compared at each completed commit, then after a
 * named peer notice. Core holds vary application without delaying durability.
 * This is one sync run; restart and intermediate SQL statements are outside it.
 */
const productionPaths = [
  persistedPeerGrammar,
  persistedPeerFullGrammar,
  persistedPeerOnDemandGrammar,
]
const requested = readOracleRunConfig().replayProperty
for (const [host, property] of [
  [`persisted`, `sync-metadata-session.persisted-missing-row-metadata`],
  [`sqlite`, `sync-metadata-session.sqlite-missing-row-metadata`],
] as const) {
  for (const campaign of [`fixed`, `random`] as const) {
    if (
      requested !== undefined &&
      (requested !== property || campaign === `fixed`)
    )
      continue
    it(`keeps missing-row metadata local unless explicitly written (${host}, ${campaign})`, async () => {
      const state = (productionPathName: string, name: string) =>
        `${productionPathName}: ${name}`
      const reach = createOracleReach(
        property,
        productionPaths.flatMap((productionPath) =>
          missingRowMetadataCases.map(({ name }) =>
            state(productionPath.name, name),
          ),
        ),
      )
      const result = await fc.check(
        fc.asyncProperty(
          missingRowMetadataHistoriesArbitrary,
          async (batch) => {
            const failures: Array<string> = []
            for (const productionPath of productionPaths) {
              for (const { name, history } of batch) {
                reach.beginHistory()
                const historyResult = await runSessionHistory(
                  productionPath,
                  history,
                  () =>
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
                )
                if (historyResult.mismatch) {
                  failures.push(
                    `${state(productionPath.name, name)}\n${describeMismatch(history, historyResult.mismatch)}`,
                  )
                } else if (historyResult.steps !== history.length)
                  throw new Error(
                    `constructive history skipped an authored action`,
                  )
                else reach.reach(state(productionPath.name, name))
              }
            }
            if (failures.length) throw new Error(failures.join(`\n\n`))
          },
        ),
        campaign === `fixed`
          ? { numRuns: oracleRuns(8), seed: 2220037 }
          : oraclePropertyOptions(8, property),
      )
      recordOracleReplay(property, result)
      requireExecutedHistory(property, result)
      console.info(
        `ORACLE_REACH ${JSON.stringify({ property, campaign, seed: result.seed, runs: result.numRuns, counts: Object.fromEntries(reach.counts()) })}`,
      )
      if (result.failed)
        throw new Error(
          `${String(result.errorInstance)}\nseed=${result.seed} path=${result.counterexamplePath}`,
        )
      reach.assertReached()
    }, 240_000)
  }
}
