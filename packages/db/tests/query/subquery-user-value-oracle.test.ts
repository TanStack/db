import { D2, MultiSet, output } from '@tanstack/db-ivm'
import { describe, expect, it } from 'vitest'
import { buildQuery } from '../../src/query/builder/index.js'
import { compileQuery } from '../../src/query/compiler/index.js'
import { collectCollectionSources } from '../../src/query/ir.js'
import { count, createLiveQueryCollection, eq } from '../../src/query/index.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import { stripVirtualProps } from '../utils.js'
import { createControlledCollection } from './includes-oracle-helpers.js'

/**
 * A QueryRef is a relational boundary: DISTINCT and aggregate results are
 * formed before an outer join and WHERE. Renaming a no-select QueryRef keeps
 * its source bound. Source rows and selected objects remain user data even
 * when their fields resemble query IR or proxy markers. Selected arrays of
 * references evaluate to arrays of row values. The query API
 * and the live-query architecture's public surface law authorize these rules.
 *
 * The finite DISTINCT model uses ordinary array filtering, equality, and a Set.
 * The fixed public expectations do not inspect optimized IR or either value
 * classifier. The first driver checks the compiler's complete output bag after
 * one graph run, because a keyed public Collection can collapse duplicate
 * contributors and hide a lost DISTINCT. The other drivers use real live-query
 * Collections and check public rows at preload or query construction. An
 * excluded outer row makes WHERE observable in the first history. Fixed joined
 * filters expose pushdown across DISTINCT and nested aggregate boundaries.
 * A second driver removes duplicate support one row at a time, restores it,
 * then flips the outer predicate. It compares the complete public snapshot
 * when each synchronous source write returns. This suite does not claim
 * coverage of joined findOne() results or every join type.
 */

type Person = { id: number; groupId: number; enabled: boolean }
type Tag = { id: number; groupId: number }

const people: Array<Person> = [
  { id: 1, groupId: 1, enabled: true },
  { id: 2, groupId: 2, enabled: true },
  { id: 3, groupId: 1, enabled: false },
]
const tags: Array<Tag> = [
  { id: 1, groupId: 1 },
  { id: 2, groupId: 1 },
  { id: 3, groupId: 1 },
  { id: 4, groupId: 2 },
  { id: 5, groupId: 2 },
  { id: 6, groupId: 2 },
  { id: 7, groupId: 2 },
]

// DISTINCT forms the set of child group IDs before the outer join and WHERE.
// This model deliberately ignores compiler weights and public-key reduction.
function expectedDistinctRows(
  personRows: Iterable<Person>,
  tagRows: Iterable<Tag>,
): Array<{ personId: number; groupId: number }> {
  const groups = new Set(Array.from(tagRows, (tag) => tag.groupId))
  return Array.from(personRows)
    .filter((person) => person.enabled && groups.has(person.groupId))
    .map((person) => ({ personId: person.id, groupId: person.groupId }))
    .sort((left, right) => left.personId - right.personId)
}

