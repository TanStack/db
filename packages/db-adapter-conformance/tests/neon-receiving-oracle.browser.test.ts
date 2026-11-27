// @vitest-environment node
/** Actual Chromium receives the unchanged eager and reload shared judgments. */
import { afterAll, beforeAll } from 'vitest'
import { oracleProperty } from '../../db/tests/oracle-property'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../../browser-db-sqlite-persistence/tests/adapter-chromium-host'
import { registerInitialReceiptConformance } from '../../powersync-direct-db-collection/tests/initial-receipt-oracle-suite'
import {
  eagerLiveSourceHistories,
  eagerLiveSourceOracle,
} from './eager-live-source-property-oracle'
import { eagerLiveSourceVerdict } from './eager-live-source-framework-oracle'
import { registerEagerReloadConformance } from './eager-reload-oracle-suite'
import { neonSDKDriver } from './neon/neon-sdk-driver'
import { neonReloadAdapter } from './neon/neon-reload-driver'
import { registerNeonSharedClient } from './neon/neon-shared-client-oracle-suite'
import { registerNeonIdempotentRemoval } from './neon/neon-idempotent-removal-oracle'
import type {
  runNeonEager,
  runNeonIdempotentRemoval,
  runNeonInitialReceipt,
  runNeonReload,
  runNeonSharedClient,
} from './neon/neon-receiving'

let host: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  host = await startAdapterChromium({
    entry: `/packages/db-adapter-conformance/tests/neon/neon-receiving.html`,
    ready: `runNeonEager`,
  })
}, 120_000)
afterAll(async () => host?.close(), 120_000)

for (const ordered of [false, true]) {
  const driver = neonSDKDriver(ordered)
  oracleProperty({
    id: ordered
      ? `adapter-conformance.eager-live-source.neon-sdk.ordered.chromium`
      : `adapter-conformance.eager-live-source.neon-sdk.chromium`,
    owns: [`tests/neon/vendor/collection-options.ts`],
    ...eagerLiveSourceOracle(driver),
    histories: {
      ...eagerLiveSourceHistories(driver),
      runs: 80,
      fixedSeeds: [2118],
    },
    driver: async (history, observe) => {
      if (!host) throw new Error(`Neon Chromium host did not start`)
      const active = host
      const result = await captureBrowserHistory(active, () =>
        active.page.evaluate(
          ({ history: input, ordered: useMoves }) =>
            (
              window as unknown as { runNeonEager: typeof runNeonEager }
            ).runNeonEager(input, useMoves),
          { history, ordered },
        ),
      )
      for (const state of result.reached) observe(`reach`, state)
      observe(`completed`, result)
    },
    check: (_history, trace, required) =>
      eagerLiveSourceVerdict(trace, required),
    timeout: 120_000,
  })
}

registerEagerReloadConformance(
  `adapter.neon.eager-reload.sdk.chromium`,
  neonReloadAdapter,
  {
    owns: [`tests/neon/vendor/collection-options.ts`],
    replacement: `truncate`,
    receive: async (history, id, omitTruncate) => {
      if (!host) throw new Error(`Neon Chromium host did not start`)
      const active = host
      const result = await captureBrowserHistory(active, () =>
        active.page.evaluate(
          ({ history: input, id: collectionId, omitTruncate: mutant }) =>
            (
              window as unknown as { runNeonReload: typeof runNeonReload }
            ).runNeonReload(input, collectionId, mutant),
          { history, id, omitTruncate },
        ),
      )
      return { ...result, receivingErrors: result.browserErrors }
    },
  },
)

registerNeonSharedClient(
  `adapter.neon.shared-client.sdk.chromium`,
  async (history, id, omitResult) => {
    if (!host) throw new Error(`Neon Chromium host did not start`)
    const active = host
    return captureBrowserHistory(active, () =>
      active.page.evaluate(
        ({ history: input, id: collectionId, omitResult: mutant }) =>
          (
            window as unknown as {
              runNeonSharedClient: typeof runNeonSharedClient
            }
          ).runNeonSharedClient(input, collectionId, mutant),
        { history, id, omitResult },
      ),
    )
  },
  { owns: [`tests/neon/vendor/collection-options.ts`] },
)

registerNeonIdempotentRemoval(
  `adapter.neon.idempotent-removal.sdk.chromium`,
  async (history) => {
    if (!host) throw new Error(`Neon Chromium host did not start`)
    const active = host
    return captureBrowserHistory(active, () =>
      active.page.evaluate(
        (input) =>
          (
            window as unknown as {
              runNeonIdempotentRemoval: typeof runNeonIdempotentRemoval
            }
          ).runNeonIdempotentRemoval(input),
        history,
      ),
    )
  },
)

registerInitialReceiptConformance(
  `adapter.neon.initial-receipt-cleanup.sdk.chromium`,
  async (history) => {
    if (!host) throw new Error(`Neon Chromium host did not start`)
    const active = host
    const raw = await captureBrowserHistory(active, () =>
      active.page.evaluate(
        (input) =>
          (
            window as unknown as {
              runNeonInitialReceipt: typeof runNeonInitialReceipt
            }
          ).runNeonInitialReceipt(input),
        history,
      ),
    )
    return {
      ...raw,
      detachedErrors: [...raw.detachedErrors, ...raw.browserErrors],
    }
  },
  {
    owns: [`tests/neon/vendor/collection-options.ts`],
    receiveFault: async (history, fault) => {
      if (!host) throw new Error(`Neon Chromium host did not start`)
      const active = host
      const raw = await captureBrowserHistory(active, () =>
        active.page.evaluate(
          ({ input, mode }) =>
            (
              window as unknown as {
                runNeonInitialReceipt: typeof runNeonInitialReceipt
              }
            ).runNeonInitialReceipt(input, mode),
          { input: history, mode: fault },
        ),
      )
      return {
        ...raw,
        detachedErrors: [...raw.detachedErrors, ...raw.browserErrors],
      }
    },
    receiveFaultLabel: `actual post-record provider failure`,
    receiveFaultDifferences: {
      cleanupOnly: `Injected Neon provider teardown failure`,
      mismatchAndCleanup: `detachedErrors`,
    },
    limits: `Installed Neon SDK, real persisted wrapper with controlled memory storage and actual Chromium rejection events; a genuine deferred source receipt held before admission by persisted restore, cleanup while held or after application. No SQLite durability or deployed-service claim.`,
  },
)
