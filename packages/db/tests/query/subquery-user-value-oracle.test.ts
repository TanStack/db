import { D2, MultiSet, output } from '@tanstack/db-ivm'
import { describe, expect, it } from 'vitest'
import { buildQuery } from '../../src/query/builder/index.js'
import { compileQuery } from '../../src/query/compiler/index.js'
import { collectCollectionSources } from '../../src/query/ir.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { stripVirtualProps } from '../utils.js'
import { createControlledCollection } from './includes-oracle-helpers.js'

/**
 * A QueryRef is a relational boundary: its DISTINCT result is formed before an
 * outer join and WHERE, and a source row remains user data even when its fields
 * resemble query IR. The query API and the live-query architecture's public
 * surface law authorize both expectations.
 *
 * These small finite models use ordinary array filtering, equality, and a Set
 * for DISTINCT. They do not inspect the optimized IR or either value
 * classifier. The first driver checks the compiler's complete output bag after
 * one graph run, because a keyed public Collection can collapse duplicate
 * contributors and hide a lost DISTINCT. The other drivers use real live-query
 * Collections and check user rows at preload or query construction. An excluded
 * outer row makes WHERE observable in the first history. This suite does not
 * claim coverage of every join type or IR-shaped field.
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

      const distinctGroupIds = new Set(tags.map((tag) => tag.groupId))
      const expected = people
        .filter(
          (person) => person.enabled && distinctGroupIds.has(person.groupId),
        )
        .map((person) => ({ personId: person.id, groupId: person.groupId }))
      expect(actual.sort((a, b) => a.personId - b.personId)).toEqual(expected)
    } finally {
      await persons.collection.cleanup()
      await tagRows.collection.cleanup()
    }
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
