// @vitest-environment node
/**
 * Actual Chromium localStorage receives the exact generated eager-reload law
 * and replacement controls used by the custom-Storage receiver. The native
 * page returns raw observations; the shared owner judges them. This proves
 * native complete-snapshot restoration, not cross-tab storage-event delivery.
 */
import { afterAll, beforeAll } from 'vitest'
import { registerEagerReloadConformance } from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../../browser-db-sqlite-persistence/tests/adapter-chromium-host'
import { localStorageEagerReloadAdapter } from './local-storage-eager-reload-driver'
import { registerLocalStorageWriteOrder } from './local-storage-write-order-oracle'

let host: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  host = await startAdapterChromium({
    entry: `/packages/db/e2e/local-stores-receiving.html`,
    ready: `runLocalStorageReload`,
  })
}, 120_000)
afterAll(async () => {
  await host?.close()
}, 120_000)

registerEagerReloadConformance(
  `adapter.local-storage.eager-reload.chromium`,
  localStorageEagerReloadAdapter(),
  {
    owns: [`src/local-storage.ts#localStorageCollectionOptions`],
    receive: async (history, id, invertSnapshot) => {
      if (!host) throw new Error(`Native Storage host did not start`)
      const active = host
      return captureBrowserHistory(active, () =>
        active.page.evaluate(
          ({ history: input, id: identity, invertSnapshot: mutant }) =>
            window.runLocalStorageReload(input, identity, mutant),
          { history, id, invertSnapshot },
        ),
      )
    },
  },
)

let writeSequence = 0
registerLocalStorageWriteOrder(
  `local-storage.write-order.chromium`,
  async (history, observe) => {
    if (!host) throw new Error(`Native Storage host did not start`)
    const active = host
    const raw = await captureBrowserHistory(active, () =>
      active.page.evaluate(
        ({ history: input, id }) => window.runLocalStorageWriteOrder(input, id),
        { history, id: `write-${writeSequence++}` },
      ),
    )
    for (const { checkpoint, value } of raw.observations)
      observe(checkpoint, value)
    observe(`browser errors`, raw.browserErrors)
  },
)
