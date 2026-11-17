// @vitest-environment node
import { afterAll, beforeAll } from 'vitest'
import { registerHydrationLifecycle } from '../../trailbase-db-collection/tests/lifecycle-hydration-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from './adapter-chromium-host'
import type { HydrationLifecycleObservation } from '../../trailbase-db-collection/tests/lifecycle-hydration-oracle'

let host: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  host = await startAdapterChromium()
}, 120000)
afterAll(async () => {
  await host?.close()
})
const property = `trailbase.lifecycle.persisted-hydration.chromium-opfs`

registerHydrationLifecycle(property, async (history, id) => {
  return captureBrowserHistory(host!, () =>
    host!.page.evaluate(
      async ({ history: h, id: name }) => {
        const receive = (
          window as unknown as {
            runTrailBaseHydration: (
              history: typeof h,
              id: string,
            ) => Promise<HydrationLifecycleObservation>
          }
        ).runTrailBaseHydration
        return receive(h, name)
      },
      { history, id },
    ),
  )
})
