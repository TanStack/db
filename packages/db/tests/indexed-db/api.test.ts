import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ObjectStoreNotFoundError,
  createCollection,
  createIndexedDB,
  deleteDatabase,
  indexedDBCollectionOptions,
  openDatabase } from '../../src'
import { withHarness } from './harness'
import type { IndexedDBCollectionConfig } from '../../src'
import type { Row } from './harness'

// Fixed examples suffice for synchronous configuration validation; there is no
// interacting history to model. The API errors, immutable database descriptor,
// schema validation and IDs are independent of the persistence history model.
it('validates store declarations and exposes an immutable shared descriptor', async () => {
  for (const stores of [[], ['a', 'a'], ['']]) {
    await expect(
      createIndexedDB({ name: crypto.randomUUID(), version: 1, stores }),
    ).rejects.toThrow()
  }
  await withHarness(async (h) => {
    expect(Object.isFrozen(h.db)).toBe(true)
    expect(Object.isFrozen(h.db.stores)).toBe(true)
    const collection = await h.open()
    expect(await collection.utils.getDatabaseInfo()).toMatchObject({
      name: h.db.name,
      version: 1,
      objectStores: ['_versions', 'items', 'other'],
    })
    expect(collection.id).toBe('indexed-db-collection:' + h.db.name + ':items')
    expect(h.make('items', { id: 'custom' }).id).toBe('custom')
  })
})

it('rejects missing required configuration synchronously', async () => {
  await withHarness((h) => {
    const config = { db: h.db, name: 'items', getKey: (row: Row) => row.id }
    for (const field of ['db', 'name', 'getKey'] as const) {
      const invalid = {
        ...config,
        [field]: undefined,
      } as unknown as IndexedDBCollectionConfig<Row>
      expect(() => indexedDBCollectionOptions(invalid)).toThrow()
    }
    expect(() =>
      indexedDBCollectionOptions({ ...config, name: 'absent' }),
    ).toThrow(/not found/)
  })
})

it('validates schema inputs before persistence', async () => {
  await withHarness(async (h) => {
    const collection = createCollection(
      indexedDBCollectionOptions({
        db: h.db,
        name: 'items',
        schema: z.object({ id: z.number(), name: z.string().min(1) }),
        getKey: (row) => row.id,
      }),
    )
    try {
      await collection.preload()
      expect(() => collection.insert({ id: 1, name: '' })).toThrow()
      await collection.insert({ id: 1, name: 'valid' }).isPersisted.promise
      expect(await collection.utils.exportData()).toEqual([
        { id: 1, name: 'valid' },
      ])
    } finally {
      await collection.cleanup()
    }
  })
})

it('supports local persistence when BroadcastChannel is unavailable', async () => {
  await withHarness(async (h) => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const collection = await h.open()
    await collection.insert({ id: 1, name: 'local' }).isPersisted.promise
    expect(await collection.utils.exportData()).toEqual([
      { id: 1, name: 'local' },
    ])
  })
})

it('rejects opening without IndexedDB', async () => {
  vi.stubGlobal('indexedDB', undefined)
  try {
    await expect(
      createIndexedDB({ name: 'missing', version: 1, stores: ['items'] }),
    ).rejects.toThrow(/not available/)
  } finally {
    vi.unstubAllGlobals()
  }
})

it('exposes deletion only as an administrative function', async () => {
  await withHarness(async (h) => {
    const collection = await h.open()
    await collection.insert({ id: 1, name: 'removed' }).isPersisted.promise
    expect(collection.utils).not.toHaveProperty('deleteDatabase')
    await deleteDatabase(h.db.name)
    const reopened = await createIndexedDB({
      name: h.db.name,
      version: 1,
      stores: ['items'],
    })
    try {
      const restored = createCollection(
        indexedDBCollectionOptions<Row>({
          db: reopened,
          name: 'items',
          getKey: (row) => row.id,
        }),
      )
      try {
        await restored.preload()
        expect(restored.size).toBe(0)
      } finally {
        await restored.cleanup()
      }
    } finally {
      reopened.close()
    }
  })
})

