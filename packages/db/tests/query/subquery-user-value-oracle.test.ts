import { D2, MultiSet, output } from '@tanstack/db-ivm'
import { describe, expect, it } from 'vitest'
import { buildQuery } from '../../src/query/builder/index.js'
import { compileQuery } from '../../src/query/compiler/index.js'
import { collectCollectionSources } from '../../src/query/ir.js'
import {
  count,
  createLiveQueryCollection,
  eq,
  materialize,
} from '../../src/query/index.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import { declareOracle } from '../oracle-config.js'
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
 * then flips the outer predicate. The nested aggregate history compares the
 * complete public snapshot when each synchronous source write returns. The
 * joined findOne() histories check the initial, singleton, empty, restored,
 * and default-key candidate cuts. A materialized control checks the receiving
 * boundary. These bounded histories do not establish every join or schedule.
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

type DistinctRow = { personId: number; groupId: number }

// DISTINCT forms the set of child group IDs before the outer join and WHERE.
// This model deliberately ignores compiler weights and public-key reduction.
function expectedDistinctRows(
  personRows: Iterable<Person>,
  tagRows: Iterable<Tag>,
): Array<DistinctRow> {
  const groups = new Set(Array.from(tagRows, (tag) => tag.groupId))
  return Array.from(personRows)
    .filter((person) => person.enabled && groups.has(person.groupId))
    .map((person) => ({ personId: person.id, groupId: person.groupId }))
    .sort((left, right) => left.personId - right.personId)
}

/**
 * The check for the DISTINCT history: after each source write, the public rows
 * of the live query must equal the model's rows for the same source Maps. The
 * Maps model source rows by ID, so a tag delete is legal only for a tag that
 * exists, even when another tag still supports the same group.
 */
function expectPublicSnapshotFollowsModel(
  live: { readonly toArray: Array<DistinctRow> },
  modelPeople: ReadonlyMap<number, Person>,
  modelTags: ReadonlyMap<number, Tag>,
  checkpoint: string,
): void {
  expect(
    live.toArray
      .map(stripVirtualProps)
      .sort((left, right) => left.personId - right.personId),
    checkpoint,
  ).toEqual(expectedDistinctRows(modelPeople.values(), modelTags.values()))
}

/**
 * The aggregate QueryRef is one row whose total counts every source item. The
 * joined person is published only when that total equals its ID.
 */
function expectedAggregateJoinRows(
  itemRows: ReadonlyMap<number, { id: number }>,
  personRows: ReadonlyMap<number, { id: number }>,
): Array<{ personId: number; total: number }> {
  const total = itemRows.size
  return Array.from(personRows.values())
    .filter((person) => person.id === total)
    .map((person) => ({ personId: person.id, total }))
}

/**
 * The joined bag of person-tag candidates, sorted by the declared person ID.
 * An ordered findOne publishes the first candidate, and a sticky singleton
 * would keep an earlier one.
 */
function expectedFindOneCandidates(
  personRows: ReadonlyMap<number, { id: number; groupId: number }>,
  tagRows: ReadonlyMap<number, { id: number; groupId: number }>,
): Array<{ personId: number; tagId: number }> {
  return Array.from(personRows.values())
    .flatMap((person) =>
      Array.from(tagRows.values())
        .filter((tag) => tag.groupId === person.groupId)
        .map((tag) => ({ personId: person.id, tagId: tag.id })),
    )
    .sort((left, right) => left.personId - right.personId)
}

