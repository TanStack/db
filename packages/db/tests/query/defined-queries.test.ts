import { beforeEach, describe, expect, test } from "vitest"
import {
  and,
  createLiveQueryCollection,
  defineQuery,
  eq,
  gt,
  upper,
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
}

// Sample data for tests
const sampleUsers: Array<User> = [
  { id: 1, name: `Alice`, age: 25, email: `alice@example.com`, active: true },
  { id: 2, name: `Bob`, age: 19, email: `bob@example.com`, active: true },
  {
    id: 3,
    name: `Charlie`,
    age: 30,
    email: `charlie@example.com`,
    active: false,
  },
  { id: 4, name: `Dave`, age: 22, email: `dave@example.com`, active: true },
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

describe(`Defined Queries`, () => {
  describe(`createLiveQueryCollection with predefined query builders`, () => {
    let usersCollection: ReturnType<typeof createUsersCollection>

    beforeEach(() => {
      usersCollection = createUsersCollection()
    })

    test(`should accept a predefined query builder directly`, () => {
      // Define a query using defineQuery
      const activeUsersQuery = defineQuery((q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.active, true))
          .select(({ user }) => ({
            id: user.id,
            name: user.name,
            email: user.email,
          }))
      )

      // Use the predefined query in createLiveQueryCollection
      const liveCollection = createLiveQueryCollection({
        query: activeUsersQuery,
        startSync: true,
      })

      const results = liveCollection.toArray

      expect(results).toHaveLength(3) // Alice, Bob, Dave are active
      expect(results.every((u) => typeof u.id === `number`)).toBe(true)
      expect(results.every((u) => typeof u.name === `string`)).toBe(true)
      expect(results.every((u) => typeof u.email === `string`)).toBe(true)
      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Bob`, `Dave`])
      )

      // Insert a new active user
      const newUser = {
        id: 5,
        name: `Eve`,
        age: 28,
        email: `eve@example.com`,
        active: true,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `insert`,
        value: newUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(4) // Should include the new active user
      expect(liveCollection.get(5)).toMatchObject({
        id: 5,
        name: `Eve`,
        email: `eve@example.com`,
      })

      // Clean up
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: newUser,
      })
      usersCollection.utils.commit()
    })

    test(`should accept a predefined query builder with config object`, () => {
      // Define a query using defineQuery
      const adultUsersQuery = defineQuery((q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => gt(user.age, 20))
          .select(({ user }) => ({
            userId: user.id,
            userName: user.name,
            userAge: user.age,
          }))
      )

      // Use the predefined query in a config object
      const liveCollection = createLiveQueryCollection({
        id: `adult-users`,
        query: adultUsersQuery,
        getKey: (item) => item.userId,
        startSync: true,
      })

      const results = liveCollection.toArray

      expect(liveCollection.id).toBe(`adult-users`)
      expect(results).toHaveLength(3) // Alice (25), Charlie (30), Dave (22)
      expect(results.map((u) => u.userName)).toEqual(
        expect.arrayContaining([`Alice`, `Charlie`, `Dave`])
      )

      // Verify custom getKey is working
      expect(liveCollection.get(1)).toMatchObject({
        userId: 1,
        userName: `Alice`,
        userAge: 25,
      })

      // Insert a new adult user
      const newUser = {
        id: 5,
        name: `Eve`,
        age: 28,
        email: `eve@example.com`,
        active: true,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `insert`,
        value: newUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(4)
      expect(liveCollection.get(5)).toMatchObject({
        userId: 5,
        userName: `Eve`,
        userAge: 28,
      })

      // Clean up
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: newUser,
      })
      usersCollection.utils.commit()
    })

    test(`should work with predefined query without select (returns original type)`, () => {
      // Define a query without select
      const activeUsersQuery = defineQuery((q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.active, true))
      )

      // Use the predefined query
      const liveCollection = createLiveQueryCollection({
        query: activeUsersQuery,
        startSync: true,
      })

      const results = liveCollection.toArray

      expect(results).toHaveLength(3) // Alice, Bob, Dave are active
      expect(results.every((u) => u.active)).toBe(true)

      // All properties should be present (original User type)
      results.forEach((result) => {
        expect(result).toHaveProperty(`id`)
        expect(result).toHaveProperty(`name`)
        expect(result).toHaveProperty(`age`)
        expect(result).toHaveProperty(`email`)
        expect(result).toHaveProperty(`active`)
      })

      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Bob`, `Dave`])
      )
    })

    test(`should work with complex predefined queries with computed fields`, () => {
      // Define a complex query with computed fields
      const enhancedUsersQuery = defineQuery((q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => gt(user.age, 20))
          .select(({ user }) => ({
            ...user,
            name_upper: upper(user.name),
            isAdult: user.age,
          }))
      )

      // Use the predefined query
      const liveCollection = createLiveQueryCollection({
        query: enhancedUsersQuery,
        startSync: true,
      })

      const results = liveCollection.toArray

      expect(results).toHaveLength(3) // Alice (25), Charlie (30), Dave (22)

      // Check that all original properties are present plus computed fields
      results.forEach((result) => {
        expect(result).toHaveProperty(`id`)
        expect(result).toHaveProperty(`name`)
        expect(result).toHaveProperty(`age`)
        expect(result).toHaveProperty(`email`)
        expect(result).toHaveProperty(`active`)
        expect(result).toHaveProperty(`name_upper`)
        expect(result).toHaveProperty(`isAdult`)
      })

      // Verify that the computed field is correctly applied
      expect(results.map((u) => u.name_upper)).toEqual(
        expect.arrayContaining([`ALICE`, `CHARLIE`, `DAVE`])
      )

      // Test specific user data
      const alice = results.find((u) => u.name === `Alice`)
      expect(alice).toMatchObject({
        id: 1,
        name: `Alice`,
        age: 25,
        email: `alice@example.com`,
        active: true,
        name_upper: `ALICE`,
        isAdult: 25,
      })
    })

    test(`should allow extending predefined queries`, () => {
      // Define a base query
      const baseUsersQuery = defineQuery((q) =>
        q.from({ user: usersCollection })
      )

      // Extend the query with a single WHERE clause that combines conditions
      const activeAdultUsersQuery = baseUsersQuery
        .where(({ user }) => and(eq(user.active, true), gt(user.age, 20)))
        .select(({ user }) => ({
          id: user.id,
          name: user.name,
          age: user.age,
        }))

      // Use the extended query
      const liveCollection = createLiveQueryCollection({
        query: activeAdultUsersQuery,
        startSync: true,
      })

      const results = liveCollection.toArray

      expect(results).toHaveLength(2) // Alice (25), Dave (22) - both active and > 20
      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Dave`])
      )
      expect(results.every((u) => u.age > 20)).toBe(true)
    })

    test(`should work with predefined queries as subqueries`, () => {
      // Define a base query
      const activeUsersQuery = defineQuery((q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.active, true))
      )

      // Use the predefined query as a subquery
      const enhancedActiveUsersQuery = defineQuery((q) =>
        q
          .from({ activeUser: activeUsersQuery })
          .where(({ activeUser }) => gt(activeUser.age, 20))
          .fn.select((row) => ({
            id: row.activeUser.id,
            name: row.activeUser.name,
            category: row.activeUser.age > 25 ? `senior` : `junior`,
          }))
      )

      // Use the final query
      const liveCollection = createLiveQueryCollection({
        query: enhancedActiveUsersQuery,
        startSync: true,
      })

      const results = liveCollection.toArray

      expect(results).toHaveLength(2) // Alice (25), Dave (22) - both active and > 20
      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Dave`])
      )

      const alice = results.find((u) => u.name === `Alice`)
      const dave = results.find((u) => u.name === `Dave`)

      expect(alice?.category).toBe(`junior`) // 25 is not > 25
      expect(dave?.category).toBe(`junior`) // 22 is not > 25
    })

    test(`should maintain reactivity with predefined queries`, () => {
      // Define a query
      const activeUsersQuery = defineQuery((q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.active, true))
          .select(({ user }) => ({
            id: user.id,
            name: user.name,
            active: user.active,
          }))
      )

      // Use the predefined query
      const liveCollection = createLiveQueryCollection({
        query: activeUsersQuery,
        startSync: true,
      })

      expect(liveCollection.size).toBe(3) // Alice, Bob, Dave are active

      // Insert a new active user
      const newUser = {
        id: 5,
        name: `Eve`,
        age: 28,
        email: `eve@example.com`,
        active: true,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `insert`,
        value: newUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(4) // Should include the new active user
      expect(liveCollection.get(5)).toMatchObject({
        id: 5,
        name: `Eve`,
        active: true,
      })

      // Update the new user to inactive (should remove from active collection)
      const inactiveUser = { ...newUser, active: false }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: inactiveUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(3) // Should exclude the now inactive user
      expect(liveCollection.get(5)).toBeUndefined()

      // Update the user back to active
      const reactivatedUser = {
        ...inactiveUser,
        active: true,
        name: `Eve Reactivated`,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: reactivatedUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(4) // Should include the reactivated user
      expect(liveCollection.get(5)).toMatchObject({
        id: 5,
        name: `Eve Reactivated`,
        active: true,
      })

      // Delete the new user
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: reactivatedUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(3)
      expect(liveCollection.get(5)).toBeUndefined()
    })

    test(`should work with predefined queries in JOIN operations`, () => {
      // Create a second collection for posts
      type Post = {
        id: number
        title: string
        authorId: number
        published: boolean
      }

      const samplePosts: Array<Post> = [
        { id: 1, title: `Alice's First Post`, authorId: 1, published: true },
        { id: 2, title: `Bob's Draft`, authorId: 2, published: false },
        { id: 3, title: `Alice's Second Post`, authorId: 1, published: true },
        { id: 4, title: `Dave's Article`, authorId: 4, published: true },
        { id: 5, title: `Charlie's Work`, authorId: 3, published: false },
      ]

      const postsCollection = createCollection(
        mockSyncCollectionOptions<Post>({
          id: `test-posts`,
          getKey: (post) => post.id,
          initialData: samplePosts,
        })
      )

      // Define predefined queries
      const activeUsersQuery = defineQuery((q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.active, true))
          .select(({ user }) => ({
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
          }))
      )

      const publishedPostsQuery = defineQuery((q) =>
        q
          .from({ post: postsCollection })
          .where(({ post }) => eq(post.published, true))
          .select(({ post }) => ({
            postId: post.id,
            postTitle: post.title,
            postAuthorId: post.authorId,
          }))
      )

      // Create a query that joins the two predefined subqueries
      const activeUsersWithPublishedPostsQuery = defineQuery((q) =>
        q
          .from({ activeUser: activeUsersQuery })
          .join(
            { publishedPost: publishedPostsQuery },
            ({ activeUser, publishedPost }) =>
              eq(activeUser.userId, publishedPost.postAuthorId),
            `inner`
          )
          .select(({ activeUser, publishedPost }) => ({
            authorId: activeUser.userId,
            authorName: activeUser.userName,
            authorEmail: activeUser.userEmail,
            postId: publishedPost.postId,
            postTitle: publishedPost.postTitle,
          }))
      )

      // Use the complex joined query
      const liveCollection = createLiveQueryCollection({
        query: activeUsersWithPublishedPostsQuery,
        startSync: true,
      })

      const results = liveCollection.toArray

      // Should have results for Alice (2 posts) and Dave (1 post) - both active with published posts
      // Bob has no published posts, Charlie is inactive
      expect(results).toHaveLength(3)

      const aliceResults = results.filter((r) => r.authorName === `Alice`)
      const daveResults = results.filter((r) => r.authorName === `Dave`)

      expect(aliceResults).toHaveLength(2) // Alice has 2 published posts
      expect(daveResults).toHaveLength(1) // Dave has 1 published post

      // Verify Alice's posts
      expect(aliceResults.map((r) => r.postTitle)).toEqual(
        expect.arrayContaining([`Alice's First Post`, `Alice's Second Post`])
      )

      // Verify Dave's post
      expect(daveResults[0]).toMatchObject({
        authorId: 4,
        authorName: `Dave`,
        postTitle: `Dave's Article`,
      })

      // Test reactivity: publish Bob's draft (Bob is active)
      const bobDraft = samplePosts.find((p) => p.id === 2)!
      const updatedBobPost: Post = {
        id: bobDraft.id,
        title: bobDraft.title,
        authorId: bobDraft.authorId,
        published: true,
      }
      postsCollection.utils.begin()
      postsCollection.utils.write({
        type: `update`,
        value: updatedBobPost,
      })
      postsCollection.utils.commit()

      expect(liveCollection.size).toBe(4) // Should now include Bob's published post
      const bobResult = liveCollection.toArray.find(
        (r) => r.authorName === `Bob`
      )
      expect(bobResult).toMatchObject({
        authorId: 2,
        authorName: `Bob`,
        postTitle: `Bob's Draft`,
      })

      // Clean up
      postsCollection.utils.begin()
      postsCollection.utils.write({
        type: `update`,
        value: bobDraft, // Revert to unpublished
      })
      postsCollection.utils.commit()
    })
  })
})
