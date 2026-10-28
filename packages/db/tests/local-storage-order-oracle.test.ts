/**
 * LocalStorage automatic writes preserve mutation order within one Collection.
 * The public LocalStorage guide promises direct mutations that persist, while
 * Collection settlement promises that a fulfilled `isPersisted` reflects the
 * accepted mutation. A later authored update must not be replaced by an older
 * handler that happens to finish later. This law says nothing about concurrent
 * writers in different Collections or browser tabs.
 *
 * The independent model folds accepted whole-row updates in author order. It
 * does not model handlers, optimistic overlays, storage caches, or sync queues.
 * The legal histories below start with two stored rows and submit two updates
 * without waiting. They vary same/disjoint keys, handler completion order,
 * and both application decisions for each update.
 * At the final settlement checkpoint, public rows, durable rows, and a fresh
 * Collection must equal that fold. The held-handler checkpoint verifies that
 * no later mutation reports persistence ahead of its undecided predecessor.
 * A handler may admit a nested automatic mutation without awaiting it. Awaiting
 * that mutation's persistence or a later manual acceptance from the earlier
 * handler would form a cycle under the order law; the guide excludes both.
 * With no earlier write or handler, a direct mutation reaches synchronous
 * Storage before its method returns, including after a held queue drains. A failed later handler releases its own
 * optimistic state promptly, even while an earlier accepted handler is held.
 * An automatic write enters this order when its mutation is submitted; a
 * manual write enters when `acceptMutations` is called. The mixed grammar
 * varies same/disjoint keys and the earlier handler's decision. Its manual
 * receipt and durable effect wait behind that handler; otherwise the older
 * automatic value could replace a later accepted value.
 * Manual acceptance always returns a Promise, including when a synchronous
 * Storage write fails. The caller can attach a rejection handler to that
 * Promise before either an immediate or queued write reports failure. A manual
 * transaction's persistence receipt also waits for every acceptance called
 * in mutationFn, even if mutationFn does not await those Promises. This law
 * covers direct and queued success and Storage failure; it does not make
 * several distinct storage keys one atomic transaction.
 */
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index'
import { DbClient, collectionOptions } from '../src/client'
import { createDeferred } from '../src/deferred'
import { localStorageCollectionOptions } from '../src/local-storage'
import { createTransaction } from '../src/transactions'
import { declareOracle } from './oracle-declaration'
import {
  observeHistoryPromise,
  withHistoryCleanup,
} from './optimistic-history-oracle'
import {
  initial,
  makeSeededStorage,
  sortedRows,
  storedRows,
} from './local-storage-fixtures'
import type { Row } from './local-storage-fixtures'

type Edit = { id: string; value: number }

// Whole-row replacement is the documented Collection update effect in this
// scalar domain. A rejected application decision contributes no effect.
function expectedRows(
  edits: ReadonlyArray<Edit>,
  accepted: ReadonlyArray<boolean>,
) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]))
  edits.forEach((edit, index) => {
    if (accepted[index]) rows.set(edit.id, { ...edit })
  })
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id))
}

declareOracle({ model: [expectedRows] })

