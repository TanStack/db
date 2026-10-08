/**
 * A LocalStorage Collection stores whole snapshots under one key and receives
 * peer changes through storage events and same-tab publication. Active
 * Collections with fresh options that share one Storage object and key must
 * agree with the durable snapshot when a local write's persistence receipt
 * fulfills, apart from their own pending optimistic overlays and valid-read
 * failures. With default JSON, a writer retains an authored rich value such
 * as Date; peers and fresh restore see its JSON form. JSON-native rows and
 * custom-parser normalized rows follow the durable agreement law. A delayed
 * event must not erase a later accepted write. A failed write must not publish
 * an unaccepted row.
 *
 * The independent model is an array of authored rows, keyed by typed ID. It
 * folds disjoint accepted writes; it does not read production storage or mirror
 * the adapter's version cache. The legal finite histories vary writer order and
 * number/string-equal keys. They exclude truly simultaneous cross-tab
 * read-modify-write races because localStorage offers no compare-and-swap.
 * The production driver withholds events through each persistence receipt.
 * Durable and public snapshots are compared at that cut, then again after a
 * delayed event and fresh restore. The proposed same-tab law distinguishes
 * the old event-only prediction (a peer stays stale until delivery) from the
 * approved prediction (the peer observes each successful local receipt).
 * Different Storage wrapper objects and simultaneous cross-tab writes remain
 * outside this identity-scoped law.
 *
 * The startup and clear histories use a second simple law: only a valid whole
 * stored snapshot can establish readiness; clear removes that snapshot and
 * publishes empty synced rows. Their model classifies absent, valid, and
 * malformed bytes without using the adapter's parser or mirror. A stored row
 * needs an object value, a string version token, and an encoded key that
 * agrees with the row's public key. The driver
 * checks startup status, unchanged malformed bytes, local clear publication,
 * peer publication, later write settlement, and fresh restore. Direct same-tab
 * edits through the raw Storage API are outside the adapter's event contract.
 * An options object contains mutable adapter state and may construct only one
 * Collection, including when shallow copies retain that state. The driver
 * checks this admission before and after the first preload, then checks that
 * the first Collection can still write.
 */
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index'
import { createDeferred } from '../src/deferred'
import { LocalStorageCollectionError } from '../src/errors'
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
          expect(durableRows(host, 'shared'), 'first durable receipt').toEqual(
            expectedRows(authored.slice(0, 1)),
          )
          expect(publicRows(second), 'first same-tab peer receipt').toEqual(
            expectedRows(authored.slice(0, 1)),
          )
          await second.insert({ ...authored[1]! }).isPersisted.promise
          const expected = expectedRows(authored)
          expect(
            durableRows(host, 'shared'),
            'durable before delivery',
          ).toEqual(expected)
          expect(publicRows(first), 'first public before delivery').toEqual(
            expected,
          )
          expect(publicRows(second), 'second public before delivery').toEqual(
            expected,
          )
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

/** The authored-row model inserts, replaces, replaces again, then removes one
 * typed key. Each receipt predicts the same whole row (or absence) in both
 * active public snapshots and durable storage without a host event. The
 * second replacement reaches manual acceptance; the third and removal reach
 * automatic update and delete. A later event is only a duplicate notice. */
it('publishes manual and automatic same-key edits to a same-tab peer', async () => {
  const host = createHost()
  const first = makeCollection(host, 'shared', 'first')
  const second = makeCollection(host, 'shared', 'second')
  await withHistoryCleanup(
    async () => {
      await Promise.all([first.preload(), second.preload()])
      await first.insert({ id: 'row', value: 1 }).isPersisted.promise
      expect(publicRows(second)).toEqual([{ id: 'row', value: 1 }])

      const transaction = createTransaction({
        autoCommit: false,
        mutationFn: async ({ transaction: pending }) => {
          await second.utils.acceptMutations(pending)
        },
      })
      transaction.mutate(() => {
        second.update('row', (draft) => {
          draft.value = 2
        })
      })
      await transaction.commit()
      const expected = expectedRows([{ id: 'row', value: 2 }])
      expect(durableRows(host, 'shared'), 'manual durable receipt').toEqual(
        expected,
      )
      expect(publicRows(first), 'manual same-tab peer receipt').toEqual(
        expected,
      )
      expect(publicRows(second), 'manual writer receipt').toEqual(expected)
      await first.update('row', (draft) => {
        draft.value = 3
      }).isPersisted.promise
      const updated = expectedRows([{ id: 'row', value: 3 }])
      expect(durableRows(host, 'shared'), 'automatic update durable').toEqual(
        updated,
      )
      expect(publicRows(second), 'automatic update peer').toEqual(updated)
      await second.delete('row').isPersisted.promise
      expect(durableRows(host, 'shared'), 'automatic delete durable').toEqual(
        [],
      )
      expect(publicRows(first), 'automatic delete peer').toEqual([])
      expect(publicRows(second), 'automatic delete writer').toEqual([])
      host.deliver('shared')
      expect(publicRows(first), 'late duplicate delivery').toEqual([])
    },
    () => [() => second.cleanup(), () => first.cleanup()],
  )
})

/** A failed Storage write never becomes an authored row. The model therefore
 * keeps the first accepted row at the rejected receipt, in storage and in
 * both public snapshots. This distinguishes notification after a successful
 * setItem from notification at write admission. */
