/** Real Chromium receives the same synchronous eager materialization judgment. */
import { afterAll, beforeAll } from 'vitest'
import { oracleProperty } from '../../db/tests/oracle-property'
import { immediateEagerMaterializationOptions } from '../../query-db-collection/tests/immediate-eager-materialization-oracle'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import { deliverQueryHistory } from './query-ownership-browser-support'
import type { QueryReceivingResult } from './query-ownership-browser-support'
import type { ImmediateMaterializationHistory } from '../../query-db-collection/tests/immediate-eager-materialization-oracle'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry:
      '/packages/browser-db-sqlite-persistence/e2e/query-ownership.opfs.html',
    ready: 'runQueryImmediateEagerMaterialization',
  })
}, 120000)
afterAll(async () => {
  await browser?.close()
}, 120000)
const options = immediateEagerMaterializationOptions(async (h, id, observe) => {
  const activeBrowser = browser
  if (!activeBrowser) throw new Error('Chromium receiver not initialized')
  const result = await captureBrowserHistory(activeBrowser, () =>
    activeBrowser.page.evaluate(
      async ({ history, collectionId }) =>
        (
          window as unknown as {
            runQueryImmediateEagerMaterialization: (
              history: ImmediateMaterializationHistory,
              id: string,
            ) => Promise<QueryReceivingResult>
          }
        ).runQueryImmediateEagerMaterialization(history, collectionId),
      { history: h, collectionId: id },
    ),
  )
  deliverQueryHistory(result, observe)
}, 'chromium')
oracleProperty({
  ...options,
  id: 'query.immediate-eager-materialization.chromium-opfs',
  check: (h, trace, expected) => options.check(h, trace, expected),
})