// The outer handler admits a nested write while it is held. The independent
// authored fold expects the outer row before the inner row. The storage trace
// checks that order, while the held checkpoint rules out early inner persistence.
it('persists a nested fire-and-forget mutation after its handler returns', async () => {
  const storage = makeSeededStorage()
  const snapshots: Array<Array<Row>> = []
  const setItem = storage.setItem
  storage.setItem = (key, value) => {
    setItem(key, value)
    snapshots.push(storedRows(value))
  }
  const entered = createDeferred<void>()
  const release = createDeferred<void>()
  let nestedReceipt: Promise<unknown> | undefined
  const collection = createCollection(
    localStorageCollectionOptions<Row>({
      storageKey: 'rows',
      storage,
      storageEventApi: { addEventListener() {}, removeEventListener() {} },
      getKey: (row) => row.id,
      onInsert: async ({ transaction }) => {
        if (transaction.mutations[0].modified.id === 'outer') {
          nestedReceipt = collection.insert({ id: 'inner', value: 2 })
            .isPersisted.promise
          entered.resolve()
          await release.promise
        }
      },
    }),
  )
  await withHistoryCleanup(
    async () => {
      await collection.preload()
      const outer = collection.insert({ id: 'outer', value: 1 })
      await entered.promise
      expect(nestedReceipt, 'nested mutation was admitted').toBeDefined()
      expect(snapshots, 'no write before the outer handler returns').toEqual([])
      release.resolve()
      await Promise.all([outer.isPersisted.promise, nestedReceipt])
      expect(snapshots).toEqual([
        expectedRows([{ id: 'outer', value: 1 }], [true]),
        expectedRows(
          [
            { id: 'outer', value: 1 },
            { id: 'inner', value: 2 },
          ],
          [true, true],
        ),
      ])
      expect(sortedRows(collection.values())).toEqual(snapshots[1])
    },
    () => [() => release.resolve(), () => collection.cleanup()],
  )
})

/** A DbClient descriptor materializes a fresh Collection from module-level
 * LocalStorage options. The authored order is automatic update 1, then manual
 * update 2. Calling the module-level acceptance utility must enter the actual
 * Collection's storage order: while the first handler is held, durable state
 * stays at 0; after both receipts it is 2. The materialized Collection and a
 * fresh restore are the public observations. */
it('orders module-level manual acceptance with a DbClient Collection', async () => {
  const storage = makeSeededStorage()
  const entered = createDeferred<void>()
  const release = createDeferred<void>()
  const settings = localStorageCollectionOptions<Row>({
    id: 'client-rows',
    storageKey: 'rows',
    storage,
    storageEventApi: { addEventListener() {}, removeEventListener() {} },
    getKey: (row) => row.id,
    onUpdate: async () => {
      entered.resolve()
      await release.promise
    },
  })
  const client = new DbClient()
  const collection = client.collection(collectionOptions(settings))
  let cleanupReopened: (() => Promise<void>) | undefined
  const manualEntered = createDeferred<void>()
  await withHistoryCleanup(
    async () => {
      await collection.preload()
      const automatic = collection.update('a', (draft) => {
        draft.value = 1
      })
      await entered.promise
      const manual = createTransaction({
        autoCommit: false,
        mutationFn: ({ transaction: pending }) => {
          void settings.utils.acceptMutations(pending)
          manualEntered.resolve()
          return Promise.resolve()
        },
      })
      manual.mutate(() => {
        collection.update('a', (draft) => {
          draft.value = 2
        })
      })
      const receipt = observeHistoryPromise(manual.isPersisted.promise)
      const commit = observeHistoryPromise(manual.commit())
      await manualEntered.promise
      // The receipt check must occur after mutationFn registers its write.
      // Otherwise an unrelated pending commit can make this check false green.
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(storedRows(storage.getItem('rows')), 'held durable order').toEqual(
        initial,
      )
      expect(receipt.read().status, 'held manual receipt').toBe('pending')
      release.resolve()
      await Promise.all([
        automatic.isPersisted.promise,
        receipt.settled,
        commit.settled,
      ])
      const expected = expectedRows(
        [
          { id: 'a', value: 1 },
          { id: 'a', value: 2 },
        ],
        [true, true],
      )
      expect(
        storedRows(storage.getItem('rows')),
        'settled durable order',
      ).toEqual(expected)
      expect(
        sortedRows(collection.values()),
        'materialized public rows',
      ).toEqual(expected)
      const reopened = createCollection(
        localStorageCollectionOptions<Row>({
          id: 'reopened-client-rows',
          storageKey: 'rows',
          storage,
          storageEventApi: { addEventListener() {}, removeEventListener() {} },
          getKey: (row) => row.id,
        }),
      )
      cleanupReopened = () => reopened.cleanup()
      await reopened.preload()
      expect(sortedRows(reopened.values()), 'fresh restore').toEqual(expected)
    },
    () => [
      () => release.resolve(),
      () => cleanupReopened?.(),
      () => client.cleanup(),
    ],
  )
})