declareOracle({
  check: [expectPublicSnapshotFollowsModel],
  model: [
    expectedDistinctRows,
    expectedAggregateJoinRows,
    expectedFindOneCandidates,
  ],
})

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
    const checkPublicSnapshot = (checkpoint: string) =>
      expectPublicSnapshotFollowsModel(live, modelPeople, modelTags, checkpoint)

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

  it('recomputes a joined aggregate QueryRef after source writes', async () => {
    const initialItems = [{ id: 1 }, { id: 2 }]
    const initialPeople = [{ id: 2 }]
    const source = createControlledCollection(
      'aggregate-history-items',
      initialItems,
    )
    const persons = createControlledCollection(
      'aggregate-history-people',
      initialPeople,
    )
    const live = createLiveQueryCollection({
      query: (q) => {
        const stats = q
          .from({ item: source.collection })
          .select(({ item }) => ({
            stats: { total: count(item.id) },
          }))
        return q
          .from({ person: persons.collection })
          .innerJoin({ result: stats }, ({ person, result }) =>
            eq(person.id, result.stats.total),
          )
          .where(({ result }) => eq(result.$key, 'single_group'))
          .select(({ person, result }) => ({
            personId: person.id,
            total: result.stats.total,
          }))
      },
      getKey: (row) => row.personId,
    })
    // A full count and ordinary equality decide the expected public rows.
    // The Maps retain legal source-row identity for later deletes.
    const modelItems = new Map(initialItems.map((row) => [row.id, row]))
    const modelPeople = new Map(initialPeople.map((row) => [row.id, row]))
    const checkPublicSnapshot = (checkpoint: string) => {
      const expected = expectedAggregateJoinRows(modelItems, modelPeople)
      expect(live.toArray.map(stripVirtualProps), checkpoint).toEqual(expected)
    }

    await withHistoryCleanup(
      async () => {
        await live.preload()
        checkPublicSnapshot('after initial preload')

        const thirdItem = { id: 3 }
        source.write('insert', thirdItem)
        modelItems.set(thirdItem.id, thirdItem)
        // A stale aggregate of two would still publish person 2 here.
        expect(modelPeople.has(2)).toBe(true)
        checkPublicSnapshot('after aggregate grows past person 2')

        const thirdPerson = { id: 3 }
        persons.write('insert', thirdPerson)
        modelPeople.set(thirdPerson.id, thirdPerson)
        checkPublicSnapshot('after person 3 joins the new aggregate')

        source.write('delete', initialItems[0]!)
        modelItems.delete(initialItems[0]!.id)
        checkPublicSnapshot('after aggregate returns to two')

        source.write('delete', initialItems[1]!)
        modelItems.delete(initialItems[1]!.id)
        checkPublicSnapshot('after aggregate leaves both join keys')
      },
      () => [
        () => live.cleanup(),
        () => source.collection.cleanup(),
        () => persons.collection.cleanup(),
      ],
    )
  })

  // A flat aggregate is legal by the query builder and has the same one-row
  // count as the nested aggregate above. Check the exact public row when
  // source counts and matching people change.
  it('publishes a flat aggregate QueryRef join through source writes', async () => {
    const source = createControlledCollection('flat-aggregate-items', [
      { id: 1 },
      { id: 2 },
    ])
    const persons = createControlledCollection('flat-aggregate-people', [
      { id: 2 },
    ])
    const live = createLiveQueryCollection({
      query: (q) => {
        const stats = q
          .from({ item: source.collection })
          .select(({ item }) => ({ total: count(item.id) }))
        return q
          .from({ person: persons.collection })
          .innerJoin({ result: stats }, ({ person, result }) =>
            eq(person.id, result.total),
          )
          .where(({ result }) => eq(result.$key, 'single_group'))
          .select(({ person, result }) => ({
            personId: person.id,
            total: result.total,
          }))
      },
      getKey: (row) => row.personId,
    })

    const modelItems = new Map([
      [1, { id: 1 }],
      [2, { id: 2 }],
    ])
    const modelPeople = new Map([[2, { id: 2 }]])
    const checkPublicSnapshot = (checkpoint: string) => {
      const expected = expectedAggregateJoinRows(modelItems, modelPeople)
      expect(live.toArray.map(stripVirtualProps), checkpoint).toEqual(expected)
    }
    await withHistoryCleanup(
      async () => {
        await live.preload()
        checkPublicSnapshot('after initial preload')

        source.write('insert', { id: 3 })
        modelItems.set(3, { id: 3 })
        checkPublicSnapshot('after the aggregate grows')

        persons.write('insert', { id: 3 })
        modelPeople.set(3, { id: 3 })
        checkPublicSnapshot('after the new aggregate joins')

        source.write('delete', { id: 1 })
        modelItems.delete(1)
        checkPublicSnapshot('after the aggregate returns to two')
      },
      () => [
        () => live.cleanup(),
        () => source.collection.cleanup(),
        () => persons.collection.cleanup(),
      ],
    )
  })

  // The public builder documents findOne() as returning the first result.
  // The nested QueryRef must reduce the candidates before the outer join.
  it('publishes one ordered joined findOne QueryRef row through source writes', async () => {
    const initialPeople = [
      { id: 1, groupId: 1 },
      { id: 2, groupId: 2 },
    ]
    const initialTags = [
      { id: 10, groupId: 1 },
      { id: 20, groupId: 2 },
    ]
    const persons = createControlledCollection(
      'find-one-history-people',
      initialPeople,
    )
    const tagRows = createControlledCollection(
      'find-one-history-tags',
      initialTags,
    )
    const anchors = createControlledCollection('find-one-history-anchors', [
      { id: 1 },
      { id: 2 },
    ])
    const live = createLiveQueryCollection({
      query: (q) => {
        const firstJoined = q
          .from({ person: persons.collection })
          .innerJoin({ tag: tagRows.collection }, ({ person, tag }) =>
            eq(person.groupId, tag.groupId),
          )
          .orderBy(({ person }) => person.id, 'asc')
          .select(({ person, tag }) => ({
            personId: person.id,
            tagId: tag.id,
          }))
          .findOne()
        return q
          .from({ anchor: anchors.collection })
          .innerJoin({ first: firstJoined }, ({ anchor, first }) =>
            eq(anchor.id, first.personId),
          )
          .select(({ anchor, first }) => ({
            anchorId: anchor.id,
            tagId: first.tagId,
          }))
      },
      getKey: (row) => row.anchorId,
    })
    const modelPeople = new Map(initialPeople.map((row) => [row.id, row]))
    const modelTags = new Map(initialTags.map((row) => [row.id, row]))
    const snapshots: Array<{
      checkpoint: string
      actual: Array<{ anchorId: number; tagId: number }>
      expected: Array<{ anchorId: number; tagId: number }>
    }> = []
    const recordPublicSnapshot = (checkpoint: string) => {
      // Enumerate the joined bag, sort by the declared person ID, then take
      // one row. This reference does not use the compiler's singleton state.
      const first = expectedFindOneCandidates(modelPeople, modelTags)[0]
      const expected = first
        ? [{ anchorId: first.personId, tagId: first.tagId }]
        : []
      snapshots.push({
        checkpoint,
        actual: live.toArray.map(stripVirtualProps),
        expected,
      })
    }

    await withHistoryCleanup(
      async () => {
        await live.preload()
        recordPublicSnapshot('after initial preload')

        tagRows.write('delete', initialTags[0]!)
        modelTags.delete(initialTags[0]!.id)
        // A sticky singleton would still return person 1; the next legal
        // candidate must become the public row at this checkpoint.
        recordPublicSnapshot('after the first joined candidate disappears')

        tagRows.write('delete', initialTags[1]!)
        modelTags.delete(initialTags[1]!.id)
        recordPublicSnapshot('after all joined candidates disappear')

        const restored = { id: 11, groupId: 1 }
        tagRows.write('insert', restored)
        modelTags.set(restored.id, restored)
        recordPublicSnapshot('after the first candidate returns')

        const moved = { ...initialPeople[0]!, groupId: 2 }
        persons.write('update', moved)
        modelPeople.set(moved.id, moved)
        recordPublicSnapshot('after the first candidate changes join key')
      },
      () => [
        () => live.cleanup(),
        () => persons.collection.cleanup(),
        () => tagRows.collection.cleanup(),
        () => anchors.collection.cleanup(),
      ],
    )
    expect(snapshots).toHaveLength(5)
    for (const { checkpoint, actual, expected } of snapshots) {
      expect(actual, checkpoint).toEqual(expected)
    }
  })

  it('materializes one joined findOne value after source writes', async () => {
    const initialPeople = [
      { id: 1, groupId: 1, scope: 1 },
      { id: 2, groupId: 2, scope: 1 },
    ]
    const initialTags = [
      { id: 10, groupId: 1 },
      { id: 20, groupId: 2 },
    ]
    const persons = createControlledCollection(
      'materialized-find-one-people',
      initialPeople,
    )
    const tagRows = createControlledCollection(
      'materialized-find-one-tags',
      initialTags,
    )
    const anchors = createControlledCollection('materialized-find-one-anchor', [
      { id: 1 },
    ])
    const live = createLiveQueryCollection({
      query: (q) =>
        q.from({ anchor: anchors.collection }).select(({ anchor }) => ({
          anchorId: anchor.id,
          first: materialize(
            q
              .from({ person: persons.collection })
              .where(({ person }) => eq(person.scope, anchor.id))
              .innerJoin({ tag: tagRows.collection }, ({ person, tag }) =>
                eq(person.groupId, tag.groupId),
              )
              .orderBy(({ person }) => person.id, 'asc')
              .select(({ person, tag }) => ({
                personId: person.id,
                tagId: tag.id,
              }))
              .findOne(),
          ),
        })),
      getKey: (row) => row.anchorId,
    })
    const modelPeople = new Map(initialPeople.map((row) => [row.id, row]))
    const modelTags = new Map(initialTags.map((row) => [row.id, row]))
    const checkPublicSnapshot = (checkpoint: string) => {
      const first = expectedFindOneCandidates(modelPeople, modelTags)[0]
      const actual = live.toArray.map((row) => ({
        anchorId: row.anchorId,
        first: row.first && {
          personId: row.first.personId,
          tagId: row.first.tagId,
        },
      }))
      expect(actual, checkpoint).toEqual([{ anchorId: 1, first }])
    }

    await withHistoryCleanup(
      async () => {
        await live.preload()
        checkPublicSnapshot('after initial preload')

        tagRows.write('delete', initialTags[0]!)
        modelTags.delete(initialTags[0]!.id)
        checkPublicSnapshot('after the first joined candidate disappears')

        tagRows.write('delete', initialTags[1]!)
        modelTags.delete(initialTags[1]!.id)
        checkPublicSnapshot('after all joined candidates disappear')

        const restored = { id: 11, groupId: 1 }
        tagRows.write('insert', restored)
        modelTags.set(restored.id, restored)
        checkPublicSnapshot('after a joined candidate returns')
      },
      () => [
        () => live.cleanup(),
        () => persons.collection.cleanup(),
        () => tagRows.collection.cleanup(),
        () => anchors.collection.cleanup(),
      ],
    )
  })
})
