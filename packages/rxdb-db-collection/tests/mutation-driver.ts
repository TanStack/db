/**
 * Real RxDB CRUD handlers receive the optimistic owner's source-batch law.
 * The storage method's real result/event is separate from its return to the
 * adapter handler. Faults occur before that write or after its real event.
 * This module records production facts; the shared owner predicts every cut.
 */
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import { createRxDatabase } from 'rxdb/plugins/core'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { Observable } from 'rxjs'
import { retainOracleCleanupObservation } from '../../db/tests/oracle-cleanup'
import { rxdbCollectionOptions } from '../src/rxdb'
import type { RxChangeEvent, RxCollection } from 'rxdb/plugins/core'
import type {
  HistoryRow,
  OptimisticCleanup,
  OptimisticObservation,
} from '../../db/tests/optimistic-history-oracle'

export type RxdbMutationHistory = {
  operation: `insert` | `update` | `delete`
  outcome: `fulfilled` | `reject-before-write` | `reject-after-write`
  peer: boolean
  coordinate: number
  sourceOrder: `before-settlement` | `after-settlement`
}
type Document = Omit<HistoryRow, `id`> & { id: string }
export type RxdbMutationResult = {
  trace: Array<{
    checkpoint: string
    value: OptimisticObservation | OptimisticCleanup
  }>
  entered: boolean
  sourceAccepted: boolean
  sourceBeforeSettlement: boolean
  settled: boolean
  sdkWrites: number
  cleanupErrors?: ReadonlyArray<string>
  browserErrors?: ReadonlyArray<string>
}
function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { resolve, promise }
}
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
async function until(predicate: () => boolean) {
  for (let count = 0; count < 100 && !predicate(); count++) await turn()
  return predicate()
}
const plain = (row: Document): HistoryRow => ({
  id: Number(row.id),
  a: row.a,
  b: row.b,
  c: row.c,
})
type Observed = OptimisticObservation['rows'][number]
const observed = (row: Document): Observed => ({
  ...plain(row),
  $origin: Reflect.get(row, `$origin`) as Observed['$origin'],
  $hasPendingWrites: Reflect.get(row, `$hasPendingWrites`) as boolean,
})
const sorted = <T extends { id: number }>(rows: Iterable<T>) =>
  [...rows].sort((a, b) => a.id - b.id)

