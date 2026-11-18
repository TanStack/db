/** Real-browser receivers share the Node oracle's model, grammar and checker. */
import { afterAll, beforeAll } from 'vitest'
import {
  registerEagerGateFailureConformance,
  registerEagerReloadConformance,
} from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import {
  queryEagerGateAdapter,
  queryEagerReloadAdapter,
} from '../../query-db-collection/tests/eager-reload-driver'
import { registerQuerySelectFailures } from '../../query-db-collection/tests/select-failures-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import { deliverQueryHistory } from './query-ownership-browser-support'
import type { QueryReceivingResult } from './query-ownership-browser-support'
import type {
  EagerGateHistory,
  EagerGateObservation,
  EagerReloadHistory,
  EagerReloadObservation,
} from '../../db-adapter-conformance/tests/eager-reload-oracle'
import type { FailingQueryHistory } from '../../query-db-collection/tests/failing-queries-oracle'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/query-cross-adapter-receiving.opfs.html`,
    ready: `runQuerySelectFailures`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)

registerEagerReloadConformance(
  `adapter.query.complete-result-reload.chromium`,
  queryEagerReloadAdapter,
  {
    owns: [`../query-db-collection/src/query.ts#queryCollectionOptions`],
    replacement: `snapshot-and-sweep`,
    receive: async (history, id, invertSnapshot) => {
      const active = browser
      if (!active) throw new Error(`Chromium receiver not initialized`)
      const result = await captureBrowserHistory(active, () =>
        active.page.evaluate(
          async ({ history: h, id: collectionId, invertSnapshot: invert }) =>
            (
              window as unknown as {
                runQueryCompleteReload: (
                  h: EagerReloadHistory,
                  id: string,
                  invert: boolean,
                ) => Promise<EagerReloadObservation>
              }
            ).runQueryCompleteReload(h, collectionId, invert),
          { history, id, invertSnapshot },
        ),
      )
      return { ...result, receivingErrors: result.browserErrors }
    },
  },
)

registerQuerySelectFailures(`query-db.select-failures.chromium-opfs`, {
  owns: [`../query-db-collection/src/query.ts#queryCollectionOptions`],
  receive: async (history, observe) => {
    const active = browser
    if (!active) throw new Error(`Chromium receiver not initialized`)
    const result = await captureBrowserHistory(active, () =>
      active.page.evaluate(
        async (h) =>
          (
            window as unknown as {
              runQuerySelectFailures: (
                h: FailingQueryHistory,
              ) => Promise<QueryReceivingResult>
            }
          ).runQuerySelectFailures(h),
        history,
      ),
    )
    deliverQueryHistory(result, observe)
  },
})

registerEagerGateFailureConformance(
  `adapter.query.initial-gate.chromium`,
  queryEagerGateAdapter,
  {
    owns: [`../query-db-collection/src/query.ts#queryCollectionOptions`],
    entries: [`fresh`, `reload`],
    receive: async (history, id) => {
      const active = browser
      if (!active) throw new Error(`Chromium receiver not initialized`)
      const result = await captureBrowserHistory(active, () =>
        active.page.evaluate(
          async ({ history: h, id: collectionId }) =>
            (
              window as unknown as {
                runQueryInitialGate: (
                  h: EagerGateHistory,
                  id: string,
                ) => Promise<EagerGateObservation>
              }
            ).runQueryInitialGate(h, collectionId),
          { history, id },
        ),
      )
      return { ...result, receivingErrors: result.browserErrors }
    },
  },
)
