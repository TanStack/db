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

  test(`should throw DuplicateAliasInSubqueryError when subquery reuses a parent query collection alias`, () => {
    expect(() => {
      createLiveQueryCollection({
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
            .from({ vote: votesCollection }) // Reuses "vote" alias from subquery
            .join({ lock: locksAgg }, ({ vote, lock }) =>
              eq(lock._id, vote.lockId),
            )
            .select(({ vote, lock }) => ({
              voteId: vote._id,
              lockName: lock.lockName,
            }))
        },
      })
    }).toThrow(/Subquery uses alias "vote"/)
  })

  test(`should throw DuplicateAliasInSubqueryError when an include reuses a parent alias`, () => {
    expect(() => {
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q.from({ lock: locksCollection }).select(({ lock: parentLock }) => ({
            _id: parentLock._id,
            votes: q
              .from({ lock: votesCollection })
              .where(({ lock: childLock }) =>
                eq(childLock.lockId, parentLock._id),
              ),
          })),
      })
    }).toThrow(/Subquery uses alias "lock"/)
  })

  // The include sees the outer subquery alias, so reusing it would shadow the
  // parent row. Before this check the correlation silently read the include's
  // own source and returned empty children.
  test(`should throw DuplicateAliasInSubqueryError when an include reuses a parent subquery alias`, () => {
    expect(() => {
      createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          const namedLocks = q
            .from({ source: locksCollection })
            .select(({ source }) => ({ _id: source._id, name: source.name }))
          return q
            .from({ lock: namedLocks })
            .select(({ lock: parentLock }) => ({
              _id: parentLock._id,
              votes: q
                .from({ lock: votesCollection })
                .where(({ lock: childLock }) =>
                  eq(childLock.lockId, parentLock._id),
                ),
            }))
        },
      })
    }).toThrow(/Subquery uses alias "lock"/)
  })

  test(`should throw DuplicateAliasInSubqueryError when a nested include reuses a grandparent subquery alias`, () => {
    expect(() => {
      createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          const namedLocks = q
            .from({ source: locksCollection })
            .select(({ source }) => ({ _id: source._id, name: source.name }))
          return q.from({ lock: namedLocks }).select(({ lock }) => ({
            _id: lock._id,
            votes: toArray(
              q
                .from({ vote: votesCollection })
                .where(({ vote }) => eq(vote.lockId, lock._id))
                .select(({ vote }) => ({
                  _id: vote._id,
                  siblings: toArray(
                    q
                      .from({ lock: votesCollection })
                      .where(({ lock: sibling }) =>
                        eq(sibling.lockId, vote.lockId),
                      )
                      .select(({ lock: sibling }) => ({ _id: sibling._id })),
                  ),
                })),
            ),
          }))
        },
      })
    }).toThrow(/Subquery uses alias "lock"/)
  })

  // A unionAll() branch inside an include is part of the include's scope, so
  // its aliases cannot shadow the parent row either.
  test(`should throw DuplicateAliasInSubqueryError when an include's unionAll branch reuses a parent subquery alias`, () => {
    expect(() => {
      createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          const namedLocks = q
            .from({ source: locksCollection })
            .select(({ source }) => ({ _id: source._id, name: source.name }))
          return q
            .from({ lock: namedLocks })
            .select(({ lock: parentLock }) => ({
              _id: parentLock._id,
              votes: toArray(
                q
                  .unionAll(
                    q
                      .from({ lock: votesCollection })
                      .select(({ lock: vote }) => ({ voteId: vote._id })),
                    q
                      .from({ other: votesCollection })
                      .select(({ other }) => ({ voteId: other._id })),
                  )
                  .innerJoin(
                    { anchor: votesCollection },
                    ({ voteId, anchor }) => eq(voteId, anchor._id),
                  )
                  .where(({ anchor }) => eq(anchor.lockId, parentLock._id))
                  .select(({ voteId }) => ({ voteId })),
              ),
            }))
        },
      })
    }).toThrow(/Subquery uses alias "lock"/)
  })

  // A from() subquery inside an include can read the parent row through its
  // callbacks, so it cannot shadow the parent alias either.
  test(`should throw DuplicateAliasInSubqueryError when an include's from() subquery reuses a parent subquery alias`, () => {
    expect(() => {
      createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          const namedLocks = q
            .from({ source: locksCollection })
            .select(({ source }) => ({ _id: source._id, name: source.name }))
          return q
            .from({ lock: namedLocks })
            .select(({ lock: parentLock }) => ({
              _id: parentLock._id,
              votes: toArray(
                q
                  .from({
                    vote: q
                      .from({ lock: votesCollection })
                      .select(({ lock }) => ({
                        voteId: lock._id,
                        lockId: lock.lockId,
                        lockName: parentLock.name,
                      })),
                  })
                  .where(({ vote }) => eq(vote.lockId, parentLock._id))
                  .select(({ vote }) => ({ voteId: vote.voteId })),
              ),
            }))
        },
      })
    }).toThrow(/Subquery uses alias "lock"/)
  })

  test(`should throw DuplicateAliasInSubqueryError when a from() subquery inside an include's unionAll branch reuses a parent subquery alias`, () => {
    expect(() => {
      createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          const namedLocks = q
            .from({ source: locksCollection })
            .select(({ source }) => ({ _id: source._id, name: source.name }))
          return q
            .from({ lock: namedLocks })
            .select(({ lock: parentLock }) => ({
              _id: parentLock._id,
              votes: toArray(
                q
                  .unionAll(
                    q
                      .from({
                        mine: q
                          .from({ lock: votesCollection })
                          .select(({ lock }) => ({
                            voteId: lock._id,
                            lockName: parentLock.name,
                          })),
                      })
                      .select(({ mine }) => ({ voteId: mine.voteId })),
                    q
                      .from({ other: votesCollection })
                      .select(({ other }) => ({ voteId: other._id })),
                  )
                  .innerJoin(
                    { anchor: votesCollection },
                    ({ voteId, anchor }) => eq(voteId, anchor._id),
                  )
                  .where(({ anchor }) => eq(anchor.lockId, parentLock._id))
                  .select(({ voteId }) => ({ voteId })),
              ),
            }))
        },
      })
    }).toThrow(/Subquery uses alias "lock"/)
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
