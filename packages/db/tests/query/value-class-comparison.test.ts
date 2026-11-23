// Fixed examples for how value classes order and which objects are excluded.
// The law and its generated histories are owned by
// serialized-value-equality-oracle.property.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createEffect } from '../../src/query/effect.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import {
  compareValues,
  normalizeValue,
  serializedClassValue,
} from '../../src/utils/comparison.js'
import { mockSyncCollectionOptions } from '../utils.js'

class Bound {
  constructor(
    readonly json: string,
    readonly rank: number,
  ) {}
  toJSON() {
    return this.json
  }
  valueOf() {
    return this.rank
  }
}

const throwing = <T extends object>(target: T): T =>
  Object.defineProperty(target, `toJSON`, {
    get() {
      throw new Error(`toJSON was read`)
    },
  })

describe(`compareValues with value classes`, () => {
  it(`orders by the serialized value, not valueOf`, () => {
    expect(compareValues(new Bound(`b`, 1), new Bound(`a`, 9))).toBe(1)
    expect(compareValues(new Bound(`a`, 9), new Bound(`b`, 1))).toBe(-1)
    expect(compareValues(new Bound(`a`, 1), new Bound(`a`, 9))).toBe(0)
  })

  it(`puts primitives before a value class and other objects after it`, () => {
    expect(compareValues(new Bound(`a`, -1), 100)).toBe(1)
    expect(compareValues(100, new Bound(`a`, 999))).toBe(-1)
    expect(compareValues(new Bound(`a`, 999), new Map())).toBe(-1)
    expect(compareValues(new Map(), new Bound(`a`, 999))).toBe(1)
  })

  it(`compares arrays that hold value classes by those values`, () => {
    expect(compareValues([new Bound(`b`, 1)], [new Bound(`a`, 9)])).toBe(1)
    expect(compareValues([new Bound(`a`, 1)], [new Bound(`a`, 9)])).toBe(0)
  })

  it(`leaves values without a value class to the native operators`, () => {
    expect(compareValues(2, 10)).toBe(-1)
    expect(compareValues(`b`, `a`)).toBe(1)
    expect(compareValues(new Date(2), new Date(1))).toBe(1)
    expect(compareValues([2], [10])).toBe(1)
  })
})

describe(`compareValues with object leaves in value class arrays`, () => {
  it(`does not let an object leaf's reference break a tie`, () => {
    const shared = { shape: 1 }
    const row = [shared, new Bound(`a`, 1)]
    expect(compareValues(row, [shared, new Bound(`a`, 2)])).toBe(0)
    expect(compareValues(row, [{ shape: 1 }, new Bound(`a`, 2)])).toBe(0)
    expect(compareValues([{ shape: 1 }, new Bound(`a`, 2)], row)).toBe(0)
  })

  it(`orders by the value class after an object leaf`, () => {
    const row = [{ shape: 1 }, new Bound(`b`, 1)]
    expect(compareValues(row, [{ shape: 1 }, new Bound(`a`, 9)])).toBe(1)
    expect(compareValues([{ shape: 1 }, new Bound(`a`, 9)], row)).toBe(-1)
  })

  it(`orders an array holding a value class apart from a plain object`, () => {
    const array = [new Bound(`a`, 1)]
    for (const object of [{}, new Map()]) {
      expect(compareValues(array, object)).toBe(1)
      expect(compareValues(object, array)).toBe(-1)
    }
  })

  it(`terminates on cyclic arrays`, () => {
    const left: Array<unknown> = [new Bound(`a`, 1)]
    const right: Array<unknown> = [new Bound(`a`, 2)]
    left.push(left)
    right.push(right)
    expect(compareValues(left, right)).toBe(0)
  })
})

describe(`compareValues allocation`, () => {
  afterEach(() => vi.unstubAllGlobals())

  it(`allocates no Set unless an operand is an array`, () => {
    let created = 0
    class CountingSet<T> extends Set<T> {
      constructor(values?: Iterable<T>) {
        super(values)
        created++
      }
    }
    const date = new Date(1)
    const bound = new Bound(`a`, 1)
    vi.stubGlobal(`Set`, CountingSet)
    compareValues(1, 2)
    compareValues(`a`, `b`)
    compareValues(date, date)
    compareValues(bound, bound)
    vi.unstubAllGlobals()
    expect(created).toBe(0)
  })
})

