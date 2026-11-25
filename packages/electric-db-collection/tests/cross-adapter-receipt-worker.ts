/** An isolated native process preserves detached errors as oracle observations. */
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { describeOracleCleanupError } from '../../db/tests/oracle-cleanup'
import { createStartupHost } from '../../db-adapter-conformance/tests/persisted-startup-host'
import {
  observePersistedInitialReceipt,
  retainInitialReceiptCleanup,
} from './cross-adapter-receipt-driver'
import type { InitialReceiptHistory } from '../../powersync-direct-collection/tests/initial-receipt-oracle'

const input = JSON.parse(readFileSync(0, `utf8`)) as {
  history: InitialReceiptHistory
  host: `controlled` | `node-sqlite`
  teardownFault?: `close` | `after-record`
  heldReceiptOutcome?: `rejected` | `applied`
}
const detachedErrors: Array<string> = []
process.on(`unhandledRejection`, (reason) =>
  detachedErrors.push(describeOracleCleanupError(reason)),
)
const storage = createStartupHost(input.host)
const observed = await retainInitialReceiptCleanup(
  () =>
    observePersistedInitialReceipt(
      input.history,
      storage.persistence,
      `persisted-receipt-${input.host}`,
      detachedErrors,
      input.heldReceiptOutcome,
    ),
  [
    () => {
      storage.close()
      if (input.teardownFault === `close`)
        throw new Error(`Injected receipt storage close failure`)
    },
  ],
)
process.stdout.write(`RECEIPT_OBSERVATION:${JSON.stringify(observed)}\n`)
if (input.teardownFault === `after-record`) {
  process.stderr.write(`Injected receipt worker failure after record\n`)
  process.exitCode = 23
}
