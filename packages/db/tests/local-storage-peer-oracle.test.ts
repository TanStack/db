/**
 * A LocalStorage Collection stores whole snapshots under one key and receives
 * peer changes through storage events. For serialized disjoint writes, a peer
 * notification may arrive after a later write. Neither accepted write may be
 * erased by that delayed delivery. Once the event is delivered, both public
 * snapshots and a fresh restore must equal the authored rows.
 *
 * The independent model is an array of authored rows, keyed by typed ID. It
 * folds disjoint accepted writes; it does not read production storage or mirror
 * the adapter's version cache. The legal finite histories vary writer order and
 * number/string-equal keys. They exclude truly simultaneous cross-tab
 * read-modify-write races because localStorage offers no compare-and-swap.
 * The production driver controls event delivery after both `isPersisted`
 * promises fulfill. The durable checkpoint precedes delivery; public and
 * fresh-restore checkpoints follow it.
 *
 * The startup and clear histories use a second simple law: only a valid whole
 * stored snapshot can establish readiness; clear removes that snapshot and
 * publishes empty synced rows. Their model classifies absent, valid, and
 * malformed bytes without using the adapter's parser or mirror. The driver
 * checks startup status, unchanged malformed bytes, local clear publication,
 * peer delivery, later write settlement, and fresh restore. Direct same-tab
 * edits through the raw Storage API are outside the adapter's event contract.
 * An options object contains mutable adapter state and may construct only one
 * Collection, including when shallow copies retain that state. The driver
 * checks this admission before and after the first preload, then checks that
 * the first Collection can still write.
 */
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index'
import { createDeferred } from '../src/deferred'
import { localStorageCollectionOptions } from '../src/local-storage'
import { createTransaction } from '../src/transactions'
import { withHistoryCleanup } from './optimistic-history-oracle'
import type { StorageApi, StorageEventApi } from '../src/local-storage'

type Row = { id: string | number; value: number }

function createHost() {
  const data = new Map<string, string>()
  const listeners = new Set<(event: StorageEvent) => void>()
  const storage: StorageApi = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
  const events: StorageEventApi = {
    addEventListener: (_type, listener) => {
      listeners.add(listener)
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener)
    },
  }
  function deliver(key: string) {
    const event = {
      key,
      storageArea: storage,
      newValue: data.get(key) ?? null,
    } as StorageEvent
    for (const listener of [...listeners]) listener(event)
  }
  return { storage, events, deliver, listenerCount: () => listeners.size }
}

function makeCollection(
  host: ReturnType<typeof createHost>,
  storageKey: string,
  id: string,
) {
  return createCollection(
    localStorageCollectionOptions<Row>({
      id,
      storageKey,
      storage: host.storage,
      storageEventApi: host.events,
      getKey: (row) => row.id,
    }),
  )
}

function expectedRows(authored: ReadonlyArray<Row>): Array<Row> {
  // The model compares typed IDs directly; string '1' and number 1 differ.
  return authored
    .map((row) => ({ ...row }))
    .sort((a, b) =>
      `${typeof a.id}:${a.id}`.localeCompare(`${typeof b.id}:${b.id}`),
    )
}

function publicRows(collection: ReturnType<typeof makeCollection>): Array<Row> {
  return expectedRows(
    [...collection.values()].map(({ id, value }) => ({ id, value })),
  )
}

function durableRows(
  host: ReturnType<typeof createHost>,
  key: string,
): Array<Row> {
  const raw = host.storage.getItem(key)
  if (raw === null) return []
  const records = JSON.parse(raw) as Record<string, { data: Row }>
  return expectedRows(Object.values(records).map(({ data }) => data))
}

