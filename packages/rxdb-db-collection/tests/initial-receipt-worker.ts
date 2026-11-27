/** Native host events remain facts for the shared receipt comparison. */
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { describeOracleCleanupError } from '../../db/tests/oracle-cleanup'
import { observeRxdbInitialReceipt } from './initial-receipt-driver'
import type { InitialReceiptHistory } from '../../powersync-direct-db-collection/tests/initial-receipt-oracle'

const { history, teardownFault } = JSON.parse(readFileSync(0, `utf8`)) as {
  history: InitialReceiptHistory
  teardownFault: boolean | `detached`
}
const errors: Array<string> = []
process.on(`unhandledRejection`, (error) => {
  errors.push(describeOracleCleanupError(error))
})
const observed = await observeRxdbInitialReceipt(history, errors, teardownFault)
process.stdout.write(`RECEIPT_OBSERVATION:${JSON.stringify(observed)}\n`)
