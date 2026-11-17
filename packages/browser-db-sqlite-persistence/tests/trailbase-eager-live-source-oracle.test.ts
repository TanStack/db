// @vitest-environment node
import { afterAll, beforeAll } from 'vitest'
import { registerTrailBaseEager } from '../../trailbase-db-collection/tests/eager-live-source-oracle-suite'
import { trailBaseConformanceDriver } from '../../trailbase-db-collection/tests/conformance-driver'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from './adapter-chromium-host'
import type { EagerLiveSourceHistory } from '../../db-adapter-conformance/src'
import type { EagerHistoryResult } from '../../trailbase-db-collection/tests/eager-live-source-framework-oracle'

const property = `adapter-conformance.eager-live-source.trailbase.chromium`

let host: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  host = await startAdapterChromium({ ready: `runTrailBaseEager` })
}, 120000)
afterAll(async () => {
  await host?.close()
})
registerTrailBaseEager(
  { property, defaultRuns: 600 },
  trailBaseConformanceDriver(),
  async (history, corruptValues) => {
    return captureBrowserHistory(host!, () =>
      host!.page.evaluate(
        async ({ history: h, corruptValues: corrupt }) => {
          const receive = (
            window as unknown as {
              runTrailBaseEager: (
                history: EagerLiveSourceHistory,
                corruptValues: boolean,
              ) => Promise<EagerHistoryResult>
            }
          ).runTrailBaseEager
          return receive(h, corrupt ?? false)
        },
        { history, corruptValues },
      ),
    )
  },
)
