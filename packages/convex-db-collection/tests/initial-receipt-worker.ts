/**
 * Native Node supplies detached-rejection observations for the shared initial
 * receipt cleanup law. Only the asynchronous receipt boundary is controlled;
 * installed SDK delivery, adapter conversion, core writes and cleanup are real.
 * A wrapping acceptance boundary may reject after sync invalidation. Cleanup
 * invokes that rejection after the adapter cleanup, then records native events.
 */
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { createCollection } from '@tanstack/db'
import { ConvexClient } from 'convex/browser'
import { describeOracleCleanupError } from '../../db/tests/oracle-cleanup'
import { convexCollectionOptions } from '../src'
import { initialReceiptModel } from '../../powersync-direct-db-collection/tests/initial-receipt-oracle'
import { ConvexProvider, rowsQuery } from './conformance-driver'
import type {
  InitialReceiptHistory,
  InitialReceiptObservation,
} from '../../powersync-direct-db-collection/tests/initial-receipt-oracle'

const history = JSON.parse(readFileSync(0, `utf8`)) as InitialReceiptHistory & {
  client: `javascript` | `react` | `wrapped`
  fault?: `cleanup-only` | `mismatch-and-cleanup`
}
const detachedErrors: Array<string> = []
process.on(`unhandledRejection`, (error) =>
  detachedErrors.push(describeOracleCleanupError(error)),
)
const provider = new ConvexProvider(history.client)
const options = convexCollectionOptions({
  id: `convex-initial-receipt`,
  client:
    history.client === `wrapped` && provider.client instanceof ConvexClient
      ? { onUpdate: provider.client.onUpdate.bind(provider.client) }
      : provider.client,
  query: rowsQuery,
  queryArgs: {},
  select: (rows) =>
    rows.map((row) => ({
      id: String.fromCharCode(97 + row.id),
      value: row.value as number,
    })),
  getKey: (row) => row.id,
})
const sync = options.sync.sync
let receiptCreated = false
let receiptPending = false
let receiptApplied = false
let receiptRejected = false
let releaseReceipt = () => {}
let rejectReceipt = () => {}
options.sync.sync = (params) => {
  const result = sync({
    ...params,
    commit: (signal) => {
      receiptCreated = receiptPending = true
      return new Promise<void>((resolve, reject) => {
        rejectReceipt = () => {
          receiptPending = false
          receiptRejected = true
          reject(
            new DOMException(`cleanup receipt ${history.reason}`, `AbortError`),
          )
        }
        releaseReceipt = () => {
          void Promise.resolve(params.commit(signal)).then(() => {
            receiptPending = false
            receiptApplied = true
            resolve()
          }, reject)
        }
      })
    },
  })
  return async () => {
    if (typeof result === `function`) await result()
    else await result?.cleanup?.()
    if (receiptPending) rejectReceipt()
  }
}
const collection = createCollection(options)
const preload = collection.preload().catch(() => {})
await provider.settle()
provider.deliverSnapshot(
  initialReceiptModel(history).source.map((row) => ({
    id: row.id.charCodeAt(0) - 97,
    title: `a` as const,
    value: row.value,
  })),
)
await provider.settle()
const reachedCommit = () => receiptCreated
if (!reachedCommit()) throw new Error(`SDK did not reach the initial commit`)
if (history.cleanupAt === `after-application`) {
  releaseReceipt()
  await preload
}
const receiptPendingAtCleanup = receiptPending
const receiptAppliedBeforeCleanup = receiptApplied
await collection.cleanup()
for (let turn = 0; turn < 8; turn++)
  await new Promise((resolve) => setTimeout(resolve, 0))
const observed: InitialReceiptObservation = {
  receiptCreated,
  receiptPendingAtCleanup,
  receiptAppliedBeforeCleanup,
  receiptRejected,
  finalStatus: collection.status,
  finalRows: [...collection.values()],
  detachedErrors,
}
try {
  await provider.dispose()
} catch (error) {
  observed.cleanupErrors = [
    ...(observed.cleanupErrors ?? []),
    describeOracleCleanupError(error),
  ]
}
if (history.fault === `mismatch-and-cleanup`)
  observed.detachedErrors.push(`injected detached receipt rejection`)
process.stdout.write(`RECEIPT_OBSERVATION:${JSON.stringify(observed)}\n`)
if (history.fault) {
  process.stderr.write(`injected post-record receipt worker failure\n`)
  process.exitCode = 1
}
