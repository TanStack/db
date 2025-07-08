import { beforeEach, describe, expect, test } from "vitest"
import {
  count,
  createLiveQueryCollection,
  eq,
  gt,
} from "../../src/query/index.js"
import { createCollection } from "../../src/collection.js"
import { mockSyncCollectionOptions } from "../utls.js"

// Sample user type for tests
type User = {
  id: number
  name: string
  age: number
  email: string
  active: boolean
  department_id: number | null
  salary: number
}

type Department = {
  id: number
  name: string
}

// Sample data for tests
const sampleUsers: Array<User> = [
  {
    id: 1,
    name: `Alice`,
    age: 25,
    email: `alice@example.com`,
    active: true,
    department_id: 1,
    salary: 75000,
  },
  {
    id: 2,
    name: `Bob`,
    age: 19,
    email: `bob@example.com`,
    active: true,
    department_id: 1,
    salary: 45000,
  },
  {
    id: 3,
    name: `Charlie`,
    age: 30,
    email: `charlie@example.com`,
    active: false,
    department_id: 2,
    salary: 85000,
  },
  {
    id: 4,
    name: `Dave`,
    age: 22,
    email: `dave@example.com`,
    active: true,
    department_id: 2,
    salary: 65000,
  },
  {
    id: 5,
    name: `Eve`,
    age: 28,
    email: `eve@example.com`,
    active: true,
    department_id: null,
    salary: 55000,
  },
]

