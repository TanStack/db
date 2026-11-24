/**
 * Receive the shared deferred-baseline history through the installed Convex
 * SDK and real SQLite. An actual optimistic transaction holds application.
 * Each provider revision reaches durable acceptance before its successor,
 * and handler-facing awaitSync drains the adapter's proposal-removal callback.
 * The recorder supplies facts; the shared history/model judges their values.
 */
import { IR, createTransaction, whenSyncAccepted } from '@tanstack/db'
import {
  retainOracleCleanupObservation,
  withOracleCleanup,
} from '../../db/tests/oracle-cleanup'
import { readDemandDurableRows } from '../../db-adapter-conformance/tests/persisted-demand-receiving-driver'
import { deferredBaselineRows } from './lazy-deferred-baseline-oracle'
import { convexPersistedDemandSource } from './persisted-demand-source'
import type { SyncAppliedReceipt } from '@tanstack/db'
import type { ConvexCollectionUtils } from '../src/options'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type { DemandRow } from '../../db-adapter-conformance/tests/persisted-demand-receiving-types'
import type { DeferredBaselineHistory } from './lazy-deferred-baseline-oracle'
import type { LazyRow } from './lazy-paging-model-oracle'

export type AcceptanceStorage = {
  persistence: PersistedCollectionPersistence
  close: () => unknown
}
export type PersistedAcceptanceResult = {
  cuts: Array<{
    accepted: Array<LazyRow>
    publicRows: Array<LazyRow>
    durable: Array<LazyRow>
    receiptPending: boolean
  }>
  publications: Array<Array<LazyRow>>
  finalRows: Array<LazyRow>
  reached: Array<string>
  syncError: string | undefined
  cleanupErrors: ReadonlyArray<string>
  browserErrors?: ReadonlyArray<string>
}
const copyRows = (rows: Iterable<DemandRow>): Array<LazyRow> =>
  [...rows].map(({ id, rank, value }) => ({ id, rank, text: value }))
const providerRows = (rows: ReadonlyArray<LazyRow>): Array<DemandRow> =>
  rows.map(({ id, rank, text }) => ({ id, rank, group: `a`, value: text }))

export async function observePersistedAcceptance(
  history: DeferredBaselineHistory,
  id: string,
  open: () => AcceptanceStorage | Promise<AcceptanceStorage>,
): Promise<PersistedAcceptanceResult> {
  const storage = await open()
  const receipts: Array<SyncAppliedReceipt> = []
  const source = await convexPersistedDemandSource({
    id,
    waitMs: 60000,
    persistence: storage.persistence,
    events: [],
    wrapPersistedSync: (sync) => sync,
    wrapSync: (sync) => ({
      ...sync,
      sync: (controls) =>
        sync.sync({
          ...controls,
          commit: (signal) => {
            const receipt = controls.commit(signal)
            receipts.push(receipt)
            return receipt
          },
        }),
    }),
  }).catch((error: unknown) =>
    withOracleCleanup(() => {
      throw error
    }, [() => storage.close()]),
  )
  const { collection } = source
  const utils = collection.utils as ConvexCollectionUtils
  const { original, revisions } = deferredBaselineRows(history)
  const cuts: PersistedAcceptanceResult[`cuts`] = []
  const publications: PersistedAcceptanceResult[`publications`] = []
  let release = () => {}
  let unsubscribe = () => {}
  const request = {
    orderBy: [
      {
        expression: new IR.PropRef([`rank`]),
        compareOptions: { direction: `asc` as const, nulls: `first` as const },
      },
    ],
  }
  return retainOracleCleanupObservation(async () => {
    collection.startSyncImmediate()
    const load = collection._sync.loadSubset(request)
    await source.answer(providerRows(original))
    await load
    await utils.awaitSync()
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const optimistic = createTransaction({ mutationFn: () => hold })
    optimistic.mutate(() =>
      collection.insert({
        id: `optimistic-hold`,
        group: `a`,
        rank: 10000,
        value: `hold`,
      }),
    )
    const observer = collection.subscribeChanges(
      () => {
        publications.push(copyRows(collection.base.values()))
      },
      { includeInitialState: false },
    )
    unsubscribe = () => observer.unsubscribe()
    for (const rows of revisions) {
      const before = receipts.length
      await source.answer(providerRows(rows))
      // Provider-consumption barriers do not await DB application. Requiring a
      // new actual receipt prevents cached/no-callback paths from gaining reach.
      if (receipts.length !== before + 1)
        throw new Error(
          `Unreached acceptance premise: ${receipts.length - before} source receipts for one complete revision`,
        )
      const receipt = receipts.at(-1)!
      if (receipt === true)
        throw new Error(
          `Unreached acceptance premise: applied receipt was immediate`,
        )
      let receiptPending = true
      void receipt.then(
        () => {
          receiptPending = false
        },
        () => {
          receiptPending = false
        },
      )
      await whenSyncAccepted(receipt)
      await utils.awaitSync()
      const durable = (
        await readDemandDurableRows(storage.persistence, id)
      ).map((row) => {
        if (
          typeof row.id !== `string` ||
          typeof row.rank !== `number` ||
          typeof row.value !== `string`
        )
          throw new Error(`Invalid durable acceptance row`)
        return { id: row.id, rank: row.rank, text: row.value }
      })
      cuts.push({
        accepted: copyRows(
          [...collection._state.acceptedSyncedEntries()].map(([, row]) => row),
        ),
        publicRows: copyRows(collection.base.values()),
        durable,
        receiptPending,
      })
    }
    release()
    await optimistic.when(`settled`)
    await Promise.all(receipts)
    await source.barrier()
    return {
      cuts,
      publications,
      finalRows: copyRows(collection.base.values()),
      reached:
        cuts.length === revisions.length &&
        cuts.every((cut) => cut.receiptPending)
          ? [
              `real SDK revisions consumed`,
              `accepted predecessor before next callback`,
              `actual SQLite acceptance before application`,
            ]
          : [],
      syncError:
        utils.getSyncError() === undefined
          ? undefined
          : String(utils.getSyncError()),
      cleanupErrors: [],
    }
  }, [
    () => release(),
    () => collection._sync.unloadSubset(request),
    () => unsubscribe(),
    () => collection.cleanup(),
    () => source.dispose(),
    () => storage.close(),
  ])
}
