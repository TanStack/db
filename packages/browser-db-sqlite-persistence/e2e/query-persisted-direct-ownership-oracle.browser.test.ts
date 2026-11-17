/** Real worker SQLite/OPFS receives the primary direct-row ownership judgment. */
import { afterAll, beforeAll } from 'vitest'
import { oracleProperty } from '../../db/tests/oracle-property'
import { persistedDirectOwnershipOptions } from '../../query-db-collection/tests/persisted-direct-ownership-oracle'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import { deliverQueryHistory } from './query-ownership-browser-support'
import type { QueryReceivingResult } from './query-ownership-browser-support'
import type { DirectOwnershipHistory } from '../../query-db-collection/tests/persisted-direct-ownership-oracle'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry:
      '/packages/browser-db-sqlite-persistence/e2e/query-ownership.opfs.html',
    ready: 'runQueryPersistedDirectOwnership',
  })
}, 120000)
afterAll(async () => {
  await browser?.close()
}, 120000)
const options = persistedDirectOwnershipOptions(async (h, id, observe) => {
  const activeBrowser = browser
  if (!activeBrowser) throw new Error('Chromium receiver not initialized')
  const result = await captureBrowserHistory(activeBrowser, () =>
    activeBrowser.page.evaluate(
      async ({ history, collectionId }) =>
        (
          window as unknown as {
            runQueryPersistedDirectOwnership: (
              history: DirectOwnershipHistory,
              id: string,
            ) => Promise<QueryReceivingResult>
          }
        ).runQueryPersistedDirectOwnership(history, collectionId),
      { history: h, collectionId: id },
    ),
  )
  deliverQueryHistory(result, observe)
}, 'chromium-opfs')
oracleProperty({
  ...options,
  id: 'query.persisted-direct-ownership.chromium-opfs',
  check: (h, trace, expected) => options.check(h, trace, expected),
})
