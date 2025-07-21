import { beforeEach, describe, expect, test } from "vitest"
import { createLiveQueryCollection, eq } from "../../src/query/index.js"
import { createCollection } from "../../src/collection.js"
import { mockSyncCollectionOptions } from "../utls.js"

// Sample data types for join testing
type User = {
  id: number
  name: string
  email: string
  department_id: number | undefined
}

type Department = {
  id: number
  name: string
  budget: number
}

// Sample user data
const sampleUsers: Array<User> = [
  { id: 1, name: `Alice`, email: `alice@example.com`, department_id: 1 },
  { id: 2, name: `Bob`, email: `bob@example.com`, department_id: 1 },
  { id: 3, name: `Charlie`, email: `charlie@example.com`, department_id: 2 },
  { id: 4, name: `Dave`, email: `dave@example.com`, department_id: undefined },
]

// Sample department data
const sampleDepartments: Array<Department> = [
  { id: 1, name: `Engineering`, budget: 100000 },
  { id: 2, name: `Sales`, budget: 80000 },
  { id: 3, name: `Marketing`, budget: 60000 },
]

function createUsersCollection() {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `test-users`,
      getKey: (user) => user.id,
      initialData: sampleUsers,
    })
  )
}

function createDepartmentsCollection() {
  return createCollection(
    mockSyncCollectionOptions<Department>({
      id: `test-departments`,
      getKey: (dept) => dept.id,
      initialData: sampleDepartments,
    })
  )
}

// Join types to test
const joinTypes = [`inner`, `left`, `right`, `full`] as const
type JoinType = (typeof joinTypes)[number]

// Expected results for each join type
const expectedResults = {
  inner: {
    initialCount: 3, // Alice+Eng, Bob+Eng, Charlie+Sales
    userNames: [`Alice`, `Bob`, `Charlie`],
    includesDave: false,
    includesMarketing: false,
  },
  left: {
    initialCount: 4, // All users (Dave has null dept)
    userNames: [`Alice`, `Bob`, `Charlie`, `Dave`],
    includesDave: true,
    includesMarketing: false,
  },
  right: {
    initialCount: 4, // Alice+Eng, Bob+Eng, Charlie+Sales, null+Marketing
    userNames: [`Alice`, `Bob`, `Charlie`], // null user not counted
    includesDave: false,
    includesMarketing: true,
  },
  full: {
    initialCount: 5, // Alice+Eng, Bob+Eng, Charlie+Sales, Dave+null, null+Marketing
    userNames: [`Alice`, `Bob`, `Charlie`, `Dave`],
    includesDave: true,
    includesMarketing: true,
  },
} as const

