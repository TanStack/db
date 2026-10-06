/**
 * Compatibility boundary oracle.
 *
 * Authority: safeRandomUUID's supported capability domain, the first-party
 * DbClient materialization contract, and createIndexedDB's custom-factory API.
 * Supported environments must preserve the same authored rows and typed keys.
 * Every DbClient owns an independent Collection sync run. A custom factory
 * must not require IndexedDB globals from a different provider.
 *
 * The model is an authored array per object store. It does not reproduce UUID
 * generation, adapter caches, or cursor filtering. The finite grammar varies
 * crypto capability, which client ends its sync run, and global IDBKeyRange
 * availability. Public reads and native durable reads must equal the model
 * after persistence, explicit notification delivery, replacement, or fresh restore.
 * Untouched stores must retain their version entries across replacements.
 *
 * harness.ts supplies real Collection entry points, raw IDB observations and
 * controlled message delivery. These tests establish compatibility with the
 * controlled capabilities and fake-IDB provider, not native browser failure
 * ordering, crash durability, or server-side availability of IndexedDB.
 */
import {
  DbClient,
  collectionOptions,
  createCollection,
  createTransaction,
} from '@tanstack/db'
import { IDBFactory } from 'fake-indexeddb'
import { expect, it, vi } from 'vitest'
import { createIndexedDB, indexedDBCollectionOptions } from '../src'
import { Channel, assertRows, readStore, seed, withHarness } from './harness'
import { holdStore, observeTransactions } from './idb-driver'
import type { IndexedDBInstance } from '../src'
import type { Row } from './harness'

for (const capability of ['randomUUID', 'getRandomValues'] as const) {
  it('persists and broadcasts with ' + capability + ' available', async () => {
    await withHarness(async (h) => {
      if (capability === 'getRandomValues') {
        const getRandomValues = crypto.getRandomValues.bind(crypto)
        vi.stubGlobal('crypto', { getRandomValues })
      }
      // Construction, row persistence and notification each allocate identity.
      // Reaching all three prevents a constructor-only compatibility repair.
      const writer = await h.open()
      const peer = await h.open()
      const expected: Array<Row> = [
        { id: 0, name: 'number' },
        { id: '1', name: 'string' },
      ]
      await writer.insert(expected).isPersisted.promise
      expect(Channel.sent, 'one completed write notification').toHaveLength(1)
      expect(await Channel.deliver(), 'receiver path reached').toBe(1)
      assertRows(writer.values(), expected, 'writer after persistence')
      assertRows(peer.values(), expected, 'peer after notification delivery')
      assertRows(
        (await readStore<Row>(h.db, 'items')).rows,
        expected,
        'raw durable rows',
      )
      assertRows((await h.open()).values(), expected, 'fresh restore')
    })
  })
}

for (const retired of ['first', 'second'] as const) {
  it(
    'keeps descriptor clients independent after ' + retired + ' cleanup',
    async () => {
      await withHarness(async (h) => {
        const descriptor = collectionOptions(
          indexedDBCollectionOptions<Row>({
            db: h.db,
            name: 'items',
            getKey: (row) => row.id,
          }),
        )
        const first = new DbClient().collection(descriptor)
        h.collections.push(first)
        const second = new DbClient().collection(descriptor)
        h.collections.push(second)
        expect(first, 'each client owns its Collection').not.toBe(second)
        await first.preload()
        await second.preload()
        const expected: Array<Row> = [{ id: 1, name: 'before cleanup' }]
        await first.insert(expected[0]!).isPersisted.promise
        expect(
          await Channel.deliver(),
          'second client receives first write',
        ).toBe(1)
        assertRows(first.values(), expected, 'first client')
        assertRows(second.values(), expected, 'second client')

        const disposed = retired === 'first' ? first : second
        const survivor = retired === 'first' ? second : first
        await disposed.cleanup()
        expect(disposed.status).toBe('cleaned-up')
        expect(survivor.status).toBe('ready')
        expect(
          Channel.peers.size,
          'only the retired sync run releases its channel',
        ).toBe(1)
        const added: Row = { id: '1', name: 'after cleanup' }
        await survivor.insert(added).isPersisted.promise
        expected.push(added)
        assertRows(survivor.values(), expected, 'survivor write')
        assertRows(
          (await readStore<Row>(h.db, 'items')).rows,
          expected,
          'survivor durable rows',
        )
        const restored = new DbClient().collection(descriptor)
        h.collections.push(restored)
        await restored.preload()
        assertRows(restored.values(), expected, 'third client restore')
        const suffix: Row = { id: 2, name: 'new peer' }
        await survivor.insert(suffix).isPersisted.promise
        expected.push(suffix)
        expect(
          await Channel.deliver(),
          'surviving channel delivers to new peer',
        ).toBe(1)
        assertRows(restored.values(), expected, 'new peer after notification')
      })
    },
  )
}

