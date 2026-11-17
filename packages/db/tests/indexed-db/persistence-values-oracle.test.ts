// @vitest-environment node
/**
 * Rich-value receiving companion to persistence-oracle.test.ts. The authored
 * value model and its limits live in structured-clone-oracle.ts. Each finite
 * history preserves one untouched nested field through a scalar update, peer
 * read, export/import replacement and fresh descriptor restore. Atomic rejection
 * crosses insert/import and first/middle/last uncloneable nested values, and
 * reports each as a SerializationError.
 *
 * The driver uses real Collection APIs and fake-IDB, with controlled delivery.
 * Every checkpoint compares public, peer, export and raw durable values, plus
 * version records after rejection. Native receiving lives in e2e/indexed-db/value-witness.spec.ts.
 */
import { expect } from 'vitest'
import {
  SerializationError,
  createCollection,
  createIndexedDB,
  indexedDBCollectionOptions,
} from '../../src'
import { oracleProperty } from '../oracle-config'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter'
import { Channel, deferred, readStore, withHarness } from './harness'
import {
  createValue,
  expectedValueRows,
  observeValueRows,
  valueKinds,
} from './structured-clone-oracle'
import { holdStore } from './idb-driver'
import type { ValueRow } from './structured-clone-oracle'

async function preserveValue(kind: (typeof valueKinds)[number]) {
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
    await writer
      .insert({
        id: 1,
        name: 'initial',
        nested: { value: createValue(kind) },
      })
      .when(`settled`)
    await checkpoint('insert')
    await writer
      .update(1, (draft) => {
        draft.name = 'updated'
      })
      .when(`settled`)
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
            ? writer.insert(batch).when(`settled`)
            : writer.utils.importData(batch)
        await expect(outcome).rejects.toBeInstanceOf(SerializationError)
        await checkpoint(`${entry} rejection at ${badIndex}`)
        expect(
          await readStore(h.db, '_versions'),
          'rejected batch preserves metadata',
        ).toEqual(before)
      }
    }
    await writer
      .update(1, (draft) => {
        draft.name = 'suffix'
      })
      .when(`settled`)
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
}

oracleProperty({
  id: `indexeddb.value-preservation`,
  law: {
    statement: `An untouched nested structured-clone value survives a scalar update, peer read, export/import replacement and fresh descriptor restore, and an uncloneable batch is rejected atomically as a SerializationError.`,
    authority: `The IndexedDB structured-clone persistence contract and the authored value model in structured-clone-oracle.ts`,
    limits: `One finite history per value kind; rejection crosses insert/import and first/middle/last uncloneable nested values.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexed-db.ts#createIndexedDB',
    'src/indexed-db.ts#indexedDBCollectionOptions',
  ],
  histories: valueKinds,
  label: (kind) =>
    `preserves ${kind} through updates, peers, export/import and restore`,
  resolve: (kind) => ({ kind }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`indexeddb.value-preservation`, plan, observe, () =>
      preserveValue(plan.kind),
    ),
  check: forwardAssertionJudgment,
})

// Value capture: update follows core's documented callback-return snapshot;
// import captures validated rows before waiting for storage. Mutating the
// caller's object afterwards cannot rewrite the authored operation. Compare
// independently authored value descriptions at settlement, peer delivery,
// export and raw storage, while handlers/storage deliberately delay native put.
// Blob is immutable; custom classes and mutation of public Collection rows are
// outside this law. The same source reference is intentionally shared with the
// submitted row, never with the expected descriptions.
type CaptureHistory = {
  kind: (typeof valueKinds)[number]
  entry: 'update' | 'import'
}

async function captureValue({ kind, entry }: CaptureHistory) {
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
    await c
      .insert({ id: 1, name: 'before', nested: { value: null } })
      .when(`settled`)
    await Channel.deliver()
    const gate = holdStore(h.db.db)
    h.disposers.push(() => gate.release())
    await gate.started
    const value = createValue(kind)
    const row = { id: 1, name: 'captured', nested: { value } }
    const pending =
      entry === 'import'
        ? c.utils.importData([row])
        : c
            .update(1, (draft) => {
              draft.name = row.name
              draft.nested = row.nested
            })
            .when(`settled`)
    // Date, buffers, views and nested containers each have a native mutation
    // that preserves their shape but changes content. A shape-only check
    // would miss the bug; the independent byte/timestamp description cannot.
    function mutate(input: unknown): void {
      if (input instanceof Date) input.setTime(0)
      else if (input instanceof ArrayBuffer) new Uint8Array(input).fill(99)
      else if (ArrayBuffer.isView(input)) new Uint8Array(input.buffer).fill(99)
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
}

oracleProperty({
  id: `indexeddb.value-capture`,
  law: {
    statement: `Update and import capture the authored value before delayed native persistence: a later caller mutation cannot rewrite the public, peer, export or raw stored value.`,
    authority: `The IndexedDB structured-clone persistence contract, core's documented callback-return snapshot, and the authored value model in structured-clone-oracle.ts`,
    limits: `Every non-Blob value kind through update and import with a held handler and native store; custom classes and mutation of public Collection rows are outside this law.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexed-db.ts#createIndexedDB',
    'src/indexed-db.ts#indexedDBCollectionOptions',
  ],
  histories: valueKinds
    .filter((value) => value !== 'blob')
    .flatMap((kind) =>
      (['update', 'import'] as const).map((entry): CaptureHistory => ({
        kind,
        entry,
      })),
    ),
  label: ({ kind, entry }) =>
    `captures ${kind} before delayed ${entry} persistence`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`indexeddb.value-capture`, plan, observe, () =>
      captureValue(plan.history),
    ),
  check: forwardAssertionJudgment,
})