it('does not publish a rejected same-tab write', async () => {
  const host = createHost()
  const first = makeCollection(host, 'shared', 'first')
  const second = makeCollection(host, 'shared', 'second')
  await withHistoryCleanup(
    async () => {
      await Promise.all([first.preload(), second.preload()])
      await first.insert({ id: 'kept', value: 1 }).isPersisted.promise
      const writeError = new Error('storage write failed')
      const setItem = host.storage.setItem
      host.storage.setItem = () => {
        throw writeError
      }
      try {
        await expect(
          second.insert({ id: 'rejected', value: 2 }).isPersisted.promise,
        ).rejects.toBe(writeError)
      } finally {
        host.storage.setItem = setItem
      }
      const expected = expectedRows([{ id: 'kept', value: 1 }])
      expect(durableRows(host, 'shared'), 'rejected durable receipt').toEqual(
        expected,
      )
      expect(publicRows(first), 'peer after rejected receipt').toEqual(expected)
      expect(publicRows(second), 'writer after rollback').toEqual(expected)
    },
    () => [() => second.cleanup(), () => first.cleanup()],
  )
})

/** A durable write is accepted before peer refresh. One peer's invalid read
 * cannot revoke that receipt or prevent a later compatible peer from seeing
 * the authored row. The controlled parser fails only when validating the row
 * received through publication; all three Collections restored empty first. */
it('isolates a failing same-tab receiver after a durable write', async () => {
  const host = createHost()
  const writer = makeCollection(host, 'shared', 'writer')
  const failed = createCollection(
    localStorageCollectionOptions<Row>({
      id: 'failed',
      storageKey: 'shared',
      storage: host.storage,
      storageEventApi: host.events,
      getKey: (row) => row.id,
      parser: {
        parse: JSON.parse,
        stringify: (value) => {
          if (typeof value === 'object' && value !== null && 'id' in value) {
            throw new Error('receiver cannot validate row')
          }
          return JSON.stringify(value)
        },
      },
    }),
  )
  const later = makeCollection(host, 'shared', 'later')
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await withHistoryCleanup(
    async () => {
      await Promise.all([writer.preload(), failed.preload(), later.preload()])
      await writer.insert({ id: 'accepted', value: 1 }).isPersisted.promise
      const expected = [{ id: 'accepted', value: 1 }]
      expect(durableRows(host, 'shared'), 'durable receipt').toEqual(expected)
      expect(publicRows(writer), 'writer receipt').toEqual(expected)
      expect(publicRows(later), 'later peer receipt').toEqual(expected)
      expect(
        publicRows(failed),
        'failed peer remains on prior snapshot',
      ).toEqual([])
      expect(warning).toHaveBeenCalled()
    },
    () => [
      () => warning.mockRestore(),
      () => later.cleanup(),
      () => failed.cleanup(),
      () => writer.cleanup(),
    ],
  )
})

/** A writer's key extractor can fail while confirming a row that Storage has
 * already accepted. The receipt reports that local error, but the durable
 * authored row still belongs to the shared snapshot. A compatible peer must
 * see it without relying on a browser storage event; this history does not
 * promise recovery for the writer's invalid key extractor. */
it('publishes a durable row even when local confirmation fails', async () => {
  const host = createHost()
  const confirmationError = new Error('local confirmation key failed')
  let failNextKey = false
  const setItem = host.storage.setItem
  host.storage.setItem = (key, value) => {
    setItem(key, value)
    failNextKey = true
  }
  const writer = createCollection(
    localStorageCollectionOptions<Row>({
      id: 'writer',
      storageKey: 'shared',
      storage: host.storage,
      storageEventApi: host.events,
      getKey: (row) => {
        if (failNextKey) {
          failNextKey = false
          throw confirmationError
        }
        return row.id
      },
    }),
  )
  const peer = makeCollection(host, 'shared', 'peer')
  await withHistoryCleanup(
    async () => {
      await Promise.all([writer.preload(), peer.preload()])
      await expect(
        writer.insert({ id: 'durable', value: 1 }).isPersisted.promise,
      ).rejects.toBe(confirmationError)
      const expected = [{ id: 'durable', value: 1 }]
      expect(
        durableRows(host, 'shared'),
        'durable despite rejected receipt',
      ).toEqual(expected)
      expect(publicRows(peer), 'peer after failed local confirmation').toEqual(
        expected,
      )
    },
    () => [() => peer.cleanup(), () => writer.cleanup()],
  )
})

/** A receiver can synchronously author a second write while publishing the
 * first. The third authored update changes that nested row again. A stale
 * outer mirror would classify it as a new insert, although the public peer
 * already has the row, and can fail with a duplicate-key error. */
