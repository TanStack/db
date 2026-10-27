// Unit tests for alias-reuse rejections, a missing captured parent projection,
// and query identity under repeated spreads. These check one thrown error or
// one identity equality, not a comparison with a model. The law and its oracle
// owner are in includes-alias-shadowing-oracle.test.ts (ARCHITECTURE.md
// §Identity and law 1).
import { describe, expect, test } from 'vitest'
import {
  Query,
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import { getQueryIR } from '../../src/query/builder/query-ir.js'
import { IncludesSubquery } from '../../src/query/ir.js'
import { getQueryIdentity } from '../../src/query/ir-stable-identity.js'
import { createScopedSource } from './includes-scope-identity-oracle.js'

describe(`captured alias scope oracle`, () => {
  /**
   * One source declaration cannot play both the ancestor and descendant role.
   * The same binding ID would make the required equality ambiguous before any
   * live row is published. Sibling placement above remains legal because the
   * two fields have no ancestor/descendant relationship.
   */
  for (const placement of [`direct`, `queryRef`] as const) {
    test(`an ancestor builder reused in a ${placement} child asks for a new Query`, async () => {
      const source = createScopedSource(
        `ancestor-reuse-${placement}`,
        [
          { id: 1, parentId: 1 },
          { id: 2, parentId: 1 },
        ],
        `eager`,
      )
      const base = new Query().from({ n: source.collection })

      try {
        expect(() =>
          base.select(({ n: parent }) => ({
            id: parent.id,
            children:
              placement === `direct`
                ? toArray(
                    base
                      .where(({ n: child }) => eq(child.parentId, parent.id))
                      .select(({ n: child }) => ({ id: child.id })),
                  )
                : toArray(
                    new Query()
                      .from({
                        inner: base.select(({ n }) => ({
                          id: n.id,
                          parentId: n.parentId,
                        })),
                      })
                      .where(({ inner }) => eq(inner.parentId, parent.id))
                      .select(({ inner }) => ({ id: inner.id })),
                  ),
          })),
        ).toThrow(/new Query\(\).*instead of passing the ancestor builder/)
      } finally {
        await source.collection.cleanup()
      }
    })
  }

  test(`an ancestor binding inside a union branch asks for a new Query`, async () => {
    const source = createScopedSource(
      `ancestor-union-reuse`,
      [{ id: 1, parentId: 1 }],
      `eager`,
    )
    const base = new Query().from({ n: source.collection })
    try {
      expect(() =>
        base.select(({ n: parent }) => ({
          id: parent.id,
          children: toArray(
            new Query()
              .unionAll(
                base.select(({ n }) => ({ id: n.id, parentId: n.parentId })),
                new Query()
                  .from({ other: source.collection })
                  .select(({ other }) => ({
                    id: other.id,
                    parentId: other.parentId,
                  })),
              )
              .where(({ parentId }) => eq(parentId, parent.id))
              .select(({ id }) => ({ id })),
          ),
        })),
      ).toThrow(/new Query\(\)/)
    } finally {
      await source.collection.cleanup()
    }
  })

  test(`an ancestor binding inside a nested include asks for a new Query`, async () => {
    const source = createScopedSource(
      `ancestor-nested-reuse`,
      [{ id: 1, parentId: 1 }],
      `eager`,
    )
    const base = new Query().from({ n: source.collection })
    try {
      expect(() =>
        base.select(({ n: parent }) => ({
          id: parent.id,
          children: toArray(
            new Query()
              .from({ c: source.collection })
              .where(({ c }) => eq(c.parentId, parent.id))
              .select(({ c }) => ({
                id: c.id,
                descendants: toArray(
                  base
                    .where(({ n }) => eq(n.parentId, c.id))
                    .select(({ n }) => ({ id: n.id })),
                ),
              })),
          ),
        })),
      ).toThrow(/new Query\(\)/)
    } finally {
      await source.collection.cleanup()
    }
  })
})

/**
 * A child may use a captured ancestor only when its route projects that
 * binding. This is an internal plan invariant, separate from the public row
 * model above. Remove the projection from a legal, shadowed plan after the
 * builder made it: compilation must reject the malformed plan before a child
 * can silently read its same-named local row.
 */
test(`a missing captured parent projection fails before child rows are read`, async () => {
  const parents = createScopedSource(
    `missing-projection-parent`,
    [{ id: 1, name: `PARENT` }],
    `eager`,
  )
  const children = createScopedSource(
    `missing-projection-child`,
    [{ id: 10, parentId: 1, name: `CHILD` }],
    `eager`,
  )
  const query = new Query()
    .from({ item: parents.collection })
    .select(({ item: parent }) => ({
      id: parent.id,
      children: toArray(
        new Query()
          .from({ item: children.collection })
          .where(({ item }) => eq(item.parentId, parent.id))
          .select(({ item }) => ({
            id: item.id,
            parentName: parent.name,
          })),
      ),
    }))
  const includes = (getQueryIR(query).select as Record<string, unknown>)[
    `children`
  ]
  expect(includes).toBeInstanceOf(IncludesSubquery)
  const childPlan = includes as IncludesSubquery
  expect(childPlan.parentProjection?.length).toBeGreaterThan(0)
  childPlan.parentProjection = []
  let live: ReturnType<typeof createLiveQueryCollection> | undefined

  try {
    await expect(async () => {
      live = createLiveQueryCollection({ query })
      await live.preload()
    }).rejects.toThrow(/missing a captured parent projection/)
  } finally {
    await live?.cleanup()
    await parents.collection.cleanup()
    await children.collection.cleanup()
  }
})

describe(`lexical bindings through recursive joins and selections`, () => {
  test(`repeated captured and local spreads have stable query identity`, async () => {
    const parents = createScopedSource(
      `identity-parent`,
      [{ id: 1, name: `P` }],
      `eager`,
    )
    const children = createScopedSource(
      `identity-child`,
      [{ id: 10, parentId: 1 }],
      `eager`,
    )
    const build = () =>
      new Query()
        .from({ issue: parents.collection })
        .select(({ issue: parent }) => ({
          id: parent.id,
          children: toArray(
            new Query()
              .from({ issue: children.collection })
              .where(({ issue: child }) => eq(child.parentId, parent.id))
              .select(({ issue: child }) => ({ ...parent, ...child })),
          ),
        }))
    try {
      expect(getQueryIdentity(getQueryIR(build()))).toBe(
        getQueryIdentity(getQueryIR(build())),
      )
    } finally {
      await parents.collection.cleanup()
      await children.collection.cleanup()
    }
  })
})
