/** Native rejection events remain observations for the shared receipt law. */
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { describeOracleCleanupError } from '../../../db/tests/oracle-cleanup'
import { observeNeonInitialReceipt } from './neon-initial-receipt-driver'
import type { InitialReceiptHistory } from '../../../powersync-direct-collection/tests/initial-receipt-oracle'

const { history, fault } = JSON.parse(readFileSync(0, `utf8`)) as {
  history: InitialReceiptHistory
  fault?: `cleanup-only` | `mismatch-and-cleanup`
}
const detached: Array<string> = []
process.on(`unhandledRejection`, (error) => {
  detached.push(describeOracleCleanupError(error))
})
const observed = await observeNeonInitialReceipt(history, detached, fault)
process.stdout.write(`RECEIPT_OBSERVATION:${JSON.stringify(observed)}\n`)
if (fault) {
  process.stderr.write(`Injected receipt worker failure after observation\n`)
  process.exitCode = 23
}
