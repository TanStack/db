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
import {
  observeHistoryPromise,
  withHistoryCleanup,
} from './optimistic-history-oracle'

type Row = { id: string; value: number }
const initial: Array<Row> = [
  { id: 'a', value: 0 },
  { id: 'b', value: 0 },
]

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

function sortedRows(values: Iterable<Row>) {
  return [...values]
    .map(({ id, value }) => ({ id, value }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

function storedRows(raw: string | null): Array<Row> {
  expect(raw).not.toBeNull()
  const records = JSON.parse(raw!) as Record<string, { data: Row }>
  return sortedRows(Object.values(records).map(({ data }) => data))
}

function makeStorage() {
  const values = new Map<string, string>()
  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    removeItem(key: string) {
      values.delete(key)
    },
  }
}

function makeSeededStorage() {
  const storage = makeStorage()
  storage.setItem(
    'rows',
    JSON.stringify(
      Object.fromEntries(
        initial.map((row) => [
          `s:${row.id}`,
          { versionKey: `initial-${row.id}`, data: row },
        ]),
      ),
    ),
  )
  return storage
}

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
  await withHistoryCleanup(
    async () => {
      await collection.preload()
      const automatic = collection.update('a', (draft) => {
        draft.value = 1
      })
      await entered.promise
      const manual = createTransaction({
        autoCommit: false,
        mutationFn: async () => {},
      })
      manual.mutate(() => {
        collection.update('a', (draft) => {
          draft.value = 2
        })
      })
      const acceptance = settings.utils.acceptMutations(manual)
      const receipt = observeHistoryPromise(manual.isPersisted.promise)
      const commit = observeHistoryPromise(manual.commit())
      expect(storedRows(storage.getItem('rows')), 'held durable order').toEqual(
        initial,
      )
      expect(receipt.read().status, 'held manual receipt').toBe('pending')
      release.resolve()
      await Promise.all([
        automatic.isPersisted.promise,
        acceptance,
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

/** The same descriptor utility can be called for a materialized Collection
 * before an explicit preload. The mutation itself establishes its Collection
 * owner. Manual acceptance must use that owner's Storage path, and a later
 * persisted restore must see exactly the authored row. */
it('routes module-level manual acceptance before explicit preload', async () => {
  const storage = makeStorage()
  const settings = localStorageCollectionOptions<Row>({
    id: 'client-rows',
    storageKey: 'rows',
    storage,
    storageEventApi: { addEventListener() {}, removeEventListener() {} },
    getKey: (row) => row.id,
  })
  const client = new DbClient()
  const collection = client.collection(collectionOptions(settings))
  let transaction:
    ReturnType<typeof createTransaction<Record<string, unknown>>> | undefined
  await withHistoryCleanup(
    async () => {
      transaction = createTransaction<Record<string, unknown>>({
        autoCommit: false,
        mutationFn: async () => {},
      })
      transaction.mutate(() => {
        collection.insert({ id: 'early', value: 1 })
      })
      await settings.utils.acceptMutations(transaction)
      await transaction.commit()
      expect(
        storedRows(storage.getItem('rows')),
        'manual durable receipt',
      ).toEqual([{ id: 'early', value: 1 }])
      await collection.preload()
      expect(sortedRows(collection.values()), 'later public restore').toEqual([
        { id: 'early', value: 1 },
      ])
    },
    () => [
      () => {
        if (transaction) {
          void transaction.isPersisted.promise.catch(() => undefined)
          if (transaction.state === 'pending') transaction.rollback()
        }
      },
      () => client.cleanup(),
    ],
  )
})

// Storage is synchronous. The model applies each handler-free mutation before
// the corresponding direct Collection call returns. These return checkpoints
// catch a regression that final persistence receipts cannot detect.
it('persists handler-free direct mutations before their calls return', async () => {
  const storage = makeStorage()
  const collection = createCollection(
    localStorageCollectionOptions<Row>({
      storageKey: 'rows',
      storage,
      storageEventApi: { addEventListener() {}, removeEventListener() {} },
      getKey: (row) => row.id,
    }),
  )
  await withHistoryCleanup(
    async () => {
      await collection.preload()
      const insert = collection.insert({ id: 'a', value: 1 })
      expect(storedRows(storage.getItem('rows'))).toEqual([
        { id: 'a', value: 1 },
      ])
      await insert.isPersisted.promise
      const update = collection.update('a', (draft) => {
        draft.value = 2
      })
      expect(storedRows(storage.getItem('rows'))).toEqual([
        { id: 'a', value: 2 },
      ])
      await update.isPersisted.promise
      const deletion = collection.delete('a')
      expect(storedRows(storage.getItem('rows'))).toEqual([])
      await deletion.isPersisted.promise
    },
    () => [() => collection.cleanup()],
  )
})

// The synchronous rule is conditional on the absence of a predecessor. A
// handler-free update submitted while an insert handler is held must wait for
// that insert's storage slot, then both accepted effects reach durable state.
it('holds a handler-free write behind an earlier pending handler', async () => {
  const storage = makeSeededStorage()
  const entered = createDeferred<void>()
  const release = createDeferred<void>()
  const collection = createCollection(
    localStorageCollectionOptions<Row>({
      storageKey: 'rows',
      storage,
      storageEventApi: { addEventListener() {}, removeEventListener() {} },
      getKey: (row) => row.id,
      onInsert: async () => {
        entered.resolve()
        await release.promise
      },
    }),
  )
  await withHistoryCleanup(
    async () => {
      await collection.preload()
      const first = collection.insert({ id: 'new', value: 3 })
      await entered.promise
      const second = collection.update('a', (draft) => {
        draft.value = 2
      })
      expect(storedRows(storage.getItem('rows'))).toEqual(initial)
      release.resolve()
      await Promise.all([first.isPersisted.promise, second.isPersisted.promise])
      expect(storedRows(storage.getItem('rows'))).toEqual([
        { id: 'a', value: 2 },
        { id: 'b', value: 0 },
        { id: 'new', value: 3 },
      ])
      const afterDrain = collection.update('b', (draft) => {
        draft.value = 4
      })
      expect(storedRows(storage.getItem('rows'))).toEqual([
        { id: 'a', value: 2 },
        { id: 'b', value: 4 },
        { id: 'new', value: 3 },
      ])
      await afterDrain.isPersisted.promise
    },
    () => [() => release.resolve(), () => collection.cleanup()],
  )
})

// The model folds an automatic insert decision, then a manual same-key update
// or disjoint insert. Rejection removes only the automatic effect. The manual
// receipt remains pending while the earlier handler is held; after both
// decisions, storage, public rows, and fresh restore match the authored fold.
for (const sameKey of [true, false]) {
  for (const firstAccepted of [true, false]) {
    it(`orders manual ${sameKey ? 'same-key update' : 'disjoint insert'} after an ${firstAccepted ? 'accepted' : 'rejected'} automatic insert`, async () => {
      const storage = makeStorage()
      const entered = createDeferred<void>()
      const release = createDeferred<void>()
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
                  onInsert: async () => {
                    entered.resolve()
                    await release.promise
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
          const first = collection.insert({ id: 'k', value: 1 })
          const firstOutcome = first.isPersisted.promise.then(
            () => true,
            () => false,
          )
          await entered.promise
          const manual = createTransaction({
            autoCommit: false,
            mutationFn: async ({ transaction }) => {
              await collection.utils.acceptMutations(transaction)
            },
          })
          manual.mutate(() => {
            if (sameKey) {
              collection.update('k', (draft) => {
                draft.value = 2
              })
            } else {
              collection.insert({ id: 'other', value: 2 })
            }
          })
          let manualSettled = false
          const manualReceipt = manual.commit().then(() => {
            manualSettled = true
          })
          await new Promise((resolve) => setTimeout(resolve, 0))
          expect(
            manualSettled,
            'manual acceptance waits for its predecessor',
          ).toBe(false)
          expect(storage.getItem('rows')).toBeNull()
          if (firstAccepted) release.resolve()
          else release.reject(new Error('automatic insert rejected'))
          const [actualFirst] = await Promise.all([firstOutcome, manualReceipt])
          expect(actualFirst).toBe(firstAccepted)
          const expected = sameKey
            ? [{ id: 'k', value: 2 }]
            : [
                ...(firstAccepted ? [{ id: 'k', value: 1 }] : []),
                { id: 'other', value: 2 },
              ].sort((a, b) => a.id.localeCompare(b.id))
          expect(storedRows(storage.getItem('rows'))).toEqual(expected)
          expect(sortedRows(collection.values())).toEqual(expected)
          reopened = makeCollection(false)
          await reopened.preload()
          expect(sortedRows(reopened.values())).toEqual(expected)
        },
        () => [
          () => release.resolve(),
          () => reopened?.cleanup(),
          () => collection.cleanup(),
        ],
      )
    })
  }
}

// A manual transaction's persistence receipt represents its Storage write,
// even when mutationFn does not await the utility's Promise. The authored
// model includes the manual row only after its successful storage acceptance.
// This finite grammar varies an earlier held automatic write and a manual
// Storage fault. The driver enters through createTransaction and the public
// utility. At the held cut neither receipt may settle; at the final cut both
// receipts, durable rows, and the public snapshot must match the decision.
for (const queued of [false, true]) {
  for (const storageFails of [false, true]) {
    it(`settles un-awaited manual acceptance after its ${queued ? 'queued' : 'direct'} ${storageFails ? 'failed' : 'successful'} storage write`, async () => {
      const storage = makeStorage()
      const storageError = new Error('manual storage fault')
      const setItem = storage.setItem
      storage.setItem = (key, value) => {
        if (storageFails && value.includes('s:manual')) throw storageError
        setItem(key, value)
      }
      const entered = createDeferred<void>()
      const release = createDeferred<void>()
      const accepted = createDeferred<void>()
      const collection = createCollection(
        localStorageCollectionOptions<Row>({
          storageKey: 'rows',
          storage,
          storageEventApi: { addEventListener() {}, removeEventListener() {} },
          getKey: (row) => row.id,
          onInsert: async ({ transaction }) => {
            if (transaction.mutations[0].modified.id === 'first') {
              entered.resolve()
              await release.promise
            }
          },
        }),
      )
      let manual:
        | ReturnType<typeof createTransaction<Record<string, unknown>>>
        | undefined
      await withHistoryCleanup(
        async () => {
          await collection.preload()
          const first = queued
            ? collection.insert({ id: 'first', value: 1 })
            : undefined
          if (queued) await entered.promise
          manual = createTransaction<Record<string, unknown>>({
            autoCommit: false,
            mutationFn: async ({ transaction }) => {
              // The application deliberately omits await and return. A
              // rejection observer prevents the test runner from replacing
              // the receipt assertion with an unhandled-rejection failure.
              void collection.utils.acceptMutations(transaction).catch(() => {})
              accepted.resolve()
            },
          })
          manual.mutate(() => collection.insert({ id: 'manual', value: 2 }))
          const commit = observeHistoryPromise(manual.commit())
          const receipt = observeHistoryPromise(manual.isPersisted.promise)
          await accepted.promise
          if (queued) {
            await new Promise((resolve) => setTimeout(resolve, 0))
            expect(commit.read().status, 'held commit').toBe('pending')
            expect(receipt.read().status, 'held persistence receipt').toBe(
              'pending',
            )
            expect(storage.getItem('rows')).toBeNull()
            release.resolve()
            await first!.isPersisted.promise
          }
          await Promise.all([commit.settled, receipt.settled])
          if (storageFails) {
            expect(commit.read()).toMatchObject({
              status: 'rejected',
              reason: storageError,
            })
            expect(receipt.read()).toMatchObject({
              status: 'rejected',
              reason: storageError,
            })
          } else {
            expect(commit.read().status).toBe('fulfilled')
            expect(receipt.read().status).toBe('fulfilled')
          }
          const expected = [
            ...(queued ? [{ id: 'first', value: 1 }] : []),
            ...(!storageFails ? [{ id: 'manual', value: 2 }] : []),
          ]
          if (expected.length)
            expect(storedRows(storage.getItem('rows'))).toEqual(expected)
          else expect(storage.getItem('rows')).toBeNull()
          expect(sortedRows(collection.values())).toEqual(expected)
        },
        () => [() => release.resolve(), () => collection.cleanup()],
      )
    })
  }
}

// One manual transaction can accept rows from more than one Collection. Its
// receipt represents every accepted storage write, not merely the first work
// registered. The model allows the independent direct write now, but keeps
// transaction settlement behind the other Collection's held predecessor.
it('waits for every un-awaited manual acceptance in one transaction', async () => {
  const slowStorage = makeStorage()
  const fastStorage = makeStorage()
  const entered = createDeferred<void>()
  const release = createDeferred<void>()
  const slow = createCollection(
    localStorageCollectionOptions<Row>({
      id: 'slow',
      storageKey: 'slow-rows',
      storage: slowStorage,
      storageEventApi: { addEventListener() {}, removeEventListener() {} },
      getKey: (row) => row.id,
      onInsert: async ({ transaction }) => {
        if (transaction.mutations[0].modified.id === 'first') {
          entered.resolve()
          await release.promise
        }
      },
    }),
  )
  const fast = createCollection(
    localStorageCollectionOptions<Row>({
      id: 'fast',
      storageKey: 'fast-rows',
      storage: fastStorage,
      storageEventApi: { addEventListener() {}, removeEventListener() {} },
      getKey: (row) => row.id,
    }),
  )
  await withHistoryCleanup(
    async () => {
      await Promise.all([slow.preload(), fast.preload()])
      const first = slow.insert({ id: 'first', value: 1 })
      await entered.promise
      const manual = createTransaction({
        autoCommit: false,
        mutationFn: ({ transaction }) => {
          void slow.utils.acceptMutations(transaction).catch(() => {})
          void fast.utils.acceptMutations(transaction).catch(() => {})
          return Promise.resolve()
        },
      })
      manual.mutate(() => {
        slow.insert({ id: 'slow-manual', value: 2 })
        fast.insert({ id: 'fast-manual', value: 3 })
      })
      const receipt = observeHistoryPromise(manual.isPersisted.promise)
      const commit = observeHistoryPromise(manual.commit())
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(storedRows(fastStorage.getItem('fast-rows'))).toEqual([
        { id: 'fast-manual', value: 3 },
      ])
      expect(slowStorage.getItem('slow-rows')).toBeNull()
      expect(receipt.read().status).toBe('pending')
      expect(commit.read().status).toBe('pending')
      release.resolve()
      await Promise.all([
        first.isPersisted.promise,
        receipt.settled,
        commit.settled,
      ])
      expect(receipt.read().status).toBe('fulfilled')
      expect(commit.read().status).toBe('fulfilled')
      expect(storedRows(slowStorage.getItem('slow-rows'))).toEqual([
        { id: 'first', value: 1 },
        { id: 'slow-manual', value: 2 },
      ])
      expect(sortedRows(slow.values())).toEqual(
        storedRows(slowStorage.getItem('slow-rows')),
      )
      expect(sortedRows(fast.values())).toEqual(
        storedRows(fastStorage.getItem('fast-rows')),
      )
    },
    () => [() => release.resolve(), () => fast.cleanup(), () => slow.cleanup()],
  )
})

// The Promise-returning manual API has one error channel. The finite grammar
// varies whether an earlier automatic write reserves a slot. A storage fault
// on the manual row must reject the returned Promise with the same error at
// the direct-call or predecessor-release checkpoint, without publishing it.
for (const queued of [false, true]) {
  it(`returns a rejected manual acceptance Promise after a ${queued ? 'queued' : 'direct'} storage fault`, async () => {
    const storage = makeStorage()
    const savedSetItem = storage.setItem
    const storageError = new Error('manual storage fault')
    storage.setItem = (key, value) => {
      if (value.includes('s:manual')) throw storageError
      savedSetItem(key, value)
    }
    const entered = createDeferred<void>()
    const release = createDeferred<void>()
    const collection = createCollection(
      localStorageCollectionOptions<Row>({
        storageKey: 'rows',
        storage,
        storageEventApi: { addEventListener() {}, removeEventListener() {} },
        getKey: (row) => row.id,
        onInsert: async ({ transaction }) => {
          if (transaction.mutations[0].modified.id === 'first') {
            entered.resolve()
            await release.promise
          }
        },
      }),
    )
    let manual:
      ReturnType<typeof createTransaction<Record<string, unknown>>> | undefined
    await withHistoryCleanup(
      async () => {
        await collection.preload()
        const first = queued
          ? collection.insert({ id: 'first', value: 1 })
          : undefined
        if (queued) await entered.promise
        manual = createTransaction<Record<string, unknown>>({
          autoCommit: false,
          mutationFn: async () => {},
        })
        manual.mutate(() => collection.insert({ id: 'manual', value: 2 }))
        let receipt: Promise<void> | undefined
        expect(() => {
          receipt = collection.utils.acceptMutations(manual!)
        }).not.toThrow()
        expect(receipt).toBeInstanceOf(Promise)
        if (queued) {
          expect(storage.getItem('rows')).toBeNull()
          release.resolve()
          await first!.isPersisted.promise
        }
        await expect(receipt).rejects.toBe(storageError)
        if (queued)
          expect(storedRows(storage.getItem('rows'))).toEqual([
            { id: 'first', value: 1 },
          ])
        else expect(storage.getItem('rows')).toBeNull()
      },
      () => [
        () => release.resolve(),
        () => {
          if (manual) {
            void manual.isPersisted.promise.catch(() => undefined)
            manual.rollback()
          }
        },
        () => collection.cleanup(),
      ],
    )
  })
}

// Validation runs before a write reserves its slot. It still belongs to the
// Promise-returning manual API: the caller observes rejection through that
// Promise, and no durable row is published.
it('returns a rejected manual acceptance Promise for invalid serialized data', async () => {
  const storage = makeStorage()
  const collection = createCollection(
    localStorageCollectionOptions<Row>({
      storageKey: 'rows',
      storage,
      storageEventApi: { addEventListener() {}, removeEventListener() {} },
      getKey: (row) => row.id,
      parser: {
        parse: JSON.parse,
        stringify: (value) => {
          if (
            typeof value === 'object' &&
            value !== null &&
            'id' in value &&
            value.id === 'bad'
          )
            throw new Error('unserializable row')
          return JSON.stringify(value)
        },
      },
    }),
  )
  let manual:
    ReturnType<typeof createTransaction<Record<string, unknown>>> | undefined
  await withHistoryCleanup(
    async () => {
      await collection.preload()
      manual = createTransaction<Record<string, unknown>>({
        autoCommit: false,
        mutationFn: async () => {},
      })
      manual.mutate(() => collection.insert({ id: 'bad', value: 1 }))
      let receipt: Promise<void> | undefined
      expect(() => {
        receipt = collection.utils.acceptMutations(manual!)
      }).not.toThrow()
      await expect(receipt).rejects.toThrow('unserializable row')
      expect(storage.getItem('rows')).toBeNull()
    },
    () => [
      () => {
        if (manual) {
          void manual.isPersisted.promise.catch(() => undefined)
          manual.rollback()
        }
      },
      () => collection.cleanup(),
    ],
  )
})

// Handler rejection contributes no durable effect and releases its optimistic
// row at its own decision checkpoint for same and disjoint keys. The earlier
// held handler still owns the next storage slot, not the later failure receipt.
for (const secondId of ['a', 'b']) {
  it(`rejects a later failed ${secondId === 'a' ? 'same-key' : 'disjoint-key'} handler while an earlier handler is held`, async () => {
    const storage = makeSeededStorage()
    const firstEntered = createDeferred<void>()
    const releaseFirst = createDeferred<void>()
    const secondFailed = createDeferred<void>()
    const collection = createCollection(
      localStorageCollectionOptions<Row>({
        storageKey: 'rows',
        storage,
        storageEventApi: { addEventListener() {}, removeEventListener() {} },
        getKey: (row) => row.id,
        onUpdate: async ({ transaction }) => {
          if (transaction.mutations[0].modified.value === 1) {
            firstEntered.resolve()
            await releaseFirst.promise
          } else {
            secondFailed.resolve()
            throw new Error('rejected second update')
          }
        },
      }),
    )
    await withHistoryCleanup(
      async () => {
        await collection.preload()
        const first = collection.update('a', (draft) => {
          draft.value = 1
        })
        await firstEntered.promise
        const second = collection.update(secondId, (draft) => {
          draft.value = 2
        })
        const rejected = second.isPersisted.promise.then(
          () => false,
          () => true,
        )
        let settled = false
        void rejected.then(() => {
          settled = true
        })
        await secondFailed.promise
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(settled, 'the failed handler owns its receipt').toBe(true)
        expect(await rejected).toBe(true)
        expect(sortedRows(collection.values())).toEqual([
          { id: 'a', value: 1 },
          { id: 'b', value: 0 },
        ])
        expect(storedRows(storage.getItem('rows'))).toEqual(initial)
        releaseFirst.resolve()
        await first.isPersisted.promise
        expect(storedRows(storage.getItem('rows'))).toEqual([
          { id: 'a', value: 1 },
          { id: 'b', value: 0 },
        ])
      },
      () => [() => releaseFirst.resolve(), () => collection.cleanup()],
    )
  })
}

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