it('validates and transforms imported schema inputs before replacing data', async () => {
  await withHarness(async (h) => {
    const collection = createCollection(
      indexedDBCollectionOptions({
        db: h.db,
        name: 'items',
        schema: z.object({
          id: z.number(),
          name: z.string().min(1).default('default'),
        }),
        getKey: (row) => row.id,
      }),
    )
    try {
      await collection.preload()
      await collection.utils.importData([{ id: 1 }])
      expect(await collection.utils.exportData()).toEqual([
        { id: 1, name: 'default' },
      ])
      await expect(
        collection.utils.importData([{ id: 2, name: '' }]),
      ).rejects.toThrow()
      expect(await collection.utils.exportData()).toEqual([
        { id: 1, name: 'default' },
      ])
    } finally {
      await collection.cleanup()
    }
  })
})

it('rejects duplicate imported keys before replacing the existing snapshot', async () => {
  await withHarness(async (h) => {
    const collection = await h.open()
    const original = [{ id: 1, name: 'retained' }]
    await collection.utils.importData(original)
    await expect(
      collection.utils.importData([
        { id: 2, name: 'a' },
        { id: 2, name: 'b' },
      ]),
    ).rejects.toThrow()
    expect(await collection.utils.exportData()).toEqual(original)
  })
})

it('reserves the version store for adapter metadata', async () => {
  const outcome = await createIndexedDB({
    name: crypto.randomUUID(),
    version: 1,
    stores: ['_versions'],
  }).then(
    (db) => {
      db.close()
      return 'accepted'
    },
    () => 'rejected',
  )
  expect(outcome).toBe('rejected')
  await withHarness((h) => {
    expect(() =>
      indexedDBCollectionOptions<Row>({
        db: h.db,
        name: '_versions',
        getKey: (row) => row.id,
      }),
    ).toThrow()
  })
})

// A native database can predate this adapter. Reopening at the same version
// does not run upgrade callbacks, so admission must validate metadata as well
// as the requested store before any Collection can claim to persist writes.
it('rejects a database without its required metadata store before startup', async () => {
  const name = crypto.randomUUID()
  const raw = await openDatabase(name, 1, (db) => {
    db.createObjectStore('items')
  })
  raw.close()
  const db = await createIndexedDB({ name, version: 1, stores: ['items'] })
  try {
    expect(() =>
      indexedDBCollectionOptions<Row>({
        db,
        name: 'items',
        getKey: (row) => row.id,
      }),
    ).toThrow(ObjectStoreNotFoundError)
  } finally {
    db.close()
  }
})

it('labels storage estimates as origin-wide usage even for an empty database', async () => {
  await withHarness(async (h) => {
    vi.stubGlobal('navigator', {
      storage: { estimate: () => Promise.resolve({ usage: 987654321 }) },
    })
    const c = await h.open()
    expect(await c.utils.exportData()).toEqual([])
    expect((await c.utils.getDatabaseInfo()).estimatedSize).toBe(987654321)
  })
})

// Import's existing authority is schema input validation. Output from an
// arbitrary transform need not inhabit that input domain. The invalid attempt
// must preserve the backup; explicit inverse conversion can round trip it.
it('preserves exported transformed rows when invalid restore input is rejected', async () => {
  await withHarness(async (h) => {
    const schema = z.object({
      id: z.number(),
      date: z.string().transform((value) => new Date(value)),
    })
    const c = createCollection(
      indexedDBCollectionOptions({
        db: h.db,
        name: 'items',
        schema,
        getKey: (row) => row.id,
      }),
    )
    try {
      await c.preload()
      await c.insert({ id: 1, date: '2026-01-01T00:00:00.000Z' }).isPersisted
        .promise
      const backup = await c.utils.exportData()
      // @ts-expect-error Schema output is not the string input expected by import.
      await expect(c.utils.importData(backup)).rejects.toThrow(
        /Expected string/,
      )
      expect(await c.utils.exportData()).toEqual(backup)
      await c.utils.importData(
        backup.map((row) => ({ id: row.id, date: row.date.toISOString() })),
      )
      expect(await c.utils.exportData()).toEqual(backup)
    } finally {
      await c.cleanup()
    }
  })
})
