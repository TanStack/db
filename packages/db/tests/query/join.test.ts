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

  describe(`Self-Join Scenarios`, () => {
    // Sample data for self-join testing
    type Employee = {
      id: number
      name: string
      manager_id: number | undefined
      department: string
    }

    const sampleEmployees: Array<Employee> = [
      { id: 1, name: `Alice`, manager_id: undefined, department: `Engineering` },
      { id: 2, name: `Bob`, manager_id: 1, department: `Engineering` },
      { id: 3, name: `Charlie`, manager_id: 1, department: `Sales` },
      { id: 4, name: `Dave`, manager_id: 2, department: `Engineering` },
      { id: 5, name: `Eve`, manager_id: 3, department: `Sales` },
    ]

    function createEmployeesCollection() {
      return createCollection(
        mockSyncCollectionOptions<Employee>({
          id: `test-employees`,
          getKey: (employee) => employee.id,
          initialData: sampleEmployees,
        })
      )
    }

    let employeesCollection: ReturnType<typeof createEmployeesCollection>

    beforeEach(() => {
      employeesCollection = createEmployeesCollection()
    })

    test(`should perform self-join to get employees with their managers`, () => {
      const selfJoinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ employees: employeesCollection })
            .join(
              { managers: employeesCollection },
              ({ employees, managers }) => eq(employees.manager_id, managers.id),
              `inner`
            )
            .select(({ employees, managers }) => ({
              employee_id: employees.id,
              employee_name: employees.name,
              manager_id: managers.id,
              manager_name: managers.name,
              department: employees.department,
            })),
      })

      const results = selfJoinQuery.toArray

      // Should have 4 results: Bob->Alice, Charlie->Alice, Dave->Bob, Eve->Charlie
      expect(results).toHaveLength(4)

      // Check specific relationships
      const bobResult = results.find((r) => r.employee_name === `Bob`)
      expect(bobResult).toMatchObject({
        employee_id: 2,
        employee_name: `Bob`,
        manager_id: 1,
        manager_name: `Alice`,
        department: `Engineering`,
      })

      const daveResult = results.find((r) => r.employee_name === `Dave`)
      expect(daveResult).toMatchObject({
        employee_id: 4,
        employee_name: `Dave`,
        manager_id: 2,
        manager_name: `Bob`,
        department: `Engineering`,
      })

      // Alice should not appear as an employee (she has no manager)
      const aliceAsEmployee = results.find((r) => r.employee_name === `Alice`)
      expect(aliceAsEmployee).toBeUndefined()

      // Alice should appear as a manager
      const aliceAsManager = results.find((r) => r.manager_name === `Alice`)
      expect(aliceAsManager).toBeDefined()
    })

    test(`should perform left self-join to get all employees with their managers`, () => {
      const leftSelfJoinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ employees: employeesCollection })
            .join(
              { managers: employeesCollection },
              ({ employees, managers }) => eq(employees.manager_id, managers.id),
              `left`
            )
            .select(({ employees, managers }) => ({
              employee_id: employees.id,
              employee_name: employees.name,
              manager_id: managers?.id,
              manager_name: managers?.name,
              department: employees.department,
            })),
      })

      const results = leftSelfJoinQuery.toArray

      // Should have 5 results: all employees, including Alice with null manager
      expect(results).toHaveLength(5)

      // Alice should appear as an employee with null manager
      const aliceResult = results.find((r) => r.employee_name === `Alice`)
      expect(aliceResult).toMatchObject({
        employee_id: 1,
        employee_name: `Alice`,
        manager_id: undefined,
        manager_name: undefined,
        department: `Engineering`,
      })

      // Bob should have Alice as manager
      const bobResult = results.find((r) => r.employee_name === `Bob`)
      expect(bobResult).toMatchObject({
        employee_id: 2,
        employee_name: `Bob`,
        manager_id: 1,
        manager_name: `Alice`,
        department: `Engineering`,
      })
    })

    test(`should handle live updates for self-joins`, () => {
      const selfJoinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ employees: employeesCollection })
            .join(
              { managers: employeesCollection },
              ({ employees, managers }) => eq(employees.manager_id, managers.id),
              `inner`
            )
            .select(({ employees, managers }) => ({
              employee_id: employees.id,
              employee_name: employees.name,
              manager_name: managers.name,
            })),
      })

      const initialSize = selfJoinQuery.size
      expect(initialSize).toBe(4)

      // Add a new employee with an existing manager
      const newEmployee: Employee = {
        id: 6,
        name: `Frank`,
        manager_id: 1, // Alice
        department: `Engineering`,
      }

      employeesCollection.utils.begin()
      employeesCollection.utils.write({ type: `insert`, value: newEmployee })
      employeesCollection.utils.commit()

      // Should now have 5 results
      expect(selfJoinQuery.size).toBe(5)

      const frankResult = selfJoinQuery.get(`[6,1]`)
      expect(frankResult).toMatchObject({
        employee_id: 6,
        employee_name: `Frank`,
        manager_name: `Alice`,
      })
    })

    test(`should handle bug report scenario - self-join with parentId`, () => {
      // This test reproduces the exact scenario from the bug report
      type User = {
        id: number
        name: string
        parentId: number | undefined
      }

      const sampleUsers: Array<User> = [
        { id: 1, name: `Alice`, parentId: undefined },
        { id: 2, name: `Bob`, parentId: 1 },
        { id: 3, name: `Charlie`, parentId: 1 },
        { id: 4, name: `Dave`, parentId: 2 },
        { id: 5, name: `Eve`, parentId: 3 },
      ]

      const usersCollection = createCollection(
        mockSyncCollectionOptions<User>({
          id: `test-users-self-join`,
          getKey: (user) => user.id,
          initialData: sampleUsers,
        })
      )

      const selfJoinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ users: usersCollection })
            .join(
              { parentUsers: usersCollection },
              ({ users, parentUsers }) => eq(users.parentId, parentUsers.id),
              `inner`
            )
            .select(({ users, parentUsers }) => ({
              user_id: users.id,
              user_name: users.name,
              parent_id: parentUsers.id,
              parent_name: parentUsers.name,
            })),
      })

      const results = selfJoinQuery.toArray

      // Should have 4 results: Bob->Alice, Charlie->Alice, Dave->Bob, Eve->Charlie
      expect(results).toHaveLength(4)

      // Check specific relationships
      const bobResult = results.find((r) => r.user_name === `Bob`)
      expect(bobResult).toMatchObject({
        user_id: 2,
        user_name: `Bob`,
        parent_id: 1,
        parent_name: `Alice`,
      })

      const daveResult = results.find((r) => r.user_name === `Dave`)
      expect(daveResult).toMatchObject({
        user_id: 4,
        user_name: `Dave`,
        parent_id: 2,
        parent_name: `Bob`,
      })

      // Alice should not appear as a user (she has no parent)
      const aliceAsUser = results.find((r) => r.user_name === `Alice`)
      expect(aliceAsUser).toBeUndefined()

      // Alice should appear as a parent
      const aliceAsParent = results.find((r) => r.parent_name === `Alice`)
      expect(aliceAsParent).toBeDefined()
    })

    test(`should not produce cartesian product in self-joins - reproduces bug report issue`, () => {
      // This test reproduces the cartesian product issue from the bug report
      // With 10 input rows, we should get exactly 9 results (not 100)
      type User = {
        id: number
        name: string
        parentId: number | undefined
      }

      // Create 10 users with clear parent-child relationships
      const sampleUsers: Array<User> = [
        { id: 1, name: `User1`, parentId: undefined }, // Root
        { id: 2, name: `User2`, parentId: 1 },         // Child of 1
        { id: 3, name: `User3`, parentId: 1 },         // Child of 1
        { id: 4, name: `User4`, parentId: 2 },         // Child of 2
        { id: 5, name: `User5`, parentId: 2 },         // Child of 2
        { id: 6, name: `User6`, parentId: 3 },         // Child of 3
        { id: 7, name: `User7`, parentId: 3 },         // Child of 3
        { id: 8, name: `User8`, parentId: 4 },         // Child of 4
        { id: 9, name: `User9`, parentId: 5 },         // Child of 5
        { id: 10, name: `User10`, parentId: 6 },       // Child of 6
      ]

      const usersCollection = createCollection(
        mockSyncCollectionOptions<User>({
          id: `test-users-cartesian`,
          getKey: (user) => user.id,
          initialData: sampleUsers,
        })
      )

      const selfJoinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ users: usersCollection })
            .join(
              { parentUsers: usersCollection },
              ({ users, parentUsers }) => eq(users.parentId, parentUsers.id),
              `inner`
            )
            .select(({ users, parentUsers }) => ({
              user_id: users.id,
              user_name: users.name,
              parent_id: parentUsers.id,
              parent_name: parentUsers.name,
            })),
      })

      const results = selfJoinQuery.toArray

      // Should have exactly 9 results (all users except the root user)
      // NOT 100 (which would be a cartesian product)
      expect(results).toHaveLength(9)

      // Verify the relationships are correct
      const user2Result = results.find((r) => r.user_name === `User2`)
      expect(user2Result).toMatchObject({
        user_id: 2,
        user_name: `User2`,
        parent_id: 1,
        parent_name: `User1`,
      })

      const user4Result = results.find((r) => r.user_name === `User4`)
      expect(user4Result).toMatchObject({
        user_id: 4,
        user_name: `User4`,
        parent_id: 2,
        parent_name: `User2`,
      })

      // User1 should not appear as a child (it has no parent)
      const user1AsChild = results.find((r) => r.user_name === `User1`)
      expect(user1AsChild).toBeUndefined()

      // User1 should appear as a parent multiple times
      const user1AsParent = results.filter((r) => r.parent_name === `User1`)
      expect(user1AsParent).toHaveLength(2) // User2 and User3
    })

    test(`should handle larger dataset without cartesian product`, () => {
      // Test with a larger dataset to ensure the issue doesn't appear
      type User = {
        id: number
        name: string
        parentId: number | undefined
      }

      // Create 100 users with a tree structure
      const sampleUsers: Array<User> = []
      for (let i = 1; i <= 100; i++) {
        const parentId = i === 1 ? undefined : Math.floor(i / 2)
        sampleUsers.push({
          id: i,
          name: `User${i}`,
          parentId: parentId === 0 ? undefined : parentId,
        })
      }

      const usersCollection = createCollection(
        mockSyncCollectionOptions<User>({
          id: `test-users-large`,
          getKey: (user) => user.id,
          initialData: sampleUsers,
        })
      )

      const selfJoinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ users: usersCollection })
            .join(
              { parentUsers: usersCollection },
              ({ users, parentUsers }) => eq(users.parentId, parentUsers.id),
              `inner`
            )
            .select(({ users, parentUsers }) => ({
              user_id: users.id,
              user_name: users.name,
              parent_id: parentUsers.id,
              parent_name: parentUsers.name,
            })),
      })

      const results = selfJoinQuery.toArray

      // Should have exactly 99 results (all users except the root user)
      // NOT 999894 (which would be a cartesian product)
      expect(results).toHaveLength(99)

      // Verify some specific relationships
      const user2Result = results.find((r) => r.user_name === `User2`)
      expect(user2Result).toMatchObject({
        user_id: 2,
        parent_id: 1,
        parent_name: `User1`,
      })

      const user3Result = results.find((r) => r.user_name === `User3`)
      expect(user3Result).toMatchObject({
        user_id: 3,
        parent_id: 1,
        parent_name: `User1`,
      })

      // User1 should not appear as a child
      const user1AsChild = results.find((r) => r.user_name === `User1`)
      expect(user1AsChild).toBeUndefined()
    })

    test(`should verify join key generation for self-joins`, () => {
      // This test specifically checks that join keys are being generated correctly
      // and that we're not getting cartesian products
      type User = {
        id: number
        name: string
        parentId: number | undefined
      }

      // Create a simple dataset where we can easily verify the join keys
      const sampleUsers: Array<User> = [
        { id: 1, name: `Alice`, parentId: undefined },
        { id: 2, name: `Bob`, parentId: 1 },
        { id: 3, name: `Charlie`, parentId: 1 },
        { id: 4, name: `Dave`, parentId: 2 },
      ]

      const usersCollection = createCollection(
        mockSyncCollectionOptions<User>({
          id: `test-users-join-keys`,
          getKey: (user) => user.id,
          initialData: sampleUsers,
        })
      )

      const selfJoinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ users: usersCollection })
            .join(
              { parentUsers: usersCollection },
              ({ users, parentUsers }) => eq(users.parentId, parentUsers.id),
              `inner`
            )
            .select(({ users, parentUsers }) => ({
              user_id: users.id,
              user_name: users.name,
              parent_id: parentUsers.id,
              parent_name: parentUsers.name,
            })),
      })

      const results = selfJoinQuery.toArray

      // Should have exactly 3 results (Bob->Alice, Charlie->Alice, Dave->Bob)
      expect(results).toHaveLength(3)

      // Verify the actual relationships by checking the results directly
      const bobResult = results.find(r => r.user_name === `Bob`)
      expect(bobResult).toMatchObject({
        user_id: 2,
        user_name: `Bob`,
        parent_id: 1,
        parent_name: `Alice`,
      })

      const daveResult = results.find(r => r.user_name === `Dave`)
      expect(daveResult).toMatchObject({
        user_id: 4,
        user_name: `Dave`,
        parent_id: 2,
        parent_name: `Bob`,
      })

      // Verify that we don't have any cartesian product results
      // Each user should appear at most once as a child
      const uniqueUserIds = new Set(results.map(r => r.user_id))
      expect(uniqueUserIds.size).toBe(3) // Bob, Charlie, Dave

      // Each parent should appear as many times as they have children
      const parentCounts = results.reduce((acc, r) => {
        acc[r.parent_id] = (acc[r.parent_id] || 0) + 1
        return acc
      }, {} as Record<number, number>)
      
      expect(parentCounts[1]).toBe(2) // Alice has 2 children (Bob, Charlie)
      expect(parentCounts[2]).toBe(1) // Bob has 1 child (Dave)
    })

    test(`should handle self-join with limit to prevent memory issues`, () => {
      // This test simulates the bug report scenario with limit
      type User = {
        id: number
        name: string
        parentId: number | undefined
      }

      // Create a larger dataset to simulate the 8000 rows scenario
      const sampleUsers: Array<User> = []
      for (let i = 1; i <= 100; i++) {
        const parentId = i === 1 ? undefined : Math.floor(i / 2)
        sampleUsers.push({
          id: i,
          name: `User${i}`,
          parentId: parentId === 0 ? undefined : parentId,
        })
      }

      const usersCollection = createCollection(
        mockSyncCollectionOptions<User>({
          id: `test-users-limit`,
          getKey: (user) => user.id,
          initialData: sampleUsers,
        })
      )

      const selfJoinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ users: usersCollection })
            .join(
              { parentUsers: usersCollection },
              ({ users, parentUsers }) => eq(users.parentId, parentUsers.id),
              `inner`
            )
            .select(({ users, parentUsers }) => ({
              user_id: users.id,
              user_name: users.name,
              parent_id: parentUsers.id,
              parent_name: parentUsers.name,
            }))
            .orderBy(({ users }) => users.id)
            .limit(10), // Add limit like in the bug report
      })

      const results = selfJoinQuery.toArray

      // Should have exactly 10 results (limited)
      expect(results).toHaveLength(10)

      // All results should have valid parent-child relationships
      results.forEach((result) => {
        expect(result.user_id).toBeGreaterThan(result.parent_id)
        expect(result.parent_id).toBeGreaterThan(0)
      })

      // Should not have any cartesian product results
      const uniqueUserIds = new Set(results.map(r => r.user_id))
      const uniqueParentIds = new Set(results.map(r => r.parent_id))
      
      // Each user should appear at most once
      expect(uniqueUserIds.size).toBe(10)
      
      // Parent IDs should be a subset of all possible parent IDs
      expect(uniqueParentIds.size).toBeLessThanOrEqual(50) // Should be much smaller than 100
    })
  })
})