const sampleDepartments: Array<Department> = [
  { id: 1, name: `Engineering` },
  { id: 2, name: `Marketing` },
  { id: 3, name: `HR` },
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

describe(`Functional Variants Query`, () => {
  describe(`fn.select`, () => {
    let usersCollection: ReturnType<typeof createUsersCollection>

    beforeEach(() => {
      usersCollection = createUsersCollection()
    })

    test(`should create live query with functional select transformation`, () => {
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q.from({ user: usersCollection }).fn.select((row) => ({
            displayName: `${row.user.name} (${row.user.id})`,
            salaryTier: row.user.salary > 60000 ? `senior` : `junior`,
            emailDomain: row.user.email.split(`@`)[1],
          })),
      })

      const results = liveCollection.toArray

      expect(results).toHaveLength(5)

      // Verify transformations
      const alice = results.find((u) => u.displayName.includes(`Alice`))
      expect(alice).toEqual({
        displayName: `Alice (1)`,
        salaryTier: `senior`,
        emailDomain: `example.com`,
      })

      const bob = results.find((u) => u.displayName.includes(`Bob`))
      expect(bob).toEqual({
        displayName: `Bob (2)`,
        salaryTier: `junior`,
        emailDomain: `example.com`,
      })

      // Insert a new user and verify transformation
      const newUser = {
        id: 6,
        name: `Frank`,
        age: 35,
        email: `frank@company.com`,
        active: true,
        department_id: 1,
        salary: 95000,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({ type: `insert`, value: newUser })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(6)
      const frank = liveCollection.get(6)
      expect(frank).toEqual({
        displayName: `Frank (6)`,
        salaryTier: `senior`,
        emailDomain: `company.com`,
      })

      // Update and verify transformation changes
      const updatedUser = { ...newUser, name: `Franklin`, salary: 50000 }
      usersCollection.utils.begin()
      usersCollection.utils.write({ type: `update`, value: updatedUser })
      usersCollection.utils.commit()

      const franklin = liveCollection.get(6)
      expect(franklin).toEqual({
        displayName: `Franklin (6)`,
        salaryTier: `junior`, // Changed due to salary update
        emailDomain: `company.com`,
      })

      // Delete and verify removal
      usersCollection.utils.begin()
      usersCollection.utils.write({ type: `delete`, value: updatedUser })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(5)
      expect(liveCollection.get(6)).toBeUndefined()
    })

    test(`should work with joins and functional select`, () => {
      const departmentsCollection = createDepartmentsCollection()

      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .join({ dept: departmentsCollection }, ({ user, dept }) =>
              eq(user.department_id, dept.id)
            )
            .fn.select((row) => ({
              employeeInfo: `${row.user.name} works in ${row.dept?.name || `Unknown`}`,
              isHighEarner: row.user.salary > 70000,
              yearsToRetirement: Math.max(0, 65 - row.user.age),
            })),
      })

      const results = liveCollection.toArray

      // Left join includes all users, even those with null department_id
      // But since dept will be undefined for Eve, she'll show as "works in Unknown"
      expect(results).toHaveLength(5) // All 5 users included with left join

      const alice = results.find((r) => r.employeeInfo.includes(`Alice`))
      expect(alice).toEqual({
        employeeInfo: `Alice works in Engineering`,
        isHighEarner: true,
        yearsToRetirement: 40,
      })

      const eve = results.find((r) => r.employeeInfo.includes(`Eve`))
      expect(eve).toEqual({
        employeeInfo: `Eve works in Unknown`,
        isHighEarner: false,
        yearsToRetirement: 37,
      })
    })
  })

  describe(`fn.where`, () => {
    let usersCollection: ReturnType<typeof createUsersCollection>

    beforeEach(() => {
      usersCollection = createUsersCollection()
    })

    test(`should filter with single functional where condition`, () => {
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .fn.where((row) => row.user.active && row.user.age >= 25),
      })

      const results = liveCollection.toArray

      expect(results).toHaveLength(2) // Alice (25, active) and Eve (28, active)
      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Eve`])
      )

      // Insert user that meets criteria
      const newUser = {
        id: 6,
        name: `Frank`,
        age: 30,
        email: `frank@example.com`,
        active: true,
        department_id: 1,
        salary: 70000,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({ type: `insert`, value: newUser })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(3)
      expect(liveCollection.get(6)).toEqual(newUser)

      // Insert user that doesn't meet criteria (too young)
      const youngUser = {
        id: 7,
        name: `Grace`,
        age: 20,
        email: `grace@example.com`,
        active: true,
        department_id: 1,
        salary: 40000,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({ type: `insert`, value: youngUser })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(3) // Should not include Grace
      expect(liveCollection.get(7)).toBeUndefined()

      // Update Grace to meet age criteria
      const olderGrace = { ...youngUser, age: 26 }
      usersCollection.utils.begin()
      usersCollection.utils.write({ type: `update`, value: olderGrace })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(4) // Now includes Grace
      expect(liveCollection.get(7)).toEqual(olderGrace)

      // Clean up
      usersCollection.utils.begin()
      usersCollection.utils.write({ type: `delete`, value: newUser })
      usersCollection.utils.write({ type: `delete`, value: olderGrace })
      usersCollection.utils.commit()
    })

    test(`should combine multiple functional where conditions (AND logic)`, () => {
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .fn.where((row) => row.user.active)
            .fn.where((row) => row.user.salary > 50000)
            .fn.where((row) => row.user.department_id !== null),
      })

      const results = liveCollection.toArray

      // Should only include: Alice (active, 75k, dept 1), Dave (active, 65k, dept 2)
      expect(results).toHaveLength(2)
      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Dave`])
      )

      // All results should meet all criteria
      results.forEach((user) => {
        expect(user.active).toBe(true)
        expect(user.salary).toBeGreaterThan(50000)
        expect(user.department_id).not.toBeNull()
      })
    })

    test(`should work alongside regular where clause`, () => {
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 20)) // Regular where
            .fn.where((row) => row.user.active) // Functional where
            .fn.where((row) => row.user.salary > 60000), // Another functional where
      })

      const results = liveCollection.toArray

      // Should include: Alice (25, active, 75k), Dave (22, active, 65k)
      expect(results).toHaveLength(2)
      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Dave`])
      )

      results.forEach((user) => {
        expect(user.age).toBeGreaterThan(20)
        expect(user.active).toBe(true)
        expect(user.salary).toBeGreaterThan(60000)
      })
    })
  })

  describe(`fn.having`, () => {
    let usersCollection: ReturnType<typeof createUsersCollection>

    beforeEach(() => {
      usersCollection = createUsersCollection()
    })

    test(`should filter groups with functional having`, () => {
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .groupBy(({ user }) => user.department_id)
            .select(({ user }) => ({
              department_id: user.department_id,
              employee_count: count(user.id),
            }))
            .fn.having((row) => (row as any).result.employee_count > 1),
      })

      const results = liveCollection.toArray

      // Should only include departments with more than 1 employee
      // Dept 1: Alice, Bob (2 employees)
      // Dept 2: Charlie, Dave (2 employees)
      // Dept null: Eve (1 employee) - excluded
      expect(results).toHaveLength(2)

      results.forEach((result) => {
        expect(result.employee_count).toBeGreaterThan(1)
      })

      const dept1 = results.find((r) => r.department_id === 1)
      const dept2 = results.find((r) => r.department_id === 2)

      expect(dept1).toEqual({ department_id: 1, employee_count: 2 })
      expect(dept2).toEqual({ department_id: 2, employee_count: 2 })

      // Add another user to department 1
      const newUser = {
        id: 6,
        name: `Frank`,
        age: 35,
        email: `frank@example.com`,
        active: true,
        department_id: 1,
        salary: 70000,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({ type: `insert`, value: newUser })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(2) // Still 2 departments
      const updatedDept1 = liveCollection.get(1)
      expect(updatedDept1).toEqual({ department_id: 1, employee_count: 3 }) // Now 3 employees

      // Remove one user from department 1
      const bobUser = sampleUsers.find((u) => u.name === `Bob`)
      if (bobUser) {
        usersCollection.utils.begin()
        usersCollection.utils.write({ type: `delete`, value: bobUser })
        usersCollection.utils.commit()

        expect(liveCollection.size).toBe(2) // Still 2 departments (dept 1 has Alice+Frank, dept 2 has Charlie+Dave)
        const dept1After = liveCollection.get(1)
        expect(dept1After).toEqual({ department_id: 1, employee_count: 2 }) // Alice + Frank = 2 employees

        // Clean up
        usersCollection.utils.begin()
        usersCollection.utils.write({ type: `insert`, value: bobUser }) // Re-add Bob
        usersCollection.utils.write({ type: `delete`, value: newUser })
        usersCollection.utils.commit()
      }
    })

    test(`should work without GROUP BY as additional filter`, () => {
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .fn.having((row) => row.user.salary > 70000 && row.user.age < 30),
      })

      const results = liveCollection.toArray

      // Should include: Alice (75k, 25 years)
      expect(results).toHaveLength(1)
      const firstResult = results[0]
      if (firstResult) {
        expect(firstResult.name).toBe(`Alice`)
        expect(firstResult.salary).toBeGreaterThan(70000)
        expect(firstResult.age).toBeLessThan(30)
      }

      // Insert user that meets criteria
      const newUser = {
        id: 6,
        name: `Frank`,
        age: 27,
        email: `frank@example.com`,
        active: true,
        department_id: 1,
        salary: 80000,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({ type: `insert`, value: newUser })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(2)
      expect(liveCollection.get(6)).toEqual(newUser)

      // Update to not meet criteria (too old)
      const olderFrank = { ...newUser, age: 35 }
      usersCollection.utils.begin()
      usersCollection.utils.write({ type: `update`, value: olderFrank })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(1) // Frank excluded
      expect(liveCollection.get(6)).toBeUndefined()

      // Clean up
      usersCollection.utils.begin()
      usersCollection.utils.write({ type: `delete`, value: olderFrank })
      usersCollection.utils.commit()
    })
  })

  describe(`combinations`, () => {
    let usersCollection: ReturnType<typeof createUsersCollection>
    let departmentsCollection: ReturnType<typeof createDepartmentsCollection>

    beforeEach(() => {
      usersCollection = createUsersCollection()
      departmentsCollection = createDepartmentsCollection()
    })

    test(`should combine all functional variants together`, () => {
      // Simplified test without complex GROUP BY + functional having combination
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .join({ dept: departmentsCollection }, ({ user, dept }) =>
              eq(user.department_id, dept.id)
            )
            .fn.where((row) => row.user.active)
            .fn.where((row) => row.user.salary > 60000)
            .fn.select((row) => ({
              departmentName: row.dept?.name || `Unknown`,
              employeeName: row.user.name,
              salary: row.user.salary,
            })),
      })

      const results = liveCollection.toArray

      // Should include: Alice (active, 75k), Dave (active, 65k)
      // Charlie excluded (inactive), Bob excluded (45k salary), Eve excluded (null dept)
      expect(results).toHaveLength(2)

      const alice = results.find((r) => r.employeeName === `Alice`)
      expect(alice).toEqual({
        departmentName: `Engineering`,
        employeeName: `Alice`,
        salary: 75000,
      })

      const dave = results.find((r) => r.employeeName === `Dave`)
      expect(dave).toEqual({
        departmentName: `Marketing`,
        employeeName: `Dave`,
        salary: 65000,
      })
    })

    test(`should work with regular and functional clauses mixed`, () => {
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 20)) // Regular where
            .fn.where((row) => row.user.active) // Functional where
            .select(({ user }) => ({
              // Regular select (will be replaced)
              id: user.id,
              name: user.name,
            }))
            .fn.select((row) => ({
              // Functional select (replaces regular)
              employeeId: row.user.id,
              displayName: `Employee: ${row.user.name}`,
              status: row.user.active ? `Active` : `Inactive`,
            })),
      })

      const results = liveCollection.toArray

      // Should include active users over 20: Alice, Dave, Eve
      expect(results).toHaveLength(3)

      // Should use functional select format, not regular select
      results.forEach((result) => {
        expect(result).toHaveProperty(`employeeId`)
        expect(result).toHaveProperty(`displayName`)
        expect(result).toHaveProperty(`status`)
        expect(result).not.toHaveProperty(`id`) // From regular select
        expect(result).not.toHaveProperty(`name`) // From regular select
        expect(result.status).toBe(`Active`)
      })

      const alice = results.find((r) => r.displayName.includes(`Alice`))
      expect(alice).toEqual({
        employeeId: 1,
        displayName: `Employee: Alice`,
        status: `Active`,
      })
    })

    test(`should handle complex business logic transformations`, () => {
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .fn.where((row) => {
              // Complex business rule: active employees with good salary or senior age
              return (
                row.user.active &&
                (row.user.salary > 70000 || row.user.age > 25)
              )
            })
            .fn.select((row) => {
              // Complex transformation with multiple calculations
              const salaryGrade =
                row.user.salary > 80000
                  ? `A`
                  : row.user.salary > 60000
                    ? `B`
                    : `C`
              const experienceLevel =
                row.user.age > 30
                  ? `Senior`
                  : row.user.age >= 25
                    ? `Mid`
                    : `Junior`

              return {
                profile: `${row.user.name} (${experienceLevel})`,
                compensation: {
                  salary: row.user.salary,
                  grade: salaryGrade,
                  bonus_eligible: salaryGrade === `A`,
                },
                metrics: {
                  age: row.user.age,
                  years_to_retirement: Math.max(0, 65 - row.user.age),
                  performance_bracket: salaryGrade,
                },
              }
            }),
      })

      const results = liveCollection.toArray

      // Should include: Alice (active, 75k), Eve (active, 28 years old)
      expect(results).toHaveLength(2)

      const alice = results.find((r) => r.profile.includes(`Alice`))
      expect(alice).toEqual({
        profile: `Alice (Mid)`,
        compensation: {
          salary: 75000,
          grade: `B`,
          bonus_eligible: false,
        },
        metrics: {
          age: 25,
          years_to_retirement: 40,
          performance_bracket: `B`,
        },
      })

      const eve = results.find((r) => r.profile.includes(`Eve`))
      expect(eve).toEqual({
        profile: `Eve (Mid)`,
        compensation: {
          salary: 55000,
          grade: `C`,
          bonus_eligible: false,
        },
        metrics: {
          age: 28,
          years_to_retirement: 37,
          performance_bracket: `C`,
        },
      })
    })
  })
})
