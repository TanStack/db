/**
 * Ordinary unit tests moved out of subquery-user-value-oracle.test.ts. Each
 * compares a user row, selected object, or predicate operand with a value
 * written in the test. None reaches the DISTINCT or aggregate model. The law
 * that a QueryRef keeps user rows as data is stated in the oracle file.
 */
import { describe, expect, it } from 'vitest'
import { count, createLiveQueryCollection, eq } from '../../src/query/index.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import { stripVirtualProps } from '../utils.js'
import { createControlledCollection } from './includes-oracle-helpers.js'

describe('subquery boundaries preserve operators and user rows', () => {
  it('keeps a no-select user row shaped like a Value expression intact', async () => {
    const original = { id: 1, type: 'val' as const, value: 42 }
    const source = createControlledCollection('value-shaped-source', [original])
    const live = createLiveQueryCollection({
      query: (q) => {
        const inner = q.from({ item: source.collection })
        return q.from({ item: inner })
      },
    })

    try {
      await live.preload()
      expect(live.toArray.map(stripVirtualProps)).toEqual([original])
    } finally {
      await live.cleanup()
      await source.collection.cleanup()
    }
  })

  it('keeps a selected user object shaped like a Value expression intact', async () => {
    const source = createControlledCollection('value-shaped-selection', [
      { id: 1 },
    ])
    try {
      const live = createLiveQueryCollection({
        query: (q) =>
          q.from({ item: source.collection }).select(() => ({
            type: 'val' as const,
            value: 42,
          })),
        getKey: () => 1,
      })
      try {
        await live.preload()
        expect(live.toArray.map(stripVirtualProps)).toEqual([
          { type: 'val', value: 42 },
        ])
      } finally {
        await live.cleanup()
      }
    } finally {
      await source.collection.cleanup()
    }
  })

  it('evaluates selected arrays of references as arrays of row values', async () => {
    const source = createControlledCollection('array-selection', [
      { id: 1, name: 'Ada' },
    ])
    const live = createLiveQueryCollection({
      query: (q) =>
        q.from({ item: source.collection }).select(({ item }) => ({
          pair: [item.id, item.name],
        })),
      getKey: () => 1,
    })
    try {
      await live.preload()
      expect(live.toArray[0]?.pair.map((value) => typeof value)).toEqual([
        'number',
        'string',
      ])
      expect(live.toArray.map(stripVirtualProps)).toEqual([
        { pair: [1, 'Ada'] },
      ])
      expect(JSON.stringify(live.toArray.map(stripVirtualProps))).toBe(
        '[{"pair":[1,"Ada"]}]',
      )
    } finally {
      await live.cleanup()
      await source.collection.cleanup()
    }
  })

  it('keeps a top-level proxy-shaped selected field as user data', async () => {
    const source = createControlledCollection('proxy-field-selection', [
      { id: 1 },
    ])
    const live = createLiveQueryCollection({
      query: (q) =>
        q.from({ item: source.collection }).select(({ item }) => ({
          __refProxy: true,
          id: item.id,
        })),
      getKey: () => 1,
    })
    try {
      await live.preload()
      expect(live.toArray.map(stripVirtualProps)).toEqual([
        { __refProxy: true, id: 1 },
      ])
    } finally {
      await live.cleanup()
      await source.collection.cleanup()
    }
  })

  it('keeps proxy-shaped fields in aggregate subqueries', async () => {
    const source = createControlledCollection('proxy-field-aggregate', [
      { id: 1 },
      { id: 2 },
    ])
    const live = createLiveQueryCollection({
      query: (q) => {
        const summary = q
          .from({ item: source.collection })
          .select(({ item }) => ({
            __refProxy: true,
            total: count(item.id),
          }))
        return q.from({ result: summary }).select(({ result }) => ({
          __refProxy: result.__refProxy,
          total: result.total,
        }))
      },
      getKey: () => 1,
    })
    try {
      await live.preload()
      expect(live.toArray.map(stripVirtualProps)).toEqual([
        { __refProxy: true, total: 2 },
      ])
    } finally {
      await live.cleanup()
      await source.collection.cleanup()
    }
  })

  it.each([
    { name: 'reference-shaped', payload: { type: 'ref', path: ['name'] } },
    {
      name: 'function-shaped',
      payload: { type: 'func', name: 'user', args: [] },
    },
    {
      name: 'conditional-shaped',
      payload: { type: 'conditionalSelect', branches: [] },
    },
    { name: 'proxy-shaped', payload: { __refProxy: true, __path: ['name'] } },
    { name: 'wrapper-shaped', payload: { __brand: 'MaterializeWrapper' } },
  ])('keeps selected $name user objects intact', async ({ payload }) => {
    const source = createControlledCollection('selected-container', [{ id: 1 }])
    const live = createLiveQueryCollection({
      query: (q) =>
        q.from({ item: source.collection }).select(() => ({ payload })),
      getKey: () => 1,
    })
    try {
      await live.preload()
      expect(live.toArray.map(stripVirtualProps)).toEqual([{ payload }])
    } finally {
      await live.cleanup()
      await source.collection.cleanup()
    }
  })

  it('keeps an outer virtual-field WHERE after a joined DISTINCT result', async () => {
    const source = createControlledCollection('distinct-pushdown', [
      { id: 1, groupId: 1 },
      { id: 2, groupId: 1 },
    ])
    const people = createControlledCollection('distinct-pushdown-people', [
      { id: 1, groupId: 1 },
    ])
    const live = createLiveQueryCollection({
      query: (q) => {
        const groups = q
          .from({ item: source.collection })
          .select(({ item }) => ({ groupId: item.groupId }))
          .distinct()
        return q
          .from({ person: people.collection })
          .innerJoin({ group: groups }, ({ person, group }) =>
            eq(person.groupId, group.groupId),
          )
          .where(({ group }) => eq(group.$key, 2))
          .select(({ group }) => ({ groupId: group.groupId }))
      },
      getKey: () => 1,
    })
    try {
      await live.preload()
      expect(live.toArray.map(stripVirtualProps)).toEqual([])
    } finally {
      await live.cleanup()
      await source.collection.cleanup()
      await people.collection.cleanup()
    }
  })

  it('keeps an outer WHERE after a nested aggregate select', async () => {
    const source = createControlledCollection('nested-aggregate-pushdown', [
      { id: 1 },
      { id: 2 },
    ])
    const people = createControlledCollection('nested-aggregate-people', [
      { id: 2 },
    ])
    const live = createLiveQueryCollection({
      query: (q) => {
        const stats = q
          .from({ item: source.collection })
          .select(({ item }) => ({
            stats: { type: 'summary', total: count(item.id) },
          }))
        return q
          .from({ person: people.collection })
          .innerJoin({ result: stats }, ({ person, result }) =>
            eq(person.id, result.stats.total),
          )
          .where(({ result }) => eq(result.$key, 'single_group'))
          .select(({ result }) => ({ total: result.stats.total }))
      },
      getKey: () => 1,
    })
    try {
      await live.preload()
      expect(live.toArray.map(stripVirtualProps)).toEqual([{ total: 2 }])
    } finally {
      await live.cleanup()
      await source.collection.cleanup()
      await people.collection.cleanup()
    }
  })
  it('keeps a renamed no-select QueryRef bound to its source', async () => {
    const source = createControlledCollection('renamed-query-ref', [{ id: 1 }])
    const live = createLiveQueryCollection({
      query: (q) => q.from({ one: q.from({ item: source.collection }) }),
    })
    try {
      await live.preload()
      expect(live.toArray.map(stripVirtualProps)).toEqual([{ id: 1 }])
    } finally {
      await live.cleanup()
      await source.collection.cleanup()
    }
  })

  it.each([
    { id: 1, type: 'ref', path: ['name'] },
    { id: 2, type: 'func', name: 'user', args: [] },
    { id: 3, type: 'agg', name: 'user', args: [] },
    { id: 4, type: 'conditionalSelect', branches: [] },
    { id: 5, type: 'includesSubquery', query: {}, fieldName: 'user' },
  ])(
    'keeps a functional user result with IR-like fields: $type',
    async (expected) => {
      const source = createControlledCollection('expression-shaped-selection', [
        { id: 1 },
      ])
      try {
        const live = createLiveQueryCollection({
          query: (q) =>
            q.from({ item: source.collection }).fn.select(() => expected),
          getKey: (row) => row.id,
        })
        try {
          await live.preload()
          expect(live.toArray.map(stripVirtualProps)).toEqual([expected])
        } finally {
          await live.cleanup()
        }
      } finally {
        await source.collection.cleanup()
      }
    },
  )

  it('compares a Value-shaped predicate operand as user data', async () => {
    const payload = { type: 'val' as const, value: 42 }
    const rows: Array<{ id: number; payload: unknown }> = [
      { id: 1, payload },
      { id: 2, payload: 42 },
    ]
    const source = createControlledCollection('value-shaped-predicate', rows)
    const live = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ item: source.collection })
          .where(({ item }) => eq(item.payload, payload)),
    })

    try {
      await live.preload()
      expect(live.toArray.map(stripVirtualProps)).toEqual([rows[0]])
    } finally {
      await live.cleanup()
      await source.collection.cleanup()
    }
  })

  it('keeps one default-key findOne QueryRef row through candidate changes', async () => {
    const first = { id: 1 }
    const second = { id: 2 }
    const source = createControlledCollection('find-one-default-source', [
      first,
      second,
    ])
    const anchors = createControlledCollection('find-one-default-anchors', [
      first,
      second,
    ])
    const joined = createLiveQueryCollection({
      query: (q) => {
        const firstQuery = q
          .from({ item: source.collection })
          .select(({ item }) => ({ id: item.id }))
          .findOne()
        return q
          .from({ anchor: anchors.collection })
          .innerJoin({ first: firstQuery }, ({ anchor, first: row }) =>
            eq(anchor.id, row.id),
          )
          .select(({ first: row }) => ({ id: row.id }))
      },
      getKey: (row) => row.id,
    })
    const leading = createLiveQueryCollection({
      query: (q) => {
        const firstQuery = q
          .from({ item: source.collection })
          .select(({ item }) => ({ id: item.id }))
          .findOne()
        return q
          .from({ first: firstQuery })
          .innerJoin({ anchor: anchors.collection }, ({ first: row, anchor }) =>
            eq(row.id, anchor.id),
          )
          .select(({ first: row }) => ({ id: row.id }))
      },
      getKey: (row) => row.id,
    })

    await withHistoryCleanup(
      async () => {
        await Promise.all([joined.preload(), leading.preload()])
        for (const live of [joined, leading]) {
          expect(live.toArray.map(stripVirtualProps)).toEqual([{ id: 1 }])
        }

        source.write('delete', first)
        for (const live of [joined, leading]) {
          expect(live.toArray.map(stripVirtualProps)).toEqual([{ id: 2 }])
        }

        source.write('insert', first)
        for (const live of [joined, leading]) {
          expect(live.toArray.map(stripVirtualProps)).toEqual([{ id: 1 }])
        }
      },
      () => [
        () => joined.cleanup(),
        () => leading.cleanup(),
        () => source.collection.cleanup(),
        () => anchors.collection.cleanup(),
      ],
    )
  })
})