it('preserves a nested same-tab write during peer publication', async () => {
  const host = createHost()
  const writer = makeCollection(host, 'shared', 'writer')
  const peer = makeCollection(host, 'shared', 'peer')
  const nestedWriter = makeCollection(host, 'shared', 'nested-writer')
  let nested: Promise<unknown> | undefined
  let admitted = false
  const subscription = peer.subscribeChanges(
    (changes) => {
      if (!admitted && changes.some((change) => change.key === 'first')) {
        admitted = true
        nested = nestedWriter.insert({ id: 'nested', value: 2 }).isPersisted
          .promise
      }
    },
    { includeInitialState: false },
  )
  await withHistoryCleanup(
    async () => {
      await Promise.all([
        peer.preload(),
        writer.preload(),
        nestedWriter.preload(),
      ])
      await writer.insert({ id: 'first', value: 1 }).isPersisted.promise
      expect(nested, 'peer admitted nested write').toBeDefined()
      await nested
      const expected = expectedRows([
        { id: 'first', value: 1 },
        { id: 'nested', value: 2 },
      ])
      expect(durableRows(host, 'shared'), 'nested durable receipt').toEqual(
        expected,
      )
      expect(publicRows(writer), 'nested writer receipt').toEqual(expected)
      expect(publicRows(peer), 'nested peer receipt').toEqual(expected)
      expect(publicRows(nestedWriter), 'nested writer public receipt').toEqual(
        expected,
      )
      await nestedWriter.update('nested', (draft) => {
        draft.value = 3
      }).isPersisted.promise
      const final = expectedRows([
        { id: 'first', value: 1 },
        { id: 'nested', value: 3 },
      ])
      expect(durableRows(host, 'shared'), 'later durable receipt').toEqual(
        final,
      )
      expect(publicRows(peer), 'later peer receipt').toEqual(final)
    },
    () => [
      () => subscription.unsubscribe(),
      () => nestedWriter.cleanup(),
      () => peer.cleanup(),
      () => writer.cleanup(),
    ],
  )
})

/** A whole-snapshot write must read the current durable base once, and each
 * distinct peer parser must read the new bytes once. With the default JSON
 * parser, the writer already owns the exact saved snapshot, so a second full
 * parse adds no information at this non-reentrant receipt. Custom parsers
 * remain independent. The public model expects both rows in all Collections. */
it('avoids reparsing the writer snapshot during same-tab publication', async () => {
  const host = createHost()
  host.storage.setItem(
    'shared',
    JSON.stringify({
      's:prior': {
        versionKey: 'prior-version',
        data: { id: 'prior', value: 0 },
      },
    }),
  )
  const parseJson = JSON.parse
  const writer = makeCollection(host, 'shared', 'writer')
  const peerParses = [0, 0, 0]
  const peers = peerParses.map((_, index) =>
    createCollection(
      localStorageCollectionOptions<Row>({
        id: `peer-${index}`,
        storageKey: 'shared',
        storage: host.storage,
        storageEventApi: host.events,
        getKey: (row) => row.id,
        parser: {
          parse: (raw) => {
            peerParses[index]!++
            return parseJson(raw)
          },
          stringify: JSON.stringify,
        },
      }),
    ),
  )
  const collections = [writer, ...peers]
  const defaultParse = vi.spyOn(JSON, 'parse')
  await withHistoryCleanup(
    async () => {
      await Promise.all(collections.map((collection) => collection.preload()))
      defaultParse.mockClear()
      peerParses.fill(0)
      await writer.insert({ id: 'new', value: 1 }).isPersisted.promise
      expect(
        defaultParse.mock.calls.filter(
          ([raw]) => typeof raw === 'string' && raw.includes('s:prior'),
        ),
        'one writer full parse',
      ).toHaveLength(1)
      expect(peerParses, 'one full parse per peer').toEqual([1, 1, 1])
      const expected = expectedRows([
        { id: 'prior', value: 0 },
        { id: 'new', value: 1 },
      ])
      for (const collection of collections) {
        expect(publicRows(collection), 'public rows at receipt').toEqual(
          expected,
        )
      }
    },
    () => [
      () => defaultParse.mockRestore(),
      ...collections.map((collection) => () => collection.cleanup()),
    ],
  )
})

/** The established direct-write contract keeps native Date fields in the
 * writing Collection. JSON bytes and Collections that read those bytes hold
 * ISO strings instead. This is a deliberate value-domain limit on the peer
 * agreement law above, not permission to leave ordinary JSON-native rows
 * stale. The test compares all three observations at the receipt and restore. */
it('keeps an authored Date in the writer while peers read JSON bytes', async () => {
  type DatedRow = { id: string; at: Date | string }
  const host = createHost()
  const make = (id: string) =>
    createCollection(
      localStorageCollectionOptions<DatedRow>({
        id,
        storageKey: 'dated',
        storage: host.storage,
        storageEventApi: host.events,
        getKey: (row) => row.id,
      }),
    )
  const writer = make('writer')
  const peer = make('peer')
  let reopened: typeof writer | undefined
  await withHistoryCleanup(
    async () => {
      await Promise.all([writer.preload(), peer.preload()])
      const at = new Date('2020-01-02T03:04:05.000Z')
      await writer.insert({ id: 'row', at }).isPersisted.promise
      const expected = [{ id: 'row', at: at.toISOString() }]
      const durable = JSON.parse(host.storage.getItem('dated')!) as Record<
        string,
        { data: DatedRow }
      >
      expect(Object.values(durable).map(({ data }) => data)).toEqual(expected)
      expect([...writer.values()], 'native Date writer receipt').toMatchObject([
        { id: 'row', at },
      ])
      expect([...peer.values()], 'JSON peer receipt').toMatchObject(expected)
      reopened = make('reopened')
      await reopened.preload()
      expect([...reopened.values()], 'JSON fresh restore').toMatchObject(
        expected,
      )
    },
    () => [
      () => reopened?.cleanup(),
      () => peer.cleanup(),
      () => writer.cleanup(),
    ],
  )
})

