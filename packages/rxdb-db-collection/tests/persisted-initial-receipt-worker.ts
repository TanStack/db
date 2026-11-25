/** Native detached-error events accompany a real deferred source receipt. */
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { createStartupHost } from '../../db-adapter-conformance/tests/persisted-startup-host'
import {
  describeOracleCleanupError,
  retainOracleCleanupObservation,
} from '../../db/tests/oracle-cleanup'
import { observeRxdbPersistedInitialReceipt } from './persisted-initial-receipt-driver'
import type { InitialReceiptHistory } from '../../powersync-direct-collection/tests/initial-receipt-oracle'

const input = JSON.parse(readFileSync(0, `utf8`)) as {
  history: InitialReceiptHistory
  host: `controlled` | `node-sqlite`
  injectDetachedRejection?: boolean
  failAfterRecord?: boolean
}
const detachedErrors: Array<string> = []
process.on(`unhandledRejection`, (reason) =>
  detachedErrors.push(describeOracleCleanupError(reason)),
)
const storage = createStartupHost(input.host)
const observed = await retainOracleCleanupObservation(
  () =>
    observeRxdbPersistedInitialReceipt(
      input.history,
      storage.persistence,
      storage.holdBaseline,
      `rxdb-persisted-receipt-${input.host}`,
      detachedErrors,
      input.injectDetachedRejection,
    ),
  [() => storage.close()],
)
// Keep the native recorder alive through both source and persistence teardown.
for (let turn = 0; turn < 8; turn++)
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
process.stdout.write(
  `RECEIPT_OBSERVATION:${JSON.stringify({ ...observed, detachedErrors: [...detachedErrors] })}\n`,
)
if (input.failAfterRecord) {
  process.stderr.write(`Injected RxDB receipt worker failure after record\n`)
  process.exitCode = 23
}