let sequence = 0
export async function observeRxdbMutation(
  h: RxdbMutationHistory,
  id: string,
  cleanupFault = false,
  changeObservation?: (raw: RxdbMutationResult) => RxdbMutationResult,
): Promise<RxdbMutationResult> {
  const database = await createRxDatabase<{ rows: RxCollection<Document> }>({
    name: `rxdbmutation${sequence++}`,
    storage: getRxStorageMemory(),
    multiInstance: false,
  })
  const { rows } = await database.addCollections({
    rows: {
      schema: {
        version: 0,
        type: `object`,
        primaryKey: `id`,
        properties: {
          id: { type: `string`, maxLength: 30 },
          a: { type: `number` },
          b: { type: `number` },
          c: { type: `number` },
        },
        required: [`id`, `a`, `b`, `c`],
      },
    },
  })
  const before: Document = { id: `1`, a: h.coordinate, b: 11, c: 21 }
  const authored: Document = { id: `1`, a: h.coordinate + 1, b: 12, c: 22 }
  const peer: Document = { id: `2`, a: h.coordinate + 2, b: 13, c: 23 }
  const inserted = await rows.bulkInsert([
    ...(h.operation === `insert` ? [] : [before]),
    ...(h.peer ? [peer] : []),
  ])
  if (inserted.error.length)
    throw new Error(`RxDB mutation fixture insert failed`)
  const write = gate()
  const returning = gate()
  let entered = false
  let sdkWrites = 0
  let written = false
  const failure = new Error(`RxDB mutation ${h.outcome}:${h.coordinate}`)
  async function storageCall<T>(call: () => Promise<T>) {
    entered = true
    await write.promise
    if (h.outcome === `reject-before-write`) throw failure
    sdkWrites++
    const result = await call()
    written = true
    await returning.promise
    if (h.outcome === `reject-after-write`) throw failure
    return result
  }
  const upsert = rows.bulkUpsert.bind(rows)
  const remove = rows.bulkRemove.bind(rows)
  rows.bulkUpsert = (documents) => storageCall(() => upsert(documents))
  rows.bulkRemove = (documents) => storageCall(() => remove(documents))
  const findOne = rows.findOne.bind(rows)
  const receipts: Array<{ status: `pending` | `fulfilled` | `rejected` }> = []
  let active = false
  const delayedEvents: Array<() => void> = []
  const receivingCollection = {
    schema: rows.schema,
    storageInstance: rows.storageInstance,
    bulkUpsert: rows.bulkUpsert.bind(rows),
    bulkRemove: rows.bulkRemove.bind(rows),
    findOne: (key: string) => ({
      exec: async () => {
        const doc = await findOne(key).exec()
        return doc
          ? {
              incrementalPatch: (data: Partial<Document>) =>
                storageCall(() => doc.incrementalPatch(data)),
            }
          : doc
      },
    }),
    $: new Observable<RxChangeEvent<Document>>((subscriber) => {
      const subscription = rows.$.subscribe({
        next: (event) => {
          // The SDK supplies this real event. This cut delays delivery to the
          // adapter independently of the storage method's completion.
          if (active && h.sourceOrder === `after-settlement`)
            delayedEvents.push(() => subscriber.next(event))
          else subscriber.next(event)
        },
        error: (error: unknown) => subscriber.error(error),
      })
      return () => subscription.unsubscribe()
    }),
  } as unknown as RxCollection<Document>
  const options = rxdbCollectionOptions({
    id,
    rxCollection: receivingCollection,
    syncMode: `eager`,
    syncBatchSize: 1,
  })
  const source = options.sync.sync
  options.sync.sync = (params) =>
    source({
      ...params,
      commit: (signal) => {
        const receipt = params.commit(signal)
        if (active) {
          const state = {
            status:
              receipt === true ? (`fulfilled` as const) : (`pending` as const),
          } as { status: `pending` | `fulfilled` | `rejected` }
          receipts.push(state)
          if (receipt !== true)
            void receipt.then(
              () => {
                state.status = `fulfilled`
              },
              () => {
                state.status = `rejected`
              },
            )
        }
        return receipt
      },
    })
  const collection = createCollection(options)
  const query = createLiveQueryCollection((q) => q.from({ row: collection }))
  const trace: RxdbMutationResult['trace'] = []
  let transaction: ReturnType<typeof collection.insert> | undefined
  let outcome: {
    status: `pending` | `fulfilled` | `rejected`
    ownTransaction?: boolean
    handlerError?: boolean
  } = { status: `pending` }
  let settledRows: Array<Observed> | undefined
  const replica = new Map<number, Observed>()
  const rawReplica = new Map<number, Observed>()
  let deliveries = 0
  let publications: OptimisticObservation['publications'] = []
  let raw: OptimisticObservation['raw'] = []
  let unsubscribe = () => {}
  let unsubscribeRaw = () => {}
  const snapshot = () => sorted([...collection.values()].map(observed))
  const record = (
    checkpoint: string,
    extra: Partial<OptimisticObservation> = {},
  ) => {
    const mutation = transaction?.mutations[0]
    const changes = mutation ? { ...mutation.changes } : {}
    if (`id` in changes) Reflect.set(changes, `id`, Number(changes.id))
    trace.push({
      checkpoint,
      value: {
        publications,
        raw,
        requests:
          transaction && mutation
            ? [
                {
                  outcome: { ...outcome },
                  state: transaction.state,
                  modified: plain(mutation.modified as Document),
                  changes,
                },
              ]
            : [],
        receipts: receipts.map((receipt, index) => [index, receipt.status]),
        rows: snapshot(),
        replica: sorted(replica.values()),
        rawReplica: sorted(rawReplica.values()),
        downstream: sorted(
          [...query.values()].map((row) => plain(row as Document)),
        ),
        tracked: [...collection._state.transactions.values()].map((entry) =>
          entry === transaction ? 0 : -1,
        ),
        deliveries,
        ...extra,
      },
    })
    publications = []
    raw = []
  }
  return retainOracleCleanupObservation<RxdbMutationResult>(async () => {
    await query.preload()
    active = true
    const capture = (
      batch: Parameters<Parameters<typeof collection.subscribeChanges>[0]>[0],
    ) =>
      batch.map((change) => ({
        key: Number(change.key),
        type: change.type,
        value: observed(change.value),
        ...(`previousValue` in change
          ? {
              previousValue: change.previousValue
                ? observed(change.previousValue)
                : undefined,
            }
          : {}),
      }))
    const sub = collection.subscribeChanges(
      (batch) => {
        deliveries += batch.length
        const beforeReplica = [...replica]
        const captured = capture(batch)
        for (const change of captured) {
          if (change.type === `delete`) replica.delete(change.key)
          else replica.set(change.key, change.value)
        }
        publications.push({
          before: beforeReplica,
          batch: captured,
          replica: sorted(replica.values()),
          source: snapshot(),
        })
      },
      { includeInitialState: true },
    )
    unsubscribe = () => sub.unsubscribe()
    for (const row of snapshot()) rawReplica.set(row.id, row)
    const rawSub = collection.subscribeChanges(
      (batch) => {
        const beforeReplica = [...rawReplica]
        const captured = capture(batch)
        for (const change of captured) {
          if (change.type === `delete`) rawReplica.delete(change.key)
          else rawReplica.set(change.key, change.value)
        }
        raw.push({ before: beforeReplica, batch: captured })
      },
      { includeInitialState: false },
    )
    unsubscribeRaw = () => rawSub.unsubscribe()
    record(`initial`)
    transaction =
      h.operation === `insert`
        ? collection.insert(authored)
        : h.operation === `delete`
          ? collection.delete(`1`)
          : collection.update(`1`, (draft) => {
              draft.a = authored.a
              draft.b = authored.b
              draft.c = authored.c
            })
    const current = collection.get(`1`)
    const live = current ? plain(current) : null
    const captured = plain(transaction.mutations[0]!.modified as Document)
    void transaction.when(`settled`).then(
      (value) => {
        outcome = { status: `fulfilled`, ownTransaction: value === transaction }
        settledRows = snapshot()
      },
      (error: unknown) => {
        outcome = { status: `rejected`, handlerError: error === failure }
        settledRows = snapshot()
      },
    )
    await until(() => entered)
    record(`step 0 (edit)`, { live, captured })
    write.resolve()
    const wrote = h.outcome !== `reject-before-write`
    const early = h.sourceOrder === `before-settlement`
    if (wrote) {
      await until(
        () =>
          written && (early ? receipts.length > 0 : delayedEvents.length > 0),
      )
    }
    if (wrote && early) {
      record(`step 1 (sync)`)
    }
    returning.resolve()
    await until(() => outcome.status !== `pending`)
    await turn()
    const sourceBeforeSettlement = receipts.length > 0
    record(`step ${wrote && early ? 2 : 1} (settle)`, {
      settledRows,
    })
    if (wrote && !early) {
      for (const deliver of delayedEvents.splice(0)) deliver()
      await until(() => receipts.length > 0)
      await turn()
      record(`step 2 (sync)`)
    }
    const result: RxdbMutationResult = {
      trace,
      entered,
      sourceAccepted: receipts.length > 0,
      sourceBeforeSettlement,
      settled: outcome.status !== `pending`,
      sdkWrites,
    }
    return changeObservation ? changeObservation(result) : result
  }, [
    () => write.resolve(),
    () => returning.resolve(),
    () => unsubscribe(),
    () => unsubscribeRaw(),
    () => query.cleanup(),
    async () => {
      await collection.cleanup()
      if (cleanupFault)
        throw new Error(`Injected RxDB mutation cleanup failure`)
    },
    // The shared optimistic owner observes outcomes and receipt settlement
    // after cleanup attempts. Record that cut even if teardown also failed;
    // the envelope preserves the product trace and separate diagnostics.
    () => {
      trace.push({
        checkpoint: `cleanup`,
        value: {
          outcomes: [{ ...outcome }],
          receipts: receipts.map((receipt, index) => [index, receipt.status]),
        },
      })
    },
    () => database.remove(),
  ])
}
