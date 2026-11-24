// @vitest-environment node
/** Node and Chromium share the six-revision grammar, model and comparison. */
import { afterAll, beforeAll } from 'vitest'
import { registerPersistedAcceptance } from '../../convex-db-collection/tests/lazy-persisted-acceptance-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/adapter-persisted-demand-acceptance.opfs.html`,
    ready: `runAdapterPersistedAcceptance`,
  })
}, 120000)
afterAll(async () => {
  await browser?.close()
}, 120000)
registerPersistedAcceptance(
  `convex.lazy-persisted-acceptance.chromium-opfs`,
  async (history, id) => {
    const active = browser
    if (!active) throw new Error(`Acceptance browser did not start`)
    return captureBrowserHistory(active, () =>
      active.page.evaluate(
        ({ input, collectionId }) =>
          window.runAdapterPersistedAcceptance(input, collectionId),
        { input: history, collectionId: id },
      ),
    )
  },
  {
    owns: [
      `../convex-db-collection/src/options.ts#createConvexOptions`,
      `../db-sqlite-persistence-core/src/persisted.ts`,
    ],
    path: `Installed Convex SDK in Chromium over controlled WebSocket transitions and worker/OPFS`,
  },
)
