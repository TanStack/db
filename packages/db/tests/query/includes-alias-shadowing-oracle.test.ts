import { describe, expect, test } from 'vitest'
import {
  Query,
  count,
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import { getQueryIR } from '../../src/query/builder/query-ir.js'
import { getQueryIdentity } from '../../src/query/ir-stable-identity.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
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
            children: toArray(
              placement === `direct`
                ? base
                    .where(({ n: child }) => eq(child.parentId, parent.id))
                    .select(({ n: child }) => ({ id: child.id }))
                : new Query()
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
        ).toThrow(/new Query\(\)/)
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
