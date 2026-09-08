import { expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import type { SyncConfig } from '../src/types.js'

type Row = { id: number; value: number | Array<number> }

it.each(
  [BasicIndex, BTreeIndex].flatMap((IndexType) =>
    [100, 10000].flatMap((size) =>
      ([`delete`, `update`] as const).map((retirement) => ({
        name: IndexType.name,
        IndexType,
        size,
        retirement,
      })),
    ),
  ),
)(
  `$name restores range lookup after $retirement in $size rows`,
  async ({ IndexType, size, retirement }) => {
    let sync!: Parameters<SyncConfig<Row>[`sync`]>[0]
    const collection = createCollection<Row>({
      getKey: (row) => row.id,
      autoIndex: `off`,
      sync: {
        sync: (context) => {
          sync = context
          context.begin()
          for (let id = 0; id < size; id++) {
            context.write({ type: `insert`, value: { id, value: id } })
          }
          context.commit()
          context.markReady()
        },
      },
    })
    await collection.preload()
    const index = collection.createIndex((row) => row.value, {
      indexType: IndexType,
    })
    const entries = collection.entries.bind(collection)
    let scanned = 0
    const spy = vi
      .spyOn(collection, `entries`)
      .mockImplementation(function* () {
        for (const entry of entries()) {
          scanned++
          yield entry
        }
      })
    const where = new Func<boolean>(`gt`, [
      new PropRef([`value`]),
      new Value(size - 2),
    ])
    const visits: Array<number> = []
    const read = (expected: Array<number>, repeats = 1) => {
      scanned = 0
      for (let i = 0; i < repeats; i++) {
        expect(
          collection
            .currentStateAsChanges({ where })
            ?.map(({ key }) => key)
            .sort((a, b) => a - b),
        ).toEqual(expected)
      }
      visits.push(scanned)
    }
    try {
      read([size - 1])
      sync.begin()
      sync.write({ type: `insert`, value: { id: size, value: [size + 5] } })
      sync.commit()
      read([size - 1, size])
      sync.begin()
      if (retirement === `delete`) sync.write({ type: `delete`, key: size })
      else sync.write({ type: `update`, value: { id: size, value: 0 } })
      sync.commit()
      read([size - 1], 3)
      index.build(entries())
      read([size - 1])
      // The transient foreign domain must not leave every future snapshot scanning.
      expect(visits).toEqual([0, size + 1, 0, 0])
    } finally {
      spy.mockRestore()
      await collection.cleanup()
    }
  },
)
