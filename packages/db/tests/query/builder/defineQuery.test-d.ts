import { describe, expectTypeOf, test } from "vitest"
import { createCollection } from "../../../src/collection.js"
import { mockSyncCollectionOptions } from "../../utls.js"
import { defineQuery } from "../../../src/query/builder/index.js"
import { eq, gt, count, sum } from "../../../src/query/builder/functions.js"
import type { ExtractContext } from "../../../src/query/builder/index.js"
import type { GetResult } from "../../../src/query/builder/types.js"

// Sample data types for testing
type User = {
  id: number
  name: string
  email: string
  age: number
  active: boolean
  department_id: number | null
  salary: number
}

type Department = {
  id: number
  name: string
  budget: number
  location: string
  active: boolean
}

type Project = {
  id: number
  name: string
  user_id: number
  department_id: number
  status: string
}

function createTestCollections() {
  const usersCollection = createCollection(
    mockSyncCollectionOptions<User>({
      id: `test-users`,
      getKey: (user) => user.id,
      initialData: [],
    })
  )

  const departmentsCollection = createCollection(
    mockSyncCollectionOptions<Department>({
      id: `test-departments`,
      getKey: (dept) => dept.id,
      initialData: [],
    })
  )

  const projectsCollection = createCollection(
    mockSyncCollectionOptions<Project>({
      id: `test-projects`,
      getKey: (project) => project.id,
      initialData: [],
    })
  )

  return { usersCollection, departmentsCollection, projectsCollection }
}

