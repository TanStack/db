import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { count } from '../../src/query/builder/functions.js'
import { mockSyncCollectionOptions } from '../utils.js'

describe(`group representative work`, () => {
  it.each([16, 1024, 5000])(
    `encodes changed contributions, not all %s retained members`,
    async (size) => {
      const source = createCollection(
        mockSyncCollectionOptions<{ id: number; value: number }>({
          id: `group-work-${size}`,
          getKey: (row) => row.id,
          initialData: Array.from({ length: size }, (_, id) => ({
            id,
            value: 1,
          })),
        }),
      )
      const grouped = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .groupBy(({ row }) => row.value)
          .select(({ row }) => ({ value: row.value, count: count(row.id) })),
      )
      try {
        await grouped.preload()
        for (const type of [`insert`, `delete`] as const) {
          const spy = vi.spyOn(JSON, `stringify`)
          let calls: number
          try {
            source.utils.begin()
            source.utils.write({ type, value: { id: size, value: 1 } })
            source.utils.commit()
            calls = spy.mock.calls.length
          } finally {
            spy.mockRestore()
          }
          // Encoding the stable input keys scales with the delta, not the
          // retained group size.
          expect(calls).toBeLessThanOrEqual(4)
          expect(grouped.toArray).toMatchObject([
            { value: 1, count: size + (type === `insert` ? 1 : 0) },
          ])
        }
      } finally {
        await grouped.cleanup()
        await source.cleanup()
      }
    },
  )
})

/**
 * # Does one change re-read its whole group?
 *
 * Law: the work a grouped aggregate does for one inserted or deleted member
 * does not depend on how many members the group already holds. This holds
 * for a `groupBy` aggregate and for an aggregate inside an include, which is
 * grouped by its correlation route.
 *
 * Authority: incremental view maintenance. A count changes by the delta's
 * multiplicity, so re-reading every member is not needed for the result.
 *
 * Observation: the number of Map and Set iterator steps taken during one
 * synchronous commit. A reduction that re-reads a group walks the group's
 * value map, so its steps grow with the group. The counter observes all
 * iteration in the commit, so any other per-member walk also fails the law.
 * The checkpoint is the commit's return, where the published count must also
 * equal the model's count.
 */
const mapIteratorPrototype = Object.getPrototypeOf(new Map().values())
const setIteratorPrototype = Object.getPrototypeOf(new Set().values())

function countIteratorSteps(run: () => void): number {
  const mapNext = mapIteratorPrototype.next
  const setNext = setIteratorPrototype.next
  let steps = 0
  mapIteratorPrototype.next = function (this: Iterator<unknown>) {
    steps++
    return mapNext.call(this)
  }
  setIteratorPrototype.next = function (this: Iterator<unknown>) {
    steps++
    return setNext.call(this)
  }
  try {
    run()
  } finally {
    mapIteratorPrototype.next = mapNext
    setIteratorPrototype.next = setNext
  }
  return steps
}

const groupSizes = [10, 100, 1000, 5000]

async function groupByCommitSteps(size: number): Promise<Array<number>> {
  const source = createCollection(
    mockSyncCollectionOptions<{ id: number; value: number }>({
      id: `group-reduce-work-${size}`,
      getKey: (row) => row.id,
      initialData: Array.from({ length: size }, (_, id) => ({ id, value: 1 })),
    }),
  )
  const grouped = createLiveQueryCollection((q) =>
    q
      .from({ row: source })
      .groupBy(({ row }) => row.value)
      .select(({ row }) => ({ value: row.value, count: count(row.id) })),
  )
  try {
    await grouped.preload()
    return [`insert`, `delete`].map((type) => {
      const steps = countIteratorSteps(() => {
        source.utils.begin()
        source.utils.write({
          type: type as `insert` | `delete`,
          value: { id: size, value: 1 },
        })
        source.utils.commit()
      })
      expect(grouped.toArray).toMatchObject([
        { value: 1, count: size + (type === `insert` ? 1 : 0) },
      ])
      return steps
    })
  } finally {
    await grouped.cleanup()
    await source.cleanup()
  }
}

type Issue = { id: number; title: string }
type Comment = { id: number; issueId: number | null }

