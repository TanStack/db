import { describe, expectTypeOf, test } from "vitest"
import { createLiveQueryCollection, eq, gt } from "../../src/query/index.js"
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

describe(`Optional Fields - Type Safety Tests`, () => {
  test(`should allow using optional fields in where clauses with proper type inference`, () => {
    const usersCollection = createUsersCollection()

    const query = createLiveQueryCollection({
      query: (q) =>
        q.from({ user: usersCollection }).where(({ user }) => {
          // This should work correctly - email is optional but can be compared
          return eq(user.email, `test@example.com`)
        }),
    })

    // The query should be typed correctly
    expectTypeOf(query.toArray).toEqualTypeOf<Array<UserWithOptional>>()
  })

  test(`should allow using optional fields in comparisons with proper type inference`, () => {
    const usersCollection = createUsersCollection()

    const query = createLiveQueryCollection({
      query: (q) =>
        q.from({ user: usersCollection }).where(({ user }) => {
          // This should work correctly - age is optional but can be compared
          return gt(user.age, 18)
        }),
    })

    expectTypeOf(query.toArray).toEqualTypeOf<Array<UserWithOptional>>()
  })

  test(`should allow using optional fields in join conditions with proper type inference`, () => {
    const usersCollection = createUsersCollection()
    const departmentsCollection = createDepartmentsCollection()

    const query = createLiveQueryCollection({
      query: (q) =>
        q.from({ user: usersCollection }).join(
          { dept: departmentsCollection },
          ({ user, dept }) => {
            // This should work correctly - department_id is optional but can be used in join
            return eq(user.department_id, dept.id)
          },
          `inner`
        ),
    })

    expectTypeOf(query.toArray).toEqualTypeOf<
      Array<{
        user: UserWithOptional
        dept: Department
      }>
    >()
  })

  test(`should allow selecting optional fields with proper type inference`, () => {
    const usersCollection = createUsersCollection()

    const query = createLiveQueryCollection({
      query: (q) =>
        q.from({ user: usersCollection }).select(({ user }) => ({
          id: user.id,
          name: user.name,
          // This should work correctly - email is optional but can be selected
          email: user.email,
        })),
    })

    expectTypeOf(query.toArray).toEqualTypeOf<
      Array<{
        id: string
        name: string
        email: string | undefined
      }>
    >()
  })

  test(`should allow using optional fields in aggregate functions with proper type inference`, () => {
    const usersCollection = createUsersCollection()

    const query = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .groupBy(({ user }) => user.name)
          .having(({ user }) => {
            // This should work correctly - age is optional but can be used in aggregate
            return gt(user.age, 25)
          })
          .select(({ user }) => ({
            name: user.name,
          })),
    })

    expectTypeOf(query.toArray).toEqualTypeOf<
      Array<{
        name: string
      }>
    >()
  })

  test(`should properly handle optional fields in left joins`, () => {
    const usersCollection = createUsersCollection()
    const departmentsCollection = createDepartmentsCollection()

    const query = createLiveQueryCollection({
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
            dept_name: dept?.name, // Should be string | undefined due to left join
          })),
    })

    expectTypeOf(query.toArray).toEqualTypeOf<
      Array<{
        user_name: string
        dept_name: string | undefined
      }>
    >()
  })
})