describe(`indexes follow a deep-equal row replacement`, () => {
  type Row = { id: string; ref: object | string | null }

  it.each([
    [`BasicIndex`, BasicIndex],
    [`BTreeIndex`, BTreeIndex],
  ] as const)(
    `keeps ordered keys through sync writes with %s`,
    async (name, indexType) => {
      const collection = createCollection(
        mockSyncCollectionOptions<Row>({
          id: `equal-replacement-sync-${name}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `r0`, ref: `text` },
            { id: `r1`, ref: new Map() },
          ],
          autoIndex: `off`,
          defaultIndexType: indexType,
        }),
      )
      await collection.stateWhenReady()
      const index = collection.createIndex((row) => row.ref)
      for (const ref of [new Map(), null]) {
        collection.utils.begin()
        collection.utils.write({ type: `update`, value: { id: `r1`, ref } })
        collection.utils.commit()
      }
      expect(index.takeFromStart(2).sort()).toEqual([`r0`, `r1`])
      await collection.cleanup()
    },
  )

  it.each([
    [`BasicIndex`, BasicIndex],
    [`BTreeIndex`, BTreeIndex],
  ] as const)(
    `keeps ordered keys through optimistic writes with %s`,
    async (name, indexType) => {
      const collection = createCollection({
        ...mockSyncCollectionOptions<Row>({
          id: `equal-replacement-optimistic-${name}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `r0`, ref: `text` },
            { id: `r1`, ref: new Map() },
          ],
          autoIndex: `off`,
          defaultIndexType: indexType,
        }),
        onUpdate: () => new Promise<void>(() => {}),
      })
      await collection.stateWhenReady()
      const index = collection.createIndex((row) => row.ref)
      for (const ref of [new Map(), null]) {
        collection.update(`r1`, (draft) => {
          draft.ref = ref
        })
      }
      expect(index.takeFromStart(2).sort()).toEqual([`r0`, `r1`])
    },
  )
})

describe(`a reference filter follows a deep-equal row replacement`, () => {
  type Row = { id: string; ref: object | string }

  it.each([
    [`no index`, undefined],
    [`BasicIndex`, BasicIndex],
    [`BTreeIndex`, BTreeIndex],
  ] as const)(`drops and regains the row with %s`, async (name, indexType) => {
    const first = new Map([[`k`, 1]])
    const second = new Map([[`k`, 1]])
    const collection = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `reference-filter-${name}`,
        getKey: (row) => row.id,
        initialData: [
          { id: `a`, ref: first },
          { id: `b`, ref: `text` },
        ],
        autoIndex: `off`,
        ...(indexType === undefined ? {} : { defaultIndexType: indexType }),
      }),
    )
    await collection.stateWhenReady()
    if (indexType !== undefined) collection.createIndex((row) => row.ref)
    const where = new Func<boolean>(`eq`, [
      new PropRef([`ref`]),
      new Value(first),
    ])
    const filtered: Array<string> = []
    const unfiltered: Array<string> = []
    const subscriptions = [
      collection.subscribeChanges(
        (changes) => {
          for (const change of changes)
            filtered.push(`${change.type}:${change.key}`)
        },
        { includeInitialState: true, whereExpression: where },
      ),
      collection.subscribeChanges((changes) => {
        for (const change of changes)
          unfiltered.push(`${change.type}:${change.key}`)
      }),
    ]
    const fresh = () =>
      collection.currentStateAsChanges({ where })!.map((change) => change.key)
    const replace = (ref: object) => {
      collection.utils.begin()
      collection.utils.write({ type: `update`, value: { id: `a`, ref } })
      collection.utils.commit()
    }

    replace(second)
    expect(fresh()).toEqual([])
    replace(first)
    expect(fresh()).toEqual([`a`])
    // Row b is rewritten deep-equal: no filter changes its answer.
    collection.utils.begin()
    collection.utils.write({ type: `update`, value: { id: `b`, ref: `text` } })
    collection.utils.commit()

    expect(filtered).toEqual([`insert:a`, `delete:a`, `insert:a`])
    expect(unfiltered).toEqual([])
    for (const subscription of subscriptions) subscription.unsubscribe()
    await collection.cleanup()
  })
})

