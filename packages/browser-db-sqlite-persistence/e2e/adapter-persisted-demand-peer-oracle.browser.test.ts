// @vitest-environment node
/** Same peer history grammar, primary model and comparison as the Node host. */
import { afterAll, beforeAll } from 'vitest'
import { registerPersistedDemandPeer } from '../../db-adapter-conformance/tests/persisted-demand-peer-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/adapter-persisted-demand-peer.opfs.html`,
    ready: `runAdapterPersistedDemandPeer`,
  })
}, 120000)
afterAll(async () => {
  await browser?.close()
}, 120000)
registerPersistedDemandPeer(
  `adapter.convex.persisted-demand-peer.chromium-opfs`,
  async (history, id) => {
    const active = browser
    if (!active) throw new Error(`Peer browser did not start`)
    return captureBrowserHistory(active, () =>
      active.page.evaluate(
        ({ input, collectionId }) =>
          window.runAdapterPersistedDemandPeer(input, collectionId),
        { input: history, collectionId: id },
      ),
    )
  },
  {
    owns: [
      `../convex-db-collection/src/options.ts#createConvexOptions`,
      `../db-sqlite-persistence-core/src/persisted.ts`,
    ],
    path: `Actual Convex SDK in Chromium over controlled WebSocket input and closed/reopened worker/OPFS`,
  },
)