function createCommentCount(size: number) {
  const issues = createCollection(
    mockSyncCollectionOptions<Issue>({
      id: `include-reduce-issues-${size}-${Math.random()}`,
      getKey: (row) => row.id,
      initialData: [
        { id: 1, title: `one` },
        { id: 2, title: `two` },
      ],
    }),
  )
  const comments = createCollection(
    mockSyncCollectionOptions<Comment>({
      id: `include-reduce-comments-${size}-${Math.random()}`,
      getKey: (row) => row.id,
      initialData: Array.from({ length: size }, (_, id) => ({
        id,
        issueId: 1,
      })),
    }),
  )
  const counts = createLiveQueryCollection((q) =>
    q.from({ issue: issues }).select(({ issue }) => ({
      id: issue.id,
      title: issue.title,
      comments: q
        .from({ comment: comments })
        .where(({ comment }) => eq(comment.issueId, issue.id))
        .select(({ comment }) => ({ n: count(comment.id) })),
    })),
  )
  const write = (
    collection: typeof issues | typeof comments,
    type: `insert` | `update` | `delete`,
    value: Issue | Comment,
  ) => {
    collection.utils.begin()
    collection.utils.write({ type, value } as never)
    collection.utils.commit()
  }
  const commentCount = (issueId: number): number | undefined =>
    (
      counts.get(issueId) as
        { comments: { toArray: Array<{ n: number }> } } | undefined
    )?.comments.toArray[0]?.n
  return { issues, comments, counts, write, commentCount }
}

describe(`grouped aggregate work per change`, () => {
  it(`keeps a groupBy count's work independent of group size`, async () => {
    const steps = await Promise.all(groupSizes.map(groupByCommitSteps))
    for (const sizeSteps of steps) expect(sizeSteps).toEqual(steps[0])
  })

  it(`keeps an include count's work independent of group size`, async () => {
    const steps: Array<number> = []
    for (const size of groupSizes) {
      const fixture = createCommentCount(size)
      try {
        await fixture.counts.preload()
        steps.push(
          countIteratorSteps(() =>
            fixture.write(fixture.comments, `insert`, {
              id: size,
              issueId: 1,
            }),
          ),
        )
        expect(fixture.commentCount(1)).toBe(size + 1)
      } finally {
        await fixture.counts.cleanup()
        await fixture.issues.cleanup()
        await fixture.comments.cleanup()
      }
    }
    for (const sizeSteps of steps) expect(sizeSteps).toEqual(steps[0])
  })

  // The route representative no longer distinguishes members, so every
  // member of one correlation route contributes the same value. These
  // histories check that retraction, emptying, refilling, an unmatched
  // correlation key, and a parent change still publish the model's count.
  it(`keeps include counts exact through retraction and refill`, async () => {
    const fixture = createCommentCount(3)
    const { comments, issues, write, commentCount } = fixture
    try {
      await fixture.counts.preload()
      expect(commentCount(1)).toBe(3)
      // Retract the member that arrived first.
      write(comments, `delete`, { id: 0, issueId: 1 })
      expect(commentCount(1)).toBe(2)
      // Empty the group, then refill it.
      write(comments, `delete`, { id: 1, issueId: 1 })
      write(comments, `delete`, { id: 2, issueId: 1 })
      expect(commentCount(1)).toBeUndefined()
      write(comments, `insert`, { id: 0, issueId: 1 })
      write(comments, `insert`, { id: 5, issueId: 1 })
      expect(commentCount(1)).toBe(2)
      // A null correlation key joins no issue.
      write(comments, `insert`, { id: 6, issueId: null })
      expect(commentCount(1)).toBe(2)
      expect(commentCount(2)).toBeUndefined()
      // Move a member between routes.
      write(comments, `update`, { id: 5, issueId: 2 })
      expect(commentCount(1)).toBe(1)
      expect(commentCount(2)).toBe(1)
      // A parent change keeps the child count.
      write(issues, `update`, { id: 1, title: `renamed` })
      expect(fixture.counts.get(1)).toMatchObject({ title: `renamed` })
      expect(commentCount(1)).toBe(1)
    } finally {
      await fixture.counts.cleanup()
      await issues.cleanup()
      await comments.cleanup()
    }
  })
})
