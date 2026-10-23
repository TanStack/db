import { beforeEach, describe, expect, test } from 'vitest'
import {
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { mockSyncCollectionOptions } from '../utils.js'

type Lock = { _id: number; name: string }
type Vote = { _id: number; lockId: number; percent: number }

const locks: Array<Lock> = [
  { _id: 1, name: `Lock A` },
  { _id: 2, name: `Lock B` },
]

const votes: Array<Vote> = [
  { _id: 1, lockId: 1, percent: 10 },
  { _id: 2, lockId: 1, percent: 20 },
  { _id: 3, lockId: 2, percent: 30 },
]

function createTestCollections() {
  return {
    locksCollection: createCollection(
      mockSyncCollectionOptions<Lock>({
        id: `locks`,
        getKey: (lock) => lock._id,
        initialData: locks,
        autoIndex: `eager`,
      }),
    ),
    votesCollection: createCollection(
      mockSyncCollectionOptions<Vote>({
        id: `votes`,
        getKey: (vote) => vote._id,
        initialData: votes,
        autoIndex: `eager`,
      }),
    ),
  }
}

describe(`Alias validation in subqueries`, () => {
  let locksCollection: ReturnType<
    typeof createTestCollections
  >[`locksCollection`]
  let votesCollection: ReturnType<
    typeof createTestCollections
  >[`votesCollection`]

  beforeEach(() => {
    const collections = createTestCollections()
    locksCollection = collections.locksCollection
    votesCollection = collections.votesCollection
  })

  // The reported form: the joined QueryRef and its caller reuse "vote".
  // Its projected output keeps the join multiplicity and source roles.
  test(`ancestor alias reuse keeps the joined rows`, async () => {
    const live = createLiveQueryCollection({
      startSync: true,
      query: (q) => {
        const locksAgg = q
          .from({ lock: locksCollection })
          .join({ vote: votesCollection }, ({ lock, vote }) =>
            eq(lock._id, vote.lockId),
          )
          .select(({ lock }) => ({
            _id: lock._id,
            lockName: lock.name,
          }))

        return q
          .from({ vote: votesCollection })
          .join({ lock: locksAgg }, ({ vote, lock }) =>
            eq(lock._id, vote.lockId),
          )
          .select(({ vote, lock }) => ({
            voteId: vote._id,
            lockName: lock.lockName,
          }))
      },
    })
    try {
      expect(
        live.toArray.map((row) => `${row.voteId}/${row.lockName}`).sort(),
      ).toEqual([`1/Lock A`, `1/Lock A`, `2/Lock A`, `2/Lock A`, `3/Lock B`])
    } finally {
      await live.cleanup()
    }
  })

  test(`a reusable child query may repeat its parent's source alias`, async () => {
    const live = createLiveQueryCollection({
      startSync: true,
      query: (q) => {
        const reusable = q
          .from({ item: locksCollection })
          .select(({ item }) => ({ id: item._id }))
        return q
          .from({ item: locksCollection })
          .innerJoin({ child: reusable }, ({ item, child }) =>
            eq(item._id, child.id),
          )
          .select(({ item }) => ({ id: item._id }))
      },
    })
    try {
      expect(live.toArray.map((row) => row.id).sort()).toEqual([1, 2])
    } finally {
      await live.cleanup()
    }
  })

  test(`should reject two joins that use the same alias in one query`, () => {
    expect(() => {
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ lock: locksCollection })
            .join({ vote: votesCollection }, ({ lock, vote }) =>
              eq(vote.lockId, lock._id),
            )
            .join({ vote: votesCollection }, ({ lock, vote }) =>
              eq(vote.lockId, lock._id),
            )
            .select(({ lock }) => ({ _id: lock._id })),
      })
    }).toThrow(/alias "vote" more than once/)
  })

  test(`should reject one alias repeated across unionAll branches`, () => {
    expect(() =>
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q.unionAll(
            q
              .from({ item: locksCollection })
              .select(({ item }) => ({ _id: item._id })),
            q
              .from({ item: votesCollection })
              .select(({ item }) => ({ _id: item._id })),
          ),
      }),
    ).toThrow(/Duplicate source alias "item" in unionAll query branches/)
  })

  // A unionAll() parent row holds the branches' projected fields, not their
  // aliases, so an include may reuse a branch alias.
  test(`should allow an include under a unionAll() parent to reuse a branch alias`, async () => {
    const live = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .unionAll(
            q
              .from({ item: locksCollection })
              .select(({ item }) => ({ rid: item._id })),
            q
              .from({ tool: votesCollection })
              .select(({ tool }) => ({ rid: tool._id })),
          )
          .innerJoin({ anchor: locksCollection }, ({ rid, anchor }) =>
            eq(rid, anchor._id),
          )
          .select(({ rid, anchor }) => ({
            rid,
            votes: toArray(
              q
                .from({ item: votesCollection })
                .where(({ item }) => eq(item.lockId, anchor._id))
                .select(({ item }) => ({ _id: item._id })),
            ),
          })),
    })
    await live.preload()
    expect(
      live.toArray
        .map((row) => ({
          rid: row.rid,
          votes: [...row.votes].map((vote) => vote._id).sort(),
        }))
        .sort((left, right) => left.rid - right.rid),
    ).toEqual([
      { rid: 1, votes: [1, 2] },
      { rid: 1, votes: [1, 2] },
      { rid: 2, votes: [3] },
      { rid: 2, votes: [3] },
    ])
  })

  // The same holds for the union's own joins: a branch alias is not visible
  // to them.
  test(`should allow a unionAll() join to reuse an alias of a derived branch source`, async () => {
    const live = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .unionAll(
            q
              .from({
                vote: q
                  .from({ inner: votesCollection })
                  .select(({ inner }) => ({ id: inner._id })),
              })
              .select(({ vote }) => ({ id: vote.id })),
            q
              .from({ lock: locksCollection })
              .select(({ lock }) => ({ id: lock._id })),
          )
          .innerJoin({ vote: votesCollection }, ({ id, vote }) =>
            eq(vote._id, id),
          )
          .select(({ id, vote }) => ({ id, lockId: vote.lockId })),
    })
    await live.preload()
    expect(live.toArray.map((row) => `${row.id}/${row.lockId}`).sort()).toEqual(
      [`1/1`, `1/1`, `2/1`, `2/1`, `3/2`],
    )
  })

  test(`should allow an include to reuse an alias from a sibling from() subquery`, async () => {
    const live = createLiveQueryCollection({
      startSync: true,
      query: (q) => {
        const namedLocks = q
          .from({ vote: locksCollection })
          .select(({ vote }) => ({ _id: vote._id, name: vote.name }))
        return q.from({ lock: namedLocks }).select(({ lock }) => ({
          _id: lock._id,
          votes: toArray(
            q
              .from({ vote: votesCollection })
              .where(({ vote }) => eq(vote.lockId, lock._id))
              .select(({ vote }) => ({ _id: vote._id })),
          ),
        }))
      },
    })
    await live.preload()
    expect(
      live.toArray
        .map((row) => ({
          _id: row._id,
          votes: [...row.votes].map((vote) => vote._id).sort(),
        }))
        .sort((left, right) => left._id - right._id),
    ).toEqual([
      { _id: 1, votes: [1, 2] },
      { _id: 2, votes: [3] },
    ])
  })

  test(`should allow subqueries when all collection aliases are unique`, () => {
    const query = createLiveQueryCollection({
      startSync: true,
      query: (q) => {
        const locksAgg = q
          .from({ lock: locksCollection })
          .join(
            { v: votesCollection }, // Uses unique alias "v" instead of "vote"
            ({ lock, v }) => eq(lock._id, v.lockId),
          )
          .select(({ lock }) => ({
            _id: lock._id,
            lockName: lock.name,
          }))

        return q
          .from({ vote: votesCollection })
          .join({ lock: locksAgg }, ({ vote, lock }) =>
            eq(lock._id, vote.lockId),
          )
          .select(({ vote, lock }) => ({
            voteId: vote._id,
            lockName: lock.lockName,
          }))
      },
    })

    const results = query.toArray

    // Should successfully execute and return results
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.lockName)).toBe(true)
  })
})