/** A custom parser may normalize the bytes it writes. The writer's in-memory
 * staged Map is then not authoritative for untouched rows, even when Storage
 * still contains the exact string it just saved. The receiving model reads
 * the actual normalized durable row, so custom parsers must read back. */
for (const changesVersion of [false, true]) {
  it(`publishes an untouched parser-normalized row ${changesVersion ? 'with' : 'without'} a new version token`, async () => {
    const host = createHost()
    host.storage.setItem(
      'shared',
      JSON.stringify({
        's:prior': {
          versionKey: 'prior-version',
          data: { id: 'prior', value: 0 },
        },
      }),
    )
    let parses = 0
    const writer = createCollection(
      localStorageCollectionOptions<Row>({
        id: 'writer',
        storageKey: 'shared',
        storage: host.storage,
        storageEventApi: host.events,
        getKey: (row) => row.id,
        parser: {
          parse: (raw) => {
            parses++
            return JSON.parse(raw)
          },
          stringify: (value) => {
            if (
              typeof value === 'object' &&
              value !== null &&
              's:prior' in value &&
              's:new' in value
            ) {
              return JSON.stringify({
                ...value,
                's:prior': {
                  versionKey: changesVersion
                    ? 'normalized-version'
                    : 'prior-version',
                  data: { id: 'prior', value: 9 },
                },
              })
            }
            return JSON.stringify(value)
          },
        },
      }),
    )
    const peer = makeCollection(host, 'shared', 'peer')
    await withHistoryCleanup(
      async () => {
        await Promise.all([writer.preload(), peer.preload()])
        parses = 0
        await writer.insert({ id: 'new', value: 1 }).isPersisted.promise
        const expected = expectedRows([
          { id: 'prior', value: 9 },
          { id: 'new', value: 1 },
        ])
        expect(parses, 'custom writer read and readback').toBe(2)
        expect(durableRows(host, 'shared')).toEqual(expected)
        expect(publicRows(writer), 'writer normalized public row').toEqual(
          expected,
        )
        expect(publicRows(peer), 'peer normalized public row').toEqual(expected)
      },
      () => [() => peer.cleanup(), () => writer.cleanup()],
    )
  })
}

/** A parser can normalize the row being authored while keeping its generated
 * version token. The authored model predicts the parser's durable value, not
 * the pre-serialization draft. At each persistence receipt the writer, peer,
 * durable bytes, and fresh restore must agree. This history distinguishes
 * data comparison from a version-only detector; the untouched-row history
 * above changes its version and cannot detect that mistake. */
it('publishes a parser-normalized authored row with an unchanged version token', async () => {
  const host = createHost()
  const writer = createCollection(
    localStorageCollectionOptions<Row>({
      id: 'writer',
      storageKey: 'shared',
      storage: host.storage,
      storageEventApi: host.events,
      getKey: (row) => row.id,
      parser: {
        parse: JSON.parse,
        stringify: (value) => {
          if (typeof value === 'object' && value !== null && 's:row' in value) {
            const snapshot = value as Record<
              string,
              { versionKey: string; data: Row }
            >
            return JSON.stringify({
              ...snapshot,
              's:row': {
                ...snapshot['s:row'],
                data: { id: 'row', value: 9 },
              },
            })
          }
          return JSON.stringify(value)
        },
      },
    }),
  )
  const peer = makeCollection(host, 'shared', 'peer')
  let reopened: ReturnType<typeof makeCollection> | undefined
  await withHistoryCleanup(
    async () => {
      await Promise.all([writer.preload(), peer.preload()])
      await writer.insert({ id: 'row', value: 1 }).isPersisted.promise
      const expected = [{ id: 'row', value: 9 }]
      expect(durableRows(host, 'shared'), 'normalized insert durable').toEqual(
        expected,
      )
      expect(publicRows(writer), 'normalized insert writer').toEqual(expected)
      expect(publicRows(peer), 'normalized insert peer').toEqual(expected)
      await writer.update('row', (draft) => {
        draft.value = 2
      }).isPersisted.promise
      expect(durableRows(host, 'shared'), 'normalized update durable').toEqual(
        expected,
      )
      expect(publicRows(writer), 'normalized update writer').toEqual(expected)
      expect(publicRows(peer), 'normalized update peer').toEqual(expected)
      reopened = makeCollection(host, 'shared', 'reopened')
      await reopened.preload()
      expect(publicRows(reopened), 'normalized fresh restore').toEqual(expected)
    },
    () => [
      () => reopened?.cleanup(),
      () => peer.cleanup(),
      () => writer.cleanup(),
    ],
  )
})

/** Cleanup ends the first Collection's receiving sync run. The peer's next
 * accepted write must not republish into that ended run. Restart establishes
 * a new persisted restore and then receives a later same-tab write. The
 * authored model contains the two accepted rows and no event is delivered. */
