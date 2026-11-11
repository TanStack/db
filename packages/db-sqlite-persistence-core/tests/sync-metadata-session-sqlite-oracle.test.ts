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
import { oracleReplayTest } from '../../db/tests/oracle-config'
import {
  registerKeptMetadataDurabilityProperty,
  registerSeedReinsertReloadProperty,
} from './sync-metadata-session-campaign-oracle'
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

// The peer action asserts actual requiresFullReload delivery before the
// shared comparison passes; the property changes no host premise.
registerSeedReinsertReloadProperty({
  property: `sync-metadata-session.sqlite-seed-reinsert-reload`,
  runHistory: check,
  owns: [`src/persisted.ts`, `src/sqlite-core-adapter.ts`],
})

/**
 * Direct durability is a separate cut from this tab's metadata read. Each
 * generated batch crosses implicit keeps with explicit writes and updates
 * with flat/inner equal re-inserts, before and after named/unknown reloads.
 *
 * The on-demand production path also reaches a host fact: a completed run
 * whose recovery crossed a cached prior-run version (row version 0 to 2 or
 * later) without replay details. Every on-demand run of every batch reaches
 * it, so the batch construction enters it too.
 */
const recoveryState = `on-demand: cached prior-run version crossed without replay details`
registerKeptMetadataDurabilityProperty({
  property: `sync-metadata-session.sqlite-kept-metadata-durability`,
  runHistory: check,
  owns: [`src/persisted.ts`, `src/sqlite-core-adapter.ts`],
  extraStates: [recoveryState],
  extraReached: (productionPath, result) =>
    productionPath.onDemand &&
    result.recoveryInputs.some(
      (input) => input.fromRowVersion === 0 && input.latestRowVersion >= 2,
    )
      ? [recoveryState]
      : [],
  timeout: 240_000,
})
