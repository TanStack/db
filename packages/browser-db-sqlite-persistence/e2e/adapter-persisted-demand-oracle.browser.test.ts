// @vitest-environment node
/** The Node suite and Chromium share one grammar, model and comparison. */
import { afterAll, beforeAll } from 'vitest'
import { registerPersistedDemandReceiving } from '../../db-adapter-conformance/tests/persisted-demand-receiving-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import type { Page } from '@playwright/test'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/adapter-persisted-demand.opfs.html`,
    ready: `runAdapterPersistedDemand`,
  })
}, 120000)
afterAll(async () => {
  await browser?.close()
}, 120000)
const profiles = {
  'adapter.query.persisted-demand.chromium-opfs': `query`,
  'adapter.electric.persisted-demand.chromium-opfs': `electric`,
  'adapter.powersync.persisted-demand.chromium-opfs': `powersync`,
  'adapter.trailbase.persisted-demand.chromium-opfs': `trailbase`,
  'adapter.convex.persisted-demand.chromium-opfs': `convex`,
} as const
for (const [property, name] of Object.entries(profiles)) {
  registerPersistedDemandReceiving(
    property,
    async (history, id) => {
      const active = browser
      if (!active) throw new Error(`Receiving browser did not start`)
      const record = (page: Page) =>
        page.evaluate(
          ({ name: adapter, history: input, id: collectionId }) =>
            window.runAdapterPersistedDemand(adapter, input, collectionId),
          { name, history, id },
        )
      return name === `powersync`
        ? active.captureFreshHistory(record)
        : captureBrowserHistory(active, () => record(active.page))
    },
    {
      owns: [
        `../query-db-collection/src/query.ts#queryCollectionOptions`,
        `../electric-db-collection/src/electric.ts#electricCollectionOptions`,
        `../powersync-db-collection/src/powersync.ts#powerSyncCollectionOptions`,
        `../trailbase-db-collection/src/trailbase.ts#trailBaseCollectionOptions`,
        `../convex-db-collection/src/options.ts#createConvexOptions`,
        `../db-sqlite-persistence-core/src/persisted.ts`,
      ],
      path: `Actual ${name} SDK in Chromium over controlled provider input and closed/reopened worker/OPFS`,
    },
  )
}
