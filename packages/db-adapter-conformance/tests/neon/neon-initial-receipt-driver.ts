/**
 * The installed SDK supplies an authoritative baseline through real v2 frames.
 * A held row read in the real persisted wrapper defers source admission and
 * returns a genuine asynchronous receipt. Cleanup precedes admission, or follows
 * application. The shared receipt model supplies every expected observation.
 *
 * Standalone Neon uses truncate, which core applies immediately even while an
 * optimistic transaction persists. That path cannot supply this async premise.
 * Controlled memory storage establishes no SQLite or durable-reopen claim.
 */
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../../db-sqlite-persistence-core/src'
import { retainOracleCleanupObservation } from '../../../db/tests/oracle-cleanup'
import { startupRows } from '../persisted-startup-oracle'
import { untilStartup } from '../persisted-startup-driver'
import { createAdapter } from '../memory-persistence'
import { realtimeCollectionOptions } from './vendor/collection-options'
import { NeonSDKProvider, neonSDKQuery } from './neon-sdk-driver'
import type { StartupRow } from '../persisted-startup-oracle'
import type {
  InitialReceiptHistory,
  InitialReceiptObservation,
} from '../../../powersync-direct-db-collection/tests/initial-receipt-oracle'

export const neonReceiptTurn = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0))
let sequence = 0
export async function observeNeonInitialReceipt(
  history: InitialReceiptHistory,
  detachedErrors: Array<string>,
  fault?: `cleanup-only` | `mismatch-and-cleanup`,
): Promise<InitialReceiptObservation> {
  const provider = new NeonSDKProvider([
    { name: `id`, type_oid: 25, typmod: -1, codec: `pg_text` },
    { name: `value`, type_oid: 23, typmod: -1, codec: `pg_text` },
  ])
  const adapter = createAdapter([])
  const loadSnapshot = adapter.loadResumeSnapshot
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let held = false,
    used = false
  adapter.loadResumeSnapshot = async (...args) => {
    if (!used && args[1]?.includeRows !== false) {
      used = true
      held = true
      await gate
      held = false
    }
    return loadSnapshot(...args)
  }
  const options = realtimeCollectionOptions({
    id: `neon-receipt-${sequence++}`,
    client: provider.client,
    query: neonSDKQuery<StartupRow>(),
    getKey: (row: StartupRow) => row.id,
  })
  const sync = options.sync.sync
  let firstReceipt: true | Promise<void> | undefined
  options.sync.sync = (params) =>
    sync({
      ...params,
      commit: (signal) => {
        const receipt = params.commit(signal)
        firstReceipt ??= receipt
        // Before native rejection-event turns, production alone owns its error
        // continuation. A recorder .then/.catch here would hide a missing handler.
        return receipt
      },
    })
  const collection = createCollection(
    persistedCollectionOptions({ ...options, persistence: { adapter } }),
  )
  const completed =
    await retainOracleCleanupObservation<InitialReceiptObservation>(async () => {
      const preload = collection.preload().catch(() => {})
      await untilStartup(() => held)
      await provider.deliverWireRows(
        startupRows(history.rows, 2).map((row, index) => ({
          row_key: (index + 1).toString(16).padStart(64, `0`),
          values: [row.id, String(row.value)],
        })),
      )
      await untilStartup(() => firstReceipt !== undefined)
      let receiptAppliedBeforeCleanup = false
      if (history.cleanupAt === `after-application`) {
        release()
        await preload
        await firstReceipt
        receiptAppliedBeforeCleanup = true
      }
      const receiptPendingAtCleanup = firstReceipt !== true && held
      const cleanup = collection.cleanup()
      release()
      await cleanup
      for (let turn = 0; turn < 8; turn++) await neonReceiptTurn()
      let receiptRejected = false
      try {
        await firstReceipt
      } catch {
        receiptRejected = true
      }
      return {
        receiptCreated: firstReceipt !== undefined && firstReceipt !== true,
        receiptPendingAtCleanup,
        receiptAppliedBeforeCleanup,
        receiptRejected,
        receiptSettled: true,
        finalStatus: collection.status,
        finalRows: collection.toArray,
        detachedErrors,
      }
    }, [
      () => release(),
      () => collection.cleanup(),
      () => {
        provider.dispose()
        if (fault === `mismatch-and-cleanup`)
          void Promise.reject(
            new Error(`Injected native Neon receipt rejection`),
          )
        if (fault) throw new Error(`Injected Neon provider teardown failure`)
      },
    ])
  for (let turn = 0; turn < 8; turn++) await neonReceiptTurn()
  return { ...completed, detachedErrors: [...detachedErrors] }
}
