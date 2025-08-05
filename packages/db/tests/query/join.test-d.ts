import { describe, expectTypeOf, test } from "vitest"
import { z } from "zod"
import { type } from "arktype"
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

describe(`Join Alias Methods - Type Safety`, () => {
  test(`leftJoin should have same types as join with 'left' type`, () => {
    const usersCollection = createUsersCollection()
    const departmentsCollection = createDepartmentsCollection()

    const leftJoinQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .leftJoin({ dept: departmentsCollection }, ({ user, dept }) =>
            eq(user.department_id, dept.id)
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

  test(`rightJoin should have same types as join with 'right' type`, () => {
    const usersCollection = createUsersCollection()
    const departmentsCollection = createDepartmentsCollection()

    const rightJoinQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .rightJoin({ dept: departmentsCollection }, ({ user, dept }) =>
            eq(user.department_id, dept.id)
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

  test(`innerJoin should have same types as join with 'inner' type`, () => {
    const usersCollection = createUsersCollection()
    const departmentsCollection = createDepartmentsCollection()

    const innerJoinQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .innerJoin({ dept: departmentsCollection }, ({ user, dept }) =>
            eq(user.department_id, dept.id)
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

  test(`fullJoin should have same types as join with 'full' type`, () => {
    const usersCollection = createUsersCollection()
    const departmentsCollection = createDepartmentsCollection()

    const fullJoinQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .fullJoin({ dept: departmentsCollection }, ({ user, dept }) =>
            eq(user.department_id, dept.id)
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

  test(`chaining different join aliases should handle optionality correctly`, () => {
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
          .leftJoin({ dept: departmentsCollection }, ({ user, dept }) =>
            eq(user.department_id, dept.id)
          )
          .rightJoin({ project: projectsCollection }, ({ user, project }) =>
            eq(user.id, project.user_id)
          ),
    })

    const results = multipleJoinQuery.toArray

    // Complex join scenario with aliases:
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

  test(`join aliases with select should maintain correct optionality`, () => {
    const usersCollection = createUsersCollection()
    const departmentsCollection = createDepartmentsCollection()

    const selectJoinQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .leftJoin({ dept: departmentsCollection }, ({ user, dept }) =>
            eq(user.department_id, dept.id)
          )
          .select(({ user, dept }) => ({
            userName: user.name,
            deptName: dept.name, // This should be string | undefined due to left join
            deptBudget: dept.budget,
          })),
    })

    const results = selectJoinQuery.toArray

    // Select should return the projected type with correct optionality
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        userName: string
        deptName: string | undefined
        deptBudget: number | undefined
      }>
    >()
  })

  test(`innerJoin select should not have undefined properties`, () => {
    const usersCollection = createUsersCollection()
    const departmentsCollection = createDepartmentsCollection()

    const selectInnerJoinQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .innerJoin({ dept: departmentsCollection }, ({ user, dept }) =>
            eq(user.department_id, dept.id)
          )
          .select(({ user, dept }) => ({
            userName: user.name,
            deptName: dept.name, // This should be string (not undefined) due to inner join
            deptBudget: dept.budget,
          })),
    })

    const results = selectInnerJoinQuery.toArray

    // Select should return the projected type without undefined for inner join
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        userName: string
        deptName: string
        deptBudget: number
      }>
    >()
  })

  test(`mixed join aliases and explicit join types should work together`, () => {
    const usersCollection = createUsersCollection()
    const departmentsCollection = createDepartmentsCollection()

    type Project = {
      id: number
      name: string
      department_id: number
    }

    const projectsCollection = createCollection(
      mockSyncCollectionOptions<Project>({
        id: `test-projects`,
        getKey: (project) => project.id,
        initialData: [],
      })
    )

    const mixedJoinQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .leftJoin({ dept: departmentsCollection }, ({ user, dept }) =>
            eq(user.department_id, dept.id)
          )
          .join(
            { project: projectsCollection },
            ({ dept, project }) => eq(dept.id, project.department_id),
            `inner`
          ),
    })

    const results = mixedJoinQuery.toArray

    // Mixed joins:
    // - user should be required (from clause)
    // - dept should be optional (left join)
    // - project should be required (inner join)
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        user: User
        dept: Department | undefined
        project: Project
      }>
    >()
  })

  test(`join with optional foreign key should work`, () => {
    // Define types with optional field for join (based on GitHub issue)
    type UserWithOptional = {
      id: string
      name: string
    }

    type Event = {
      id: string
      user_id?: string // Optional foreign key
      title: string
    }

    const userCollection = createCollection(
      mockSyncCollectionOptions<UserWithOptional>({
        id: `test-users-join-optional`,
        getKey: (user) => user.id,
        initialData: [],
      })
    )

    const eventCollection = createCollection(
      mockSyncCollectionOptions<Event>({
        id: `test-events-join-optional`,
        getKey: (event) => event.id,
        initialData: [],
      })
    )

    // This should not cause TypeScript errors - optional field as first argument
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ event: eventCollection })
          .innerJoin(
            { user: userCollection },
            ({ event, user }) => eq(event.user_id, user.id) // Should work with optional field
          )
          .select(({ event, user }) => ({
            eventTitle: event.title,
            userName: user.name,
          })),
    })

    // Also test with argument order swapped (as mentioned in GitHub issue)
    const liveCollection2 = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ event: eventCollection })
          .innerJoin(
            { user: userCollection },
            ({ event, user }) => eq(user.id, event.user_id) // Swapped argument order
          )
          .select(({ event, user }) => ({
            eventTitle: event.title,
            userName: user.name,
          })),
    })

    const results = liveCollection.toArray
    const results2 = liveCollection2.toArray

    expectTypeOf(results).toEqualTypeOf<
      Array<{
        eventTitle: string
        userName: string
      }>
    >()

    expectTypeOf(results2).toEqualTypeOf<
      Array<{
        eventTitle: string
        userName: string
      }>
    >()
  })

  test(`join with optional foreign key using Zod schema should work`, () => {
    // Define Zod schemas with optional foreign key (based on GitHub issue)
    const userSchema = z.object({
      id: z.string().uuid(),
      name: z.string(),
    })

    const eventSchema = z.object({
      id: z.string().uuid(),
      user_id: z.string().uuid().optional(), // Optional foreign key using .optional()
      title: z.string(),
    })

    const userCollection = createCollection({
      id: `test-users-zod-join-optional`,
      getKey: (user) => user.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: userSchema,
    })

    const eventCollection = createCollection({
      id: `test-events-zod-join-optional`,
      getKey: (event) => event.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: eventSchema,
    })

    // This should not cause TypeScript errors - optional field as first argument
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ event: eventCollection })
          .innerJoin(
            { user: userCollection },
            ({ event, user }) => eq(event.user_id, user.id) // Should work with optional field
          )
          .select(({ event, user }) => ({
            eventTitle: event.title,
            userName: user.name,
          })),
    })

    // Also test with argument order swapped (as mentioned in GitHub issue)
    const liveCollection2 = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ event: eventCollection })
          .innerJoin(
            { user: userCollection },
            ({ event, user }) => eq(user.id, event.user_id) // Swapped argument order
          )
          .select(({ event, user }) => ({
            eventTitle: event.title,
            userName: user.name,
          })),
    })

    const results = liveCollection.toArray
    const results2 = liveCollection2.toArray

    expectTypeOf(results).toEqualTypeOf<
      Array<{
        eventTitle: string
        userName: string
      }>
    >()

    expectTypeOf(results2).toEqualTypeOf<
      Array<{
        eventTitle: string
        userName: string
      }>
    >()
  })

  test(`join with nullable foreign key using Zod schema should work`, () => {
    // Define Zod schemas with nullable foreign key
    const userSchema = z.object({
      id: z.number(),
      name: z.string(),
    })

    const postSchema = z.object({
      id: z.number(),
      title: z.string(),
      author_id: z.number().nullable(), // Nullable foreign key
    })

    const userCollection = createCollection({
      id: `test-users-zod-nullable`,
      getKey: (user) => user.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: userSchema,
    })

    const postCollection = createCollection({
      id: `test-posts-zod-nullable`,
      getKey: (post) => post.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: postSchema,
    })

    // Test left join with nullable field
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ post: postCollection })
          .leftJoin(
            { user: userCollection },
            ({ post, user }) => eq(post.author_id, user.id) // Should work with nullable field
          )
          .select(({ post, user }) => ({
            postTitle: post.title,
            authorName: user.name, // This will be string | undefined due to left join
          })),
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        postTitle: string
        authorName: string | undefined
      }>
    >()
  })
})

