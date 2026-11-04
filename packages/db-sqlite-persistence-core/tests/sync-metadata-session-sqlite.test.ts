// @vitest-environment node
import { it } from 'vitest'
import {
  describeMismatch,
  persistedPeerFullGrammar,
  persistedPeerGrammar,
  persistedPeerOnDemandGrammar,
  runSessionHistory,
  seedReinsertReloadReplay,
} from '../../db/tests/sync-metadata-session-oracle'
import {
  oracleReplayTest,
  readOracleRunConfig,
} from '../../db/tests/oracle-config'
import {
  runKeptMetadataDurabilityCampaign,
  runSeedReinsertReloadCampaign,
} from './sync-metadata-session-campaign'
import { createSQLiteDriver } from './sync-metadata-session-sqlite-driver'
import type {
  SessionAction,
  SessionGrammar,
} from '../../db/tests/sync-metadata-session-oracle'

const productionPaths = [
  persistedPeerGrammar,
  persistedPeerFullGrammar,
  persistedPeerOnDemandGrammar,
]
async function check(
  history: ReadonlyArray<SessionAction>,
  productionPath: SessionGrammar,
) {
  return runSessionHistory(productionPath, history, () =>
    createSQLiteDriver(productionPath),
  )
}
oracleReplayTest(it).each(productionPaths)(
  `receives the seed/re-insert/reload replay through SQLite ($name)`,
  async (productionPath) => {
    const result = await check(seedReinsertReloadReplay, productionPath)
    if (result.mismatch)
      throw new Error(
        describeMismatch(seedReinsertReloadReplay, result.mismatch),
      )
  },
)

const property = `sync-metadata-session.sqlite-seed-reinsert-reload`
const requested = readOracleRunConfig().replayProperty
for (const campaign of [`fixed`, `random`] as const) {
  if (
    requested !== undefined &&
    (requested !== property || campaign === `fixed`)
  )
    continue
  it(`receives generated seed/re-insert/reload histories through SQLite (${campaign})`, async () => {
    // The peer action asserts actual requiresFullReload delivery before the
    // shared comparison passes; the campaign runner changes no host premise.
    await runSeedReinsertReloadCampaign({
      property,
      campaign,
      runHistory: check,
    })
  }, 120_000)
}
/**
 * Direct durability is a separate cut from this tab's metadata read. Each
 * generated batch crosses implicit keeps with explicit writes and updates
 * with flat/inner equal re-inserts, before and after named/unknown reloads.
 */
const durabilityProperty = `sync-metadata-session.sqlite-kept-metadata-durability`
for (const campaign of [`fixed`, `random`] as const) {
  if (
    requested !== undefined &&
    (requested !== durabilityProperty || campaign === `fixed`)
  )
    continue
  it(`keeps tab-local and durable metadata distinct (sqlite, ${campaign})`, async () => {
    const recoveryState = `on-demand: cached prior-run version crossed without replay details`
    await runKeptMetadataDurabilityCampaign({
      property: durabilityProperty,
      campaign,
      runHistory: check,
      extraStates: [recoveryState],
      extraReached: (productionPath, result) =>
        productionPath.onDemand &&
        result.recoveryInputs.some(
          (input) => input.fromRowVersion === 0 && input.latestRowVersion >= 2,
        )
          ? [recoveryState]
          : [],
    })
  }, 240_000)
}