function testJoinType(joinType: JoinType) {
  describe(`${joinType} joins`, () => {
    let usersCollection: ReturnType<typeof createUsersCollection>
    let departmentsCollection: ReturnType<typeof createDepartmentsCollection>

    beforeEach(() => {
      usersCollection = createUsersCollection()
      departmentsCollection = createDepartmentsCollection()
    })

    test(`should perform ${joinType} join with explicit select`, () => {
      const joinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .join(
              { dept: departmentsCollection },
              ({ user, dept }) => eq(user.department_id, dept.id),
              joinType
            )
            .select(({ user, dept }) => ({
              user_name: user.name,
              department_name: dept.name,
              budget: dept.budget,
            })),
      })

      const results = joinQuery.toArray
      const expected = expectedResults[joinType]

      expect(results).toHaveLength(expected.initialCount)

      // Check specific behaviors for each join type
      if (joinType === `inner`) {
        // Inner join should only include matching records
        const userNames = results.map((r) => r.user_name).sort()
        expect(userNames).toEqual([`Alice`, `Bob`, `Charlie`])

        const alice = results.find((r) => r.user_name === `Alice`)
        expect(alice).toMatchObject({
          user_name: `Alice`,
          department_name: `Engineering`,
          budget: 100000,
        })
      }

      if (joinType === `left`) {
        // Left join should include all users, even Dave with null department
        const userNames = results.map((r) => r.user_name).sort()
        expect(userNames).toEqual([`Alice`, `Bob`, `Charlie`, `Dave`])

        const dave = results.find((r) => r.user_name === `Dave`)
        expect(dave).toMatchObject({
          user_name: `Dave`,
          department_name: undefined,
          budget: undefined,
        })
      }

      if (joinType === `right`) {
        // Right join should include all departments, even Marketing with no users
        const departmentNames = results.map((r) => r.department_name).sort()
        expect(departmentNames).toEqual([
          `Engineering`,
          `Engineering`,
          `Marketing`,
          `Sales`,
        ])

        const marketing = results.find((r) => r.department_name === `Marketing`)
        expect(marketing).toMatchObject({
          user_name: undefined,
          department_name: `Marketing`,
          budget: 60000,
        })
      }

      if (joinType === `full`) {
        // Full join should include all users and all departments
        expect(results).toHaveLength(5)

        const dave = results.find((r) => r.user_name === `Dave`)
        expect(dave).toMatchObject({
          user_name: `Dave`,
          department_name: undefined,
          budget: undefined,
        })

        const marketing = results.find((r) => r.department_name === `Marketing`)
        expect(marketing).toMatchObject({
          user_name: undefined,
          department_name: `Marketing`,
          budget: 60000,
        })
      }
    })

    test(`should perform ${joinType} join without select (namespaced result)`, () => {
      const joinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .join(
              { dept: departmentsCollection },
              ({ user, dept }) => eq(user.department_id, dept.id),
              joinType
            ),
      })

      const results = joinQuery.toArray as Array<
        Partial<(typeof joinQuery.toArray)[number]>
      > // Type coercion to allow undefined properties in tests
      const expected = expectedResults[joinType]

      expect(results).toHaveLength(expected.initialCount)

      switch (joinType) {
        case `inner`: {
          // Inner join: all results should have both user and dept
          results.forEach((result) => {
            expect(result).toHaveProperty(`user`)
            expect(result).toHaveProperty(`dept`)
          })
          break
        }
        case `left`: {
          // Left join: all results have user, but Dave (id=4) has no dept
          results.forEach((result) => {
            expect(result).toHaveProperty(`user`)
          })
          results
            .filter((result) => result.user?.id === 4)
            .forEach((result) => {
              expect(result).not.toHaveProperty(`dept`)
            })
          results
            .filter((result) => result.user?.id !== 4)
            .forEach((result) => {
              expect(result).toHaveProperty(`dept`)
            })
          break
        }
        case `right`: {
          // Right join: all results have dept, but Marketing dept has no user
          results.forEach((result) => {
            expect(result).toHaveProperty(`dept`)
          })
          // Results with matching users should have user property
          results
            .filter((result) => result.dept?.id !== 3)
            .forEach((result) => {
              expect(result).toHaveProperty(`user`)
            })
          // Marketing department (id=3) should not have user
          results
            .filter((result) => result.dept?.id === 3)
            .forEach((result) => {
              expect(result).not.toHaveProperty(`user`)
            })
          break
        }
        case `full`: {
          // Full join: combination of left and right behaviors
          // Dave (user id=4) should have user but no dept
          results
            .filter((result) => result.user?.id === 4)
            .forEach((result) => {
              expect(result).toHaveProperty(`user`)
              expect(result).not.toHaveProperty(`dept`)
            })
          // Marketing (dept id=3) should have dept but no user
          results
            .filter((result) => result.dept?.id === 3)
            .forEach((result) => {
              expect(result).toHaveProperty(`dept`)
              expect(result).not.toHaveProperty(`user`)
            })
          // Matched records should have both
          results
            .filter((result) => result.user?.id !== 4 && result.dept?.id !== 3)
            .forEach((result) => {
              expect(result).toHaveProperty(`user`)
              expect(result).toHaveProperty(`dept`)
            })
          break
        }
      }
    })

    test(`should handle live updates for ${joinType} joins - insert matching record`, () => {
      const joinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .join(
              { dept: departmentsCollection },
              ({ user, dept }) => eq(user.department_id, dept.id),
              joinType
            )
            .select(({ user, dept }) => ({
              user_name: user.name,
              department_name: dept.name,
            })),
      })

      const initialSize = joinQuery.size

      // Insert a new user with existing department
      const newUser: User = {
        id: 5,
        name: `Eve`,
        email: `eve@example.com`,
        department_id: 1, // Engineering
      }

      usersCollection.utils.begin()
      usersCollection.utils.write({ type: `insert`, value: newUser })
      usersCollection.utils.commit()

      // For all join types, adding a matching user should increase the count
      expect(joinQuery.size).toBe(initialSize + 1)

      const eve = joinQuery.get(5)
      if (eve) {
        expect(eve).toMatchObject({
          user_name: `Eve`,
          department_name: `Engineering`,
        })
      }
    })

    test(`should handle live updates for ${joinType} joins - delete record`, () => {
      const joinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .join(
              { dept: departmentsCollection },
              ({ user, dept }) => eq(user.department_id, dept.id),
              joinType
            )
            .select(({ user, dept }) => ({
              user_name: user.name,
              department_name: dept.name,
            })),
      })

      const initialSize = joinQuery.size

      // Delete Alice (user 1) - she has a matching department
      const alice = sampleUsers.find((u) => u.id === 1)!
      usersCollection.utils.begin()
      usersCollection.utils.write({ type: `delete`, value: alice })
      usersCollection.utils.commit()

      // The behavior depends on join type
      if (joinType === `inner` || joinType === `left`) {
        // Alice was contributing to the result, so count decreases
        expect(joinQuery.size).toBe(initialSize - 1)
        expect(joinQuery.get(1)).toBeUndefined()
      } else {
        // (joinType === `right` || joinType === `full`)
        // Alice was contributing, but the behavior might be different
        // This will depend on the exact implementation
        expect(joinQuery.get(1)).toBeUndefined()
      }
    })

    if (joinType === `left` || joinType === `full`) {
      test(`should handle null to match transition for ${joinType} joins`, () => {
        const joinQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ user: usersCollection })
              .join(
                { dept: departmentsCollection },
                ({ user, dept }) => eq(user.department_id, dept.id),
                joinType
              )
              .select(({ user, dept }) => ({
                user_name: user.name,
                department_name: dept.name,
              })),
        })

        // Initially Dave has null department
        const daveBefore = joinQuery.get(`[4,undefined]`)
        expect(daveBefore).toMatchObject({
          user_name: `Dave`,
          department_name: undefined,
        })

        const daveBefore2 = joinQuery.get(`[4,1]`)
        expect(daveBefore2).toBeUndefined()

        // Update Dave to have a department
        const updatedDave: User = {
          ...sampleUsers.find((u) => u.id === 4)!,
          department_id: 1, // Engineering
        }

        usersCollection.utils.begin()
        usersCollection.utils.write({ type: `update`, value: updatedDave })
        usersCollection.utils.commit()

        const daveAfter = joinQuery.get(`[4,1]`)
        expect(daveAfter).toMatchObject({
          user_name: `Dave`,
          department_name: `Engineering`,
        })

        const daveAfter2 = joinQuery.get(`[4,undefined]`)
        expect(daveAfter2).toBeUndefined()
      })
    }

    if (joinType === `right` || joinType === `full`) {
      test(`should handle unmatched department for ${joinType} joins`, () => {
        const joinQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ user: usersCollection })
              .join(
                { dept: departmentsCollection },
                ({ user, dept }) => eq(user.department_id, dept.id),
                joinType
              )
              .select(({ user, dept }) => ({
                user_name: user.name,
                department_name: dept.name,
              })),
        })

        // Initially Marketing has no users
        const marketingResults = joinQuery.toArray.filter(
          (r) => r.department_name === `Marketing`
        )
        expect(marketingResults).toHaveLength(1)
        expect(marketingResults[0]?.user_name).toBeUndefined()

        // Insert a user for Marketing department
        const newUser: User = {
          id: 5,
          name: `Eve`,
          email: `eve@example.com`,
          department_id: 3, // Marketing
        }

        usersCollection.utils.begin()
        usersCollection.utils.write({ type: `insert`, value: newUser })
        usersCollection.utils.commit()

        // Should now have Eve in Marketing instead of null
        const updatedMarketingResults = joinQuery.toArray.filter(
          (r) => r.department_name === `Marketing`
        )
        expect(updatedMarketingResults).toHaveLength(1)
        expect(updatedMarketingResults[0]).toMatchObject({
          user_name: `Eve`,
          department_name: `Marketing`,
        })
      })
    }
  })
}

