import { beforeEach, describe, expect, test } from "vitest"
import {
  createLiveQueryCollection,
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

function createUsersCollection(autoIndex: `off` | `eager` = `eager`) {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `test-users`,
      getKey: (user) => user.id,
      initialData: sampleUsers,
      autoIndex,
    })
  )
}

function createBasicTests(autoIndex: `off` | `eager`) {
  describe(`with autoIndex ${autoIndex}`, () => {
    let usersCollection: ReturnType<typeof createUsersCollection>

    beforeEach(() => {
      usersCollection = createUsersCollection(autoIndex)
    })

    test(`should create, update and delete a live query collection with config`, () => {
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q.from({ user: usersCollection }).select(({ user }) => ({
            id: user.id,
            name: user.name,
            age: user.age,
            email: user.email,
            active: user.active,
          })),
      })

      const results = liveCollection.toArray

      expect(results).toHaveLength(4)
      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Bob`, `Charlie`, `Dave`])
      )

      // Insert a new user
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

      expect(liveCollection.size).toBe(5)
      expect(liveCollection.get(5)).toMatchObject(newUser)

      // Update the new user
      const updatedUser = { ...newUser, name: `Eve Updated` }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: updatedUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(5)
      expect(liveCollection.get(5)).toMatchObject(updatedUser)

      // Delete the new user
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: newUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(4)
      expect(liveCollection.get(5)).toBeUndefined()
    })

    test(`should create, update and delete a live query collection with query function`, async () => {
      const liveCollection = createLiveQueryCollection((q) =>
        q.from({ user: usersCollection }).select(({ user }) => ({
          id: user.id,
          name: user.name,
          age: user.age,
          email: user.email,
          active: user.active,
        }))
      )

      await liveCollection.preload()

      const results = liveCollection.toArray

      expect(results).toHaveLength(4)
      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Bob`, `Charlie`, `Dave`])
      )

      // Insert a new user
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

      expect(liveCollection.size).toBe(5)
      expect(liveCollection.get(5)).toMatchObject(newUser)

      // Update the new user
      const updatedUser = { ...newUser, name: `Eve Updated` }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: updatedUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(5)
      expect(liveCollection.get(5)).toMatchObject(updatedUser)

      // Delete the new user
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: newUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(4)
      expect(liveCollection.get(5)).toBeUndefined()
    })

    test(`should create, update and delete a live query collection with WHERE clause`, () => {
      const activeLiveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.active, true))
            .select(({ user }) => ({
              id: user.id,
              name: user.name,
              active: user.active,
            })),
      })

      const results = activeLiveCollection.toArray

      expect(results).toHaveLength(3)
      expect(results.every((u) => u.active)).toBe(true)
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

      expect(activeLiveCollection.size).toBe(4) // Should include the new active user
      expect(activeLiveCollection.get(5)).toMatchObject({
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

      expect(activeLiveCollection.size).toBe(3) // Should exclude the now inactive user
      expect(activeLiveCollection.get(5)).toBeUndefined()

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

      expect(activeLiveCollection.size).toBe(4) // Should include the reactivated user
      expect(activeLiveCollection.get(5)).toMatchObject({
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

      expect(activeLiveCollection.size).toBe(3)
      expect(activeLiveCollection.get(5)).toBeUndefined()
    })

    test(`should create a live query collection with SELECT projection`, () => {
      const projectedLiveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 20))
            .select(({ user }) => ({
              id: user.id,
              name: user.name,
              isAdult: user.age,
            })),
      })

      const results = projectedLiveCollection.toArray

      expect(results).toHaveLength(3) // Alice (25), Charlie (30), Dave (22)

      // Check that results only have the projected fields
      results.forEach((result) => {
        expect(result).toHaveProperty(`id`)
        expect(result).toHaveProperty(`name`)
        expect(result).toHaveProperty(`isAdult`)
        expect(result).not.toHaveProperty(`email`)
        expect(result).not.toHaveProperty(`active`)
      })

      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Charlie`, `Dave`])
      )

      // Insert a new user over 20 (should be included)
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

      expect(projectedLiveCollection.size).toBe(4) // Should include the new user (age > 20)
      expect(projectedLiveCollection.get(5)).toMatchObject({
        id: 5,
        name: `Eve`,
        isAdult: 28,
      })

      // Update the new user to be under 20 (should remove from collection)
      const youngUser = { ...newUser, age: 18 }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: youngUser,
      })
      usersCollection.utils.commit()

      expect(projectedLiveCollection.size).toBe(3) // Should exclude the now young user
      expect(projectedLiveCollection.get(5)).toBeUndefined()

      // Update the user back to over 20
      const adultUser = { ...youngUser, age: 35, name: `Eve Adult` }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: adultUser,
      })
      usersCollection.utils.commit()

      expect(projectedLiveCollection.size).toBe(4) // Should include the user again
      expect(projectedLiveCollection.get(5)).toMatchObject({
        id: 5,
        name: `Eve Adult`,
        isAdult: 35,
      })

      // Delete the new user
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: adultUser,
      })
      usersCollection.utils.commit()

      expect(projectedLiveCollection.size).toBe(3)
      expect(projectedLiveCollection.get(5)).toBeUndefined()
    })

    test(`should use custom getKey when provided`, () => {
      const customKeyCollection = createLiveQueryCollection({
        id: `custom-key-users`,
        startSync: true,
        query: (q) =>
          q.from({ user: usersCollection }).select(({ user }) => ({
            userId: user.id,
            userName: user.name,
          })),
        getKey: (item) => item.userId, // Custom key extraction
      })

      const results = customKeyCollection.toArray

      expect(results).toHaveLength(4)

      // Verify we can get items by their custom key
      expect(customKeyCollection.get(1)).toMatchObject({
        userId: 1,
        userName: `Alice`,
      })
      expect(customKeyCollection.get(2)).toMatchObject({
        userId: 2,
        userName: `Bob`,
      })

      // Insert a new user
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

      expect(customKeyCollection.size).toBe(5)
      expect(customKeyCollection.get(5)).toMatchObject({
        userId: 5,
        userName: `Eve`,
      })

      // Update the new user
      const updatedUser = { ...newUser, name: `Eve Updated` }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: updatedUser,
      })
      usersCollection.utils.commit()

      expect(customKeyCollection.size).toBe(5)
      expect(customKeyCollection.get(5)).toMatchObject({
        userId: 5,
        userName: `Eve Updated`,
      })

      // Delete the new user
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: updatedUser,
      })
      usersCollection.utils.commit()

      expect(customKeyCollection.size).toBe(4)
      expect(customKeyCollection.get(5)).toBeUndefined()
    })

    test(`should auto-generate unique IDs when not provided`, () => {
      const collection1 = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q.from({ user: usersCollection }).select(({ user }) => ({
            id: user.id,
            name: user.name,
          })),
      })

      const collection2 = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.active, true))
            .select(({ user }) => ({
              id: user.id,
              name: user.name,
            })),
      })

      // Verify that auto-generated IDs are unique and follow the expected pattern
      expect(collection1.id).toMatch(/^live-query-\d+$/)
      expect(collection2.id).toMatch(/^live-query-\d+$/)
      expect(collection1.id).not.toBe(collection2.id)

      // Verify collections work correctly
      const results1 = collection1.toArray

      const results2 = collection2.toArray

      expect(results1).toHaveLength(4) // All users
      expect(results2).toHaveLength(3) // Only active users
    })

    test(`should return original collection type when no select is provided`, () => {
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) => q.from({ user: usersCollection }),
      })

      const results = liveCollection.toArray
      // Should return the original User type, not namespaced

      expect(results).toHaveLength(4)
      expect(results[0]).toHaveProperty(`id`)
      expect(results[0]).toHaveProperty(`name`)
      expect(results[0]).toHaveProperty(`age`)
      expect(results[0]).toHaveProperty(`email`)
      expect(results[0]).toHaveProperty(`active`)

      // Verify the data matches exactly
      expect(results).toEqual(expect.arrayContaining(sampleUsers))

      // Insert a new user
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

      expect(liveCollection.size).toBe(5)
      expect(liveCollection.get(5)).toEqual(newUser)

      // Update the new user
      const updatedUser = { ...newUser, name: `Eve Updated` }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: updatedUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(5)
      expect(liveCollection.get(5)).toEqual(updatedUser)

      // Delete the new user
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: updatedUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(4)
      expect(liveCollection.get(5)).toBeUndefined()
    })

    test(`should return original collection type when no select is provided with WHERE clause`, () => {
      const activeLiveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.active, true)),
      })

      const results = activeLiveCollection.toArray
      // Should return the original User type, not namespaced

      expect(results).toHaveLength(3)
      expect(results.every((u) => u.active)).toBe(true)

      // All properties should be present
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

      expect(activeLiveCollection.size).toBe(4) // Should include the new active user
      expect(activeLiveCollection.get(5)).toEqual(newUser)

      // Update the new user to inactive (should remove from active collection)
      const inactiveUser = { ...newUser, active: false }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: inactiveUser,
      })
      usersCollection.utils.commit()

      expect(activeLiveCollection.size).toBe(3) // Should exclude the now inactive user
      expect(activeLiveCollection.get(5)).toBeUndefined()

      // Delete from original collection to clean up
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: inactiveUser,
      })
      usersCollection.utils.commit()
    })

    test(`should return original collection type with query function syntax and no select`, async () => {
      const liveCollection = createLiveQueryCollection((q) =>
        q.from({ user: usersCollection }).where(({ user }) => gt(user.age, 20))
      )

      await liveCollection.preload()

      const results = liveCollection.toArray
      // Should return the original User type, not namespaced

      expect(results).toHaveLength(3) // Alice (25), Charlie (30), Dave (22)

      // All properties should be present
      results.forEach((result) => {
        expect(result).toHaveProperty(`id`)
        expect(result).toHaveProperty(`name`)
        expect(result).toHaveProperty(`age`)
        expect(result).toHaveProperty(`email`)
        expect(result).toHaveProperty(`active`)
      })

      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Charlie`, `Dave`])
      )
    })

    test(`should support spread operator with computed fields in select`, () => {
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 20))
            .select(({ user }) => ({
              ...user,
              name_upper: upper(user.name),
            })),
      })

      const results = liveCollection.toArray

      expect(results).toHaveLength(3) // Alice (25), Charlie (30), Dave (22)

      // Check that all original properties are present
      results.forEach((result) => {
        expect(result).toHaveProperty(`id`)
        expect(result).toHaveProperty(`name`)
        expect(result).toHaveProperty(`age`)
        expect(result).toHaveProperty(`email`)
        expect(result).toHaveProperty(`active`)
        expect(result).toHaveProperty(`name_upper`)
      })

      // Verify that the computed field is correctly applied
      expect(results.map((u) => u.name_upper)).toEqual(
        expect.arrayContaining([`ALICE`, `CHARLIE`, `DAVE`])
      )

      // Verify original names are preserved
      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Charlie`, `Dave`])
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
      })

      // Insert a new user and verify spread + computed field
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
      const eve = liveCollection.get(5)
      expect(eve).toMatchObject({
        ...newUser,
        name_upper: `EVE`,
      })

      // Update the user and verify the computed field is updated
      const updatedUser = { ...newUser, name: `Evelyn` }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: updatedUser,
      })
      usersCollection.utils.commit()

      const evelyn = liveCollection.get(5)
      expect(evelyn).toMatchObject({
        ...updatedUser,
        name_upper: `EVELYN`,
      })

      // Clean up
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: updatedUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(3)
      expect(liveCollection.get(5)).toBeUndefined()
    })
  })
}

describe(`Query`, () => {
  describe(`basic`, () => {
    createBasicTests(`off`)
    createBasicTests(`eager`)
  })
})
