// @vitest-environment node
/**
 * Chromium receives the same complete-result reload grammar, model, checks,
 * generated reach obligations and calibrations as Node. The real ShapeStream
 * consumes controlled HTTP; this is not a real Electric server witness.
 */
import { afterAll, beforeAll } from 'vitest'
import {
  registerEagerGateFailureConformance,
  registerEagerReloadConformance,
} from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../../browser-db-sqlite-persistence/tests/adapter-chromium-host'
import { registerInitialReceiptConformance } from '../../powersync-direct-collection/tests/initial-receipt-oracle-suite'
import { oracleProperty } from '../../db/tests/oracle-property'
import {
  eagerLiveSourceHistories,
  eagerLiveSourceOracle,
} from '../../db-adapter-conformance/tests/eager-live-source-property-oracle'
import { eagerLiveSourceVerdict } from '../../db-adapter-conformance/tests/eager-live-source-framework-oracle'
import { crossElectricReloadAdapter } from './cross-adapter-reload-driver'
import { crossElectricGateAdapter } from './cross-adapter-gate-driver'
import { registerElectricMutation } from './cross-adapter-mutation-registration-oracle'
import { receiveElectricMutation } from './cross-adapter-mutation-driver'
import { registerDecoder } from './sdk-decoder-oracle-suite'
import { registerSnapshotReceiving } from './sdk-snapshot-receiving-oracle-suite'
import { electricConformanceDriver } from './conformance-driver'
import type { observeSDKSnapshotDelivery } from './sdk-snapshot-delivery-oracle'
import type {
  EagerLiveSourceHistory,
  EagerLiveSourceReachState,
} from '../../db-adapter-conformance/src'
import type { EagerHistoryResult } from '../../db-adapter-conformance/tests/eager-live-source-framework-oracle'
import type { DecoderHistory, DecoderObservation } from './sdk-decoder-oracle'
import type { DecoderFault } from './sdk-decoder-driver'
import type { ElectricMutationTransport } from './cross-adapter-mutation-driver'
import type { MutationConfirmationHistory } from '../../db/tests/mutation-confirmation-oracle'
import type {
  runElectricEagerGate,
  runElectricEagerReload,
  runElectricInitialReceipt,
} from './cross-adapter-receiving'

let host: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  host = await startAdapterChromium({
    entry: `/packages/electric-db-collection/tests/cross-adapter-receiving.html`,
    ready: `runElectricEagerReload`,
  })
}, 120_000)
afterAll(async () => host?.close(), 120_000)

registerSnapshotReceiving(
  `electric.sdk-snapshot-delivery.chromium`,
  async (history, dropRows, cleanupFault) => {
    if (!host) throw new Error(`Electric Chromium host did not start`)
    const active = host
    return captureBrowserHistory(active, () =>
      active.page.evaluate(
        ({ history: input, dropRows: fault, cleanupFault: cleanup }) =>
          (
            window as unknown as {
              runElectricSDKSnapshot: typeof observeSDKSnapshotDelivery
            }
          ).runElectricSDKSnapshot(input, fault, cleanup),
        { history, dropRows, cleanupFault },
      ),
    )
  },
)

// The browser supplies a real host to the existing complete eager-source
// judgment. Keep both configurations, the seed, 400-run budgets, construction
// obligations and each original source-law checkpoint from the Node owner.
for (const { property, appOnError } of [
  {
    property: `adapter-conformance.eager-live-source.electric.chromium`,
    appOnError: true,
  },
  {
    property: `adapter-conformance.eager-live-source.electric.no-on-error.chromium`,
    appOnError: false,
  },
]) {
  const driver = electricConformanceDriver({ appOnError })
  const receive =
    (corruption?: `values`) =>
    async (
      history: EagerLiveSourceHistory,
      observe: (checkpoint: string, value: unknown) => void,
    ) => {
      if (!host) throw new Error(`Electric Chromium host did not start`)
      const active = host
      const result = await captureBrowserHistory(active, () =>
        active.page.evaluate(
          ({ history: input, appOnError: configured, corruption: fault }) =>
            (
              window as unknown as {
                runElectricEager: (
                  h: EagerLiveSourceHistory,
                  appOnError: boolean,
                  corruption?: `values`,
                ) => Promise<EagerHistoryResult>
              }
            ).runElectricEager(input, configured, fault),
          { history, appOnError, corruption },
        ),
      )
      for (const state of result.reached) observe(`reach`, state)
      observe(`completed`, result)
    }
  oracleProperty({
    id: property,
    owns: [`src/electric.ts#electricCollectionOptions`],
    ...eagerLiveSourceOracle(driver),
    histories: {
      ...eagerLiveSourceHistories(driver),
      runs: 400,
      fixedSeeds: [2118],
    },
    driver: receive(),
    check: (
      _history,
      trace,
      required: ReadonlyArray<EagerLiveSourceReachState>,
    ) => eagerLiveSourceVerdict(trace, required),
    calibrations: [
      {
        name: `shared eager judgment rejects wrong application values`,
        law: `FID-1 (values)`,
        driver: receive(`values`),
      },
    ],
    timeout: 300_000,
  })
}

