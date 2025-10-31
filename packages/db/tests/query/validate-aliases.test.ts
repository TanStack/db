import { beforeEach, describe, expect, test } from "vitest"
import { createLiveQueryCollection, eq } from "../../src/query/index.js"
import { createCollection } from "../../src/collection/index.js"
import { mockSyncCollectionOptions } from "../utils.js"

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
      })
    ),
    votesCollection: createCollection(
      mockSyncCollectionOptions<Vote>({
        id: `votes`,
        getKey: (vote) => vote._id,
        initialData: votes,
        autoIndex: `eager`,
      })
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
              eq(lock._id, vote.lockId)
            )
            .select(({ lock }) => ({
              _id: lock._id,
              lockName: lock.name,
            }))

          return q
            .from({ vote: votesCollection }) // Reuses "vote" alias from subquery
            .join({ lock: locksAgg }, ({ vote, lock }) =>
              eq(lock._id, vote.lockId)
            )
            .select(({ vote, lock }) => ({
              voteId: vote._id,
              lockName: lock!.lockName,
            }))
        },
      })
    }).toThrow(/Subquery uses alias "vote"/)
  })

  test(`should allow subqueries when all collection aliases are unique`, () => {
    const query = createLiveQueryCollection({
      startSync: true,
      query: (q) => {
        const locksAgg = q
          .from({ lock: locksCollection })
          .join(
            { v: votesCollection }, // Uses unique alias "v" instead of "vote"
            ({ lock, v }) => eq(lock._id, v.lockId)
          )
          .select(({ lock }) => ({
            _id: lock._id,
            lockName: lock.name,
          }))

        return q
          .from({ vote: votesCollection })
          .join({ lock: locksAgg }, ({ vote, lock }) =>
            eq(lock._id, vote.lockId)
          )
          .select(({ vote, lock }) => ({
            voteId: vote._id,
            lockName: lock!.lockName,
          }))
      },
    })

    const results = query.toArray

    // Should successfully execute and return results
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.lockName)).toBe(true)
  })
})
