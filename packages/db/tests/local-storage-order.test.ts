// Ordinary regression tests for LocalStorage write order. Each test runs one
// fixed scenario and compares with hand-written rows. The law that orders
// automatic and manual writes, and its generated histories, are owned by
// local-storage-order-oracle.test.ts.
import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index'
import { DbClient, collectionOptions } from '../src/client'
import { createDeferred } from '../src/deferred'
import { localStorageCollectionOptions } from '../src/local-storage'
import { createTransaction } from '../src/transactions'
import {
  observeHistoryPromise,
  withHistoryCleanup,
} from './optimistic-history-oracle'
import {
  initial,
  makeSeededStorage,
  makeStorage,
  sortedRows,
  storedRows,
} from './local-storage-fixtures'
import type { Row } from './local-storage-fixtures'

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
        mutationFn: async ({ transaction: pending }) => {
          await settings.utils.acceptMutations(pending)
        },
      })
      transaction.mutate(() => {
        collection.insert({ id: 'early', value: 1 })
      })
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

/** The module-level utility belongs to both its direct Collection and every
 * fresh Collection made by its DbClient descriptor. A direct Collection's
 * sync-run state cannot change which materialized Collection owns a manual
 * mutation. The independent model accepts the one authored row in the
 * materialized Collection for each direct-owner state. A fulfilled receipt
 * must match durable bytes, both active public snapshots, and fresh restore.
 * The cleaned-up direct owner has no public-snapshot obligation until restart. */
for (const directState of ['idle', 'ready', 'cleaned-up'] as const) {
  it(`routes manual acceptance to a DbClient owner with a ${directState} direct owner`, async () => {
    const storage = makeStorage()
    const settings = localStorageCollectionOptions<Row>({
      id: 'shared-options',
      storageKey: 'rows',
      storage,
      storageEventApi: { addEventListener() {}, removeEventListener() {} },
      getKey: (row) => row.id,
    })
    const direct = createCollection(settings)
    const client = new DbClient()
    const materialized = client.collection(collectionOptions(settings))
    let reopened: typeof materialized | undefined
    await withHistoryCleanup(
      async () => {
        if (directState !== 'idle') await direct.preload()
        if (directState === 'cleaned-up') await direct.cleanup()
        await materialized.preload()
        const manual = createTransaction({
          autoCommit: false,
          mutationFn: async ({ transaction: pending }) => {
            await settings.utils.acceptMutations(pending)
          },
        })
        manual.mutate(() => materialized.insert({ id: 'owned', value: 1 }))
        await manual.commit()
        await manual.isPersisted.promise
        const expected = [{ id: 'owned', value: 1 }]
        expect(
          storedRows(storage.getItem('rows')),
          'manual durable receipt',
        ).toEqual(expected)
        expect(
          sortedRows(materialized.values()),
          'materialized public receipt',
        ).toEqual(expected)
        if (directState === 'ready')
          expect(sortedRows(direct.values()), 'direct peer receipt').toEqual(
            expected,
          )
        reopened = createCollection(
          localStorageCollectionOptions<Row>({
            id: 'reopened',
            storageKey: 'rows',
            storage,
            storageEventApi: {
              addEventListener() {},
              removeEventListener() {},
            },
            getKey: (row) => row.id,
          }),
        )
        await reopened.preload()
        expect(sortedRows(reopened.values()), 'fresh restore').toEqual(expected)
      },
      () => [
        () => reopened?.cleanup(),
        () => client.cleanup(),
        () => direct.cleanup(),
      ],
    )
  })
}

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

// A mutationFn may accept local work and then fail for another reason. The
// accepted write remains authorized, but the transaction cannot report its
// failure before that registered work settles. The independent fold contains
// both accepted rows after the held predecessor is released. The held cut
// checks commit and persistence receipts; the final cut checks durable data.
it('waits for queued acceptance before reporting a later mutationFn failure', async () => {
  const storage = makeStorage()
  const entered = createDeferred<void>()
  const release = createDeferred<void>()
  const accepted = createDeferred<void>()
  const failure = new Error('API failed after accepting local write')
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
  let reopened: typeof collection | undefined
  await withHistoryCleanup(
    async () => {
      await collection.preload()
      const first = collection.insert({ id: 'first', value: 1 })
      await entered.promise
      const manual = createTransaction<Record<string, unknown>>({
        autoCommit: false,
        mutationFn: ({ transaction }) => {
          void collection.utils.acceptMutations(transaction).catch(() => {})
          accepted.resolve()
          throw failure
        },
      })
      manual.mutate(() => collection.insert({ id: 'manual', value: 2 }))
      const commit = observeHistoryPromise(manual.commit())
      const receipt = observeHistoryPromise(manual.isPersisted.promise)
      await accepted.promise
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(commit.read().status, 'held commit').toBe('pending')
      expect(receipt.read().status, 'held persistence receipt').toBe('pending')
      release.resolve()
      await first.isPersisted.promise
      await Promise.all([commit.settled, receipt.settled])
      expect(commit.read()).toMatchObject({
        status: 'rejected',
        reason: failure,
      })
      expect(receipt.read()).toMatchObject({
        status: 'rejected',
        reason: failure,
      })
      const expected = [
        { id: 'first', value: 1 },
        { id: 'manual', value: 2 },
      ]
      expect(
        storedRows(storage.getItem('rows')),
        'durable at rejected receipt',
      ).toEqual(expected)
      expect(
        sortedRows(collection.values()),
        'public at rejected receipt',
      ).toEqual(expected)
      reopened = createCollection(
        localStorageCollectionOptions<Row>({
          id: 'reopened',
          storageKey: 'rows',
          storage,
          storageEventApi: { addEventListener() {}, removeEventListener() {} },
          getKey: (row) => row.id,
        }),
      )
      await reopened.preload()
      expect(sortedRows(reopened.values()), 'fresh restore').toEqual(expected)
    },
    () => [
      () => release.resolve(),
      () => reopened?.cleanup(),
      () => collection.cleanup(),
    ],
  )
})

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