it('restores same-tab publication after cleanup and restart', async () => {
  const host = createHost()
  const first = makeCollection(host, 'shared', 'first')
  const second = makeCollection(host, 'shared', 'second')
  await withHistoryCleanup(
    async () => {
      await Promise.all([first.preload(), second.preload()])
      await first.cleanup()
      await second.insert({ id: 'during-cleanup', value: 1 }).isPersisted
        .promise
      expect(first.status).toBe('cleaned-up')
      first.startSyncImmediate()
      expect(publicRows(first), 'restart restore').toEqual([
        { id: 'during-cleanup', value: 1 },
      ])
      await second.insert({ id: 'after-restart', value: 2 }).isPersisted.promise
      const expected = expectedRows([
        { id: 'during-cleanup', value: 1 },
        { id: 'after-restart', value: 2 },
      ])
      expect(durableRows(host, 'shared')).toEqual(expected)
      expect(publicRows(first), 'restarted same-tab peer receipt').toEqual(
        expected,
      )
    },
    () => [() => second.cleanup(), () => first.cleanup()],
  )
})

/** A restarted Collection can publish restored rows to an existing
 * subscriber before it reports readiness. That callback may synchronously
 * author a write through an already-ready peer. The independent authored
 * fold contains both seed and nested rows; no browser event is delivered.
 * The receiver must hold that fold at its ready and writer-receipt cuts, and
 * a later update must not reveal a stale mirror from the restore boundary. */
it('receives a peer write authored during persisted restore publication', async () => {
  const host = createHost()
  const first = makeCollection(host, 'shared', 'first')
  const second = makeCollection(host, 'shared', 'second')
  let nestedReceipt: Promise<unknown> | undefined
  let admitted = false
  await withHistoryCleanup(
    async () => {
      await Promise.all([first.preload(), second.preload()])
      const subscription = second.subscribeChanges(
        (changes) => {
          if (!admitted && changes.some((change) => change.key === 'seed')) {
            admitted = true
            nestedReceipt = first.insert({ id: 'nested', value: 2 }).isPersisted
              .promise
          }
        },
        { includeInitialState: false },
      )
      try {
        await second.cleanup()
        await first.insert({ id: 'seed', value: 1 }).isPersisted.promise
        second.startSyncImmediate()
        expect(admitted, 'restore callback admitted peer write').toBe(true)
        await nestedReceipt
        const expected = expectedRows([
          { id: 'seed', value: 1 },
          { id: 'nested', value: 2 },
        ])
        expect(second.status, 'receiver ready after restore').toBe('ready')
        expect(durableRows(host, 'shared'), 'nested durable receipt').toEqual(
          expected,
        )
        expect(publicRows(first), 'nested writer receipt').toEqual(expected)
        expect(publicRows(second), 'restored peer receipt').toEqual(expected)
        await first.update('nested', (draft) => {
          draft.value = 3
        }).isPersisted.promise
        const later = expectedRows([
          { id: 'seed', value: 1 },
          { id: 'nested', value: 3 },
        ])
        expect(durableRows(host, 'shared'), 'later durable receipt').toEqual(
          later,
        )
        expect(publicRows(second), 'later restored peer receipt').toEqual(later)
      } finally {
        subscription.unsubscribe()
      }
    },
    () => [() => second.cleanup(), () => first.cleanup()],
  )
})

/** Readiness grants the second Collection a public sync-run snapshot. A
 * status listener may synchronously cause an already-ready peer to write at
 * that boundary. The authored model contains that one accepted row, so the
 * newly ready Collection must show it at the writer's receipt even though no
 * browser event is delivered. This distinguishes listener registration before
 * readiness publication from registration afterward. */
it('receives a same-tab write started by its ready listener', async () => {
  const host = createHost()
  const first = makeCollection(host, 'shared', 'first')
  const second = makeCollection(host, 'shared', 'second')
  let writeReceipt: Promise<unknown> | undefined
  const off = second.on('status:change', ({ status }) => {
    if (status === 'ready') {
      writeReceipt = first.insert({ id: 'at-ready', value: 1 }).isPersisted
        .promise
    }
  })
  await withHistoryCleanup(
    async () => {
      await first.preload()
      await second.preload()
      expect(writeReceipt, 'ready listener admitted a write').toBeDefined()
      await writeReceipt
      expect(durableRows(host, 'shared')).toEqual([
        { id: 'at-ready', value: 1 },
      ])
      expect(publicRows(second), 'newly ready peer at receipt').toEqual([
        { id: 'at-ready', value: 1 },
      ])
    },
    () => [off, () => second.cleanup(), () => first.cleanup()],
  )
})

/** The controlled host supplies the no-event premise above. This receiving
 * witness uses jsdom's Storage object through the public default option: its
 * second Collection must see a write from the first without a synthetic event.
 * It does not claim native multi-window timing or cross-tab atomicity. */
it('publishes through the default same-tab Storage object', async () => {
  const storageKey = 'same-tab-local-storage-oracle'
  window.localStorage.removeItem(storageKey)
  const first = createCollection(
    localStorageCollectionOptions<Row>({
      id: 'first-default-storage',
      storageKey,
      getKey: (row) => row.id,
    }),
  )
  const second = createCollection(
    localStorageCollectionOptions<Row>({
      id: 'second-default-storage',
      storageKey,
      getKey: (row) => row.id,
    }),
  )
  await withHistoryCleanup(
    async () => {
      await Promise.all([first.preload(), second.preload()])
      await first.insert({ id: 'row', value: 1 }).isPersisted.promise
      expect(publicRows(second)).toEqual([{ id: 'row', value: 1 }])
    },
    () => [
      () => second.cleanup(),
      () => first.cleanup(),
      () => window.localStorage.removeItem(storageKey),
    ],
  )
})

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

