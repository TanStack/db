/**
 * Chromium receives the same generated histories, model, held public cuts and
 * calibrations as Node. Only the host supplies the production trace; expected
 * rows and settlement never execute in the page. Error identity relations are
 * recorded before JSON transfer. Detached page failures remain observable.
 */
import { afterAll, beforeAll } from 'vitest'
import { registerMutationConfirmation } from '../../powersync-direct-collection/tests/mutation-confirmation-registration-oracle'
import { registerMutationCancellation } from '../../powersync-direct-collection/tests/mutation-confirmation-cancellation-registration-oracle'
import { receiveMutationTrace } from '../../powersync-direct-collection/tests/mutation-confirmation-driver'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import type {
  DirectMutationHistory,
  TransportMutationTrace,
} from '../../powersync-direct-collection/tests/mutation-confirmation-driver'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/powersync-direct-receiving.opfs.html`,
    ready: `runDirectMutationConfirmation`,
  })
}, 120000)
afterAll(async () => {
  await browser?.close()
}, 120000)

async function runInChromium(history: DirectMutationHistory) {
  const active = browser
  if (!active) throw new Error(`Chromium mutation receiving host did not start`)
  const transported = await captureBrowserHistory(active, () =>
    active.page.evaluate(
      (input) =>
        (
          window as unknown as {
            runDirectMutationConfirmation: (
              history: DirectMutationHistory,
            ) => Promise<TransportMutationTrace>
          }
        ).runDirectMutationConfirmation(input),
      history,
    ),
  )
  return receiveMutationTrace(transported)
}

registerMutationConfirmation(
  `powersync-direct.mutation-confirmation.chromium`,
  runInChromium,
  {
    owns: [
      `../powersync-direct-collection/src/index.ts#powerSyncCollectionOptions`,
    ],
  },
)
registerMutationCancellation(
  `powersync-direct.mutation-confirmation-cancellation.chromium`,
  runInChromium,
  {
    owns: [
      `../powersync-direct-collection/src/index.ts#powerSyncCollectionOptions`,
    ],
  },
)