for (const firstId of [1, '1'] as const) {
  describe(`delayed peer delivery after ${typeof firstId} key`, () => {
    it('preserves both serialized disjoint writes in storage, peers and restore', async () => {
      const host = createHost()
      const first = makeCollection(host, 'shared', 'first')
      const second = makeCollection(host, 'shared', 'second')
      let reopened: ReturnType<typeof makeCollection> | undefined
      await withHistoryCleanup(
        async () => {
          await Promise.all([first.preload(), second.preload()])
          const authored: Array<Row> = [
            { id: firstId, value: 1 },
            { id: firstId === 1 ? '1' : 1, value: 2 },
          ]
          await first.insert({ ...authored[0]! }).isPersisted.promise
          await second.insert({ ...authored[1]! }).isPersisted.promise
          const expected = expectedRows(authored)
          expect(
            durableRows(host, 'shared'),
            'durable before delivery',
          ).toEqual(expected)
          host.deliver('shared')
          expect(publicRows(first), 'first public after delivery').toEqual(
            expected,
          )
          expect(publicRows(second), 'second public after delivery').toEqual(
            expected,
          )
          reopened = makeCollection(host, 'shared', 'reopened')
          await reopened.preload()
          expect(publicRows(reopened), 'fresh restore').toEqual(expected)
        },
        () => [
          () => reopened?.cleanup(),
          () => second.cleanup(),
          () => first.cleanup(),
        ],
      )
    })
  })
}

/** Manual acceptance belongs to the Collection object, even when two distinct
 * Collections happen to share an ID. The model's two stores each contain only
 * their own authored row at transaction settlement. The disjoint keys avoid
 * core same-key mutation merging, which this adapter cannot control. */
it('manual acceptance keeps equal-ID Collections in their own stores', async () => {
  const host = createHost()
  const first = makeCollection(host, 'first-store', 'same-id')
  const second = makeCollection(host, 'second-store', 'same-id')
  await withHistoryCleanup(
    async () => {
      await Promise.all([first.preload(), second.preload()])
      const transaction = createTransaction({
        autoCommit: false,
        mutationFn: async ({ transaction: pending }) => {
          await first.utils.acceptMutations(pending)
          await second.utils.acceptMutations(pending)
        },
      })
      transaction.mutate(() => {
        first.insert({ id: 'first', value: 1 })
        second.insert({ id: 'second', value: 2 })
      })
      await transaction.commit()
      expect(durableRows(host, 'first-store')).toEqual([
        { id: 'first', value: 1 },
      ])
      expect(durableRows(host, 'second-store')).toEqual([
        { id: 'second', value: 2 },
      ])
    },
    () => [() => second.cleanup(), () => first.cleanup()],
  )
})

/** One adapter options object owns one Collection. Its mutable sync and
 * utility state cannot represent two owners at once. The finite history
 * varies whether the first Collection has started its sync run and whether
 * callers shallow-copy the options. The model rejects a second construction
 * at admission; the first still persists its authored row. Fresh options
 * objects remain the supported path for two Collections. */
for (const firstPreloaded of [false, true]) {
  for (const shallowCopy of [false, true]) {
    it(`rejects ${shallowCopy ? 'shallow-copy' : 'direct'} reuse of LocalStorage options ${firstPreloaded ? 'after' : 'before'} the first preload`, async () => {
      const host = createHost()
      const options = localStorageCollectionOptions<Row>({
        id: 'shared-options',
        storageKey: 'shared',
        storage: host.storage,
        storageEventApi: host.events,
        getKey: (row) => row.id,
      })
      const forCreate = () => (shallowCopy ? { ...options } : options)
      const first = createCollection(forCreate())
      await withHistoryCleanup(
        async () => {
          if (firstPreloaded) await first.preload()
          expect(() => createCollection(forCreate())).toThrow(
            'LocalStorage options can create only one Collection',
          )
          if (!firstPreloaded) await first.preload()
          const transaction = createTransaction({
            autoCommit: false,
            mutationFn: async ({ transaction: pending }) => {
              await first.utils.acceptMutations(pending)
            },
          })
          transaction.mutate(() => first.insert({ id: 'first', value: 1 }))
          await transaction.commit()
          expect(durableRows(host, 'shared')).toEqual([
            { id: 'first', value: 1 },
          ])
          expect(publicRows(first)).toEqual([{ id: 'first', value: 1 }])
        },
        () => [() => first.cleanup()],
      )
    })
  }
}

/** Cleanup ends a sync run, including its browser-event lease. A restart
 * starts one new listener. Counting the controlled host's listeners is the
 * resource observation; the public row after restart is the receiving check. */
