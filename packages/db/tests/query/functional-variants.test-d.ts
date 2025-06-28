import { describe, expectTypeOf, test } from "vitest"
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
]

const sampleDepartments: Array<Department> = [
  { id: 1, name: `Engineering` },
  { id: 2, name: `Marketing` },
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

describe(`Functional Variants Types`, () => {
  const usersCollection = createUsersCollection()
  const departmentsCollection = createDepartmentsCollection()

  test(`fn.select return type`, () => {
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q.from({ user: usersCollection }).fn.select((row) => ({
          displayName: `${row.user.name} (${row.user.id})`,
          salaryTier:
            row.user.salary > 60000 ? (`senior` as const) : (`junior` as const),
          emailDomain: row.user.email.split(`@`)[1]!,
        })),
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        displayName: string
        salaryTier: `senior` | `junior`
        emailDomain: string
      }>
    >()
  })

  test(`fn.select with complex transformation return type`, () => {
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q.from({ user: usersCollection }).fn.select((row) => {
          const salaryGrade =
            row.user.salary > 80000
              ? (`A` as const)
              : row.user.salary > 60000
                ? (`B` as const)
                : (`C` as const)
          return {
            profile: {
              name: row.user.name,
              age: row.user.age,
            },
            compensation: {
              salary: row.user.salary,
              grade: salaryGrade,
              bonus_eligible: salaryGrade === `A`,
            },
          }
        }),
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        profile: {
          name: string
          age: number
        }
        compensation: {
          salary: number
          grade: `A` | `B` | `C`
          bonus_eligible: boolean
        }
      }>
    >()
  })

  test(`fn.where with filtered original type`, () => {
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .fn.where((row) => row.user.active && row.user.age >= 25),
    })

    const results = liveCollection.toArray
    // Should return the original User type since no select transformation
    expectTypeOf(results).toEqualTypeOf<Array<User>>()
  })

  test(`fn.where with regular where clause`, () => {
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => gt(user.age, 20))
          .fn.where((row) => row.user.active),
    })

    const results = liveCollection.toArray
    // Should return the original User type
    expectTypeOf(results).toEqualTypeOf<Array<User>>()
  })

  test(`fn.having with GROUP BY return type`, () => {
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .groupBy(({ user }) => user.department_id)
          .fn.having((row) => row.user.department_id !== null)
          .select(({ user }) => ({
            department_id: user.department_id,
            employee_count: count(user.id),
          })),
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        department_id: number | null
        employee_count: number
      }>
    >()
  })

  test(`fn.having without GROUP BY return type`, () => {
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .fn.having((row) => row.user.salary > 70000),
    })

    const results = liveCollection.toArray
    // Should return the original User type when used as filter
    expectTypeOf(results).toEqualTypeOf<Array<User>>()
  })

  test(`joins with fn.select return type`, () => {
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .join({ dept: departmentsCollection }, ({ user, dept }) =>
            eq(user.department_id, dept.id)
          )
          .fn.select((row) => ({
            employeeInfo: `${row.user.name} works in ${row.dept?.name || `Unknown`}`,
            isHighEarner: row.user.salary > 70000,
            departmentDetails: row.dept
              ? {
                  id: row.dept.id,
                  name: row.dept.name,
                }
              : null,
          })),
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        employeeInfo: string
        isHighEarner: boolean
        departmentDetails: {
          id: number
          name: string
        } | null
      }>
    >()
  })

  test(`joins with fn.where return type`, () => {
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .join({ dept: departmentsCollection }, ({ user, dept }) =>
            eq(user.department_id, dept.id)
          )
          .fn.where(
            (row) =>
              row.user.active && (row.dept?.name === `Engineering` || false)
          ),
    })

    const results = liveCollection.toArray
    // Should return namespaced joined type since no select
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        user: User
        dept: Department | undefined
      }>
    >()
  })

  test(`combination of all functional variants return type`, () => {
    const liveCollection = createLiveQueryCollection({
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
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        departmentName: string
        employeeName: string
        salary: number
      }>
    >()
  })

  test(`mixed regular and functional clauses return type`, () => {
    const liveCollection = createLiveQueryCollection({
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
            status: row.user.active
              ? (`Active` as const)
              : (`Inactive` as const),
          })),
    })

    const results = liveCollection.toArray
    // Should use functional select type, not regular select type
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        employeeId: number
        displayName: string
        status: `Active` | `Inactive`
      }>
    >()
  })

  test(`fn.select replaces regular select return type`, () => {
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .select(({ user }) => ({
            // This should be replaced
            id: user.id,
            name: user.name,
            age: user.age,
          }))
          .fn.select((row) => ({
            // This should be the final type
            customName: row.user.name.toUpperCase(),
            isAdult: row.user.age >= 18,
          })),
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        customName: string
        isAdult: boolean
      }>
    >()
  })

  test(`complex business logic transformation return type`, () => {
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .fn.where((row) => {
            // Complex business rule should not affect return type inference
            return (
              row.user.active && (row.user.salary > 70000 || row.user.age > 25)
            )
          })
          .fn.select((row) => {
            // Complex transformation with conditional logic
            const salaryGrade =
              row.user.salary > 80000
                ? (`A` as const)
                : row.user.salary > 60000
                  ? (`B` as const)
                  : (`C` as const)
            const experienceLevel =
              row.user.age > 30
                ? (`Senior` as const)
                : row.user.age > 25
                  ? (`Mid` as const)
                  : (`Junior` as const)

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
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        profile: string
        compensation: {
          salary: number
          grade: `A` | `B` | `C`
          bonus_eligible: boolean
        }
        metrics: {
          age: number
          years_to_retirement: number
          performance_bracket: `A` | `B` | `C`
        }
      }>
    >()
  })

  test(`query function syntax with functional variants`, () => {
    const liveCollection = createLiveQueryCollection((q) =>
      q
        .from({ user: usersCollection })
        .fn.where((row) => row.user.active)
        .fn.select((row) => ({
          name: row.user.name,
          isActive: row.user.active,
        }))
    )

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        name: string
        isActive: boolean
      }>
    >()
  })

  test(`functional variants with custom getKey`, () => {
    const liveCollection = createLiveQueryCollection({
      id: `custom-key-functional`,
      query: (q) =>
        q.from({ user: usersCollection }).fn.select((row) => ({
          userId: row.user.id,
          displayName: row.user.name.toUpperCase(),
        })),
      getKey: (item) => item.userId,
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        userId: number
        displayName: string
      }>
    >()
  })

  test(`fn.having with complex aggregation types`, () => {
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .join({ dept: departmentsCollection }, ({ user, dept }) =>
            eq(user.department_id, dept.id)
          )
          .groupBy(({ dept }) => dept.name)
          .fn.having((row) => row.dept?.name !== `HR`)
          .select(({ dept, user }) => ({
            departmentId: dept.id,
            departmentName: dept.name,
            totalEmployees: count(user.id),
          })),
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        departmentId: number | undefined
        departmentName: string | undefined
        totalEmployees: number
      }>
    >()
  })
})
