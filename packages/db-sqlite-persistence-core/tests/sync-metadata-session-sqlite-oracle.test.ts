// @vitest-environment node
import {
  persistedPeerFullGrammar,
  persistedPeerGrammar,
  persistedPeerOnDemandGrammar,
  runSessionHistory,
  seedReinsertReloadReplay,
} from '../../db/tests/sync-metadata-session-oracle'
import { oracleProperty } from '../../db/tests/oracle-property'
import {
  registerKeptMetadataDurabilityProperty,
  registerSeedReinsertReloadProperty,
} from './sync-metadata-session-campaign-oracle'
import { createSQLiteDriver } from './sync-metadata-session-sqlite-driver'
import {
  checkSessionRuns,
  observeSessionRun,
} from './sync-metadata-session-runs'
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
// The seed/re-insert/reload replay through SQLite on each peer production
// path, with the model, driver, and comparison of the generated campaigns.
oracleProperty({
  id: `sync-metadata-session.sqlite-seed-reinsert-reload-replay`,
  law: {
    statement: `A source read through SQLite persistence gives what the same read gives on a bare Collection for the seed/re-insert/reload replay on every peer production path.`,
    authority: `The sync metadata session oracle's laws and decisions (packages/db/tests/sync-metadata-session-oracle.ts header).`,
    limits: `The one named replay on the three peer production paths.`,
  },
  owns: [`src/persisted.ts`, `src/sqlite-core-adapter.ts`],
  histories: productionPaths.map(({ name }) => name),
  label: (name) =>
    `receives the seed/re-insert/reload replay through SQLite (${name})`,
  resolve: (name) => ({
    productionPath: productionPaths.find((path) => path.name === name)!,
  }),
  model: ({ productionPath }) => [
    {
      path: productionPath.name,
      name: `history`,
      actions: seedReinsertReloadReplay.length,
    },
  ],
  driver: ({ productionPath }, observe) =>
    observeSessionRun(
      observe,
      {
        path: productionPath.name,
        name: `history`,
        actions: seedReinsertReloadReplay.length,
      },
      seedReinsertReloadReplay,
      () => check(seedReinsertReloadReplay, productionPath),
    ),
  check: (_plan, observations, owed) =>
    checkSessionRuns(observations, owed, { constructive: false }),
  timeout: 240_000,
})

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