it('cleanup releases its storage listener and restart installs one listener', async () => {
  const host = createHost()
  const collection = makeCollection(host, 'shared', 'restartable')
  await withHistoryCleanup(
    async () => {
      await collection.preload()
      expect(host.listenerCount()).toBe(1)
      await collection.cleanup()
      expect(host.listenerCount()).toBe(0)
      collection.startSyncImmediate()
      expect(host.listenerCount()).toBe(1)
      host.storage.setItem(
        'shared',
        JSON.stringify({
          's:peer': {
            versionKey: 'peer-version',
            data: { id: 'peer', value: 3 },
          },
        }),
      )
      host.deliver('shared')
      expect(publicRows(collection)).toEqual([{ id: 'peer', value: 3 }])
    },
    () => [() => collection.cleanup()],
  )
  expect(host.listenerCount()).toBe(0)
})

/** The supported clear utility removes and publishes the empty snapshot. The
 * independent model starts with one row, clears it, then inserts a new row;
 * the authored final snapshot contains only the new row. The production
 * driver delivers peer events after each durable change. Local publication
 * is checked at clear return; both peers and fresh restore at settlement. */
it('does not retain cleared rows after the next local write settles', async () => {
  const host = createHost()
  const collection = makeCollection(host, 'shared', 'writer')
  const peer = makeCollection(host, 'shared', 'peer')
  let reopened: ReturnType<typeof makeCollection> | undefined
  await withHistoryCleanup(
    async () => {
      await Promise.all([collection.preload(), peer.preload()])
      await collection.insert({ id: 'old', value: 1 }).isPersisted.promise
      host.deliver('shared')
      expect(publicRows(peer)).toEqual([{ id: 'old', value: 1 }])
      collection.utils.clearStorage()
      expect(host.storage.getItem('shared')).toBeNull()
      expect(
        publicRows(collection),
        'clear publishes the empty snapshot',
      ).toEqual([])
      host.deliver('shared')
      expect(publicRows(peer)).toEqual([])
      await collection.insert({ id: 'new', value: 2 }).isPersisted.promise
      const expected = [{ id: 'new', value: 2 }]
      expect(durableRows(host, 'shared')).toEqual(expected)
      expect(publicRows(collection)).toEqual(expected)
      host.deliver('shared')
      expect(publicRows(peer)).toEqual(expected)
      reopened = makeCollection(host, 'shared', 'reopened')
      await reopened.preload()
      expect(publicRows(reopened)).toEqual(expected)
    },
    () => [
      () => reopened?.cleanup(),
      () => peer.cleanup(),
      () => collection.cleanup(),
    ],
  )
})

/** Clear removes accepted synced rows, while an already pending optimistic
 * mutation still owns its intent. The independent history clears the durable
 * row before releasing that handler; its later accepted write restores only
 * its own row. This distinguishes clear publication from cancellation. */
it('keeps a pending mutation through clear until it settles', async () => {
  const host = createHost()
  const entered = createDeferred<void>()
  const release = createDeferred<void>()
  const collection = createCollection(
    localStorageCollectionOptions<Row>({
      storageKey: 'shared',
      storage: host.storage,
      storageEventApi: host.events,
      getKey: (row) => row.id,
      onUpdate: async () => {
        entered.resolve()
        await release.promise
      },
    }),
  )
  await withHistoryCleanup(
    async () => {
      await collection.preload()
      await collection.insert({ id: 'pending', value: 1 }).isPersisted.promise
      const update = collection.update('pending', (draft) => {
        draft.value = 2
      })
      await entered.promise
      collection.utils.clearStorage()
      expect(host.storage.getItem('shared')).toBeNull()
      expect(publicRows(collection)).toEqual([{ id: 'pending', value: 2 }])
      release.resolve()
      await update.isPersisted.promise
      expect(durableRows(host, 'shared')).toEqual([{ id: 'pending', value: 2 }])
      expect(publicRows(collection)).toEqual([{ id: 'pending', value: 2 }])
    },
    () => [() => release.resolve(), () => collection.cleanup()],
  )
})

/** The Storage API uses null for a missing key. An existing empty string is
 * malformed stored content, so the model permits a first insert from null
 * but forbids silently replacing the empty string after startup. The failed
 * receipt and unchanged bytes are the observations; explicit removal then
 * permits a successful new write. */
