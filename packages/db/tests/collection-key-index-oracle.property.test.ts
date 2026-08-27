import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { currentStateAsChanges } from '../src/collection/change-events.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { getCollectionKeyPath } from '../src/utils/collection-key.js'
import type { CollectionLike } from '../src/types.js'

type Row = {
  id: string
  value: number
  fallback?: string
  nested?: { id: string }
}

let collectionId = 0

function collectionWithRows(
  rows: Array<Row>,
  getKey: (row: Row) => string = (row) => row.id,
) {
  return createCollection<Row>({
    id: `implicit-key-index-oracle-${collectionId++}`,
    getKey,
    autoIndex: `off`,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of rows) {
          write({ type: `insert`, value: row })
        }
        commit()
        markReady()
      },
    },
  })
}

describe(`implicit collection key index oracle`, () => {
  fcTest.prop(
    [
      fc.uniqueArray(
        fc.record({
          id: fc.string({ minLength: 1, maxLength: 8 }),
          value: fc.integer(),
        }),
        { selector: (row) => row.id, maxLength: 40 },
      ),
      fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), {
        maxLength: 50,
      }),
    ],
    { numRuns: 200 },
  )(
    `matches IN demand through the key map without a field index`,
    (rows, ids) => {
      const collection = collectionWithRows(rows)
      const result = currentStateAsChanges(collection, {
        where: new Func(`in`, [new PropRef([`id`]), new Value(ids)]),
        optimizedOnly: true,
      })

      expect(collection.indexes.size).toBe(0)
      expect(result?.map((change) => change.key).sort()).toEqual(
        rows
          .filter((row) => ids.includes(row.id))
          .map((row) => row.id)
          .sort(),
      )
    },
  )

  fcTest.prop(
    [
      fc.uniqueArray(
        fc.record({
          id: fc.string({ minLength: 1, maxLength: 8 }),
          value: fc.integer(),
        }),
        { selector: (row) => row.id, maxLength: 40 },
      ),
      fc.string({ minLength: 1, maxLength: 8 }),
      fc.boolean(),
    ],
    { numRuns: 200 },
  )(
    `matches equality demand in either operand order through the key map`,
    (rows, id, reverseOperands) => {
      const collection = collectionWithRows(rows)
      const property = new PropRef([`id`])
      const value = new Value(id)
      const result = currentStateAsChanges(collection, {
        where: new Func(
          `eq`,
          reverseOperands ? [value, property] : [property, value],
        ),
        optimizedOnly: true,
      })

      expect(collection.indexes.size).toBe(0)
      expect(result?.map((change) => change.key)).toEqual(
        rows.filter((row) => row.id === id).map((row) => row.id),
      )
    },
  )

  it(`does not mistake a computed collection key for a field index`, () => {
    const collection = collectionWithRows(
      [{ id: `a`, value: 1 }],
      (row) => `${row.id}:${row.value}`,
    )

    expect(
      currentStateAsChanges(collection, {
        where: new Func(`eq`, [new PropRef([`id`]), new Value(`a`)]),
        optimizedOnly: true,
      }),
    ).toBeUndefined()
  })

  it(`infers a nested key path for equality and IN lookups`, () => {
    const rows = [
      { id: `outer-a`, nested: { id: `a` }, value: 1 },
      { id: `outer-b`, nested: { id: `b` }, value: 2 },
    ]
    const collection = collectionWithRows(rows, (row) => row.nested!.id)

    expect(
      currentStateAsChanges(collection, {
        where: new Func(`eq`, [new PropRef([`nested`, `id`]), new Value(`b`)]),
        optimizedOnly: true,
      })?.map((change) => change.key),
    ).toEqual([`b`])
    expect(
      currentStateAsChanges(collection, {
        where: new Func(`in`, [
          new PropRef([`nested`, `id`]),
          new Value([`b`, `missing`, `a`, `b`]),
        ]),
        optimizedOnly: true,
      })
        ?.map((change) => change.key)
        .sort(),
    ).toEqual([`a`, `b`])
  })

  it(`keeps inferred key metadata internal and immutable`, () => {
    const collection = collectionWithRows(
      [{ id: `outer-a`, nested: { id: `a` }, value: 1 }],
      (row) => row.nested!.id,
    )

    const inferredPath = getCollectionKeyPath(collection)
    expect(inferredPath).toEqual([`nested`, `id`])
    expect(Object.isFrozen(inferredPath)).toBe(true)
    expect(`keyPath` in collection.config).toBe(false)
    expect(`getKeyPath` in collection).toBe(false)
    expect(
      currentStateAsChanges(collection, {
        where: new Func(`eq`, [new Value(`a`), new PropRef([`nested`, `id`])]),
        optimizedOnly: true,
      })?.map((change) => change.key),
    ).toEqual([`a`])
  })

  it(`keeps external CollectionLike implementations source-compatible`, () => {
    const collection = collectionWithRows([{ id: `a`, value: 1 }])
    const external: CollectionLike<Row> = {
      get: (key) => collection.get(key),
      has: (key) => collection.has(key),
      entries: () => collection.entries(),
      indexes: collection.indexes,
      id: collection.id,
      compareOptions: collection.compareOptions,
    }

    expect(getCollectionKeyPath(external)).toBeUndefined()
  })

  it(`uses SameValueZero semantics for numeric collection keys`, () => {
    type NumericRow = { id: number; value: string }
    const collection = createCollection<NumericRow, number>({
      id: `implicit-numeric-key-index-oracle-${collectionId++}`,
      getKey: (row) => row.id,
      autoIndex: `off`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: Number.NaN, value: `nan` } })
          write({ type: `insert`, value: { id: -0, value: `zero` } })
          commit()
          markReady()
        },
      },
    })

    expect(
      currentStateAsChanges(collection, {
        where: new Func(`in`, [
          new PropRef([`id`]),
          new Value([Number.NaN, 0]),
        ]),
        optimizedOnly: true,
      })
        ?.map((change) => change.value.value)
        .sort(),
    ).toEqual([`nan`, `zero`])
  })

  it(`does not mistake a conditional collection key for a field index`, () => {
    const collection = collectionWithRows(
      [{ id: ``, fallback: `actual-key`, value: 1 }],
      (row) => row.id || row.fallback!,
    )

    expect(
      currentStateAsChanges(collection, {
        where: new Func(`eq`, [new PropRef([`id`]), new Value(``)]),
        optimizedOnly: true,
      }),
    ).toBeUndefined()
  })

  fcTest.prop(
    [
      fc.constantFrom(
        `direct`,
        `destructured`,
        `bracket`,
        `nested`,
        `conditional`,
        `computed`,
        `coerced`,
        `closure`,
      ),
      fc.record({
        id: fc.string({ maxLength: 8 }),
        fallback: fc.string({ minLength: 1, maxLength: 8 }),
        value: fc.integer(),
      }),
    ],
    { numRuns: 100 },
  )(`infers only extractors that return one field unchanged`, (form, row) => {
    const getKey = (item: Row): string => {
      switch (form) {
        case `direct`:
          return item.id
        case `destructured`: {
          const { id } = item
          return id
        }
        case `bracket`:
          return item[`id`]
        case `nested`:
          return { row: item }.row.id
        case `conditional`:
          return item.id || item.fallback!
        case `computed`:
          return `${item.id}:${item.value}`
        case `coerced`:
          return String(item.id)
        case `closure`: {
          const read = (value: Row) => value.id
          return read(item)
        }
      }
      throw new Error(`Unknown key extractor form: ${form}`)
    }
    const collection = collectionWithRows([row], getKey)
    const isExactFieldAccessor = [
      `direct`,
      `destructured`,
      `bracket`,
      `nested`,
      `closure`,
    ].includes(form)

    expect(getCollectionKeyPath(collection)).toEqual(
      isExactFieldAccessor ? [`id`] : undefined,
    )
    const optimized = currentStateAsChanges(collection, {
      where: new Func(`eq`, [new PropRef([`id`]), new Value(row.id)]),
      optimizedOnly: true,
    })
    if (isExactFieldAccessor) {
      expect(optimized?.map((change) => change.key)).toEqual([row.id])
    } else {
      expect(optimized).toBeUndefined()
    }
  })
})
