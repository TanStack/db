// Unit tests for alias-scope rejections, captured-source projections, spreads,
// and identity equalities. Each asserts literal rows, a thrown error, or a
// production identity equality, and none compares production with a model.
// The model-checked alias-scope cells, and the law they state (ARCHITECTURE.md
// §Identity and law 1), are in includes-alias-shadowing-oracle.test.ts.
import { describe, expect, test } from 'vitest'
import {
  Query,
  caseWhen,
  count,
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import { getQueryIR } from '../../src/query/builder/query-ir.js'
import { IncludesSubquery, PropRef } from '../../src/query/ir.js'
import { getQueryIdentity } from '../../src/query/ir-stable-identity.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import { flushPromises } from '../utils.js'
import { createScopedSource } from './includes-scope-identity-oracle.js'
import {
  initialLocks,
  initialVotes,
  voteAt,
} from './includes-alias-shadowing-support.js'
import type {
  ChildAlias,
  Context,
  Vote,
} from './includes-alias-shadowing-support.js'

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

describe(`captured alias scope oracle`, () => {
  /** A union branch and an include child are siblings, even when the union
   * feeds the parent row. The branch's private source is not an ancestor. */
  test(`an include may reuse a builder inside a sibling union branch`, async () => {
    const source = createScopedSource(
      `ancestor-union-branch-reuse`,
      [{ id: 1, parentId: 1 }],
      `eager`,
    )
    const first = new Query()
      .from({ first: source.collection })
      .select(({ first: row }) => ({ id: row.id, parentId: row.parentId }))
    const second = new Query()
      .from({ second: source.collection })
      .select(({ second: row }) => ({ id: row.id, parentId: row.parentId }))

    const live = createLiveQueryCollection({
      query: new Query()
        .unionAll(first, second)
        .innerJoin({ anchor: source.collection }, ({ id, anchor }) =>
          eq(id, anchor.id),
        )
        .select(({ anchor }) => ({
          id: anchor.id,
          children: toArray(
            first
              .where(({ first: child }) => eq(child.parentId, anchor.id))
              .select(({ first: child }) => ({ id: child.id })),
          ),
        })),
    })
    await withHistoryCleanup(
      async () => {
        await live.preload()
        expect(
          live.toArray.map(({ id, children }) => ({
            id,
            children: children.map(({ id: childId }) => ({ id: childId })),
          })),
        ).toEqual([
          { id: 1, children: [{ id: 1 }] },
          { id: 1, children: [{ id: 1 }] },
        ])
      },
      () => [() => live.cleanup(), () => source.collection.cleanup()],
    )
  })

  test(`an include may reuse a builder inside a sibling QueryRef`, async () => {
    const source = createScopedSource(
      `ancestor-queryref-source-reuse`,
      [{ id: 1, parentId: 1 }],
      `eager`,
    )
    const inner = new Query()
      .from({ inner: source.collection })
      .select(({ inner: row }) => ({ id: row.id, parentId: row.parentId }))

    const live = createLiveQueryCollection({
      query: new Query()
        .from({ wrapped: inner })
        .innerJoin({ anchor: source.collection }, ({ wrapped, anchor }) =>
          eq(wrapped.id, anchor.id),
        )
        .select(({ anchor }) => ({
          id: anchor.id,
          children: toArray(
            inner
              .where(({ inner: child }) => eq(child.parentId, anchor.id))
              .select(({ inner: child }) => ({ id: child.id })),
          ),
        })),
    })
    await withHistoryCleanup(
      async () => {
        await live.preload()
        expect(
          live.toArray.map(({ id, children }) => ({
            id,
            children: children.map(({ id: childId }) => ({ id: childId })),
          })),
        ).toEqual([{ id: 1, children: [{ id: 1 }] }])
      },
      () => [() => live.cleanup(), () => source.collection.cleanup()],
    )
  })

  test(`a functional callback reads child values under its public alias`, async () => {
    const locks = createScopedSource(`functional-locks`, initialLocks, `eager`)
    const votes = createScopedSource(`functional-votes`, initialVotes, `eager`)
    const seen: Array<{
      keys: Array<string>
      id: number | undefined
      lockId: number | undefined
      lockName: string | undefined
    }> = []
    const live = createLiveQueryCollection({
      query: new Query()
        .from({ lock: locks.collection })
        .select(({ lock: parent }) => ({
          id: parent.id,
          children: toArray(
            new Query()
              .from({ lock: votes.collection })
              .where(({ lock: child }) => eq(child.lockId, parent.id))
              .fn.where((row) => {
                const child = row.lock as Vote | undefined
                seen.push({
                  keys: Object.keys(row).sort(),
                  id: child?.id,
                  lockId: child?.lockId,
                  lockName: child?.lockName,
                })
                return child?.lockId !== undefined && child.id !== 11
              })
              .select(({ lock: child }) => ({ id: child.id })),
          ),
        })),
    })
    await withHistoryCleanup(
      async () => {
        await live.preload()
        // The callback drops vote 11. A parent row substituted for the child
        // lacks lockId and drops every child at this public checkpoint.
        expect(
          live.toArray
            .map((row) => ({
              id: row.id,
              children: row.children
                .map((child) => child.id)
                .sort((a, b) => a - b),
            }))
            .sort((a, b) => a.id - b.id),
        ).toEqual([
          { id: 1, children: [10] },
          { id: 2, children: [12] },
        ])
        expect(seen.length).toBeGreaterThan(0)
        expect(seen.some(({ id }) => id === 11)).toBe(true)
        expect(
          seen.every(
            ({ keys, id, lockId, lockName }) =>
              keys.join() === `lock` &&
              initialVotes.some(
                (vote) =>
                  vote.id === id &&
                  vote.lockId === lockId &&
                  vote.lockName === lockName,
              ),
          ),
        ).toBe(true)
      },
      () => [
        () => live.cleanup(),
        () => locks.collection.cleanup(),
        () => votes.collection.cleanup(),
      ],
    )
  })

  test(`query identity preserves binding roles and erases explicit alias spelling`, async () => {
    const locks = createScopedSource(`identity-locks`, initialLocks, `eager`)
    const votes = createScopedSource(`identity-votes`, initialVotes, `eager`)
    const make = (alias: ChildAlias, sameBinding: boolean) =>
      new Query()
        .from({ lock: locks.collection })
        .select(({ lock: parent }) => ({
          id: parent.id,
          children: toArray(
            new Query()
              .from({ [alias]: votes.collection })
              .where((context: Context) =>
                eq(voteAt(context, alias).lockId, parent.id),
              )
              .where((context: Context) =>
                eq(
                  voteAt(context, alias).id,
                  sameBinding ? voteAt(context, alias).id : parent.id,
                ),
              )
              .select((context: Context) => ({
                id: voteAt(context, alias).id,
              })),
          ),
        }))
    await withHistoryCleanup(
      () =>
        Promise.resolve().then(() => {
          const identity = (alias: ChildAlias, sameBinding: boolean) =>
            getQueryIdentity(getQueryIR(make(alias, sameBinding)))
          expect(identity(`lock`, true)).toBe(identity(`vote`, true))
          expect(identity(`lock`, false)).not.toBe(identity(`lock`, true))
        }),
      () => [
        () => locks.collection.cleanup(),
        () => votes.collection.cleanup(),
      ],
    )
  })

  test(`grouping reads the captured ancestor under a shadowed child name`, async () => {
    const locks = createScopedSource(`group-locks`, initialLocks, `eager`)
    const votes = createScopedSource(`group-votes`, initialVotes, `eager`)
    const live = createLiveQueryCollection({
      query: new Query()
        .from({ lock: locks.collection })
        .select(({ lock: parent }) => ({
          id: parent.id,
          children: toArray(
            new Query()
              .from({ lock: votes.collection })
              .where(({ lock: child }) => eq(child.lockId, parent.id))
              .groupBy(({ lock: child }) => [child.lockId, parent.id])
              .select(({ lock: child }) => ({
                lockId: child.lockId,
                total: count(child.id),
              })),
          ),
        })),
    })
    await withHistoryCleanup(
      async () => {
        await live.preload()
        expect(
          live.toArray
            .map((row) => ({
              id: row.id,
              children: row.children.map((child) => ({
                lockId: child.lockId,
                total: child.total,
              })),
            }))
            .sort((a, b) => a.id - b.id),
        ).toEqual([
          { id: 1, children: [{ lockId: 1, total: 2 }] },
          { id: 2, children: [{ lockId: 2, total: 1 }] },
        ])
      },
      () => [
        () => live.cleanup(),
        () => locks.collection.cleanup(),
        () => votes.collection.cleanup(),
      ],
    )
  })

  for (const alias of [`parent`, `child`] as const) {
    for (const mode of [`eager`, `onDemand`] as const) {
      for (const spread of [`row`, `profile`] as const) {
        test(`captured ${spread} spread keeps parent binding with ${alias} child, ${mode}`, async () => {
          const parents = createScopedSource(
            `spread-parent`,
            [{ id: 1, label: `parent`, profile: { tag: `parent-tag` } }],
            `eager`,
          )
          const children = createScopedSource(
            `spread-child`,
            [
              {
                id: 10,
                parentId: 1,
                label: `child`,
                profile: { tag: `child-tag` },
              },
            ],
            mode,
          )
          const live = createLiveQueryCollection({
            query: new Query()
              .from({ parent: parents.collection })
              .select(({ parent }) => ({
                id: parent.id,
                children: toArray(
                  new Query()
                    .from({ [alias]: children.collection })
                    .where((context: Context) =>
                      eq(
                        (context[alias] as { parentId: number }).parentId,
                        parent.id,
                      ),
                    )
                    .select((context: Context) =>
                      spread === `row`
                        ? {
                            ...parent,
                            childId: (context[alias] as { id: number }).id,
                          }
                        : {
                            ...parent.profile,
                            childId: (context[alias] as { id: number }).id,
                          },
                    ),
                ),
              })),
          })
          const check = (label: string, tag: string) => {
            const projected = (
              live.toArray[0]?.children as Array<Record<string, unknown>>
            ).map((row) =>
              spread === `row`
                ? { id: row.id, label: row.label, childId: row.childId }
                : { tag: row.tag, childId: row.childId },
            )
            expect(projected).toEqual([
              spread === `row`
                ? { id: 1, label, childId: 10 }
                : { tag, childId: 10 },
            ])
          }
          await withHistoryCleanup(
            async () => {
              await live.preload()
              check(`parent`, `parent-tag`)
              parents.put({
                id: 1,
                label: `updated-parent`,
                profile: { tag: `updated-parent-tag` },
              })
              check(`updated-parent`, `updated-parent-tag`)
              children.put({
                id: 10,
                parentId: 1,
                label: `updated-child`,
                profile: { tag: `updated-child-tag` },
              })
              check(`updated-parent`, `updated-parent-tag`)
            },
            () => [
              () => live.cleanup(),
              () => parents.collection.cleanup(),
              () => children.collection.cleanup(),
            ],
          )
        })
      }
    }
  }
})

describe(`lexical bindings through recursive joins and selections`, () => {
  test.each([`eager`, `onDemand`] as const)(
    `a self-join with a shadowed FROM alias returns the same rows with %s loading`,
    async (mode) => {
      const people = createScopedSource(
        `shadowed-self-join`,
        [
          { id: 1, managerId: 0, name: `manager` },
          { id: 2, managerId: 1, name: `A` },
          { id: 3, managerId: 1, name: `B` },
          { id: 4, managerId: 1, name: `C` },
        ],
        mode,
      )
      people.collection.createIndex((person) => person.managerId, {
        indexType: BasicIndex,
      })
      const build = (innerAlias: `user` | `u`) => {
        const managers = new Query()
          .from({ [innerAlias]: people.collection })
          .where((context: Context) =>
            eq((context[innerAlias] as { id: number }).id, 1),
          )
          .select((context: Context) => ({
            id: (context[innerAlias] as { id: number }).id,
          }))
        return createLiveQueryCollection({
          query: new Query()
            .from({ manager: managers })
            .leftJoin({ user: people.collection }, ({ manager, user }) =>
              eq(manager.id, user.managerId),
            )
            .where(({ user }) => eq(user.managerId, 1))
            .select(({ manager, user }) => ({
              managerId: manager.id,
              userId: user.id,
            })),
        })
      }
      const shadowed = build(`user`)
      const renamed = build(`u`)
      const check = (live: typeof shadowed) =>
        expect(
          live.toArray
            .map(({ managerId, userId }) => ({ managerId, userId }))
            .sort((a, b) => (a.userId ?? Infinity) - (b.userId ?? Infinity)),
        ).toEqual([
          { managerId: 1, userId: 2 },
          { managerId: 1, userId: 3 },
          { managerId: 1, userId: 4 },
        ])
      await withHistoryCleanup(
        async () => {
          await shadowed.preload()
          check(shadowed)
          await renamed.preload()
          check(shadowed)
          check(renamed)
        },
        () => [
          () => shadowed.cleanup(),
          () => renamed.cleanup(),
          () => people.collection.cleanup(),
        ],
      )
    },
  )

  test.each([`issue`, `comment`] as const)(
    `joined child keeps its local source when named %s`,
    async (childAlias) => {
      const parents = createScopedSource(
        `join-context-parent`,
        [{ id: 1 }],
        `eager`,
      )
      const children = createScopedSource(
        `join-context-child`,
        [{ id: 10, parentId: 1, anchorId: 7, title: `CHILD` }],
        `eager`,
      )
      const anchors = createScopedSource(
        `join-context-anchor`,
        [{ id: 7, parentId: 1 }],
        `eager`,
      )
      const live = createLiveQueryCollection({
        query: new Query()
          .from({ issue: parents.collection })
          .select(({ issue: parent }) => {
            const anchorQuery = new Query()
              .from({ a: anchors.collection })
              .where(({ a }) => eq(a.parentId, parent.id))
              .select(({ a }) => ({ id: a.id }))
            return {
              id: parent.id,
              children: toArray(
                new Query()
                  .from({ [childAlias]: children.collection })
                  .innerJoin({ anchor: anchorQuery }, (context: Context) =>
                    eq(
                      (context[childAlias] as { anchorId: number }).anchorId,
                      (context.anchor as { id: number }).id,
                    ),
                  )
                  .where((context: Context) =>
                    eq(
                      (context[childAlias] as { parentId: number }).parentId,
                      parent.id,
                    ),
                  )
                  .select((context: Context) => ({
                    title: (context[childAlias] as { title: string }).title,
                    anchorId: (context.anchor as { id: number }).id,
                  })),
              ),
            }
          }),
      })
      await withHistoryCleanup(
        async () => {
          await live.preload()
          // Model: child.title and anchor.id come from separate source roles.
          const check = (title: string) =>
            expect(
              live.toArray.map(({ id, children: rows }) => ({
                id,
                children: rows.map(({ title: value, anchorId }) => ({
                  title: value,
                  anchorId,
                })),
              })),
            ).toEqual([{ id: 1, children: [{ title, anchorId: 7 }] }])
          check(`CHILD`)
          children.put({ id: 10, parentId: 1, anchorId: 7, title: `UPDATED` })
          await flushPromises()
          check(`UPDATED`)
        },
        () => [
          () => live.cleanup(),
          () => parents.collection.cleanup(),
          () => children.collection.cleanup(),
          () => anchors.collection.cleanup(),
        ],
      )
    },
  )

  test.each([`issue`, `anchor`] as const)(
    `a missing joined source named %s does not read its parent alias`,
    async (joinAlias) => {
      const parents = createScopedSource(
        `missing-join-parent`,
        [{ id: 1 }],
        `eager`,
      )
      const comments = createScopedSource(
        `missing-join-comment`,
        [{ id: 10, parentId: 1, anchorId: 7 }],
        `eager`,
      )
      const anchors = createScopedSource<{ id: number }>(
        `missing-join-anchor`,
        [],
        `eager`,
      )
      const live = createLiveQueryCollection({
        query: new Query()
          .from({ issue: parents.collection })
          .select(({ issue: parent }) => ({
            id: parent.id,
            children: toArray(
              new Query()
                .from({ comment: comments.collection })
                .leftJoin(
                  { [joinAlias]: anchors.collection },
                  (context: Context) =>
                    eq(
                      (context.comment as { anchorId: number }).anchorId,
                      (context[joinAlias] as { id: number }).id,
                    ),
                )
                .where((context: Context) =>
                  eq(
                    (context.comment as { parentId: number }).parentId,
                    parent.id,
                  ),
                )
                .select((context: Context) => ({
                  childId: (context.comment as { id: number }).id,
                  parentId: parent.id,
                  joinedId: (context[joinAlias] as { id: number }).id,
                })),
            ),
          })),
      })
      await withHistoryCleanup(
        async () => {
          await live.preload()
          // Model: a left join without an anchor has no joined ID, even when
          // the missing alias is also the parent's lexical name.
          const check = (joinedId: number | undefined) =>
            expect(
              live.toArray.map(({ children }) =>
                children.map((child) => ({
                  childId: child.childId,
                  parentId: child.parentId,
                  joinedId: child.joinedId,
                })),
              ),
            ).toEqual([[{ childId: 10, parentId: 1, joinedId }]])
          check(undefined)
          anchors.put({ id: 7 })
          await flushPromises()
          check(7)
          anchors.remove(7)
          await flushPromises()
          check(undefined)
        },
        () => [
          () => live.cleanup(),
          () => parents.collection.cleanup(),
          () => comments.collection.cleanup(),
          () => anchors.collection.cleanup(),
        ],
      )
    },
  )

  test.each([`issue`, `comment`] as const)(
    `captured and local spreads keep both sources when named %s`,
    async (childAlias) => {
      const parents = createScopedSource(
        `spread-parent`,
        [{ id: 1, parentName: `PARENT` }],
        `eager`,
      )
      const children = createScopedSource(
        `spread-child`,
        [{ id: 10, parentId: 1, childName: `CHILD` }],
        `eager`,
      )
      const live = createLiveQueryCollection({
        query: new Query()
          .from({ issue: parents.collection })
          .select(({ issue: parent }) => ({
            id: parent.id,
            children: toArray(
              new Query()
                .from({ [childAlias]: children.collection })
                .where((context: Context) =>
                  eq(
                    (context[childAlias] as { parentId: number }).parentId,
                    parent.id,
                  ),
                )
                .select((context: Context) => ({
                  ...parent,
                  ...(context[childAlias] as object),
                })),
            ),
          })),
      })
      await withHistoryCleanup(
        async () => {
          await live.preload()
          // Model: the later child spread replaces shared fields only.
          const check = (parentName: string, childName: string) =>
            expect(
              live.toArray.map(({ children: rows }) =>
                rows.map((row) => {
                  const child = row as typeof row & { childName?: string }
                  return {
                    id: child.id,
                    parentName: child.parentName,
                    childName: child.childName,
                  }
                }),
              ),
            ).toEqual([[{ id: 10, parentName, childName }]])
          check(`PARENT`, `CHILD`)
          parents.put({ id: 1, parentName: `PARENT2` })
          await flushPromises()
          check(`PARENT2`, `CHILD`)
          children.put({ id: 10, parentId: 1, childName: `CHILD2` })
          await flushPromises()
          check(`PARENT2`, `CHILD2`)
        },
        () => [
          () => live.cleanup(),
          () => parents.collection.cleanup(),
          () => children.collection.cleanup(),
        ],
      )
    },
  )

  test(`a grandchild whole-row capture retains its grandparent fields`, async () => {
    const roots = createScopedSource(
      `grand-spread-root`,
      [{ id: 1, rootName: `ROOT` }],
      `eager`,
    )
    const middle = createScopedSource(
      `grand-spread-middle`,
      [{ id: 10, rootId: 1 }],
      `eager`,
    )
    const leaves = createScopedSource(
      `grand-spread-leaf`,
      [{ id: 100, middleId: 10, leafName: `LEAF` }],
      `eager`,
    )
    const live = createLiveQueryCollection({
      query: new Query()
        .from({ root: roots.collection })
        .select(({ root: grandparent }) => ({
          id: grandparent.id,
          middle: toArray(
            new Query()
              .from({ m: middle.collection })
              .where(({ m }) => eq(m.rootId, grandparent.id))
              .select(({ m: parent }) => ({
                id: parent.id,
                leaves: toArray(
                  new Query()
                    .from({ leaf: leaves.collection })
                    .where(({ leaf }) => eq(leaf.middleId, parent.id))
                    .select(({ leaf }) => ({
                      ...grandparent,
                      leafName: leaf.leafName,
                    })),
                ),
              })),
          ),
        })),
    })
    await withHistoryCleanup(
      async () => {
        await live.preload()
        // Model: the leaf belongs to middle 10, and its captured root is 1.
        const check = (rootName: string) =>
          expect(
            live.toArray.map(({ middle: rows }) =>
              rows.map(({ leaves: nested }) =>
                nested.map(({ rootName: value, leafName }) => ({
                  rootName: value,
                  leafName,
                })),
              ),
            ),
          ).toEqual([[[{ rootName, leafName: `LEAF` }]]])
        check(`ROOT`)
        roots.put({ id: 1, rootName: `ROOT2` })
        await flushPromises()
        check(`ROOT2`)
      },
      () => [
        () => live.cleanup(),
        () => roots.collection.cleanup(),
        () => middle.collection.cleanup(),
        () => leaves.collection.cleanup(),
      ],
    )
  })

  test.each([`issue`, `comment`] as const)(
    `selecting a captured alias directly keeps its binding with child %s`,
    async (childAlias) => {
      const parents = createScopedSource(
        `direct-parent`,
        [{ id: 1, name: `PARENT` }],
        `eager`,
      )
      const children = createScopedSource(
        `direct-child`,
        [{ id: 10, parentId: 1, name: `CHILD` }],
        `eager`,
      )
      const live = createLiveQueryCollection({
        query: new Query()
          .from({ issue: parents.collection })
          .select(({ issue: parent }) => ({
            id: parent.id,
            copies: toArray(
              new Query()
                .from({ [childAlias]: children.collection })
                .where((context: Context) =>
                  eq(
                    (context[childAlias] as { parentId: number }).parentId,
                    parent.id,
                  ),
                )
                .select(() => parent),
            ),
          })),
      })
      await withHistoryCleanup(
        async () => {
          await live.preload()
          const check = (name: string) =>
            expect(
              live.toArray.map(({ copies }) =>
                copies.map(({ id, name: value }) => ({ id, name: value })),
              ),
            ).toEqual([[{ id: 1, name }]])
          check(`PARENT`)
          parents.put({ id: 1, name: `PARENT2` })
          await flushPromises()
          check(`PARENT2`)
          children.put({ id: 10, parentId: 1, name: `CHILD2` })
          await flushPromises()
          check(`PARENT2`)
        },
        () => [
          () => live.cleanup(),
          () => parents.collection.cleanup(),
          () => children.collection.cleanup(),
        ],
      )
    },
  )

  /** A discarded spread may enumerate a captured proxy, but it contributes
   * no field to the selected plan. The independent relation still joins each
   * child to its parent once, and equivalent selected plans have one identity.
   * This challenges whether spread bookkeeping leaks across two enumerations
   * of the same proxy before the public row and identity checkpoints. */
  test(`discarded proxy spreads do not change rows or query identity`, async () => {
    const parents = createScopedSource(
      `discarded-spread-parent`,
      [{ id: 1, name: `PARENT` }],
      `eager`,
    )
    const children = createScopedSource(
      `discarded-spread-child`,
      [{ id: 10, parentId: 1, name: `CHILD` }],
      `eager`,
    )
    const build = (discard: boolean) =>
      new Query()
        .from({ issue: parents.collection })
        .select(({ issue: parent }) => {
          if (discard) {
            const ignored = { ...parent }
            void ignored
          }
          return {
            id: parent.id,
            children: toArray(
              new Query()
                .from({ issue: children.collection })
                .where(({ issue: child }) => eq(child.parentId, parent.id))
                .select(({ issue: child }) => ({ ...parent, ...child })),
            ),
          }
        })
    const ordinary = build(false)
    const enumerated = build(true)
    const first = createLiveQueryCollection({ query: ordinary })
    const second = createLiveQueryCollection({ query: enumerated })
    await withHistoryCleanup(
      async () => {
        expect(getQueryIdentity(getQueryIR(ordinary))).toBe(
          getQueryIdentity(getQueryIR(enumerated)),
        )
        await first.preload()
        await second.preload()
        const observe = (live: typeof first) =>
          live.toArray.map(({ id, children: rows }) => ({
            id,
            children: rows.map(({ id: childId, name }) => ({
              id: childId,
              name,
            })),
          }))
        const expected = [{ id: 1, children: [{ id: 10, name: `CHILD` }] }]
        expect(observe(first)).toEqual(expected)
        expect(observe(second)).toEqual(expected)
        children.put({ id: 10, parentId: 1, name: `UPDATED` })
        await flushPromises()
        const changed = [{ id: 1, children: [{ id: 10, name: `UPDATED` }] }]
        expect(observe(first)).toEqual(changed)
        expect(observe(second)).toEqual(changed)
      },
      () => [
        () => first.cleanup(),
        () => second.cleanup(),
        () => parents.collection.cleanup(),
        () => children.collection.cleanup(),
      ],
    )
  })
})

/**
 * # A captured source must be in the query's lexical scope
 *
 * ARCHITECTURE.md §Identity gives captured references their original source,
 * not the meaning of a later source with the same alias. A root query has no
 * ancestor; an include can use only its own sources and the containing query's
 * ancestors. The independent provenance model here has three source roles:
 * an unrelated declaration, the local main source, and the joined source.
 * Only the latter two are in scope, so a join using the unrelated declaration
 * must reject before preload can accept public rows. Renaming that declaration
 * cannot make it legal. The valid local operand and the ancestor-operand
 * matrix above distinguish this law from a validator that rejects every
 * captured reference.
 *
 * The finite grammar crosses root or include placement, eager or on-demand
 * sources, and matching or different alias spelling. It does not claim every
 * expression position or recursive source form. The driver uses public Query
 * and live-query Collection APIs; the observation cut is preload settlement.
 */
describe(`join operands reject captured sources outside lexical scope`, () => {
  type Row = { id: number }
  type ForeignAlias = `local` | `unrelated`

  for (const mode of [`eager`, `onDemand`] as const) {
    for (const placement of [`root`, `include`] as const) {
      test(`${mode} ${placement} joins reject foreign bindings regardless of alias`, async () => {
        const unrelated = createScopedSource<Row>(
          `foreign-${mode}-${placement}`,
          [{ id: 999 }],
          mode,
        )
        const local = createScopedSource<Row>(
          `foreign-local-${mode}-${placement}`,
          [{ id: 1 }],
          mode,
        )
        const joined = createScopedSource<Row>(
          `foreign-joined-${mode}-${placement}`,
          [{ id: 1 }],
          mode,
        )
        const parent = createScopedSource<Row>(
          `foreign-parent-${mode}-${placement}`,
          [{ id: 1 }],
          `eager`,
        )
        joined.collection.createIndex((row) => row.id, {
          indexType: BasicIndex,
        })

        // Capture the unrelated declaration through the same public callback
        // mechanism as a legal ancestor reference. Its row value differs from
        // the local source, so alias-based substitution would be observable.
        const capture = (alias: ForeignAlias): number => {
          let ref!: number
          new Query()
            .from({ [alias]: unrelated.collection })
            .select((context: Context) => {
              ref = (context[alias] as Row).id
              return { id: ref }
            })
          return ref
        }

        const child = (operand: number) =>
          new Query()
            .from({ local: local.collection })
            .innerJoin({ joined: joined.collection }, ({ joined: target }) =>
              eq(operand, target.id),
            )
            .select(({ local: own, joined: target }) => ({
              localId: own.id,
              joinedId: target.id,
            }))
        const invalidCleanups: Array<() => unknown | Promise<unknown>> = []
        const preloadForeign = async (alias: ForeignAlias) => {
          const operand = capture(alias)
          if (placement === `root`) {
            const live = createLiveQueryCollection({ query: child(operand) })
            invalidCleanups.push(() => live.cleanup())
            await live.preload()
            return
          }
          const live = createLiveQueryCollection({
            query: new Query()
              .from({ parent: parent.collection })
              .select(({ parent: ancestor }) => ({
                id: ancestor.id,
                rows: toArray(
                  child(operand).where(({ local: own }) =>
                    eq(own.id, ancestor.id),
                  ),
                ),
              })),
          })
          invalidCleanups.push(() => live.cleanup())
          await live.preload()
        }
        const localControl = createLiveQueryCollection({
          query: new Query()
            .from({ local: local.collection })
            .innerJoin(
              { joined: joined.collection },
              ({ local: own, joined: target }) => eq(own.id, target.id),
            )
            .select(({ local: own, joined: target }) => ({
              localId: own.id,
              joinedId: target.id,
            })),
        })

        await withHistoryCleanup(
          async () => {
            await localControl.preload()
            expect(
              localControl.toArray.map(({ localId, joinedId }) => ({
                localId,
                joinedId,
              })),
            ).toEqual([{ localId: 1, joinedId: 1 }])
            for (const alias of [`local`, `unrelated`] as const) {
              await expect(
                () => preloadForeign(alias),
                `${placement}, ${mode}, unrelated alias ${alias}`,
              ).rejects.toThrow(/out of scope/)
            }
          },
          () => [
            () => localControl.cleanup(),
            ...invalidCleanups,
            () => unrelated.collection.cleanup(),
            () => local.collection.cleanup(),
            () => joined.collection.cleanup(),
            () => parent.collection.cleanup(),
          ],
        )
      })
    }
  }
})

/**
 * # An unrelated bound reference cannot acquire a local alias's meaning
 *
 * ARCHITECTURE.md §Identity makes a captured reference name its declaration.
 * The foreign Query below is neither this query nor an ancestor, so its field
 * cannot be evaluated in a WHERE, GROUP BY, HAVING, ORDER BY, or SELECT
 * expression. The source-role model
 * predicts rejection before rows are accepted, regardless of whether the
 * foreign alias spells the local alias. A valid local reference must still
 * publish its row. This finite matrix owns those expression positions at
 * root preload; joins and recursive placements have separate cells above.
 */
describe(`non-join expressions reject unrelated bound references`, () => {
  type Row = { id: number }
  for (const position of [
    `where`,
    `groupBy`,
    `having`,
    `orderBy`,
    `select`,
    `conditionalSelect`,
  ] as const) {
    for (const alias of [`local`, `unrelated`] as const) {
      test(`${position} rejects a foreign source named ${alias}`, async () => {
        const foreign = createScopedSource<Row>(
          `foreign-${position}-${alias}`,
          [{ id: 999 }],
          `eager`,
        )
        const local = createScopedSource<Row>(
          `local-${position}-${alias}`,
          [{ id: 1 }],
          `eager`,
        )
        let foreignRef!: number
        new Query()
          .from({ [alias]: foreign.collection })
          .select((context: Context) => {
            foreignRef = (context[alias] as Row).id
            return { id: foreignRef }
          })
        const root = new Query().from({ local: local.collection })
        const createInvalid = () => {
          switch (position) {
            case `where`:
              return createLiveQueryCollection({
                query: root
                  .where(({ local: own }) => eq(foreignRef, own.id))
                  .select(({ local: own }) => ({ id: own.id })),
              })
            case `groupBy`:
              return createLiveQueryCollection({
                query: root
                  .groupBy(() => foreignRef)
                  .select(({ local: own }) => ({
                    total: count(own.id),
                  })),
              })
            case `having`:
              return createLiveQueryCollection({
                query: root
                  .groupBy(({ local: own }) => own.id)
                  .select(({ local: own }) => ({
                    id: own.id,
                    total: count(own.id),
                  }))
                  .having(() => eq(foreignRef, 999)),
              })
            case `orderBy`:
              return createLiveQueryCollection({
                query: root
                  .orderBy(() => foreignRef, `asc`)
                  .select(({ local: own }) => ({ id: own.id })),
              })
            case `select`:
              return createLiveQueryCollection({
                query: root.select(({ local: own }) => ({
                  id: own.id,
                  foreignId: foreignRef,
                })),
              })
            case `conditionalSelect`:
              return createLiveQueryCollection({
                query: root.select(({ local: own }) => ({
                  id: own.id,
                  selected: caseWhen(eq(foreignRef, own.id), own.id, 0),
                })),
              })
          }
        }
        const invalidCleanups: Array<() => unknown | Promise<unknown>> = []
        const preloadInvalid = async () => {
          const invalid = createInvalid()
          invalidCleanups.push(() => invalid.cleanup())
          await invalid.preload()
        }
        const control = createLiveQueryCollection({
          query: new Query()
            .from({ local: local.collection })
            .where(({ local: own }) => eq(own.id, 1))
            .select(({ local: own }) => ({ id: own.id })),
        })
        await withHistoryCleanup(
          async () => {
            await control.preload()
            expect(control.toArray.map(({ id }) => ({ id }))).toEqual([
              { id: 1 },
            ])
            await expect(() => preloadInvalid()).rejects.toThrow(/out of scope/)
          },
          () => [
            ...invalidCleanups,
            () => control.cleanup(),
            () => foreign.collection.cleanup(),
            () => local.collection.cleanup(),
          ],
        )
      })
    }
  }
})

/**
 * # Extracting an include filter does not grant a foreign source ancestry
 *
 * A child WHERE that also reads its actual parent is evaluated per route.
 * The builder may move that predicate into the include's parent filters, but
 * moving it does not make an unrelated bound reference a parent. The model
 * distinguishes the parent's desired ID from a foreign declaration and
 * predicts exact rows for the legal filter and rejection for the foreign one.
 * The grammar crosses foreign alias spelling and source mode. Public preload
 * is the observation cut, before any invalid rows can be accepted.
 */
describe(`include parent filters retain lexical provenance`, () => {
  type Parent = { id: number; desiredId: number }
  type Child = { id: number; parentId: number }
  for (const mode of [`eager`, `onDemand`] as const) {
    for (const foreignAlias of [`issue`, `unrelated`] as const) {
      test(`${mode} include filter rejects foreign ${foreignAlias} but accepts its parent`, async () => {
        const parent = createScopedSource<Parent>(
          `filter-parent-${mode}-${foreignAlias}`,
          [{ id: 1, desiredId: 1 }],
          `eager`,
        )
        const child = createScopedSource<Child>(
          `filter-child-${mode}-${foreignAlias}`,
          [
            { id: 1, parentId: 1 },
            { id: 2, parentId: 1 },
          ],
          mode,
        )
        const foreign = createScopedSource(
          `filter-foreign-${mode}-${foreignAlias}`,
          [{ id: 999 }],
          mode,
        )
        child.collection.createIndex((row) => row.parentId, {
          indexType: BasicIndex,
        })
        child.collection.createIndex((row) => row.id, {
          indexType: BasicIndex,
        })
        let foreignRef!: number
        new Query()
          .from({ [foreignAlias]: foreign.collection })
          .select((context: Context) => {
            foreignRef = (context[foreignAlias] as { id: number }).id
            return { id: foreignRef }
          })
        const build = (useForeign: boolean) =>
          createLiveQueryCollection({
            query: new Query()
              .from({ issue: parent.collection })
              .select(({ issue: ancestor }) => ({
                id: ancestor.id,
                rows: toArray(
                  new Query()
                    .from({ issue: child.collection })
                    .where(({ issue: own }) => eq(own.parentId, ancestor.id))
                    .where(({ issue: own }) =>
                      useForeign
                        ? eq(foreignRef, own.id)
                        : eq(own.id, ancestor.desiredId),
                    )
                    .select(({ issue: own }) => ({ id: own.id })),
                ),
              })),
          })
        const invalidCleanups: Array<() => unknown | Promise<unknown>> = []
        const preloadInvalid = async () => {
          const live = build(true)
          invalidCleanups.push(() => live.cleanup())
          await live.preload()
        }
        const valid = build(false)

        await withHistoryCleanup(
          async () => {
            await valid.preload()
            expect(
              valid.toArray.map(({ id, rows }) => ({
                id,
                rows: rows.map(({ id: childId }) => ({ id: childId })),
              })),
            ).toEqual([{ id: 1, rows: [{ id: 1 }] }])
            await expect(() => preloadInvalid()).rejects.toThrow(/out of scope/)
          },
          () => [
            () => valid.cleanup(),
            ...invalidCleanups,
            () => parent.collection.cleanup(),
            () => child.collection.cleanup(),
            () => foreign.collection.cleanup(),
          ],
        )
      })
    }
  }
})

/**
 * # Extracted include correlations still require a visible parent source
 *
 * ARCHITECTURE.md §Identity gives an include child access to its containing
 * query's declarations, not a source captured from an unrelated Query. The
 * builder removes the correlation equality from the child's WHERE, so the
 * source-role model checks that extracted field separately. A real parent
 * correlation must publish its child row. An unrelated source must reject
 * before rows are accepted, whether its alias matches the parent's or not.
 * The finite driver crosses both alias spellings and controlled source modes
 * at public preload; it makes no provider scheduling claim.
 */
describe(`extracted include correlations retain lexical provenance`, () => {
  type Parent = { id: number }
  type Child = { id: number; parentId: number }
  for (const mode of [`eager`, `onDemand`] as const) {
    for (const foreignAlias of [`issue`, `unrelated`] as const) {
      test(`${mode} correlation rejects foreign ${foreignAlias} but accepts its parent`, async () => {
        const parent = createScopedSource<Parent>(
          `correlation-parent-${mode}-${foreignAlias}`,
          [{ id: 1 }],
          `eager`,
        )
        const child = createScopedSource<Child>(
          `correlation-child-${mode}-${foreignAlias}`,
          [{ id: 10, parentId: 1 }],
          mode,
        )
        const foreign = createScopedSource<Parent>(
          `correlation-foreign-${mode}-${foreignAlias}`,
          [{ id: 999 }],
          mode,
        )
        child.collection.createIndex((row) => row.parentId, {
          indexType: BasicIndex,
        })
        let foreignRef!: number
        new Query()
          .from({ [foreignAlias]: foreign.collection })
          .select((context: Context) => {
            foreignRef = (context[foreignAlias] as Parent).id
            return { id: foreignRef }
          })
        const build = (useForeign: boolean) =>
          createLiveQueryCollection({
            query: new Query()
              .from({ issue: parent.collection })
              .select(({ issue: ancestor }) => ({
                id: ancestor.id,
                rows: toArray(
                  new Query()
                    .from({ child: child.collection })
                    .where(({ child: own }) =>
                      eq(own.parentId, useForeign ? foreignRef : ancestor.id),
                    )
                    .select(({ child: own }) => ({ id: own.id })),
                ),
              })),
          })
        const invalidCleanups: Array<() => unknown | Promise<unknown>> = []
        const preloadInvalid = async () => {
          const live = build(true)
          invalidCleanups.push(() => live.cleanup())
          await live.preload()
        }
        const valid = build(false)

        await withHistoryCleanup(
          async () => {
            await valid.preload()
            expect(
              valid.toArray.map(({ id, rows }) => ({
                id,
                rows: rows.map(({ id: childId }) => ({ id: childId })),
              })),
            ).toEqual([{ id: 1, rows: [{ id: 10 }] }])
            await expect(() => preloadInvalid()).rejects.toThrow(/out of scope/)
          },
          () => [
            () => valid.cleanup(),
            ...invalidCleanups,
            () => parent.collection.cleanup(),
            () => child.collection.cleanup(),
            () => foreign.collection.cleanup(),
          ],
        )
      })
    }
  }
})

/**
 * # A source inside a parent operand is not an include ancestor
 *
 * ARCHITECTURE.md §Identity/law 1 gives a child include access to the parent
 * query's declarations and its actual ancestors. A FROM QueryRef's own source
 * and a union branch's source are hidden behind their result rows. Capturing
 * either source's ref in an include join is therefore out of scope, whether
 * its alias matches the child's local alias or has another spelling.
 *
 * The independent provenance model here labels the inner declaration
 * `hidden` and predicts rejection; it never reads binding IDs or source-tree
 * traversal. The finite grammar crosses one or two recursive source levels,
 * QueryRef or union placement, matching or renamed hidden alias, and eager or
 * on-demand sources. Public Query and live Collection entry points must reject
 * by construction or preload, before accepting public rows. The legal local
 * and true-ancestor controls above prevent a blanket captured-ref rejection
 * from satisfying this rule. This does not claim every recursive expression
 * position; the captured value is a join operand in the include child.
 */
describe(`include joins reject sources hidden inside parent operands`, () => {
  type Hidden = { id: number; secret: number }
  type Row = { id: number }

  for (const mode of [`eager`, `onDemand`] as const) {
    for (const placement of [
      `queryRef`,
      `unionBranch`,
      `nestedQueryRef`,
      `nestedUnionBranch`,
    ] as const) {
      for (const alias of [`local`, `inner`] as const) {
        test(`${mode} ${placement} cannot expose inner binding ${alias} to its include`, async () => {
          const hidden = createScopedSource<Hidden>(
            `hidden-${mode}-${placement}`,
            [{ id: 1, secret: 999 }],
            mode,
          )
          const other = createScopedSource<Row>(
            `hidden-other-${mode}-${placement}`,
            [{ id: 2 }],
            mode,
          )
          const local = createScopedSource<Row>(
            `hidden-local-${mode}-${placement}`,
            [{ id: 1 }],
            mode,
          )
          const joined = createScopedSource<Row>(
            `hidden-joined-${mode}-${placement}`,
            [{ id: 1 }, { id: 999 }],
            mode,
          )
          local.collection.createIndex((row) => row.id, {
            indexType: BasicIndex,
          })
          joined.collection.createIndex((row) => row.id, {
            indexType: BasicIndex,
          })
          const invalidCleanups: Array<() => unknown | Promise<unknown>> = []

          const preloadHidden = async () => {
            let hiddenRef!: number
            const inner = new Query()
              .from({ [alias]: hidden.collection })
              .select((context: Context) => {
                const row = context[alias] as Hidden
                hiddenRef = row.secret
                return { id: row.id }
              })
            const branch =
              placement === `unionBranch` || placement === `nestedUnionBranch`
                ? new Query().unionAll(
                    inner,
                    new Query()
                      .from({ other: other.collection })
                      .select(({ other: row }) => ({ id: row.id })),
                  )
                : inner
            const parentSource = placement.startsWith(`nested`)
              ? new Query()
                  .from({ middle: branch })
                  .select((context: Context) => ({
                    id: (context.middle as Row).id,
                  }))
              : branch
            const outer = new Query().from({ parent: parentSource })
            const live = createLiveQueryCollection({
              query: outer.select((context: Context) => {
                const parentId = (context.parent as Row).id
                return {
                  id: parentId,
                  rows: toArray(
                    new Query()
                      .from({ local: local.collection })
                      .innerJoin(
                        { joined: joined.collection },
                        ({ joined: target }) => eq(hiddenRef, target.id),
                      )
                      .where(({ local: row }) => eq(row.id, parentId))
                      .select(({ local: row, joined: target }) => ({
                        localId: row.id,
                        joinedId: target.id,
                      })),
                  ),
                }
              }),
            })
            invalidCleanups.push(() => live.cleanup())
            await live.preload()
          }

          await withHistoryCleanup(
            async () => {
              await expect(() => preloadHidden()).rejects.toThrow(
                /out of scope/,
              )
            },
            () => [
              ...invalidCleanups,
              () => hidden.collection.cleanup(),
              () => other.collection.cleanup(),
              () => local.collection.cleanup(),
              () => joined.collection.cleanup(),
            ],
          )
        })
      }
    }
  }
})

describe(`joined subqueries reject captured sibling sources`, () => {
  type Row = { id: number }

  for (const placement of [`root`, `include`] as const) {
    for (const mode of [`eager`, `onDemand`] as const) {
      for (const alias of [`local`, `inner`] as const) {
        test(`${placement}, ${mode}, inner alias ${alias} rejects a sibling capture`, async () => {
          const main = createScopedSource<Row>(
            `sibling-main-${placement}-${mode}-${alias}`,
            [{ id: 1 }],
            mode,
          )
          const inner = createScopedSource<Row>(
            `sibling-inner-${placement}-${mode}-${alias}`,
            [{ id: 1 }],
            mode,
          )
          const probe = createScopedSource<Row>(
            `sibling-probe-${placement}-${mode}-${alias}`,
            [{ id: 1 }],
            mode,
          )
          const parent = createScopedSource<Row>(
            `sibling-parent-${placement}-${mode}-${alias}`,
            [{ id: 1 }],
            `eager`,
          )
          const invalidCleanups: Array<() => unknown | Promise<unknown>> = []

          const preloadSibling = async () => {
            let siblingRef!: number
            const base = new Query()
              .from({ local: main.collection })
              .where((context: Context) => {
                const row = context.local as Row
                siblingRef = row.id
                return eq(row.id, 1)
              })
            const joinedQuery = new Query()
              .from({ [alias]: inner.collection })
              .innerJoin({ probe: probe.collection }, ({ probe: row }) =>
                eq(siblingRef, row.id),
              )
              .select((context: Context) => ({
                id: (context[alias] as Row).id,
              }))
            const child = base
              .innerJoin({ nested: joinedQuery }, ({ local: row, nested }) =>
                eq(row.id, nested.id),
              )
              .select(({ local: row, nested }) => ({
                localId: row.id,
                joinedId: nested.id,
              }))
            const live =
              placement === `root`
                ? createLiveQueryCollection({ query: child })
                : createLiveQueryCollection({
                    query: new Query()
                      .from({ parent: parent.collection })
                      .select(({ parent: row }) => ({
                        id: row.id,
                        rows: toArray(
                          child.where(({ local: own }) => eq(own.id, row.id)),
                        ),
                      })),
                  })
            invalidCleanups.push(() => live.cleanup())
            await live.preload()
          }

          await withHistoryCleanup(
            async () => {
              await expect(() => preloadSibling()).rejects.toThrow(
                /out of scope/,
              )
            },
            () => [
              ...invalidCleanups,
              () => main.collection.cleanup(),
              () => inner.collection.cleanup(),
              () => probe.collection.cleanup(),
              () => parent.collection.cleanup(),
            ],
          )
        })
      }
    }
  }
})

/**
 * A bound ancestor reference and an unbound raw-IR reference to the child's
 * joined alias name different declarations. The small public-row control
 * checks admission at preload; it does not model arbitrary raw-IR expressions.
 */
test(`mixed bound and unbound same-alias join references name separate sources`, async () => {
  const parent = createScopedSource(`mixed-bound-parent`, [{ id: 1 }], `eager`)
  const child = createScopedSource(
    `mixed-bound-child`,
    [{ id: 10, parentId: 1 }],
    `eager`,
  )
  const local = createScopedSource(`mixed-bound-local`, [{ id: 1 }], `eager`)
  child.collection.createIndex((row) => row.parentId, {
    indexType: BasicIndex,
  })
  local.collection.createIndex((row) => row.id, {
    indexType: BasicIndex,
  })
  const live = createLiveQueryCollection({
    query: new Query()
      .from({ issue: parent.collection })
      .select(({ issue: ancestor }) => ({
        id: ancestor.id,
        rows: toArray(
          new Query()
            .from({ child: child.collection })
            .innerJoin({ issue: local.collection }, () =>
              eq(ancestor.id, new PropRef([`issue`, `id`])),
            )
            .where(({ child: row }) => eq(row.parentId, ancestor.id))
            .select(({ child: row, issue }) => ({
              childId: row.id,
              localIssueId: issue.id,
            })),
        ),
      })),
  })
  await withHistoryCleanup(
    async () => {
      await live.preload()
      expect(live.toArray.map(({ id, rows }) => ({ id, rows }))).toEqual([
        { id: 1, rows: [{ childId: 10, localIssueId: 1 }] },
      ])
    },
    () => [
      () => live.cleanup(),
      () => parent.collection.cleanup(),
      () => child.collection.cleanup(),
      () => local.collection.cleanup(),
    ],
  )
})