// A synchronous handler rejection has already decided that its mutation will
// not write. The independent authored fold therefore excludes that update and
// includes the next handler-free insert at the insert method's return cut.
// Waiting for the rejected receipt is a neighboring control: both cuts must
// have the same durable rows, without an empty failed slot delaying the first.
it('persists a direct write at return after a synchronous handler failure', async () => {
  const storage = makeSeededStorage()
  const failure = new Error('update rejected before writing')
  const collection = createCollection(
    localStorageCollectionOptions<Row>({
      storageKey: 'rows',
      storage,
      storageEventApi: { addEventListener() {}, removeEventListener() {} },
      getKey: (row) => row.id,
      onUpdate: () => {
        throw failure
      },
    }),
  )
  await withHistoryCleanup(
    async () => {
      await collection.preload()
      const rejected = collection.update('a', (draft) => {
        draft.value = 1
      })
      void rejected.isPersisted.promise.catch(() => undefined)
      const next = collection.insert({ id: 'next', value: 2 })
      const expected = expectedRows([{ id: 'next', value: 2 }], [true])
      expect(
        storedRows(storage.getItem('rows')),
        'direct return after decided failure',
      ).toEqual(expected)
      await expect(rejected.isPersisted.promise).rejects.toBe(failure)
      await next.isPersisted.promise
      expect(storedRows(storage.getItem('rows')), 'settled durable').toEqual(
        expected,
      )
      const after = collection.insert({ id: 'after', value: 3 })
      expect(
        storedRows(storage.getItem('rows')),
        'direct return after rejected receipt',
      ).toEqual(
        expectedRows(
          [
            { id: 'next', value: 2 },
            { id: 'after', value: 3 },
          ],
          [true, true],
        ),
      )
      await after.isPersisted.promise
    },
    () => [() => collection.cleanup()],
  )
})

// This finite grammar covers same-key and disjoint-key updates and both handler
// completion orders and all decision pairs. It excludes peer writes and
// manual transactions; those require different event and ownership boundaries.
for (const secondId of ['a', 'b']) {
  for (const completion of ['first', 'second']) {
    for (const accepted of [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ]) {
      describe(`two ${secondId === 'a' ? 'same-key' : 'disjoint-key'} writes, ${completion} handler first, decisions ${accepted.join('/')}`, () => {
        it('persists and publishes the authored result', async () => {
          const storage = makeSeededStorage()
          const gate = [createDeferred<void>(), createDeferred<void>()]
          const entered = [createDeferred<void>(), createDeferred<void>()]
          const edits: Array<Edit> = [
            { id: 'a', value: 1 },
            { id: secondId, value: 2 },
          ]
          const makeCollection = (withHandler: boolean) =>
            createCollection(
              localStorageCollectionOptions<Row>({
                storageKey: 'rows',
                storage,
                storageEventApi: {
                  addEventListener() {},
                  removeEventListener() {},
                },
                getKey: (row) => row.id,
                ...(withHandler
                  ? {
                      onUpdate: async ({
                        transaction,
                      }: {
                        transaction: { mutations: Array<{ modified: Row }> }
                      }) => {
                        const index =
                          transaction.mutations[0]!.modified.value - 1
                        entered[index]!.resolve()
                        await gate[index]!.promise
                      },
                    }
                  : {}),
              }),
            )
          const collection = makeCollection(true)
          let reopened: ReturnType<typeof makeCollection> | undefined
          await withHistoryCleanup(
            async () => {
              await collection.preload()
              const transactions = edits.map((edit) =>
                collection.update(edit.id, (draft) => {
                  draft.value = edit.value
                }),
              )
              const settled = [false, false]
              const outcomes = transactions.map((tx, index) =>
                tx.isPersisted.promise.then(
                  () => {
                    settled[index] = true
                    return true
                  },
                  () => {
                    settled[index] = true
                    return false
                  },
                ),
              )
              await Promise.all(entered.map((item) => item.promise))
              const first = completion === 'first' ? 0 : 1
              if (accepted[first]) gate[first]!.resolve()
              else gate[first]!.reject(new Error(`handler ${first} rejected`))
              await Promise.resolve()
              await Promise.resolve()
              if (first === 1) {
                expect(
                  settled[1],
                  'later persistence waits for the earlier decision',
                ).toBe(false)
                expect(storedRows(storage.getItem('rows'))).toEqual(initial)
              }
              if (accepted[1 - first]) gate[1 - first]!.resolve()
              else
                gate[1 - first]!.reject(
                  new Error(`handler ${1 - first} rejected`),
                )
              expect(await Promise.all(outcomes)).toEqual(accepted)
              const expected = expectedRows(edits, accepted)
              expect(storedRows(storage.getItem('rows'))).toEqual(expected)
              expect(sortedRows(collection.values())).toEqual(expected)
              reopened = makeCollection(false)
              await reopened.preload()
              expect(sortedRows(reopened.values())).toEqual(expected)
            },
            () => [
              () => gate.forEach((item) => item.resolve()),
              () => reopened?.cleanup(),
              () => collection.cleanup(),
            ],
          )
        })
      })
    }
  }
}

