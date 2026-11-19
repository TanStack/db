/**
 * A real local SQLite table receives the independent hook law. Public direct
 * subscriptions start/release subset acquisitions; a real optimistic
 * transaction holds core's actual applied receipt. Gates control user hooks
 * and user cleanup callbacks only. The model never sees provider internals.
 */
import { Schema, Table, column } from '@powersync/common'
import { createCollection, createTransaction } from '@tanstack/db'
import { z } from 'zod'
import { untilStartup } from '../../db-adapter-conformance/tests/persisted-startup-driver'
import {
  sortedStartupRows,
  startupRows,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { powerSyncCollectionOptions } from '../src'
import { retainNativeObservation } from './receiving-cleanup'
import type { CommonPowerSyncDatabase } from '@powersync/common'
import type {
  HookHistory,
  HookObservation,
  HookState,
} from './hook-lifecycle-oracle'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'

export type NativeReceivingOpen = (schema: Schema) => Promise<{
  database: CommonPowerSyncDatabase
  dispose: () => Promise<unknown>
}>
const schema = new Schema({ rows: new Table({ value: column.integer }) })
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export async function observePowerSyncHooks(
  open: NativeReceivingOpen,
  h: HookHistory,
  id: string,
  optionsFactory: typeof powerSyncCollectionOptions = powerSyncCollectionOptions,
): Promise<HookObservation> {
  const source = await open(schema)
  return retainNativeObservation<HookObservation>(async () => {
    const database = source.database
    let trackingSettled = false
    const createTrigger = database.triggers.createDiffTrigger.bind(
      database.triggers,
    )
    database.triggers.createDiffTrigger = async (options) => {
      try {
        return await createTrigger(options)
      } finally {
        trackingSettled = true
      }
    }
    await database.writeTransaction(async (tx) => {
      for (const row of startupRows(h.rows, 2))
        await tx.execute(`INSERT INTO rows(id,value) VALUES (?,?)`, [
          row.id,
          row.value,
        ])
    })
    const watcherReleases: Array<number> = []
    const register = database.onChangeWithCallback.bind(database)
    database.onChangeWithCallback = (handler, options) => {
      const index = watcherReleases.push(0) - 1
      options?.signal?.addEventListener(
        `abort`,
        () => {
          watcherReleases[index] = watcherReleases[index]! + 1
        },
        {
          once: true,
        },
      )
      return register(handler, options)
    }
    const hookError = new Error(`native hook ${h.coordinate}`)
    let entered = false
    let cleanupCalls = 0
    let releaseHook!: () => void
    const hookGate = new Promise<void>((resolve) => {
      releaseHook = resolve
    })
    let releaseCleanup!: () => void
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve
    })
    const cleanupHook = () => {
      cleanupCalls++
      return h.asynchronousCleanup ? cleanupGate : undefined
    }
    const hook = () => {
      entered = true
      if (h.completion === `throw`) throw hookError
      if (h.completion === `reject`) return Promise.reject(hookError)
      return h.completion === `async`
        ? hookGate.then(() => cleanupHook)
        : cleanupHook
    }
    const base = {
      id,
      database,
      table: schema.props.rows,
      schema: z.object({ id: z.string(), value: z.number() }),
      onDeserializationError: () => {},
    }
    const options =
      h.mode === `eager`
        ? optionsFactory({ ...base, onLoad: hook })
        : optionsFactory({
            ...base,
            syncMode: `on-demand`,
            onLoadSubset: hook,
          })
    let receiptPending = false
    let receiptCreated = false
    const sync = options.sync.sync
    options.sync.sync = (params) =>
      sync({
        ...params,
        commit: (signal) => {
          const receipt = params.commit(signal)
          if (receipt !== true) {
            receiptCreated = receiptPending = true
            void receipt.then(
              () => {
                receiptPending = false
              },
              () => {
                receiptPending = false
              },
            )
          }
          return receipt
        },
      })
    const collection = createCollection(options)
    let load = `pending`
    let loadErrorMatches = false
    let rowsAtFulfillment: Array<StartupRow> = []
    const observeLoad = (promise: true | Promise<void>) =>
      Promise.resolve(promise).then(
        () => {
          load = `fulfilled`
          rowsAtFulfillment = sortedStartupRows(collection.values())
        },
        (error: unknown) => {
          load = `rejected`
          loadErrorMatches = error === hookError
        },
      )
    const subscription = collection.subscribeChanges(() => {})
    let pendingLoad: Promise<void> | undefined
    let releaseMutation!: () => void
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve
    })
    let mutation: ReturnType<typeof createTransaction> | undefined
    let cleanupPending = false
    let cleanupPromise: Promise<void> | undefined
    const beginCleanup = () => {
      cleanupPending = true
      cleanupPromise = collection.cleanup().finally(() => {
        cleanupPending = false
      })
      void cleanupPromise.catch(() => {})
      return cleanupPromise
    }
    return retainNativeObservation<HookObservation>(async () => {
      if (h.mode === `eager`) pendingLoad = observeLoad(collection.preload())
      else {
        await collection.preload()
        if (h.holdApplied) {
          mutation = createTransaction({ mutationFn: () => mutationGate })
          mutation.mutate(() =>
            collection.insert({ id: `optimistic`, value: 99 }),
          )
        }
        subscription.requestSnapshot({
          onLoadSubsetResult: (result) => {
            pendingLoad = observeLoad(result)
          },
        })
      }
      await untilStartup(() => entered)
      let cleanupWaitedForHook = false
      let cleanupWaitedForReturnedCleanup = false
      let appliedReceiptHeld = false
      let loadPendingAtAppliedHold = false
      const reached: Array<HookState> = []
      if (h.retirement === `cleanup-pending`) {
        beginCleanup()
        await turn()
        await turn()
        cleanupWaitedForHook = cleanupPending
        if (cleanupWaitedForHook) reached.push(`${h.mode}:cleanup-pending`)
      } else if (h.retirement === `release-pending`) {
        subscription.unsubscribe()
        reached.push(`on-demand:release-pending`)
      }
      releaseHook()
      if (h.holdApplied) {
        await untilStartup(() => receiptCreated)
        // Receipt creation can precede the trigger's remaining SQL setup. Drain
        // that actual provider work while optimistic visibility remains held;
        // otherwise an early-fulfilling adapter can look pending by accident.
        await untilStartup(() => trackingSettled)
        await database.writeTransaction(() => Promise.resolve())
        for (let index = 0; index < 8; index++) await turn()
        appliedReceiptHeld = receiptPending
        loadPendingAtAppliedHold = load === `pending`
        if (appliedReceiptHeld && loadPendingAtAppliedHold)
          reached.push(`applied-held`)
        releaseMutation()
        await mutation?.when(`settled`)
      }
      // The authored hook has now returned or settled. A real SQLite lock
      // boundary drains earlier adapter work without polling the expected
      // load/cleanup outcome. Missing callbacks and early fulfillment therefore
      // remain observations that the model can reject, rather than setup waits.
      await hookGate
      if (
        h.retirement === `settled` &&
        (h.completion === `sync` || h.completion === `async`)
      )
        await untilStartup(() => trackingSettled)
      for (let index = 0; index < 4; index++) await turn()
      await database.writeTransaction(() => Promise.resolve())
      for (let index = 0; index < 4; index++) await turn()
      if (h.retirement === `settled`) reached.push(`${h.mode}:${h.completion}`)
      const statusAfterHook = collection.status
      const errorAfterHook = collection.health.error !== null
      const rowsAfterHook = sortedStartupRows(collection.values())
      if (!cleanupPromise) beginCleanup()
      if (h.asynchronousCleanup) {
        for (let index = 0; index < 4; index++) await turn()
        cleanupWaitedForReturnedCleanup = cleanupPending
        if (cleanupWaitedForReturnedCleanup)
          reached.push(`asynchronous-cleanup`)
      }
      releaseCleanup()
      await cleanupPromise
      await pendingLoad
      reached.push(h.rows ? `nonempty-source` : `empty-source`)
      return {
        entered,
        load,
        loadErrorMatches,
        statusAfterHook,
        errorAfterHook,
        rowsAfterHook,
        rowsAtFulfillment,
        cleanupCalls,
        cleanupWaitedForHook,
        cleanupWaitedForReturnedCleanup,
        appliedReceiptHeld,
        loadPendingAtAppliedHold,
        finalStatus: collection.status,
        finalRows: sortedStartupRows(collection.values()),
        watcherReleases,
        reached,
      }
    }, [
      () => {
        releaseHook()
        releaseCleanup()
        releaseMutation()
      },
      () => subscription.unsubscribe(),
      () => collection.cleanup(),
    ])
  }, [source.dispose])
}
