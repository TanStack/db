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
import { Channel, deferred, readStore, withHarness } from './harness'
import {
  createValue,
  expectedValueRows,
  observeValueRows,
  valueKinds,
} from './structured-clone-oracle'
import { holdStore } from './idb-driver'
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

// Value capture: update follows core's documented callback-return snapshot;
// import captures validated rows before waiting for storage. Mutating the
// caller's object afterwards cannot rewrite the authored operation. Compare
// independently authored value descriptions at settlement, peer delivery,
// export and raw storage, while handlers/storage deliberately delay native put.
// Blob is immutable; custom classes and mutation of public Collection rows are
// outside this law. The same source reference is intentionally shared with the
// submitted row, never with the expected descriptions.
for (const kind of valueKinds.filter((value) => value !== 'blob')) {
  for (const entry of ['update', 'import'] as const) {
    it(`captures ${kind} before delayed ${entry} persistence`, async () => {
      await withHarness(async (h) => {
        const handler = deferred()
        h.disposers.push(() => handler.resolve())
        const make = (db: typeof h.db) => {
          const c = createCollection(
            indexedDBCollectionOptions<ValueRow>({
              db,
              name: 'items',
              getKey: (row) => row.id,
              onUpdate: () => handler.promise,
            }),
          )
          h.disposers.push(() => c.cleanup())
          return c
        }
        const c = make(h.db)
        const peer = make(await h.connect())
        await Promise.all([c.preload(), peer.preload()])
        await c.insert({ id: 1, name: 'before', nested: { value: null } })
          .isPersisted.promise
        await Channel.deliver()
        const gate = holdStore(h.db.db)
        h.disposers.push(() => gate.release())
        await gate.started
        const value = createValue(kind)
        const row = { id: 1, name: 'captured', nested: { value } }
        const pending =
          entry === 'import'
            ? c.utils.importData([row])
            : c.update(1, (draft) => {
                draft.name = row.name
                draft.nested = row.nested
              }).isPersisted.promise
        // Date, buffers, views and nested containers each have a native mutation
        // that preserves their shape but changes content. A shape-only check
        // would miss the bug; the independent byte/timestamp description cannot.
        function mutate(input: unknown): void {
          if (input instanceof Date) input.setTime(0)
          else if (input instanceof ArrayBuffer) new Uint8Array(input).fill(99)
          else if (ArrayBuffer.isView(input))
            new Uint8Array(input.buffer).fill(99)
          else if (Array.isArray(input)) input.forEach(mutate)
        }
        row.name = 'caller changed'
        mutate(value)
        handler.resolve()
        await gate.release()
        await pending
        await Channel.deliver()
        const expected = expectedValueRows(kind, 'captured')
        for (const rows of [
          c.values(),
          peer.values(),
          await c.utils.exportData(),
          (await readStore<ValueRow>(h.db, 'items')).rows,
        ])
          expect(
            await observeValueRows(rows),
            'captured value survives delayed native put',
          ).toEqual(expected)
      })
    })
  }
}