describe(`defineQuery Type Tests`, () => {
  const { usersCollection, departmentsCollection, projectsCollection } =
    createTestCollections()

  test(`defineQuery return type matches callback return type`, () => {
    // Test that defineQuery returns exactly the same type as the callback
    const queryBuilder = defineQuery((q) => q.from({ users: usersCollection }))

    // Test that the result type is correctly inferred as User
    expectTypeOf<
      GetResult<ExtractContext<typeof queryBuilder>>
    >().toEqualTypeOf<User>()
  })

  test(`defineQuery with simple select`, () => {
    const queryBuilder = defineQuery((q) =>
      q.from({ users: usersCollection }).select(({ users }) => ({
        id: users.id,
        name: users.name,
        email: users.email,
      }))
    )

    // Test that the result type is correctly inferred
    expectTypeOf<
      GetResult<ExtractContext<typeof queryBuilder>>
    >().toEqualTypeOf<{
      id: number
      name: string
      email: string
    }>()
  })

  test(`defineQuery with join`, () => {
    const queryBuilder = defineQuery((q) =>
      q
        .from({ users: usersCollection })
        .join({ dept: departmentsCollection }, ({ users, dept }) =>
          eq(users.department_id, dept.id)
        )
    )

    // Test that join result type is correctly inferred
    expectTypeOf<
      GetResult<ExtractContext<typeof queryBuilder>>
    >().toEqualTypeOf<{
      users: User
      dept: Department | undefined
    }>()
  })

  test(`defineQuery with join and select`, () => {
    const queryBuilder = defineQuery((q) =>
      q
        .from({ users: usersCollection })
        .join({ dept: departmentsCollection }, ({ users, dept }) =>
          eq(users.department_id, dept.id)
        )
        .select(({ users, dept }) => ({
          userName: users.name,
          deptName: dept.name,
          userEmail: users.email,
        }))
    )

    // Test that join with select result type is correctly inferred
    expectTypeOf<
      GetResult<ExtractContext<typeof queryBuilder>>
    >().toEqualTypeOf<{
      userName: string
      deptName: string | undefined
      userEmail: string
    }>()
  })

  test(`defineQuery with where clause`, () => {
    const queryBuilder = defineQuery((q) =>
      q.from({ users: usersCollection }).where(({ users }) => gt(users.age, 18))
    )

    // Test that where clause doesn't change the result type
    expectTypeOf<
      GetResult<ExtractContext<typeof queryBuilder>>
    >().toEqualTypeOf<User>()
  })

  test(`defineQuery with groupBy and aggregates`, () => {
    const queryBuilder = defineQuery((q) =>
      q
        .from({ users: usersCollection })
        .groupBy(({ users }) => users.department_id)
        .select(({ users }) => ({
          departmentId: users.department_id,
          userCount: count(users.id),
          totalSalary: sum(users.salary),
        }))
    )

    // Test that groupBy with aggregates is correctly typed
    expectTypeOf<
      GetResult<ExtractContext<typeof queryBuilder>>
    >().toEqualTypeOf<{
      departmentId: number | null
      userCount: number
      totalSalary: number
    }>()
  })

  test(`defineQuery with orderBy`, () => {
    const queryBuilder = defineQuery((q) =>
      q.from({ users: usersCollection }).orderBy(({ users }) => users.name)
    )

    // Test that orderBy doesn't change the result type
    expectTypeOf<
      GetResult<ExtractContext<typeof queryBuilder>>
    >().toEqualTypeOf<User>()
  })

  test(`defineQuery with limit and offset`, () => {
    const queryBuilder = defineQuery((q) =>
      q
        .from({ users: usersCollection })
        .orderBy(({ users }) => users.name)
        .limit(10)
        .offset(5)
    )

    // Test that limit/offset don't change the result type
    expectTypeOf<
      GetResult<ExtractContext<typeof queryBuilder>>
    >().toEqualTypeOf<User>()
  })

  test(`defineQuery with complex multi-join query`, () => {
    const queryBuilder = defineQuery((q) =>
      q
        .from({ users: usersCollection })
        .join({ dept: departmentsCollection }, ({ users, dept }) =>
          eq(users.department_id, dept.id)
        )
        .join({ project: projectsCollection }, ({ users, dept, project }) =>
          eq(project.user_id, users.id)
        )
        .select(({ users, dept, project }) => ({
          userId: users.id,
          userName: users.name,
          deptName: dept.name,
          projectName: project.name,
          projectStatus: project.status,
        }))
    )

    // Test complex multi-join with select
    expectTypeOf<
      GetResult<ExtractContext<typeof queryBuilder>>
    >().toEqualTypeOf<{
      userId: number
      userName: string
      deptName: string | undefined
      projectName: string | undefined
      projectStatus: string | undefined
    }>()
  })

  test(`defineQuery with inner join`, () => {
    const queryBuilder = defineQuery((q) =>
      q
        .from({ users: usersCollection })
        .join(
          { dept: departmentsCollection },
          ({ users, dept }) => eq(users.department_id, dept.id),
          "inner"
        )
    )

    // Test that inner join type is correctly inferred
    expectTypeOf<
      GetResult<ExtractContext<typeof queryBuilder>>
    >().toEqualTypeOf<{
      users: User
      dept: Department
    }>()
  })

  test(`defineQuery with right join`, () => {
    const queryBuilder = defineQuery((q) =>
      q
        .from({ users: usersCollection })
        .join(
          { dept: departmentsCollection },
          ({ users, dept }) => eq(users.department_id, dept.id),
          "right"
        )
    )

    // Test that right join type is correctly inferred
    expectTypeOf<
      GetResult<ExtractContext<typeof queryBuilder>>
    >().toEqualTypeOf<{
      users: User | undefined
      dept: Department
    }>()
  })

  test(`defineQuery with full join`, () => {
    const queryBuilder = defineQuery((q) =>
      q
        .from({ users: usersCollection })
        .join(
          { dept: departmentsCollection },
          ({ users, dept }) => eq(users.department_id, dept.id),
          "full"
        )
    )

    // Test that full join type is correctly inferred
    expectTypeOf<
      GetResult<ExtractContext<typeof queryBuilder>>
    >().toEqualTypeOf<{
      users: User | undefined
      dept: Department | undefined
    }>()
  })

  test(`defineQuery with functional select`, () => {
    const queryBuilder = defineQuery((q) =>
      q.from({ users: usersCollection }).fn.select((row) => ({
        upperName: row.users.name.toUpperCase(),
        ageNextYear: row.users.age + 1,
      }))
    )

    // Test that functional select result type is correctly inferred
    expectTypeOf<
      GetResult<ExtractContext<typeof queryBuilder>>
    >().toEqualTypeOf<{
      upperName: string
      ageNextYear: number
    }>()
  })

  test(`defineQuery result can be used like any QueryBuilder`, () => {
    const baseQuery = defineQuery((q) => q.from({ users: usersCollection }))

    // Test that the result can be extended like any QueryBuilder
    const extendedQuery = baseQuery
      .where(({ users }) => gt(users.age, 18))
      .select(({ users }) => ({
        id: users.id,
        name: users.name,
      }))

    expectTypeOf<
      GetResult<ExtractContext<typeof extendedQuery>>
    >().toEqualTypeOf<{
      id: number
      name: string
    }>()
  })

  test(`defineQuery with subquery`, () => {
    const subQuery = defineQuery((q) =>
      q.from({ users: usersCollection }).where(({ users }) => gt(users.age, 18))
    )

    const mainQuery = defineQuery((q) =>
      q.from({ activeUsers: subQuery }).select(({ activeUsers }) => ({
        id: activeUsers.id,
        name: activeUsers.name,
      }))
    )

    // Test that subquery usage is correctly typed
    expectTypeOf<GetResult<ExtractContext<typeof mainQuery>>>().toEqualTypeOf<{
      id: number
      name: string
    }>()
  })
})