/** A module-level options utility is not a license to persist a different
 * Collection that happens to have the same ID. The independent ownership
 * model assigns the mutation only to the Collection built from its own
 * options. A mismatched utility must fail at acceptance without writing
 * either store, rather than silently reporting a successful wrong write. */
for (const unrelatedKey of ['first-store', 'second-store']) {
  it(`rejects module-level acceptance for an unrelated equal-ID Collection on ${unrelatedKey}`, async () => {
    const host = createHost()
    const settings = localStorageCollectionOptions<Row>({
      id: 'same-id',
      storageKey: 'first-store',
      storage: host.storage,
      storageEventApi: host.events,
      getKey: (row) => row.id,
    })
    const unrelated = makeCollection(host, unrelatedKey, 'same-id')
    let transaction:
      ReturnType<typeof createTransaction<Record<string, unknown>>> | undefined
    await withHistoryCleanup(
      async () => {
        await unrelated.preload()
        transaction = createTransaction<Record<string, unknown>>({
          autoCommit: false,
          mutationFn: async () => {},
        })
        transaction.mutate(() => {
          unrelated.insert({ id: 'other', value: 1 })
        })
        await expect(
          settings.utils.acceptMutations(transaction),
        ).rejects.toThrow(LocalStorageCollectionError)
        expect(host.storage.getItem('first-store')).toBeNull()
        expect(host.storage.getItem('second-store')).toBeNull()
      },
      () => [
        () => {
          if (transaction) {
            void transaction.isPersisted.promise.catch(() => undefined)
            transaction.rollback()
          }
        },
        () => unrelated.cleanup(),
      ],
    )
  })
}

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
          expect(() => createCollection(forCreate())).toThrow(
            LocalStorageCollectionError,
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
 * driver withholds peer events until after each same-tab checkpoint. Local and
 * peer publication are checked at clear return, settlement and late delivery. */
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
      expect(publicRows(peer), 'peer clear without event').toEqual([])
      host.deliver('shared')
      expect(publicRows(peer)).toEqual([])
      await collection.insert({ id: 'new', value: 2 }).isPersisted.promise
      const expected = [{ id: 'new', value: 2 }]
      expect(durableRows(host, 'shared')).toEqual(expected)
      expect(publicRows(collection)).toEqual(expected)
      expect(publicRows(peer), 'peer write without event').toEqual(expected)
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

/** Clear publishes one empty snapshot to each active Collection. The work
 * model counts one Storage read per receiver at the clear-return checkpoint;
 * reading the writer twice gives no additional observation. Public rows in
 * both receivers must be empty before another browser event is delivered. */
it('refreshes each active Collection once when clearing storage', async () => {
  const host = createHost()
  const writer = makeCollection(host, 'shared', 'writer')
  const peer = makeCollection(host, 'shared', 'peer')
  await withHistoryCleanup(
    async () => {
      await Promise.all([writer.preload(), peer.preload()])
      await writer.insert({ id: 'row', value: 1 }).isPersisted.promise
      const getItem = host.storage.getItem
      let reads = 0
      host.storage.getItem = (key) => {
        reads++
        return getItem(key)
      }
      writer.utils.clearStorage()
      expect(reads, 'one read per active receiver').toBe(2)
      expect(publicRows(writer), 'writer at clear return').toEqual([])
      expect(publicRows(peer), 'peer at clear return').toEqual([])
    },
    () => [() => peer.cleanup(), () => writer.cleanup()],
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
 * an old array shape, missing or invalid row fields, and an encoded key that
 * disagrees with `getKey(data)`. The last case is necessary for a delete by
 * public key to remain deleted after fresh restore. */
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
  [
    'null version token',
    JSON.stringify({
      's:invalid': {
        versionKey: null,
        data: { id: 'invalid', value: 1 },
      },
    }),
  ],
  [
    'null row data',
    JSON.stringify({
      's:invalid': { versionKey: 'valid-token', data: null },
    }),
  ],
  [
    'encoded key and row identity disagreement',
    JSON.stringify({
      's:a': { versionKey: 'valid-token', data: { id: 'b', value: 1 } },
    }),
  ],
  [
    'two encoded keys with one decoded identity',
    JSON.stringify({
      'n:1': { versionKey: 'first', data: { id: 1, value: 1 } },
      'n:01': { versionKey: 'second', data: { id: 1, value: 2 } },
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

/** A single unprefixed string key is a supported legacy spelling. Unlike the
 * duplicate decoded-key history, it names one public identity. The driver
 * restores it, authors a later update, then checks a fresh restore after the
 * writer encodes the key in its new whole snapshot. */
it('keeps one legacy unprefixed string key writable and restorable', async () => {
  const host = createHost()
  host.storage.setItem(
    'shared',
    JSON.stringify({
      legacy: { versionKey: 'old', data: { id: 'legacy', value: 1 } },
    }),
  )
  const writer = makeCollection(host, 'shared', 'writer')
  let reopened: ReturnType<typeof makeCollection> | undefined
  await withHistoryCleanup(
    async () => {
      await writer.preload()
      expect(publicRows(writer)).toEqual([{ id: 'legacy', value: 1 }])
      await writer.update('legacy', (draft) => {
        draft.value = 2
      }).isPersisted.promise
      expect(durableRows(host, 'shared')).toEqual([{ id: 'legacy', value: 2 }])
      reopened = makeCollection(host, 'shared', 'reopened')
      await reopened.preload()
      expect(publicRows(reopened)).toEqual([{ id: 'legacy', value: 2 }])
    },
    () => [() => reopened?.cleanup(), () => writer.cleanup()],
  )
})

/** Map key identity uses SameValueZero: numeric NaN is the same key after
 * encoding and decoding, while numeric 1 and string "1" remain distinct.
 * The NaN key is derived from a serializable string, so the row itself can
 * round-trip. The independent model holds those three typed identities. */
it('restores a serializable NaN key alongside distinct number and string keys', async () => {
  const host = createHost()
  type KeyedRow = { id: string; key: number | string; value: number }
  const make = (id: string) =>
    createCollection(
      localStorageCollectionOptions<KeyedRow>({
        id,
        storageKey: 'typed',
        storage: host.storage,
        storageEventApi: host.events,
        getKey: (row) => (row.id === 'nan' ? Number(row.key) : row.key),
      }),
    )
  const writer = make('writer')
  let reopened: typeof writer | undefined
  await withHistoryCleanup(
    async () => {
      await writer.preload()
      const authored: Array<KeyedRow> = [
        { id: 'nan', key: 'NaN', value: 1 },
        { id: 'number', key: 1, value: 2 },
        { id: 'string', key: '1', value: 3 },
      ]
      for (const row of authored) await writer.insert(row).isPersisted.promise
      expect(
        [...writer.values()].map(({ id, key, value }) => ({ id, key, value })),
      ).toEqual(expect.arrayContaining(authored))
      reopened = make('reopened')
      await reopened.preload()
      expect(
        [...reopened.values()].map(({ id, key, value }) => ({
          id,
          key,
          value,
        })),
      ).toEqual(expect.arrayContaining(authored))
      expect([...reopened.values()]).toHaveLength(authored.length)
    },
    () => [() => reopened?.cleanup(), () => writer.cleanup()],
  )
})

/** A fulfilled receipt promises a restorable row. Default JSON cannot
 * round-trip a nonfinite numeric ID in row data, even though its storage key
 * has a stable text encoding. The model rejects that write before changing
 * the durable empty snapshot; finite numeric and string controls remain legal. */
for (const invalid of [NaN, Infinity, -Infinity]) {
  it(`rejects a default-JSON row with nonfinite key data ${String(invalid)}`, async () => {
    const host = createHost()
    const writer = makeCollection(host, 'shared', 'writer')
    await withHistoryCleanup(
      async () => {
        await writer.preload()
        await expect(
          writer.insert({ id: invalid, value: 1 }).isPersisted.promise,
        ).rejects.toThrow()
        expect(host.storage.getItem('shared')).toBeNull()
        expect(publicRows(writer)).toEqual([])
      },
      () => [() => writer.cleanup()],
    )
  })
}

/** An invalid event cannot advance the receiver's remembered durable version.
 * The independent model retains the last valid public row until a later valid
 * whole snapshot is delivered. Here the invalid `null` row and its repair use
 * the same version token. If the bad event advances the mirror despite
 * publishing nothing, the repaired row is invisible at the second event cut. */
it('retains the last valid peer snapshot through a null row and its repair', async () => {
  const host = createHost()
  const collection = makeCollection(host, 'shared', 'receiver')
  await withHistoryCleanup(
    async () => {
      await collection.preload()
      await collection.insert({ id: 'row', value: 1 }).isPersisted.promise
      const old = [{ id: 'row', value: 1 }]
      host.storage.setItem(
        'shared',
        JSON.stringify({
          's:row': { versionKey: 'repaired-version', data: null },
        }),
      )
      host.deliver('shared')
      expect(
        publicRows(collection),
        'invalid event retains public row',
      ).toEqual(old)
      host.storage.setItem(
        'shared',
        JSON.stringify({
          's:row': {
            versionKey: 'repaired-version',
            data: { id: 'row', value: 2 },
          },
        }),
      )
      host.deliver('shared')
      expect(publicRows(collection), 'valid repair event').toEqual([
        { id: 'row', value: 2 },
      ])
    },
    () => [() => collection.cleanup()],
  )
})

/** A rejected persisted restore must not retain a sync transaction or callbacks
 * from its failed sync run. The model predicts no accepted snapshot until a
 * later run restores valid bytes. The adapter seam counts `begin` before the
 * public error checkpoint and after an obsolete manual trigger; public status,
 * unchanged bytes, and restart rows check the observable consequences. */
it('does not retain a failed startup validation run', async () => {
  const host = createHost()
  const bad = JSON.stringify({
    's:bad': { versionKey: 'bad-version', data: { id: 'bad', value: 1 } },
  })
  const good = JSON.stringify({
    's:good': { versionKey: 'good-version', data: { id: 'good', value: 2 } },
  })
  host.storage.setItem('shared', bad)
  const options = localStorageCollectionOptions<Row>({
    id: 'reader',
    storageKey: 'shared',
    storage: host.storage,
    storageEventApi: host.events,
    getKey: (row) => row.id,
    parser: {
      parse: JSON.parse,
      stringify: (value) => {
        if (
          typeof value === 'object' &&
          value !== null &&
          'id' in value &&
          value.id === 'bad'
        ) {
          throw new Error('bad row cannot be serialized')
        }
        return JSON.stringify(value)
      },
    },
  })
  const originalSync = options.sync.sync
  let begins = 0
  options.sync.sync = (params) =>
    originalSync({
      ...params,
      begin: () => {
        begins++
        return params.begin()
      },
    })
  const collection = createCollection(options)
  await withHistoryCleanup(
    async () => {
      await expect(collection.preload()).rejects.toThrow(
        'bad row cannot be serialized',
      )
      expect(collection.status).toBe('error')
      expect(host.storage.getItem('shared')).toBe(bad)
      expect(begins, 'failed restore opens no transaction').toBe(0)
      host.storage.setItem('shared', good)
      const failedRunTrigger = (
        options.sync as typeof options.sync & { manualTrigger?: () => void }
      ).manualTrigger
      failedRunTrigger?.()
      expect(begins, 'obsolete failed callback remains inert').toBe(0)
      await collection.cleanup()
      collection.startSyncImmediate()
      expect(publicRows(collection), 'valid restart restore').toEqual([
        { id: 'good', value: 2 },
      ])
    },
    () => [() => collection.cleanup()],
  )
})

/** The row-shape check must run before an adapter `begin()`, not merely fail
 * later when core extracts the row key. A `null` row is present in the stored
 * envelope but cannot represent a Collection row. The begin counter is the
 * adapter-boundary observation; error status and intact bytes are public. */
it('rejects null stored row data before opening a sync transaction', async () => {
  const host = createHost()
  const raw = JSON.stringify({
    's:row': { versionKey: 'token', data: null },
  })
  host.storage.setItem('shared', raw)
  const options = localStorageCollectionOptions<Row>({
    id: 'reader',
    storageKey: 'shared',
    storage: host.storage,
    storageEventApi: host.events,
    getKey: (row) => row.id,
  })
  const originalSync = options.sync.sync
  let begins = 0
  options.sync.sync = (params) =>
    originalSync({
      ...params,
      begin: () => {
        begins++
        return params.begin()
      },
    })
  const collection = createCollection(options)
  await withHistoryCleanup(
    async () => {
      await expect(collection.preload()).rejects.toThrow()
      expect(collection.status).toBe('error')
      expect(host.storage.getItem('shared')).toBe(raw)
      expect(begins, 'malformed restore opens no transaction').toBe(0)
    },
    () => [() => collection.cleanup()],
  )
})

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
      expect(publicRows(local), 'pending local intent overlays peer').toEqual([
        { id: 'same', value: 1 },
      ])
      host.deliver('shared')
      expect(publicRows(local)).toEqual([{ id: 'same', value: 1 }])
      gate.resolve()
      await outcome
      expect(durableRows(host, 'shared')).toEqual([{ id: 'same', value: 1 }])
      expect(publicRows(local)).toEqual([{ id: 'same', value: 1 }])
      expect(publicRows(peer), 'peer same-key receipt without event').toEqual([
        { id: 'same', value: 1 },
      ])
      host.deliver('shared')
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

/** Once setItem accepts a valid snapshot, a later transient Storage read
 * cannot turn that durable write into a rejected receipt. The driver faults
 * only the postwrite readback of a custom-parser writer; the independent fold
 * has the accepted row at the receipt in durable bytes, writer, peer, and a
 * fresh restore. A prewrite fault is covered by the neighboring history. */
it('settles an accepted custom-parser write through a postwrite read fault', async () => {
  const host = createHost()
  const getItem = host.storage.getItem
  let reads = 0
  let faultOnRead = 0
  const readError = new Error('postwrite read fault')
  host.storage.getItem = (key) => {
    reads++
    if (reads === faultOnRead) throw readError
    return getItem(key)
  }
  const writer = createCollection(
    localStorageCollectionOptions<Row>({
      id: 'writer',
      storageKey: 'shared',
      storage: host.storage,
      storageEventApi: host.events,
      getKey: (row) => row.id,
      parser: { parse: JSON.parse, stringify: JSON.stringify },
    }),
  )
  const peer = makeCollection(host, 'shared', 'peer')
  let reopened: ReturnType<typeof makeCollection> | undefined
  await withHistoryCleanup(
    async () => {
      await Promise.all([writer.preload(), peer.preload()])
      faultOnRead = reads + 2
      await writer.insert({ id: 'saved', value: 1 }).isPersisted.promise
      const expected = [{ id: 'saved', value: 1 }]
      expect(durableRows(host, 'shared'), 'durable receipt').toEqual(expected)
      expect(publicRows(writer), 'writer receipt').toEqual(expected)
      expect(publicRows(peer), 'peer receipt').toEqual(expected)
      reopened = makeCollection(host, 'shared', 'reopened')
      await reopened.preload()
      expect(publicRows(reopened), 'fresh restore').toEqual(expected)
    },
    () => [
      () => reopened?.cleanup(),
      () => peer.cleanup(),
      () => writer.cleanup(),
    ],
  )
})