// Typed keys and object-store names define independent ownership. Replacement
// changes only the named store; no numeric/string identity may be collapsed.
async function expectDurableStores(
  db: IndexedDBInstance,
  expected: ReadonlyMap<string, Array<Row>>,
): Promise<void> {
  for (const [name, rows] of expected) {
    assertRows(
      (await readStore<Row>(db, name)).rows,
      rows,
      name + ': durable snapshot',
    )
  }
  const versions = await readStore(db, '_versions')
  const expectedKeys = [...expected].flatMap(([name, rows]) =>
    rows.map((row) => [name, row.id]),
  )
  const keyOrder = (a: unknown, b: unknown) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  expect(versions.keys.sort(keyOrder), 'version ownership').toEqual(
    expectedKeys.sort(keyOrder),
  )
}

for (const globalKeyRange of [true, false]) {
  it(
    'uses a custom factory with global IDBKeyRange ' + globalKeyRange,
    async () => {
      await withHarness(async (h) => {
        const name = crypto.randomUUID()
        const factory = new IDBFactory()
        vi.stubGlobal('indexedDB', undefined)
        if (!globalKeyRange) vi.stubGlobal('IDBKeyRange', undefined)
        const stores = ['items', 'items-extra', 'other']
        const db = await createIndexedDB({
          name,
          version: 1,
          stores,
          idbFactory: factory,
        })
        try {
          const expected = new Map<string, Array<Row>>(
            stores.map((store) => [
              store,
              [
                { id: 0, name: store + ':number' },
                { id: '0', name: store + ':string' },
              ],
            ]),
          )
          const collections = new Map<
            string,
            Awaited<ReturnType<typeof h.open>>
          >()
          for (const store of stores) {
            await seed(db, store, expected.get(store)!)
            const collection = await h.open(store, { db })
            collections.set(store, collection)
            assertRows(
              collection.values(),
              expected.get(store)!,
              store + ': startup',
            )
          }
          await expectDurableStores(db, expected)

          for (const store of stores) {
            const beforeVersions = await readStore(db, '_versions')
            const replacement: Array<Row> = [
              { id: 1, name: store + ':replacement number' },
              { id: '1', name: store + ':replacement string' },
            ]
            await collections.get(store)!.utils.importData(replacement)
            expected.set(store, replacement)
            await Channel.deliver()
            await expectDurableStores(db, expected)
            // Compare untouched version records, not only their membership.
            const afterVersions = await readStore(db, '_versions')
            for (const [index, key] of beforeVersions.keys.entries()) {
              if (Array.isArray(key) && key[0] !== store) {
                const next = afterVersions.keys.findIndex(
                  (candidate) =>
                    JSON.stringify(candidate) === JSON.stringify(key),
                )
                expect(
                  next,
                  'untouched version entry survives',
                ).toBeGreaterThanOrEqual(0)
                expect(
                  afterVersions.rows[next],
                  'untouched version value',
                ).toEqual(beforeVersions.rows[index])
              }
            }
            await collections.get(store)!.utils.clearObjectStore()
            expected.set(store, [])
            await Channel.deliver()
            await expectDurableStores(db, expected)
            for (const [storeName, collection] of collections)
              assertRows(
                collection.values(),
                expected.get(storeName)!,
                storeName + ': after clear',
              )
          }
        } finally {
          db.close()
        }
      })
    },
  )
}

