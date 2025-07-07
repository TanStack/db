import { beforeEach, describe, expect, test } from "vitest"
import {
  Query,
  and,
  createLiveQueryCollection,
  eq,
  gt,
  lower,
  lt,
  lte,
  upper,
} from "../../src/query/index.js"
import { createCollection } from "../../src/collection.js"
import { mockSyncCollectionOptions } from "../utls.js"
import type { Ref } from "../../src/query/index.js"

// Sample user type for tests
type User = {
  id: number
  name: string
  age: number
  email: string
  active: boolean
}

// Sample post type for tests
type Post = {
  id: number
  title: string
  authorId: number
  published: boolean
  content: string
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

const samplePosts: Array<Post> = [
  {
    id: 1,
    title: `Alice's First Post`,
    authorId: 1,
    published: true,
    content: `Hello World`,
  },
  {
    id: 2,
    title: `Bob's Draft`,
    authorId: 2,
    published: false,
    content: `Draft content`,
  },
  {
    id: 3,
    title: `Alice's Second Post`,
    authorId: 1,
    published: true,
    content: `More content`,
  },
  {
    id: 4,
    title: `Dave's Article`,
    authorId: 4,
    published: true,
    content: `Article content`,
  },
  {
    id: 5,
    title: `Charlie's Work`,
    authorId: 3,
    published: false,
    content: `Work in progress`,
  },
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

function createPostsCollection() {
  return createCollection(
    mockSyncCollectionOptions<Post>({
      id: `test-posts`,
      getKey: (post) => post.id,
      initialData: samplePosts,
    })
  )
}

describe(`Composables`, () => {
  describe(`defineForRow`, () => {
    let usersCollection: ReturnType<typeof createUsersCollection>
    let postsCollection: ReturnType<typeof createPostsCollection>

    beforeEach(() => {
      usersCollection = createUsersCollection()
      postsCollection = createPostsCollection()
    })

    test(`should create reusable callback predicates`, () => {
      // Define reusable predicates using defineForRow
      const userIsAdult = ({ user }: { user: Ref<User> }) => gt(user.age, 18)

      const userIsActive = ({ user }: { user: Ref<User> }) =>
        eq(user.active, true)

      const userIsYoung = ({ user }: { user: Ref<User> }) => lt(user.age, 25)

      // Use the predicates in a query
      const liveCollection = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(userIsAdult)
            .where(userIsActive)
            .where(userIsYoung),
        startSync: true,
      })

      const results = liveCollection.toArray

      // Should return Bob (19) and Dave (22) - both adult, active, and young
      expect(results).toHaveLength(2)
      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Bob`, `Dave`])
      )
      expect(results.every((u) => u.age > 18 && u.age < 25 && u.active)).toBe(
        true
      )
    })

    test(`should create reusable select objects`, () => {
      // Define reusable select objects using defineForRow
      const userBasicInfo = ({ user }: { user: Ref<User> }) => ({
        id: user.id,
        name: user.name,
        email: user.email,
      })

      const userNameTransforms = ({ user }: { user: Ref<User> }) => ({
        nameUpper: upper(user.name),
        nameLower: lower(user.name),
      })

      // Use the select objects in a query
      const liveCollection = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.active, true))
            .select(({ user }) => ({
              ...userBasicInfo({ user }),
              ...userNameTransforms({ user }),
              age: user.age,
            })),
        startSync: true,
      })

      const results = liveCollection.toArray

      expect(results).toHaveLength(3) // Alice, Bob, Dave are active

      const alice = results.find((u) => u.name === `Alice`)
      expect(alice).toMatchObject({
        id: 1,
        name: `Alice`,
        email: `alice@example.com`,
        nameUpper: `ALICE`,
        nameLower: `alice`,
        age: 25,
      })

      // Verify all results have the expected structure
      results.forEach((result) => {
        expect(result).toHaveProperty(`id`)
        expect(result).toHaveProperty(`name`)
        expect(result).toHaveProperty(`email`)
        expect(result).toHaveProperty(`nameUpper`)
        expect(result).toHaveProperty(`nameLower`)
        expect(result).toHaveProperty(`age`)
      })
    })

    test(`should work with defineQuery for reusable query composition`, () => {
      // Define reusable components
      const userIsAdult = ({ user }: { user: Ref<User> }) => gt(user.age, 20)

      const userDisplayInfo = ({ user }: { user: Ref<User> }) => ({
        userId: user.id,
        displayName: upper(user.name),
        contactEmail: user.email,
      })

      // Create a reusable query using defineQuery that uses the components
      const adultUsersQuery = new Query()
        .from({ user: usersCollection })
        .where(userIsAdult)
        .select(userDisplayInfo)

      // Use the predefined query
      const liveCollection = createLiveQueryCollection({
        query: adultUsersQuery,
        startSync: true,
      })

      const results = liveCollection.toArray

      expect(results).toHaveLength(3) // Alice (25), Charlie (30), Dave (22)
      expect(results.map((u) => u.displayName)).toEqual(
        expect.arrayContaining([`ALICE`, `CHARLIE`, `DAVE`])
      )

      // Test that we can create a new query that combines the components differently
      const activeAdultUsersQuery = new Query()
        .from({ user: usersCollection })
        .where(({ user }) => and(userIsAdult({ user }), eq(user.active, true)))
        .select(userDisplayInfo)

      const activeCollection = createLiveQueryCollection({
        query: activeAdultUsersQuery,
        startSync: true,
      })

      expect(activeCollection.size).toBe(2) // Alice and Dave (Charlie is inactive)
    })

    test(`should work with joins using defineForRow components`, () => {
      // Define reusable components for different namespaces
      const userIsActive = ({ user }: { user: Ref<User> }) =>
        eq(user.active, true)

      const postIsPublished = ({ post }: { post: Ref<Post> }) =>
        eq(post.published, true)

      const userPostJoinInfo = ({
        user,
        post,
      }: {
        user: Ref<User>
        post: Ref<Post>
      }) => ({
        authorId: user.id,
        authorName: upper(user.name),
        authorEmail: user.email,
        postId: post.id,
        postTitle: post.title,
        postContent: post.content,
      })

      // Create a query that uses the components in a join
      const liveCollection = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ user: usersCollection })
            .join(
              { post: postsCollection },
              ({ user, post }) => eq(user.id, post.authorId),
              `inner`
            )
            .where(userIsActive)
            .where(postIsPublished)
            .select(userPostJoinInfo),
        startSync: true,
      })

      const results = liveCollection.toArray

      // Should have Alice (2 posts) and Dave (1 post) with published posts
      expect(results).toHaveLength(3)

      const aliceResults = results.filter((r) => r.authorName === `ALICE`)
      const daveResults = results.filter((r) => r.authorName === `DAVE`)

      expect(aliceResults).toHaveLength(2)
      expect(daveResults).toHaveLength(1)

      // Verify structure
      results.forEach((result) => {
        expect(result).toHaveProperty(`authorId`)
        expect(result).toHaveProperty(`authorName`)
        expect(result).toHaveProperty(`authorEmail`)
        expect(result).toHaveProperty(`postId`)
        expect(result).toHaveProperty(`postTitle`)
        expect(result).toHaveProperty(`postContent`)
      })
    })

    test(`should allow combining multiple defineForRow callbacks with and/or`, () => {
      const userIsActive = ({ user }: { user: Ref<User> }) =>
        eq(user.active, true)

      const userIsAdult = ({ user }: { user: Ref<User> }) => gt(user.age, 20)

      const userIsYoung = ({ user }: { user: Ref<User> }) => lt(user.age, 25)

      // Combine the predicates using and()
      const liveCollection = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) =>
              and(
                userIsActive({ user }),
                userIsAdult({ user }),
                userIsYoung({ user })
              )
            ),
        startSync: true,
      })

      const results = liveCollection.toArray

      // Should return Bob (19 - not adult) and Dave (22) - Dave only meets all criteria
      expect(results).toHaveLength(1)
      const result = results[0]!
      expect(result.name).toBe(`Dave`)
      expect(result.age).toBe(22)
      expect(result.active).toBe(true)
    })

    test(`should work with predefined queries as subqueries using defineForRow`, () => {
      // Define reusable components
      const userIsActive = ({ user }: { user: Ref<User> }) =>
        eq(user.active, true)

      const userIsJunior = ({ user }: { user: Ref<User> }) => lte(user.age, 25)

      const userBasicWithAge = ({ user }: { user: Ref<User> }) => ({
        id: user.id,
        name: user.name,
        age: user.age,
      })

      // Create a base query using defineQuery and defineForRow
      const activeJuniorUsersQuery = new Query()
        .from({ user: usersCollection })
        .where(userIsActive)
        .where(userIsJunior)
        .select(userBasicWithAge)

      // Use the predefined query as a subquery with defineForRow components
      const enhancedJuniorUsersQuery = new Query()
        .from({ activeUser: activeJuniorUsersQuery })
        .select(({ activeUser }) => ({
          userId: activeUser.id,
          userName: upper(activeUser.name),
          userAge: activeUser.age,
          category: `junior`,
        }))

      const liveCollection = createLiveQueryCollection({
        query: enhancedJuniorUsersQuery,
        startSync: true,
      })

      const results = liveCollection.toArray

      // Alice (25 - junior), Bob (19 - junior), Dave (22 - junior) are active and junior
      // Charlie (30) would not be junior even if active
      expect(results).toHaveLength(3)
      expect(results.every((u) => u.category === `junior`)).toBe(true)
      expect(results.map((u) => u.userName)).toEqual(
        expect.arrayContaining([`ALICE`, `BOB`, `DAVE`])
      )
    })

    test(`should maintain type safety across different namespace structures`, () => {
      // This test verifies that defineForRow maintains proper typing
      // Different namespace structures should work correctly

      const singleUserPredicate = ({ user }: { user: Ref<User> }) =>
        gt(user.age, 20)

      const joinedUserPostPredicate = ({
        u,
        p,
      }: {
        u: Ref<User>
        p: Ref<Post>
      }) => and(eq(u.active, true), eq(p.published, true))

      const singleUserSelect = ({ user }: { user: Ref<User> }) => ({
        name: user.name,
        age: user.age,
      })

      const joinedSelect = ({ u, p }: { u: Ref<User>; p: Ref<Post> }) => ({
        userName: u.name,
        postTitle: p.title,
      })

      // Test single collection
      const singleCollection = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(singleUserPredicate)
            .select(singleUserSelect),
        startSync: true,
      })

      expect(singleCollection.size).toBe(3) // Alice, Charlie, Dave > 20

      // Test joined collections
      const joinedCollection = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ u: usersCollection })
            .join(
              { p: postsCollection },
              ({ u, p }) => eq(u.id, p.authorId),
              `inner`
            )
            .where(joinedUserPostPredicate)
            .select(joinedSelect),
        startSync: true,
      })

      expect(joinedCollection.size).toBe(3) // Active users with published posts

      // Verify the results have correct structure
      const joinedResults = joinedCollection.toArray
      joinedResults.forEach((result) => {
        expect(result).toHaveProperty(`userName`)
        expect(result).toHaveProperty(`postTitle`)
        expect(typeof result.userName).toBe(`string`)
        expect(typeof result.postTitle).toBe(`string`)
      })
    })
  })

  describe(`defineQuery (existing tests)`, () => {
    let usersCollection: ReturnType<typeof createUsersCollection>

    beforeEach(() => {
      usersCollection = createUsersCollection()
    })

    test(`should accept a predefined query builder directly`, () => {
      // Define a query using defineQuery
      const activeUsersQuery = new Query()
        .from({ user: usersCollection })
        .where(({ user }) => eq(user.active, true))
        .select(({ user }) => ({
          id: user.id,
          name: user.name,
          email: user.email,
        }))

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

    test(`should maintain reactivity with predefined queries`, () => {
      // Define a query
      const activeUsersQuery = new Query()
        .from({ user: usersCollection })
        .where(({ user }) => eq(user.active, true))
        .select(({ user }) => ({
          id: user.id,
          name: user.name,
          active: user.active,
        }))

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

      // Delete the new user
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: inactiveUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(3)
      expect(liveCollection.get(5)).toBeUndefined()
    })
  })
})
