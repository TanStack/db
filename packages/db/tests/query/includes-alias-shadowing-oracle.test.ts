import { describe, expect, test } from 'vitest'
import {
  Query,
  add,
  caseWhen,
  count,
  createLiveQueryCollection,
  eq,
  gt,
  isUndefined,
  multiply,
  toArray,
} from '../../src/query/index.js'
import { getQueryIR } from '../../src/query/builder/query-ir.js'
import { PropRef } from '../../src/query/ir.js'
import { getQueryIdentity } from '../../src/query/ir-stable-identity.js'
import { optimizeQuery } from '../../src/query/optimizer.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import { flushPromises } from '../utils.js'
import { createScopedSource } from './includes-scope-identity-oracle.js'

/**
 * # Captured references survive alias shadowing
 *
 * Proposed revision of ARCHITECTURE.md §Identity and law 1: a structured
 * query may reuse an ancestor's alias. A reference captured by an earlier
 * callback still names its original source. A child source with that alias
 * remains the child, regardless of equality operand order or query placement.
 * The public row keeps the alias the user wrote; an implicit joined child has
 * that alias as a key. Same-scope and union-branch duplicates remain illegal.
 *
 * This finite oracle covers eager and on-demand children, direct and recursive
 * child plans, an implicit join, and writes after initial publication. Each
 * ancestor/descendant source declaration starts from a fresh Query; a builder
 * may still be placed in two sibling include fields. The
 * QueryRef and union paths use an inner captured name predicate beside a
 * required outer key correlation. Neither predicate implies the other. The
 * union has a nonempty right branch. It does not claim arbitrary expression
 * trees, callback equivalence under renaming, or every asynchronous acquisition
 * schedule. The primary scope oracle owns broader alias and source-history
 * generation.
 */

type Lock = { id: number; name: string }
type Vote = { id: number; lockId: number; lockName: string }
type Form = `direct` | `queryRef` | `union` | `joinedImplicit`
type OperandOrder = `childFirst` | `parentFirst`
type ChildAlias = `lock` | `vote`
type Context = Record<string, unknown>

const initialLocks: Array<Lock> = [
  { id: 1, name: `A` },
  { id: 2, name: `B` },
]
const initialVotes: Array<Vote> = [
  { id: 10, lockId: 1, lockName: `A` },
  { id: 11, lockId: 1, lockName: `B` },
  { id: 12, lockId: 2, lockName: `B` },
  { id: 15, lockId: 99, lockName: `A` },
]
// Collection rows expose these documented virtual fields in addition to the
// selected user fields. Their values are not part of this alias-scope law.
const rootVirtualKeys = [
  `$collectionId`,
  `$hasPendingWrites`,
  `$key`,
  `$origin`,
  `$synced`,
]

const voteAt = (context: Context, alias: ChildAlias): Vote =>
  context[alias] as Vote

/**
 * Model: source roles, not aliases, decide the relation. Each current lock
 * receives votes whose lockId equals its id. Recursive forms also require
 * vote.lockName to equal lock.name in their left or only branch. The union's
 * right branch supplies vote 11 when its lockId matches, preserving
 * multiplicity if both branches select it. A joined implicit child also
 * contains the matching lock row. Map replacement and deletion are the entire
 * legal write grammar; no production planner rule enters this model.
 */
function modelRows(
  locks: ReadonlyMap<number, Lock>,
  votes: ReadonlyMap<number, Vote>,
  form: Form,
  alias: ChildAlias,
) {
  return [...locks.values()]
    .map((lock) => {
      const childVotes = [
        ...[...votes.values()].filter(
          (vote) =>
            vote.lockId === lock.id &&
            ((form !== `queryRef` && form !== `union`) ||
              vote.lockName === lock.name),
        ),
        ...(form === `union`
          ? [...votes.values()].filter(
              (vote) => vote.id === 11 && vote.lockId === lock.id,
            )
          : []),
      ]
      return {
        keys: [...rootVirtualKeys, `children`, `id`],
        id: lock.id,
        children: childVotes
          .map((vote) =>
            form === `joinedImplicit`
              ? {
                  keys: [alias, `other`].sort(),
                  sourceKeys: [...rootVirtualKeys, `id`, `lockId`, `lockName`],
                  id: vote.id,
                  lockId: vote.lockId,
                  lockName: vote.lockName,
                  otherKeys: [...rootVirtualKeys, `id`, `name`],
                  otherId: lock.id,
                  otherName: lock.name,
                }
              : { keys: [`id`, `lockId`], id: vote.id, lockId: vote.lockId },
          )
          .sort((a, b) => a.id - b.id),
      }
    })
    .sort((a, b) => a.id - b.id)
}

/**
 * Observation: inspect every enumerable public key and the row values at the
 * root and child. Sorting only removes unspecified row order; multiplicity is
 * retained. The comparison runs after preload and after each committed write.
 */
function observedRows(
  live: ReturnType<typeof createLiveQueryCollection>,
  form: Form,
  alias: ChildAlias,
) {
  return live.toArray
    .map((row) => ({
      keys: Object.keys(row).sort(),
      id: row.id as number,
      children: (row.children as Array<Context>)
        .map((child) => {
          if (form !== `joinedImplicit`) {
            return {
              keys: Object.keys(child).sort(),
              id: child.id as number,
              lockId: child.lockId as number,
            }
          }
          const source = child[alias] as Vote
          const other = child.other as Lock
          return {
            keys: Object.keys(child).sort(),
            sourceKeys: Object.keys(source).sort(),
            id: source.id,
            lockId: source.lockId,
            lockName: source.lockName,
            otherKeys: Object.keys(other).sort(),
            otherId: other.id,
            otherName: other.name,
          }
        })
        .sort((a, b) => a.id - b.id),
    }))
    .sort((a, b) => a.id - b.id)
}

/** The driver builds through the public Query and live Collection entry points. */
function buildQuery(
  form: Form,
  alias: ChildAlias,
  order: OperandOrder,
  locks: ReturnType<typeof createScopedSource<Lock>>,
  votes: ReturnType<typeof createScopedSource<Vote>>,
) {
  return new Query()
    .from({ lock: locks.collection })
    .select(({ lock: parent }) => {
      const correlated = (child: Vote) =>
        order === `childFirst`
          ? eq(child.lockId, parent.id)
          : eq(parent.id, child.lockId)
      const capturedName = (child: Vote) =>
        order === `childFirst`
          ? eq(child.lockName, parent.name)
          : eq(parent.name, child.lockName)
      const base = () =>
        new Query()
          .from({ [alias]: votes.collection })
          .where((context: Context) => correlated(voteAt(context, alias)))

      const children = (() => {
        if (form === `direct`)
          return toArray(
            base().select((context: Context) => ({
              id: voteAt(context, alias).id,
              lockId: voteAt(context, alias).lockId,
            })),
          )
        if (form === `queryRef`) {
          const inner = new Query()
            .from({ [alias]: votes.collection })
            .where((context: Context) => capturedName(voteAt(context, alias)))
            .select((context: Context) => ({
              id: voteAt(context, alias).id,
              lockId: voteAt(context, alias).lockId,
            }))
          return toArray(
            new Query()
              .from({ nested: inner })
              .where(({ nested }) => eq(nested.lockId, parent.id))
              .select(({ nested }) => ({
                id: nested.id,
                lockId: nested.lockId,
              })),
          )
        }
        if (form === `union`) {
          const left = new Query()
            .from({ [alias]: votes.collection })
            .where((context: Context) => capturedName(voteAt(context, alias)))
            .select((context: Context) => ({
              id: voteAt(context, alias).id,
              lockId: voteAt(context, alias).lockId,
            }))
          const right = new Query()
            .from({ otherVote: votes.collection })
            .where(({ otherVote }) => eq(otherVote.id, 11))
            .select(({ otherVote }) => ({
              id: otherVote.id,
              lockId: otherVote.lockId,
            }))
          return toArray(
            new Query()
              .unionAll(left, right)
              .innerJoin({ anchor: locks.collection }, ({ lockId, anchor }) =>
                eq(lockId, anchor.id),
              )
              .where(({ anchor }) => eq(anchor.id, parent.id))
              .select(({ id, lockId }) => ({ id, lockId })),
          )
        }
        return toArray(
          base().innerJoin({ other: locks.collection }, (context: Context) =>
            eq(voteAt(context, alias).lockId, (context.other as Lock).id),
          ),
        )
      })()
      return { id: parent.id, children }
    })
}

/**
 * The bounded grammar crosses the reported shadowed spelling with a renamed
 * control, both equality orders, and two source modes. The QueryRef's outer
 * lockId filter cannot imply its inner lockName filter. The union's outer join
 * and filter also use lockId; its right branch contributes vote 11 without
 * the inner name predicate. The forms keep the same finite writes at every
 * checkpoint. A union with duplicate branch aliases is outside the legal
 * grammar and has its own rejection witness.
 */
