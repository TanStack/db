// @vitest-environment node
/**
 * Real Chromium receives the identical two-obligation histories, model and
 * public-cut comparison as Node. The page imports only the production driver;
 * expected observations stay in the shared registrar. Native host errors join
 * its returned result and cannot replace an earlier semantic mismatch.
 */
import { afterAll, beforeAll } from 'vitest'
import { registerMutationEventConformance } from '../../trailbase-db-collection/tests/mutation-events-sdk-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import type {
  MutationEventHistory,
  MutationEventResult,
} from '../../trailbase-db-collection/tests/mutation-events-sdk-oracle'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/trailbase-mutation-events.opfs.html`,
    ready: `runTrailBaseMutationEvent`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)

registerMutationEventConformance(
  `trailbase.mutation-events.sdk.chromium`,
  (history, lateCleanupFailure, awaitOwnAppliedReceipt) => {
    const host = browser
    if (!host) throw new Error(`TrailBase Chromium receiver did not start`)
    return captureBrowserHistory(host, () =>
      host.page.evaluate(
        ({
          history: input,
          lateCleanupFailure: cleanupFailure,
          awaitOwnAppliedReceipt: holdHandler,
        }) =>
          (
            window as unknown as {
              runTrailBaseMutationEvent: (
                h: MutationEventHistory,
                failCleanup: boolean,
                holdHandler: boolean,
              ) => Promise<MutationEventResult>
            }
          ).runTrailBaseMutationEvent(input, cleanupFailure, holdHandler),
        {
          history,
          lateCleanupFailure: Boolean(lateCleanupFailure),
          awaitOwnAppliedReceipt: Boolean(awaitOwnAppliedReceipt),
        },
      ),
    )
  },
  {
    owns: [
      `../trailbase-db-collection/src/trailbase.ts#trailBaseCollectionOptions`,
    ],
  },
)
