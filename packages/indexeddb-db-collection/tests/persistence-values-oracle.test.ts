// @vitest-environment node
/**
 * Rich-value receiving companion to persistence-oracle.test.ts. The authored
 * value model and its limits live in structured-clone-oracle.ts. Each finite
 * history preserves one untouched nested field through a scalar update, peer
 * read, export/import replacement and fresh descriptor restore. Atomic rejection
 * crosses insert/import and first/middle/last uncloneable nested values.
 *
 * The driver uses real Collection APIs and fake-IDB, with controlled delivery.
 * Every checkpoint compares public, peer, export and raw durable values, plus
 * version records after rejection. Native receiving lives in e2e/value-oracle.spec.ts.
 */
import { createCollection } from '@tanstack/db'
import { expect, it } from 'vitest'
import { createIndexedDB, indexedDBCollectionOptions } from '../src'
import { Channel, readStore, withHarness } from './harness'
import {
  createValue,
  expectedValueRows,
  observeValueRows,
  valueKinds,
} from './structured-clone-oracle'
import type { ValueRow } from './structured-clone-oracle'

for (const kind of valueKinds) {
  it(`preserves ${kind} through updates, peers, export/import and restore`, async () => {
    await withHarness(async (h) => {
      const descriptors = [h.db, await h.connect()]
      const make = (db: typeof h.db) => {
        const collection = createCollection(
          indexedDBCollectionOptions<ValueRow>({
            db,
            name: 'items',
            getKey: (row) => row.id,
          }),
        )
        h.disposers.push(() => collection.cleanup())
        return collection
      }
      const writer = make(descriptors[0]!)
      const peer = make(descriptors[1]!)
      await Promise.all([writer.preload(), peer.preload()])
      let expected = expectedValueRows(kind, 'initial')
      async function checkpoint(cut: string) {
        await Channel.deliver()
        expect(writer.status, cut).toBe('ready')
        expect(peer.status, cut).toBe('ready')
        for (const [path, rows] of [
          ['writer', [...writer.values()]],
          ['peer', [...peer.values()]],
          ['export', await writer.utils.exportData()],
          ['raw', (await readStore<ValueRow>(h.db, 'items')).rows],
        ] as const)
          expect(await observeValueRows(rows), cut + ': ' + path).toEqual(
            expected,
          )
      }
      await writer.insert({
        id: 1,
        name: 'initial',
        nested: { value: createValue(kind) },
      }).isPersisted.promise
      await checkpoint('insert')
      await writer.update(1, (draft) => {
        draft.name = 'updated'
      }).isPersisted.promise
      expected = expectedValueRows(kind, 'updated')
      await checkpoint('unrelated update')
      const exported = await writer.utils.exportData()
      await writer.utils.clearObjectStore()
      expected = []
      await checkpoint('clear')
      await writer.utils.importData(exported)
      expected = expectedValueRows(kind, 'updated')
      await checkpoint('restore exported values')
      // A valid prefix and suffix surround each clone failure. Neither native
      // rows nor metadata may retain a prefix, including replacement deletion.
      for (const entry of ['insert', 'import'] as const) {
        for (const badIndex of [0, 1, 2]) {
          const before = await readStore(h.db, '_versions')
          const batch = [2, 3, 4].map((id, index) => ({
            id,
            name: 'rejected',
            nested: {
              value: index === badIndex ? () => undefined : createValue(kind),
            },
          }))
          const outcome =
            entry === 'insert'
              ? writer.insert(batch).isPersisted.promise
              : writer.utils.importData(batch)
          await expect(outcome).rejects.toBeDefined()
          await checkpoint(`${entry} rejection at ${badIndex}`)
          expect(
            await readStore(h.db, '_versions'),
            'rejected batch preserves metadata',
          ).toEqual(before)
        }
      }
      await writer.update(1, (draft) => {
        draft.name = 'suffix'
      }).isPersisted.promise
      expected = expectedValueRows(kind, 'suffix')
      await checkpoint('successful suffix')
      const freshDb = await createIndexedDB({
        name: h.db.name,
        version: 1,
        stores: ['items', 'other'],
      })
      h.descriptors.push(freshDb)
      const restored = make(freshDb)
      await restored.preload()
      expect(
        await observeValueRows(restored.values()),
        'fresh descriptor restore',
      ).toEqual(expected)
    })
  })
}

// Calibrate the value observation independently of storage. These wrong answers
// preserve superficial contents while losing exactly the type/offset/byte law.
it('rejects flattened values, lost offsets, corrupt bytes and absent rows', async () => {
  const row = (value: unknown) => [
    { id: 1, name: 'initial', nested: { value } },
  ]
  for (const kind of valueKinds) {
    expect(await observeValueRows(row(createValue(kind)))).toEqual(
      expectedValueRows(kind, 'initial'),
    )
    expect(await observeValueRows(row({}))).not.toEqual(
      expectedValueRows(kind, 'initial'),
    )
  }
  expect(await observeValueRows(row(new Uint8Array([17, 0, 255])))).not.toEqual(
    expectedValueRows('uint8', 'initial'),
  )
  expect(
    await observeValueRows(row(new Uint8Array([3, 17, 1, 255, 8]).buffer)),
  ).not.toEqual(expectedValueRows('buffer', 'initial'))
  expect(await observeValueRows([])).not.toEqual(
    expectedValueRows('date', 'initial'),
  )
})