describe(`captured alias scope oracle`, () => {
  for (const form of [
    `direct`,
    `queryRef`,
    `union`,
    `joinedImplicit`,
  ] as const) {
    for (const alias of [`lock`, `vote`] as const) {
      for (const order of [`childFirst`, `parentFirst`] as const) {
        for (const mode of [`eager`, `onDemand`] as const) {
          test(`${form}, ${alias}, ${order}, ${mode}: exact rows follow source roles`, async () => {
            const locks = createScopedSource(
              `shadow-locks`,
              initialLocks,
              `eager`,
            )
            const votes = createScopedSource(`shadow-votes`, initialVotes, mode)
            const modelLocks = new Map(initialLocks.map((row) => [row.id, row]))
            const modelVotes = new Map(initialVotes.map((row) => [row.id, row]))
            const live = createLiveQueryCollection({
              query: buildQuery(form, alias, order, locks, votes),
            })
            await withHistoryCleanup(
              async () => {
                await live.preload()
                const check = (checkpoint: string) =>
                  expect(observedRows(live, form, alias), checkpoint).toEqual(
                    modelRows(modelLocks, modelVotes, form, alias),
                  )
                check(`initial publication`)

                const addedVote = { id: 13, lockId: 2, lockName: `A` }
                votes.put(addedVote)
                modelVotes.set(addedVote.id, addedVote)
                check(`child insert`)

                const addedLock = { id: 3, name: `C` }
                locks.put(addedLock)
                modelLocks.set(addedLock.id, addedLock)
                check(`parent insert`)

                const newChild = { id: 14, lockId: 3, lockName: `C` }
                votes.put(newChild)
                modelVotes.set(newChild.id, newChild)
                check(`child insert after parent insert`)

                const movedVote = { id: 11, lockId: 2, lockName: `B` }
                votes.put(movedVote)
                modelVotes.set(movedVote.id, movedVote)
                check(`child moves between parents`)

                votes.remove(12)
                modelVotes.delete(12)
                check(`child delete`)

                locks.remove(1)
                modelLocks.delete(1)
                check(`parent delete`)
              },
              () => [
                () => live.cleanup(),
                () => locks.collection.cleanup(),
                () => votes.collection.cleanup(),
              ],
            )
          })
        }
      }
    }
  }

  test(`one captured child plan remains correct in two include positions`, async () => {
    const locks = createScopedSource(`reuse-locks`, initialLocks, `eager`)
    const votes = createScopedSource(`reuse-votes`, initialVotes, `eager`)
    const live = createLiveQueryCollection({
      query: new Query()
        .from({ lock: locks.collection })
        .select(({ lock: parent }) => {
          const child = new Query()
            .from({ lock: votes.collection })
            .where(({ lock: vote }) => eq(vote.lockId, parent.id))
            .select(({ lock: vote }) => ({ id: vote.id }))
          return {
            id: parent.id,
            first: toArray(child),
            second: toArray(child),
          }
        }),
    })
    await withHistoryCleanup(
      async () => {
        await live.preload()
        for (const row of live.toArray) {
          const expected = initialVotes
            .filter((vote) => vote.lockId === row.id)
            .map((vote) => ({ id: vote.id }))
            .sort((a, b) => a.id - b.id)
          expect(Object.keys(row).sort()).toEqual([
            ...rootVirtualKeys,
            `first`,
            `id`,
            `second`,
          ])
          expect(
            row.first
              .map((vote) => ({ id: vote.id }))
              .sort((a, b) => a.id - b.id),
          ).toEqual(expected)
          expect(
            row.second
              .map((vote) => ({ id: vote.id }))
              .sort((a, b) => a.id - b.id),
          ).toEqual(expected)
        }
        expect(live.toArray).toHaveLength(initialLocks.length)
      },
      () => [
        () => live.cleanup(),
        () => locks.collection.cleanup(),
        () => votes.collection.cleanup(),
      ],
    )
  })

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

  /**
   * A union branch or wrapped QueryRef feeds the parent even though its source
   * alias is not visible in the parent's callback. Reusing that declaration
   * inside an include must fail at construction. Fresh child declarations and
   * sibling reuse remain legal in the neighboring checks.
   */
  test(`an include cannot reuse a branch of its ancestor union`, async () => {
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

    try {
      expect(() =>
        new Query()
          .unionAll(first, second)
          .innerJoin({ anchor: source.collection }, ({ id, anchor }) =>
            eq(id, anchor.id),
          )
          .select(({ anchor }) => ({
            id: anchor.id,
            children: toArray(
              first.where(({ first: child }) => eq(child.parentId, anchor.id)),
            ),
          })),
      ).toThrow(/new Query\(\).*instead of passing the ancestor builder/)
    } finally {
      await source.collection.cleanup()
    }
  })

  test(`an include cannot reuse a source inside its ancestor QueryRef`, async () => {
    const source = createScopedSource(
      `ancestor-queryref-source-reuse`,
      [{ id: 1, parentId: 1 }],
      `eager`,
    )
    const inner = new Query()
      .from({ inner: source.collection })
      .select(({ inner: row }) => ({ id: row.id, parentId: row.parentId }))

    try {
      expect(() =>
        new Query()
          .from({ wrapped: inner })
          .innerJoin({ anchor: source.collection }, ({ wrapped, anchor }) =>
            eq(wrapped.id, anchor.id),
          )
          .select(({ anchor }) => ({
            id: anchor.id,
            children: toArray(
              inner.where(({ inner: child }) => eq(child.parentId, anchor.id)),
            ),
          })),
      ).toThrow(/new Query\(\).*instead of passing the ancestor builder/)
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

  /**
   * The inner QueryRef owns a different lexical scope from the include that
   * contains it. Its declarations cannot classify the captured parent ref as
   * child-local, even when both scopes read the same Collection.
   * The plain model groups each current row by parentId after preload and a
   * source update; it never consults the builder's binding IDs.
   */
  test(`fresh inner QueryRef declarations do not impersonate a captured parent`, async () => {
    const rows = [
      { id: 1, parentId: 1 },
      { id: 2, parentId: 1 },
    ]
    const source = createScopedSource(`nested-reuse`, rows, `eager`)
    const base = new Query().from({ n: source.collection })
    const live = createLiveQueryCollection({
      query: base.select(({ n: parent }) => ({
        id: parent.id,
        children: toArray(
          new Query()
            .from({
              inner: new Query()
                .from({ n: source.collection })
                .select(({ n }) => ({
                  id: n.id,
                  parentId: n.parentId,
                })),
            })
            .where(({ inner }) => eq(inner.parentId, parent.id))
            .select(({ inner }) => ({ id: inner.id })),
        ),
      })),
    })
    const check = () =>
      expect(
        live.toArray
          .map(({ id, children }) => ({
            id,
            children: children.map((child) => child.id).sort(),
          }))
          .sort((a, b) => a.id - b.id),
      ).toEqual(
        rows.map((parent) => ({
          id: parent.id,
          children: rows
            .filter((child) => child.parentId === parent.id)
            .map((child) => child.id)
            .sort(),
        })),
      )
    await withHistoryCleanup(
      async () => {
        await live.preload()
        check()
        const moved = { id: 2, parentId: 2 }
        source.put(moved)
        rows[1] = moved
        check()
      },
      () => [() => live.cleanup(), () => source.collection.cleanup()],
    )
  })

  test(`a local child equality cannot impersonate a shadowed correlation`, async () => {
    const locks = createScopedSource(
      `local-equality-locks`,
      initialLocks,
      `eager`,
    )
    const votes = createScopedSource(
      `local-equality-votes`,
      initialVotes,
      `eager`,
    )
    const live = createLiveQueryCollection({
      query: new Query()
        .from({ lock: locks.collection })
        .select(({ lock: parent }) => ({
          id: parent.id,
          children: toArray(
            new Query()
              .from({ lock: votes.collection })
              .innerJoin(
                { other: locks.collection },
                ({ lock: child, other }) => eq(child.lockId, other.id),
              )
              .where(({ lock: child, other }) => eq(child.lockId, other.id))
              .where(({ lock: child }) => eq(child.lockId, parent.id))
              .select(({ lock: child }) => ({
                id: child.id,
                lockId: child.lockId,
              })),
          ),
        })),
    })
    await withHistoryCleanup(
      async () => {
        await live.preload()
        expect(observedRows(live, `direct`, `lock`)).toEqual(
          modelRows(
            new Map(initialLocks.map((row) => [row.id, row])),
            new Map(initialVotes.map((row) => [row.id, row])),
            `direct`,
            `lock`,
          ),
        )
      },
      () => [
        () => live.cleanup(),
        () => locks.collection.cleanup(),
        () => votes.collection.cleanup(),
      ],
    )
  })

  test(`a nested include can capture its grandparent beside a shadowed child`, async () => {
    const locks = createScopedSource(`nested-locks`, initialLocks, `eager`)
    const votes = createScopedSource(`nested-votes`, initialVotes, `eager`)
    const currentVotes = new Map(initialVotes.map((vote) => [vote.id, vote]))
    const live = createLiveQueryCollection({
      query: new Query()
        .from({ lock: locks.collection })
        .select(({ lock: grandparent }) => ({
          id: grandparent.id,
          children: toArray(
            new Query()
              .from({ vote: votes.collection })
              .where(({ vote }) => eq(vote.lockId, grandparent.id))
              .select(({ vote: parent }) => ({
                id: parent.id,
                siblings: toArray(
                  new Query()
                    .from({ lock: votes.collection })
                    .where(({ lock: child }) =>
                      eq(child.lockId, grandparent.id),
                    )
                    .select(({ lock: child }) => ({ id: child.id })),
                ),
              })),
          ),
        })),
    })
    const check = () => {
      const expected = initialLocks.map((lock) => {
        const members = [...currentVotes.values()]
          .filter((vote) => vote.lockId === lock.id)
          .sort((a, b) => a.id - b.id)
        return {
          id: lock.id,
          children: members.map((member) => ({
            id: member.id,
            siblings: members.map((sibling) => sibling.id),
          })),
        }
      })
      const actual = live.toArray
        .map((lock) => ({
          id: lock.id,
          children: lock.children
            .map((child) => ({
              id: child.id,
              siblings: child.siblings.map((sibling) => sibling.id).sort(),
            }))
            .sort((a, b) => a.id - b.id),
        }))
        .sort((a, b) => a.id - b.id)
      expect(actual).toEqual(expected)
    }
    await withHistoryCleanup(
      async () => {
        await live.preload()
        check()
        const added = { id: 13, lockId: 2, lockName: `A` }
        votes.put(added)
        currentVotes.set(added.id, added)
        check()
      },
      () => [
        () => live.cleanup(),
        () => locks.collection.cleanup(),
        () => votes.collection.cleanup(),
      ],
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

  /**
   * Spread model: the parent and child have deliberately different labels and
   * profile tags. A captured parent spread contributes the parent's value at
   * both the initial and update checkpoints, whether the child shadows its
   * alias or has a distinct name. The child id remains local to the child.
   * This tests whole-row and nested-path spread lowering separately from
   * ordinary scalar PropRefs in the generated matrix above.
   */
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

/**
 * ARCHITECTURE.md §Identity and law 1 requires an outer source filter to stay
 * with that source's lexical binding. Renaming a child source cannot change
 * the rows admitted by its on-demand provider.
 * The model below reads plain parent and child maps; it has no aliases or
 * provider predicates. The grammar crosses a QueryRef join and a direct
 * include, shadowed and renamed child aliases, eager and on-demand sources,
 * and child IDs that either agree or disagree with the outer filter literal.
 * The public comparison is made after preload, before cleanup can change rows.
 */
describe(`outer filters stay with their source under alias shadowing`, () => {
  type Parent = { id: number; linkId: number }
  type Child = { id: number; linkId: number }
  type PlacementForm = `join` | `include`

  const model = (
    form: PlacementForm,
    parents: ReadonlyMap<number, Parent>,
    children: ReadonlyMap<number, Child>,
  ) =>
    [...parents.values()]
      .filter((parent) => parent.id === 1)
      .map((parent) =>
        form === `join`
          ? { id: parent.id, joinedId: children.get(parent.linkId)?.id }
          : {
              id: parent.id,
              children: [...children.values()]
                .filter((child) => child.linkId === parent.id)
                .map((child) => child.id),
            },
      )

  for (const form of [`join`, `include`] as const) {
    for (const mode of [`eager`, `onDemand`] as const) {
      for (const childId of [1, 2] as const) {
        test(`${form}, ${mode}, child ID ${childId}: projected rows follow source roles`, async () => {
          const parentRow = { id: 1, linkId: childId }
          const childRow = { id: childId, linkId: 1 }
          const expected = model(
            form,
            new Map([[parentRow.id, parentRow]]),
            new Map([[childRow.id, childRow]]),
          )
          const cases = ([`u`, `v`] as const).map((alias) => {
            const parents = createScopedSource(
              `outer-filter-parent-${form}-${mode}-${childId}-${alias}`,
              [parentRow],
              mode,
            )
            const children = createScopedSource(
              `outer-filter-child-${form}-${mode}-${childId}-${alias}`,
              [childRow],
              mode,
            )
            children.collection.createIndex((child) => child.id, {
              indexType: BasicIndex,
            })
            const childQuery = new Query()
              .from({ [alias]: children.collection })
              .select((context: Context) => ({
                id: (context[alias] as Child).id,
                linkId: (context[alias] as Child).linkId,
              }))
            const root = new Query()
              .from({ u: parents.collection })
              .where(({ u }) => eq(u.id, 1))
            const live =
              form === `join`
                ? createLiveQueryCollection({
                    query: root
                      .leftJoin({ w: childQuery }, ({ u, w }) =>
                        eq(u.linkId, w.id),
                      )
                      .select(({ u, w }) => ({ id: u.id, joinedId: w.id })),
                  })
                : createLiveQueryCollection({
                    query: root.select(({ u: parent }) => ({
                      id: parent.id,
                      children: toArray(
                        new Query()
                          .from({ [alias]: children.collection })
                          .where((context: Context) =>
                            eq((context[alias] as Child).linkId, parent.id),
                          )
                          .select((context: Context) => ({
                            id: (context[alias] as Child).id,
                          })),
                      ),
                    })),
                  })
            return {
              alias,
              parents,
              children,
              live,
            }
          })

          await withHistoryCleanup(
            async () => {
              for (const entry of cases) {
                await entry.live.preload()
                const rows = [...entry.live.toArray].map((row) =>
                  form === `join`
                    ? {
                        id: row.id,
                        joinedId: (row as { joinedId?: number }).joinedId,
                      }
                    : {
                        id: row.id,
                        children: (
                          row as { children: Array<{ id: number }> }
                        ).children.map((child) => child.id),
                      },
                )
                expect(rows, `${entry.alias}: public rows`).toEqual(expected)
                if (mode === `onDemand`) {
                  expect(
                    entry.children.collection.toArray.map((child) => child.id),
                    `${entry.alias}: child provider admission`,
                  ).toEqual([childId])
                }
              }
            },
            () =>
              cases.flatMap((entry) => [
                () => entry.live.cleanup(),
                () => entry.parents.collection.cleanup(),
                () => entry.children.collection.cleanup(),
              ]),
          )
        })
      }
    }
  }
})

/**
 * ARCHITECTURE.md §Identity and law 1 requires a projected parent field to
 * remain parent-dependent through a child QueryRef.
 * The model includes a child when its parent has rank A, regardless of the
 * child's own rank. Changing the child's alias is semantically inert. The
 * history checks initial publication, a child-rank change, and a parent-rank
 * change through the public include result; on-demand source rows additionally
 * show whether a pushed provider predicate incorrectly excludes the child.
 */
describe(`captured projections keep their binding during predicate pushdown`, () => {
  type Parent = { id: number; rank: string }
  type Child = { id: number; parentId: number; rank: string }
  type Anchor = { id: number }

  const model = (
    parents: ReadonlyMap<number, Parent>,
    children: ReadonlyMap<number, Child>,
    anchors: ReadonlyMap<number, Anchor>,
  ) =>
    [...parents.values()].map((parent) => ({
      id: parent.id,
      matches:
        parent.rank === `A`
          ? [...children.values()]
              .filter(
                (child) =>
                  child.parentId === parent.id && anchors.has(child.id),
              )
              .map((child) => child.id)
          : [],
    }))

  for (const mode of [`eager`, `onDemand`] as const) {
    test(`${mode}: parent rank controls the child result under both child aliases`, async () => {
      const parentRow = { id: 1, rank: `A` }
      const childRow = { id: 10, parentId: 1, rank: `Z` }
      const anchorRow = { id: 10 }
      const parentsModel = new Map([[parentRow.id, parentRow]])
      const childrenModel = new Map([[childRow.id, childRow]])
      const anchorsModel = new Map([[anchorRow.id, anchorRow]])
      const cases = ([`p`, `c`] as const).map((alias) => {
        const parents = createScopedSource(
          `projected-parent-${mode}-${alias}`,
          [parentRow],
          mode,
        )
        const children = createScopedSource(
          `projected-child-${mode}-${alias}`,
          [childRow],
          mode,
        )
        const anchors = createScopedSource(
          `projected-anchor-${mode}-${alias}`,
          [anchorRow],
          mode,
        )
        children.collection.createIndex((child) => child.id, {
          indexType: BasicIndex,
        })
        anchors.collection.createIndex((anchor) => anchor.id, {
          indexType: BasicIndex,
        })
        const query = new Query()
          .from({ p: parents.collection })
          .select(({ p: parent }) => {
            const inner = new Query()
              .from({ [alias]: children.collection })
              .select((context: Context) => {
                const child = context[alias] as Child
                return {
                  id: child.id,
                  parentId: child.parentId,
                  rank: parent.rank,
                }
              })
            return {
              id: parent.id,
              matches: toArray(
                new Query()
                  .from({ q: inner })
                  .innerJoin({ a: anchors.collection }, ({ q, a }) =>
                    eq(q.id, a.id),
                  )
                  .where(({ q }) => eq(q.parentId, parent.id))
                  .where(({ q }) => eq(q.rank, `A`))
                  .select(({ q }) => ({ id: q.id })),
              ),
            }
          })
        return {
          alias,
          parents,
          children,
          anchors,
          live: createLiveQueryCollection({ query }),
        }
      })

      const check = (checkpoint: string) => {
        const expected = model(parentsModel, childrenModel, anchorsModel)
        for (const entry of cases) {
          expect(
            entry.live.toArray.map(({ id, matches }) => ({
              id,
              matches: matches.map((match) => match.id),
            })),
            `${checkpoint}: ${entry.alias} public rows`,
          ).toEqual(expected)
        }
      }

      await withHistoryCleanup(
        async () => {
          for (const entry of cases) await entry.live.preload()
          check(`initial`)
          if (mode === `onDemand`) {
            for (const entry of cases) {
              expect(
                entry.children.collection.toArray.map((child) => child.id),
                `${entry.alias}: initial child provider admission`,
              ).toEqual([10])
            }
          }

          const changedChild = { ...childRow, rank: `A` }
          childrenModel.set(changedChild.id, changedChild)
          for (const entry of cases) entry.children.put(changedChild)
          await flushPromises()
          check(`child rank changed`)

          const changedParent = { ...parentRow, rank: `Z` }
          parentsModel.set(changedParent.id, changedParent)
          for (const entry of cases) entry.parents.put(changedParent)
          await flushPromises()
          check(`parent rank changed`)
        },
        () =>
          cases.flatMap((entry) => [
            () => entry.live.cleanup(),
            () => entry.parents.collection.cleanup(),
            () => entry.children.collection.cleanup(),
            () => entry.anchors.collection.cleanup(),
          ]),
      )
    })
  }
})

/**
 * # Group keys keep lexical bindings when paths have the same spelling
 *
 * ARCHITECTURE.md §Identity and law 1 allow an include child to shadow its
 * parent alias. Both scopes may have a `rank` field. Grouping by the captured
 * parent rank and local child rank must then project each value from its own
 * source. Renaming the child alias cannot change an explicitly selected row.
 *
 * The finite grammar crosses shadowed/renamed child aliases and both group-key
 * orders. The history starts with duplicate and distinct child ranks, then
 * changes a child rank and a parent rank. The model below counts plain child
 * rows by rank for each parent; it does not inspect IR or reuse grouping code.
 * The driver uses public Query, live Collection, and source writes. At each
 * checkpoint it compares every projected group value and count. Other
 * aggregate expressions and recursive source placements remain outside this
 * cell.
 */
describe(`same-path group keys across alias scopes`, () => {
  type RankParent = { id: number; rank: string }
  type RankChild = { id: number; parentId: number; rank: string }

  const initialParents: Array<RankParent> = [
    { id: 1, rank: `parent-A` },
    { id: 2, rank: `parent-B` },
  ]
  const initialChildren: Array<RankChild> = [
    { id: 10, parentId: 1, rank: `child-X` },
    { id: 11, parentId: 1, rank: `child-Y` },
    { id: 12, parentId: 2, rank: `child-Z` },
    { id: 13, parentId: 1, rank: `child-X` },
  ]

  // Model: one group per distinct child rank under each parent. The parent
  // rank is constant for that parent but remains a separate selected value.
  const modelRowsForRanks = (
    parents: ReadonlyMap<number, RankParent>,
    children: ReadonlyMap<number, RankChild>,
  ) =>
    [...parents.values()]
      .map((parent) => {
        const counts = new Map<string, number>()
        for (const child of children.values()) {
          if (child.parentId !== parent.id) continue
          counts.set(child.rank, (counts.get(child.rank) ?? 0) + 1)
        }
        return {
          id: parent.id,
          groups: [...counts]
            .map(([childRank, total]) => ({
              parentRank: parent.rank,
              childRank,
              total,
            }))
            .sort((a, b) => a.childRank.localeCompare(b.childRank)),
        }
      })
      .sort((a, b) => a.id - b.id)

  for (const alias of [`parent`, `child`] as const) {
    for (const order of [`parentFirst`, `childFirst`] as const) {
      test(`group values retain ${alias} child binding with ${order} keys`, async () => {
        const parentRows = new Map(initialParents.map((row) => [row.id, row]))
        const childRows = new Map(initialChildren.map((row) => [row.id, row]))
        const parents = createScopedSource(
          `rank-parents`,
          initialParents,
          `eager`,
        )
        const children = createScopedSource(
          `rank-children`,
          initialChildren,
          `eager`,
        )
        const childAt = (context: Context) => context[alias] as RankChild
        const live = createLiveQueryCollection({
          query: new Query()
            .from({ parent: parents.collection })
            .select(({ parent }) => ({
              id: parent.id,
              groups: toArray(
                new Query()
                  .from({ [alias]: children.collection })
                  .where((context: Context) =>
                    eq(childAt(context).parentId, parent.id),
                  )
                  .groupBy((context: Context) =>
                    order === `parentFirst`
                      ? [parent.rank, childAt(context).rank]
                      : [childAt(context).rank, parent.rank],
                  )
                  .select((context: Context) => ({
                    parentRank: parent.rank,
                    childRank: childAt(context).rank,
                    total: count(childAt(context).id),
                  })),
              ),
            })),
        })

        // Observation: order between groups is unspecified, while each
        // selected value and group multiplicity is part of the public row.
        const check = (checkpoint: string) => {
          const observed = live.toArray
            .map(({ id, groups }) => ({
              id,
              groups: groups
                .map(({ parentRank, childRank, total }) => ({
                  parentRank,
                  childRank,
                  total,
                }))
                .sort((a, b) => a.childRank.localeCompare(b.childRank)),
            }))
            .sort((a, b) => a.id - b.id)
          expect(observed, checkpoint).toEqual(
            modelRowsForRanks(parentRows, childRows),
          )
        }

        await withHistoryCleanup(
          async () => {
            await live.preload()
            check(`after preload`)
            const changedChild = { id: 11, parentId: 1, rank: `child-X` }
            childRows.set(changedChild.id, changedChild)
            children.put(changedChild)
            await flushPromises()
            check(`after child rank change`)
            const changedParent = { id: 1, rank: `parent-A2` }
            parentRows.set(changedParent.id, changedParent)
            parents.put(changedParent)
            await flushPromises()
            check(`after parent rank change`)
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
})

/**
 * # A redundant wrapper does not change alpha-normalized identity
 *
 * ARCHITECTURE.md §Identity makes aliases lexical names and says an explicit
 * projection can erase their spelling from query identity. The model is a
 * plain source-row projection: both queries below select the same `id` and
 * `label` values. The grammar renames both source declarations in a pure
 * wrapper together and changes one source row after preload. The public driver
 * checks those rows at both checkpoints, then compares the two optimized IR
 * identities. An optimizer that collapses the wrapper but leaves a reference
 * bound to its vanished outer declaration fails the identity comparison.
 * This cell does not assert that every semantically equivalent query shape
 * has the same identity.
 */
test(`optimized redundant wrappers erase alias spelling`, async () => {
  const initial = { id: 1, label: `first` }
  const source = createScopedSource(`wrapper-alpha`, [initial], `eager`)
  const model = new Map([[initial.id, initial]])
  const named = new Query()
    .from({ n: new Query().from({ n: source.collection }) })
    .select(({ n }) => ({ id: n.id, label: n.label }))
  const renamed = new Query()
    .from({ x: new Query().from({ x: source.collection }) })
    .select(({ x }) => ({ id: x.id, label: x.label }))
  const namedIR = getQueryIR(named)
  const renamedIR = getQueryIR(renamed)
  const namedLive = createLiveQueryCollection({ query: named })
  const renamedLive = createLiveQueryCollection({ query: renamed })

  // Observation: the rows establish the same public meaning before the
  // identity assertion; the model reads only its own plain Map.
  const checkRows = (checkpoint: string) => {
    const expected = [...model.values()]
      .map(({ id, label }) => ({ id, label }))
      .sort((a, b) => a.id - b.id)
    for (const live of [namedLive, renamedLive]) {
      expect(
        live.toArray
          .map(({ id, label }) => ({ id, label }))
          .sort((a, b) => a.id - b.id),
        checkpoint,
      ).toEqual(expected)
    }
  }

  await withHistoryCleanup(
    async () => {
      await Promise.all([namedLive.preload(), renamedLive.preload()])
      checkRows(`after preload`)
      const changed = { id: 1, label: `second` }
      model.set(changed.id, changed)
      source.put(changed)
      await flushPromises()
      checkRows(`after source change`)
      expect(getQueryIdentity(namedIR)).toBe(getQueryIdentity(renamedIR))
      expect(getQueryIdentity(optimizeQuery(namedIR).optimizedQuery)).toBe(
        getQueryIdentity(optimizeQuery(renamedIR).optimizedQuery),
      )
    },
    () => [
      () => namedLive.cleanup(),
      () => renamedLive.cleanup(),
      () => source.collection.cleanup(),
    ],
  )
})

/**
 * # An include's alias cannot broaden a lazy join's source request
 *
 * ARCHITECTURE.md law 1 makes accepted alias renaming unobservable in explicit
 * results. Its physical-work law also excludes unrelated source rows when an
 * exact indexed join key is available. A nested include belongs to a child
 * scope, so changing only its alias cannot turn a keyed user request into a
 * full-source request.
 *
 * The finite history moves one eager anchor from user 1 to user 2, then
 * changes user 2. The plain model joins current anchor and user Maps by ID.
 * Separately, the work model tracks newly demanded user IDs at each checkpoint.
 * The driver runs shadowed and distinct include aliases with direct and
 * wrapped child sources against finite on-demand providers. The wrapper
 * challenges both the child's collection map and its alias remapping. The
 * observation compares public rows and independently interprets each recorded
 * provider WHERE over both finite user rows. This cell does not claim arbitrary
 * join predicates, include materialization through joined QueryRefs, or all
 * provider scheduling cuts.
 */
describe(`lazy join demand across nested alias scopes`, () => {
  type Anchor = { id: number; userId: number }
  type User = { id: number; name: string }
  type Post = { id: number; userId: number }
  type PostAlias = `u` | `post`
  type PostPlacement = `direct` | `wrapped`

  const initialAnchor: Anchor = { id: 1, userId: 1 }
  const initialUsers: Array<User> = [
    { id: 1, name: `one` },
    { id: 2, name: `two` },
  ]
  const initialPosts: Array<Post> = [
    { id: 10, userId: 1 },
    { id: 20, userId: 2 },
  ]

  const record = (value: unknown): Record<string, unknown> => {
    if (value === null || typeof value !== `object` || Array.isArray(value)) {
      throw new Error(`Unexpected provider predicate value`)
    }
    return value as Record<string, unknown>
  }

  // Model for the provider boundary: interpret the small public predicate
  // vocabulary over finite user IDs. A null WHERE matches every user and is
  // therefore observable as extra work, even if the final joined row is right.
  const requestValue = (node: unknown, user: User): unknown => {
    const expression = record(node)
    if (expression.type === `val`) return expression.value
    if (
      expression.type === `ref` &&
      Array.isArray(expression.path) &&
      expression.path.length === 1 &&
      expression.path[0] === `id`
    ) {
      return user.id
    }
    throw new Error(`Unexpected provider value expression`)
  }

  const requestMatches = (node: unknown, user: User): boolean => {
    if (node === null) return true
    const expression = record(node)
    if (expression.type !== `func` || !Array.isArray(expression.args)) {
      throw new Error(`Unexpected provider predicate`)
    }
    const args = expression.args
    if (expression.name === `and`) {
      return args.every((arg) => requestMatches(arg, user))
    }
    if (expression.name === `or`) {
      return args.some((arg) => requestMatches(arg, user))
    }
    if (args.length !== 2) throw new Error(`Unexpected predicate arity`)
    const left = requestValue(args[0], user)
    const right = requestValue(args[1], user)
    if (expression.name === `eq`) return left === right
    if (expression.name === `in` && Array.isArray(right)) {
      return right.includes(left)
    }
    throw new Error(`Unexpected provider predicate operator`)
  }

  const modelJoinedRows = (
    anchors: ReadonlyMap<number, Anchor>,
    users: ReadonlyMap<number, User>,
  ) =>
    [...anchors.values()]
      .map((anchor) => {
        const user = users.get(anchor.userId)
        return {
          anchorId: anchor.id,
          userId: user?.id,
          name: user?.name,
        }
      })
      .sort((a, b) => a.anchorId - b.anchorId)

  const buildCase = (postAlias: PostAlias, placement: PostPlacement) => {
    const anchors = createScopedSource(
      `lazy-alias-anchors-${postAlias}-${placement}`,
      [initialAnchor],
      `eager`,
    )
    const users = createScopedSource(
      `lazy-alias-users-${postAlias}-${placement}`,
      initialUsers,
      `onDemand`,
    )
    const posts = createScopedSource(
      `lazy-alias-posts-${postAlias}-${placement}`,
      initialPosts,
      `eager`,
    )
    users.collection.createIndex((user) => user.id, { indexType: BasicIndex })
    posts.collection.createIndex((post) => post.userId, {
      indexType: BasicIndex,
    })
    const postSource =
      placement === `direct`
        ? posts.collection
        : new Query().from({ postSource: posts.collection })
    const inner = new Query()
      .from({ u: users.collection })
      .select(({ u: user }) => ({
        ...user,
        posts: toArray(
          new Query()
            .from({ [postAlias]: postSource })
            .where((context: Context) =>
              eq((context[postAlias] as Post).userId, user.id),
            )
            .select((context: Context) => ({
              id: (context[postAlias] as Post).id,
            })),
        ),
      }))
    const live = createLiveQueryCollection({
      query: new Query()
        .from({ a: anchors.collection })
        .leftJoin({ w: inner }, ({ a, w }) => eq(a.userId, w.id))
        .select(({ a, w }) => ({
          anchorId: a.id,
          userId: w.id,
          name: w.name,
        })),
    })
    return { anchors, users, posts, live, requestCount: 0 }
  }

  test(`direct and wrapped shadowed includes preserve keyed user demand through writes`, async () => {
    const anchors = new Map([[initialAnchor.id, initialAnchor]])
    const users = new Map(initialUsers.map((user) => [user.id, user]))
    // In this one-way history, a key requested at an earlier checkpoint is
    // already covered. Only a newly reached anchor can add an uncovered key.
    const covered = new Set<number>()
    const cases = [
      buildCase(`post`, `direct`),
      buildCase(`u`, `direct`),
      buildCase(`post`, `wrapped`),
      buildCase(`u`, `wrapped`),
    ]

    // Refinement checkpoint: each new request may cover only newly demanded
    // user rows. Compare rows against plain recomputation as a separate law.
    const check = (checkpoint: string) => {
      const expectedRows = modelJoinedRows(anchors, users)
      const newlyDemanded = [
        ...new Set([...anchors.values()].map((anchor) => anchor.userId)),
      ]
        .filter((id) => !covered.has(id))
        .sort((a, b) => a - b)
      for (const id of newlyDemanded) covered.add(id)

      for (const entry of cases) {
        const rows = entry.live.toArray
          .map(({ anchorId, userId, name }) => ({ anchorId, userId, name }))
          .sort((a, b) => a.anchorId - b.anchorId)
        expect(rows, `${checkpoint}: public rows`).toEqual(expectedRows)
        const newRequests = entry.users.requests.slice(entry.requestCount)
        const requestedIds = new Set<number>()
        for (const request of newRequests) {
          const where = JSON.parse(request) as unknown
          for (const user of initialUsers) {
            if (requestMatches(where, user)) requestedIds.add(user.id)
          }
        }
        expect(
          [...requestedIds].sort((a, b) => a - b),
          `${checkpoint}: provider work for ${entry.users.collection.id}`,
        ).toEqual(newlyDemanded)
        entry.requestCount = entry.users.requests.length
      }
    }

    await withHistoryCleanup(
      async () => {
        await Promise.all(cases.map((entry) => entry.live.preload()))
        check(`after preload`)
        const moved = { id: 1, userId: 2 }
        anchors.set(moved.id, moved)
        for (const entry of cases) entry.anchors.put(moved)
        await flushPromises()
        check(`after anchor movement`)
        const changed = { id: 2, name: `two-updated` }
        users.set(changed.id, changed)
        for (const entry of cases) entry.users.put(changed)
        await flushPromises()
        check(`after user change`)
      },
      () =>
        cases.flatMap((entry) => [
          () => entry.live.cleanup(),
          () => entry.anchors.collection.cleanup(),
          () => entry.users.collection.cleanup(),
          () => entry.posts.collection.cleanup(),
        ]),
    )
  })
})

/**
 * # Lexical source bindings survive recursive joins and whole-row selection
 *
 * ARCHITECTURE.md §Identity and law 1 say that a nested source may shadow an
 * ancestor or sibling name. Each captured reference still reads its declared
 * source. The independent model below joins plain rows by role and applies
 * ordinary object spread order. Its names do not affect the expected rows.
 *
 * This finite grammar crosses shadowed and renamed aliases, eager and
 * on-demand joined sources, and initial and post-write public snapshots. It
 * reaches QueryRef sources, joined include children, two spreads constructed
 * by different callbacks, a grandchild whole-row capture, and direct alias
 * selection. It does not cover arbitrary join trees or provider schedules.
 */
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

  test.each([`eager`, `onDemand`] as const)(
    `a shadowed FROM subquery preserves joined rows with %s loading`,
    async (mode) => {
      type Manager = { id: number; name: string }
      type User = { id: number; managerId: number; name: string }
      const managerRows: Array<Manager> = [
        { id: 1, name: `one` },
        { id: 2, name: `two` },
      ]
      const userRows: Array<User> = [
        { id: 10, managerId: 1, name: `A` },
        { id: 11, managerId: 1, name: `B` },
        { id: 12, managerId: 2, name: `C` },
      ]
      const managers = createScopedSource(
        `recursive-managers`,
        managerRows,
        `eager`,
      )
      const users = createScopedSource(`recursive-users`, userRows, mode)
      const modelUsers = new Map(userRows.map((row) => [row.id, row]))
      users.collection.createIndex((user) => user.managerId, {
        indexType: BasicIndex,
      })

      const build = (innerAlias: `user` | `member`) => {
        const inner = new Query()
          .from({ [innerAlias]: managers.collection })
          .select((context: Context) => ({
            id: (context[innerAlias] as Manager).id,
          }))
        return createLiveQueryCollection({
          query: new Query()
            .from({ manager: inner })
            .leftJoin({ user: users.collection }, ({ manager, user }) =>
              eq(manager.id, user.managerId),
            )
            .select(({ manager, user }) => ({
              managerId: manager.id,
              userId: user.id,
              userName: user.name,
            })),
        })
      }
      const shadowed = build(`user`)
      const renamed = build(`member`)

      // Model: each manager joins its matching users, regardless of spelling.
      type ExpectedRow = {
        managerId: number
        userId: number | undefined
        userName: string | undefined
      }
      const expected = (): Array<ExpectedRow> =>
        managerRows
          .flatMap((manager): Array<ExpectedRow> => {
            const matching = [...modelUsers.values()].filter(
              (user) => user.managerId === manager.id,
            )
            return matching.length > 0
              ? matching.map((user) => ({
                  managerId: manager.id,
                  userId: user.id,
                  userName: user.name,
                }))
              : [
                  {
                    managerId: manager.id,
                    userId: undefined,
                    userName: undefined,
                  },
                ]
          })
          .sort((a, b) => (a.userId ?? Infinity) - (b.userId ?? Infinity))
      const check = (checkpoint: string) => {
        for (const live of [shadowed, renamed]) {
          expect(
            live.toArray
              .map(({ managerId, userId, userName }) => ({
                managerId,
                userId,
                userName,
              }))
              .sort((a, b) => (a.userId ?? Infinity) - (b.userId ?? Infinity)),
            checkpoint,
          ).toEqual(expected())
        }
      }

      await withHistoryCleanup(
        async () => {
          await shadowed.preload()
          // On-demand sources are shared; check shadowing before the renamed
          // control can supply rows that conceal a missed source request.
          expect(
            shadowed.toArray
              .map(({ managerId, userId, userName }) => ({
                managerId,
                userId,
                userName,
              }))
              .sort((a, b) => (a.userId ?? Infinity) - (b.userId ?? Infinity)),
          ).toEqual(expected())
          await renamed.preload()
          check(`after preload`)
          const changed = { id: 12, managerId: 1, name: `C2` }
          modelUsers.set(changed.id, changed)
          users.put(changed)
          await flushPromises()
          check(`after user moves between managers`)
        },
        () => [
          () => shadowed.cleanup(),
          () => renamed.cleanup(),
          () => managers.collection.cleanup(),
          () => users.collection.cleanup(),
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

/**
 * ARCHITECTURE.md §Identity promises that a source in a nested query keeps its
 * identity when its alias matches an outer join. A captured outer row also
 * remains outer when the child selects its fields or spreads the whole row.
 * Renaming the child alias therefore cannot change the public relation.
 *
 * This grammar crosses a child FROM or JOIN, field or whole-row capture,
 * shadowed or renamed spelling, and eager or on-demand child sources. Its
 * history moves a detail, changes the captured assignment, and moves that
 * assignment between managers. The fixture keeps at most one outer joined row and one child row
 * per anchor, so their default public keys remain unambiguous. It checks rows
 * and, in on-demand mode, source requests after each committed write. It does
 * not cover RIGHT or FULL joins, arbitrary join trees, or provider scheduling
 * outside this controlled finite source.
 */
describe(`nested source placement preserves captured outer rows`, () => {
  type Manager = { id: number; name: string }
  type Assignment = { id: number; managerId: number; ownerTag: string }
  type Detail = { id: number; managerId: number; label: string }
  type Capture = `fields` | `spread`

  const initialManagers: Array<Manager> = [
    { id: 1, name: `ONE` },
    { id: 2, name: `TWO` },
  ]
  const initialAssignments: Array<Assignment> = [
    { id: 101, managerId: 1, ownerTag: `OUTER` },
  ]
  const initialDetails: Array<Detail> = [
    { id: 201, managerId: 1, label: `A` },
    { id: 202, managerId: 2, label: `B` },
  ]

  /**
   * Model: plain source roles determine a joined assignment and each
   * manager's details. The child placement and aliases do not enter this
   * computation. A later detail spread replaces its assignment's `id` only;
   * fields with different names retain their source values.
   */
  const model = (
    managers: ReadonlyMap<number, Manager>,
    assignments: ReadonlyMap<number, Assignment>,
    details: ReadonlyMap<number, Detail>,
    capture: Capture,
  ) =>
    [...managers.values()]
      .flatMap((manager) => {
        const matching = [...assignments.values()].filter(
          (assignment) => assignment.managerId === manager.id,
        )
        return matching.map((assignment) => ({
          managerId: manager.id,
          managerName: manager.name,
          assignmentId: assignment.id,
          details: [...details.values()]
            .filter((detail) => detail.managerId === manager.id)
            .map((detail) =>
              capture === `fields`
                ? {
                    outerAssignmentId: assignment.id,
                    detailId: detail.id,
                    label: detail.label,
                  }
                : {
                    id: detail.id,
                    managerId: detail.managerId,
                    ownerTag: assignment.ownerTag,
                    label: detail.label,
                  },
            )
            .sort((a, b) => (a.detailId ?? a.id) - (b.detailId ?? b.id)),
        }))
      })
      .sort((a, b) => a.managerId - b.managerId)

  for (const placement of [`from`, `join`] as const) {
    for (const capture of [`fields`, `spread`] as const) {
      for (const mode of [`eager`, `onDemand`] as const) {
        test(`${placement}, ${capture}, ${mode}: shadowing and renaming agree at every write cut`, async () => {
          const managersModel = new Map(
            initialManagers.map((row) => [row.id, row]),
          )
          const assignmentsModel = new Map(
            initialAssignments.map((row) => [row.id, row]),
          )
          const detailsModel = new Map(
            initialDetails.map((row) => [row.id, row]),
          )
          const cases = ([`user`, `detail`] as const).map((alias) => {
            const managers = createScopedSource(
              `placement-managers-${placement}-${capture}-${mode}-${alias}`,
              initialManagers,
              `eager`,
            )
            const assignments = createScopedSource(
              `placement-assignments-${placement}-${capture}-${mode}-${alias}`,
              initialAssignments,
              mode,
            )
            const details = createScopedSource(
              `placement-details-${placement}-${capture}-${mode}-${alias}`,
              initialDetails,
              mode,
            )
            const anchors = createScopedSource(
              `placement-anchors-${placement}-${capture}-${mode}-${alias}`,
              initialManagers.map(({ id }) => ({ id })),
              `eager`,
            )
            managers.collection.createIndex((row) => row.id, {
              indexType: BasicIndex,
            })
            assignments.collection.createIndex((row) => row.managerId, {
              indexType: BasicIndex,
            })
            details.collection.createIndex((row) => row.managerId, {
              indexType: BasicIndex,
            })
            anchors.collection.createIndex((row) => row.id, {
              indexType: BasicIndex,
            })
            const live = createLiveQueryCollection({
              query: new Query()
                .from({ manager: managers.collection })
                .innerJoin(
                  { user: assignments.collection },
                  ({ manager, user }) => eq(manager.id, user.managerId),
                )
                .select(({ manager, user }) => {
                  const project = (context: Context) => {
                    const detail = context[alias] as Detail
                    return capture === `fields`
                      ? {
                          outerAssignmentId: user.id,
                          detailId: detail.id,
                          label: detail.label,
                        }
                      : { ...user, ...detail }
                  }
                  const child =
                    placement === `from`
                      ? new Query()
                          .from({ [alias]: details.collection })
                          .where((context: Context) =>
                            eq(
                              (context[alias] as Detail).managerId,
                              manager.id,
                            ),
                          )
                          .select(project)
                      : new Query()
                          .from({ anchor: anchors.collection })
                          .innerJoin(
                            { [alias]: details.collection },
                            (context: Context) =>
                              eq(
                                (context[alias] as Detail).managerId,
                                (context.anchor as { id: number }).id,
                              ),
                          )
                          .where((context: Context) =>
                            eq(
                              (context.anchor as { id: number }).id,
                              manager.id,
                            ),
                          )
                          .select(project)
                  return {
                    managerId: manager.id,
                    managerName: manager.name,
                    assignmentId: user.id,
                    details: toArray(child),
                  }
                }),
            })
            return { alias, managers, assignments, details, anchors, live }
          })

          const observe = (live: (typeof cases)[number][`live`]) =>
            live.toArray
              .map((row) => ({
                managerId: row.managerId,
                managerName: row.managerName,
                assignmentId: row.assignmentId,
                details: (row.details as Array<Record<string, unknown>>)
                  .map((detail) =>
                    capture === `fields`
                      ? {
                          outerAssignmentId: detail.outerAssignmentId as number,
                          detailId: detail.detailId as number,
                          label: detail.label as string,
                        }
                      : {
                          id: detail.id as number,
                          managerId: detail.managerId as number,
                          ownerTag: detail.ownerTag as string,
                          label: detail.label as string,
                        },
                  )
                  .sort((a, b) => (a.detailId ?? a.id) - (b.detailId ?? b.id)),
              }))
              .sort((a, b) => a.managerId - b.managerId)

          await withHistoryCleanup(
            async () => {
              for (const entry of cases) await entry.live.preload()
              const check = (cut: string) => {
                const expected = model(
                  managersModel,
                  assignmentsModel,
                  detailsModel,
                  capture,
                )
                for (const entry of cases) {
                  expect(
                    observe(entry.live),
                    `${entry.alias} at ${cut}`,
                  ).toEqual(expected)
                }
                if (mode === `onDemand`) {
                  for (const source of [`assignments`, `details`] as const) {
                    expect(cases[0]![source].requests.length).toBeGreaterThan(0)
                    expect(
                      [...cases[0]![source].requests].sort(),
                      `${source} requests at ${cut}`,
                    ).toEqual([...cases[1]![source].requests].sort())
                  }
                }
              }
              check(`initial publication`)

              detailsModel.delete(201)
              for (const entry of cases) entry.details.remove(201)
              await flushPromises()
              check(`detail removal`)

              const movedDetail = { id: 202, managerId: 1, label: `B2` }
              detailsModel.set(movedDetail.id, movedDetail)
              for (const entry of cases) entry.details.put(movedDetail)
              await flushPromises()
              check(`detail moves between managers`)

              const changedAssignment = {
                id: 101,
                managerId: 1,
                ownerTag: `OUTER2`,
              }
              assignmentsModel.set(changedAssignment.id, changedAssignment)
              for (const entry of cases)
                entry.assignments.put(changedAssignment)
              await flushPromises()
              check(`captured assignment changes`)

              const movedAssignment = {
                id: 101,
                managerId: 2,
                ownerTag: `OUTER2`,
              }
              assignmentsModel.set(movedAssignment.id, movedAssignment)
              for (const entry of cases) entry.assignments.put(movedAssignment)
              await flushPromises()
              check(`outer joined row moves`)

              const returnedDetail = { id: 202, managerId: 2, label: `B3` }
              detailsModel.set(returnedDetail.id, returnedDetail)
              for (const entry of cases) entry.details.put(returnedDetail)
              await flushPromises()
              check(`detail follows moved assignment`)

              const renamedManager = { id: 2, name: `TWO2` }
              managersModel.set(renamedManager.id, renamedManager)
              for (const entry of cases) entry.managers.put(renamedManager)
              await flushPromises()
              check(`captured outer row changes`)
            },
            () =>
              cases.flatMap((entry) => [
                () => entry.live.cleanup(),
                () => entry.managers.collection.cleanup(),
                () => entry.assignments.collection.cleanup(),
                () => entry.details.collection.cleanup(),
                () => entry.anchors.collection.cleanup(),
              ]),
          )
        })
      }
    }
  }
})

/**
 * # An absent join side is not an ancestor with the same alias
 *
 * ARCHITECTURE.md §Identity promises that source bindings survive shadowing.
 * RIGHT and FULL joins can produce a row with no main side. The child main
 * source is then absent even if its lexical alias spells an ancestor's name.
 * A FULL join can also have no joined side. Renaming a child alias cannot
 * change an explicit projection. The parent correlation is attached to the
 * side that remains present, so every expected row has a defined route.
 *
 * The model below pairs plain source rows by their key values, supplies the
 * missing side as undefined, and then restricts pairs to the current parent.
 * It does not read compiler namespaces or route metadata. The finite history
 * crosses RIGHT/FULL, both FULL correlation sides, shadowed/renamed aliases,
 * direct and QueryRef joined sources, eager/on-demand loading, and transitions
 * between matched and absent sides.
 */
describe(`outer joins preserve absent source bindings under shadowing`, () => {
  type Parent = { id: number; marker: string }
  type Main = {
    id: number
    parentId: number
    anchorId: number
    label: string
  }
  type Anchor = { id: number; parentId: number }
  type JoinKind = `right` | `full`
  type CorrelationSide = `main` | `joined`
  type Expected = {
    parentId: number
    mainId: number | undefined
    anchorId: number | undefined
    label: string | undefined
    marker: string
    missingMain: boolean
    missingAnchor: boolean
  }

  const sortRows = (rows: Array<Expected>) =>
    rows.sort(
      (a, b) =>
        a.parentId - b.parentId ||
        (a.anchorId ?? Infinity) - (b.anchorId ?? Infinity) ||
        (a.mainId ?? Infinity) - (b.mainId ?? Infinity),
    )

  /** Plain relational recomputation; alias text and source mode are absent. */
  const model = (
    parents: ReadonlyMap<number, Parent>,
    mains: ReadonlyMap<number, Main>,
    anchors: ReadonlyMap<number, Anchor>,
    kind: JoinKind,
    correlationSide: CorrelationSide,
  ): Array<Expected> => {
    const mainRows = [...mains.values()]
    const anchorRows = [...anchors.values()]
    const pairs: Array<[Main | undefined, Anchor | undefined]> = []
    for (const anchor of anchorRows) {
      const matches = mainRows.filter((main) => main.anchorId === anchor.id)
      if (matches.length > 0) {
        for (const main of matches) pairs.push([main, anchor])
      } else {
        pairs.push([undefined, anchor])
      }
    }
    if (kind === `full`) {
      for (const main of mainRows) {
        if (!anchorRows.some((anchor) => anchor.id === main.anchorId)) {
          pairs.push([main, undefined])
        }
      }
    }
    return sortRows(
      [...parents.values()].flatMap((parent) =>
        pairs
          .filter(([main, anchor]) =>
            correlationSide === `joined`
              ? anchor?.parentId === parent.id
              : main?.parentId === parent.id,
          )
          .map(([main, anchor]) => ({
            parentId: parent.id,
            mainId: main?.id,
            anchorId: anchor?.id,
            label: main?.label,
            marker: parent.marker,
            missingMain: main === undefined,
            missingAnchor: anchor === undefined,
          })),
      ),
    )
  }

  for (const [kind, correlationSide] of [
    [`right`, `joined`],
    [`right`, `main`],
    [`full`, `joined`],
    [`full`, `main`],
  ] as const) {
    for (const mode of [`eager`, `onDemand`] as const) {
      test(`${kind} with ${correlationSide} correlation and ${mode} sources keeps absent sides absent`, async () => {
        const parentRows = new Map<number, Parent>([
          [1, { id: 1, marker: `PARENT` }],
          [2, { id: 2, marker: `OTHER` }],
        ])
        const mainRows = new Map<number, Main>([
          [10, { id: 10, parentId: 1, anchorId: 7, label: `MATCH` }],
          [11, { id: 11, parentId: 1, anchorId: 9, label: `MAIN ONLY` }],
          [21, { id: 21, parentId: 2, anchorId: 20, label: `OTHER MATCH` }],
        ])
        const anchorRows = new Map<number, Anchor>([
          [7, { id: 7, parentId: 1 }],
          [8, { id: 8, parentId: 1 }],
          [20, { id: 20, parentId: 2 }],
        ])
        const cases = ([`queryRef`, `direct`] as const).flatMap((sourceForm) =>
          ([`issue`, `child`] as const).map((alias) => {
            const parents = createScopedSource(
              `outer-parent-${kind}-${correlationSide}-${mode}-${sourceForm}-${alias}`,
              [...parentRows.values()],
              `eager`,
            )
            const mains = createScopedSource(
              `outer-main-${kind}-${correlationSide}-${mode}-${sourceForm}-${alias}`,
              [...mainRows.values()],
              mode,
            )
            const anchors = createScopedSource(
              `outer-anchor-${kind}-${correlationSide}-${mode}-${sourceForm}-${alias}`,
              [...anchorRows.values()],
              mode,
            )
            mains.collection.createIndex((row) => row.anchorId, {
              indexType: BasicIndex,
            })
            mains.collection.createIndex((row) => row.parentId, {
              indexType: BasicIndex,
            })
            anchors.collection.createIndex((row) => row.parentId, {
              indexType: BasicIndex,
            })
            anchors.collection.createIndex((row) => row.id, {
              indexType: BasicIndex,
            })
            const live = createLiveQueryCollection({
              query: new Query()
                .from({ issue: parents.collection })
                .select(({ issue: parent }) => {
                  const main = new Query().from({ [alias]: mains.collection })
                  const scopedAnchors = new Query()
                    .from({ source: anchors.collection })
                    .where(({ source }) => eq(source.parentId, parent.id))
                    .select(({ source }) => ({
                      id: source.id,
                      parentId: source.parentId,
                    }))
                  const on = (context: Context) =>
                    eq(
                      (context[alias] as Main).anchorId,
                      (context.anchor as Anchor).id,
                    )
                  const anchorSource =
                    sourceForm === `direct` ? anchors.collection : scopedAnchors
                  const joined = main.join({ anchor: anchorSource }, on, kind)
                  expect(getQueryIR(joined).join?.[0]?.from.type).toBe(
                    sourceForm === `direct` ? `collectionRef` : `queryRef`,
                  )
                  return {
                    id: parent.id,
                    rows: toArray(
                      joined
                        .where((context: Context) =>
                          correlationSide === `joined`
                            ? eq((context.anchor as Anchor).parentId, parent.id)
                            : eq((context[alias] as Main).parentId, parent.id),
                        )
                        .select((context: Context) => ({
                          mainId: (context[alias] as Main).id,
                          anchorId: (context.anchor as Anchor).id,
                          label: (context[alias] as Main).label,
                          marker: parent.marker,
                          missingMain: isUndefined((context[alias] as Main).id),
                          missingAnchor: isUndefined(
                            (context.anchor as Anchor).id,
                          ),
                        })),
                    ),
                  }
                }),
            })
            return { sourceForm, alias, parents, mains, anchors, live }
          }),
        )

        /** Compare every public result after preload and each committed write. */
        const observe = (live: (typeof cases)[number][`live`]) =>
          sortRows(
            live.toArray.flatMap(({ id, rows }) =>
              rows.map((row) => ({
                parentId: id,
                mainId: row.mainId,
                anchorId: row.anchorId,
                label: row.label,
                marker: row.marker,
                missingMain: row.missingMain,
                missingAnchor: row.missingAnchor,
              })),
            ),
          )

        await withHistoryCleanup(
          async () => {
            for (const entry of cases) await entry.live.preload()
            const check = (cut: string) => {
              const expected = model(
                parentRows,
                mainRows,
                anchorRows,
                kind,
                correlationSide,
              )
              for (const entry of cases) {
                expect(
                  observe(entry.live),
                  `${entry.sourceForm}, ${entry.alias} at ${cut}`,
                ).toEqual(expected)
                if (mode === `onDemand`) {
                  expect(entry.mains.requests.length).toBeGreaterThan(0)
                  expect(entry.anchors.requests.length).toBeGreaterThan(0)
                }
              }
            }
            check(`initial publication`)

            const changedMain = {
              id: 10,
              parentId: 1,
              anchorId: 7,
              label: `UPDATED`,
            }
            mainRows.set(10, changedMain)
            for (const entry of cases) entry.mains.put(changedMain)
            await flushPromises()
            check(`matched main update`)

            mainRows.delete(10)
            for (const entry of cases) entry.mains.remove(10)
            await flushPromises()
            check(`main becomes absent`)

            mainRows.set(10, changedMain)
            for (const entry of cases) entry.mains.put(changedMain)
            await flushPromises()
            check(`main returns`)

            const secondMatch = {
              id: 12,
              parentId: 1,
              anchorId: 8,
              label: `SECOND`,
            }
            mainRows.set(12, secondMatch)
            for (const entry of cases) entry.mains.put(secondMatch)
            await flushPromises()
            check(`second main arrives`)

            anchorRows.delete(7)
            for (const entry of cases) entry.anchors.remove(7)
            await flushPromises()
            check(`joined side becomes absent`)

            const changedParent = { id: 1, marker: `PARENT2` }
            parentRows.set(1, changedParent)
            for (const entry of cases) entry.parents.put(changedParent)
            await flushPromises()
            check(`ancestor updates`)
          },
          () =>
            cases.flatMap((entry) => [
              () => entry.live.cleanup(),
              () => entry.parents.collection.cleanup(),
              () => entry.mains.collection.cleanup(),
              () => entry.anchors.collection.cleanup(),
            ]),
        )
      })
    }
  }
})

/**
 * # A later join cannot restore an absent local source
 *
 * ARCHITECTURE.md §Identity and law 1 make the outer and child `issue`
 * declarations distinct. A LEFT join with no local issue leaves that source
 * absent. A later joined input may carry the outer issue for correlation.
 * Whether routing comes from a parent-dependent QueryRef or a captured join
 * operand, it cannot restore the absent local declaration.
 *
 * The independent model below recomputes two LEFT joins from plain rows. Its
 * legal history changes an absent local issue into a match and back, then
 * removes and restores the second joined side. A second parent route keeps a
 * matched local issue as the opposite control. The QueryRef filters tags by
 * parent; the direct source reads the parent in its equality operand instead.
 * The production driver uses public Query and Collection APIs; after preload
 * and each write, public child rows are compared with the model. Shadowed and
 * renamed aliases, both route causes, and eager and on-demand sources agree.
 */
describe(`chained joins keep an absent local source absent`, () => {
  type Issue = { id: number }
  type Comment = {
    id: number
    issueId: number
    localIssueId: number
    tagId: number
  }
  type Tag = { id: number; issueId: number }
  type Expected = {
    parentId: number
    commentId: number
    localIssueId: number | undefined
    tagId: number | undefined
    missingLocalIssue: boolean
  }

  const model = (
    parents: ReadonlyMap<number, Issue>,
    comments: ReadonlyMap<number, Comment>,
    localIssues: ReadonlyMap<number, Issue>,
    tags: ReadonlyMap<number, Tag>,
    routeCause: `queryRef` | `capturedOperand`,
  ): Array<Expected> =>
    [...parents.values()]
      .flatMap((parent) =>
        [...comments.values()]
          .filter((comment) => comment.issueId === parent.id)
          .map((comment) => {
            const localIssue = localIssues.get(comment.localIssueId)
            const tag = tags.get(comment.tagId)
            return {
              parentId: parent.id,
              commentId: comment.id,
              localIssueId: localIssue?.id,
              tagId:
                tag &&
                (routeCause === `capturedOperand` || tag.issueId === parent.id)
                  ? tag.id
                  : undefined,
              missingLocalIssue: localIssue === undefined,
            }
          }),
      )
      .sort((a, b) => a.parentId - b.parentId || a.commentId - b.commentId)

  for (const mode of [`eager`, `onDemand`] as const) {
    test(`${mode} chained joins preserve absence under shadowing and renaming`, async () => {
      const parentRows = new Map<number, Issue>([
        [1, { id: 1 }],
        [2, { id: 2 }],
      ])
      const commentRows = new Map<number, Comment>([
        [10, { id: 10, issueId: 1, localIssueId: 99, tagId: 7 }],
        [20, { id: 20, issueId: 2, localIssueId: 2, tagId: 8 }],
      ])
      const localIssueRows = new Map<number, Issue>([[2, { id: 2 }]])
      const tagRows = new Map<number, Tag>([
        [7, { id: 7, issueId: 1 }],
        [8, { id: 8, issueId: 2 }],
      ])
      const cases = ([`issue`, `localIssue`] as const).flatMap((alias) =>
        ([`capturedOperand`, `queryRef`] as const).map((routeCause) => {
          const parents = createScopedSource(
            `chain-parent-${mode}-${alias}-${routeCause}`,
            [...parentRows.values()],
            `eager`,
          )
          const comments = createScopedSource(
            `chain-comment-${mode}-${alias}-${routeCause}`,
            [...commentRows.values()],
            mode,
          )
          const localIssues = createScopedSource(
            `chain-local-${mode}-${alias}-${routeCause}`,
            [...localIssueRows.values()],
            mode,
          )
          const tags = createScopedSource(
            `chain-tag-${mode}-${alias}-${routeCause}`,
            [...tagRows.values()],
            mode,
          )
          comments.collection.createIndex((row) => row.issueId, {
            indexType: BasicIndex,
          })
          localIssues.collection.createIndex((row) => row.id, {
            indexType: BasicIndex,
          })
          tags.collection.createIndex((row) => row.id, {
            indexType: BasicIndex,
          })
          const live = createLiveQueryCollection({
            query: new Query()
              .from({ issue: parents.collection })
              .select(({ issue: parent }) => {
                const scopedTags = new Query()
                  .from({ source: tags.collection })
                  .where(({ source }) => eq(source.issueId, parent.id))
                  .select(({ source }) => ({
                    id: source.id,
                    issueId: source.issueId,
                  }))
                const tagSource =
                  routeCause === `queryRef` ? scopedTags : tags.collection
                return {
                  id: parent.id,
                  rows: toArray(
                    new Query()
                      .from({ comment: comments.collection })
                      .leftJoin(
                        { [alias]: localIssues.collection },
                        (context: Context) =>
                          eq(
                            (context.comment as Comment).localIssueId,
                            (context[alias] as Issue).id,
                          ),
                      )
                      .leftJoin({ tag: tagSource }, (context: Context) =>
                        routeCause === `queryRef`
                          ? eq(
                              (context.comment as Comment).tagId,
                              (context.tag as Tag).id,
                            )
                          : eq(
                              add(
                                (context.comment as Comment).tagId,
                                parent.id,
                              ),
                              add((context.tag as Tag).id, parent.id),
                            ),
                      )
                      .where((context: Context) =>
                        eq((context.comment as Comment).issueId, parent.id),
                      )
                      .select((context: Context) => ({
                        commentId: (context.comment as Comment).id,
                        localIssueId: (context[alias] as Issue).id,
                        tagId: (context.tag as Tag).id,
                        missingLocalIssue: isUndefined(
                          (context[alias] as Issue).id,
                        ),
                      })),
                  ),
                }
              }),
          })
          return {
            alias,
            routeCause,
            parents,
            comments,
            localIssues,
            tags,
            live,
          }
        }),
      )

      await withHistoryCleanup(
        async () => {
          for (const entry of cases) await entry.live.preload()
          const check = (cut: string) => {
            for (const entry of cases) {
              const expected = model(
                parentRows,
                commentRows,
                localIssueRows,
                tagRows,
                entry.routeCause,
              )
              const actual = entry.live.toArray
                .flatMap(({ id, rows }) =>
                  rows.map((row) => ({ parentId: id, ...row })),
                )
                .sort(
                  (a, b) =>
                    a.parentId - b.parentId || a.commentId - b.commentId,
                )
              expect(
                actual,
                `${entry.alias}, ${entry.routeCause} at ${cut}`,
              ).toEqual(expected)
            }
          }
          check(`initial publication`)

          const matchedIssue = { id: 99 }
          localIssueRows.set(99, matchedIssue)
          for (const entry of cases) entry.localIssues.put(matchedIssue)
          await flushPromises()
          check(`local issue arrives`)

          localIssueRows.delete(99)
          for (const entry of cases) entry.localIssues.remove(99)
          await flushPromises()
          check(`local issue disappears`)

          tagRows.delete(7)
          for (const entry of cases) entry.tags.remove(7)
          await flushPromises()
          check(`second joined side disappears`)

          const returnedTag = { id: 7, issueId: 1 }
          tagRows.set(7, returnedTag)
          for (const entry of cases) entry.tags.put(returnedTag)
          await flushPromises()
          check(`second joined side returns`)
        },
        () =>
          cases.flatMap((entry) => [
            () => entry.live.cleanup(),
            () => entry.parents.collection.cleanup(),
            () => entry.comments.collection.cleanup(),
            () => entry.localIssues.collection.cleanup(),
            () => entry.tags.collection.cleanup(),
          ]),
      )
    })
  }
})

/**
 * # Later outer joins preserve the source roles of an earlier outer join
 *
 * ARCHITECTURE.md §Identity makes an absent child source distinct from an
 * ancestor with the same alias. A later join can carry ancestor route context,
 * but it cannot turn that absent source into a present child source. This law
 * applies whether the first join preserves its right side or both sides, and
 * whether the next join preserves its left, right, or both sides.
 *
 * The model below performs two ordinary relational joins over plain rows. It
 * represents a missing source with undefined before applying the parent
 * correlation. Source roles, not alias text or compiler route data, determine
 * the expected fields. The bounded history crosses four mixed join chains,
 * correlation through the first main or joined source, shadowing of the source
 * that can be absent, a renamed control, two source modes, and writes that
 * remove and restore each join's matches. The public driver compares exact
 * child rows after preload and each committed write; it does not claim every
 * join permutation or provider schedule.
 */
describe(`mixed outer-join chains retain absent source roles`, () => {
  type Parent = { id: number; marker: string }
  type Main = { id: number; parentId: number; anchorId: number }
  type Anchor = { id: number; parentId: number }
  type Tag = { id: number; anchorId: number; parentId: number }
  type Kind = `left` | `right` | `full`
  type Pair = { main?: Main; anchor?: Anchor; tag?: Tag }
  type Expected = {
    parentId: number
    mainId: number | undefined
    anchorId: number | undefined
    tagId: number | undefined
    marker: string
    missingMain: boolean
    missingAnchor: boolean
    missingTag: boolean
  }
  const chains = [
    { first: `right`, second: `left`, correlation: `joined` },
    { first: `right`, second: `right`, correlation: `joined` },
    { first: `full`, second: `full`, correlation: `tag` },
    { first: `full`, second: `left`, correlation: `main` },
  ] as const

  const sortRows = (rows: Array<Expected>) =>
    rows.sort(
      (a, b) =>
        a.parentId - b.parentId ||
        (a.anchorId ?? Infinity) - (b.anchorId ?? Infinity) ||
        (a.mainId ?? Infinity) - (b.mainId ?? Infinity) ||
        (a.tagId ?? Infinity) - (b.tagId ?? Infinity),
    )

  /** Pair source rows without using alias names or the production join path. */
  const model = (
    parents: ReadonlyMap<number, Parent>,
    mains: ReadonlyMap<number, Main>,
    anchors: ReadonlyMap<number, Anchor>,
    tags: ReadonlyMap<number, Tag>,
    first: Kind,
    second: Kind,
    correlation: `main` | `joined` | `tag`,
  ): Array<Expected> => {
    const firstPairs: Array<Pair> = []
    for (const main of mains.values()) {
      const matches = [...anchors.values()].filter(
        (anchor) => main.anchorId === anchor.id,
      )
      for (const anchor of matches) firstPairs.push({ main, anchor })
      if (matches.length === 0 && first === `full`) firstPairs.push({ main })
    }
    if (first === `right` || first === `full`) {
      for (const anchor of anchors.values()) {
        if (![...mains.values()].some((main) => main.anchorId === anchor.id)) {
          firstPairs.push({ anchor })
        }
      }
    }

    const secondPairs: Array<Pair> = []
    for (const pair of firstPairs) {
      const matches = [...tags.values()].filter(
        (tag) => pair.anchor?.id === tag.anchorId,
      )
      for (const tag of matches) secondPairs.push({ ...pair, tag })
      if (matches.length === 0 && second !== `right`) secondPairs.push(pair)
    }
    if (second === `right` || second === `full`) {
      for (const tag of tags.values()) {
        if (!firstPairs.some((pair) => pair.anchor?.id === tag.anchorId)) {
          secondPairs.push({ tag })
        }
      }
    }

    return sortRows(
      [...parents.values()].flatMap((parent) =>
        secondPairs
          .filter((pair) =>
            correlation === `main`
              ? pair.main?.parentId === parent.id
              : correlation === `joined`
                ? pair.anchor?.parentId === parent.id
                : pair.tag?.parentId === parent.id,
          )
          .map((pair) => ({
            parentId: parent.id,
            mainId: pair.main?.id,
            anchorId: pair.anchor?.id,
            tagId: pair.tag?.id,
            marker: parent.marker,
            missingMain: pair.main === undefined,
            missingAnchor: pair.anchor === undefined,
            missingTag: pair.tag === undefined,
          })),
      ),
    )
  }

  for (const { first, second, correlation } of chains) {
    for (const mode of [`eager`, `onDemand`] as const) {
      test(`${first} then ${second}, ${correlation} correlation, ${mode} sources`, async () => {
        const parentRows = new Map<number, Parent>([
          [1, { id: 1, marker: `ONE` }],
          [2, { id: 2, marker: `TWO` }],
        ])
        const mainRows = new Map<number, Main>([
          [10, { id: 10, parentId: 1, anchorId: 7 }],
          [11, { id: 11, parentId: 1, anchorId: 99 }],
          [20, { id: 20, parentId: 2, anchorId: 20 }],
        ])
        const anchorRows = new Map<number, Anchor>([
          [7, { id: 7, parentId: 1 }],
          [8, { id: 8, parentId: 1 }],
          [20, { id: 20, parentId: 2 }],
        ])
        const tagRows = new Map<number, Tag>([
          [70, { id: 70, anchorId: 7, parentId: 1 }],
          [80, { id: 80, anchorId: 8, parentId: 1 }],
          [90, { id: 90, anchorId: 90, parentId: 1 }],
          [200, { id: 200, anchorId: 20, parentId: 2 }],
        ])
        const cases = ([`shadowed`, `renamed`] as const).map((spelling) => {
          const mainAlias =
            correlation !== `main` && spelling === `shadowed` ? `issue` : `main`
          const anchorAlias =
            correlation === `main` && spelling === `shadowed`
              ? `issue`
              : `anchor`
          const name = `mixed-chain-${first}-${second}-${correlation}-${mode}-${spelling}`
          const parents = createScopedSource(
            `${name}-parent`,
            [...parentRows.values()],
            `eager`,
          )
          const mains = createScopedSource(
            `${name}-main`,
            [...mainRows.values()],
            mode,
          )
          const anchors = createScopedSource(
            `${name}-anchor`,
            [...anchorRows.values()],
            mode,
          )
          const tags = createScopedSource(
            `${name}-tag`,
            [...tagRows.values()],
            mode,
          )
          mains.collection.createIndex((row) => row.parentId, {
            indexType: BasicIndex,
          })
          mains.collection.createIndex((row) => row.anchorId, {
            indexType: BasicIndex,
          })
          anchors.collection.createIndex((row) => row.parentId, {
            indexType: BasicIndex,
          })
          anchors.collection.createIndex((row) => row.id, {
            indexType: BasicIndex,
          })
          tags.collection.createIndex((row) => row.anchorId, {
            indexType: BasicIndex,
          })
          tags.collection.createIndex((row) => row.parentId, {
            indexType: BasicIndex,
          })
          const live = createLiveQueryCollection({
            query: new Query()
              .from({ issue: parents.collection })
              .select(({ issue: parent }) => ({
                id: parent.id,
                rows: toArray(
                  new Query()
                    .from({ [mainAlias]: mains.collection })
                    .join(
                      { [anchorAlias]: anchors.collection },
                      (context: Context) =>
                        eq(
                          (context[mainAlias] as Main).anchorId,
                          (context[anchorAlias] as Anchor).id,
                        ),
                      first,
                    )
                    .join(
                      { tag: tags.collection },
                      (context: Context) =>
                        eq(
                          (context[anchorAlias] as Anchor).id,
                          (context.tag as Tag).anchorId,
                        ),
                      second,
                    )
                    .where((context: Context) =>
                      correlation === `main`
                        ? eq((context[mainAlias] as Main).parentId, parent.id)
                        : correlation === `joined`
                          ? eq(
                              (context[anchorAlias] as Anchor).parentId,
                              parent.id,
                            )
                          : eq((context.tag as Tag).parentId, parent.id),
                    )
                    .select((context: Context) => ({
                      mainId: (context[mainAlias] as Main).id,
                      anchorId: (context[anchorAlias] as Anchor).id,
                      tagId: (context.tag as Tag).id,
                      marker: parent.marker,
                      missingMain: isUndefined((context[mainAlias] as Main).id),
                      missingAnchor: isUndefined(
                        (context[anchorAlias] as Anchor).id,
                      ),
                      missingTag: isUndefined((context.tag as Tag).id),
                    })),
                ),
              })),
          })
          return { spelling, parents, mains, anchors, tags, live }
        })

        await withHistoryCleanup(
          async () => {
            for (const entry of cases) await entry.live.preload()
            const check = (cut: string) => {
              const expected = model(
                parentRows,
                mainRows,
                anchorRows,
                tagRows,
                first,
                second,
                correlation,
              )
              for (const entry of cases) {
                const actual = sortRows(
                  entry.live.toArray.flatMap(({ id, rows }) =>
                    rows.map((row) => ({ parentId: id, ...row })),
                  ),
                )
                expect(actual, `${entry.spelling} at ${cut}`).toEqual(expected)
              }
            }
            check(`initial publication`)

            tagRows.delete(80)
            for (const entry of cases) entry.tags.remove(80)
            await flushPromises()
            check(`second joined source disappears`)

            const newMain = { id: 12, parentId: 1, anchorId: 8 }
            mainRows.set(12, newMain)
            for (const entry of cases) entry.mains.put(newMain)
            await flushPromises()
            check(`first joined source gains a match`)

            mainRows.delete(12)
            for (const entry of cases) entry.mains.remove(12)
            await flushPromises()
            check(`first joined source loses its match`)

            const restoredTag = { id: 80, anchorId: 8, parentId: 1 }
            tagRows.set(80, restoredTag)
            for (const entry of cases) entry.tags.put(restoredTag)
            await flushPromises()
            check(`second joined source returns`)

            anchorRows.delete(7)
            for (const entry of cases) entry.anchors.remove(7)
            await flushPromises()
            check(`first joined source disappears`)

            const changedParent = { id: 1, marker: `CHANGED` }
            parentRows.set(1, changedParent)
            for (const entry of cases) entry.parents.put(changedParent)
            await flushPromises()
            check(`ancestor value changes`)
          },
          () =>
            cases.flatMap((entry) => [
              () => entry.live.cleanup(),
              () => entry.parents.collection.cleanup(),
              () => entry.mains.collection.cleanup(),
              () => entry.anchors.collection.cleanup(),
              () => entry.tags.collection.cleanup(),
            ]),
        )
      })
    }
  }
})

/**
 * # Join operands keep their lexical source
 *
 * A captured ancestor reference is an available expression on the main side
 * of a child's join, even when the joined source uses the same alias. The
 * child-local and ancestor terms can form one join key, and an ancestor can
 * also supply the entire main-side key. The model uses their numeric values
 * and the joined source's ID; swapping equality operands or
 * renaming the joined source cannot change the projected rows. The history
 * changes each role at a public-row checkpoint, in both source modes.
 */
describe(`captured ancestor join operands retain their bindings`, () => {
  type Parent = { id: number; offset: number }
  type Child = { id: number; parentId: number; base: number }
  type Target = { id: number }
  type AncestorSide = `main` | `joined` | `soleMain`
  type Expected = { parentId: number; childId: number; targetId: number }

  const model = (
    parents: ReadonlyMap<number, Parent>,
    children: ReadonlyMap<number, Child>,
    targets: ReadonlyMap<number, Target>,
    ancestorSide: AncestorSide,
  ): Array<{ id: number; rows: Array<Expected> }> =>
    [...parents.values()]
      .map((parent) => ({
        id: parent.id,
        rows: [...children.values()]
          .filter((child) => child.parentId === parent.id)
          .flatMap((child) =>
            [...targets.values()]
              .filter((target) => {
                if (ancestorSide === `main`)
                  return target.id === child.base + parent.offset
                if (ancestorSide === `joined`)
                  return child.base === target.id + parent.offset
                return target.id === parent.offset
              })
              .map((target) => ({
                parentId: parent.id,
                childId: child.id,
                targetId: target.id,
              })),
          )
          .sort((a, b) => a.childId - b.childId),
      }))
      .sort((a, b) => a.id - b.id)

  for (const mode of [`eager`, `onDemand`] as const) {
    test(`${mode} sources preserve captured operands across alias and equality order`, async () => {
      const parentRows = new Map<number, Parent>([[1, { id: 1, offset: 1 }]])
      const childRows = new Map<number, Child>([
        [10, { id: 10, parentId: 1, base: 6 }],
      ])
      const targetRows = new Map<number, Target>([
        [1, { id: 1 }],
        [2, { id: 2 }],
        [3, { id: 3 }],
        [4, { id: 4 }],
        [5, { id: 5 }],
        [7, { id: 7 }],
        [8, { id: 8 }],
      ])
      const cases = ([`issue`, `target`] as const).flatMap((alias) =>
        ([`childFirst`, `joinedFirst`] as const).flatMap((order) =>
          ([`main`, `joined`, `soleMain`] as const).map((ancestorSide) => {
            const parents = createScopedSource(
              `operand-parent-${mode}-${alias}-${order}-${ancestorSide}`,
              [...parentRows.values()],
              `eager`,
            )
            const children = createScopedSource(
              `operand-child-${mode}-${alias}-${order}-${ancestorSide}`,
              [...childRows.values()],
              mode,
            )
            const targets = createScopedSource(
              `operand-target-${mode}-${alias}-${order}-${ancestorSide}`,
              [...targetRows.values()],
              mode,
            )
            children.collection.createIndex((row) => row.parentId, {
              indexType: BasicIndex,
            })
            targets.collection.createIndex((row) => row.id, {
              indexType: BasicIndex,
            })
            const live = createLiveQueryCollection({
              query: new Query()
                .from({ issue: parents.collection })
                .select(({ issue: ancestor }) => ({
                  id: ancestor.id,
                  rows: toArray(
                    new Query()
                      .from({ child: children.collection })
                      .innerJoin(
                        { [alias]: targets.collection },
                        (context: Context) => {
                          const child = context.child as Child
                          const target = context[alias] as Target
                          const mainKey =
                            ancestorSide === `main`
                              ? add(child.base, ancestor.offset)
                              : ancestorSide === `soleMain`
                                ? ancestor.offset
                                : child.base
                          const joinedKey =
                            ancestorSide === `joined`
                              ? add(target.id, ancestor.offset)
                              : target.id
                          return order === `childFirst`
                            ? eq(mainKey, joinedKey)
                            : eq(joinedKey, mainKey)
                        },
                      )
                      .where((context: Context) =>
                        eq((context.child as Child).parentId, ancestor.id),
                      )
                      .select((context: Context) => ({
                        parentId: ancestor.id,
                        childId: (context.child as Child).id,
                        targetId: (context[alias] as Target).id,
                      })),
                  ),
                })),
            })
            return {
              alias,
              order,
              ancestorSide,
              parents,
              children,
              targets,
              live,
            }
          }),
        ),
      )

      const observe = (live: (typeof cases)[number][`live`]) =>
        live.toArray
          .map(({ id, rows }) => ({
            id,
            rows: rows
              .map(({ parentId, childId, targetId }) => ({
                parentId,
                childId,
                targetId,
              }))
              .sort((a, b) => a.childId - b.childId),
          }))
          .sort((a, b) => a.id - b.id)

      await withHistoryCleanup(
        async () => {
          for (const entry of cases) await entry.live.preload()
          const check = (cut: string) => {
            for (const entry of cases) {
              expect(
                observe(entry.live),
                `${entry.alias}, ${entry.order}, ${entry.ancestorSide} at ${cut}`,
              ).toEqual(
                model(parentRows, childRows, targetRows, entry.ancestorSide),
              )
            }
          }
          check(`initial publication`)

          const changedParent = { id: 1, offset: 2 }
          parentRows.set(1, changedParent)
          for (const entry of cases) entry.parents.put(changedParent)
          await flushPromises()
          check(`ancestor key update`)

          const changedChild = { id: 10, parentId: 1, base: 5 }
          childRows.set(10, changedChild)
          for (const entry of cases) entry.children.put(changedChild)
          await flushPromises()
          check(`child key update`)

          for (const id of [2, 3, 7]) targetRows.delete(id)
          for (const entry of cases) {
            for (const id of [2, 3, 7]) entry.targets.remove(id)
          }
          await flushPromises()
          check(`joined row removal`)

          for (const id of [2, 3, 7]) targetRows.set(id, { id })
          for (const entry of cases) {
            for (const id of [2, 3, 7]) entry.targets.put({ id })
          }
          await flushPromises()
          check(`joined row return`)
        },
        () =>
          cases.flatMap((entry) => [
            () => entry.live.cleanup(),
            () => entry.parents.collection.cleanup(),
            () => entry.children.collection.cleanup(),
            () => entry.targets.collection.cleanup(),
          ]),
      )
    })
  }
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
 * # A real ancestor remains available in grouping, HAVING, and ordering
 *
 * The rejected foreign references above must not turn into a ban on captured
 * ancestors. ARCHITECTURE.md's route-context law says a valid ancestor value
 * is attached before a child aggregate, filter, or order that uses it. This
 * plain-row model groups each parent's children by score, keeps groups whose
 * count exceeds that parent's threshold, and sorts the selected group score
 * by that parent's direction. Alias spelling is absent from the model. The public include
 * crosses a shadowed and renamed child alias, eager/on-demand sources, and
 * parent and child updates; exact ordered child rows are compared at each cut.
 */
describe(`grouped includes keep valid ancestor references`, () => {
  type Parent = { id: number; threshold: number; direction: number }
  type Child = { id: number; parentId: number; score: number }
  type Group = { score: number; total: number }
  const model = (
    parents: ReadonlyMap<number, Parent>,
    children: ReadonlyMap<number, Child>,
  ): Array<{ id: number; rows: Array<Group> }> =>
    [...parents.values()]
      .map((parent) => {
        const counts = new Map<number, number>()
        for (const child of children.values()) {
          if (child.parentId === parent.id) {
            counts.set(child.score, (counts.get(child.score) ?? 0) + 1)
          }
        }
        return {
          id: parent.id,
          rows: [...counts]
            .filter(([, total]) => total > parent.threshold)
            .map(([score, total]) => ({ score, total }))
            .sort(
              (a, b) => a.score * parent.direction - b.score * parent.direction,
            ),
        }
      })
      .sort((a, b) => a.id - b.id)

  for (const mode of [`eager`, `onDemand`] as const) {
    test(`${mode} grouped includes use ancestors across shadowing and updates`, async () => {
      const parentRows = new Map<number, Parent>([
        [1, { id: 1, threshold: 0, direction: 1 }],
        [2, { id: 2, threshold: 0, direction: -1 }],
      ])
      const childRows = new Map<number, Child>([
        [10, { id: 10, parentId: 1, score: 1 }],
        [11, { id: 11, parentId: 1, score: 3 }],
        [20, { id: 20, parentId: 2, score: 1 }],
        [21, { id: 21, parentId: 2, score: 1 }],
        [22, { id: 22, parentId: 2, score: 2 }],
      ])
      const cases = ([`issue`, `child`] as const).map((alias) => {
        const name = `group-ancestor-${mode}-${alias}`
        const parents = createScopedSource(
          `${name}-parent`,
          [...parentRows.values()],
          `eager`,
        )
        const children = createScopedSource(
          `${name}-child`,
          [...childRows.values()],
          mode,
        )
        children.collection.createIndex((row) => row.parentId, {
          indexType: BasicIndex,
        })
        const live = createLiveQueryCollection({
          query: new Query()
            .from({ issue: parents.collection })
            .select(({ issue: parent }) => ({
              id: parent.id,
              rows: toArray(
                new Query()
                  .from({ [alias]: children.collection })
                  .where((context: Context) =>
                    eq((context[alias] as Child).parentId, parent.id),
                  )
                  .groupBy(
                    (context: Context) => (context[alias] as Child).score,
                  )
                  .select((context: Context) => ({
                    score: (context[alias] as Child).score,
                    total: count((context[alias] as Child).id),
                  }))
                  .having((context: Context) =>
                    gt(count((context[alias] as Child).id), parent.threshold),
                  )
                  .orderBy(
                    (context: Context) =>
                      multiply(
                        (context.$selected as Group).score,
                        parent.direction,
                      ),
                    `asc`,
                  ),
              ),
            })),
        })
        return { alias, parents, children, live }
      })

      await withHistoryCleanup(
        async () => {
          for (const entry of cases) await entry.live.preload()
          const check = (cut: string) => {
            const expected = model(parentRows, childRows)
            for (const entry of cases) {
              expect(
                entry.live.toArray
                  .map(({ id, rows }) => ({
                    id,
                    rows: rows.map(({ score, total }) => ({ score, total })),
                  }))
                  .sort((a, b) => a.id - b.id),
                `${entry.alias} at ${cut}`,
              ).toEqual(expected)
            }
          }
          check(`initial publication`)

          const stricterParent = { id: 2, threshold: 1, direction: -1 }
          parentRows.set(2, stricterParent)
          for (const entry of cases) entry.parents.put(stricterParent)
          await flushPromises()
          check(`ancestor threshold changes`)

          const changedChild = { id: 22, parentId: 2, score: 1 }
          childRows.set(22, changedChild)
          for (const entry of cases) entry.children.put(changedChild)
          await flushPromises()
          check(`child changes group`)

          const reversedParent = { id: 1, threshold: 0, direction: -1 }
          parentRows.set(1, reversedParent)
          for (const entry of cases) entry.parents.put(reversedParent)
          await flushPromises()
          check(`ancestor sort direction changes`)
        },
        () =>
          cases.flatMap((entry) => [
            () => entry.live.cleanup(),
            () => entry.parents.collection.cleanup(),
            () => entry.children.collection.cleanup(),
          ]),
      )
    })
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

/**
 * # A joined QueryRef cannot read an enclosing query's sibling source
 *
 * A joined QueryRef receives its own source stream and any actual ancestor
 * route. The enclosing query's preceding FROM source is not part of that
 * stream. Capturing that sibling's ref inside the QueryRef's join condition
 * must reject before preload can accept public rows. The independent scope
 * model calls the sibling unavailable even when its alias matches the
 * QueryRef's local alias. The finite grammar crosses root or include
 * placement, matching or renamed alias, and eager or on-demand sources. The
 * neighboring control below puts a real ancestor in the same nested join and
 * compares its public rows with plain relational recomputation.
 */
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

  for (const mode of [`eager`, `onDemand`] as const) {
    for (const alias of [`issue`, `inner`] as const) {
      test(`${mode} joined subquery may capture an actual ancestor with inner alias ${alias}`, async () => {
        const parentRows = [{ id: 1 }, { id: 2 }]
        const mainRows = [{ id: 1 }, { id: 2 }]
        const innerRows = [{ id: 1 }, { id: 2 }]
        const probeRows = [{ id: 1 }, { id: 2 }]
        const expected = parentRows.map((parent) => ({
          id: parent.id,
          rows: mainRows.flatMap((main) =>
            innerRows
              .filter(
                (inner) =>
                  main.id === inner.id &&
                  main.id === parent.id &&
                  probeRows.some((probe) => probe.id === parent.id),
              )
              .map((inner) => ({
                localId: main.id,
                joinedId: inner.id,
                ancestorId: parent.id,
              })),
          ),
        }))
        const parent = createScopedSource(
          `sibling-control-parent-${mode}-${alias}`,
          parentRows,
          `eager`,
        )
        const main = createScopedSource(
          `sibling-control-main-${mode}-${alias}`,
          mainRows,
          mode,
        )
        const inner = createScopedSource(
          `sibling-control-inner-${mode}-${alias}`,
          innerRows,
          mode,
        )
        const probe = createScopedSource(
          `sibling-control-probe-${mode}-${alias}`,
          probeRows,
          mode,
        )
        const live = createLiveQueryCollection({
          query: new Query()
            .from({ issue: parent.collection })
            .select(({ issue: ancestor }) => {
              const joinedQuery = new Query()
                .from({ [alias]: inner.collection })
                .where((context: Context) =>
                  eq((context[alias] as Row).id, ancestor.id),
                )
                .innerJoin({ probe: probe.collection }, ({ probe: row }) =>
                  eq(ancestor.id, row.id),
                )
                .select((context: Context) => ({
                  id: (context[alias] as Row).id,
                  ancestorId: ancestor.id,
                }))
              return {
                id: ancestor.id,
                rows: toArray(
                  new Query()
                    .from({ local: main.collection })
                    .innerJoin(
                      { nested: joinedQuery },
                      ({ local: row, nested }) => eq(row.id, nested.id),
                    )
                    .where(({ local: row }) => eq(row.id, ancestor.id))
                    .select(({ local: row, nested }) => ({
                      localId: row.id,
                      joinedId: nested.id,
                      ancestorId: nested.ancestorId,
                    })),
                ),
              }
            }),
        })

        await withHistoryCleanup(
          async () => {
            await live.preload()
            expect(
              live.toArray.map(({ id, rows }) => ({
                id,
                rows: rows.map(({ localId, joinedId, ancestorId }) => ({
                  localId,
                  joinedId,
                  ancestorId,
                })),
              })),
            ).toEqual(expected)
          },
          () => [
            () => live.cleanup(),
            () => parent.collection.cleanup(),
            () => main.collection.cleanup(),
            () => inner.collection.cleanup(),
            () => probe.collection.cleanup(),
          ],
        )
      })
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