describe('subquery boundaries preserve operators and user rows', () => {
  it('joins the distinct subquery result before applying the outer WHERE', async () => {
    const persons = createControlledCollection<Person>(
      'distinct-outer-persons',
      people,
    )
    const tagRows = createControlledCollection<Tag>('distinct-outer-tags', tags)
    const query = buildQuery((q) => {
      const distinctGroups = q
        .from({ tag: tagRows.collection })
        .select(({ tag }) => ({ groupId: tag.groupId }))
        .distinct()
      return q
        .from({ person: persons.collection })
        .innerJoin({ group: distinctGroups }, ({ person, group }) =>
          eq(person.groupId, group.groupId),
        )
        .where(({ person }) => eq(person.enabled, true))
        .select(({ person, group }) => ({
          personId: person.id,
          groupId: group.groupId,
        }))
    })

    try {
      const graph = new D2()
      const personInput = graph.newInput<[number, Person]>()
      const tagInput = graph.newInput<[number, Tag]>()
      const refs = collectCollectionSources(query)
      const personRef = refs.find(
        (ref) => ref.collection.id === persons.collection.id,
      )!
      const tagRef = refs.find(
        (ref) => ref.collection.id === tagRows.collection.id,
      )!
      const { pipeline } = compileQuery(
        query,
        {
          [personRef.sourceId]: personInput,
          [personRef.alias]: personInput,
          [tagRef.sourceId]: tagInput,
          [tagRef.alias]: tagInput,
        },
        {
          [persons.collection.id]: persons.collection,
          [tagRows.collection.id]: tagRows.collection,
        },
        {},
        {},
        new Set(),
        {},
        () => {},
      )
      const actual: Array<{ personId: number; groupId: number }> = []
      pipeline.pipe(
        output((message) => {
          for (const [[, [row]], weight] of message.getInner()) {
            expect(Number.isSafeInteger(weight) && weight > 0).toBe(true)
            for (let index = 0; index < weight; index++) {
              actual.push({ personId: row.personId, groupId: row.groupId })
            }
          }
        }),
      )
      graph.finalize()
      personInput.sendData(
        new MultiSet(people.map((row) => [[row.id, { ...row }], 1])),
      )
      tagInput.sendData(
        new MultiSet(tags.map((row) => [[row.id, { ...row }], 1])),
      )
      graph.run()

      const expected = expectedDistinctRows(people, tags)
      // Omitting DISTINCT gives person 1 three contributors. The bag
      // comparison below must reject that plausible wrong result.
      const withoutDistinct = people
        .filter((person) => person.enabled)
        .flatMap((person) =>
          tags
            .filter((tag) => tag.groupId === person.groupId)
            .map((tag) => ({ personId: person.id, groupId: tag.groupId })),
        )
      expect(withoutDistinct).not.toEqual(expected)
      expect(actual.sort((a, b) => a.personId - b.personId)).toEqual(expected)
    } finally {
      await persons.collection.cleanup()
      await tagRows.collection.cleanup()
    }
  })

  it('recomputes a joined DISTINCT result after source writes', async () => {
    const persons = createControlledCollection<Person>(
      'distinct-history-persons',
      people,
    )
    const tagRows = createControlledCollection<Tag>(
      'distinct-history-tags',
      tags,
    )
    const live = createLiveQueryCollection({
      query: (q) => {
        const distinctGroups = q
          .from({ tag: tagRows.collection })
          .select(({ tag }) => ({ groupId: tag.groupId }))
          .distinct()
        return q
          .from({ person: persons.collection })
          .innerJoin({ group: distinctGroups }, ({ person, group }) =>
            eq(person.groupId, group.groupId),
          )
          .where(({ person }) => eq(person.enabled, true))
          .select(({ person, group }) => ({
            personId: person.id,
            groupId: group.groupId,
          }))
      },
      getKey: (row) => row.personId,
    })
    // These Maps model source Collection rows by ID, not D2 relation state.
    // Tag identity makes a later delete legal or illegal even when another
    // tag still supports the same group.
    const modelPeople = new Map(people.map((person) => [person.id, person]))
    const modelTags = new Map(tags.map((tag) => [tag.id, tag]))
    const checkPublicSnapshot = (checkpoint: string) => {
      expect(
        live.toArray
          .map(stripVirtualProps)
          .sort((left, right) => left.personId - right.personId),
        checkpoint,
      ).toEqual(expectedDistinctRows(modelPeople.values(), modelTags.values()))
    }

    await withHistoryCleanup(
      async () => {
        await live.preload()
        checkPublicSnapshot('after initial preload')

        // Removing one duplicate must leave its group in the DISTINCT result.
        for (const tag of tags.slice(0, 3)) {
          tagRows.write('delete', tag)
          modelTags.delete(tag.id)
          checkPublicSnapshot(`after deleting tag ${tag.id}`)
        }

        const replacement = { id: 8, groupId: 1 }
        tagRows.write('insert', replacement)
        modelTags.set(replacement.id, replacement)
        checkPublicSnapshot('after restoring group 1')

        const enabled = { ...people[2]!, enabled: true }
        persons.write('update', enabled)
        modelPeople.set(enabled.id, enabled)
        checkPublicSnapshot('after enabling person 3')

        const disabled = { ...people[0]!, enabled: false }
        persons.write('update', disabled)
        modelPeople.set(disabled.id, disabled)
        checkPublicSnapshot('after disabling person 1')
      },
      () => [
        () => live.cleanup(),
        () => persons.collection.cleanup(),
        () => tagRows.collection.cleanup(),
      ],
    )
  })

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
})