describe(`Join with ArkType Schemas`, () => {
  test(`join with optional foreign key using ArkType schema should work`, () => {
    // Define ArkType schemas with optional foreign key
    const userSchema = type({
      id: `string.uuid`,
      name: `string`,
    })

    const eventSchema = type({
      id: `string.uuid`,
      "user_id?": `string.uuid`, // Optional foreign key using "field?"
      title: `string`,
    })

    const userCollection = createCollection({
      id: `test-users-arktype-join-optional`,
      getKey: (user) => user.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: userSchema,
    })

    const eventCollection = createCollection({
      id: `test-events-arktype-join-optional`,
      getKey: (event) => event.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: eventSchema,
    })

    // This should not cause TypeScript errors - optional field as first argument
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ event: eventCollection })
          .innerJoin(
            { user: userCollection },
            ({ event, user }) => eq(event.user_id, user.id) // Should work with optional field
          )
          .select(({ event, user }) => ({
            eventTitle: event.title,
            userName: user.name,
          })),
    })

    // Also test with argument order swapped
    const liveCollection2 = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ event: eventCollection })
          .innerJoin(
            { user: userCollection },
            ({ event, user }) => eq(user.id, event.user_id) // Swapped argument order
          )
          .select(({ event, user }) => ({
            eventTitle: event.title,
            userName: user.name,
          })),
    })

    const results = liveCollection.toArray
    const results2 = liveCollection2.toArray

    expectTypeOf(results).toEqualTypeOf<
      Array<{
        eventTitle: string
        userName: string
      }>
    >()

    expectTypeOf(results2).toEqualTypeOf<
      Array<{
        eventTitle: string
        userName: string
      }>
    >()
  })

  test(`join with nullable foreign key using ArkType schema should work`, () => {
    // Define ArkType schemas with nullable foreign key
    const userSchema = type({
      id: `number`,
      name: `string`,
    })

    const postSchema = type({
      id: `number`,
      title: `string`,
      author_id: `number?`, // Nullable foreign key using "field?"
    })

    const userCollection = createCollection({
      id: `test-users-arktype-nullable`,
      getKey: (user) => user.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: userSchema,
    })

    const postCollection = createCollection({
      id: `test-posts-arktype-nullable`,
      getKey: (post) => post.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: postSchema,
    })

    // Test left join with nullable field
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ post: postCollection })
          .leftJoin(
            { user: userCollection },
            ({ post, user }) => eq(post.author_id, user.id) // Should work with nullable field
          )
          .select(({ post, user }) => ({
            postTitle: post.title,
            authorName: user.name, // This will be string | undefined due to left join
          })),
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        postTitle: string
        authorName: string | undefined
      }>
    >()
  })

  test(`join with union types using ArkType schema should work`, () => {
    // Define ArkType schemas with union types
    const userSchema = type({
      id: `number`,
      name: `string > 0`,
      email: `string.email`,
      "status?": `"active" | "inactive"`,
    })

    const postSchema = type({
      id: `number`,
      title: `string > 0`,
      content: `string > 10`,
      user_id: `number`,
      "category?": `"tech" | "lifestyle" | "news"`,
    })

    const userCollection = createCollection({
      id: `test-users-arktype-union`,
      getKey: (user) => user.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: userSchema,
    })

    const postCollection = createCollection({
      id: `test-posts-arktype-union`,
      getKey: (post) => post.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: postSchema,
    })

    // Test inner join with union types
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ post: postCollection })
          .innerJoin({ user: userCollection }, ({ post, user }) =>
            eq(post.user_id, user.id)
          )
          .select(({ post, user }) => ({
            postTitle: post.title,
            userName: user.name,
            userEmail: user.email,
            userStatus: user.status,
            postCategory: post.category,
          })),
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        postTitle: string
        userName: string
        userEmail: string
        userStatus: `active` | `inactive` | undefined
        postCategory: `tech` | `lifestyle` | `news` | undefined
      }>
    >()
  })
})
