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

describe(`Discord Bug: Same Alias in Parent and Subquery`, () => {
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

  test(`should throw error when subquery uses same alias as parent (Discord bug)`, () => {
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
            .from({ vote: votesCollection }) // CONFLICT: "vote" alias used here
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

  test(`workaround: rename alias in one of the queries`, () => {
    const query = createLiveQueryCollection({
      startSync: true,
      query: (q) => {
        const locksAgg = q
          .from({ lock: locksCollection })
          .join(
            { v: votesCollection },
            (
              { lock, v } // Renamed to "v"
            ) => eq(lock._id, v.lockId)
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
    // Each lock (2) joins with each vote for that lock
    // Lock 1 has 2 votes, Lock 2 has 1 vote
    // But locksAgg groups by lock, so we get 2 aggregated lock records
    // Each of the 3 votes joins with its corresponding lock aggregate
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.lockName)).toBe(true)
  })
})
