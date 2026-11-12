import { afterAll, beforeAll, it } from 'vitest'
import { oracleReplayRequested } from '../../db/tests/oracle-config'
import { oracleProperty } from '../../db/tests/oracle-property'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import {
  calibrateGeneratedConstructions,
  options,
} from '../../query-db-collection/tests/scope-omission-reacquisition-oracle'
import { deliverQueryHistory } from './query-ownership-browser-support'
import type { History } from '../../query-db-collection/tests/scope-omission-reacquisition-oracle'
import type { QueryReceivingResult } from './query-ownership-browser-support'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry:
      '/packages/browser-db-sqlite-persistence/e2e/query-scope-omission.opfs.html',
    ready: 'runScopeOmission',
  })
}, 120000)
afterAll(async () => {
  await browser?.close()
}, 120000)
const receive: Parameters<typeof options>[0] = async (h, id, observe) => {
  if (!browser) throw new Error('Missing Chromium receiver')
  const host = browser
  const result = await captureBrowserHistory(host, () =>
    host.page.evaluate(
      ({ history, collectionId }) =>
        (
          window as unknown as {
            runScopeOmission: (
              h: History,
              id: string,
            ) => Promise<QueryReceivingResult>
          }
        ).runScopeOmission(history, collectionId),
      { history: h, collectionId: id },
    ),
  )
  observe('browserReceiver', true)
  deliverQueryHistory(result, observe)
}
const property = options(receive, 'chromium-opfs')
oracleProperty({
  ...property,
  check: (h, trace, expected) => property.check(h, trace, expected),
})
let controlSequence = 0
it.skipIf(oracleReplayRequested())(
  'rejects missing states from generated constructions',
  () =>
    calibrateGeneratedConstructions((h, observe) =>
      receive(h, 'generated-control-browser-' + controlSequence++, observe),
    ),
  120000,
)