it('distinguishes requested stores from existing stores at an unchanged version', async () => {
  await withHarness(async (h) => {
    const requested = ['items', 'other', 'not-created']
    const descriptor = await createIndexedDB({
      name: h.db.name,
      version: 1,
      stores: requested,
    })
    try {
      expect(descriptor.stores, 'requested declarations').toEqual(requested)
      const collection = await h.open('items', { db: descriptor })
      expect((await collection.utils.getDatabaseInfo()).objectStores).toEqual([
        '_versions',
        'items',
        'other',
      ])
      expect(() => h.make('not-created', { db: descriptor })).toThrow(
        /not found/,
      )
    } finally {
      descriptor.close()
    }
  })
})

// Collection identity is an object capability, not the user-controlled display
// id captured by an options builder. Rename the id at either construction cut,
// then observe automatic/manual persistence and a successful cleanup suffix.
for (const idLocation of ['options', 'collection'] as const) {
  for (const entry of ['automatic', 'manual', 'after-cleanup'] as const) {
    it(`persists its own mutations with an id set on ${idLocation} through ${entry}`, async () => {
      await withHarness(async (h) => {
        const options = indexedDBCollectionOptions<Row>({
          db: h.db,
          name: 'items',
          getKey: (row) => row.id,
          ...(idLocation === 'options' ? { id: 'custom' } : {}),
        })
        const c = createCollection({ ...options, id: 'custom' })
        h.collections.push(c)
        await c.preload()
        const expected = [{ id: 1, name: 'owned' }]
        if (entry === 'automatic')
          await c.insert(expected[0]!).isPersisted.promise
        else {
          const tx = createTransaction({
            autoCommit: false,
            mutationFn: async ({ transaction }) => {
              await c.utils.acceptMutations(transaction)
            },
          })
          tx.mutate(() => c.insert(expected[0]!))
          if (entry === 'after-cleanup') await c.cleanup()
          await tx.commit()
        }
        assertRows(
          (await readStore<Row>(h.db, 'items')).rows,
          expected,
          'renamed owner durable',
        )
        assertRows(
          (await h.open()).values(),
          expected,
          'renamed owner fresh restore',
        )
      })
    })
  }
}

// Ownership is the Collection object even when IDs collide. Distinct keys keep
// core's same-ID/same-key payload merging outside this adapter boundary. Every
// acceptance must project the mixed payload onto exactly one owner, whether its
// sync run is active or cleaned up. The other store and its versions are anchors.
for (const sharedId of [false, true]) {
  for (const cleanedUp of [false, true]) {
    for (const order of [
      [0, 1],
      [1, 0],
    ]) {
      it(`partitions owners with shared id ${sharedId}, cleanup ${cleanedUp}, order ${order}`, async () => {
        await withHarness(async (h) => {
          const names = ['items', 'other']
          const rows = [
            { id: 1, name: 'first' },
            { id: 2, name: 'second' },
          ]
          const collections = await Promise.all(
            names.map((name, index) =>
              h.open(name, { id: sharedId ? 'shared' : `owner-${index}` }),
            ),
          )
          const expected = new Map<string, Array<Row>>(
            names.map((name) => [name, []]),
          )
          const tx = createTransaction({
            autoCommit: false,
            mutationFn: async ({ transaction }) => {
              expect(
                transaction.mutations.map((mutation) => mutation.collection),
              ).toEqual(collections)
              for (const index of order) {
                await collections[index]!.utils.acceptMutations(transaction)
                expected.set(names[index]!, [rows[index]!])
                await expectDurableStores(h.db, expected)
                for (const name of names) {
                  const fresh = await h.open(name)
                  assertRows(
                    fresh.values(),
                    expected.get(name)!,
                    'owner projection restore',
                  )
                  await fresh.cleanup()
                }
              }
            },
          })
          const outcome = tx.isPersisted.promise.catch(
            (error: unknown) => error,
          )
          tx.mutate(() =>
            collections.forEach((collection, index) =>
              collection.insert(rows[index]!),
            ),
          )
          if (cleanedUp)
            await Promise.all(
              collections.map((collection) => collection.cleanup()),
            )
          await tx.commit()
          await outcome
          await Channel.deliver()
          if (!cleanedUp)
            collections.forEach((collection, index) =>
              assertRows(
                collection.values(),
                [rows[index]!],
                'owner projection public',
              ),
            )
        })
      })
    }
  }
}

