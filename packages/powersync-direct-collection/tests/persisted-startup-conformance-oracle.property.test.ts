/**
 * A complete PowerSync Direct table result replaces its persisted baseline at
 * first readiness and is already durable before refresh. Network-first fallback
 * keeps saved rows while the source is held. The shared startup owner supplies
 * the independent set model, legal histories, immediate cuts and calibrations.
 * These receivers add controlled storage and actual Node SQLite, with the same
 * empty/overlap/omission, restore-order and optimistic-mutation dimensions.
 * Chromium worker/OPFS receives these histories in the browser package.
 *
 * Limits remain the shared owner's three-key eager startup language. Direct
 * PowerSync has no SQLite-SDK batching promise or independent peer scope.
 */
import { registerPersistedStartupConformance } from '../../db-adapter-conformance/tests/persisted-startup-oracle-suite'
import {
  persistedStartupHistories,
  persistedStartupHistoryArb,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { directPowerSyncStartupAdapter } from './persisted-startup-driver'

registerPersistedStartupConformance({
  property: `adapter.powersync-direct.persisted-startup`,
  adapter: directPowerSyncStartupAdapter,
  owns: [`src/index.ts#powerSyncCollectionOptions`],
  histories: persistedStartupHistories,
  arbitrary: persistedStartupHistoryArb(`collection`),
  timeout: 120_000,
})