describe(`Query JOIN Operations`, () => {
  // Generate tests for each join type
  joinTypes.forEach((joinType) => {
    testJoinType(joinType)
  })

  describe(`Complex Join Scenarios`, () => {
    let usersCollection: ReturnType<typeof createUsersCollection>
    let departmentsCollection: ReturnType<typeof createDepartmentsCollection>

    beforeEach(() => {
      usersCollection = createUsersCollection()
      departmentsCollection = createDepartmentsCollection()
    })

    test(`should handle multiple simultaneous updates`, () => {
      const innerJoinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .join(
              { dept: departmentsCollection },
              ({ user, dept }) => eq(user.department_id, dept.id),
              `inner`
            )
            .select(({ user, dept }) => ({
              user_name: user.name,
              department_name: dept.name,
            })),
      })

      expect(innerJoinQuery.size).toBe(3)

      // Perform multiple operations in a single transaction
      usersCollection.utils.begin()
      departmentsCollection.utils.begin()

      // Delete Alice
      const alice = sampleUsers.find((u) => u.id === 1)!
      usersCollection.utils.write({ type: `delete`, value: alice })

      // Add new user Eve to Engineering
      const eve: User = {
        id: 5,
        name: `Eve`,
        email: `eve@example.com`,
        department_id: 1,
      }
      usersCollection.utils.write({ type: `insert`, value: eve })

      // Add new department IT
      const itDept: Department = { id: 4, name: `IT`, budget: 120000 }
      departmentsCollection.utils.write({ type: `insert`, value: itDept })

      // Update Dave to join IT
      const updatedDave: User = {
        ...sampleUsers.find((u) => u.id === 4)!,
        department_id: 4,
      }
      usersCollection.utils.write({ type: `update`, value: updatedDave })

      usersCollection.utils.commit()
      departmentsCollection.utils.commit()

      // Should still have 4 results: Bob+Eng, Charlie+Sales, Eve+Eng, Dave+IT
      expect(innerJoinQuery.size).toBe(4)

      const resultNames = innerJoinQuery.toArray.map((r) => r.user_name).sort()
      expect(resultNames).toEqual([`Bob`, `Charlie`, `Dave`, `Eve`])

      const daveResult = innerJoinQuery.toArray.find(
        (r) => r.user_name === `Dave`
      )
      expect(daveResult).toMatchObject({
        user_name: `Dave`,
        department_name: `IT`,
      })
    })

    test(`should handle empty collections`, () => {
      const emptyUsers = createCollection(
        mockSyncCollectionOptions<User>({
          id: `empty-users`,
          getKey: (user) => user.id,
          initialData: [],
        })
      )

      const innerJoinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: emptyUsers })
            .join(
              { dept: departmentsCollection },
              ({ user, dept }) => eq(user.department_id, dept.id),
              `inner`
            )
            .select(({ user, dept }) => ({
              user_name: user.name,
              department_name: dept.name,
            })),
      })

      expect(innerJoinQuery.size).toBe(0)

      // Add user to empty collection
      const newUser: User = {
        id: 1,
        name: `Alice`,
        email: `alice@example.com`,
        department_id: 1,
      }
      emptyUsers.utils.begin()
      emptyUsers.utils.write({ type: `insert`, value: newUser })
      emptyUsers.utils.commit()

      expect(innerJoinQuery.size).toBe(1)
      const result = innerJoinQuery.get(`[1,1]`)
      expect(result).toMatchObject({
        user_name: `Alice`,
        department_name: `Engineering`,
      })
    })

    test(`should handle null join keys correctly`, () => {
      // Test with user that has null department_id
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
              user_id: user.id,
              user_name: user.name,
              department_id: user.department_id,
              department_name: dept.name,
            })),
      })

      const results = leftJoinQuery.toArray
      expect(results).toHaveLength(4)

      // Dave has null department_id
      const dave = results.find((r) => r.user_name === `Dave`)
      expect(dave).toMatchObject({
        user_id: 4,
        user_name: `Dave`,
        department_id: undefined,
        department_name: undefined,
      })

      // Other users should have department names
      const alice = results.find((r) => r.user_name === `Alice`)
      expect(alice?.department_name).toBe(`Engineering`)
    })
  })
})