describe(`queries follow a deep-equal row replacement`, () => {
  type Row = { id: string; ref: object | string }
  let sources = 0
  const sourceOf = async (rows: Array<Row>) => {
    const collection = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `query-replacement-${sources++}`,
        getKey: (row) => row.id,
        initialData: rows,
        autoIndex: `off`,
      }),
    )
    await collection.stateWhenReady()
    return collection
  }
  const replace = (
    collection: Awaited<ReturnType<typeof sourceOf>>,
    id: string,
    ref: object,
  ) => {
    collection.utils.begin()
    collection.utils.write({ type: `update`, value: { id, ref } })
    collection.utils.commit()
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  it(`leaves and rejoins a join on a shared instance`, async () => {
    const shared = new Map()
    const left = await sourceOf([{ id: `l`, ref: shared }])
    const right = await sourceOf([{ id: `r`, ref: shared }])
    const pairs = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ a: left })
          .join({ b: right }, ({ a, b }) => eq(a.ref, b.ref), `inner`)
          .select(({ a, b }) => ({ a: a.id, b: b.id })),
    })
    await pairs.preload()
    expect(pairs.size).toBe(1)
    replace(right, `r`, new Map())
    await flush()
    expect(pairs.size).toBe(0)
    replace(right, `r`, shared)
    await flush()
    expect(pairs.size).toBe(1)
  })

  it(`follows a functional filter`, async () => {
    const shared = new Map()
    const source = await sourceOf([{ id: `a`, ref: shared }])
    const filtered = createLiveQueryCollection({
      query: (q) =>
        q.from({ item: source }).fn.where((row) => row.item.ref === shared),
    })
    await filtered.preload()
    expect(filtered.size).toBe(1)
    replace(source, `a`, new Map())
    await flush()
    expect(filtered.size).toBe(0)
    replace(source, `a`, shared)
    await flush()
    expect(filtered.size).toBe(1)
  })

  it(`follows a filter over a projection`, async () => {
    const shared = new Map()
    const source = await sourceOf([{ id: `a`, ref: shared }])
    const projected = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ item: source })
          .select(({ item }) => ({ id: item.id, ref: item.ref })),
    })
    const filtered = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ item: projected })
          .where(({ item }) => eq(item.ref as never, shared as never)),
    })
    await filtered.preload()
    expect(filtered.size).toBe(1)
    replace(source, `a`, new Map())
    await flush()
    expect(filtered.size).toBe(0)
    replace(source, `a`, shared)
    await flush()
    expect(filtered.size).toBe(1)
  })

  it(`tells nothing to readers that keep the row`, async () => {
    const source = await sourceOf([{ id: `a`, ref: new Map() }])
    const live = createLiveQueryCollection({
      query: (q) =>
        q.from({ item: source }).where(({ item }) => eq(item.id, `a`)),
    })
    await live.preload()
    const seen: Array<string> = []
    const record = (changes: Array<{ type: string }>) => {
      for (const change of changes) seen.push(change.type)
    }
    const subscriptions = [
      live.subscribeChanges(record),
      source.subscribeChanges(record, {
        where: (row) => eq(row.id, `a`),
      }),
    ]
    const effect = createEffect<Row, string>({
      query: (q) =>
        q.from({ item: source }).where(({ item }) => eq(item.id, `a`)),
      skipInitial: true,
      onEnter: () => void seen.push(`enter`),
      onExit: () => void seen.push(`exit`),
      onUpdate: () => void seen.push(`update`),
    })
    await flush()
    replace(source, `a`, new Map())
    await flush()
    expect(seen).toEqual([])
    for (const subscription of subscriptions) subscription.unsubscribe()
    await effect.dispose()
  })

  it(`ends an Effect's row when its join stops matching`, async () => {
    const shared = new Map()
    const left = await sourceOf([{ id: `l`, ref: shared }])
    const right = await sourceOf([{ id: `r`, ref: shared }])
    const seen: Array<string> = []
    const effect = createEffect({
      query: (q) =>
        q
          .from({ a: left })
          .join({ b: right }, ({ a, b }) => eq(a.ref, b.ref), `inner`)
          .select(({ a, b }) => ({ a: a.id, b: b.id })),
      skipInitial: true,
      onEnter: () => void seen.push(`enter`),
      onExit: () => void seen.push(`exit`),
      onUpdate: () => void seen.push(`update`),
    })
    await flush()
    replace(right, `r`, new Map())
    await flush()
    expect(seen).toEqual([`exit`])
    await effect.dispose()
  })
})