// Renaming a legal database/store does not change row ownership. The same
// authored history runs under each substitution; typed keys, prefix neighbors
// and untouched version values distinguish routing from accidental aliasing.
// Empty and reserved store names remain outside this grammar (api.test.ts).
const legalNames = [
  'items',
  'constructor',
  '__proto__',
  'toString',
  '雪/é',
  'a:b[0]',
]
for (const name of legalNames) {
  it(`preserves store isolation under legal name ${name}`, async () => {
    await withHarness(async (h) => {
      const stores = [name, name + '-neighbor', 'anchor']
      const db = await createIndexedDB({
        name,
        version: 1,
        stores,
        idbFactory: new IDBFactory(),
      })
      h.descriptors.push(db)
      const peerDb = await createIndexedDB({
        name,
        version: 1,
        stores,
        idbFactory: db.idbFactory,
      })
      h.descriptors.push(peerDb)
      const writers = await Promise.all(
        stores.map((store) => h.open(store, { db })),
      )
      const peers = await Promise.all(
        stores.map((store) => h.open(store, { db: peerDb })),
      )
      const expected = new Map<string, Array<Row>>(
        stores.map((store) => [store, []]),
      )
      async function checkpoint() {
        await Channel.deliver()
        await expectDurableStores(db, expected)
        for (const [index, store] of stores.entries()) {
          assertRows(
            writers[index]!.values(),
            expected.get(store)!,
            'renamed writer',
          )
          assertRows(
            peers[index]!.values(),
            expected.get(store)!,
            'renamed peer',
          )
          const restored = await h.open(store, { db: peerDb })
          assertRows(restored.values(), expected.get(store)!, 'renamed restore')
          await restored.cleanup()
        }
      }
      for (const [index, store] of stores.entries()) {
        const rows = [
          { id: 0, name: store },
          { id: '0', name: store + ':string' },
        ]
        // Separate transactions isolate name routing from the already tracked
        // core same-transaction numeric/string key collision (HC005).
        for (const row of rows)
          await writers[index]!.insert({ ...row }).isPersisted.promise
        expected.set(store, rows)
      }
      await checkpoint()
      const versions = await readStore(db, '_versions')
      await writers[0]!.update(0, (draft) => {
        draft.name = 'changed'
      }).isPersisted.promise
      expected.set(name, [
        { id: 0, name: 'changed' },
        { id: '0', name: name + ':string' },
      ])
      await checkpoint()
      await writers[0]!.utils.importData([{ id: 2, name: 'replacement' }])
      expected.set(name, [{ id: 2, name: 'replacement' }])
      await checkpoint()
      await writers[0]!.utils.clearObjectStore()
      expected.set(name, [])
      await checkpoint()
      const remaining = await readStore(db, '_versions')
      for (const [index, key] of versions.keys.entries()) {
        if (Array.isArray(key) && key[0] !== name) {
          const next = remaining.keys.findIndex(
            (candidate) => JSON.stringify(candidate) === JSON.stringify(key),
          )
          expect(next, 'neighbor metadata survives').toBeGreaterThanOrEqual(0)
          expect(
            remaining.rows[next],
            'neighbor metadata is unchanged',
          ).toEqual(versions.rows[index])
        }
      }
    })
  })
}

