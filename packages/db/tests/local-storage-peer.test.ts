// Ordinary regression tests for LocalStorage same-tab peers, typed keys, and
// adapter construction. Each test runs one fixed scenario and compares with
// hand-written rows, reads, or Storage bytes. The peer convergence law has no
// oracle owner yet (TanStack/db#2264); its fixed histories are in
// local-storage-peer-history.test.ts.
import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index'
import { LocalStorageCollectionError } from '../src/errors'
import { localStorageCollectionOptions } from '../src/local-storage'
import { createTransaction } from '../src/transactions'
import { withHistoryCleanup } from './optimistic-history-oracle'
import { createHost, makeCollection } from './local-storage-peer-fixtures'
import type { Row } from './local-storage-peer-fixtures'

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

/** A disjoint peer write is not a restore of this Collection. The default-JSON
 * writer keeps the Date it authored until its own persisted restore, while it
 * still receives the peer's newly accepted row. The independent model tracks
 * authored native values per Collection and the JSON form in durable bytes;
 * the driver compares both active snapshots at the peer receipt and a fresh
 * restore. This crosses native-value retention with same-tab publication. */
it('keeps a native authored Date through a disjoint peer write', async () => {
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
  const first = make('first')
  const second = make('second')
  let reopened: typeof first | undefined
  await withHistoryCleanup(
    async () => {
      await Promise.all([first.preload(), second.preload()])
      const at = new Date('2020-01-02T03:04:05.000Z')
      await first.insert({ id: 'first-row', at }).isPersisted.promise
      await second.insert({ id: 'second-row', at: 'later' }).isPersisted.promise
      const durable = JSON.parse(host.storage.getItem('dated')!) as Record<
        string,
        { data: DatedRow }
      >
      expect(Object.values(durable).map(({ data }) => data)).toEqual(
        expect.arrayContaining([
          { id: 'first-row', at: at.toISOString() },
          { id: 'second-row', at: 'later' },
        ]),
      )
      expect(
        [...first.values()].map(({ id, at: value }) => ({ id, at: value })),
      ).toEqual(
        expect.arrayContaining([
          { id: 'first-row', at },
          { id: 'second-row', at: 'later' },
        ]),
      )
      expect(
        [...second.values()].map(({ id, at: value }) => ({ id, at: value })),
      ).toEqual(
        expect.arrayContaining([
          { id: 'first-row', at: at.toISOString() },
          { id: 'second-row', at: 'later' },
        ]),
      )
      reopened = make('reopened')
      await reopened.preload()
      expect(
        [...reopened.values()].map(({ id, at: value }) => ({ id, at: value })),
      ).toEqual(
        expect.arrayContaining([
          { id: 'first-row', at: at.toISOString() },
          { id: 'second-row', at: 'later' },
        ]),
      )

      // A peer's actual same-key edit has a new version and must replace the
      // retained native value in the first Collection.
      await second.update('first-row', (draft) => {
        draft.at = 'changed'
      }).isPersisted.promise
      expect(
        [...first.values()].find(({ id }) => id === 'first-row'),
      ).toMatchObject({ at: 'changed' })
      expect(
        [...reopened.values()].find(({ id }) => id === 'first-row'),
      ).toMatchObject({ at: 'changed' })
    },
    () => [
      () => reopened?.cleanup(),
      () => second.cleanup(),
      () => first.cleanup(),
    ],
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