it('distinguishes a missing storage key from malformed empty content', async () => {
  const host = createHost()
  const collection = makeCollection(host, 'shared', 'writer')
  await withHistoryCleanup(
    async () => {
      await collection.preload()
      await collection.insert({ id: 'first', value: 1 }).isPersisted.promise
      expect(durableRows(host, 'shared')).toEqual([{ id: 'first', value: 1 }])
      host.storage.setItem('shared', '')
      const rejected = collection.insert({ id: 'second', value: 2 })
      await expect(rejected.isPersisted.promise).rejects.toThrow(SyntaxError)
      expect(host.storage.getItem('shared')).toBe('')
      collection.utils.clearStorage()
      await collection.insert({ id: 'third', value: 3 }).isPersisted.promise
      expect(durableRows(host, 'shared')).toEqual([{ id: 'third', value: 3 }])
    },
    () => [() => collection.cleanup()],
  )
})

/** A persisted restore has either read a valid whole snapshot or failed.
 * The independent model classifies these malformed bytes as no authoritative
 * snapshot; it never substitutes an empty one. Startup must report Collection
 * error before readiness, leave the bytes intact, and allow a new Collection
 * to restore after an explicit clear. This grammar includes malformed JSON,
 * an old array shape, and one bad row beside a valid row. */
for (const [name, raw] of [
  ['empty string', ''],
  ['legacy array', '[{"id":"old","value":1}]'],
  [
    'mixed row versions',
    JSON.stringify({
      's:valid': {
        versionKey: 'valid-version',
        data: { id: 'valid', value: 1 },
      },
      's:invalid': { data: { id: 'invalid', value: 2 } },
    }),
  ],
] as const) {
  it(`fails persisted restore without replacing ${name}`, async () => {
    const host = createHost()
    host.storage.setItem('shared', raw)
    const collection = makeCollection(host, 'shared', 'reader')
    let reopened: ReturnType<typeof makeCollection> | undefined
    await withHistoryCleanup(
      async () => {
        await expect(collection.preload()).rejects.toThrow()
        expect(collection.status).toBe('error')
        expect(host.storage.getItem('shared')).toBe(raw)
        collection.utils.clearStorage()
        reopened = makeCollection(host, 'shared', 'reopened')
        await reopened.preload()
        expect(publicRows(reopened)).toEqual([])
      },
      () => [() => reopened?.cleanup(), () => collection.cleanup()],
    )
  })
}

// A transient read failure is also insufficient evidence for an empty
// persisted restore. Unlike malformed bytes, the existing valid snapshot can
// be read on restart without clearing it. The first preload must fail before
// readiness; the next sync run must publish the original durable row.
for (const failureKind of ['storage', 'parser'] as const) {
  it(`restarts persisted restore after a transient ${failureKind} read failure`, async () => {
    const host = createHost()
    const stored = JSON.stringify({
      's:kept': {
        versionKey: 'kept-version',
        data: { id: 'kept', value: 1 },
      },
    })
    host.storage.setItem('shared', stored)
    const originalGet = host.storage.getItem
    let fail = true
    const storage: StorageApi = {
      ...host.storage,
      getItem: (key) => {
        if (fail && failureKind === 'storage') {
          fail = false
          throw new Error('transient storage read')
        }
        return originalGet(key)
      },
    }
    const collection = createCollection(
      localStorageCollectionOptions<Row>({
        id: 'reader',
        storageKey: 'shared',
        storage,
        storageEventApi: host.events,
        parser: {
          parse: (raw) => {
            if (fail && failureKind === 'parser') {
              fail = false
              throw new Error('transient parser read')
            }
            return JSON.parse(raw)
          },
          stringify: JSON.stringify,
        },
        getKey: (row) => row.id,
      }),
    )
    await withHistoryCleanup(
      async () => {
        await expect(collection.preload()).rejects.toThrow('transient')
        expect(collection.status).toBe('error')
        expect(host.storage.getItem('shared')).toBe(stored)
        await collection.cleanup()
        collection.startSyncImmediate()
        expect(collection.status).toBe('ready')
        expect(publicRows(collection)).toEqual([{ id: 'kept', value: 1 }])
      },
      () => [() => collection.cleanup()],
    )
  })
}

