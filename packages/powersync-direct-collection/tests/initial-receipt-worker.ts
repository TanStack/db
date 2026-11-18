/**
 * Native Node receiver for the source-receipt law. It records real process
 * unhandledRejection events and still exits normally, so the oracle's shared
 * comparison supplies a detached-error failure rather than a worker crash.
 */
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { createCollection } from '@tanstack/db'
import { describeOracleCleanupError } from '../../db/tests/oracle-cleanup'
import { directEagerClient } from './eager-reload-driver'
import { eagerProtocolTurn, untilEagerProtocol } from './eager-protocol-service'
import { initialReceiptModel } from './initial-receipt-oracle'
import type {
  InitialReceiptHistory,
  InitialReceiptObservation,
} from './initial-receipt-oracle'

const history = JSON.parse(readFileSync(0, `utf8`)) as InitialReceiptHistory
const detachedErrors: Array<string> = []
process.on(`unhandledRejection`, (reason) => {
  detachedErrors.push(describeOracleCleanupError(reason))
})
const source = directEagerClient()
const options = source.options(`controlled-initial-receipt`)
const sync = options.sync.sync
let receiptCreated = false
let receiptPending = false
let receiptApplied = false
let receiptRejected = false
let releaseReceipt = () => {}
options.sync.sync = (params) =>
  sync({
    ...params,
    commit: (signal) => {
      receiptCreated = true
      receiptPending = true
      return new Promise<void>((resolve, reject) => {
        const abort = () => {
          receiptPending = false
          receiptRejected = true
          reject(
            new DOMException(`cleanup receipt ${history.reason}`, `AbortError`),
          )
        }
        signal?.addEventListener(`abort`, abort, { once: true })
        releaseReceipt = () => {
          signal?.removeEventListener(`abort`, abort)
          const applied = params.commit(signal)
          void Promise.resolve(applied).then(() => {
            receiptPending = false
            receiptApplied = true
            resolve()
          }, reject)
        }
      })
    },
  })
const collection = createCollection(options)
const preload = collection.preload().catch(() => {})
await source.service.rows(initialReceiptModel(history).source)
await untilEagerProtocol(
  () => receiptCreated,
  `source returned pending receipt`,
)
// Let the eager continuation reach its await of the same actual pending receipt.
await source.propagate()
if (history.cleanupAt === `after-application`) {
  releaseReceipt()
  await preload
}
const receiptPendingAtCleanup = receiptPending
const receiptAppliedBeforeCleanup = receiptApplied
await collection.cleanup()
// Node emits unhandledRejection after the rejecting microtask turn. The eight
// task boundaries retain that public event without relying on process failure.
for (let turn = 0; turn < 8; turn++) await eagerProtocolTurn()
const observed: InitialReceiptObservation = {
  receiptCreated,
  receiptPendingAtCleanup,
  receiptAppliedBeforeCleanup,
  receiptRejected,
  finalStatus: collection.status,
  finalRows: [...collection.values()],
  detachedErrors,
}
process.stdout.write(`RECEIPT_OBSERVATION:${JSON.stringify(observed)}\n`)
