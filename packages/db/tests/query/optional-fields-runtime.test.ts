import { describe, expect, it } from "vitest"
import { createLiveQueryCollection, eq } from "../../src/query/index.js"
import { createCollection } from "../../src/collection.js"
import { mockSyncCollectionOptions } from "../utls.js"

// Test types with optional fields
type UserWithOptional = {
  id: string
  name: string
  email?: string // Optional field
  age?: number // Optional field
  department_id?: string // Optional foreign key
}

type Department = {
  id: string
  name: string
  budget: number
}

function createUsersCollection() {
  return createCollection(
    mockSyncCollectionOptions<UserWithOptional>({
      id: `test-users`,
      getKey: (user) => user.id,
      initialData: [
        {
          id: `1`,
          name: `Alice`,
          email: `alice@example.com`,
          age: 25,
          department_id: `dept1`,
        },
        {
          id: `2`,
          name: `Bob`,
          // email is missing (undefined)
          age: 30,
          // department_id is missing (undefined)
        },
        {
          id: `3`,
          name: `Charlie`,
          email: `charlie@example.com`,
          // age is missing (undefined)
          department_id: `dept2`,
        },
      ],
    })
  )
}

function createDepartmentsCollection() {
  return createCollection(
    mockSyncCollectionOptions<Department>({
      id: `test-departments`,
      getKey: (dept) => dept.id,
      initialData: [
        {
          id: `dept1`,
          name: `Engineering`,
          budget: 100000,
        },
        {
          id: `dept2`,
          name: `Marketing`,
          budget: 50000,
        },
      ],
    })
  )
}

describe(`Optional Fields - Runtime Tests`, () => {
  it(`should return undefined for missing optional fields in select clause`, () => {
    const usersCollection = createUsersCollection()

    const query = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q.from({ user: usersCollection }).select(({ user }) => ({
          id: user.id,
          name: user.name,
          email: user.email, // This should be undefined for Bob
          age: user.age, // This should be undefined for Charlie
        })),
    })

    const results = query.toArray

    // Find Bob's record (missing email and department_id)
    const bobRecord = results.find((r) => r.name === `Bob`)
    expect(bobRecord).toBeDefined()
    expect(bobRecord?.email).toBeUndefined()
    expect(bobRecord?.age).toBe(30) // age is present for Bob

    // Find Charlie's record (missing age)
    const charlieRecord = results.find((r) => r.name === `Charlie`)
    expect(charlieRecord).toBeDefined()
    expect(charlieRecord?.email).toBe(`charlie@example.com`)
    expect(charlieRecord?.age).toBeUndefined()

    // Find Alice's record (all fields present)
    const aliceRecord = results.find((r) => r.name === `Alice`)
    expect(aliceRecord).toBeDefined()
    expect(aliceRecord?.email).toBe(`alice@example.com`)
    expect(aliceRecord?.age).toBe(25)
  })

  it(`should handle optional fields in where clauses correctly`, () => {
    const usersCollection = createUsersCollection()

    // Query for users with email (should include Alice and Charlie, exclude Bob)
    const queryWithEmail = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.email, `alice@example.com`))
          .select(({ user }) => ({
            id: user.id,
            name: user.name,
            email: user.email,
          })),
    })

    const resultsWithEmail = queryWithEmail.toArray
    expect(resultsWithEmail).toHaveLength(1)
    expect(resultsWithEmail[0]?.name).toBe(`Alice`)

    // Query for users without email (should include only Bob)
    // Note: We can't directly query for undefined values, but we can query for specific values
    const queryForBob = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.name, `Bob`))
          .select(({ user }) => ({
            id: user.id,
            name: user.name,
            email: user.email,
          })),
    })

    const resultsForBob = queryForBob.toArray
    expect(resultsForBob).toHaveLength(1)
    expect(resultsForBob[0]?.name).toBe(`Bob`)
    expect(resultsForBob[0]?.email).toBeUndefined()
  })

  it(`should handle optional fields in join conditions correctly`, () => {
    const usersCollection = createUsersCollection()
    const departmentsCollection = createDepartmentsCollection()

    // Left join - should include all users, with department info for those who have it
    const leftJoinQuery = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: usersCollection })
          .join(
            { dept: departmentsCollection },
            ({ user, dept }) => eq(user.department_id, dept.id),
            `left`
          )
          .select(({ user, dept }) => ({
            user_name: user.name,
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            dept_name: dept?.name, // Should be undefined for Bob
          })),
    })

    const leftJoinResults = leftJoinQuery.toArray
    expect(leftJoinResults).toHaveLength(3)

    // Alice should have department info
    const aliceResult = leftJoinResults.find((r) => r.user_name === `Alice`)
    expect(aliceResult?.dept_name).toBe(`Engineering`)

    // Bob should not have department info (department_id is undefined)
    const bobResult = leftJoinResults.find((r) => r.user_name === `Bob`)
    expect(bobResult?.dept_name).toBeUndefined()

    // Charlie should have department info
    const charlieResult = leftJoinResults.find((r) => r.user_name === `Charlie`)
    expect(charlieResult?.dept_name).toBe(`Marketing`)
  })

  it(`should handle optional fields in group by correctly`, () => {
    const usersCollection = createUsersCollection()

    // Group by department_id and count users
    const groupByQuery = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: usersCollection })
          .groupBy(({ user }) => user.department_id)
          .select(({ user }) => ({
            department_id: user.department_id,
          })),
    })

    const groupByResults = groupByQuery.toArray
    expect(groupByResults).toHaveLength(3) // dept1, dept2, and undefined

    // Check that we have a group for undefined department_id (Bob)
    const undefinedDeptGroup = groupByResults.find(
      (r) => r.department_id === undefined
    )
    expect(undefinedDeptGroup).toBeDefined()

    // Check that we have groups for defined department_ids
    const dept1Group = groupByResults.find((r) => r.department_id === `dept1`)
    expect(dept1Group).toBeDefined()

    const dept2Group = groupByResults.find((r) => r.department_id === `dept2`)
    expect(dept2Group).toBeDefined()
  })

  it(`should not throw when accessing optional fields that are undefined`, () => {
    const usersCollection = createUsersCollection()

    // This query should not throw even though some users have undefined optional fields
    const query = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q.from({ user: usersCollection }).select(({ user }) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          age: user.age,
          department_id: user.department_id,
        })),
    })

    // The query should execute without throwing
    expect(() => {
      const results = query.toArray
      expect(results).toHaveLength(3)
    }).not.toThrow()

    // Verify that undefined values are handled correctly
    const results = query.toArray
    const bobRecord = results.find((r) => r.name === `Bob`)
    expect(bobRecord?.email).toBeUndefined()
    expect(bobRecord?.department_id).toBeUndefined()
  })
})