registerDecoder(
  `electric.sdk-decoder-delivery.chromium`,
  async (history, id, fault) => {
    if (!host) throw new Error(`Electric Chromium host did not start`)
    const active = host
    const result = await captureBrowserHistory(active, () =>
      active.page.evaluate(
        ({ history: input, id: collectionId, fault: injected }) =>
          (
            window as unknown as {
              runElectricDecoder: (
                h: DecoderHistory,
                id: string,
                fault?: DecoderFault,
              ) => Promise<DecoderObservation>
            }
          ).runElectricDecoder(input, collectionId, injected),
        { history, id, fault },
      ),
    )
    return { ...result, receivingErrors: result.browserErrors }
  },
)

registerElectricMutation(
  `adapter.electric.mutation-confirmation.chromium`,
  async (history, fault) => {
    if (!host) throw new Error(`Electric Chromium host did not start`)
    const active = host
    const result = await captureBrowserHistory(active, () =>
      active.page.evaluate(
        ({ history: input, fault: injected }) =>
          (
            window as unknown as {
              runElectricMutation: (
                h: MutationConfirmationHistory,
                fault?: `cleanup-only` | `mismatch-and-cleanup`,
              ) => Promise<ElectricMutationTransport>
            }
          ).runElectricMutation(input, injected),
        { history, fault },
      ),
    )
    return {
      ...receiveElectricMutation(result),
      receivingErrors: result.browserErrors,
    }
  },
)

registerEagerReloadConformance(
  `adapter.electric.eager-reload.chromium`,
  crossElectricReloadAdapter,
  {
    owns: [`src/electric.ts#electricCollectionOptions`],
    replacement: `truncate`,
    receive: async (history, id, omitTruncate) => {
      if (!host) throw new Error(`Electric Chromium host did not start`)
      const active = host
      const result = await captureBrowserHistory(active, () =>
        active.page.evaluate(
          ({ history: input, id: collectionId, omitTruncate: mutant }) =>
            (
              window as unknown as {
                runElectricEagerReload: typeof runElectricEagerReload
              }
            ).runElectricEagerReload(input, collectionId, mutant),
          { history, id, omitTruncate },
        ),
      )
      return { ...result, receivingErrors: result.browserErrors }
    },
  },
)

let receiptSequence = 0
for (const { property, heldReceiptOutcome } of [
  {
    property: `adapter.electric.initial-receipt.chromium`,
    heldReceiptOutcome: `rejected`,
  },
  {
    property: `adapter.electric.initial-receipt.applied.chromium`,
    heldReceiptOutcome: `applied`,
  },
] as const)
  registerInitialReceiptConformance(
    property,
    async (history) => {
      if (!host) throw new Error(`Electric Chromium host did not start`)
      const active = host
      const result = await captureBrowserHistory(active, () =>
        active.page.evaluate(
          ({ history: input, id, heldReceiptOutcome: outcome }) =>
            (
              window as unknown as {
                runElectricInitialReceipt: typeof runElectricInitialReceipt
              }
            ).runElectricInitialReceipt(input, id, outcome),
          {
            history,
            id: `electric-receipt-${receiptSequence++}`,
            heldReceiptOutcome,
          },
        ),
      )
      return {
        ...result,
        detachedErrors: [...result.detachedErrors, ...result.browserErrors],
      }
    },
    {
      owns: [`src/electric.ts#electricCollectionOptions`],
      heldReceiptOutcome,
      limits: `Three source keys, complete initial transaction and cleanup, actual Chromium worker/OPFS receipt and native detached errors. Held outcome ${heldReceiptOutcome}; rejection is an injected public storage-method failure after cleanup, while applied supplies an admitted transaction finishing afterward. No real Electric server, concurrent tabs or saved-row durability claim.`,
    },
  )

registerEagerGateFailureConformance(
  `adapter.electric.eager-gate-failure.chromium`,
  crossElectricGateAdapter,
  {
    owns: [`src/electric.ts#electricCollectionOptions`],
    entries: [`fresh`, `reload`],
    receive: async (history, id) => {
      if (!host) throw new Error(`Electric Chromium host did not start`)
      const active = host
      const result = await captureBrowserHistory(active, () =>
        active.page.evaluate(
          ({ history: input, id: collectionId }) =>
            (
              window as unknown as {
                runElectricEagerGate: typeof runElectricEagerGate
              }
            ).runElectricEagerGate(input, collectionId),
          { history, id },
        ),
      )
      return { ...result, receivingErrors: result.browserErrors }
    },
  },
)
