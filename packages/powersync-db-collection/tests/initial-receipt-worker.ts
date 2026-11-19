/** An isolated Node host records actual detached receipt rejections. */
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { describeOracleCleanupError } from '../../db/tests/oracle-cleanup'
import { createStartupHost } from '../../db-adapter-conformance/tests/persisted-startup-host'
import { retainInitialReceiptCleanup } from '../../powersync-direct-collection/tests/persisted-initial-receipt-driver'
import { powerSyncEagerReloadAdapter } from './eager-reload-driver'
import { observePowerSyncInitialReceipt } from './initial-receipt-common'
import type { InitialReceiptHistory } from '../../powersync-direct-collection/tests/initial-receipt-oracle'

const input = JSON.parse(readFileSync(0, `utf8`)) as {
  history: InitialReceiptHistory
  host: `controlled` | `node-sqlite`
  teardownFault?: `cleanup-only` | `mismatch-and-cleanup`
}
const detachedErrors: Array<string> = []
process.on(`unhandledRejection`, (reason) =>
  detachedErrors.push(describeOracleCleanupError(reason)),
)
const storage = createStartupHost(input.host)
const observed = await retainInitialReceiptCleanup(
  () =>
    observePowerSyncInitialReceipt(
      powerSyncEagerReloadAdapter,
      input.history,
      storage.persistence,
      storage.holdBaseline,
      `native-powersync-receipt-${input.host}`,
      detachedErrors,
    ),
  [
    async () => {
      await storage.close()
      if (input.teardownFault === `mismatch-and-cleanup`)
        void Promise.reject(
          new Error(`Injected native receipt storage rejection`),
        )
    },
  ],
)
// Source and storage disposal can schedule detached rejection continuations.
for (let turn = 0; turn < 8; turn++)
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
process.stdout.write(
  `RECEIPT_OBSERVATION:${JSON.stringify({ ...observed, detachedErrors: [...detachedErrors] })}\n`,
)
if (input.teardownFault) {
  process.stderr.write(`Injected native receipt worker failure after record\n`)
  process.exitCode = 23
}
