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
      newValue: storage.getItem(key),
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
        mutationFn: ({ transaction: pending }) => {
          first.utils.acceptMutations(pending)
          second.utils.acceptMutations(pending)
          return Promise.resolve()
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