// First-open grammar: two/three calls, same absent name or independent absent
// names, identical complete schema. The harness's own database is irrelevant:
// a fresh injected factory proves none of these target names exists beforehand.
// Raw open admission is recorded before any promise settles. A native storage
// blocker then distinguishes restore admission from Collection readiness.
for (const count of [2, 3]) {
  for (const sharedName of [true, false]) {
    it(`initializes ${count} concurrent first opens with shared name ${sharedName}`, async () => {
      await withHarness(async (h) => {
        const factory = new IDBFactory()
        const stores = ['items', 'other']
        const upgrades: Array<number> = []
        const open = factory.open.bind(factory)
        let admitted = 0,
          settled = 0,
          blocked = 0
        vi.spyOn(factory, 'open').mockImplementation((...args) => {
          admitted++
          const request = open(...args)
          request.addEventListener('upgradeneeded', (event) =>
            upgrades.push(event.oldVersion),
          )
          request.addEventListener('blocked', () => {
            blocked++
          })
          return request
        })
        const pending = Array.from({ length: count }, (_, index) =>
          createIndexedDB({
            name: sharedName ? 'first' : `first-${index}`,
            version: 1,
            stores,
            idbFactory: factory,
          }).then((db) => {
            settled++
            h.descriptors.push(db)
            return db
          }),
        )
        expect(admitted, 'all native opens admitted before awaiting').toBe(
          count,
        )
        expect(settled, 'no open settled during admission').toBe(0)
        const descriptors = await Promise.all(pending)
        expect(upgrades, 'only absent names initialize').toEqual(
          Array(sharedName ? 1 : count).fill(0),
        )
        for (const db of descriptors)
          expect([...db.db.objectStoreNames]).toEqual([
            '_versions',
            'items',
            'other',
          ])
        const unique = sharedName ? descriptors.slice(0, 1) : descriptors
        const gates = unique.map((db) => holdStore(db.db))
        for (const gate of gates) h.disposers.push(() => gate.release())
        await Promise.all(gates.map((gate) => gate.started))
        const observations = descriptors.map((db) => observeTransactions(db.db))
        const collections = descriptors.map((db) => h.make('items', { db }))
        const ready = collections.map((collection) => collection.preload())
        await vi.waitFor(() => {
          for (const observation of observations)
            expect(
              observation.entries.some((entry) => entry.mode === 'readonly'),
            ).toBe(true)
        })
        for (const collection of collections)
          expect(collection.status).toBe('loading')
        await Promise.all(gates.map((gate) => gate.release()))
        await Promise.all(ready)
        for (const [index, collection] of collections.entries()) {
          expect(collection.status).toBe('ready')
          expect(
            observations[index]!.entries.some(
              (entry) =>
                entry.mode === 'readonly' && entry.status === 'complete',
            ),
          ).toBe(true)
          observations[index]!.restore()
        }
        const rows = collections.map((_, id) => ({ id, name: `writer-${id}` }))
        await Promise.all(
          collections.map(
            (collection, index) =>
              collection.insert({ ...rows[index]! }).isPersisted.promise,
          ),
        )
        await Channel.deliver()
        for (const [index, collection] of collections.entries()) {
          const expected = sharedName ? rows : [rows[index]!]
          assertRows(collection.values(), expected, 'first-open convergence')
          assertRows(
            (await readStore<Row>(descriptors[index]!, 'items')).rows,
            expected,
            'first-open durable',
          )
          const restored = await h.open('items', { db: descriptors[index]! })
          assertRows(restored.values(), expected, 'first-open restore')
        }
        // A later native upgrade must complete with all managed descriptors
        // still present. A leaked unmanaged initial handle would block it.
        for (const db of unique) {
          const upgraded = await createIndexedDB({
            name: db.name,
            version: 2,
            stores: [...stores, 'added'],
            idbFactory: factory,
          })
          h.descriptors.push(upgraded)
          expect([...upgraded.db.objectStoreNames]).toEqual([
            '_versions',
            'added',
            'items',
            'other',
          ])
        }
        expect(
          blocked,
          'managed initial handles do not orphan an upgrade blocker',
        ).toBe(0)
        for (const collection of collections)
          expect(collection.status).toBe('error')
      })
    })
  }
}
