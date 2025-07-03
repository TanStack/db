import { describe, expectTypeOf, test } from "vitest"
import { createLiveQueryCollection, eq } from "../../src/query/index.js"
import { createCollection } from "../../src/collection.js"
import { mockSyncCollectionOptions } from "../utls.js"

// Sample data types for join type testing
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

function createUsersCollection() {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `test-users`,
      getKey: (user) => user.id,
      initialData: [],
    })
  )
}

function createDepartmentsCollection() {
  return createCollection(
    mockSyncCollectionOptions<Department>({
      id: `test-departments`,
      getKey: (dept) => dept.id,
      initialData: [],
    })
  )
}

describe(`Join Types - Type Safety`, () => {
  test(`inner join should have required properties for both tables`, () => {
    const usersCollection = createUsersCollection()
    const departmentsCollection = createDepartmentsCollection()

    const innerJoinQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .join(
            { dept: departmentsCollection },
            ({ user, dept }) => eq(user.department_id, dept.id),
            `inner`
          ),
    })

    const results = innerJoinQuery.toArray

    // For inner joins, both user and dept should be required
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        user: User
        dept: Department
      }>
    >()
  })

  test(`left join should have optional right table`, () => {
    const usersCollection = createUsersCollection()
    const departmentsCollection = createDepartmentsCollection()

    const leftJoinQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .join(
            { dept: departmentsCollection },
            ({ user, dept }) => eq(user.department_id, dept.id),
            `left`
          ),
    })

    const results = leftJoinQuery.toArray

    // For left joins, user is required, dept is optional
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        user: User
        dept: Department | undefined
      }>
    >()
  })

  test(`right join should have optional left table`, () => {
    const usersCollection = createUsersCollection()
    const departmentsCollection = createDepartmentsCollection()

    const rightJoinQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .join(
            { dept: departmentsCollection },
            ({ user, dept }) => eq(user.department_id, dept.id),
            `right`
          ),
    })

    const results = rightJoinQuery.toArray

    // For right joins, dept is required, user is optional
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        user: User | undefined
        dept: Department
      }>
    >()
  })

  test(`full join should have both tables optional`, () => {
    const usersCollection = createUsersCollection()
    const departmentsCollection = createDepartmentsCollection()

    const fullJoinQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .join(
            { dept: departmentsCollection },
            ({ user, dept }) => eq(user.department_id, dept.id),
            `full`
          ),
    })

    const results = fullJoinQuery.toArray

    // For full joins, both user and dept are optional
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        user: User | undefined
        dept: Department | undefined
      }>
    >()
  })

  test(`multiple joins should handle optionality correctly`, () => {
    const usersCollection = createUsersCollection()
    const departmentsCollection = createDepartmentsCollection()

    // Create a projects collection for multiple joins
    type Project = {
      id: number
      name: string
      user_id: number
    }

    const projectsCollection = createCollection(
      mockSyncCollectionOptions<Project>({
        id: `test-projects`,
        getKey: (project) => project.id,
        initialData: [],
      })
    )

    const multipleJoinQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .join(
            { dept: departmentsCollection },
            ({ user, dept }) => eq(user.department_id, dept.id),
            `left` // dept is optional
          )
          .join(
            { project: projectsCollection },
            ({ user, project }) => eq(user.id, project.user_id),
            `right` // user becomes optional, project required
          ),
    })

    const results = multipleJoinQuery.toArray

    // Complex join scenario:
    // - user should be optional (due to right join with project)
    // - dept should be optional (due to left join)
    // - project should be required (right join target)
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        user: User | undefined
        dept: Department | undefined
        project: Project
      }>
    >()
  })

  test(`join with select should not affect select result types`, () => {
    const usersCollection = createUsersCollection()
    const departmentsCollection = createDepartmentsCollection()

    const selectJoinQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .join(
            { dept: departmentsCollection },
            ({ user, dept }) => eq(user.department_id, dept.id),
            `left`
          )
          .select(({ user, dept }) => ({
            userName: user.name,
            deptName: dept.name, // This should still be accessible in select
            deptBudget: dept.budget,
          })),
    })

    const results = selectJoinQuery.toArray

    // Select should return the projected type, not the joined type
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        userName: string
        deptName: string | undefined
        deptBudget: number | undefined
      }>
    >()
  })
})