// An update followed by a delete distinguishes ordering from a simple
// last-value replacement. The same authored fold removes the row if the
// delete is accepted, even when its handler completes before the update.
for (const accepted of [
  [true, true],
  [true, false],
  [false, true],
  [false, false],
]) {
  it(`keeps an update followed by delete in author order with decisions ${accepted.join('/')}`, async () => {
    const storage = makeSeededStorage()
    const gate = [createDeferred<void>(), createDeferred<void>()]
    const entered = [createDeferred<void>(), createDeferred<void>()]
    const collection = createCollection(
      localStorageCollectionOptions<Row>({
        storageKey: 'rows',
        storage,
        storageEventApi: { addEventListener() {}, removeEventListener() {} },
        getKey: (row) => row.id,
        onUpdate: async () => {
          entered[0]!.resolve()
          await gate[0]!.promise
        },
        onDelete: async () => {
          entered[1]!.resolve()
          await gate[1]!.promise
        },
      }),
    )
    await withHistoryCleanup(
      async () => {
        await collection.preload()
        const update = collection.update('a', (draft) => {
          draft.value = 1
        })
        const deletion = collection.delete('a')
        const outcomes = [update, deletion].map((tx) =>
          tx.isPersisted.promise.then(
            () => true,
            () => false,
          ),
        )
        await Promise.all(entered.map((item) => item.promise))
        if (accepted[1]) gate[1]!.resolve()
        else gate[1]!.reject(new Error('delete rejected'))
        await Promise.resolve()
        await Promise.resolve()
        expect(storedRows(storage.getItem('rows'))).toEqual(initial)
        if (accepted[0]) gate[0]!.resolve()
        else gate[0]!.reject(new Error('update rejected'))
        expect(await Promise.all(outcomes)).toEqual(accepted)
        const expected = accepted[1]
          ? [{ id: 'b', value: 0 }]
          : expectedRows([{ id: 'a', value: 1 }], [accepted[0]!])
        expect(storedRows(storage.getItem('rows'))).toEqual(expected)
        expect(sortedRows(collection.values())).toEqual(expected)
      },
      () => [
        () => gate.forEach((item) => item.resolve()),
        () => collection.cleanup(),
      ],
    )
  })
}