describe(`arrays shared between the operands of a range`, () => {
  it(`orders a row that holds the capture like one that holds a copy`, () => {
    const capture = [[new Bound(`one`, 1)]]
    const copy = [[new Bound(`one`, 2)]]
    expect(compareValues([capture], capture)).toBe(1)
    expect(compareValues([copy], capture)).toBe(1)
    expect(compareValues(capture, [capture])).toBe(-1)
    expect(compareValues(capture, [copy])).toBe(-1)
    // The same array on both sides at one depth is still equal to itself.
    expect(compareValues([capture, capture], [capture, copy])).toBe(0)
  })

  it(`ends on arrays that contain themselves`, () => {
    const loop = (): Array<unknown> => {
      const array: Array<unknown> = [new Bound(`x`, 1)]
      array.push(array)
      return array
    }
    const a = loop()
    const b = loop()
    const unrolled: Array<unknown> = [new Bound(`x`, 1)]
    unrolled.push([new Bound(`x`, 2), unrolled])
    expect(compareValues(a, a)).toBe(0)
    expect(compareValues(a, b)).toBe(0)
    expect(compareValues(a, unrolled)).toBe(0)
    const later = loop()
    later[0] = new Bound(`y`, 0)
    expect(compareValues(a, later)).toBe(-1)
    expect(compareValues(later, a)).toBe(1)
  })
})

describe(`excluded objects with a throwing toJSON accessor`, () => {
  const excluded = (): Array<[string, object]> => [
    [`plain record`, throwing({ a: 1 })],
    [`null-prototype record`, throwing(Object.create(null))],
    [`array`, throwing([1])],
    [`Date`, throwing(new Date(1))],
    [`Map`, throwing(new Map())],
    [`Set`, throwing(new Set())],
    [`ArrayBuffer`, throwing(new ArrayBuffer(1))],
    [`typed array`, throwing(new Uint8Array(1))],
  ]

  it.each(excluded())(`does not read it on a %s`, (_name, value) => {
    expect(serializedClassValue(value)).toBeUndefined()
    expect(() => normalizeValue(value)).not.toThrow()
  })

  it.each([
    [`no index`, undefined],
    [`BasicIndex`, BasicIndex],
    [`BTreeIndex`, BTreeIndex],
  ] as const)(`keeps reference equality with %s`, async (_name, indexType) => {
    type Row = { id: string; ref: object }
    const ref = throwing({ a: 1 })
    const collection = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `excluded-accessor-${_name}`,
        getKey: (row) => row.id,
        initialData: [
          { id: `same`, ref },
          { id: `other`, ref: throwing({ a: 1 }) },
        ],
        autoIndex: `off`,
        ...(indexType === undefined ? {} : { defaultIndexType: indexType }),
      }),
    )
    await collection.stateWhenReady()
    if (indexType !== undefined) collection.createIndex((row) => row.ref)
    const where = new Func<boolean>(`eq`, [
      new PropRef([`ref`]),
      new Value(ref),
    ])
    expect(
      collection.currentStateAsChanges({ where })!.map((change) => change.key),
    ).toEqual([`same`])
    await collection.cleanup()
  })
})
