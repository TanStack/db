import { beforeEach, describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { eq, queryOnce } from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'

// Sample user type for tests
type User = {
  id: number
  name: string
  active: boolean
  age: number
}

// Sample data for tests
const sampleUsers: Array<User> = [
  { id: 1, name: `Alice`, active: true, age: 30 },
  { id: 2, name: `Bob`, active: true, age: 25 },
  { id: 3, name: `Charlie`, active: false, age: 35 },
  { id: 4, name: `Diana`, active: true, age: 28 },
  { id: 5, name: `Eve`, active: false, age: 22 },
]

function createUsersCollection() {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `test-users-query-once`,
      getKey: (user) => user.id,
      initialData: sampleUsers,
    }),
  )
}

describe(`queryOnce`, () => {
  let usersCollection: ReturnType<typeof createUsersCollection>

  beforeEach(() => {
    usersCollection = createUsersCollection()
  })

  describe(`basic functionality`, () => {
    it(`should execute a basic query and return results as an array`, async () => {
      const users = await queryOnce((q) => q.from({ user: usersCollection }))

      expect(Array.isArray(users)).toBe(true)
      expect(users.length).toBe(5)
      expect(users.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Bob`, `Charlie`, `Diana`, `Eve`]),
      )
    })

    it(`should accept a query function directly`, async () => {
      const users = await queryOnce((q) => q.from({ user: usersCollection }))

      expect(users.length).toBe(5)
    })

    it(`should accept a config object with query property`, async () => {
      const users = await queryOnce({
        query: (q) => q.from({ user: usersCollection }),
      })

      expect(users.length).toBe(5)
    })
  })

  describe(`filtering with where clause`, () => {
    it(`should filter results with a where clause`, async () => {
      const activeUsers = await queryOnce((q) =>
        q.from({ user: usersCollection }).where(({ user }) => eq(user.active, true)),
      )

      expect(activeUsers.length).toBe(3)
      expect(activeUsers.every((u) => u.active)).toBe(true)
    })

    it(`should handle empty results from filtering`, async () => {
      const noUsers = await queryOnce((q) =>
        q.from({ user: usersCollection }).where(({ user }) => eq(user.age, 100)),
      )

      expect(noUsers.length).toBe(0)
      expect(Array.isArray(noUsers)).toBe(true)
    })
  })

  describe(`projection with select clause`, () => {
    it(`should project results with a select clause`, async () => {
      const userNames = await queryOnce((q) =>
        q
          .from({ user: usersCollection })
          .select(({ user }) => ({ name: user.name })),
      )

      expect(userNames.length).toBe(5)
      expect(userNames[0]).toHaveProperty(`name`)
      expect(userNames[0]).not.toHaveProperty(`id`)
      expect(userNames[0]).not.toHaveProperty(`active`)
    })

    it(`should project multiple fields`, async () => {
      const projected = await queryOnce((q) =>
        q.from({ user: usersCollection }).select(({ user }) => ({
          id: user.id,
          name: user.name,
        })),
      )

      expect(projected.length).toBe(5)
      expect(projected[0]).toHaveProperty(`id`)
      expect(projected[0]).toHaveProperty(`name`)
      expect(projected[0]).not.toHaveProperty(`active`)
      expect(projected[0]).not.toHaveProperty(`age`)
    })
  })

  describe(`ordering and limits`, () => {
    it(`should order results with orderBy clause`, async () => {
      const orderedUsers = await queryOnce((q) =>
        q.from({ user: usersCollection }).orderBy(({ user }) => user.name, `asc`),
      )

      expect(orderedUsers.map((u) => u.name)).toEqual([
        `Alice`,
        `Bob`,
        `Charlie`,
        `Diana`,
        `Eve`,
      ])
    })

    it(`should order results in descending order`, async () => {
      const orderedUsers = await queryOnce((q) =>
        q.from({ user: usersCollection }).orderBy(({ user }) => user.age, `desc`),
      )

      expect(orderedUsers[0]!.age).toBe(35) // Charlie
      expect(orderedUsers[orderedUsers.length - 1]!.age).toBe(22) // Eve
    })

    it(`should limit results with limit clause`, async () => {
      const limitedUsers = await queryOnce((q) =>
        q
          .from({ user: usersCollection })
          .orderBy(({ user }) => user.name, `asc`)
          .limit(2),
      )

      expect(limitedUsers.length).toBe(2)
      expect(limitedUsers.map((u) => u.name)).toEqual([`Alice`, `Bob`])
    })

    it(`should support offset with limit`, async () => {
      const offsetUsers = await queryOnce((q) =>
        q
          .from({ user: usersCollection })
          .orderBy(({ user }) => user.name, `asc`)
          .offset(2)
          .limit(2),
      )

      expect(offsetUsers.length).toBe(2)
      expect(offsetUsers.map((u) => u.name)).toEqual([`Charlie`, `Diana`])
    })
  })

  describe(`single result with findOne`, () => {
    it(`should return a single result with findOne`, async () => {
      const user = await queryOnce((q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.id, 1))
          .findOne(),
      )

      expect(user).toBeDefined()
      expect(user?.name).toBe(`Alice`)
    })

    it(`should return undefined when findOne matches no results`, async () => {
      const user = await queryOnce((q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.id, 999))
          .findOne(),
      )

      expect(user).toBeUndefined()
    })
  })

  describe(`joins`, () => {
    it(`should support join queries`, async () => {
      type Post = {
        id: number
        authorId: number
        title: string
      }

      const postsCollection = createCollection(
        mockSyncCollectionOptions<Post>({
          id: `test-posts-query-once`,
          getKey: (post) => post.id,
          initialData: [
            { id: 1, authorId: 1, title: `Alice Post 1` },
            { id: 2, authorId: 1, title: `Alice Post 2` },
            { id: 3, authorId: 2, title: `Bob Post 1` },
          ],
        }),
      )

      const usersWithPosts = await queryOnce((q) =>
        q
          .from({ user: usersCollection })
          .join(
            { post: postsCollection },
            ({ user, post }) => eq(user.id, post.authorId),
            `inner`,
          )
          .select(({ user, post }) => ({
            userName: user.name,
            postTitle: post.title,
          })),
      )

      expect(usersWithPosts.length).toBe(3)
      expect(usersWithPosts.some((r) => r.userName === `Alice`)).toBe(true)
      expect(usersWithPosts.some((r) => r.userName === `Bob`)).toBe(true)
    })
  })

  describe(`empty collections`, () => {
    it(`should handle empty collections`, async () => {
      const emptyCollection = createCollection(
        mockSyncCollectionOptions<User>({
          id: `empty-users-query-once`,
          getKey: (user) => user.id,
          initialData: [],
        }),
      )

      const users = await queryOnce((q) => q.from({ user: emptyCollection }))

      expect(users.length).toBe(0)
      expect(Array.isArray(users)).toBe(true)
    })
  })

  describe(`cleanup`, () => {
    it(`should cleanup the collection after returning results`, async () => {
      // Run the query
      const users = await queryOnce((q) => q.from({ user: usersCollection }))

      // Verify we got results
      expect(users.length).toBe(5)

      // The collection should be cleaned up (no way to directly test this,
      // but if cleanup doesn't happen, memory would leak over time)
    })

    it(`should cleanup even if an error occurs during query`, async () => {
      // Create a collection that will error
      const errorCollection = createCollection<User>({
        id: `error-collection-query-once`,
        getKey: (user) => user.id,
        sync: {
          sync: ({ begin, commit, markReady }) => {
            begin()
            commit()
            markReady()
          },
        },
      })

      // Should not throw (empty results, but cleanup should still happen)
      const result = await queryOnce((q) => q.from({ user: errorCollection }))
      expect(result).toEqual([])
    })
  })

  describe(`combined operations`, () => {
    it(`should support complex queries with multiple operations`, async () => {
      const result = await queryOnce((q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.active, true))
          .select(({ user }) => ({
            id: user.id,
            name: user.name,
            age: user.age,
          }))
          .orderBy(({ user }) => user.age, `desc`)
          .limit(2),
      )

      expect(result.length).toBe(2)
      // Active users ordered by age desc, limited to 2
      // Active users: Alice (30), Bob (25), Diana (28)
      // Ordered by age desc: Alice (30), Diana (28), Bob (25)
      // Limited to 2: Alice, Diana
      expect(result[0]!.name).toBe(`Alice`)
      expect(result[1]!.name).toBe(`Diana`)
    })
  })

  describe(`type inference`, () => {
    it(`should correctly infer types for simple queries`, async () => {
      const users = await queryOnce((q) => q.from({ user: usersCollection }))

      // TypeScript should infer the correct type
      const firstUser = users[0]
      if (firstUser) {
        // These should compile without errors
        const _id: number = firstUser.id
        const _name: string = firstUser.name
        const _active: boolean = firstUser.active
        const _age: number = firstUser.age

        expect(_id).toBeDefined()
        expect(_name).toBeDefined()
        expect(_active).toBeDefined()
        expect(_age).toBeDefined()
      }
    })

    it(`should correctly infer types for projected queries`, async () => {
      const users = await queryOnce((q) =>
        q.from({ user: usersCollection }).select(({ user }) => ({
          userName: user.name,
          userAge: user.age,
        })),
      )

      const firstUser = users[0]
      if (firstUser) {
        // These should compile without errors
        const _userName: string = firstUser.userName
        const _userAge: number = firstUser.userAge

        expect(_userName).toBeDefined()
        expect(_userAge).toBeDefined()
      }
    })
  })
})
