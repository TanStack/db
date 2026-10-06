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
