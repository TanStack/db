// @vitest-environment node
/**
 * Convex receives the same host-independent initial receipt/cleanup law as the
 * direct adapter. The native child records actual unhandledRejection events;
 * JavaScript, React and wrapped clients all decode real protocol transitions.
 * The controlled receipt is a wrapping acceptance boundary, not evidence of
 * durable storage or transport cancellation. Shared registration owns truth.
 */
import { registerInitialReceiptConformance } from '../../powersync-direct-db-collection/tests/initial-receipt-oracle-suite'
import { observeInitialReceipt } from './initial-receipt-driver'

for (const client of [`javascript`, `react`, `wrapped`] as const) {
  registerInitialReceiptConformance(
    `adapter.convex.initial-receipt.${client}`,
    (history) => observeInitialReceipt(history, client),
    {
      owns: [
        `src/options.ts#createConvexOptions`,
        `src/subscription.ts#subscribeQuery`,
      ],
      limits: `Native Node, installed Convex SDK over a controlled socket, three-key initial results and held/applied receipt cleanup. The wrapper controls receipt rejection; no persistence or browser claim.`,
      receiveFault: (history, fault) =>
        observeInitialReceipt(history, client, fault),
    },
  )
}
