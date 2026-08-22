import { describe, expect, test } from 'vitest'
import {
  add,
  count,
  createLiveQueryCollection,
  eq,
  lt,
  lte,
  materialize,
  multiply,
  toArray,
} from '../../src/query/index.js'
import { createControlledCollection } from './includes-oracle-helpers.js'

type Cleanable = { cleanup: () => Promise<void> }

async function cleanup(
  live: Cleanable,
  sources: Array<{ collection: Cleanable }>,
): Promise<void> {
  await live.cleanup()
  await Promise.all(sources.map(({ collection }) => collection.cleanup()))
}

function ids(rows: Iterable<{ id: number }>): Array<number> {
  return [...rows].map((row) => row.id)
}

describe(`correlated include route-context transport oracle`, () => {
  test(`keeps ancestor context through a nested include`, async () => {
    const parents = createControlledCollection(`nested-context-parents`, [
      { id: 1, group: 1, threshold: 2 },
      { id: 2, group: 1, threshold: 4 },
    ])
    const children = createControlledCollection(`nested-context-children`, [
      { id: 10, parentGroup: 1, group: 10 },
    ])
    const grandchildren = createControlledCollection(
      `nested-context-grandchildren`,
      [
        { id: 100, parentGroup: 10, value: 1 },
        { id: 200, parentGroup: 10, value: 3 },
      ],
    )
    const live = createLiveQueryCollection((q) =>
      q
        .from({ parent: parents.collection })
        .orderBy(({ parent }) => parent.id)
        .select(({ parent }) => {
          const childRows = () =>
            q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .select(({ child }) => {
                const grandchildRows = q
                  .from({ grandchild: grandchildren.collection })
                  .where(({ grandchild }) =>
                    eq(grandchild.parentGroup, child.group),
                  )
                  .where(({ grandchild }) =>
                    lt(grandchild.value, parent.threshold),
                  )
                  .orderBy(({ grandchild }) => grandchild.id)
                  .select(({ grandchild }) => ({ id: grandchild.id }))

                return {
                  id: child.id,
                  grandchildren: materialize(grandchildRows),
                }
              })

          return {
            id: parent.id,
            facade: childRows(),
            array: toArray(childRows()),
            materialized: materialize(childRows()),
          }
        }),
    )

    const project = (parentId: number) => {
      const row = live.get(parentId)!
      const grandchildrenOf = (
        values: Iterable<{ grandchildren: Array<{ id: number }> }>,
      ) => ids([...values][0]?.grandchildren ?? [])
      return {
        facade: grandchildrenOf(row.facade.values()),
        array: grandchildrenOf(row.array),
        materialized: grandchildrenOf(row.materialized),
      }
    }

    try {
      await live.preload()
      expect(project(1)).toEqual({
        facade: [100],
        array: [100],
        materialized: [100],
      })
      expect(project(2)).toEqual({
        facade: [100, 200],
        array: [100, 200],
        materialized: [100, 200],
      })

      parents.write(`update`, { id: 1, group: 1, threshold: 4 })
      expect(project(1)).toEqual({
        facade: [100, 200],
        array: [100, 200],
        materialized: [100, 200],
      })
    } finally {
      await cleanup(live, [parents, children, grandchildren])
    }
  })

  test(`evaluates wrapped aggregates with parent context`, async () => {
    const parents = createControlledCollection(`wrapped-aggregate-parents`, [
      { id: 1, group: 1, factor: 0 },
      { id: 2, group: 1, factor: -6 },
    ])
    const children = createControlledCollection(`wrapped-aggregate-children`, [
      { id: 10, parentGroup: 1 },
      { id: 20, parentGroup: 1 },
      { id: 30, parentGroup: 1 },
    ])
    const live = createLiveQueryCollection((q) =>
      q
        .from({ parent: parents.collection })
        .orderBy(({ parent }) => parent.id)
        .select(({ parent }) => {
          const explicit = q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .groupBy(({ child }) => child.parentGroup)
            .select(({ child }) => ({
              id: child.parentGroup,
              score: add(count(child.id), parent.factor),
            }))
          const implicit = q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .select(({ child }) => ({
              score: add(count(child.id), parent.factor),
            }))
          return {
            id: parent.id,
            explicit: materialize(explicit),
            implicit: materialize(implicit),
          }
        }),
    )

    const project = () =>
      live.toArray.map((row) => ({
        id: row.id,
        explicit: row.explicit.map(({ score }) => score),
        implicit: row.implicit.map(({ score }) => score),
      }))

    try {
      await live.preload()
      expect(project()).toEqual([
        { id: 1, explicit: [3], implicit: [3] },
        { id: 2, explicit: [-3], implicit: [-3] },
      ])

      parents.write(`update`, { id: 2, group: 1, factor: 1 })
      expect(project()[1]).toEqual({ id: 2, explicit: [4], implicit: [4] })
    } finally {
      await cleanup(live, [parents, children])
    }
  })

  test(`parameterizes a FROM QueryRef before its order and limit`, async () => {
    const parents = createControlledCollection(`from-queryref-parents`, [
      { id: 1, group: 1, direction: 1 },
      { id: 2, group: 1, direction: -1 },
    ])
    const children = createControlledCollection(`from-queryref-children`, [
      { id: 10, parentGroup: 1, value: 1 },
      { id: 20, parentGroup: 1, value: 2 },
    ])
    const live = createLiveQueryCollection((q) =>
      q
        .from({ parent: parents.collection })
        .orderBy(({ parent }) => parent.id)
        .select(({ parent }) => {
          const ordered = q
            .from({ child: children.collection })
            .orderBy(({ child }) => multiply(child.value, parent.direction))
            .limit(1)
            .select(({ child }) => ({
              id: child.id,
              parentGroup: child.parentGroup,
            }))
          const routed = q
            .from({ chosen: ordered })
            .where(({ chosen }) => eq(chosen.parentGroup, parent.group))
            .select(({ chosen }) => ({ id: chosen.id }))
          return { id: parent.id, children: materialize(routed) }
        }),
    )

    try {
      await live.preload()
      expect(live.toArray.map((row) => ids(row.children))).toEqual([[10], [20]])
    } finally {
      await cleanup(live, [parents, children])
    }
  })

  test(`parameterizes a joined QueryRef before its filter`, async () => {
    const parents = createControlledCollection(`joined-queryref-parents`, [
      { id: 1, group: 1, maximumTag: 1 },
      { id: 2, group: 1, maximumTag: 2 },
    ])
    const children = createControlledCollection(`joined-queryref-children`, [
      { id: 10, parentGroup: 1, tagId: 1 },
      { id: 20, parentGroup: 1, tagId: 2 },
    ])
    const tags = createControlledCollection(`joined-queryref-tags`, [
      { id: 1 },
      { id: 2 },
    ])
    const live = createLiveQueryCollection((q) =>
      q
        .from({ parent: parents.collection })
        .orderBy(({ parent }) => parent.id)
        .select(({ parent }) => {
          const allowedTags = q
            .from({ tag: tags.collection })
            .where(({ tag }) => lte(tag.id, parent.maximumTag))
            .select(({ tag }) => ({ id: tag.id }))
          const childRows = q
            .from({ child: children.collection })
            .innerJoin({ tag: allowedTags }, ({ child, tag }) =>
              eq(child.tagId, tag.id),
            )
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .orderBy(({ child }) => child.id)
            .select(({ child }) => ({ id: child.id }))
          return { id: parent.id, children: materialize(childRows) }
        }),
    )

    try {
      await live.preload()
      expect(live.toArray.map((row) => ids(row.children))).toEqual([
        [10],
        [10, 20],
      ])
    } finally {
      await cleanup(live, [parents, children, tags])
    }
  })

  test(`keeps parent context inside union branches`, async () => {
    const parents = createControlledCollection(`joined-union-parents`, [
      { id: 1, group: 1, maximumTag: 1 },
      { id: 2, group: 1, maximumTag: 2 },
    ])
    const children = createControlledCollection(`joined-union-children`, [
      { id: 10, parentGroup: 1, tagId: 1 },
      { id: 20, parentGroup: 1, tagId: 2 },
    ])
    const oddTags = createControlledCollection(`joined-union-odd-tags`, [
      { id: 1, parentGroup: 1 },
    ])
    const evenTags = createControlledCollection(`joined-union-even-tags`, [
      { id: 2, parentGroup: 1 },
    ])
    const live = createLiveQueryCollection((q) =>
      q
        .from({ parent: parents.collection })
        .orderBy(({ parent }) => parent.id)
        .select(({ parent }) => {
          const oddBranch = q
            .from({ oddTag: oddTags.collection })
            .where(({ oddTag }) => lte(oddTag.id, parent.maximumTag))
            .select(({ oddTag }) => ({
              id: oddTag.id,
              parentGroup: oddTag.parentGroup,
            }))
          const evenBranch = q
            .from({ evenTag: evenTags.collection })
            .where(({ evenTag }) => lte(evenTag.id, parent.maximumTag))
            .select(({ evenTag }) => ({
              id: evenTag.id,
              parentGroup: evenTag.parentGroup,
            }))
          const childRows = q
            .unionAll(oddBranch, evenBranch)
            .innerJoin({ child: children.collection }, ({ id, child }) =>
              eq(id, child.tagId),
            )
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .orderBy(({ child }) => child.id)
            .select(({ child }) => ({ id: child.id }))
          return { id: parent.id, children: materialize(childRows) }
        }),
    )

    try {
      await live.preload()
      expect(live.toArray.map((row) => ids(row.children))).toEqual([
        [10],
        [10, 20],
      ])
    } finally {
      await cleanup(live, [parents, children, oddTags, evenTags])
    }
  })

  test(`evaluates a joined-side key with its parent route`, async () => {
    const parents = createControlledCollection(`joined-key-parents`, [
      { id: 1, group: 1, offset: 0 },
      { id: 2, group: 1, offset: 1 },
    ])
    const children = createControlledCollection(`joined-key-children`, [
      { id: 10, parentGroup: 1, tagId: 2 },
    ])
    const tags = createControlledCollection(`joined-key-tags`, [
      { id: 1, label: `one` },
      { id: 2, label: `two` },
    ])
    const live = createLiveQueryCollection((q) =>
      q
        .from({ parent: parents.collection })
        .orderBy(({ parent }) => parent.id)
        .select(({ parent }) => {
          const childRows = q
            .from({ child: children.collection })
            .innerJoin({ tag: tags.collection }, ({ child, tag }) =>
              eq(add(tag.id, parent.offset), child.tagId),
            )
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .select(({ child, tag }) => ({ id: child.id, label: tag.label }))
          return { id: parent.id, children: materialize(childRows) }
        }),
    )

    try {
      await live.preload()
      expect(live.toArray.map((row) => row.children[0]?.label)).toEqual([
        `two`,
        `one`,
      ])
    } finally {
      await cleanup(live, [parents, children, tags])
    }
  })

  test(`attaches routes before correlating through a joined source`, async () => {
    const parents = createControlledCollection(`joined-correlation-parents`, [
      { id: 1, group: 1, offset: 1 },
      { id: 2, group: 2, offset: 0 },
    ])
    const children = createControlledCollection(`joined-correlation-children`, [
      { id: 10, tagId: 2 },
    ])
    const tags = createControlledCollection(`joined-correlation-tags`, [
      { id: 1, group: 1, label: `one` },
      { id: 2, group: 2, label: `two` },
    ])
    const live = createLiveQueryCollection((q) =>
      q
        .from({ parent: parents.collection })
        .orderBy(({ parent }) => parent.id)
        .select(({ parent }) => {
          const childRows = q
            .from({ child: children.collection })
            .innerJoin({ tag: tags.collection }, ({ child, tag }) =>
              eq(add(tag.id, parent.offset), child.tagId),
            )
            .where(({ tag }) => eq(tag.group, parent.group))
            .select(({ child, tag }) => ({ id: child.id, label: tag.label }))
          return { id: parent.id, children: materialize(childRows) }
        }),
    )

    try {
      await live.preload()
      expect(live.toArray.map((row) => row.children[0]?.label)).toEqual([
        `one`,
        `two`,
      ])
    } finally {
      await cleanup(live, [parents, children, tags])
    }
  })
})
