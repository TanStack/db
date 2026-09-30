/**
 * A stored-row prefilter may reject only rows that the enriched-row predicate
 * cannot accept. Enrichment copies enumerable own root properties; the full
 * predicate catches nested property reads that throw. These descriptor cases
 * complement the plain-row grammar in the WHERE publication oracle.
 */
import { expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { mockSyncCollectionOptions } from '../utils.js'

type Row = { id: string; v?: string; nested?: { v?: string } }
const where = new Func('eq', [new PropRef(['v']), new Value('a')])
const nestedWhere = new Func('eq', [
  new PropRef(['nested', 'v']),
  new Value('a'),
])

function rowWithGetter(kind: 'inherited' | 'non-enumerable') {
  const getter = () => {
    throw new Error('getter read')
  }
  if (kind === 'inherited') {
    const prototype = Object.defineProperty({}, 'v', { get: getter })
    return Object.assign(Object.create(prototype) as Row, { id: kind })
  }
  return Object.defineProperty({ id: kind } as Row, 'v', {
    get: getter,
    enumerable: false,
  })
}

it.each(['inherited', 'non-enumerable'] as const)(
  'ignores a %s getter omitted from enriched rows',
  async (kind) => {
    const collection = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `prefilter-getter-${kind}`,
        getKey: (item) => item.id,
        initialData: [rowWithGetter(kind)],
      }),
    )
    try {
      await collection.stateWhenReady()
      expect(collection.currentStateAsChanges({ where })).toEqual([])
    } finally {
      await collection.cleanup()
    }
  },
)

it('keeps an enumerable own getter as a visible field', async () => {
  const row = Object.defineProperty({ id: 'enumerable' } as Row, 'v', {
    get: () => 'a',
    enumerable: true,
  })
  const collection = createCollection(
    mockSyncCollectionOptions<Row>({
      id: 'prefilter-getter-enumerable',
      getKey: (item) => item.id,
      initialData: [row],
    }),
  )
  try {
    await collection.stateWhenReady()
    expect(
      collection.currentStateAsChanges({ where })?.map((x) => x.key),
    ).toEqual(['enumerable'])
  } finally {
    await collection.cleanup()
  }
})

it('lets the full predicate handle a throwing nested getter', async () => {
  const nested = Object.create(
    Object.defineProperty({}, 'v', {
      get() {
        throw new Error('nested getter read')
      },
    }),
  ) as { v?: string }
  const collection = createCollection(
    mockSyncCollectionOptions<Row>({
      id: 'prefilter-getter-nested',
      getKey: (item) => item.id,
      initialData: [{ id: 'nested', nested }],
    }),
  )
  try {
    await collection.stateWhenReady()
    expect(collection.currentStateAsChanges({ where: nestedWhere })).toEqual([])
  } finally {
    await collection.cleanup()
  }
})