/** An accepted peer insert may reach the source while a local insert has only
 * optimistic state. The ordered durable writes are peer then local. The model
 * therefore predicts the local whole row at final settlement, with no duplicate
 * source insert error. This is the same pending-intent boundary as the
 * IndexedDB settlement oracle, exercised here through storage events. */
it('a peer insert during a pending local insert confirms the final local row', async () => {
  const host = createHost()
  const entered = createDeferred<void>()
  const gate = createDeferred<void>()
  const local = createCollection(
    localStorageCollectionOptions<Row>({
      id: 'local',
      storageKey: 'shared',
      storage: host.storage,
      storageEventApi: host.events,
      getKey: (row) => row.id,
      onInsert: async () => {
        entered.resolve()
        await gate.promise
      },
    }),
  )
  const peer = makeCollection(host, 'shared', 'peer')
  await withHistoryCleanup(
    async () => {
      await Promise.all([local.preload(), peer.preload()])
      const localWrite = local.insert({ id: 'same', value: 1 })
      const outcome = localWrite.isPersisted.promise
      await entered.promise
      await peer.insert({ id: 'same', value: 2 }).isPersisted.promise
      expect(durableRows(host, 'shared')).toEqual([{ id: 'same', value: 2 }])
      host.deliver('shared')
      expect(publicRows(local)).toEqual([{ id: 'same', value: 1 }])
      gate.resolve()
      await outcome
      host.deliver('shared')
      expect(durableRows(host, 'shared')).toEqual([{ id: 'same', value: 1 }])
      expect(publicRows(local)).toEqual([{ id: 'same', value: 1 }])
      expect(publicRows(peer)).toEqual([{ id: 'same', value: 1 }])
    },
    () => [() => gate.resolve(), () => peer.cleanup(), () => local.cleanup()],
  )
})

/** A new whole-store write may only extend a durable snapshot it actually
 * read. A transient read or parse failure cannot mean "the store is empty":
 * that would turn a failed read into a successful replacement. A failed event
 * read also cannot delete public rows. The authored model keeps the prior row,
 * excludes the rejected row, then adds a successful suffix. Public, durable,
 * and fresh-restore rows must agree after settlement. */
for (const failureKind of ['storage', 'parser'] as const) {
  it(`preserves rows when ${failureKind} reads fail during writes or events`, async () => {
    const host = createHost()
    const readError = new Error(`${failureKind} read failed`)
    let failRead = false
    const storage = host.storage
    const getItem = storage.getItem
    storage.getItem = (key) => {
      if (failRead && failureKind === 'storage') {
        failRead = false
        throw readError
      }
      return getItem(key)
    }
    const collection = createCollection(
      localStorageCollectionOptions<Row>({
        id: 'reader',
        storageKey: 'shared',
        storage,
        storageEventApi: host.events,
        parser: {
          parse: (raw) => {
            if (failRead && failureKind === 'parser') {
              failRead = false
              throw readError
            }
            return JSON.parse(raw)
          },
          stringify: JSON.stringify,
        },
        getKey: (row) => row.id,
      }),
    )
    let reopened: ReturnType<typeof makeCollection> | undefined
    await withHistoryCleanup(
      async () => {
        await collection.preload()
        await collection.insert({ id: 'before', value: 1 }).isPersisted.promise
        failRead = true
        await expect(
          collection.insert({ id: 'rejected', value: 2 }).isPersisted.promise,
        ).rejects.toBe(readError)
        expect(durableRows(host, 'shared')).toEqual([
          { id: 'before', value: 1 },
        ])
        failRead = true
        host.deliver('shared')
        expect(
          publicRows(collection),
          'failed event read retains public rows',
        ).toEqual([{ id: 'before', value: 1 }])
        await collection.insert({ id: 'after', value: 3 }).isPersisted.promise
        const expected = expectedRows([
          { id: 'before', value: 1 },
          { id: 'after', value: 3 },
        ])
        expect(durableRows(host, 'shared')).toEqual(expected)
        expect(publicRows(collection)).toEqual(expected)
        reopened = makeCollection(host, 'shared', 'reopened')
        await reopened.preload()
        expect(publicRows(reopened)).toEqual(expected)
      },
      () => [() => reopened?.cleanup(), () => collection.cleanup()],
    )
  })
}
